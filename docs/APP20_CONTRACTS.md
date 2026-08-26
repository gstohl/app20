# APP20 contract inventory and rollout gates

**Nothing is authorized for deployment now.** APP20 currently has a build-gated localnet demonstration; Mainnet and Sepolia Mail/escrow addresses remain `0x0`. “Source exists” does not mean deployed, audited, upgradeable, or production-ready.

## Contracts APP20 does not deploy

| Contract | Owner | Purpose | APP20 action |
| --- | --- | --- | --- |
| STRK20 privacy pool | STRK20 protocol | Shield, private note transfer, unshield, proof verification, and `privacy_invoke` routing | Connect through Ready/Wallet API; never redeploy or request the user's viewing key |
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
- **Status:** team-owned source with local tests; Mainnet and Sepolia addresses are `0x0`; no current independent audit or deployment evidence.
- **Possible rollout:** a separately approved Mainnet Mail/STRK scoring lane may deploy it before RFQ settlement, following `docs/MAINNET_RUNBOOK.md`. That approval does not approve escrow or RFQ Mainnet.

The pre-release contract was renamed to `App20Mail`. This changes its class hash and artifact names; no previous deployment is treated as an APP20 deployment.

### `App20Escrow`

- **Source:** `cairo/src/escrow.cairo`
- **Constructor:** pinned STRK20 pool plus `ClaimTicket` class hash.
- **Role:** localnet development settlement for `Fund → Fill → Claim` or `Fund → Timeout`; accounts for exact token deltas, rejects wrong/short fills, and returns deposits through the pool.
- **Authority:** Cairo state and pool-applied deposits are value authority in the localnet demonstration.
- **Public facts:** pair, exact amounts, deadline, lifecycle timing, helper activity, and events are public.
- **Status:** localnet-only V2 development contract; Mainnet and Sepolia addresses are `0x0`; not independently audited; not approved for live deployment.
- **Rollout decision:** **do not roll this class directly into production.** Production RFQ needs a new immutable quote-bound successor that commits to the winning intent, quote, reservation, directory epoch/key, registry/assets, exact amounts, deadline, and claim-ticket identity.

The pre-release contract was renamed to `App20Escrow`, changing its ABI identifiers and class hash. A production successor must still use a new versioned class and deployment rather than silently changing deployed v1/v2 semantics.

### `ClaimTicket`

- **Source:** `cairo/src/claim_ticket.cairo`
- **Constructor:** escrow address, pool address, and deal id.
- **Role:** deal-unique, zero-decimal, supply-one authorization token. The escrow deploys one deterministic ticket per deal; possession in the private note authorizes one claim or timeout, then the escrow burns it.
- **Authority:** only the pinned escrow may mint/burn; only escrow or pool may transfer/approve.
- **Status:** localnet-only companion to `App20Escrow`; undeployed and unaudited on live networks.
- **Possible rollout:** only as part of the separately reviewed quote-bound escrow deployment, with class hash pinned in the escrow constructor and deployment manifest.

### `MockErc20`

- **Source:** `cairo/src/mock_erc20.cairo`
- **Role:** minimal token fixture for contract/devnet tests.
- **Status:** test-only.
- **Rollout decision:** never deploy as a production APP20 asset.

## New contracts that may be needed later

These are design obligations, not current source or deployment promises.

| Candidate | Why it may be needed | Entry gate | Current status |
| --- | --- | --- | --- |
| Quote-bound escrow VNext | Bind the selected quote/reservation/directory and emit events sufficient for authoritative receipts | Complete specification, invariant/property tests, two independent audits/remediation, class-hash manifest, Sepolia soak, explicit deployment approval | Required for production RFQ; not implemented in this execution |
| ClaimTicket VNext or reviewed reuse | Preserve supply-one claim/timeout authorization under the quote-bound escrow | Same audit/deployment gate as escrow; explicit compatibility analysis | Conditional |
| Atomic two-taker crossing | Settle matched takers atomically rather than merely netting completed maker-principal fills | Separate economic/security design and independent audit | Not implemented; current crossing is operational netting only |
| Recurring/milestone escrow | Capped scheduled or milestone release with cancellation/recovery | Base escrow audit complete, separate specification/audit, explicit user and release approval | Not implemented |
| Hidden-term settlement/proof system | Hide more settlement terms than public v1 permits | Research proof, compatibility review with STRK20, formal privacy statement, independent cryptographic audit | Research only; do not promise or deploy |
| Cryptographically constrained agent account policy | Enforce contract/token/cap/deadline/recovery restrictions on any future automated value action | Audited account/session policy and bypass-resistance review | Not implemented; agents remain advisory/non-submitting |

APP20 does not generate these Cairo contracts under the STRK20 integration skill. The team must specify, implement, review, audit, deploy, and maintain them.

## Proposed deployment order

No step inherits approval from the previous one.

1. **Localnet only:** continue `App20Mail`, `App20Escrow`, `ClaimTicket`, and `MockErc20` testing with ephemeral addresses.
2. **Optional Mail scoring lane:** after explicit approval, independently review and deploy only `App20Mail` on Mainnet for tiny STRK Mail scoring evidence. RFQ remains disabled.
3. **Sepolia RFQ candidate:** deploy a newly reviewed quote-bound escrow plus reviewed ticket class; run two independently administered makers and a bounded soak.
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

Until those artifacts exist, UI and documentation must say **unavailable**, **localnet-only**, or **not deployed**—never infer a contract address or audit status.
