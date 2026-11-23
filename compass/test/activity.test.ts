import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countBursts, fetchInboundUsdcTransfers, parseTransferLog, summarizeTransfers, type UsdcTransfer } from "../src/activity.js";
import { TRANSFER_TOPIC } from "../src/constants.js";

const payTo = "0x17cd53C04D707eF0Dd615EF56c633f02915a7905";

function transfer(index: number, from: string, timestamp: number, value = 5000n): UsdcTransfer {
  return { from, to: payTo.toLowerCase(), valueAtomic: value, timestamp, txHash: `0x${index}` };
}

describe("Base USDC activity", () => {
  it("parses an inbound Transfer log", () => {
    const parsed = parseTransferLog(
      {
        topics: [
          TRANSFER_TOPIC,
          "0x000000000000000000000000410d80fec2dbdabbf7bf9c83be11bdb2ba73a0a9",
          "0x00000000000000000000000017cd53c04d707ef0dd615ef56c633f02915a7905"
        ],
        data: "0xc350",
        blockTimestamp: "0x6b04ac45",
        transactionHash: "0xabc"
      },
      payTo
    );
    assert.equal(parsed?.from, "0x410d80fec2dbdabbf7bf9c83be11bdb2ba73a0a9");
    assert.equal(parsed?.valueAtomic, 50000n);
    assert.equal(parsed?.timestamp, 0x6b04ac45);
  });

  it("does not call identical amounts a burst when many wallets paid", () => {
    const start = 1_700_000_000;
    const transfers = Array.from({ length: 8 }, (_, index) =>
      transfer(index, `0x${(index + 1).toString(16).padStart(40, "0")}`, start + index * 60)
    );
    assert.equal(countBursts(transfers), 0);
    const summary = summarizeTransfers(transfers, payTo, 8000);
    assert.equal(summary.burstCount, 0);
    assert.equal(summary.uniquePayers, 8);
    assert.equal(summary.selfPaidShare, 0);
  });

  it("flags a short burst from two wallets and self-payment separately", () => {
    const start = 1_700_000_000;
    const burst = Array.from({ length: 8 }, (_, index) =>
      transfer(index, index < 6 ? payTo.toLowerCase() : "0x2222222222222222222222222222222222222222", start + index)
    );
    const summary = summarizeTransfers(burst, payTo, 8000);
    assert.equal(summary.burstCount, 1);
    assert.ok(summary.selfPaidShare >= 0.5);
  });

  it("does not flag identical payments spread across hours", () => {
    const start = 1_700_000_000;
    const transfers = Array.from({ length: 8 }, (_, index) =>
      transfer(index, index % 2 === 0 ? payTo.toLowerCase() : "0x2222222222222222222222222222222222222222", start + index * 3600)
    );
    assert.equal(countBursts(transfers), 0);
  });

  it("reads logs from a JSON-RPC client", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      calls.push(body.method);
      const result =
        body.method === "eth_blockNumber"
          ? "0x2000"
          : [
              {
                topics: [
                  TRANSFER_TOPIC,
                  "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  `0x${payTo.slice(2).padStart(64, "0")}`
                ],
                data: "0x1388",
                blockTimestamp: "0x6564f880",
                transactionHash: "0x1",
                removed: false
              }
            ];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    };
    const summary = await fetchInboundUsdcTransfers(payTo, {
      rpcUrl: "https://rpc.example",
      lookbackBlocks: 8000,
      timeoutMs: 1000,
      fetchImpl
    });
    assert.deepEqual(calls, ["eth_blockNumber", "eth_getLogs"]);
    assert.equal(summary?.transferCount, 1);
    assert.equal(summary?.uniquePayers, 1);
    assert.equal(summary?.source, "base-usdc-rpc");
  });
});
