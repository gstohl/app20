# APP20 gaps

Engineering work the product still needs before private RFQ can run on a public Starknet network. Legacy v1 works through the mounted build-gated localnet desk. RFQ v3 is implemented below presentation, but its complete desk journey is not wired. Sepolia and Mainnet RFQ transport, publication, and settlement authority are hard-disabled.

This register lists only things that must be built, wired, or configured in this repository. Release conditions that are not engineering work — independent maker operators, external audits, CI provenance and signing, a Sepolia soak, Mainnet approval, secret-handling assurance, relay-gate re-review, legal/data-protection acceptance, and licence disposition (formerly P0-14, P0-26, P0-28–P0-32, P0-34, P0-35) — are tracked in [`APP20_RELEASE_GATES.md`](APP20_RELEASE_GATES.md). IDs below are stable; code comments and evidence files reference them.

**Status:** *Open* — not built. *Partial* — some of it exists, the closure condition is unmet. *Local only* — works on localnet, does not satisfy the production requirement.

## Contracts and settlement

| ID | Status | Gap |
| --- | --- | --- |
| **P0-05** | Partial | Localnet `App20Escrow` now binds RFQ id, taker commitment, pair, expiry, on-chain schedule, and collateral for atomic Take, but it is not the canonical production quote/directory/registry-bound contract required by `src/lib/escrow-vnext.ts`. Legacy `Fund`/`Fill`/`Claim`/`Timeout` variants remain in the ABI and are slated for explicit removal rather than silent reuse. V3 production enablement remains out of scope. |
| **P0-06** | Open | Canonical `App20Claim` is not implemented. Localnet `ClaimTicket` remains supply-one legacy authorization, while v3 `LockTicket` is a separate supply-two maker-settlement token; neither is a production `App20Claim` candidate. |
| **P0-07** | Open | No canonical ABI, selectors, class hashes, addresses, or deployment block exist. `assertVnextAbiReady` fails closed and the production manifest is empty until the production App20Escrow/App20Claim contracts are built, deployed, and recorded in `deployments/`. |
| **P0-08** | Open | Destination-bound Wallet API Claim/Timeout calldata is unspecified for the canonical VNext lifecycle. The `${poolAddress}` / `${openNoteIds[0]}` placeholders need a real assembly path; v3 has no taker Claim/Timeout and is not a fallback. |
| **P0-09** | Open | Localnet v3 lock/Take/two-sided-settlement tests exist, including a real-pool harness, but invariant/property/fuzz coverage and pause/drain/recovery evidence for the canonical production contracts do not. |

Local-v3 findings to resolve before its presentation is treated as complete; they do not create a production-v3 commitment:

- recovery policy if either private `LockTicket` unit is lost before maker settlement;
- settlement retry/drain behavior without merging the earned-A and unused-B authorities; and
- the privacy and failed-submission/replay consequences of revealing `takerSecret` in Take calldata, plus publishing full schedules, exact per-lock fills, and aggregate Take totals.

## Taker lifecycle and settlement authority

| ID | Status | Gap |
| --- | --- | --- |
| **P0-02** | Open | No authoritative durable taker lifecycle. IndexedDB records are non-authoritative resume hints; a server-side lifecycle joined to transport, reservations or locks, submission, chain outcome, crash, reconnect, and cross-device resume is needed. |
| **P0-03** | Open | No production final value review. Acceptance must bind exact base units, quote expiry, deadline, fees, network, contract identities, refund condition, disclosures, and a fresh wallet/account/balance snapshot. The local v3 final-review model is not production authority. |
| **P0-04** | Local only | Localnet authority accepts v3 `{ lifecycle: "v3", transactions: { take } }` and validates `get_take` totals, but no production completion projection derives a canonical lifecycle from finalized events. Legacy Fund/Fill/Claim/Timeout authority remains compatibility-only. |
| **P1-04** | Partial | Cancellation interlocks exist locally, but exactly-once reservation release and lock/Take coordination through retries, crashes, and failover are unproven outside a single host. |
| **P1-06** | Partial | New/Active/Activity views and encrypted RFQ export/import primitives exist locally, but a safe cross-device resumable lifecycle still needs P0-02, P0-16, P0-25, and P1-08. |

## Assets, pricing, and economics

| ID | Status | Gap |
| --- | --- | --- |
| **P0-10** | Open | Public-network USDC address, decimals, registry revision, and token-identity verification are not configured. The registry supports the RFQ pair only on localnet. |
| **P0-11** | Local only | TTL/spread/deviation checks and maker-signed short-lived indicative mids exist. The 2.00/2.01 localnet values and provenance strings are deterministic fixtures, not an independent price feed or production oracle/hedge policy. |
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
| **P0-16** | Local only | V3 maker inventory is collateralized on chain; lock history is durable in a single-host WAL and transcripts use a separate local journal. Coordinator request/Take state is also local. Replicated linearizable coordinator/custody state, backup/PITR, restore, retention, cross-region failover, split-brain handling, and restored high-water reconciliation are missing. |
| **P0-17** | Open | The RFQ relay and reservation-ledger Durable Object are unrouted. Worker `/api/rfq/*` returns 404, browser publication is off, and there is no monitoring or restore/failover path. |
| **P0-19** | Partial | RFC 9180 HPKE primitives exist only for canonical RFQ v1 plaintext. V3 RFQ v2 uses authenticated loopback HTTP; there is no HSM/KMS recipient-key resolver, production end-to-end v2 envelope, key-lifecycle drill, or encrypted maker-quote return path. |

## Chain authority

| ID | Status | Gap |
| --- | --- | --- |
| **P0-20** | Open | No constructible configured-chain verifier. `src/lib/settlement-receipt-chain.ts` has no composition root and always refuses; the same-devnet localnet authority fixture is not a substitute. |
| **P0-21** | Local only | The local decoder pins v3 lock/Take events and ABI digest, but there is no canonical production ABI (P0-07) from which to generate production selectors/decoder evidence. |
| **P0-22** | Open | No RPC quorum: at least two independently administered reviewed HTTPS origins and disagreement rules are unimplemented. |
| **P0-23** | Local only | `scripts/egress-policy.mjs` hardens Node callers only. It is not applied to production Worker/RPC egress, has no allowlist of RPC members, and lacks TLS/SNI/Host consistency checks. |
| **P0-24** | Open | No durable finality/reorg authority: canonical block-number membership, finalized-block policy, persistent freshness, reorg invalidation, UI rollback, alerting, and maker reconciliation. |
| **P0-25** | Local only | Localnet validates Take totals, reconciles maker lock events, and runs expiry proceeds/collateral settlement, but no production service joins replicated coordinator/custody state, finalized events, the selected lifecycle's claims/pulls, accounting, and reorg recovery. |

## Operations mechanisms

| ID | Status | Gap |
| --- | --- | --- |
| **P0-27** | Partial | Localnet has running/paused/drain-only start gates, lock/transcript status counts, and fail-closed maker settlement/quarantine. Production pause/drain/refund controls, unknown Take or stuck claim/settlement recovery, end-of-day reconciliation, and privacy-safe telemetry/alerts are not implemented. |

## Mail

| ID | Status | Gap |
| --- | --- | --- |
| **P0-33** | Open | Mailbox keys have no on-chain epoch, rotation, revocation, correspondent transition, or compromise recovery. The recovery phrase still grants both decryption and request-signing authority. Design: [`APP20_MAIL_KEY_ROTATION_HANDOFF.md`](APP20_MAIL_KEY_ROTATION_HANDOFF.md). |
| **P0-36** | Open | Mail recovery funding/action IDs are not bound to an authenticated user and a fresh per-invocation namespace. |
| **P1-21** | Partial | RFQ history backup strips `takerSecret` and uses authenticated Mail/IPFS snapshots, but it omits tombstone digests and does not stamp restored rows with a provenance marker; restored rows are forced to verify-only until the authority confirms them. The opt-in auto-backup after a settled Take is queued by the desk and posted by the next unlocked Mailbox session. |

## Final wiring

| ID | Status | Gap |
| --- | --- | --- |
| **P1-22** | Open | The localnet browser journeys (Playwright) still exercise the v1 flow rather than the complete v3 desk journey. |
| **P0-01** | Open | Production RFQ is not mounted. `src/app/rfq/production-private-intents.ts` and `workers/relay/src/index.ts` fix transport and value authority to `false`. This remains the last change, after every row above. |

## Build order

1. Contracts: P0-05, P0-06, P0-09 → deploy → P0-07 → P0-21, P0-08.
2. Chain authority: P0-22, P0-23, P0-20, P0-24, P0-04.
3. Makers and transport: P0-13, P0-15, P0-18, P0-19, P0-16, P0-17.
4. Lifecycle and economics: P0-02, P0-25, P0-03, P0-10, P0-11, P0-12, P1-04, P1-06.
5. Local presentation and backup: P1-07, P1-08; operations and Mail: P0-27, P0-33, P0-36.
6. Mount: P0-01.
