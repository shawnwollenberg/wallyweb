import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { BASE_MAINNET, CDP_FACILITATOR_URL } from "./constants.js";
import { normalizeUsdPrice, usdToAtomic } from "./money.js";

dotenv.config({ quiet: true });

const MIN_USDC_ATOMIC = 1_000n;

const optionalNonEmptyString = z.preprocess(
  value => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const boolFromString = z
  .string()
  .optional()
  .transform(value => value === "true" || value === "1");

const usdPrice = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/, "USD price must be a decimal with at most 6 fractional digits");

if (process.env.NODE_TEST_CONTEXT) {
  process.env.MY_WALLET_ADDRESS = "0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957";
  process.env.CDP_API_KEY_ID = "test-key-id";
  process.env.CDP_API_KEY_SECRET = "test-key-secret";
  process.env.X402_DEV_BYPASS = "false";
  process.env.X402_NETWORK = BASE_MAINNET;
  process.env.X402_FACILITATOR_URL = CDP_FACILITATOR_URL;
  process.env.PUBLIC_BASE_URL = "https://compass.wallyweb.com";
  delete process.env.X402_RECOMMEND_PRICE_USD;
}

const envSchema = z.object({
  MY_WALLET_ADDRESS: optionalNonEmptyString,
  PORT: z.coerce.number().int().positive().default(3000),
  X402_DEV_BYPASS: boolFromString.default(false),
  X402_RECOMMEND_PRICE_USD: usdPrice.default("0.005"),
  X402_NETWORK: z.string().default(BASE_MAINNET),
  X402_FACILITATOR_URL: z.string().url().default(CDP_FACILITATOR_URL),
  CDP_API_KEY_ID: optionalNonEmptyString,
  CDP_API_KEY_SECRET: optionalNonEmptyString,
  PUBLIC_BASE_URL: z.string().url().default("https://compass.wallyweb.com"),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  COMPASS_CATALOG_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  COMPASS_CATALOG_MAX_RESOURCES: z.coerce.number().int().positive().default(50_000),
  COMPASS_CATALOG_BUDGET_MS: z.coerce.number().int().positive().default(25_000),
  COMPASS_CATALOG_CACHE_PATH: z.string().min(1).default(path.join(os.tmpdir(), "x402-compass-catalog.json")),
  COMPASS_ACTIVITY_LOOKBACK_BLOCKS: z.coerce.number().int().positive().default(8_000),
  COMPASS_ACTIVITY_ENRICH_LIMIT: z.coerce.number().int().positive().default(12),
  COMPASS_ACTIVITY_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  COMPASS_RESULT_LIMIT_DEFAULT: z.coerce.number().int().positive().default(8)
});

export type CompassConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }

  const priceUsd = normalizeUsdPrice(parsed.data.X402_RECOMMEND_PRICE_USD);
  const atomic = usdToAtomic(priceUsd);
  if (atomic === null || atomic < MIN_USDC_ATOMIC) {
    throw new Error("X402_RECOMMEND_PRICE_USD must be at least 0.001 USDC. The CDP facilitator rejects smaller x402 prices.");
  }

  if (
    !parsed.data.X402_DEV_BYPASS &&
    (!parsed.data.MY_WALLET_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(parsed.data.MY_WALLET_ADDRESS))
  ) {
    throw new Error(
      "MY_WALLET_ADDRESS must be a valid EVM address when X402_DEV_BYPASS is false. Set X402_DEV_BYPASS=true for local development."
    );
  }

  const usesCdpFacilitator = isCdpFacilitatorUrl(parsed.data.X402_FACILITATOR_URL);
  if (!parsed.data.X402_DEV_BYPASS && usesCdpFacilitator && (!parsed.data.CDP_API_KEY_ID || !parsed.data.CDP_API_KEY_SECRET)) {
    throw new Error(
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required when X402_DEV_BYPASS is false. " +
        "The Coinbase CDP facilitator settles Base USDC payments and is what indexes x402 Compass in the Bazaar."
    );
  }

  return {
    payTo: parsed.data.MY_WALLET_ADDRESS,
    port: parsed.data.PORT,
    x402DevBypass: parsed.data.X402_DEV_BYPASS,
    x402PriceUsd: priceUsd,
    x402Network: parsed.data.X402_NETWORK,
    x402FacilitatorUrl: parsed.data.X402_FACILITATOR_URL.replace(/\/+$/, ""),
    usesCdpFacilitator,
    cdpAuthConfigured: Boolean(parsed.data.CDP_API_KEY_ID && parsed.data.CDP_API_KEY_SECRET),
    cdpApiKeyId: parsed.data.CDP_API_KEY_ID,
    cdpApiKeySecret: parsed.data.CDP_API_KEY_SECRET,
    publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    baseRpcUrl: parsed.data.BASE_RPC_URL,
    catalogTtlSeconds: parsed.data.COMPASS_CATALOG_TTL_SECONDS,
    catalogMaxResources: parsed.data.COMPASS_CATALOG_MAX_RESOURCES,
    catalogBudgetMs: parsed.data.COMPASS_CATALOG_BUDGET_MS,
    catalogCachePath: parsed.data.COMPASS_CATALOG_CACHE_PATH,
    activityLookbackBlocks: parsed.data.COMPASS_ACTIVITY_LOOKBACK_BLOCKS,
    activityEnrichLimit: parsed.data.COMPASS_ACTIVITY_ENRICH_LIMIT,
    activityTimeoutMs: parsed.data.COMPASS_ACTIVITY_TIMEOUT_MS,
    resultLimitDefault: parsed.data.COMPASS_RESULT_LIMIT_DEFAULT,
    bazaarEligible:
      !parsed.data.X402_DEV_BYPASS &&
      usesCdpFacilitator &&
      parsed.data.X402_NETWORK === BASE_MAINNET &&
      Boolean(parsed.data.CDP_API_KEY_ID && parsed.data.CDP_API_KEY_SECRET)
  };
}

export const config = loadConfig(process.env);

function isCdpFacilitatorUrl(value: string) {
  try {
    return new URL(value).hostname.endsWith("cdp.coinbase.com");
  } catch {
    return false;
  }
}
