import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import dotenv from "dotenv";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config({ quiet: true });

if (process.env.CONFIRM_X402_PAYMENT !== "yes") {
  console.error("Refusing to send a payment. Set CONFIRM_X402_PAYMENT=yes when you intend to settle one real call.");
  process.exit(1);
}

const privateKey = normalizePrivateKey(process.env.X402_TEST_PRIVATE_KEY);
if (!privateKey) {
  console.error("X402_TEST_PRIVATE_KEY is required. Use a dedicated Base wallet funded with a little USDC. Never commit it.");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.baseUrl || process.env.COMPASS_BASE_URL || "https://compass.wallyweb.com").replace(/\/+$/, "");
const query = args.q || "wallet portfolio on Base";
const url = new URL(`${baseUrl}/v1/x402/recommend`);
url.searchParams.set("q", query);
if (args.maxPrice) url.searchParams.set("maxPrice", args.maxPrice);
if (args.network) url.searchParams.set("network", args.network);
if (args.asset) url.searchParams.set("asset", args.asset);
if (args.limit) url.searchParams.set("limit", args.limit);

const account = privateKeyToAccount(privateKey);
const coreClient = new x402Client();
registerExactEvmScheme(coreClient, { signer: account });
const client = new x402HTTPClient(coreClient);

console.log("x402 Compass settlement");
console.log(`payer: ${account.address}`);
console.log(`url: ${url.toString()}`);

const initial = await fetch(url);
if (initial.status !== 402) {
  console.error(`Expected HTTP 402, got ${initial.status}\n${await initial.text()}`);
  process.exit(1);
}

const paymentRequired = client.getPaymentRequiredResponse(name => initial.headers.get(name), await tryReadJson(initial));
const selected = paymentRequired.accepts[0];
if (!selected) {
  console.error("The 402 response did not include payment requirements.");
  process.exit(1);
}

console.log(`network: ${selected.network}`);
console.log(`asset: ${selected.asset}`);
console.log(`amount: ${selected.amount}`);
console.log(`payTo: ${selected.payTo}`);

const paymentPayload = await client.createPaymentPayload(paymentRequired);
const paid = await fetch(url, { headers: client.encodePaymentSignatureHeader(paymentPayload) });
const body = await paid.text();
if (!paid.ok) {
  console.error(`Paid request failed with HTTP ${paid.status}\n${body}`);
  process.exit(1);
}

try {
  const settlement = client.getPaymentSettleResponse(name => paid.headers.get(name));
  console.log("settlement:");
  console.log(JSON.stringify(settlement, null, 2));
} catch {
  console.log("No settlement header was present. Check CloudWatch for the facilitator bazaar extension response.");
}

console.log(body);

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (key && value) parsed[key] = value;
  }
  return parsed;
}

function normalizePrivateKey(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(withPrefix) ? (withPrefix as `0x${string}`) : null;
}

async function tryReadJson(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
