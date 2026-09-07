# APP20 — private chat, payments and RFQs on Starknet

[App](https://app20.io) · [Agent guide](https://app20.io/agents) · [SDK documentation](https://app20.io/agent-sdk.md) · [Mainnet deployment](deployments/mainnet/private-settlement.json)

APP20 combines encrypted communication, permissionless market making and STRK20 shielded settlement. It uses a desktop-first interface. The favicon and application identity use **[20]**.

## Current status

| Feature | Status |
| --- | --- |
| Mainnet maker registry and private-swap contract | Deployed; exact addresses and class hashes are pinned in the deployment manifest |
| RFQ UI | Automatic preliminary comparison, one funded offer, explicit swap review; minimum receive stays visible; maker onboarding at `/rfq/maker` |
| Becoming a maker | Permissionless registration, inventory funding/withdrawal, configuration export and a Node bot |
| Agent library | Downloadable `@app20/agent-sdk`, including Node wallet/proving integration; not published to the npm registry |
| Privy mainnet wallet | Implemented register/shield/transfer/unshield path; requires configured Privy backend credentials and a real-wallet acceptance test |
| Proving | Starkscan asynchronous STRK20 jobs through an authenticated APP20 Worker; plain HTTPS, **not OHTTP** |
| Mainnet chat | Not deployed. Localnet encrypted chat exists; there is no live mainnet send-chat API |
| Live private fill | Three mainnet swaps verified on 2026-09-07 using the Node SDK and real proofs; one operator wallet controlled maker and taker; browser wallet acceptance remains separate |

The RFQ browser screen currently uses Ready. Privy is a separate wallet and funds/recovery screen at `/recovery/privy`; changing wallets does not move balances. The Node SDK can provide its own private executor for settlement.

## Privacy: what is and is not hidden

RFQ requests and responses use authenticated encryption. Taker inputs and outputs use shielded notes. Funded quote terms and amounts, maker inventory/proceeds, requesting accounts, selected makers, and settlement timing/activity are public. This is not anonymous trading.

### Proving payload exposure — accepted limitation

The selected proving transport is:

`Browser or Node agent → APP20 Cloudflare Worker → Starkscan → STRK20 proving service`

TLS protects traffic on each connection. It does **not** prevent APP20/Cloudflare or Starkscan/the proving operator from accessing proving payloads at their endpoints. The provider API key stays in Worker secret storage; wallet signing keys and viewing-key secrets stay with the wallet. Proving witnesses can still reveal transaction details. We do not call this route a blind relay or OHTTP.

Starkscan's published capabilities, complete docs and OpenAPI were checked on 2026-09-07; none advertised an OHTTP gateway. An unpublished gateway may exist, but is not assumed. The operator accepted the HTTPS limitation. Existing `/api/ohttp/*` code remains separate and never silently downgrades encrypted requests.

The Worker does not log or persist proof request/response bodies. Agents authenticate with separately provisioned relay tokens; Privy users authenticate with Privy access tokens. Job capabilities bind result polling to the authenticated caller. Submission keys are scoped per caller. The Worker enforces request/concurrency limits; Starkscan also enforces its provisioned concurrency and daily budget. No unlimited public prover endpoint is exposed.

Starkscan delivers a completed result only once. Clients preserve the entire result, including screening `additional_data`, before using it. Browser journals encrypt results in IndexedDB with a browser-owned key; Node journals use owner-only files. Preserve these journals. An uncertain delivery stays fenced instead of automatically starting another proof. Clearing storage can destroy recovery material.

Direct contract discovery avoids another hosted indexer, but the RPC provider can observe requested channels, notes and timing. It may be slower than an indexer for large histories.

## Use the app

- `/rfq`: request a quote, check replies, review and accept a funded atomic swap; records remain below the form.
- `/rfq/maker`: register a public encryption key, fund available inventory, withdraw it, and export explicit bot pricing/fee limits.
- `/agents`: Node library, runnable bot and protocol instructions.
- `/recovery/privy`: sign in to the configured Privy project, select your account, register/shield/transfer/unshield, and manage recovery.
- `/chat`: localnet chat implementation; no mainnet Chat helper has been deployed. Chat loads messages after unlocking and refreshes every 60 seconds while visible and online. Unlocked access lasts across app navigation in this tab and clears on lock, disconnect, or account/network change. Backups and older history are under Chat settings.

The default RFQ flow is **amount + minimum receive → Get quotes → request the best funded offer → review → swap**. Comparison batches encrypted preliminary requests to at most five randomly selected active makers from a randomly chosen registry page (20 entries). It ranks valid replies by exact receive amount, excluding expired, below-minimum and insufficient-inventory prices. This is the best offer received, not a guarantee of the best market price. Pool and wallet/network fees are additional; the final review checks the current pool fee.

Only the selected maker receives a second request with a settlement commitment and can reserve inventory. A changed funded price requires explicit review; your original minimum remains enforced. Local recovery serializes reservation attempts across tabs, but is not an on-chain global one-winner constraint. Uncertain submissions stay fenced. Proving and transaction inclusion must complete before expiry.

**Advanced** allows a direct funded request to one maker. **Negotiate in Chat** preserves bilateral fixed-offer discussions and existing offer attachments; those attachments are not atomic RFQ settlement, and mainnet Chat still requires its separate deployment.

A maker must have output inventory and a running bot before executable quotes are available. Spreads are not guaranteed profit.

## Node.js library

Node 24+ and ESM:

```sh
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.tgz
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.sha256
shasum -a 256 -c app20-agent-sdk-0.1.0.sha256
npm install ./app20-agent-sdk-0.1.0.tgz
```

```js
import { App20Client } from '@app20/agent-sdk';
const app = new App20Client();
await app.verify();
const { makers, nextOffset } = await app.listMakers();
```

The library provides `createTransportKey`, `createOperatorConfig`, `runMaker`, encrypted quote preparation/submission/recovery, and `createPrivacyWallet`. The latter connects a local Starknet account and viewing-key provider to contract discovery and Starkscan proving. It returns an executor accepted by `app.settle(...)`, plus register/shield/transfer/unshield methods. It requires a relay token, persistent local state, and explicit gas budgets; no signing or proving starts on import.

Full API and recovery details: [packages/agent-sdk/README.md](packages/agent-sdk/README.md). Private keys, transport-key files, viewing keys, quote journals and proof journals must never be committed or shared in chat.

## Run a maker

```sh
node public/downloads/app20-maker.mjs --init-key ./maker-key.json
node public/downloads/app20-maker.mjs operator.json --check
# Inject APP20_MAKER_SIGNING_KEY through local secret management.
export APP20_MAKER_TRANSPORT_FILE=./maker-key.json
node public/downloads/app20-maker.mjs operator.json --run
```

`--check` verifies deployments/configuration without loading a signer or submitting. Other commands include `--register`, `--fund`, `--withdraw`, `--deactivate`, `--release`, and `--reconcile`. Price, spread, trade sizes, price expiry, inventory and gas limits are operator inputs. Preserve the bot's state file and reconcile uncertain submissions before restarting. See [maker operations](docs/makers/README.md).

## Develop

```sh
npm ci
npm run dev
```

Production uses the deployed mainnet configuration. Alice/Bob are development accounts only:

```sh
npm run dev:localnet
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
npm test
npm test --workspace @app20/privy
npm run check --workspace @app20/relay
npm test --workspace @app20/agent-sdk
npm run test:e2e:maker-setup
npm run test:e2e:settlement:browser
npm run build
npx wrangler deploy
```

Build generates the browser assets, standalone maker, installable SDK archive and checksums, TypeScript checks and browser-secret scans. Browser tests use fixture wallets/RPC and real encryption. A live acceptance test additionally requires a funded account, confirmed setup at the proving block, a real proof, and successful mainnet receipts. No test fixture substitutes for that evidence.

The Worker serves the app and RPC/prover routes. Its API keys are not embedded in browser or SDK downloads. The provider determines proving throughput; a Worker forwards jobs and does not generate STARK proofs itself.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app` | Desktop UI, RFQs, makers, chat and Privy wallet |
| `packages/agent-sdk` | Installable Node library and persistent wallet/proof integration |
| `packages/privy` | Privy signing, privacy wallet operations, discovery and proof providers |
| `packages/private-intents` | Encrypted RFQ and private-settlement protocol |
| `packages/maker-node` | Maker pricing and operator logic |
| `workers/relay` | Authenticated RPC/proving relays and atomic quotas |
| `cairo` | Contracts and contract tests |
| `pool-harness` | Local privacy-pool integration tests |
| `deployments/mainnet` | Exact deployment identities and frontend verification |
| `docs/MAINNET_RUNBOOK.md` | Deployment history, limitations and operational follow-up |

[Mainnet runbook](docs/MAINNET_RUNBOOK.md) · [Maker guide](docs/makers/README.md) · [Agent SDK](packages/agent-sdk/README.md)

## Confidential RFQ development

A new joint escrow exchanges both assets as encrypted STRK20 notes, with separate party approvals and independent timeout refunds. The Cairo contract, Node SDK and local browser workspace are implemented. Run `npm run dev:confidential` and open `http://127.0.0.1:5198/rfq/confidential`. See [the development guide](docs/CONFIDENTIAL_RFQ.md).

Mainnet activation is disabled pending real STARK proofs, independent wallet integration and review. Local contract executions use simulated proof facts. The existing mainnet RFQ continues to expose funded trade terms; Chat encryption does not conceal settlement amounts. The new path still exposes escrow activity, timing and fees, and a hosted prover sees its witness.

## Hackathon demo

Three real mainnet swaps each exchanged **0.01 shielded STRK for 0.001 shielded USDC**. Successful receipts, `QuoteFilled` events, traces through APP20 and STRK20, and deployed class hashes were checked. The same operator controlled maker and taker; these are settlement smoke tests. The test maker is now inactive with no remaining inventory. See [mainnet evidence](deployments/mainnet/smoke-test-2026-09-07.json).

The three verified hashes are in `strk20.json`. Demo execution cost **35.863877034965690848 STRK** in network and pool fees; including the earlier deployment, fees total **63.910369825551435280 STRK**, below the 65 STRK ceiling. Another 0.5 STRK was exchanged for native USDC inventory, separately from fees.

See [demo status and submission checklist](docs/HACKATHON_DEMO.md) and [Remotion recording instructions](tools/demo-video/README.md). The current 2:16 `app20-demo-v8-confidential.mp4` includes Liam narration from ElevenLabs, localnet Chat, the new local confidential escrow and refund flow, subtitles, a macOS window frame and maker/agent previews. Mainnet confidential activation remains pending. Each source is clearly labelled. A public video URL is still required; `demo_video` remains empty.
