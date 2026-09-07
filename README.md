# APP20 — private chat, payments and RFQs on Starknet

[App](https://app20.io) · [Agent guide](https://app20.io/agents) · [SDK documentation](https://app20.io/agent-sdk.md) · [Mainnet deployment](deployments/mainnet/private-settlement.json)

APP20 combines encrypted communication, permissionless market making and STRK20 shielded settlement. It uses a desktop-first interface. The favicon and application identity use **[20]**.

## Current status

APP20 requires confidential settlement for every new RFQ, Chat payment, invoice and offer. Public trade legs and one-sided swap acceptance are blocked. The new escrow is implemented for development; **confidential mainnet settlement and mainnet Chat are not available yet**. See [the settlement policy](docs/PRIVATE_SETTLEMENT_POLICY.md).

| Feature | Status |
| --- | --- |
| RFQ | `/rfq` presents the confidential flow; mainnet activation is disabled |
| Confidential escrow | Cairo contract, independent party approvals, encrypted outputs, timeout refunds and Node SDK implemented; local tests use simulated proofs |
| Chat payments and invoices | Localnet encrypted transfers from existing shielded notes, with an unfunded encrypted message operation |
| Chat swaps and invoice conversion | Blocked until confidential atomic settlement is supported; no one-sided payment fallback |
| Earlier mainnet maker/settlement contracts | Still deployed, with public funded terms; new registration, funding, quoting and settlement are disabled in this release |
| Historical recovery | Existing records, receipt reconciliation, expired reservation release, available inventory withdrawal and deactivation remain available |
| Agent library | Downloadable `@app20/agent-sdk`; not published to the npm registry |
| Privy wallet | Separate register/shield/transfer/unshield rail; configured credentials and real-wallet acceptance remain necessary |

Three swaps verified on September 7, 2026 used the earlier public-term protocol. One operator controlled maker and taker. Their receipts do not prove the new confidential flow.

## Privacy boundary

New payments must use encrypted notes. RFQs and Chat swaps require both sides to approve one confidential atomic exchange. The application cannot revoke existing mainnet contracts or erase earlier public settlement data.

Shielding/unshielding expose their own amounts and assets and remain separate wallet operations. Escrow activity, timing, deadlines, fees, ephemeral signer keys and ciphertext/proof sizes remain visible. Counterparties know their agreement. Historical maker recovery remains public under the old contracts.

### Proving payload exposure

The hosted path is `Browser or Node agent → APP20 Cloudflare Worker → Starkscan → STRK20 proving service`. TLS protects connections but APP20/Cloudflare and the proving operator can access proving payloads. This is HTTPS JSON, **not a verified OHTTP route**. Wallet signing and viewing-key secrets stay with the wallet; the proving witness can reveal transaction details.

The Worker does not log or persist proof request/response bodies. Separate relay tokens, caller-bound polling and request/concurrency limits protect access. Clients preserve completed proving results, including screening `additional_data`, before use. Preserve encrypted browser journals or owner-only Node journals: unknown delivery or submission outcomes remain fenced instead of starting another proof. RPC providers can observe discovery queries and timing.

## Use the app

- `/rfq` and `/rfq/confidential`: confidential availability and, in the dedicated local workspace, the development escrow flow.
- `/rfq/maker`: inspect and recover older maker inventory; new public registration and funding are blocked.
- `/agents`: current Node API, confidential development and historical recovery instructions.
- `/recovery/privy`: the separately configured wallet and recovery rail. Switching wallets does not move balances.
- `/chat`: localnet encrypted conversations and payments. Incoming messages refresh after unlocking and every 60 seconds while visible and online. Mainnet Chat is not deployed. Fixed offers may be discussed, but acceptance requiring a swap is blocked until the confidential wallet flow is available.

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
const { makers } = await app.listMakers(); // Historical registry, read-only.
```

Use `@app20/agent-sdk/confidential` for the development escrow. The old `prepareQuote`, `submitRequest`, `settle`, registration and public inventory-funding APIs reject new execution. `createPrivacyWallet` retains explicitly invoked registration, shield, encrypted transfer, unshield and reconciliation; its old public-term settlement executor is disabled.

The maker CLI retains `--check`, `--reconcile`, `--release`, `--withdraw` and `--deactivate` for existing positions. `--register`, `--fund` and `--run` are blocked. Preserve existing state and reconcile uncertain submissions before recovery. See [maker recovery](docs/makers/README.md) and [SDK details](packages/agent-sdk/README.md). Private keys, viewing material and journals must never be committed or shared in chat.

## Develop

```sh
npm ci
npm run dev
```

Production retains pinned deployment identities for wallet operations and historical recovery; it does not enable confidential settlement. Alice/Bob are development accounts only:

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

Mainnet activation is disabled pending real STARK proofs, independent wallet integration and review. Local contract executions use simulated proof facts. New execution through the earlier public-term RFQ path is blocked in the app and SDK. Chat payments also use encrypted transfers; Chat swaps remain blocked until the confidential wallet integration is ready. Escrow activity, timing and fees remain visible, and a hosted prover sees its witness.

## Hackathon demo

Three real mainnet swaps each exchanged **0.01 shielded STRK for 0.001 shielded USDC**. Successful receipts, `QuoteFilled` events, traces through APP20 and STRK20, and deployed class hashes were checked. The same operator controlled maker and taker; these are settlement smoke tests. The test maker is now inactive with no remaining inventory. See [mainnet evidence](deployments/mainnet/smoke-test-2026-09-07.json).

The three verified hashes are in `strk20.json`. Demo execution cost **35.863877034965690848 STRK** in network and pool fees; including the earlier deployment, fees total **63.910369825551435280 STRK**, below the 65 STRK ceiling. Another 0.5 STRK was exchanged for native USDC inventory, separately from fees.

See [demo status and submission checklist](docs/HACKATHON_DEMO.md) and [Remotion recording instructions](tools/demo-video/README.md). The prior 2:16 `app20-demo-v8-confidential.mp4` includes Liam narration from ElevenLabs, localnet Chat, the new local confidential escrow and refund flow, subtitles, a macOS window frame and maker/agent previews. Its Chat offer acceptance and maker onboarding scenes predate the private-only settlement policy and must be replaced before publication as the current product. Mainnet confidential activation remains pending. A public video URL is still required; `demo_video` remains empty.
