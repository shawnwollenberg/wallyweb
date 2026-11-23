import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { CDP_FACILITATOR_URL } from "./constants.js";

type FacilitatorCredentials = {
  apiKeyId: string;
  apiKeySecret: string;
};

/**
 * CDP-authenticated facilitator client.
 *
 * Mirrors WalletLens: JWT host and path are derived from the facilitator URL so verify,
 * settle, and supported stay bound to the same CDP endpoint. The `@coinbase/cdp-sdk/x402`
 * barrel is avoided because it loads the optional `@x402/svm` peer.
 */
export function createCompassCdpFacilitatorClient(args: {
  apiKeyId?: string;
  apiKeySecret?: string;
  baseUrl?: string;
}) {
  const apiKeyId = args.apiKeyId;
  const apiKeySecret = args.apiKeySecret;
  if (!apiKeyId || !apiKeySecret) {
    throw new Error(
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required to settle through the Coinbase CDP facilitator."
    );
  }

  const { url, host, paths } = resolveFacilitatorEndpoints(args.baseUrl ?? CDP_FACILITATOR_URL);
  const credentials = { apiKeyId, apiKeySecret };

  return new HTTPFacilitatorClient({
    url,
    createAuthHeaders: async () => {
      const [verify, settle, supported] = await Promise.all([
        authHeaders(credentials, host, paths.verify, "POST"),
        authHeaders(credentials, host, paths.settle, "POST"),
        authHeaders(credentials, host, paths.supported, "GET")
      ]);
      return { verify, settle, supported };
    }
  });
}

export function resolveFacilitatorEndpoints(baseUrl: string) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/$/, "");
  return {
    url: baseUrl,
    host: parsed.host,
    paths: {
      verify: `${basePath}/verify`,
      settle: `${basePath}/settle`,
      supported: `${basePath}/supported`
    }
  };
}

async function authHeaders(
  credentials: FacilitatorCredentials,
  host: string,
  path: string,
  method: "GET" | "POST"
) {
  const jwt = await generateJwt({
    apiKeyId: credentials.apiKeyId,
    apiKeySecret: credentials.apiKeySecret,
    requestMethod: method,
    requestHost: host,
    requestPath: path
  });

  return {
    Authorization: `Bearer ${jwt}`,
    "Correlation-Context": "sdkLanguage=typescript,source=x402-compass"
  };
}
