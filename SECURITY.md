# Security policy

## Current status

APP20 is a **build-gated localnet demonstration**. Public-network RFQ transport and execution, including Sepolia and Mainnet RFQ and value movement, are disabled. Nothing in this repository's localnet evidence authorizes a public deployment or public-network value path.

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

- public-network RFQ or value execution, which is disabled and unauthorized;
- third-party services, wallets, registries, networks, and dependencies not operated by this project (report those to their maintainers);
- historical Sepolia proof deployments, which are denylisted and are not canonical production contracts;
- social engineering, denial-of-service traffic, destructive testing, or testing against systems/accounts without explicit authorization;
- claims based only on localnet fixtures being unsuitable for production, which is already a documented blocker.

There is no bug bounty or promise of payment.

## Coordinated disclosure

Please report privately, provide enough reproducible detail to investigate safely, and allow maintainers to coordinate remediation and disclosure before publishing exploit details. This is an expectation, not a response-time or remediation SLA. Do not access, alter, retain, or disclose data beyond the minimum necessary to demonstrate a problem.

## Known privacy boundary

“Private RFQ” does not mean complete anonymity or fully hidden settlement:

- every invited maker learns the exact pair, direction, size, floor, and expiry;
- shield and unshield legs, including amounts and timing, are public and may be correlated;
- relay metadata such as source, timing, fanout, and bucket size is observable, and the relay may also observe maker quotes unless the return path changes;
- first-version settlement facts and related public activity may remain observable.

See [`docs/APP20_RFQ_GAPS.md`](docs/APP20_RFQ_GAPS.md) for the complete gap register, production blockers, and privacy-boundary details.
