# APP20 contract inventory and rollout gates

**Nothing is configured or authorized for production deployment now.** APP20 currently has a build-gated localnet demonstration; configured Mainnet and Sepolia APP20 addresses remain `0x0`. “Source or historical proof exists” does not mean configured, audited, upgradeable, production-ready, or approved. Canonical production names are **App20Mail**, **App20Escrow**, and **App20Claim**; “VNext” is internal migration terminology only.

The public fail-closed production template is `deployments/sepolia/deployment-manifest.template.json`; it remains `releaseReady: false` with zero canonical addresses/hashes, no audits, and no approvals. Separate [historical Sepolia proof records](evidence/historical-sepolia-proofs/) document one-off App20Mail and legacy escrow/ticket activity and are explicitly ineligible for runtime or production use.

APP20 uses the existing STRK20 privacy pool. A new pool, AMM, order book, LP system, or pool factory is not part of the definitive RFQ goal. APP20-owned production contracts are limited to quote-bound settlement and claim/refund authority; see [`GAPS.md`](GAPS.md). RFQ v3 production enablement is out of scope and does not modify that separate frozen production proposal.

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
- **Constructor:** `(pool, ticket_class_hash, lock_ticket_class_hash)`. The third argument is the additive localnet-v3 constructor change.
- **Current v3 role:** a maker first invokes `Lock` through the pinned pool and deposits token B collateral equal to the maximum schedule payout. A taker then invokes one atomic `Take` for one to four distinct locks, depositing the exact total token A and receiving the exact evaluated token B total as one OPEN note. After lock expiry, makers independently pull earned token A with `SettleProceeds` and unused token B with `ReleaseCollateral`.
- **Legacy role:** enum variants `Fund` (0), `Fill` (1), `Claim` (2), and `Timeout` (3) remain ABI-compatible in source and tests. The v3 variants are `Lock` (4), `Take` (5), `SettleProceeds` (6), and `ReleaseCollateral` (7). Localnet product migration targets v3; removal of variants 0–3 is deferred and required as an explicit later compatibility change, never a silent ABI mutation.
- **Views:** `ensure_lock_ticket`, `get_lock_ticket`, `get_lock`, `get_take`, and `quote_schedule` are additive. Schedule evaluation accepts one to four positive u128 points, requires increasing A/non-decreasing B, and floors interpolation.
- **State:** the on-chain lock remains `Open`; `remaining_b`, `earned_a`, `proceeds_settled`, and `collateral_released` carry its progress. Maker WAL labels such as `taken`, `expired`, and `settled` are off-chain projections, not Cairo enum variants.
- **Parameter naming:** in `LockParams`, `token` is token B—the collateral whose escrow balance delta is measured—and `counter_token` is token A. The stored lock and events expose these as `token_b` and `token_a`.
- **Public call/events:** Take helper calldata carries the `taker_secret` commitment preimage. V3 emits `LockCreated`, `LockTaken`, `DealTaken`, `LockProceedsSettled`, and `LockCollateralReleased`. `LockCreated` publishes the schedule, token pair, RFQ id, expiry, maximum B, and ticket. Each `LockTaken` publishes exact per-lock A/B amounts and remaining B; `DealTaken` publishes exact aggregate A/B totals and fill count.
- **Authority:** Cairo state and pool-applied deposits are value authority only in the same-devnet localnet demonstration. The local authority validates `get_take` totals against the browser's expected fills; it is not configured-chain production authority.
- **Status:** localnet-only v3 development contract with retained v1 operations; configured Mainnet and Sepolia addresses are `0x0`; not independently audited; not approved for live deployment. The historical Sepolia proof predates v3 and is not canonical production App20Escrow.
- **Rollout decision:** **do not roll this class directly into production.** The localnet lock binds RFQ id, taker commitment, pair, schedule, and expiry, but it is still not the canonical quote/directory/registry-bound production contract described by the release gates.

The pre-release contract was renamed to `App20Escrow`, changing its ABI identifiers and class hash. A production successor must use a new versioned class and deployment rather than treating localnet ABI additions as a production upgrade.

### `LockTicket` (localnet v3 only)

- **Source:** `cairo/src/lock_ticket.cairo`
- **Constructor:** escrow address, pool address, and lock id.
- **Role:** lock-unique, zero-decimal, supply-two authorization token. `Lock` mints two units into escrow and approves the pool for the two-unit OPEN note. After expiry, each unit can be withdrawn back to escrow and burned to authorize one maker pull: proceeds or unused collateral. If a side is zero, that call reverts and its unused unit remains inert.
- **Transfer rule:** settlement movements are exactly one unit. The sole two-unit exception is the initial escrow-to-pool transfer that deposits the minted ticket supply.
- **Authority:** only the pinned escrow mints/burns; only escrow or pool can transfer/approve, and recipients are restricted to escrow or pool.
- **Status:** localnet-only, unaudited, and not a production `App20Claim` replacement.

### `ClaimTicket` (historical/localnet; not production `App20Claim`)

- **Source:** `cairo/src/claim_ticket.cairo`
- **Constructor:** escrow address, pool address, and deal id.
- **Role:** deal-unique, zero-decimal, supply-one authorization token. The escrow deploys one deterministic ticket per deal; possession in the private note authorizes one claim or timeout, then the escrow burns it.
- **Authority:** only the pinned escrow may mint/burn; only escrow or pool may transfer/approve.
- **Status:** localnet-only companion to `App20Escrow`; unaudited and never production-eligible. The historical class was declared on Sepolia and pinned by the legacy escrow proof; no standalone ticket instance is claimed.
- **Sepolia decision (2026-08-26): replace, do not reuse.** The historical class must not be configured, redeployed, or silently reused. The Cairo team must implement canonical production `App20Claim`, independently review/audit it with canonical production `App20Escrow`, and pin its reproduced Sierra/CASM hashes, class hashes, ABI/selectors, and constructor in the public deployment manifest.
- **Possible rollout:** only as `App20Claim` within a separately reviewed quote-bound App20Escrow deployment; the historical `ClaimTicket` name/class is never a Sepolia candidate. V3 itself has no taker Claim/Timeout operation.

### `MockErc20`

- **Source:** `cairo/src/mock_erc20.cairo`
- **Role:** minimal token fixture for contract/devnet tests.
- **Status:** local test-only.
- **Rollout decision:** never include or deploy it on Sepolia or Mainnet and never present it as a live APP20 asset. Sepolia uses official STRK at `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`; USDC remains unconfigured until independently verified.

## Settlement contracts and separately scoped future ideas

Only the production App20Escrow/App20Claim replacements are part of the definitive narrow RFQ goal. Every other row is a separately scoped future idea, not an RFQ backlog gap, current source promise, or deployment promise. The localnet v3 classes do not create a production-v3 commitment.

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

1. **Localnet only:** continue `App20Mail`, localnet-v3 `App20Escrow`, `LockTicket`, retained legacy `ClaimTicket`, and `MockErc20` testing with ephemeral addresses.
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
- pause/recovery behavior that never strands a Take, maker proceeds/collateral settlement, or any retained legacy claim/timeout;
- bounded testnet evidence and rollback/drain procedure;
- explicit human approval at the moment of deployment.

Until those artifacts exist, UI and documentation must say **unavailable**, **localnet-only**, or **not configured or authorized**—never infer a production contract address or audit status from historical proof activity.
