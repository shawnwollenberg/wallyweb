import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivitySummary } from "../src/activity.js";
import type { CatalogSnapshot } from "../src/catalog.js";
import { buildRecommendation } from "../src/recommend.js";
import { NOW, service } from "./fixtures.js";

function snapshot(services: ReturnType<typeof service>[]): CatalogSnapshot {
  return {
    fetchedAt: "2026-11-23T00:00:00.000Z",
    fetchedAtMs: NOW,
    complete: true,
    stale: false,
    total: services.length,
    services
  };
}

describe("recommendations", () => {
  it("returns the requested fields and ranks the padded listing lower", async () => {
    const paddedPayTo = "0x9999999999999999999999999999999999999999";
    const healthy = service({ resource: "https://prices.example.com/v1/token-price" });
    const padded = service({
      resource: "https://padded.example.com/token-price",
      description: "Token price endpoint with repeated tiny calls.",
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "5000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          assetName: "USD Coin",
          payTo: paddedPayTo
        }
      ],
      quality: { l30DaysTotalCalls: 80, l30DaysUniquePayers: 1, lastCalledAt: "2026-11-23T00:00:00.000Z" }
    });
    const activity: ActivitySummary = {
      source: "base-usdc-rpc",
      windowBlocks: 8000,
      transferCount: 8,
      uniquePayers: 1,
      topPayerShare: 1,
      selfPaidShare: 1,
      burstCount: 1,
      burstChecked: true,
      lastTransferAt: "2026-11-23T00:00:00.000Z",
      truncated: false
    };
    const seen: string[] = [];
    const body = await buildRecommendation(
      { q: "token price", limit: 5 },
      snapshot([padded, healthy]),
      {
        now: NOW,
        enrichLimit: 2,
        loadActivity: async payTo => {
          seen.push(payTo);
          return payTo.toLowerCase() === paddedPayTo.toLowerCase() ? activity : { ...activity, selfPaidShare: 0, burstCount: 0, uniquePayers: 8, topPayerShare: 0.2, transferCount: 12 };
        }
      }
    );

    assert.deepEqual(seen.map(item => item.toLowerCase()).sort(), [healthy.accepts[0]!.payTo, paddedPayTo].sort());
    assert.equal(body.recommendations[0]?.url, healthy.resource);
    assert.ok((body.recommendations[1]?.qualityScore ?? 0) < (body.recommendations[0]?.qualityScore ?? 0));
    const row = body.recommendations[1];
    assert.equal(row?.method, "GET");
    assert.equal(row?.price, "0.005");
    assert.equal(row?.network, "eip155:8453");
    assert.ok(row?.description);
    assert.ok(row?.reasons.length);
    assert.ok(row?.signals.flags.includes("self_paid"));
    assert.ok(row?.signals.flags.includes("burst"));
    assert.equal(row?.signals.activityStatus, "ok");
  });

  it("says when nothing matched", async () => {
    const body = await buildRecommendation({ q: "weather", limit: 5 }, snapshot([service()]), {
      now: NOW,
      enrichLimit: 1,
      loadActivity: async () => null
    });
    assert.equal(body.matchCount, 0);
    assert.equal(body.recommendations.length, 0);
    assert.match(body.notes.join(" "), /No Bazaar listings matched/);
  });
});
