import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivitySummary } from "../src/activity.js";
import { recommendRouteDescription } from "../src/schemas.js";
import { scoreService } from "../src/rank.js";
import { NOW, service } from "./fixtures.js";

const query = { q: "token price" };

function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    source: "base-usdc-rpc",
    windowBlocks: 8000,
    transferCount: 12,
    uniquePayers: 8,
    topPayerShare: 0.25,
    selfPaidShare: 0,
    burstCount: 0,
    burstChecked: true,
    lastTransferAt: "2026-11-23T00:00:00.000Z",
    truncated: false,
    ...overrides
  };
}

describe("ranking", () => {
  it("scores a broadly paid listing above a concentrated one", () => {
    const broad = scoreService(service(), query, { now: NOW, activity: null, activityStatus: "skipped" });
    const concentrated = scoreService(
      service({
        quality: { l30DaysTotalCalls: 40, l30DaysUniquePayers: 1, lastCalledAt: "2026-11-23T00:00:00.000Z" }
      }),
      query,
      { now: NOW, activity: null, activityStatus: "skipped" }
    );
    assert.equal(broad?.qualityScore, 70);
    assert.equal(concentrated?.qualityScore, 38);
    assert.ok(concentrated?.flags.includes("concentrated_payers"));
    assert.match(concentrated?.reasons.join(" ") ?? "", /only 1 payer/);
  });

  it("down-ranks self-payment, bursts, stale listings, and tunnel hosts", () => {
    const base = scoreService(service(), query, { now: NOW, activity: activity(), activityStatus: "ok" });
    const selfPaid = scoreService(service(), query, {
      now: NOW,
      activity: activity({ selfPaidShare: 0.75, transferCount: 8, uniquePayers: 2, topPayerShare: 0.75 }),
      activityStatus: "ok"
    });
    const burst = scoreService(service(), query, {
      now: NOW,
      activity: activity({ burstCount: 1, uniquePayers: 2, topPayerShare: 0.5 }),
      activityStatus: "ok"
    });
    const stale = scoreService(
      service({
        quality: {
          l30DaysTotalCalls: 40,
          l30DaysUniquePayers: 12,
          lastCalledAt: "2026-10-01T00:00:00.000Z"
        }
      }),
      query,
      { now: NOW, activity: null, activityStatus: "skipped" }
    );
    const tunnel = scoreService(
      service({ resource: "https://demo.ngrok-free.app/v1/token-price" }),
      query,
      { now: NOW, activity: null, activityStatus: "skipped" }
    );
    assert.ok(base && selfPaid && burst && stale && tunnel);
    assert.ok(selfPaid.qualityScore < base.qualityScore);
    assert.ok(selfPaid.flags.includes("self_paid"));
    assert.equal(burst.qualityScore, base.qualityScore - 18);
    assert.ok(burst.flags.includes("burst"));
    assert.ok(stale.flags.includes("stale"));
    assert.equal(stale.qualityScore, 56);
    assert.ok(tunnel.flags.includes("shared_host"));
    assert.equal(tunnel.qualityScore, 64);
  });

  it("does not treat identical amounts as padding without a burst flag", () => {
    const clean = scoreService(service(), query, {
      now: NOW,
      activity: activity({ transferCount: 20, uniquePayers: 15, topPayerShare: 0.1, burstCount: 0 }),
      activityStatus: "ok"
    });
    assert.equal(clean?.flags.includes("burst"), false);
    assert.equal(clean?.flags.includes("concentrated_payers"), false);
    assert.match(clean?.reasons.join(" ") ?? "", /do not show self-payment/);
  });

  it("filters price, network, and asset", () => {
    const listing = service();
    assert.equal(scoreService(listing, { q: "token price", maxPrice: "0.001" }, { now: NOW, activity: null, activityStatus: "skipped" }), null);
    assert.ok(scoreService(listing, { q: "token price", maxPrice: "0.005" }, { now: NOW, activity: null, activityStatus: "skipped" }));
    assert.equal(scoreService(listing, { q: "token price", network: "eip155:1" }, { now: NOW, activity: null, activityStatus: "skipped" }), null);
    assert.ok(scoreService(listing, { q: "token price", network: "base" }, { now: NOW, activity: null, activityStatus: "skipped" }));
    assert.equal(
      scoreService(listing, { q: "token price", asset: "0x0000000000000000000000000000000000000001" }, { now: NOW, activity: null, activityStatus: "skipped" }),
      null
    );
    assert.ok(scoreService(listing, { q: "token price", asset: "usdc" }, { now: NOW, activity: null, activityStatus: "skipped" }));
  });

  it("ignores queries that share no terms", () => {
    assert.equal(scoreService(service(), { q: "weather forecast" }, { now: NOW, activity: null, activityStatus: "skipped" }), null);
    assert.equal(scoreService(service(), { q: "on the" }, { now: NOW, activity: null, activityStatus: "skipped" }), null);
  });

  it("keeps the Bazaar description inside CDP's 500 character limit", () => {
    const description = recommendRouteDescription("0.005");
    assert.ok(description.length <= 500);
    assert.match(description, /\$0\.005/);
    assert.match(description, /concentrated/);
  });
});
