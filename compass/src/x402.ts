import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network, SupportedResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { RequestHandler } from "express";
import { createCompassCdpFacilitatorClient } from "./cdp-facilitator.js";
import { config } from "./config.js";
import { recommendExample, recommendInputSchema, recommendOutputSchema, recommendRouteDescription } from "./schemas.js";

const price = config.x402PriceUsd;
const description = recommendRouteDescription(price);

export const paymentRouteConfig = {
  "GET /v1/x402/recommend": {
    accepts: {
      scheme: "exact" as const,
      price: `$${price}`,
      network: config.x402Network as Network,
      payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
      maxTimeoutSeconds: 120
    },
    resource: `${config.publicBaseUrl}/v1/x402/recommend`,
    description,
    mimeType: "application/json" as const,
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          q: "wallet portfolio on Base",
          maxPrice: "0.02",
          network: "eip155:8453",
          asset: "usdc",
          limit: 5
        },
        inputSchema: recommendInputSchema,
        output: {
          example: recommendExample,
          schema: recommendOutputSchema
        }
      })
    }
  }
} satisfies RoutesConfig;

export function createPaymentMiddleware(): RequestHandler | null {
  if (config.x402DevBypass) return null;
  if (!config.payTo) {
    throw new Error("MY_WALLET_ADDRESS is required when X402_DEV_BYPASS is false");
  }

  const facilitator = createFacilitatorClient();
  const resourceServer = new x402ResourceServer(facilitator)
    .register(config.x402Network as Network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  return paymentMiddleware(paymentRouteConfig, resourceServer, {
    appName: "x402 Compass",
    testnet: config.x402Network !== "eip155:8453"
  });
}

function createFacilitatorClient() {
  if (process.env.NODE_TEST_CONTEXT) return new StaticTestFacilitator();

  if (config.usesCdpFacilitator) {
    return createCompassCdpFacilitatorClient({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      baseUrl: config.x402FacilitatorUrl
    });
  }

  console.warn(
    `x402 Compass facilitator ${config.x402FacilitatorUrl} is not the Coinbase CDP facilitator. ` +
      "Settlements on this URL are not indexed in the x402 Bazaar."
  );
  return new HTTPFacilitatorClient({ url: config.x402FacilitatorUrl });
}

class StaticTestFacilitator extends HTTPFacilitatorClient {
  constructor() {
    super({ url: config.x402FacilitatorUrl });
  }

  override getSupported(): Promise<SupportedResponse> {
    return Promise.resolve({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: config.x402Network as Network
        }
      ],
      extensions: [],
      signers: {}
    });
  }
}
