# Quietline

Encrypted on-chain mail on Starknet.

Addresses never appear on the message. Content decrypts only on the
recipient's device. A private transfer can carry a memo in the same
transaction — remittance with a note, on a public chain.

Built for the [STRK20 Private Sprint](https://github.com/starkience/strk20-hackathon)
against the live mainnet pool. Inspired by
[RFP-01](https://strk20.starknet.io/rfp/private-messaging).

This repository was started as Feltproof (private poker) and pivoted to
Quietline early on day one; the repo now lives at `gstohl/quietline`.

## What we are shipping

One complete private-mail loop on Starknet mainnet:

1. Two Ready wallets register in the pool (wallet does this on first use).
2. Alice sends Bob an encrypted message through a `privacy_invoke` helper.
3. Bob discovers and decrypts it locally. No server holds plaintext.
4. Optionally, Alice attaches the memo to a private STRK transfer in the same tx.
5. Observer sees that *a* pool transaction happened, and when. Not who, not what.

## Hidden vs visible

| Element | Hidden | Visible |
| --- | --- | --- |
| Sender identity | Yes — pool is `msg.sender` | |
| Recipient identity | Yes — only via the recipient's viewing key | |
| Message content | Yes — encrypted to the channel key | |
| That a message was sent | Partially | Block timestamp, that a pool tx occurred |
| Payment amount (if attached) | Yes, inside the pool | Shield / unshield legs stay public |

## Stack

Vite + React 19 + TanStack Router, shipped as a client-only SPA (no SSR), with
TypeScript, zustand, starknet.js 10.4.0, the Wallet API, and a
`privacy_invoke` helper. The dapp never touches a viewing key. Ready wallet.
Alchemy RPC configuration lives in an env var and is never committed.

The SPA architecture is intentional: Quietline has no server routes, while its
wallet connection and browser cryptography require browser APIs.

## Sprint artifacts

Scoring reads this repository every 30 minutes. Fill in `strk20.json` as they exist:

- `transactions` — three successful mainnet hashes that touched the STRK20 pool
- `contracts` — deployed helper addresses
- `demo_video` — a 3-minute walkthrough of send + discover + optional memo
- `demo_url` — the deployed demo URL

Once deployed, set the repository **Website** field to the Cloudflare URL and
add that same URL to `strk20.json` as `demo_url` so sprint demo detection can
find it. `strk20.json` is intentionally unchanged by the framework migration.

## Status

Phase 1 wallet plumbing is in: connect Ready, detect Wallet API/spec ≥ 0.10,
and request shield / private transfer / unshield / balance actions. Phase 2 is
code-complete locally: encrypted-mail primitives, the `QuietlineMail` helper,
the inbox UI, and a deterministic mock-pool devnet test. No Sepolia or mainnet
helper is configured by default, so the inbox honestly disables sending until a
network-specific helper address is supplied. This is not a gambling product.

## Local development and testing

Install JavaScript dependencies, copy the key-only env template, and start
Vite from the repository root:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill in `.env.local` without committing it. Every `VITE_*` value is bundled
into the browser and must be treated as public. Cairo commands run from the
`cairo/` directory; all other commands run from the repository root.

| Command | Directory | What it checks |
| --- | --- | --- |
| `npm run dev` | root | Starts the Vite development server |
| `npm run build` | root | Type-checks and emits the production SPA to `dist/` |
| `npm run preview` | root | Serves the production build locally |
| `npm test` | root | Mail crypto, felt packing, view-tag scanning, and STRK20 mail-action assembly |
| `npm run devnet` | root | Starts the Docker Starknet Devnet used by the local integration test |
| `npm run test:e2e` | root | Builds and deploys the helper, registers a key, posts mail, scans/decrypts, rejects a wrong key, and exercises dust echo against the mock pool caller |
| `npm run pool:setup` | root | One-time pinned vendor/toolchain build for the isolated real-pool harness (Node >=24) |
| `npm run test:e2e:pool` | root | Deploys the real `privacy_Privacy` pool, then runs register → deposit/private transfer → discover → withdraw |
| `scarb build` | `cairo/` | Compiles the Cairo helper and mock ERC-20 |
| `snforge test` | `cairo/` | Runs helper authorization, ciphertext-cap, caller-isolated directory, event, zero-balance, and dust tests |

Use `npm run devnet:stop` when finished. The default Devnet 0.9.2 image is
pinned as `docker.io/shardlabs/starknet-devnet-rs@sha256:2733f463816b4028a77e33cea2f55fbbdeb36dcacb4331d886d921361bd07bcf`,
and the container port is published on `127.0.0.1` only.

`npm run pool:setup` clones the recon-pinned upstream RC into ignored `vendor/`,
installs Scarb 2.17.0 and Universal Sierra Compiler 2.8.0 there without changing
the Scarb used by `cairo/`, builds the vendored SDK, and downloads native
Starknet Devnet 0.8.0-rc.3. The separate `pool-harness/` package keeps the main
`npm ci` independent of that optional build.

**Mock-pool caveat:** `npm run test:e2e` exercises a **MOCK pool caller only**.
It does not run the real STRK20 pool, Ready, SNIP-36 proving, wallet placeholder
resolution, or private note discovery.

**Real-pool caveat:** `npm run test:e2e:pool` exercises the **real pool + real
direct contract discovery + upstream's SIMULATED proof**. Devnet cannot serve
`starknet_getStorageProof`, so real STARK proving needs hosted proving services
and a storage-proof-capable node such as Pathfinder. Deposit screening uses the
canonical public test key `0xCAFEBABE`, which is test-only material. This tier
still does not exercise Ready or close the intentionally configured
Sepolia/manual validation gap. Neither local tier claims a Sepolia/mainnet send.

```bash
npm run typecheck
npm run build
```

## Cloudflare deployment

The Vite build emits `dist/`. `public/_redirects` is copied into that directory
for Cloudflare Pages, and `wrangler.jsonc` configures the Workers static-assets
SPA fallback. Both deployment paths therefore serve the app HTML for a direct
`/inbox` request.

### Cloudflare dashboard (Pages)

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect
   to Git**, then select this repository.
2. Use production branch `main`, build command `npm run build`, and build output
   directory `dist` (repository root `/`).
3. Add `VITE_PROVIDER_URL`, `VITE_MAIL_HELPER_SEPOLIA`, and
   `VITE_MAIL_HELPER_MAINNET` under **Settings → Environment variables**. These
   are public build-time values; enter only the Alchemy key for
   `VITE_PROVIDER_URL`, as shown in `.env.example`.
4. Deploy, then verify both the deployment root and `/inbox` load directly.

### Wrangler (Workers static assets)

From a trusted local checkout with `.env.local` configured:

```bash
npm ci
npx wrangler login
npm run deploy:cf
```

`npx wrangler login` runs the installed `wrangler login` command. The deploy
script rebuilds `dist/` and then runs `wrangler deploy`; it does not need or
create a server entry point. Do not commit `.env.local` or `dist/`.

After either path succeeds, set the GitHub repository **Website** field and
`strk20.json` `demo_url` to the deployed URL as described above.

## License

MIT
