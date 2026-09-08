# APP20 — private chat, payments and RFQs on Starknet

[App](https://app20.io) · [Agent guide](https://app20.io/agents) · [SDK documentation](packages/agent-sdk/README.md) · [Confidential RFQ guide](docs/CONFIDENTIAL_RFQ.md)

APP20 is a Starknet application for encrypted chat, shielded payments and confidential token swaps. Chat combines conversations with payments and invoices. The RFQ (request for quote) workspace demonstrates an exchange where both parties approve the terms and receive their assets together. STRK20 provides the privacy pool that holds balances as encrypted notes.

**Real-proof Chat and confidential settlement are verified on mainnet.** The Chat message decrypted correctly and preserved the private balance. The atomic swap delivered both agreed encrypted outputs, left the escrow empty and settled, and created no public trade transfers or OPEN outputs. These were controlled Node SDK runs; one operator controlled both wallets and funded both swap legs. Native Ready wallet acceptance remains unverified. See the [Chat evidence](deployments/mainnet/chat-message-2026-09-08.json) and [confidential settlement evidence](deployments/mainnet/confidential-settlement-2026-09-08.json).

## Current status

New payments must spend encrypted notes. Swaps require an atomic exchange approved by both parties. Unsupported operations stop before funding or signing; they cannot fall back to public settlement or a one-sided payment. See [the settlement policy](docs/PRIVATE_SETTLEMENT_POLICY.md).

| Feature | Status |
| --- | --- |
| RFQ | `/rfq` integrates the mainnet confidential flow and browser wallet adapter; native Ready acceptance remains unverified |
| Confidential escrow | Controlled real-proof mainnet settlement verified with exact encrypted outputs; timeout refunds verified locally |
| Chat messages | Mainnet operator message verified, decrypted and replay-protected; a private 1-base-unit self-transfer preserves the balance without helper funding |
| Chat payments and invoices | Encrypted transfer and memo path implemented; mainnet recipient-payment and browser wallet acceptance remain unverified |
| Chat swaps and invoice conversion | Blocked pending integration with the confidential RFQ flow; no one-sided payment fallback |
| Agent library | Confidential escrow integration and separate shielded-wallet operations; downloadable `@app20/agent-sdk`, not published to the npm registry |
| Mainnet proof tooling | Real hosted Chat and confidential settlement proofs accepted on mainnet; receipts, traces and encrypted discovery verified |
| Privy wallet | Separate register/shield/transfer/unshield rail; configured credentials and real-wallet acceptance remain necessary |

The browser integration includes wallet signing, encrypted quote rooms and durable recovery. Its native Ready extension journey still needs an unlocked-wallet end-to-end run. The local lab controls two disposable wallets; the verified mainnet run also used one operator. Neither run establishes independent market liquidity or an independent security review.

## Current contracts and flow

### Confidential swaps

[`App20ConfidentialEscrow`](cairo/src/confidential_escrow.cairo) is a dedicated policy account for one two-party trade:

1. Agree on assets, exact amounts, recipients and a deadline. The public constructor stores a commitment to the terms, two distinct public signing keys, the deadline and pinned pool identity.
2. Both parties approve setup. Each funds the escrow separately from its own shielded balance, using viewing material created only for this escrow.
3. Both approve the exact exchange. The contract permits both agreed outputs together as encrypted notes, returning any surplus only to the original owner of that asset. Public deposits, withdrawals, OPEN outputs and unrelated calls are rejected by its action policy.
4. After expiry, either party can authorize a fresh encrypted refund of its original asset without the other party's signature. Funding is not atomic: the first funder may have to wait until expiry if the peer stops participating.

The pool callback checks the actual execution deadline and prevents a second settlement. The SDK checks deployed identities, prepares operations, collects approvals and journals uncertain submissions. The controlled mainnet settlement additionally passed receipt, trace and encrypted-output verification; mainnet refunds and native wallet acceptance are separate, unverified paths. See [protocol and recovery details](docs/CONFIDENTIAL_RFQ.md).

### Chat and payments

[`App20Chat`](cairo/src/lib.cairo) registers chat public keys and emits encrypted message records. Its protected callback accepts only the configured privacy pool, binds the message payload to the computation and rejects replayed actions. Encryption and decryption happen in the clients.

The current app sends messages through an unfunded, proof-bound helper operation. A payment adds an encrypted transfer from existing shielded notes to the same batch; the helper does not settle swaps. Same-token invoices use that payment path. Plain messages include a private transfer of 1 base unit of STRK back to the sender to provide pool replay protection. An existing shielded STRK note is required; its balance is preserved. Pool and network fees still apply. Chat offer acceptance and invoice conversion remain blocked.

## Privacy boundary

Message content is encrypted for its recipients. Confidential escrow amounts, assets and destinations are private proof inputs; counterparties still know their agreement.

Shielding/unshielding expose their own amounts and assets and remain separate wallet operations. Escrow activity, timing, deadlines, fees, ephemeral signer keys and ciphertext/proof sizes remain visible. Deploying an escrow from a personal wallet can expose that wallet’s link to the escrow. Counterparties know their agreement. Historical maker recovery remains public under the old contracts.

### Proving payload exposure

The hosted path is `Browser or Node agent → APP20 Cloudflare Worker → Starkscan → STRK20 proving service`. TLS protects connections but APP20/Cloudflare and the proving operator can access proving payloads. This is HTTPS JSON, **not a verified OHTTP route**. The hosted prover receives the private witness; keeping signing keys local does not hide transaction details or escrow viewing material included in that witness.

The Worker does not log or persist proof request/response bodies. Separate relay tokens, caller-bound polling and request/concurrency limits protect access. Preserve wallet recovery state and operation journals across restarts; investigate unknown proof or transaction outcomes before retrying. RPC providers can observe discovery queries and timing.

## Use the app

- `/rfq`: one confidential swap workspace, with network availability shown before any signing.
- `/agents`: Node SDK, confidential RFQ integration and current network support.
- `/recovery/privy`: the separately configured wallet and recovery rail. Switching wallets does not move balances.
- `/chat`: encrypted conversations and payments, with the deployed mainnet helper configured. Incoming messages refresh after unlocking and every 60 seconds while visible and online. The operator mainnet message is verified; Ready wallet acceptance remains unverified. Fixed offers may be discussed, but acceptance requiring a swap is blocked.

## Node.js library

Node 24+ and ESM:

```sh
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.tgz
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.sha256
shasum -a 256 -c app20-agent-sdk-0.1.0.sha256
npm install ./app20-agent-sdk-0.1.0.tgz
```

```js
import { confidentialCapabilities } from '@app20/agent-sdk/confidential';

// Check support before asking a wallet to sign.
console.log(confidentialCapabilities.mainnetEnabled);
```

Use `@app20/agent-sdk/confidential` to construct agreements, inspect escrow funding, collect approvals, settle and recover expired funding. `createConfidentialClient` supports the pinned mainnet deployment, where controlled real-proof atomic settlement is verified. Native browser wallet acceptance and mainnet refunds remain unverified. The current source also includes `createConfidentialProofClient`, which prepares and proves operations without exposing funding or transaction submission. Build it from the checkout using [the mainnet proof rehearsal guide](docs/CONFIDENTIAL_RFQ_MAINNET_PROOF.md).

`createPrivacyWallet` provides separately invoked registration, shielding, encrypted transfers, unshielding and reconciliation. There is no `sendChat` SDK API yet. See [SDK details and adapter examples](packages/agent-sdk/README.md). Preserve journals and secure wallet material across restarts; an unknown submission outcome must be reconciled before retrying.

## Develop

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

Build generates browser assets, the installable SDK archive and checksums, TypeScript checks and browser-secret scans. The local integration and browser tests use disposable wallets and simulated proofs. A mainnet acceptance claim additionally requires a real accepted proof, successful receipts and verified encrypted outputs. [Detailed validation guide](docs/CONFIDENTIAL_RFQ.md#reproduce-validation).

With the Worker configured, deploy the built app using `npx wrangler deploy`. A frontend deployment alone does not prove chain execution; the current mainnet contract pins, enabled clients and separately recorded operation evidence define the supported scope.

The Worker serves the app and RPC/prover routes. Its API keys are not embedded in browser or SDK downloads. The provider determines proving throughput; a Worker forwards jobs and does not generate STARK proofs itself.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app/rfq/ConfidentialRfqPage.tsx` | Current RFQ screen and local lab entry |
| `src/app/chat`, `src/components/chat` | Conversations, encrypted messages, payments and invoices |
| `packages/agent-sdk` | Installable Node library and persistent wallet/proof integration |
| `packages/privy` | Privy signing, privacy wallet operations, discovery and proof providers |
| `workers/relay` | Authenticated RPC/proving relays and atomic quotas |
| `cairo/src/confidential_escrow.cairo` | Jointly approved confidential swap and timeout-refund policy |
| `cairo/src/lib.cairo` | Chat key registration and encrypted message helper |
| `pool-harness/src/confidential-lab.mjs` | Disposable wallets and local escrow execution through the SDK |
| `pool-harness/tests` | Privacy-pool integration and contract regression tests |
| `scripts/confidential-mainnet-proof.mjs` | Mainnet preflight and proof rehearsal without transaction submission |

## Existing positions and historical evidence

Earlier deployed contracts remain available for explicit recovery; new trading through their public-term protocol is disabled in current clients. Existing positions can be inspected and reconciled through the [historical recovery tools](docs/makers/README.md). Earlier maker-page bookmarks redirect to `/rfq`.

The first three `strk20.json` hashes are September 7 mainnet swaps belonging to that earlier protocol, with one operator controlling both sides. They do not prove the current confidential escrow; its separate [September 8 accepted settlement and encrypted-output evidence](deployments/mainnet/confidential-settlement-2026-09-08.json) does. Historical receipts, costs and recording status are kept in the [mainnet runbook](docs/MAINNET_RUNBOOK.md) and [demo notes](docs/HACKATHON_DEMO.md).

The local submission manifest also includes the verified September 8 Chat message and confidential settlement as post-deadline evidence. The original three hashes, four contracts and deadline video URL are preserved. These additions do not claim that the hackathon panel rescored the submission; GitHub/main and the published deadline release are unchanged.
