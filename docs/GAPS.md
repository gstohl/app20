# APP20 gaps

Engineering work the product still needs before private RFQ can run on a public Starknet network. Today the full flow works only on the build-gated localnet; Sepolia and Mainnet RFQ transport, publication, and settlement authority are hard-disabled.

This register lists only things that must be built, wired, or configured in this repository. Release conditions that are not engineering work — independent maker operators, external audits, CI provenance and signing, a Sepolia soak, Mainnet approval, secret-handling assurance, relay-gate re-review, legal/data-protection acceptance, and licence disposition (formerly P0-14, P0-26, P0-28–P0-32, P0-34, P0-35) — are tracked in [`APP20_RELEASE_GATES.md`](APP20_RELEASE_GATES.md). IDs below are stable; code comments and evidence files reference them.

**Status:** *Open* — not built. *Partial* — some of it exists, the closure condition is unmet. *Local only* — works on localnet, does not satisfy the production requirement.

## Contracts and settlement

| ID | Status | Gap |
| --- | --- | --- |
| **P0-05** | Open | Canonical quote-bound `App20Escrow` is not implemented. It must bind the selected quote, reservation/fence, directory checkpoint, registry revision, assets, parties, exact amounts, deadline, and claim identity required by `src/lib/escrow-vnext.ts`. The localnet `cairo/src/escrow.cairo` is a legacy design and does not. |
| **P0-06** | Open | Canonical `App20Claim` is not implemented. It must authorize exactly one claim or one timeout/refund per deal. The localnet `ClaimTicket` is not a candidate. |
| **P0-07** | Open | No canonical ABI, selectors, class hashes, addresses, or deployment block exist. `assertVnextAbiReady` fails closed and the production manifest is empty until the contracts above are built, deployed, and their identity recorded in `deployments/`. |
| **P0-08** | Open | Destination-bound Wallet API claim and timeout calldata is unspecified and unimplemented. The `${poolAddress}` / `${openNoteIds[0]}` placeholders need a real assembly path against the canonical contracts; falling back to localnet V2 calldata is not allowed. |
| **P0-09** | Open | Invariant, property, and fuzz coverage for the canonical contracts, plus pause, drain, claim, and refund recovery paths, do not exist. |

Requirements the canonical contract design must also resolve, found against the localnet fixtures:

- fund-side dust attribution has no approved ABI/accounting design;
- a lost private claim-ticket has no recovery path;
- unsolicited counter-token dust can fail a deal closed and deny liveness.

## Taker lifecycle and settlement authority

| ID | Status | Gap |
| --- | --- | --- |
| **P0-02** | Open | No authoritative durable taker lifecycle. IndexedDB records are non-authoritative resume hints; a server-side lifecycle joined to transport, reservation, submission, chain outcome, crash, reconnect, and cross-device resume is needed. |
| **P0-03** | Open | No production final value review. Acceptance must bind exact base units, quote expiry, deadline, fees, network, contract identities, refund condition, disclosures, and a fresh wallet/account/balance snapshot. |
| **P0-04** | Open | No authoritative completion projection. Fund, Fill, Claim, and Timeout must be derived only from finalized events of the pinned canonical contracts. |
| **P1-04** | Partial | Cancellation interlocks exist locally, but exactly-once reservation release through retries, crashes, and failover is unproven outside a single host. |
| **P1-06** | Partial | New/Active/Activity views exist locally, but a cross-device resumable lifecycle needs the P0-02, P0-16, and P0-25 services. |

## Assets, pricing, and economics

| ID | Status | Gap |
| --- | --- | --- |
| **P0-10** | Open | Public-network USDC address, decimals, registry revision, and token-identity verification are not configured. The registry supports the RFQ pair only on localnet. |
| **P0-11** | Local only | TTL, spread, and deviation checks exist, but there is no real price feed, no signed maker pricing provenance, and no hedge/reconciliation rules. The localnet fixture is not a price feed. |
| **P0-12** | Local only | Exact-unit caps with durable trailing-24-hour accounting exist, but production needs operational cap configuration, custody-backed exposure accounting, token-specific caps, and behavior against a real oracle. |

## Maker directory, keys, and capabilities

| ID | Status | Gap |
| --- | --- | --- |
| **P0-13** | Open | No maker-directory authority root, signed genesis/checkpoint, durable high-water implementation, admission policy, rotation/revocation flow, or published epoch. Only validation primitives exist. |
| **P0-15** | Open | `packages/maker-node/src/production-ports.ts` supplies no HSM/KMS signer adapter for quote, HPKE, or settlement keys, and no rotation, revocation, transaction-policy, or compromise-recovery logic. |
| **P0-18** | Open | Capability issuance is undefined: maker/taker identity proof, root-key custody, issuance audit, nonce/replay policy, rotation overlap, revocation, rate limits, and service authentication. |

## Transport and reservation state

| ID | Status | Gap |
| --- | --- | --- |
| **P0-16** | Local only | Reservation and replay state is durable on one host (WAL) and in a dormant SQLite Durable Object, but not replicated: backup/PITR, restore, retention, cross-region failover, split-brain handling, and restored high-water reconciliation are missing. |
| **P0-17** | Open | The RFQ relay and reservation-ledger Durable Object are unrouted. Worker `/api/rfq/*` returns 404, browser publication is off, and there is no monitoring or restore/failover path. |
| **P0-19** | Partial | RFC 9180 HPKE primitives exist, but there is no HSM/KMS recipient-key resolver, no production-shaped end-to-end tests, no key-lifecycle drills, and no decision on encrypting maker quotes on the return path. Loopback maker HTTP is not HPKE. |

## Chain authority

| ID | Status | Gap |
| --- | --- | --- |
| **P0-20** | Open | No constructible configured-chain verifier. `src/lib/settlement-receipt-chain.ts` has no composition root and always refuses; the same-devnet localnet authority fixture is not a substitute. |
| **P0-21** | Local only | The pinned-ABI decoder generator exists, but there is no canonical ABI (P0-07) to generate a production decoder from. |
| **P0-22** | Open | No RPC quorum: at least two independently administered reviewed HTTPS origins and disagreement rules are unimplemented. |
| **P0-23** | Local only | `scripts/egress-policy.mjs` hardens Node callers only. It is not applied to production Worker/RPC egress, has no allowlist of RPC members, and lacks TLS/SNI/Host consistency checks. |
| **P0-24** | Open | No durable finality/reorg authority: canonical block-number membership, finalized-block policy, persistent freshness, reorg invalidation, UI rollback, alerting, and maker reconciliation. |
| **P0-25** | Open | No settlement reconciliation service joining reservation, custody submission, escrow state, finalized events, claim/timeout, inventory release, and accounting. |

## Operations mechanisms

| ID | Status | Gap |
| --- | --- | --- |
| **P0-27** | Open | Pause, drain, and refund controls; stuck-claim and maker-default handling; end-of-day reconciliation tooling; and privacy-safe telemetry/alert hooks are not implemented. |

## Mail

| ID | Status | Gap |
| --- | --- | --- |
| **P0-33** | Open | Mailbox keys have no on-chain epoch, rotation, revocation, correspondent transition, or compromise recovery. The recovery phrase still grants both decryption and request-signing authority. Design: [`APP20_MAIL_KEY_ROTATION_HANDOFF.md`](APP20_MAIL_KEY_ROTATION_HANDOFF.md). |
| **P0-36** | Open | Mail recovery funding/action IDs are not bound to an authenticated user and a fresh per-invocation namespace. |

## Final wiring

| ID | Status | Gap |
| --- | --- | --- |
| **P0-01** | Open | Production RFQ is not mounted. `src/app/rfq/production-private-intents.ts` and `workers/relay/src/index.ts` fix transport and value authority to `false`. This is the last change, after every row above. |

## Build order

1. Contracts: P0-05, P0-06, P0-09 → deploy → P0-07 → P0-21, P0-08.
2. Chain authority: P0-22, P0-23, P0-20, P0-24, P0-04.
3. Makers and transport: P0-13, P0-15, P0-18, P0-19, P0-16, P0-17.
4. Lifecycle and economics: P0-02, P0-25, P0-03, P0-10, P0-11, P0-12, P1-04, P1-06.
5. Operations and Mail: P0-27, P0-33, P0-36.
6. Mount: P0-01.
