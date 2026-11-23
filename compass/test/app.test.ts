import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

describe("x402 Compass HTTP", () => {
  it("reports the CDP facilitator and the $0.005 price", async () => {
    const response = await fetch(`${baseUrl}/status`);
    const body = (await response.json()) as {
      payment?: {
        facilitator?: string;
        facilitatorUrl?: string;
        network?: string;
        bazaarEligible?: boolean;
        cdpAuthConfigured?: boolean;
        pricesUsd?: { recommend?: string };
      };
      signals?: { real?: string[]; heuristic?: string[] };
      catalog?: { loaded?: boolean };
    };
    assert.equal(response.status, 200);
    assert.equal(body.payment?.facilitator, "coinbase-cdp");
    assert.equal(body.payment?.facilitatorUrl, "https://api.cdp.coinbase.com/platform/v2/x402");
    assert.equal(body.payment?.network, "eip155:8453");
    assert.equal(body.payment?.bazaarEligible, true);
    assert.equal(body.payment?.cdpAuthConfigured, true);
    assert.equal(body.payment?.pricesUsd?.recommend, "0.005");
    assert.equal(body.catalog?.loaded, false);
    assert.ok((body.signals?.real?.length ?? 0) >= 3);
    assert.match(body.signals?.heuristic?.join(" ") ?? "", /x402scan is not called/);
  });

  it("challenges a valid recommend call for 5000 atomic USDC with Bazaar metadata", async () => {
    const response = await fetch(`${baseUrl}/v1/x402/recommend?q=wallet%20portfolio%20on%20Base&network=base&maxPrice=0.02`);
    assert.equal(response.status, 402);
    const header = response.headers.get("payment-required") || response.headers.get("x-payment-required");
    assert.ok(header, `missing payment header: ${[...response.headers.keys()].join(",")}`);
    const challenge = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as {
      accepts?: Array<{ amount?: string; network?: string; scheme?: string }>;
      resource?: { url?: string; description?: string };
      extensions?: { bazaar?: { info?: { input?: { method?: string } } } };
    };
    assert.equal(challenge.accepts?.[0]?.amount, "5000");
    assert.equal(challenge.accepts?.[0]?.network, "eip155:8453");
    assert.equal(challenge.accepts?.[0]?.scheme, "exact");
    assert.equal(challenge.resource?.url, "https://compass.wallyweb.com/v1/x402/recommend");
    assert.match(challenge.resource?.description ?? "", /\$0\.005/);
    assert.ok((challenge.resource?.description ?? "").length <= 500);
    assert.ok(challenge.extensions?.bazaar);
  });

  it("rejects an invalid recommend query before payment", async () => {
    const missing = await fetch(`${baseUrl}/v1/x402/recommend`);
    assert.equal(missing.status, 400);
    const missingBody = (await missing.json()) as { code?: string };
    assert.equal(missingBody.code, "invalid_request");

    const badPrice = await fetch(`${baseUrl}/v1/x402/recommend?q=price&maxPrice=free`);
    assert.equal(badPrice.status, 400);
  });

  it("returns JSON for unknown routes, the wrong method, and invalid JSON", async () => {
    const missing = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { code?: string }).code, "not_found");

    const wrongMethod = await fetch(`${baseUrl}/v1/x402/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(((await wrongMethod.json()) as { code?: string }).code, "method_not_allowed");

    const invalid = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { code?: string }).code, "invalid_json");
  });

  it("answers HEAD without a query", async () => {
    const response = await fetch(`${baseUrl}/v1/x402/recommend`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-compass-required-parameter"), "q");
  });
});
