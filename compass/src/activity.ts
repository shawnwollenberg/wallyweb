import { BASE_USDC_ADDRESS, BURST_MAX_PAYERS, BURST_MIN_TRANSFERS, BURST_WINDOW_SECONDS, TRANSFER_TOPIC, USER_AGENT } from "./constants.js";

export type UsdcTransfer = {
  from: string;
  to: string;
  valueAtomic: bigint;
  timestamp: number | null;
  txHash: string;
};

export type ActivitySummary = {
  source: "base-usdc-rpc";
  windowBlocks: number;
  transferCount: number;
  uniquePayers: number;
  topPayerShare: number;
  selfPaidShare: number;
  burstCount: number;
  burstChecked: boolean;
  lastTransferAt: string | null;
  truncated: boolean;
};

type RpcLog = {
  topics?: string[];
  data?: string;
  blockTimestamp?: string;
  transactionHash?: string;
  removed?: boolean;
};

const TRANSFER_CAP = 2000;

export function parseTransferLog(log: RpcLog, payTo: string): UsdcTransfer | null {
  if (log.removed) return null;
  const topics = log.topics ?? [];
  if (topics.length < 3 || topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;
  const from = topicToAddress(topics[1] ?? "");
  const to = topicToAddress(topics[2] ?? "");
  if (!from || !to || to !== payTo.toLowerCase()) return null;
  return {
    from,
    to,
    valueAtomic: hexToBigInt(log.data ?? "0x0"),
    timestamp: timestampFromLog(log.blockTimestamp),
    txHash: typeof log.transactionHash === "string" ? log.transactionHash : ""
  };
}

export function summarizeTransfers(transfers: UsdcTransfer[], payTo: string, windowBlocks: number): ActivitySummary {
  const capped = transfers.length > TRANSFER_CAP ? transfers.slice(-TRANSFER_CAP) : transfers;
  const payToLower = payTo.toLowerCase();
  const counts = new Map<string, number>();
  let selfPaid = 0;
  let lastTimestamp: number | null = null;
  for (const transfer of capped) {
    counts.set(transfer.from, (counts.get(transfer.from) ?? 0) + 1);
    if (transfer.from === payToLower) selfPaid += 1;
    if (transfer.timestamp !== null && (lastTimestamp === null || transfer.timestamp > lastTimestamp)) {
      lastTimestamp = transfer.timestamp;
    }
  }
  const transferCount = capped.length;
  const top = Math.max(0, ...counts.values());
  const timestampsKnown = capped.every(transfer => transfer.timestamp !== null);
  return {
    source: "base-usdc-rpc",
    windowBlocks,
    transferCount,
    uniquePayers: counts.size,
    topPayerShare: transferCount === 0 ? 0 : top / transferCount,
    selfPaidShare: transferCount === 0 ? 0 : selfPaid / transferCount,
    burstCount: timestampsKnown ? countBursts(capped) : 0,
    burstChecked: transferCount < BURST_MIN_TRANSFERS || timestampsKnown,
    lastTransferAt: lastTimestamp === null ? null : new Date(lastTimestamp * 1000).toISOString(),
    truncated: transfers.length > TRANSFER_CAP
  };
}

export function countBursts(transfers: UsdcTransfer[]) {
  const sorted = transfers
    .filter(transfer => transfer.timestamp !== null)
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  let bursts = 0;
  for (let start = 0; start < sorted.length; start += 1) {
    const window: UsdcTransfer[] = [];
    for (let index = start; index < sorted.length; index += 1) {
      const timestamp = sorted[index]?.timestamp ?? 0;
      const opened = sorted[start]?.timestamp ?? 0;
      if (timestamp - opened > BURST_WINDOW_SECONDS) break;
      window.push(sorted[index] as UsdcTransfer);
    }
    if (window.length < BURST_MIN_TRANSFERS) continue;
    const amounts = new Set(window.map(transfer => transfer.valueAtomic.toString()));
    const payers = new Set(window.map(transfer => transfer.from));
    if (amounts.size === 1 && payers.size <= BURST_MAX_PAYERS) {
      bursts += 1;
      start += window.length - 1;
    }
  }
  return bursts;
}

export async function fetchInboundUsdcTransfers(
  payTo: string,
  options: { rpcUrl: string; lookbackBlocks: number; timeoutMs: number; fetchImpl?: typeof fetch }
): Promise<ActivitySummary | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const latest = await rpcCall(options.rpcUrl, "eth_blockNumber", [], options.timeoutMs, fetchImpl);
  if (typeof latest !== "string") return null;
  const head = Number.parseInt(latest, 16);
  if (!Number.isFinite(head)) return null;
  const spans = [options.lookbackBlocks, Math.max(500, Math.floor(options.lookbackBlocks / 4))];
  for (const span of spans) {
    const fromBlock = Math.max(0, head - span);
    const logs = await rpcCall(
      options.rpcUrl,
      "eth_getLogs",
      [
        {
          address: BASE_USDC_ADDRESS,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${head.toString(16)}`,
          topics: [TRANSFER_TOPIC, null, addressToTopic(payTo)]
        }
      ],
      options.timeoutMs,
      fetchImpl
    );
    if (Array.isArray(logs)) {
      const transfers = logs
        .map(log => parseTransferLog(log as RpcLog, payTo))
        .filter((transfer): transfer is UsdcTransfer => transfer !== null);
      return summarizeTransfers(transfers, payTo, span);
    }
  }
  return null;
}

export function createActivityCache(options: {
  ttlMs: number;
  failureTtlMs?: number;
  now?: () => number;
  load: (payTo: string) => Promise<ActivitySummary | null>;
}) {
  const now = options.now ?? (() => Date.now());
  const failureTtlMs = options.failureTtlMs ?? 60_000;
  const entries = new Map<string, { at: number; value: ActivitySummary | null }>();
  return {
    async get(payTo: string) {
      const key = payTo.toLowerCase();
      const hit = entries.get(key);
      const age = hit ? now() - hit.at : Number.POSITIVE_INFINITY;
      if (hit && age < (hit.value ? options.ttlMs : failureTtlMs)) return hit.value;
      const value = await options.load(payTo).catch(() => null);
      entries.set(key, { at: now(), value });
      return value;
    }
  };
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[], timeoutMs: number, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    if (body.error || !("result" in body)) return null;
    return body.result;
  } catch {
    return null;
  }
}

function topicToAddress(topic: string) {
  const hex = topic.toLowerCase().replace(/^0x/, "");
  if (hex.length < 40) return null;
  return `0x${hex.slice(-40)}`;
}

function addressToTopic(address: string) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function hexToBigInt(value: string) {
  if (!value || value === "0x") return 0n;
  return BigInt(value);
}

function timestampFromLog(value: string | undefined) {
  if (!value || !value.startsWith("0x")) return null;
  try {
    const parsed = Number(BigInt(value));
    if (!Number.isFinite(parsed)) return null;
    if (parsed > 1_000_000_000_000) return Math.floor(parsed / 1000);
    if (parsed > 1_000_000_000) return parsed;
    return null;
  } catch {
    return null;
  }
}
