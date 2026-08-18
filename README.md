# APP20

A private superapp on Starknet: one shielded wallet, encrypted mail, and
review-only surfaces for cross-chain intents and verifiable workflows.

The first public origin is `https://app20.gstohl.com`. `app20.io` is reserved
and is not the current deploy target. Quietline remains the mail protocol name
only. Existing `quietline/*` storage keys, cryptographic domains, payment-link
formats, and contract identifiers stay unchanged for recovery.

This checkout is a local private app. It is not yet pushed, not yet deployed,
and not a live Mainnet release.

## What works now

| Surface | Route | State |
| --- | --- | --- |
| Vault | `/vault` | Ready Wallet Standard on Mainnet. Privy is Sepolia-only and disabled until public App ID + Client ID are set |
| Mail | `/mail/inbox` | Encrypted Quietline mail over STRK20. Ready only; no silent Privy fallback |
| Payment request | `/pay` | Unsigned `qlp2` links. No transaction until the payer confirms in Mail |
| Intents | `/intents` | Review-only. Dry 1Click schema only. No deposit, quote transport, or submit |
| Workflows | `/workflows` | Review-only. Advisory policy contract only. No TEE, no run |

Authorization policy, enforced below React:

- **Mainnet:** reviewed Ready/Argent Wallet Standard feature IDs only
- **Sepolia:** Ready, plus a separate Privy browser signer
- **Localnet:** build-gated development wallet only

## Honest privacy

APP20 can hide in-pool transfers and encrypt mail content. It cannot promise
unlinkability.

- Shield and unshield are public
- Mail ciphertext, size, timing, helper use, and recipient count are public
- The helper event omits sender/recipient addresses; RPC directory lookups do not
- The remote prover sees the decrypted witness after OHTTP decapsulation
- A NEAR Intents provider/solver would see route, amount, destination, and timing
- A TEE would see only inputs marked for that enclave, and only after attestation
- A replaced frontend can still request signatures and read browser-owned keys

## Local

Needs Node.js 24+. From `/Users/dominik/orca/projects/app20`:

```bash
npm install --ignore-scripts
cp .env.example .env.local   # public VITE_* placeholders only
npm run dev
```

Open `http://127.0.0.1:5173`.

Do not put RPC credentials, Privy App Secret, prover/discovery origins,
OHTTP session secrets, NEAR partner keys, or TEE keys in any `VITE_*` file.
Those values are Worker secrets, never browser build variables.

### Localnet mail demo

```bash
npm run pool:setup          # one-time pinned real-pool toolchain
npm run dev:localnet        # Alice/Bob, real pool, mock proofs
# http://127.0.0.1:5173
npm run localnet:stop
```

This is the real Cairo pool and the production mail action sequence, including
the fixed 7-base-unit helper funding withdrawal. It is not a real STARK proof
and not a Mainnet send.

## Packages

```text
@app20/domain              Canonical accounts, intents, lifecycle
@app20/near-intents        Dry-only NEAR 1Click connector
@app20/policy-client       Attestation + policy-receipt verification
@app20/privacy-adapters    Fail-closed Starknet wallet/network policy
@app20/privy               Browser-owned STRK20 / Privy integration
@app20/relay               Cloudflare assets, bootstrap, OHTTP, RPC, quotas
src/lib/mail*              Quietline mail compatibility (app-local)
cairo/                     QuietlineMail / QuietlineEscrow
```

See [`docs/APP20_ARCHITECTURE.md`](docs/APP20_ARCHITECTURE.md).

## Checks

```bash
npm run typecheck
npm run typecheck:packages
npm run test:all
npm run build                 # includes the browser-leak scan
npx wrangler deploy --dry-run --outdir /tmp/app20-worker-dryrun
```

| Command | What it is |
| --- | --- |
| `npm test` | App unit tests |
| `npm run test:packages` | Domain, Intents, policy, adapters, Privy, relay |
| `npm run test:ui` | Playwright localnet journeys |
| `npm run test:e2e:pool` | Real-pool mail harness |
| `snforge test` in `cairo/` | Helper contract tests |

## Deploy later

APP20 needs the Cloudflare Worker, not a static Pages site. The first custom
domain in `wrangler.jsonc` is `app20.gstohl.com`.

Public browser vars only:

```text
VITE_PRIVY_APP_ID
VITE_PRIVY_CLIENT_ID
VITE_PROVER_OHTTP_KEY_CONFIG
VITE_DISCOVERY_OHTTP_KEY_CONFIG
VITE_MAIL_HELPER_SEPOLIA
VITE_MAIL_HELPER_MAINNET
```

Worker secrets, never committed:

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

Do not deploy, push, or send Mainnet value until those secrets are set through
`wrangler secret put` and you explicitly approve the release.

## Not ready

- Live NEAR Intents quotes, deposits, or settlement
- Any attested TEE that can authorize value
- Filled `strk20.json` sprint artifacts
- GitHub remote rename (`gstohl/quietline` is still the origin)
- Cloudflare production deploy

## License

MIT
