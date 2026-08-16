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

One complete private-mail loop targeted at Starknet mainnet (live wallet and
deployment validation is still required):

1. Two dapp-facing STRK20-capable wallets register in the pool.
2. Alice sends Bob an encrypted message through a `privacy_invoke` helper.
3. Bob discovers and decrypts it locally. No Quietline server holds plaintext.
4. Optionally, Alice attaches the memo to a private STRK transfer in the same tx.
5. A chain observer sees the pool/helper activity, timing, ciphertext, size, and
   recipient count, but no sender or recipient address in `MessagePosted`. The
   configured RPC can observe recipient-key lookups.

## Hidden vs visible

| Element | Hidden | Visible |
| --- | --- | --- |
| Sender address in `MessagePosted` | Absent — pool is `msg.sender` | Pool/helper activity and timing remain public |
| Recipient address in `MessagePosted` | Absent | Recipient count is public; the RPC sees directory lookups |
| Message content | AES-GCM encrypted to the mailbox key | Ciphertext and size are public |
| That a message was sent | | Helper event, block timestamp, and pool transaction |
| Payment amount (if attached) | Hidden inside the pool | Shield / unshield legs stay public |

## Deals in chat

Quietline can carry typed offers, accepts, declines, one-sided receipts, and
payment requests inside the same encrypted mail records. An offer asks the
recipient to sell STRK to the offerer; accepting creates one wallet batch with
the private STRK transfer followed by its encrypted accept memo. A receipt is a
separate helper transaction, so a failed receipt can be retried without moving
STRK again. Deal state and contact aliases stay in this browser's localStorage,
are never uploaded, and disappear when site data is cleared. Messages are not
sender-authenticated in envelope v1, so offer and request addresses must be
verified out-of-band before money moves.

Quietline encrypts message content and omits sender/recipient addresses from the
`MessagePosted` event. Ciphertext, size, recipient count, timing, pool/helper
activity, and recipient-key lookups at the configured RPC remain observable.
OTC MVP moves **only STRK**, one way, from accepter to offerer.
The quoted non-STRK asset is a promise. No escrow, no clawback, no proof Alice paid.
Two-person demos leak by timing correlation.
`register_pubkey` in `cairo/src/lib.cairo` is a public `address → x25519`
directory. It is not the pool viewing key, but it does reveal that an address
opted into Quietline mail.

This is not an atomic swap. The v1 receipt warning is `one_sided_v1`; it proves
neither payment of the quoted non-STRK leg nor the identity behind a claimed
address. Payment requests use the same one-way STRK rail and refuse duplicate
Pay actions locally.

## Stack

Vite + React 19 + TanStack Router, shipped as a client-only SPA (no SSR), with
TypeScript, zustand, starknet.js 10.4.0, the Wallet API, and a
`privacy_invoke` helper. The dapp never touches a pool viewing key; the wallet
owns private pool discovery and proving. Alchemy RPC configuration lives in an
env var and is never committed.

The SPA architecture is intentional: Quietline has no server routes, while its
wallet connection and browser cryptography require browser APIs.

## Wallet support

Quietline discovers Starknet Wallet Standard extensions without a wallet
allowlist (the generic MetaMask adapter is intentionally excluded). Appearing
in the picker means only that a wallet was discovered; it does **not** prove
that the installed version exposes STRK20 privacy actions to dapps.

- **Fully exercised in automation:** the development-only `Localnet (dev)`
  wallet, against Quietline's real-pool localnet harness.
- **Production integration target:** Ready. The live extension, prover,
  relayer, and network path still require the manual Sepolia/mainnet gates in
  `docs/MAINNET_RUNBOOK.md`.
- **Xverse and other discovered wallets:** they are listed and can connect for
  account access, but in-wallet privacy does not necessarily include the
  dapp-facing STRK20 Wallet API. Quietline does not claim support unless the
  installed wallet declares Wallet API/spec `>= 0.10` and the connected account
  exposes both `strk20InvokeTransaction` and `strk20Balances`.

When that gate fails, Quietline keeps all privacy and mail actions disabled and
shows a copyable capability diagnostic. It includes the wallet name and Wallet
Standard version, exact `walletApiVersions` and `specVersions` arrays, the
required minimum, both method-presence checks, and metadata-query errors. This
makes an empty/old declaration distinguishable from an app failure and gives a
concrete report to share with the wallet vendor.

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

Phase 1 wallet plumbing is in: connect a discovered wallet, fail-closed on
Wallet API/spec and account-method capability, and request shield / private
transfer / unshield / balance actions only when supported. Phase 2 is
code-complete locally: encrypted-mail primitives, the `QuietlineMail` helper,
the inbox UI, the deterministic mock-pool test, and a browser-viewable real-pool
localnet using a dev-only Wallet Standard wallet. No Sepolia or mainnet helper
is configured by default, so ordinary builds honestly disable sending until a
network-specific helper address is supplied. This is not a gambling product.

## Local demo (no Ready extension)

Quietline has a dev-only Wallet Standard wallet and a two-person localnet. It
uses deterministic prefunded Alice/Bob accounts, deploys the **real** pinned
`privacy_Privacy` pool and a fresh `QuietlineMail`, then serves the normal app
through `WalletAccountV6`. No browser extension or Alchemy key is needed.

One-time prerequisites are Node >=24, Scarb 2.18.x for `cairo/`, and the pinned
real-pool toolchain:

```bash
npm ci
npm run pool:setup
```

Start and stop the demo from the repository root (stop may run in a second
terminal):

```bash
npm run dev:localnet
# open http://127.0.0.1:5173
npm run localnet:stop
```

Startup checks the pinned vendor build, compiles `QuietlineMail`, boots native
Devnet, deploys the pool and helper, writes an ignored
`.env.localnet.local`, starts Vite, and verifies both `/` and `/inbox`. Repeating
the start command while it is healthy is a no-op. The dark blue development
bar shows the deployed addresses and has the Alice/Bob identity switcher. For a
pristine recording, use a private browser window or clear site data first.

### Two-identity walkthrough

1. In the normal **Connect a wallet** picker choose **Localnet (dev)**. This wallet
   is discovered through Wallet Standard; Quietline does not bypass
   `SelectWallet` or `WalletAccountV6`.
2. As **Alice**, click **Shield** on the wallet-actions page, open **Inbox**, and
   click **Load device key & register**. Save the one-time local mail-key backup
   if this is not a throwaway browser profile.
3. Use the blue bar to switch to **Bob**. Shield Bob from **Wallet actions**,
   return to the inbox, and register Bob's mail key. The switch is a live
   wallet-standard account-change event; reconnecting is not required.
4. Copy Bob's address from the development bar, switch to Alice, load Alice's
   existing device key, paste Bob as recipient, write a letter, and click
   **Encrypt & send letter**.
5. Switch to Bob, load his existing device key, and click **Check for new mail
   events**. The plaintext appears after browser-local decryption. Expand
   **What the chain sees** to inspect the public event index, timestamp,
   ephemeral key, view tag, nonce, and ciphertext; sender and recipient are
   absent from the event.
6. For OTC, Alice selects **Deal → Make offer** and sends terms to Bob. Bob
   scans and clicks **Accept & send … STRK**; one private transfer plus encrypted
   accept memo is submitted, followed by the explicitly one-sided receipt.
7. For an invoice, Alice selects **Deal → Request payment**. Bob scans and
   clicks **Pay … STRK privately**. The warnings remain intentional: quoted
   non-STRK consideration is not atomic or proven.

The local wallet sends the production action arrays to the vendored client,
which resolves `${poolAddress}` and `${openNoteIds[0]}`, uses direct contract
discovery, generates upstream's devnet mock proof facts, and submits by outside
execution. It also funds the helper with 7 STRK base units per mail so the real
pool's recovery open-note invariant is exercised. This is the real Cairo pool
and real app path, but **not a real STARK proof**: Devnet proof bytes are empty,
the screener key is public test material, and no Ready UI/relayer is involved.

The wallet code is gated by the same build-time pattern as StarkWare's bridge
E2E wallet. `VITE_E2E_WALLET` defaults to the boolean `false`, allowing Rollup
to remove the gated dynamic import and its chunk. Verify the production bundle:

```bash
npm run build
! grep -R "QUIETLINE_LOCALNET_DEV_WALLET_SENTINEL_7C91E2" dist/
```

The grep must print nothing and exit 0. Never set `VITE_E2E_WALLET=true` for a
production deployment.

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
| `npm run dev` | root | Starts the ordinary Vite development server |
| `npm run dev:localnet` | root | Deploys the real pool + helper, starts the dev-only two-identity wallet API, and serves Vite |
| `npm run test:ui` | root | Starts a clean localnet, drives all browser journeys with Playwright, saves ignored screenshots under `ui-artifacts/localnet/`, and stops localnet |
| `npm run localnet:stop` | root | Stops the local demo's Vite, wallet API, and native Devnet processes |
| `npm run build` | root | Type-checks and emits the production SPA to `dist/` |
| `npm run preview` | root | Serves the production build locally |
| `npm test` | root | Mail crypto, felt packing, view-tag scanning, and STRK20 mail-action assembly |
| `npm run devnet` | root | Starts the Docker Starknet Devnet used by the local integration test |
| `npm run test:e2e` | root | Builds and deploys the helper, registers a key, posts mail, scans/decrypts, rejects a wrong key, and exercises dust echo against the mock pool caller |
| `npm run pool:setup` | root | One-time pinned vendor/toolchain build for the isolated real-pool harness (Node >=24) |
| `npm run test:e2e:pool` | root | Runs the upstream real-pool lifecycle plus Quietline's production OPEN-note + mail invoke batch, decryption, recovery-note credit, and action-ID replay checks |
| `scarb build` | `cairo/` | Compiles the Cairo helper and mock ERC-20 |
| `snforge test` | `cairo/` | Runs helper authorization, ciphertext-cap, caller-isolated directory, event, zero-balance, and dust tests |

The UI suite requires Playwright Chromium once per machine (`npx playwright install chromium`).
It always uses `http://127.0.0.1:5173` so a stale service bound to `localhost` cannot
be mistaken for the localnet app.

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
direct contract discovery + upstream's SIMULATED proof**. In addition to the
upstream lifecycle, it compiles `src/lib/strk20.ts`, deploys `QuietlineMail`
against that pool, and passes the production OPEN-note + invoke action array
through the vendored client's `${poolAddress}` / `${openNoteIds[0]}`
substitution. It proves that the helper emits mail through the pool, Bob
decrypts while a wrong key cannot, helper dust is pulled into Alice's recovery
note, the same non-zero action ID reverts with `ACTION_ID_USED`, and zero IDs
remain repeatable. Each successful mail is deliberately given fresh 7-base-unit
helper dust so the real pool's `UNDEPOSITED_OPEN_NOTES` invariant is satisfied
and the recovery path is exercised rather than bypassed.

Devnet cannot serve `starknet_getStorageProof`, so real STARK proving still
needs hosted proving services and a storage-proof-capable node such as
Pathfinder. Deposit screening uses the canonical public test key `0xCAFEBABE`,
which is test-only material. Local substitution through the vendored client
does not test Ready's own action assembly, extension UI, proof/relayer path, or
live mainnet screening. Neither local tier claims a Sepolia/mainnet send.

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
