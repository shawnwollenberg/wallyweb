# x402 Compass

Paid discovery API for Shawn's site. `GET /v1/x402/recommend` costs **$0.005 USDC** on Base mainnet (`eip155:8453`, `exact` scheme) and returns a ranked list of x402 services from the Coinbase Bazaar.

No payment is sent by tests, deploys, or ranking. The only payment path is `npm run settle:once`, and it refuses to run unless `CONFIRM_X402_PAYMENT=yes`.

## Why it lives in this repo

Compass is a wallyweb.com product, and the marketing page that describes it is in this repo. It is its own deployable service under `compass/` (package, CDK app, Lambda, tests), not a page in the static bucket and not a route on walletLens.

walletLens stays in `github.com/shawnwollenberg/web3_portfolio`. That service owns portfolio, transaction history, and wallet-report data. Compass does not read wallets. Putting it there would mix a catalog ranker into the portfolio API and would still leave the pricing copy to be fixed here.

The static site cannot settle x402. `deploy-s3.sh` excludes `compass/`. Deploy Compass the same way walletLens is deployed: CDK, Lambda Function URL, CloudFront with caching disabled, and a Route 53 name on `wallyweb.com`.

## Architecture

```
GET /v1/x402/recommend
        │
        ▼
Express on Lambda (serverless-http)
        │
        ├─ unpaid GET, including a missing q → 402 exact / eip155:8453 / USDC, Bazaar extension
        ├─ payment header with a missing or invalid q, or any other invalid query → JSON 400, no settlement
        └─ paid GET with a valid q
              ├─ hourly cache of CDP GET /discovery/resources
              ├─ text rank against url, description, tags, service name
              └─ Base USDC Transfer logs for the shortlisted payTo addresses
```

Free routes: `GET /`, `GET /health`, `GET /status`. `POST /v1/x402/recommend` returns JSON 405. Unknown routes return JSON 404. Invalid JSON returns JSON 400 `invalid_json`. Provider failures return JSON 502 `provider_error`. Timeouts return JSON 504 `provider_timeout`.

Settlement uses the Coinbase CDP facilitator at `https://api.cdp.coinbase.com/platform/v2/x402`. JWT auth is bound to `/platform/v2/x402/verify`, `/settle`, and `/supported`, same pattern as walletLens. `GET /status` reports `payment.facilitator`, `payment.facilitatorUrl`, `payment.cdpAuthConfigured`, `payment.bazaarEligible`, and `payment.pricesUsd.recommend` without returning secrets.

The Bazaar description states the price and stays at or under CDP's 500-character limit. The route registers `bazaarResourceServerExtension` and `declareDiscoveryExtension` with input and output schemas.

The public catalog is on the order of 40,000 resources. A refresh fetches `GET /platform/v2/x402/discovery/resources` in pages of 1,000, four pages at a time, until the catalog total, `COMPASS_CATALOG_MAX_RESOURCES`, or `COMPASS_CATALOG_BUDGET_MS` (default 25 seconds). The compact snapshot is kept in memory and in `/tmp` for `COMPASS_CATALOG_TTL_SECONDS` (default 1 hour). A failed refresh serves the previous snapshot and marks it stale. `GET /status` does not trigger a refresh.

Onchain lookups run only for the top Base USDC matches (default 12) and are cached per `payTo` for the same hour. A recommend call after the cache is warm does not walk the catalog or the chain again.

## Data sources

| Source | What is real | Used for |
| --- | --- | --- |
| CDP `GET /platform/v2/x402/discovery/resources` | Public list. No API key. Fields used: `resource`, `description`, `accepts` (scheme, network, amount, asset, payTo), `lastUpdated`, `extensions.bazaar` method and input schema, `serviceName`, `tags`, `curated`. | The candidate set. This is the catalog the route ranks. Semantic search is not called, because that endpoint is capped at 20 and already applies CDP's own quality order. |
| CDP `quality` on each resource | `l30DaysTotalCalls`, `l30DaysUniquePayers`, `lastCalledAt`. Facilitator-reported paid calls. | Payer concentration and staleness over 30 days. |
| Public Base JSON-RPC `eth_getLogs` | USDC `Transfer` logs to the listing `payTo` on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`). Default window is 8,000 blocks, about a few hours. The log supplies sender, atomic amount, and block timestamp when the node includes one. | Self-payment and short-window bursts. These payer addresses are not in the CDP quality object. |
| x402scan | Not called. | Its buyer and merchant APIs are themselves x402-paid (about $0.01). Compass does not pay third parties while ranking. |

`/status` returns the same split under `signals.real` and `signals.heuristic`.

## Padding signals

Thresholds are in `src/rank.ts` and `src/constants.ts`.

**Real inputs, heuristic judgments**

- **Concentrated payers.** CDP quality shows 8 or more paid calls from only 1–2 payers in 30 days, or 20 or more calls averaging at least 40 calls per payer across 3 or fewer payers. Onchain, one sender is at least 80% of recent Base USDC inflows and there are at least 5 transfers. A single real customer can look like this. The score is reduced once, not twice, when both sources agree.
- **Self-paid.** At least half of recent Base USDC inflows to `payTo` come from the `payTo` address, with at least 3 transfers. Those logs are real transfers. They are not proof the transfer was an x402 settlement. Ordinary USDC sends are included.
- **Burst.** At least 8 transfers of one identical atomic amount inside 10 minutes, from at most 2 senders. Identical amounts by themselves are normal for `exact` x402 and are not penalized. Spread-out identical payments from many wallets do not count.
- **Stale.** `quality.lastCalledAt`, or `lastUpdated` when no call time is present, is older than 14 days. CDP hides listings with no settlement for 30 days, so this is an earlier down-rank, not a removal. An empty RPC window is not treated as stale. That window is only a few hours.
- **Shared host.** ngrok, trycloudflare, localtunnel, and localhost lose a few points. This follows CDP's hosting de-weight. It is not evidence of padded payments.

Relevance is a separate term overlap against the description, URL, tags, and service name. Listings with no shared terms are omitted. A usable description or Bazaar input schema adds a small metadata bonus. `curated: true` adds a small bonus because Coinbase set that flag.

`qualityScore` is an integer from 0 to 100. Each recommendation includes `url`, `method`, `price` (USDC dollars when the asset is USDC), `network`, `asset`, `description`, `qualityScore`, and `reasons`. `signals` carries the flags, CDP quality object, and the onchain summary when one was fetched.

## Environment

Copy `compass/.env.example` to `compass/.env`. Do not commit `.env` or a private key.

| Variable | Purpose |
| --- | --- |
| `MY_WALLET_ADDRESS` | Base address that receives USDC. Required when `X402_DEV_BYPASS` is false. |
| `X402_DEV_BYPASS` | `true` locally so routes skip payment. `false` in AWS. |
| `X402_RECOMMEND_PRICE_USD` | Default `0.005`. CDP rejects prices below `0.001`. |
| `X402_NETWORK` | `eip155:8453`. |
| `X402_FACILITATOR_URL` | `https://api.cdp.coinbase.com/platform/v2/x402`. |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | CDP portal API key. Secret key, not the wallet secret. Required for verify and settle. |
| `PUBLIC_BASE_URL` | `https://compass.wallyweb.com`. This becomes the Bazaar resource URL. |
| `ROOT_DOMAIN`, `CUSTOM_DOMAIN` | Route 53 zone and hostname. Defaults `wallyweb.com` and `compass.wallyweb.com`. |
| `BASE_RPC_URL` | Public Base JSON-RPC. Default `https://mainnet.base.org`. |
| `COMPASS_CATALOG_TTL_SECONDS` | Default `3600`. |
| `COMPASS_CATALOG_MAX_RESOURCES` | Default `50000`. |
| `COMPASS_CATALOG_BUDGET_MS` | Default `25000`. |
| `COMPASS_ACTIVITY_LOOKBACK_BLOCKS` | Default `8000`. |
| `COMPASS_ACTIVITY_ENRICH_LIMIT` | Default `12` payTo addresses per call. |
| `COMPASS_ACTIVITY_TIMEOUT_MS` | Default `8000` per RPC call. |
| `X402_TEST_PRIVATE_KEY` | Only for a deliberate settlement. Dedicated low-balance wallet. |
| `CONFIRM_X402_PAYMENT` | Must be `yes` or `npm run settle:once` exits before signing. |

Keys are created at https://portal.cdp.coinbase.com/.

## Deploy

From `compass/`, with the `wallyweb` AWS profile (account `661452835066`) and the `wallyweb.com` hosted zone already in Route 53:

```bash
cd compass
cp .env.example .env
# fill MY_WALLET_ADDRESS, CDP_API_KEY_ID, CDP_API_KEY_SECRET
# X402_DEV_BYPASS=false
npm install
npm test
npm run deploy:aws
```

`npm run deploy:aws` is `cdk deploy --profile wallyweb`. The stack is `X402CompassStack` in `us-east-2` (override with `DEPLOY_REGION`). The certificate is created in `us-east-1` for CloudFront. Deploy refuses a non-CDP facilitator or missing CDP keys unless `X402_DEV_BYPASS=true` or `X402_ALLOW_NON_CDP_FACILITATOR=true`.

The Lambda is Node.js 22, 1024 MB, 60 second timeout. CloudFront does not cache responses, and the origin read timeout is 60 seconds so a cold catalog refresh can finish. The first paid call after a cold start can take tens of seconds. Later calls in that hour use the cache.

The marketing site is still `./deploy-s3.sh` from the repo root. That sync does not upload `compass/`.

After deploy:

```bash
curl https://compass.wallyweb.com/status
```

Expect `payment.facilitator` `coinbase-cdp`, `payment.network` `eip155:8453`, `payment.bazaarEligible` `true`, and `payment.pricesUsd.recommend` `0.005`.

`npm run check:discovery` reads the live 402 and calls CDP `POST /v2/x402/validate`. Validate does not settle a payment. `indexed: false` is expected until the first settlement.

Local unpaid development:

```bash
# .env with X402_DEV_BYPASS=true
npm run dev
curl "http://localhost:3000/v1/x402/recommend?q=token%20price"
```

## First settled payment

CDP lists a route only after the CDP facilitator **settles** a payment. A 402, a verify, and a validate call are not enough. The settle payload must include `paymentPayload.resource`. The x402 client copies `resource` and `extensions.bazaar` from the 402. Listings with no settled activity for 30 days drop out of the catalog, so repeat a settled call at least that often.

CDP then crawls the resource URL with no query, `GET /v1/x402/recommend`. That probe has to return 402. An unpaid request whose only problem is a missing `q` does. A request that already carries `payment-signature` or `x-payment`, or a query that is present but invalid, returns 400 and is not settled. After deploying this behavior, send one new settled call so CDP crawls the bare URL again.

Use a dedicated Base wallet with a little USDC. This spends $0.005.

```bash
cd compass
# X402_TEST_PRIVATE_KEY=0x... in .env, not committed
CONFIRM_X402_PAYMENT=yes npm run settle:once -- --q "wallet portfolio on Base"
```

The command prints the payer, the amount, and `payTo` before it signs. A successful call returns the recommend JSON, not another 402. Indexing is asynchronous and can take about 10 minutes. Then:

```bash
npm run check:discovery
```

`validation.indexed` should become true. In CloudWatch, the facilitator extension response for `bazaar` should be `processing` on that settle.

## Tests

```bash
cd compass
npm test
npm run check
```

`npm test` is 33 node:test cases. They cover catalog parsing and the hourly cache, USDC log parsing, burst versus ordinary identical payments, ranking penalties, the recommend response shape, the 402 challenge (`5000` atomic units, Bazaar extension, description includes `$0.005` and is at most 500 characters), the queryless resource URL returning 402, a payment header with a missing `q` returning 400, JSON 400/404/405, and `/status`. `tsc --noEmit` covers the API, the CDK app, and the scripts. The test process pins a fake CDP key and never calls the facilitator or sends a payment.
