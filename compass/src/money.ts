const USDC_DECIMALS = 6n;
const USDC_SCALE = 1_000_000n;

const NETWORK_ALIASES: Record<string, string> = {
  base: "eip155:8453",
  "base-mainnet": "eip155:8453",
  ethereum: "eip155:1",
  eth: "eip155:1",
  mainnet: "eip155:1",
  "base-sepolia": "eip155:84532"
};

const KNOWN_USDC = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
]);

export function canonicalNetwork(value: string) {
  const key = value.trim().toLowerCase();
  return NETWORK_ALIASES[key] ?? key;
}

export function usdToAtomic(value: string): bigint | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * USDC_SCALE + BigInt((match[2] ?? "").padEnd(Number(USDC_DECIMALS), "0"));
}

export function atomicToUsd(atomic: string): string | null {
  if (!/^\d+$/.test(atomic)) return null;
  const value = BigInt(atomic);
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(Number(USDC_DECIMALS), "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function normalizeUsdPrice(value: string) {
  const atomic = usdToAtomic(value);
  if (atomic === null) return value.trim();
  return atomicToUsd(atomic.toString()) ?? value.trim();
}

export function isUsdcAsset(asset: string, assetName: string | null) {
  if (KNOWN_USDC.has(asset.toLowerCase())) return true;
  const name = (assetName ?? "").toLowerCase();
  return name === "usdc" || name === "usd coin" || name.includes("usd coin");
}

export function assetMatches(asset: string, assetName: string | null, filter: string) {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return true;
  if (wanted.startsWith("0x")) return asset.toLowerCase() === wanted;
  if (wanted === "usdc" || wanted === "usd" || wanted === "usd coin") return isUsdcAsset(asset, assetName);
  const name = (assetName ?? "").toLowerCase();
  return name === wanted || asset.toLowerCase() === wanted;
}
