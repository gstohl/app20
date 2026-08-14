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

Wallet API + a `privacy_invoke` helper. The dapp never touches a viewing key.
Ready wallet. Alchemy RPC in an env var, never committed.

## Sprint artifacts

Scoring reads this repository every 30 minutes. Fill in `strk20.json` as they exist:

- `transactions` — three successful mainnet hashes that touched the STRK20 pool
- `contracts` — deployed helper addresses
- `demo_video` — a 3-minute walkthrough of send + discover + optional memo
- `demo_url` — only if GitHub Pages / Website / Vercel does not already find it

## Status

Phase 1 wallet plumbing is in: connect Ready, detect Wallet API/spec ≥ 0.10,
and request shield / private transfer / unshield / balance actions. Phase 2 is
code-complete locally: encrypted-mail primitives, the `QuietlineMail` helper,
the inbox UI, and a deterministic mock-pool devnet test. No Sepolia or mainnet
helper is configured by default, so the inbox honestly disables sending until a
network-specific helper address is supplied. This is not a gambling product.

## Local testing

Install JavaScript dependencies with `npm ci`. Cairo commands run from the
`cairo/` directory; all other commands run from the repository root.

| Command | Directory | What it checks |
| --- | --- | --- |
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

## License

MIT
