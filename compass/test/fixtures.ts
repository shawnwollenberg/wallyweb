import { finalizeService, type CatalogService, type PaymentAccept } from "../src/catalog.js";

export const NOW = Date.parse("2026-11-23T00:00:00.000Z");
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function accept(overrides: Partial<PaymentAccept> = {}): PaymentAccept {
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount: "5000",
    asset: BASE_USDC,
    assetName: "USD Coin",
    payTo: "0x1111111111111111111111111111111111111111",
    ...overrides
  };
}

export function service(overrides: Partial<Omit<CatalogService, "haystack" | "sharedHost">> = {}): CatalogService {
  const { accepts: acceptOverrides, quality, ...rest } = overrides;
  return finalizeService({
    resource: "https://prices.example.com/v1/token-price",
    description: "Token price for assets on Base with a full schema and example output for agents.",
    method: "GET",
    serviceName: "Prices",
    tags: ["price"],
    lastUpdated: "2026-11-23T00:00:00.000Z",
    curated: false,
    hasInputSchema: true,
    accepts: acceptOverrides ?? [accept()],
    quality: quality ?? {
      l30DaysTotalCalls: 40,
      l30DaysUniquePayers: 12,
      lastCalledAt: "2026-11-23T00:00:00.000Z"
    },
    ...rest
  });
}
