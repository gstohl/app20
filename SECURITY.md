# Security policy

## Current status

APP20 Mail, escrow, and RFQ are a **build-gated localnet demonstration**. Public-network APP20 helper/RFQ transport and RFQ value execution are disabled. The separate Ready STRK20 wallet surface and optional Privy Sepolia recovery rail do not authorize Mail or RFQ, and this repository contains no Cloudflare deployment evidence. Nothing in the localnet evidence authorizes a public deployment or public-network RFQ value path.

No independent security audit or external security acceptance has been accepted. Local tests, dependency review, and same-devnet fixture evidence are not substitutes for an independent audit.

## Reporting a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/gstohl/app20/security/advisories/new) for `gstohl/app20`. A repository maintainer must enable private vulnerability reporting in the GitHub repository settings before this channel is available. If it is not enabled, do not disclose exploit details in a public issue; contact the maintainer through GitHub and ask for a private reporting channel without including sensitive details.

The project does not publish a security email address, PGP key, response-time SLA, or project-specific CVE process. Do not send secrets, private keys, viewing keys, production credentials, or user data with a report.

## Scope

In scope:

- APP20 application and library code maintained in this repository;
- the localnet-only invited-maker RFQ protocol and its fail-closed public-network gates;
- browser privacy boundaries, secret leakage, relay/metadata handling, quote verification, reservation logic, and localnet settlement integration;
- supply-chain, build, and release-policy weaknesses in repository-owned scripts and configuration.

Out of scope:

- public-network RFQ transport or RFQ value execution, which is disabled and unauthorized;
- third-party services, wallets, registries, networks, and dependencies not operated by this project (report those to their maintainers);
- historical Sepolia proof deployments, which are denylisted and are not canonical production contracts;
- social engineering, denial-of-service traffic, destructive testing, or testing against systems/accounts without explicit authorization;
- claims based only on localnet fixtures being unsuitable for production, which is already a documented blocker.

There is no bug bounty or promise of payment.

## Coordinated disclosure

Please report privately, provide enough reproducible detail to investigate safely, and allow maintainers to coordinate remediation and disclosure before publishing exploit details. This is an expectation, not a response-time or remediation SLA. Do not access, alter, retain, or disclose data beyond the minimum necessary to demonstrate a problem.

## Known privacy boundary

“Private RFQ” does not mean complete anonymity or hidden settlement:

- An RFQ v3 invitation tells each maker the pair, direction, fixed ladder bucket, RFQ/helper bindings, and expiry. The exact size and floor are absent from the request and remain in the browser during quoting.
- The same post-selection transcript is forwarded to every invited maker. It contains maker ids, quote/refusal digests, outcomes, ranks, clearing unit price, and each winning `amountA`. Summing winning allocations can reveal the exact size; the floor is not included. Refused makers currently acknowledge but cannot verify against a signed quote lock.
- Localnet maker HTTP is authenticated loopback traffic, not the production-shaped HPKE path. The coordinator receives account/chain/cohort metadata and bucket requests, then the full transcript and expected exact Take fills/totals. A future relay can observe source, timing, fanout, ciphertext/bucket size, and lifecycle metadata; quote returns remain relay-visible unless separately encrypted.
- `LockCreated` publicly reveals the RFQ id, pair, expiry, maximum collateral, complete schedule, and ticket. `LockTaken` reveals exact per-lock A/B amounts and remaining collateral. `DealTaken` reveals exact aggregate A/B totals and fill count. The Take helper calldata carries the `takerSecret` commitment preimage. Shield/unshield boundaries, OPEN-note amounts, helper use, and timing are also public and correlatable.
- Maker-signed mids are indicative fixture data, not price authority. The ten-block maturity display is estimated from public pool deposit events and cannot see notes received through private transfer.
- Contact/RFQ backups are encrypted in the browser. An IPFS RPC or gateway still learns source network metadata, timing, requested CID, and padded ciphertext size; a pinning service stores the encrypted bytes. The localnet IPFS emulator is loopback-only, in-memory, and loses all blocks on restart.
- Production blob storage is fail-closed unless reviewed IPFS RPC/gateway origins and matching relay `IPFS_ORIGINS` are configured. The relay adds CSP permission only; it does not proxy or pin blobs. A mailbox-seed compromise permits decryption/authentication of retained backups.
- Public-network RFQ and value execution remain immutable-off. The current mounted desk still runs legacy v1; lower-layer v3 implementation is not public deployment evidence.

See [`docs/GAPS.md`](docs/GAPS.md) for the engineering gap register and [`docs/APP20_RELEASE_GATES.md`](docs/APP20_RELEASE_GATES.md) for the release conditions that gate any public-network deployment.
