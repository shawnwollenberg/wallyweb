# WallyWeb

Personal AWS-hosted site at `wallyweb.com`. Marketing/contact splash plus sub-apps under path prefixes.

## Hosting

- **All AWS.** No Railway, no Vercel. AWS CLI profile: `wallyweb` (account `661452835066`).
- **Frontend:** S3 bucket `com-wallyweb-homesite` (`us-east-2`) behind CloudFront with custom domain + ACM cert.
- **Contact form:** API Gateway → Lambda (`wallyweb-contact`) → SES. API URL is hardcoded in `index.html`.

## Deploy

```bash
./deploy-s3.sh
```

Confirms the AWS account interactively, syncs files with correct `Content-Type`, and invalidates CloudFront. Always uses `AWS_PROFILE=wallyweb`.

The script handles each top-level static file explicitly (`index.html`, `styles.css`, `script.js`, `favicon.svg`) plus the `wallet/` sub-app, then does a catch-all `aws s3 sync` for anything else. **The `--exclude` flags in the sync are filename globs that match at any depth** — if you add a new top-level file that needs an explicit content type, mirror the pattern already in the script (cp first, then add to excludes).

## Local dev

```bash
npm install
npm run dev   # http://localhost:3000
```

The Express server (`server.js`) is for local dev only; in production the contact form posts directly to the API Gateway URL embedded in `index.html`.

## Layout

```
/                  marketing page (index.html, styles.css, script.js)
/wallet/           barcode wallet sub-app (client-side encrypted vault)
```

Sub-apps live under path prefixes on the same bucket. Each one is self-contained — its own `index.html`, `*.css`, `*.js`. Don't share JS between the marketing site and sub-apps; CloudFront cache rules are simpler when each prefix is independent.

## Sub-app: /wallet/

Personal barcode wallet (grocery, library, pool passes). Tap a saved card to render a full-screen scannable barcode for the cashier.

- **Auth:** master password → PBKDF2-SHA256 (310k iters) → AES-GCM key, held in memory only. Tab close = locked.
- **Storage:** encrypted blob in `localStorage` (`wallet:vault`). No backend, no sync. If the user later wants cross-device, the upgrade path is uploading the *already-encrypted* blob to S3/DynamoDB keyed by Cognito sub — the encryption stays client-side.
- **Scanning:** `@zxing/browser` via jsDelivr CDN.
- **Rendering:** `bwip-js` via jsDelivr CDN — supports all the barcode formats grocery/library/pool cards actually use (UPC-A, EAN-13, Code 128, Code 39, QR, PDF417, etc.).

## Conventions

- Don't introduce build tooling for the static site. It's plain HTML/CSS/JS by design and `deploy-s3.sh` assumes that.
- Don't commit `.env`, `*.zip`, or anything under `lambda/node_modules/`. `.gitignore` is set up; respect it.
- The Lambda is deployed via `./deploy-lambda.sh`, not in the S3 deploy. Treat them as separate deployments.
