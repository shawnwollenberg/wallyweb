import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createCatalogCache, fileCatalogStorage, normalizeResource, type DiscoveryPage } from "../src/catalog.js";

const rawResource = {
  resource: "https://example.com/api/send",
  description: "Send a payment",
  type: "http",
  x402Version: 2,
  lastUpdated: "2026-11-23T21:10:53.278Z",
  accepts: [
    {
      amount: "50000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: { name: "USD Coin", version: "2" },
      maxTimeoutSeconds: 60,
      network: "eip155:8453",
      payTo: "0x17cd53C04D707eF0Dd615EF56c633f02915a7905",
      scheme: "exact"
    }
  ],
  extensions: {
    bazaar: {
      info: { input: { method: "POST", type: "http", bodyFields: { to: "0x1" } } },
      schema: { properties: { input: {} } }
    }
  },
  quality: { l30DaysTotalCalls: 10, l30DaysUniquePayers: 1, lastCalledAt: "2026-11-23T18:40:55.075Z" },
  serviceName: "Example",
  tags: ["payments"],
  curated: false
};

describe("catalog normalize", () => {
  it("reads the CDP list-resources shape", () => {
    const service = normalizeResource(rawResource);
    assert.ok(service);
    assert.equal(service.method, "POST");
    assert.equal(service.hasInputSchema, true);
    assert.equal(service.quality.l30DaysTotalCalls, 10);
    assert.equal(service.quality.l30DaysUniquePayers, 1);
    assert.equal(service.accepts[0]?.assetName, "USD Coin");
    assert.equal(service.accepts[0]?.amount, "50000");
  });

  it("drops listings without a payable accept", () => {
    assert.equal(normalizeResource({ resource: "https://example.com" }), null);
    assert.equal(normalizeResource({ resource: "https://example.com", accepts: [{ scheme: "exact" }] }), null);
  });
});

describe("catalog cache", () => {
  it("pages until the catalog total, dedupes, and refreshes only after the ttl", async () => {
    let calls = 0;
    let clock = 1_000;
    const cache = createCatalogCache({
      ttlMs: 1_000,
      maxResources: 10,
      budgetMs: 10_000,
      now: () => clock,
      fetchPage: async offset => {
        calls += 1;
        const page: DiscoveryPage = {
          items:
            offset === 0
              ? [rawResource, rawResource]
              : [{ ...rawResource, resource: "https://example.com/api/other", description: "Other token price" }],
          pagination: { limit: 1, offset, total: 2 }
        };
        return page;
      }
    });

    const first = await cache.get();
    assert.equal(calls, 2);
    assert.equal(first.services.length, 2);
    assert.equal(first.complete, true);
    assert.equal(first.stale, false);
    assert.equal(first.services[0]?.resource, "https://example.com/api/send");

    clock = 1_500;
    await cache.get();
    assert.equal(calls, 2);

    clock = 3_000;
    await cache.get();
    assert.equal(calls, 4);
  });

  it("keeps a partial snapshot when the time budget stops the walk", async () => {
    let calls = 0;
    const cache = createCatalogCache({
      ttlMs: 10_000,
      maxResources: 100,
      budgetMs: 0,
      now: () => 0,
      fetchPage: async () => {
        calls += 1;
        return {
          items: [rawResource],
          pagination: { limit: 1000, offset: 0, total: 5000 }
        };
      }
    });
    const snapshot = await cache.get();
    assert.equal(calls, 1);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.services.length, 1);
  });

  it("serves the last snapshot when a refresh fails", async () => {
    let fail = false;
    let clock = 0;
    const cache = createCatalogCache({
      ttlMs: 100,
      maxResources: 10,
      budgetMs: 1000,
      now: () => clock,
      fetchPage: async () => {
        if (fail) throw new Error("discovery down");
        return { items: [rawResource], pagination: { limit: 1, offset: 0, total: 1 } };
      }
    });
    const fresh = await cache.get();
    assert.equal(fresh.stale, false);
    fail = true;
    clock = 500;
    const stale = await cache.get();
    assert.equal(stale.stale, true);
    assert.equal(stale.services.length, 1);
  });

  it("reuses a fresh snapshot from disk", async () => {
    const file = path.join(os.tmpdir(), `compass-catalog-${Date.now()}.json`);
    const storage = fileCatalogStorage(file);
    let calls = 0;
    const first = createCatalogCache({
      ttlMs: 10_000,
      maxResources: 10,
      budgetMs: 1000,
      now: () => 5_000,
      storage,
      fetchPage: async () => {
        calls += 1;
        return { items: [rawResource], pagination: { limit: 1, offset: 0, total: 1 } };
      }
    });
    await first.get();
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(file), true);

    const second = createCatalogCache({
      ttlMs: 10_000,
      maxResources: 10,
      budgetMs: 1000,
      now: () => 6_000,
      storage,
      fetchPage: async () => {
        calls += 1;
        return { items: [], pagination: { limit: 1, offset: 0, total: 0 } };
      }
    });
    const snapshot = await second.get();
    assert.equal(calls, 1);
    assert.equal(snapshot.services[0]?.resource, "https://example.com/api/send");
    fs.rmSync(file, { force: true });
  });
});
