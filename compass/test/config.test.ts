import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { CDP_FACILITATOR_URL } from "../src/constants.js";

const wallet = "0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MY_WALLET_ADDRESS: wallet,
    X402_DEV_BYPASS: "false",
    X402_FACILITATOR_URL: CDP_FACILITATOR_URL,
    X402_NETWORK: "eip155:8453",
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
    ...overrides
  };
}

describe("config", () => {
  it("defaults the recommend price to $0.005 and marks CDP settlement bazaar-eligible", () => {
    const config = loadConfig(baseEnv());
    assert.equal(config.x402PriceUsd, "0.005");
    assert.equal(config.bazaarEligible, true);
    assert.equal(config.usesCdpFacilitator, true);
    assert.equal(config.cdpApiKeySecret, "secret");
  });

  it("allows a local bypass without CDP keys", () => {
    const config = loadConfig({
      X402_DEV_BYPASS: "true"
    });
    assert.equal(config.x402DevBypass, true);
    assert.equal(config.bazaarEligible, false);
  });

  it("rejects a price the CDP facilitator will not settle", () => {
    assert.throws(() => loadConfig(baseEnv({ X402_RECOMMEND_PRICE_USD: "0.0001" })), /at least 0.001/);
  });

  it("requires a receiving wallet when payments are on", () => {
    assert.throws(() => loadConfig(baseEnv({ MY_WALLET_ADDRESS: "" })), /MY_WALLET_ADDRESS/);
  });
});
