# APP20 contract inventory and rollout gates

**Nothing is configured or authorized for production deployment now.** APP20 currently has a build-gated localnet demonstration; configured Mainnet and Sepolia APP20 addresses remain `0x0`. “Source or historical proof exists” does not mean configured, audited, upgradeable, production-ready, or approved. Canonical production names are **App20Mail**, **App20Escrow**, and **App20Claim**; “VNext” is internal migration terminology only.

The public fail-closed production template is `deployments/sepolia/deployment-manifest.template.json`; it remains `releaseReady: false` with zero canonical addresses/hashes, no audits, and no approvals. Separate [historical Sepolia proof records](evidence/historical-sepolia-proofs/) document one-off App20Mail and legacy escrow/ticket activity and are explicitly ineligible for runtime or production use.

APP20 uses the existing STRK20 privacy pool. A new pool, AMM, order book, LP system, or pool factory is not part of the definitive RFQ goal. APP20-owned production contracts are limited to quote-bound settlement and claim/refund authority; see [`GAPS.md`](GAPS.md).

## Contracts APP20 does not deploy

| Contract | Owner | Purpose | APP20 action |
| --- | --- | --- | --- |
| STRK20 privacy pool | STRK20 protocol | Shield, private note transfer, unshield, proof verification, and `privacy_invoke` routing | Never redeploy. The Ready Wallet API path does not request a viewing key; the optional Privy SDK derives/holds its key only in the browser under its separate trust boundary |
| STRK and USDC ERC-20s | Existing token issuers | Public token legs and balances | Resolve through the network-scoped token registry; never deploy replacement production tokens |
| Ready account/relayer infrastructure | Wallet/provider operators | User authorization, proving, note discovery, and relayed submission | Treat as wallet infrastructure, not an APP20-owned contract |

The live Mainnet STRK20 pool is `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. APP20 does not claim ownership or audit credit for it.

## Contracts currently in this repository

### `App20Mail`

- **Source:** `cairo/src/lib.cairo`
- **Constructor:** one pinned STRK20 pool address.
- **Role:** accepts `privacy_invoke` only from the pinned pool, emits encrypted Mail payloads, keeps a public mailbox-key directory, enforces optional action-id replay protection, and can return one fixed-size recovery deposit.
- **Authority:** correspondence/storage helper only. It does not authorize RFQ settlement or prove sender identity.
- **Public facts:** helper use, event timing, ciphertext size/occupancy, and public key registration are visible.
- **Status:** team-owned source with local tests; configured Mainnet and Sepolia addresses are `0x0`; no current independent audit or approved production deployment. An unaudited one-off App20Mail Sepolia proof deployment exists and is denylisted in the historical evidence index.
- **Possible rollout:** none in the localnet-final scope. Any future Mainnet Mail/STRK scoring lane requires a new approved runbook and separate approval; the archived `docs/MAINNET_RUNBOOK.md` is not executable authority.

The pre-release contract was renamed to `App20Mail`. This changes its class hash and artifact names; no previous deployment is treated as an APP20 deployment.

### `App20Escrow`

- **Source:** `cairo/src/escrow.cairo`
- **Constructor:** pinned STRK20 pool plus `ClaimTicket` class hash.
- **Role:** localnet development settlement for `Fund → Fill → Claim` or `Fund → Timeout`; accounts for exact token deltas, rejects wrong/short fills, and returns deposits through the pool.
- **Authority:** Cairo state and pool-applied deposits are value authority in the localnet demonstration.
- **Public facts:** pair, exact amounts, deadline, lifecycle timing, helper activity, and events are public.
- **Status:** localnet-only V2 development contract; configured Mainnet and Sepolia addresses are `0x0`; not independently audited; not approved for live deployment. A historical copy was declared/deployed on Sepolia as proof only and is not canonical production App20Escrow.
- **Rollout decision:** **do not roll this class directly into production.** Production RFQ needs a new immutable quote-bound successor that commits to the winning intent, quote, reservation, directory epoch/key, registry/assets, exact amounts, deadline, and claim-ticket identity.

The pre-release contract was renamed to `App20Escrow`, changing its ABI identifiers and class hash. A production successor must still use a new versioned class and deployment rather than silently changing deployed v1/v2 semantics.

### `ClaimTicket` (historical/localnet; not production `App20Claim`)

- **Source:** `cairo/src/claim_ticket.cairo`
- **Constructor:** escrow address, pool address, and deal id.
- **Role:** deal-unique, zero-decimal, supply-one authorization token. The escrow deploys one deterministic ticket per deal; possession in the private note authorizes one claim or timeout, then the escrow burns it.
- **Authority:** only the pinned escrow may mint/burn; only escrow or pool may transfer/approve.
- **Status:** localnet-only companion to `App20Escrow`; unaudited and never production-eligible. The historical class was declared on Sepolia and pinned by the legacy escrow proof; no standalone ticket instance is claimed.
- **Sepolia decision (2026-08-26): replace, do not reuse.** The historical class must not be configured, redeployed, or silently reused. The Cairo team must implement canonical production `App20Claim`, independently review/audit it with canonical production `App20Escrow`, and pin its reproduced Sierra/CASM hashes, class hashes, ABI/selectors, and constructor in the public deployment manifest.
- **Possible rollout:** only as `App20Claim` within a separately reviewed quote-bound App20Escrow deployment; the historical `ClaimTicket` name/class is never a Sepolia candidate.

### `MockErc20`

- **Source:** `cairo/src/mock_erc20.cairo`
- **Role:** minimal token fixture for contract/devnet tests.
- **Status:** local test-only.
- **Rollout decision:** never include or deploy it on Sepolia or Mainnet and never present it as a live APP20 asset. Sepolia uses official STRK at `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`; USDC remains unconfigured until independently verified.

## Settlement contracts and separately scoped future ideas

Only the production App20Escrow/App20Claim replacements are part of the definitive narrow RFQ goal. Every other row is a separately scoped future idea, not an RFQ backlog gap, current source promise, or deployment promise.

| Candidate | Why it may be needed | Entry gate | Current status |
| --- | --- | --- | --- |
| App20Escrow production successor | Bind the selected quote/reservation/directory and emit events sufficient for authoritative receipts | Complete specification, invariant/property tests, two independent audits/remediation, artifact/class-hash manifest, Sepolia soak, explicit deployment approval | Internal migration commitment and ABI/event expectations exist; **canonical production Cairo is not implemented** |
| App20Claim production replacement | Preserve supply-one claim/timeout authorization under the quote-bound escrow | Same audit/deployment gate as escrow; explicit compatibility analysis | Replacement decided; **canonical production Cairo is not implemented** |
| Atomic two-taker crossing | Settle matched takers atomically rather than merely netting completed maker-principal fills | Separate economic/security design and independent audit | Not implemented; current crossing is operational netting only |
| Recurring/milestone escrow | Capped scheduled or milestone release with cancellation/recovery | Base escrow audit complete, separate specification/audit, explicit user and release approval | Not implemented |
| Hidden-term settlement/proof system | Hide more settlement terms than public v1 permits | Research proof, compatibility review with STRK20, formal privacy statement, independent cryptographic audit | Research only; do not promise or deploy |
| Cryptographically constrained agent account policy | Enforce contract/token/cap/deadline/recovery restrictions on any future automated value action | Audited account/session policy and bypass-resistance review | Not implemented; agents remain advisory/non-submitting |

APP20 does not generate these Cairo contracts under the STRK20 integration skill. The team must specify, implement, review, audit, deploy, and maintain them.

## Proposed deployment order

No step inherits approval from the previous one.

1. **Localnet only:** continue `App20Mail`, historical/localnet `App20Escrow`, `ClaimTicket`, and `MockErc20` testing with ephemeral addresses.
2. **Optional Mail scoring lane:** after explicit approval, independently review and deploy only `App20Mail` on Mainnet for tiny STRK Mail scoring evidence. RFQ remains disabled.
3. **Future Sepolia RFQ candidate:** only after a new scope and separate authorization, deploy newly reviewed canonical `App20Escrow` plus `App20Claim`; run two independently administered makers and a bounded soak. The repository ships no execution pipeline, and those artifacts/selectors/class hashes do not exist.
4. **Tiny Mainnet RFQ evidence:** only after audit acceptance, Sepolia soak, hard caps, recovery drills, configured-chain receipts, and a new explicit Mainnet approval.
5. **Later contracts:** atomic crossing, recurring settlement, hidden terms, or agent policy each require their own specification, audit, deployment, and cap approvals.

## Deployment evidence required per APP20-owned contract

- exact reviewed source commit and reproducible Sierra/CASM hashes;
- declared class hash and deploy transaction;
- constructor calldata and network;
- deployer/governance identity and key-custody procedure;
- upgrade posture (prefer immutable versioned deployments and explicit migration);
- independent review reports and remediation acceptance;
- event/ABI manifest used by receipt verification;
- pause/recovery behavior that never strands claim or timeout;
- bounded testnet evidence and rollback/drain procedure;
- explicit human approval at the moment of deployment.

Until those artifacts exist, UI and documentation must say **unavailable**, **localnet-only**, or **not configured or authorized**—never infer a production contract address or audit status from historical proof activity.
