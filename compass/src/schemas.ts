import { z } from "zod";

export function recommendRouteDescription(priceUsd: string) {
  const description =
    `$${priceUsd} USDC per call on Base (eip155:8453). x402 Compass ranks Coinbase Bazaar services for a task and down-ranks listings whose activity looks concentrated, self-paid, bursty, or stale. Query: q (required), maxPrice, network, asset, limit. Response fields: url, method, price, network, description, qualityScore, reasons.`;
  if (description.length > 500) {
    throw new Error(`Bazaar description is ${description.length} characters. CDP rejects descriptions over 500.`);
  }
  return description;
}

export const recommendInputSchema = {
  description:
    "Query parameters for GET /v1/x402/recommend. Price is $0.005 USDC per call, settled on Base (eip155:8453). q is a task or capability, for example wallet portfolio on Base.",
  properties: {
    q: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "Task or capability to match against Bazaar descriptions, URLs, and tags."
    },
    maxPrice: {
      type: "string",
      pattern: "^\\d+(?:\\.\\d{1,6})?$",
      description: "Maximum USDC price, decimal dollars. Listings above this are omitted."
    },
    network: {
      type: "string",
      description: "CAIP-2 network such as eip155:8453. base is accepted as an alias."
    },
    asset: {
      type: "string",
      description: "Asset filter. Use usdc or a token contract address."
    },
    limit: {
      type: "integer",
      default: 8,
      minimum: 1,
      maximum: 20,
      description: "Maximum recommendations to return."
    }
  },
  required: ["q"],
  additionalProperties: false
} as const;

export const recommendOutputSchema = {
  type: "object",
  description:
    "Ranked Bazaar services. qualityScore is 0-100 after relevance and padding penalties. reasons explain the score. signals.flags names concentrated_payers, self_paid, burst, stale, or shared_host when those checks fired.",
  properties: {
    query: { type: "object" },
    matchCount: { type: "integer" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string" },
          price: { type: ["string", "null"], description: "USDC price in decimal dollars when the asset is USDC." },
          network: { type: "string" },
          asset: { type: "string" },
          description: { type: "string" },
          qualityScore: { type: "integer", minimum: 0, maximum: 100 },
          reasons: { type: "array", items: { type: "string" } }
        },
        required: ["url", "method", "price", "network", "asset", "description", "qualityScore", "reasons"]
      }
    },
    catalog: { type: "object" },
    notes: { type: "array", items: { type: "string" } }
  },
  required: ["query", "matchCount", "recommendations", "catalog", "notes"]
} as const;

export const recommendExample = {
  query: { q: "wallet portfolio on Base", maxPrice: "0.02", network: "eip155:8453", asset: "usdc", limit: 5 },
  matchCount: 1,
  recommendations: [
    {
      url: "https://walletlens.wallyweb.com/portfolio",
      method: "GET",
      price: "0.005",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      description: "Wallet portfolio balances and USD pricing on Base.",
      qualityScore: 78,
      reasons: [
        "Matches 3 of 3 query terms (wallet, portfolio, base).",
        "CDP quality: 12 unique payers and 40 paid calls in 30 days."
      ]
    }
  ],
  catalog: {
    source: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
    fetchedAt: "2026-11-23T21:00:00.000Z",
    resourceCount: 1000,
    indexedTotal: 1000,
    complete: true,
    stale: false
  },
  notes: []
} as const;

const queryString = z.string().trim().min(1).max(200);

export const recommendQuerySchema = z.object({
  q: queryString,
  maxPrice: z
    .string()
    .regex(/^\d+(?:\.\d{1,6})?$/, "maxPrice must be a USD decimal with at most 6 fractional digits")
    .optional(),
  network: z.string().trim().min(1).max(80).optional(),
  asset: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8)
});

export function parseRecommendQuery(input: Record<string, unknown>) {
  return recommendQuerySchema.safeParse({
    q: firstString(input.q),
    maxPrice: emptyToUndefined(firstString(input.maxPrice)),
    network: emptyToUndefined(firstString(input.network)),
    asset: emptyToUndefined(firstString(input.asset)),
    limit: emptyToUndefined(firstString(input.limit))
  });
}

export type ParsedRecommendQuery = z.infer<typeof recommendQuerySchema>;

function firstString(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function emptyToUndefined(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
