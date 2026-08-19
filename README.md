# APP20

Private superapp on Starknet.

Four features, in product order:

1. **Vault** — shielded STRK wallet
2. **Intents** — cross-chain review desk
3. **Workflows** — advisory policy desk
4. **Mailbox** — encrypted Mail

Users connect once in the header. Viewing keys and mailbox keys stay on the
device. The STRK20 pool is reached through the official Starknet privacy path.

Repository: [github.com/gstohl/app20](https://github.com/gstohl/app20)

The first intended public host is `app20.gstohl.com`. That origin is not live
yet. This is not a Mainnet value-moving release.

## Product

| Rank | Feature | Route | Status |
| --- | --- | --- | --- |
| 1 | Vault | `/vault` | Primary wallet. Mainnet is Ready Wallet Standard only. Privy is Sepolia-only and stays off until public App ID and Client ID are set |
| 2 | Intents | `/intents` | Review-only dry 1Click quotes. No deposit address, no submit |
| 3 | Workflows | `/workflows` | Review-only advisory policy receipts. No TEE, no execution |
| 4 | Mailbox | `/mail/inbox` | APP20 Mail. Encrypted letters, private STRK memos, invoices, and one-sided deals. Ready only |

`/pay` is a Mail helper, not a fifth product. It only creates an unsigned
payment-request link. Nothing is sent until the payer confirms in Mail.

### Vault and Intents

They can share one **value desk** later. They should not become one form.

Vault is in-pool Starknet privacy (shield, private transfer, unshield). Intents
is a public cross-chain quote against NEAR 1Click. Different chains, signers,
disclosure, and failure modes. A combined page is fine as two rails on the
same estate, with the header session unchanged. Merging them into a single
submit path would hide that Intents settlement is public and that there is no
Intents testnet.

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
| Mail plaintext | Ciphertext, size, timing, helper use, recipient count |
| Sender and recipient addresses in `MessagePosted` | Directory lookups at the configured RPC |
| OHTTP ciphertext on the relay | The final prover after decapsulation |

A replaced frontend can still request signatures and read browser-owned keys.
Cross-chain amounts, assets, destinations, and timing remain correlatable.

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

This deploys the real Cairo pool and the production mail action sequence,
including the fixed 7-base-unit helper funding withdrawal. Proofs are simulated.
It is not a Mainnet send.

## Packages

| Package | Role |
| --- | --- |
| `@app20/domain` | Accounts, canonical intents, lifecycle |
| `@app20/near-intents` | Dry-only NEAR 1Click connector |
| `@app20/policy-client` | Attestation and policy-receipt verification |
| `@app20/privacy-adapters` | Fail-closed Starknet wallet and network policy |
| `@app20/privy` | Browser-owned STRK20 and Privy integration |
| `@app20/relay` | Cloudflare assets, bootstrap, OHTTP, RPC, quotas |

Architecture: [`docs/APP20_ARCHITECTURE.md`](docs/APP20_ARCHITECTURE.md).

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
