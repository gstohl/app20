# APP20

Professional private RFQ trading desk on Starknet.

Three surfaces form one workflow:

1. **Desk** — inventory-backed private USDC↔STRK RFQs and shielded funding
2. **Mailbox** — encrypted deal correspondence, structured evidence, and contact recovery
3. **Counterparties** — a device-encrypted directory with RFQ and Mail handoffs

Users connect once in the header. Viewing keys and mailbox keys stay on the
device. The STRK20 pool is reached through the official Starknet privacy path.
Workflows, dry cross-chain review, and payment links remain secondary tools,
not separate claims in the judged trading flow.

Repository: [github.com/gstohl/app20](https://github.com/gstohl/app20)

The first intended public host is `app20.gstohl.com`. That origin is not live
yet. This is not a Mainnet value-moving release.

## Product

| Rank | Feature | Route | Status |
| --- | --- | --- | --- |
| 1 | Private Desk | `/vault` | Localnet proves inventory-backed USDC↔STRK quote, lock, solver fill, claim, expiry refund, and insufficient-inventory refusal. Funding remains a distinct STRK20 rail. No production solver is deployed |
| 2 | Mailbox | `/mail/inbox` | On-chain ciphertext for letters, legacy OTC documents, receipts, and authenticated self-addressed contact snapshots. Mail is correspondence/evidence, never settlement authority |
| 3 | Counterparties | `/contacts` | Device-encrypted labels and addresses with RFQ/Mail deep links. Optional recovery needs the same wallet plus the mailbox recovery phrase |
| 4 | Secondary tools | `/vault#intents`, `/workflows`, `/pay` | Dry cross-chain review, advisory workflows, and unsigned payment links. No live 1Click submission or TEE execution |

`/pay` is a Mail helper, not a fifth product. It only creates an unsigned
payment-request link. Nothing is sent until the payer confirms in Mail.

### Desk, Mailbox, and Counterparties

The RFQ is authoritative only when Cairo and the pool confirm its lifecycle.
Mailbox letters can carry coordination and evidence but cannot prove a fill.
Counterparty labels remain local unless the user explicitly posts an encrypted
self-backup through Mail.

The same wallet opens all three surfaces. A Counterparty can start a prefilled
RFQ or encrypted letter; a settled local RFQ produces a lifecycle receipt and
links back to Mailbox. Shield, private transfer, and unshield remain separate
funding actions under **Balances & funding**.

Dry cross-chain Intents still share `/vault`, but remain a public review rail
against NEAR 1Click. They have different signers, disclosure, and failure modes
and are never merged into the private RFQ submit path.

Wallet policy is enforced below the UI:

- **Mainnet** — reviewed Ready / Argent Wallet Standard feature IDs only
- **Sepolia** — Ready, plus an optional Privy browser signer
- **Localnet** — build-gated development wallet

In the product, mail is **Mailbox** / **Mail**. Compatibility identifiers
(`QuietlineMail`, `quietline/*` storage, payment-link domains) stay unchanged
so existing backups and on-chain registrations keep working.

## Privacy

APP20 can hide in-pool transfers and encrypt mail. It cannot promise
unlinkability.

| Hidden | Public |
| --- | --- |
| In-pool sender, recipient, and amount | Shield and unshield |
| Mail plaintext and self-backed contact labels | Ciphertext, size, timing, helper use, recipient count, backup frequency |
| Device-local contact labels and notes | Addresses when publicly used; code running in an unlocked browser profile can read them |
| Sender and recipient addresses in `MessagePosted` | Directory lookups at the configured RPC |
| Private note ownership in the RFQ | Prototype escrow pair, amounts, deadline, OPEN-note amount, and helper activity |
| OHTTP ciphertext on the relay | The final prover after decapsulation |

A replaced frontend can still request signatures and read browser-owned keys.
Ready signatures are not used as encryption keys and the dapp never requests a
STRK20 viewing key. Wallet connection identifies the mailbox but cannot decrypt
Mail or contact snapshots by itself: recovery also requires the mailbox backup
phrase. Old on-chain ciphertext cannot be deleted. Cross-chain amounts, assets,
destinations, and timing remain correlatable.

## Develop

Requires Node.js 24+. From the repository root:

```bash
npm install --ignore-scripts
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5173`.

Every `VITE_*` value is public. Do not put RPC credentials, Privy App Secret,
prover or discovery origins, OHTTP session secrets, or partner keys in browser
env files. Those belong in Worker secrets after deploy.

This repository does not contain testnet or mainnet prover, discovery, or RPC
origins. Browser code only sees public metadata and non-routable `.invalid`
OHTTP names.

### Localnet

```bash
npm run pool:setup
npm run dev:localnet
npm run localnet:stop
```

This deploys the real Cairo pool, a six-decimal local USDC fixture, and the
production mail action sequence, including the fixed 7-base-unit helper funding
withdrawal. It also proves both directions of the private USDC↔STRK RFQ market:
lock, inventory-first solver fill, claim, expiry refund, and insufficient-
inventory refusal. The browser journey also proves Counterparty → RFQ handoff
and contact snapshot → encrypted self-mail → explicit merge restore. The price
is a deterministic fixture and proofs are simulated. It is not a Mainnet market
or send.

## Packages

| Package | Role |
| --- | --- |
| `@app20/domain` | Accounts, canonical intents, lifecycle |
| `@app20/near-intents` | Dry-only NEAR 1Click connector |
| `@app20/policy-client` | Attestation and policy-receipt verification |
| `@app20/privacy-adapters` | Fail-closed Starknet wallet and network policy |
| `@app20/private-intents` | Intent, solver quote, fill-or-refund, restock netting |
| `@app20/privy` | Browser-owned STRK20 and Privy integration |
| `@app20/relay` | Cloudflare assets, bootstrap, OHTTP, RPC, quotas |

Architecture: [`docs/APP20_ARCHITECTURE.md`](docs/APP20_ARCHITECTURE.md).
Private Desk and contact-recovery model:
[`docs/APP20_PRIVATE_DESK.md`](docs/APP20_PRIVATE_DESK.md).
Value flows and the gated future SOL/Wormhole→StarkGate market:
[`docs/APP20_SWAP_FLOWS.md`](docs/APP20_SWAP_FLOWS.md).

## Checks

```bash
npm run typecheck
npm run typecheck:packages
npm run test:all
npm run build
```

| Command | Scope |
| --- | --- |
| `npm test` | Application unit tests |
| `npm run test:packages` | Workspace packages |
| `npm run test:ui` | Playwright localnet journeys |
| `npm run test:e2e:pool` | Real-pool mail harness |
| `snforge test` | Mail helper contracts, from `cairo/` |

`npm run build` includes a browser-leak scan.

## Deployment

APP20 deploys as a Cloudflare Worker with assets, not a static Pages site.
`wrangler.jsonc` names `app20.gstohl.com`. Do not deploy until Worker secrets
are set with `wrangler secret put`.

Public browser variables:

```text
VITE_PRIVY_APP_ID
VITE_PRIVY_CLIENT_ID
VITE_PROVER_OHTTP_KEY_CONFIG
VITE_DISCOVERY_OHTTP_KEY_CONFIG
VITE_MAIL_HELPER_SEPOLIA
VITE_MAIL_HELPER_MAINNET
```

Worker secrets:

```text
PRIVY_APP_SECRET
OHTTP_SESSION_SECRET
PROVER_UPSTREAM_URL
PROVER_UPSTREAM_AUTHORIZATION
DISCOVERY_UPSTREAM_URL
DISCOVERY_UPSTREAM_AUTHORIZATION
STARKNET_SEPOLIA_RPC_URL
STARKNET_SEPOLIA_AUTHORIZATION
STARKNET_MAINNET_RPC_URL
STARKNET_MAINNET_AUTHORIZATION
```

## Not in this release

- Live NEAR Intents quotes, deposits, or settlement
- An attested TEE that can authorize value
- Completed `strk20.json` sprint artifacts
- A production Cloudflare deployment

## License

MIT
