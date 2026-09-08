# APP20 — confidential RFQs and encrypted Chat on Starknet

**Conversations. Clear terms. Private settlement.**

[Open the app](https://app20.io) · [Watch the 63-second demo](https://github.com/gstohl/app20/releases/download/fixed-2026-09-08/app20-mainnet-social-2026-09-08.mp4) · [Submission manifest](strk20.json) · [SDK guide](packages/agent-sdk/README.md)

APP20 is a private RFQ desk and encrypted Chat app built on STRK20. Request quotes from selected makers, review your minimum return, and exchange shielded assets through a jointly approved escrow. Chat keeps the conversation encrypted alongside payments and invoices.

[![APP20 reviewing a live encrypted maker quote](https://github.com/gstohl/app20/releases/download/fixed-2026-09-08/app20-mainnet-social-2026-09-08-preview.png)](https://github.com/gstohl/app20/releases/download/fixed-2026-09-08/app20-mainnet-social-2026-09-08.mp4)

## Hackathon review — `fixed` branch

This branch contains the post-deadline privacy fixes, verified mainnet Chat and confidential settlement, and the refreshed demo. It is submitted for the organizers to consider separately from the [deadline release](https://github.com/gstohl/app20/releases/tag/mainnet-hackathon-2026-09-08) and the original `main` branch.

| Review | Link / scope |
| --- | --- |
| Live application | [app20.io](https://app20.io) — one RFQ workspace, Chat and agent integration |
| Current demo | [63-second narrated video](https://github.com/gstohl/app20/releases/download/fixed-2026-09-08/app20-mainnet-social-2026-09-08.mp4) · [English captions](https://github.com/gstohl/app20/releases/download/fixed-2026-09-08/app20-mainnet-social-2026-09-08.srt) |
| Release | [Fixed-branch release and downloads](https://github.com/gstohl/app20/releases/tag/fixed-2026-09-08) |
| Scoring metadata | Root [`strk20.json`](strk20.json): five mainnet hashes, four project contracts, video and app URL |
| Mainnet evidence | [Confidential settlement](deployments/mainnet/confidential-settlement-2026-09-08.json) · [Chat message](deployments/mainnet/chat-message-2026-09-08.json) |

The video shows a genuine encrypted maker quote, an actual mainnet message decrypted in a watch-only source preview, and the current SDK page. It stops before wallet signing. Its source labels remain visible; it does not claim a native Ready wallet settlement demonstration.

## What APP20 does

- **Confidential RFQ:** encrypted requests and replies between a taker and chosen makers, explicit minimum receive, and separate approval of the agreed trade.
- **Atomic private settlement:** a Cairo escrow requires both parties' approval and delivers both agreed assets as encrypted STRK20 notes in one settlement.
- **Encrypted Chat:** recipient-encrypted messages, shielded payments and same-token invoices. Incoming messages refresh automatically after unlocking.
- **Independent makers and agents:** a Node SDK and maker runner with separate signing policies, inventory limits, fee budgets and persistent recovery journals.

The private-only policy rejects public trade legs, OPEN settlement notes and one-sided swap acceptance. Unsupported confidential operations stop before submission. [Settlement policy](docs/PRIVATE_SETTLEMENT_POLICY.md).

## Verified on Starknet mainnet

| Operation | Successful transaction | Verified result |
| --- | --- | --- |
| Confidential swap | [0x59435ee6…](https://starkscan.co/tx/0x59435ee65a7f42ed41b329c2df8bb9be7cf5fdfe69ddfd8cb2d08230412696) | Both agreed encrypted outputs arrived; escrow empty and settled; no public trade value actions or new OPEN outputs |
| Encrypted Chat message | [0x382800b8…](https://starkscan.co/tx/0x382800b805219f0c8639459c353976618ae38fdb6468dd28f1e71ecec7bcf62) | Message decrypted, replay protection consumed, private STRK balance preserved |
| Historical swap 1 | [0x1e364ca1…](https://starkscan.co/tx/0x1e364ca1c778fd304fae9506dabade0f2c958e0e867465db9a7ceb0f13af36d) | Earlier protocol with public funded terms |
| Historical swap 2 | [0x30f926d2…](https://starkscan.co/tx/0x30f926d2eddc5361ff96b0c3c5f173d87fef227fb87d1055899f32daf221c7e) | Earlier protocol with public funded terms |
| Historical swap 3 | [0x6905abc5…](https://starkscan.co/tx/0x6905abc575ffb6532b566695c86194d15dfe6e26afd8ab9b47f9e4bb749a171) | Earlier protocol with public funded terms |

A read-only recheck on September 8 verified all five receipts, pool/project execution traces and receipt-block class hashes. All four project contracts also matched their pins at mainnet block 14532003. Encrypted note discovery also verified the new settlement outputs. These were controlled SDK runs: one operator controlled both wallets and funded both swap legs. The Chat proof was a self-message. The three historical swaps remain separately labelled and do not prove the newer confidential protocol.

| Mainnet contract | Address / source |
| --- | --- |
| Chat helper | [0x50133139…](https://starkscan.co/contract/0x501331396a00e95a4b520502ff73155412e056bd42bc41cb115deb656d97ae4) · [Cairo](cairo/src/lib.cairo) |
| Verified confidential escrow instance | [0x11b28bb2…](https://starkscan.co/contract/0x11b28bb270f1c9c7eefd1205cfba6c1a686436fcb5f5c3281d5a0a77011438f) · [Cairo](cairo/src/confidential_escrow.cairo) |
| Historical maker book | [0x9df86f7e…](https://starkscan.co/contract/0x9df86f7e74cf096c3788a5bf2c51945de50a13602a4383b93bbd64f39fe051) · [Deployment record](deployments/mainnet/private-settlement.json) |
| Historical public-term swap | [0x1bc94493…](https://starkscan.co/contract/0x1bc94493f67039bd0138101eb7a9be600496e9c63d26e331799881f9041d642) · [Deployment record](deployments/mainnet/private-settlement.json) |

Full addresses, historical contracts and chain/class pins are in [`strk20.json`](strk20.json), the [deployment manifest](public/.well-known/app20.json) and [mainnet runbook](docs/MAINNET_RUNBOOK.md). A new swap uses its own escrow instance.

Recheck the five submission transactions without signing or broadcasting, after installing the project dependencies:

```sh
node scripts/verify-hackathon-transactions.mjs --rpc https://starknet-rpc.publicnode.com
```

## How a confidential RFQ settles

1. **Request and compare.** The taker encrypts the request for selected makers. A maker returns the price, expiry and agreement through the encrypted room.
2. **Approve and fund.** Each party holds an independent signing key. Both approve the setup; each separately funds the escrow from shielded notes. The public constructor contains a commitment to the private terms.
3. **Settle together.** Both approve the exact operation. A real STRK20 proof delivers the agreed encrypted outputs atomically, and the escrow callback prevents a second settlement.
4. **Recover after expiry.** Either party can authorize an encrypted refund of its original asset without the other's signature. This path is verified locally; mainnet refunds remain unverified. Funding is separate, so the first funder may need to wait until the deadline.

The React/TypeScript frontend uses encrypted quote rooms on Cloudflare Durable Objects. The Cairo policy account enforces settlement rules through the STRK20 pool. Browser and Node clients share the confidential SDK; the hosted proof route runs through the APP20 Worker and Starkscan. [Architecture](docs/APP20_ARCHITECTURE.md) · [Protocol and recovery](docs/CONFIDENTIAL_RFQ.md).

## Privacy boundary and current limits

Quote contents are encrypted for the trading parties. Chat content is encrypted for its recipients. Confidential swap assets, amounts and destinations are private proof inputs, and settlement creates encrypted notes.

Escrow deployment/activity, timing, deadlines, fees, public signing keys and ciphertext/proof sizes remain visible. A personal wallet's deployment can link it to the escrow. Shielding and unshielding expose their own public amounts and assets. Counterparties know the trade terms, and the hosted APP20/Cloudflare and Starkscan/proving infrastructure can access the private witness. The current proving transport is HTTPS JSON; it does not establish anonymous or OHTTP proving.

| Capability | Current scope |
| --- | --- |
| Mainnet confidential settlement and Chat message | Verified through the controlled SDK runs above |
| Browser RFQ | Wallet adapter and encrypted quote flow implemented; live encrypted quote capture passed; native Ready end-to-end acceptance unverified |
| Timeout refunds | Contract/SDK flow verified locally; mainnet acceptance unverified |
| Chat payments and same-token invoices | Encrypted transfer/memo path implemented; mainnet recipient-payment acceptance unverified |
| Chat swaps and invoice conversion | Blocked pending confidential atomic wallet integration; no one-sided payment fallback |
| Independent security review | Not completed |

Maker availability depends on independently running processes. The recorded maker ran locally with bounded exposure; Cloudflare does not host its signing keys or guarantee liquidity. Prior deployed contracts and transactions remain public; current clients block new trading through the old public-term protocol. [Historical recovery](docs/makers/README.md) · [Known gaps](docs/GAPS.md).

## Run locally or integrate

Use Node.js 24+ and npm:

```sh
npm ci
npm run build:packages
npm run dev
```

For a disposable end-to-end swap/refund lab, run `npm run pool:setup` then `npm run dev:confidential` and open `http://127.0.0.1:5198/rfq`. It controls two development wallets and simulates proving. Chat has a separate `npm run dev:localnet` environment. [Full development, relay configuration and deployment guide](docs/DEVELOPMENT.md).

The Node SDK is downloadable as an npm-installable archive; it is not published to the npm registry:

```sh
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.tgz
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.sha256
shasum -a 256 -c app20-agent-sdk-0.1.0.sha256
npm install ./app20-agent-sdk-0.1.0.tgz
```

Use `@app20/agent-sdk/confidential` to prepare agreements, inspect funding, collect approvals, settle and recover. `createPrivacyWallet` provides separate register/shield/transfer/unshield operations; there is no `sendChat` SDK API yet. [SDK and adapter examples](packages/agent-sdk/README.md) · [Run a maker](public/agents.md#run-a-confidential-maker-from-the-source-checkout).

## Validation

The September 8 release passed the production build, 1,046 source tests, relay and SDK tests, 93 evidence/maker tests, live encrypted quote capture, and desktop/mobile deployment checks. The 63-second video decoded cleanly and all six complete narration endings matched their source audio. Controlled mainnet acceptance is recorded separately above.

```sh
npm run test:all
npm run build
```

For contract and browser integration checks, see [reproduce validation](docs/CONFIDENTIAL_RFQ.md#reproduce-validation). All `artifacts/` media, recordings and temporary output remain gitignored; published video assets live in the release. Wallet keys, viewing keys and private journals stay outside the repository.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app/rfq`, `src/lib/confidential-*` | Single RFQ screen, wallet adapter and durable trading flow |
| `src/app/chat`, `src/components/chat` | Encrypted conversations, payments and invoices |
| `cairo/src` | Chat helper and confidential escrow contracts |
| `packages/agent-sdk` | Shared Node/browser confidential protocol and journals |
| `workers/relay` | Authenticated RPC/prover routes and encrypted quote rooms |
| `scripts/confidential-maker*.mjs` | Independent maker, wallet adapter and protected journals |
| `deployments/mainnet` | Sanitized transaction evidence and deployment records |
| `tools/demo-video` | Reproducible capture, narration and rendering tools |
