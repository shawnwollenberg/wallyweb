import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atomicToUsd, canonicalNetwork, usdToAtomic } from "../src/money.js";

describe("USDC amounts", () => {
  it("converts the Compass and WalletLens prices", () => {
    assert.equal(atomicToUsd("5000"), "0.005");
    assert.equal(atomicToUsd("20000"), "0.02");
    assert.equal(atomicToUsd("1000000"), "1");
    assert.equal(atomicToUsd("0"), "0");
    assert.equal(usdToAtomic("0.005")?.toString(), "5000");
    assert.equal(usdToAtomic("00.020")?.toString(), "20000");
  });

  it("accepts Base aliases", () => {
    assert.equal(canonicalNetwork("base"), "eip155:8453");
    assert.equal(canonicalNetwork("eip155:8453"), "eip155:8453");
  });
});
