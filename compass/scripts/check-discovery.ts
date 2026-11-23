const baseUrl = (process.env.COMPASS_BASE_URL || "https://compass.wallyweb.com").replace(/\/+$/, "");
const resource = new URL(`${baseUrl}/v1/x402/recommend`);
resource.searchParams.set("q", process.env.COMPASS_DISCOVERY_QUERY || "wallet portfolio on Base");
const timeoutMs = 20_000;

const challengeResponse = await fetch(resource, { signal: AbortSignal.timeout(timeoutMs) });
if (challengeResponse.status !== 402) {
  throw new Error(`Expected ${resource.pathname} to return HTTP 402, received ${challengeResponse.status}.`);
}

const paymentRequiredHeader =
  challengeResponse.headers.get("payment-required") || challengeResponse.headers.get("x-payment-required");
if (!paymentRequiredHeader) throw new Error("The 402 response did not include a payment-required header.");

const challenge = JSON.parse(Buffer.from(paymentRequiredHeader, "base64url").toString("utf8")) as {
  accepts?: Array<{ amount?: string; network?: string; payTo?: string }>;
  resource?: { url?: string; description?: string };
  extensions?: Record<string, unknown>;
};

const validationResponse = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/validate", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ resource: resource.toString(), method: "GET" }),
  signal: AbortSignal.timeout(timeoutMs)
});
const validation = validationResponse.ok ? ((await validationResponse.json()) as {
  valid?: boolean;
  simulation?: { outcome?: string; rejectionReason?: string };
  index?: { active?: boolean; lastCrawledAt?: string | null } | null;
}) : { valid: false };

const report = {
  ok: challengeResponse.status === 402 && Boolean(challenge.extensions?.bazaar) && challenge.accepts?.[0]?.amount === "5000",
  service: baseUrl,
  paymentChallenge: {
    status: challengeResponse.status,
    hasBazaarExtension: Boolean(challenge.extensions?.bazaar),
    amount: challenge.accepts?.[0]?.amount ?? null,
    network: challenge.accepts?.[0]?.network ?? null,
    payTo: challenge.accepts?.[0]?.payTo ?? null,
    description: challenge.resource?.description ?? null
  },
  validation: {
    httpStatus: validationResponse.status,
    valid: validation.valid === true,
    simulationOutcome: validation.simulation?.outcome ?? null,
    rejectionReason: validation.simulation?.rejectionReason ?? null,
    indexed: validation.index?.active === true,
    lastCrawledAt: validation.index?.lastCrawledAt ?? null
  },
  nextStep: validation.index?.active
    ? "x402 Compass is indexed in the CDP Bazaar."
    : "Validation does not require a payment. Indexing happens after one settled CDP payment, and the catalog can take about 10 minutes to show it."
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
