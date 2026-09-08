# APP20 development and deployment

Use Node.js 24+ and npm. Build workspace exports before starting the frontend:

```sh
npm ci
npm run build:packages
npm run dev
```

The normal dev server shows the app with its network restrictions. To execute the confidential swap and refund flow, install the pinned privacy-pool toolchain and start the disposable lab:

```sh
npm run pool:setup
npm run dev:confidential
# Open http://127.0.0.1:5198/rfq
```

Create an escrow, approve setup, fund each side and approve the exchange. A second, partially funded trade demonstrates the independent timeout refund. Stop the command with Ctrl-C to remove that lab's disposable wallets and state.

For Chat, use the separate Alice/Bob localnet environment. Its runner also requires Scarb 2.18.x as `scarb` on your PATH or at `~/.local/bin/scarb`. Stop the confidential lab before starting it:

```sh
npm run dev:localnet
# Open http://127.0.0.1:5173/chat
# Stop from a separate terminal:
npm run localnet:stop
```

Localnet helpers, test tokens and chat contracts are not mainnet assets. Never fund development keys with real assets.

## Configure Privy and the proving relay

Public build variables:

```text
VITE_PRIVY_APP_ID
VITE_PRIVY_CLIENT_ID
```

Set these in an ignored `.env.production.local` or your build environment. Configure `app20.io` as an allowed domain in Privy and enable the required Starknet embedded-wallet/signing functionality.

Cloudflare secrets (enter values through secret storage, never `VITE_*`):

```sh
npx wrangler secret put PRIVY_APP_SECRET
npx wrangler secret put STARKSCAN_API_KEY
npx wrangler secret put PROOF_CAPABILITY_SECRET
npx wrangler secret put OHTTP_SESSION_SECRET
npx wrangler secret put PROVER_AGENT_TOKEN_HASHES
```

`PROOF_CAPABILITY_SECRET` and `OHTTP_SESSION_SECRET` must each be independently generated with at least 32 bytes of entropy. `PROVER_AGENT_TOKEN_HASHES` maps SHA-256 digests of individually issued high-entropy agent tokens to stable agent identifiers. Give each agent only its own token; never the Starkscan key. Rotate/revoke individual relay tokens by updating that mapping. An empty mapping enables no agent tokens.

Worker variables include the public `PRIVY_APP_ID`, `PRIVY_MAINNET_ENABLED=true`, and `PRIVY_SUBMISSION_MODE=live`. Live mode enables submission for real proofs; it is not evidence that a live transaction has passed. Missing required credentials fail closed. Mainnet pool/class pins come from the shared deployment module.

Starkscan's proving endpoint is **`POST /v1/SN_MAIN/prove`**, not the generic RPC method route. Poll `/v1/SN_MAIN/prove/{jobId}`. The SDK preserves submission idempotency and never automatically replaces an uncertain job. See [Starkscan's proving contract](https://starkscan.co/docs/api/strk20-prover).

## Validate and deploy

```sh
npm run build:packages
npm run test:all
npm run build
```

After `npm run pool:setup`, validate the current escrow contract and SDK integration:

```sh
npm run check:confidential-contract
PATH="$PWD/vendor/bin:$PATH" RUST_LOG=warn node --test pool-harness/tests/confidential-rfq-sdk.e2e.test.mjs
```

Run devnet tests serially with other devnet instances stopped. For the browser journey, start `npm run dev:confidential`, then run these in another terminal:

```sh
npx playwright install chromium
npm run test:confidential:browser
```

Build generates browser assets, the installable SDK archive and checksums, TypeScript checks and browser-secret scans. The local integration and browser tests use disposable wallets and simulated proofs. A mainnet acceptance claim additionally requires a real accepted proof, successful receipts and verified encrypted outputs. [Detailed validation guide](CONFIDENTIAL_RFQ.md#reproduce-validation).

With the Worker configured, deploy the built app using `npx wrangler deploy`. A frontend deployment alone does not prove chain execution; the current mainnet contract pins, enabled clients and separately recorded operation evidence define the supported scope.

The Worker serves the app and RPC/prover routes. Its API keys are not embedded in browser or SDK downloads. The provider determines proving throughput; a Worker forwards jobs and does not generate STARK proofs itself.
