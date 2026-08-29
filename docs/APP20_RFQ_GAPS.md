# APP20 RFQ definitive goals and gap register

**Current verdict: localnet RFQ demonstration only; production and every public-network RFQ remain disabled.** APP20 is a bookless, invited-maker RFQ product that uses the existing STRK20 privacy pool. Creating a new privacy venue, AMM, order book, or liquidity pool is not a product goal.

This document is the canonical product contract and inventory of known gaps. A passing local test cannot close a production gate, and historical Sepolia proof deployments cannot satisfy any item below.

## Definitive product goal

APP20 privately solicits a bounded set of approved makers for exact USDC↔STRK terms, verifies and ranks their signed quotes locally, lets the taker explicitly accept one, and settles that winning quote through canonical quote-bound Starknet contracts and the existing STRK20 privacy pool. There is no public RFQ book and no automatic public fallback.

## Definitive goal list

| ID | Goal | Definition of done |
| --- | --- | --- |
| **G01** | Bookless invited-maker RFQ | Only an approved bounded maker cohort receives a request; APP20 publishes no public order book or continuous liquidity claim. |
| **G02** | Existing STRK20 privacy rail | Shield, private transfer, and unshield use the reviewed existing STRK20 pool through the wallet path. APP20 never deploys a replacement pool. The Ready Wallet API path does not request a viewing key; the optional Privy browser-owned SDK path derives/holds its viewing key in the user browser and must not upload or log it. |
| **G03** | Canonical market scope | The first market is exactly USDC↔STRK on an explicitly approved Starknet network, with canonical token addresses, decimals, registry revision, and exact bigint units. |
| **G04** | Honest network policy | Localnet remains build-gated; Sepolia and Mainnet RFQ stay disabled until their own manifests and release gates pass. No signer, network, or public venue is borrowed silently. |
| **G05** | Informed RFQ request | The taker reviews pair, direction, exact amount, floor, expiry, maker cohort, amount fingerprinting, note maturity, fees, and public settlement facts before terms leave the browser. |
| **G06** | Confidential maker invitations | APP20 emits one authenticated maker-specific HPKE request per invited maker, with replay protection and reviewed padding. Metadata leakage remains explicitly disclosed. |
| **G07** | Verifiable quotes | Every quote is signed by an approved maker key and binds the complete canonical RFQ, directory checkpoint, assets, exact amounts, expiry, reservation, and pricing provenance. |
| **G08** | Deterministic local selection | The browser verifies all eligible quotes, displays comparison evidence, and selects deterministically. Relay or Mail data cannot choose or authorize a winner. |
| **G09** | Durable inventory reservations | Makers reserve before signing, use monotonic fences and exactly-once state transitions, durably release losers/cancellations, and fail terminally when inventory is insufficient. |
| **G10** | Explicit taker control | The taker can decline, requote, or accept. Acceptance requires a final review and fresh wallet/account/network/balance snapshot; refusal never triggers automatic public execution. |
| **G11** | Quote-bound settlement | Canonical immutable/versioned `App20Escrow` binds the selected quote, reservation/fence, directory, registry, assets, parties, amounts, deadline, and unique claim identity. |
| **G12** | Claim/refund liveness | Canonical `App20Claim` authorizes one claim or timeout/refund. Pause, drain, outage, and operator controls cannot strand or redirect taker or maker value. |
| **G13** | Chain-authoritative completion | Only pinned-contract events on the canonical finalized chain prove Fund, Fill, Claim, or Timeout. UI state, Mail, quotes, WAL entries, webhooks, and transaction links remain non-authoritative. |
| **G14** | Independent maker operation | At least two independently administered makers use HSM/KMS-backed keys, authenticated administration, caps, monitoring, reconciliation, rotation, revocation, backups, and tested recovery. |
| **G15** | Durable RFQ lifecycle | `/rfq` exposes resumable New, Active, and Activity states across refresh, reconnect, crash, ambiguous submission, expiry, claim, refund, refusal, and quarantine. |
| **G16** | Truthful privacy | UI and documentation distinguish hidden note ownership/transfers from visible shield/unshield legs, relay metadata, invited-maker disclosures, public escrow terms, timing, and OPEN-note amounts. |
| **G17** | Separate funding actions | Shielding and unshielding remain explicit funding operations. APP20 does not imply that bundling a public deposit with an RFQ provides unlinkability. |
| **G18** | Safe operations | Least privilege, secret isolation, privacy-safe telemetry, rate limits, abuse controls, incident response, pause/drain/refund procedures, PITR, failover, and end-of-day reconciliation are production requirements. |
| **G19** | Evidence-gated rollout | Rollout advances only through reviewed immutable source, reproducible artifacts, independent audits, bounded Sepolia soak, and a later separate hard-capped Mainnet approval. |
| **G20** | Clear product surfaces | `/rfq` is the canonical venue. Mailbox and Counterparties support coordination only; public send, recovery, Pay, and dry cross-chain review never become RFQ settlement authority. |
| **G21** | Proposal-only market planning | A market proposal may capture reviewed assets, amounts, owner/session, and a non-executable reference price/checksum. It never claims to create or deploy a pool. |

## Explicit non-goals

1. Deploying or letting users create a new privacy pool or venue.
2. Building an AMM, LP-token system, public order book, or continuous-liquidity venue.
3. Shipping a pool/venue factory or per-user market deployment flow.
4. Replacing the existing STRK20 pool, requesting Ready-wallet viewing keys, or sending any Privy browser-owned viewing key to APP20 backend/services.
5. Automatically routing a refused RFQ to a public exchange.
6. Treating Mail, negotiation, webhooks, checkout, local state, or disclosure packages as settlement authority.
7. Promising complete anonymity, hidden shield/unshield boundaries, or hidden first-version escrow facts.
8. Treating legacy Sepolia App20Escrow/ClaimTicket proof fixtures as canonical production contracts.
9. Shipping live cross-chain execution, maker yield, atomic two-taker crossing, hidden-term settlement, or value-authorizing agents in the narrow RFQ release.

## Definitions of done by stage

### Localnet demonstration

- Two separate maker processes quote both directions, reserve before signing, recover their WALs, release losers, fill or refund, and refuse insufficient inventory.
- Exact units, network gating, privacy disclosure, no public fallback, local Cairo authority, build, browser-leak scan, and UI journeys pass.
- Mock tokens/proofs and single-host operations are clearly labelled development fixtures.

### Sepolia production candidate

- Every P0 gap below is closed except the separate Mainnet approval.
- Canonical audited contracts and real reviewed tokens are deployed from reproducible artifacts.
- Two independent makers, production transport/custody/persistence, authoritative receipts, monitoring, recovery, and bounded soak evidence pass under hard caps.
- A new explicit Sepolia authorization names the exact source, contracts, operators, assets, limits, and rollback/drain plan.

### Tiny Mainnet RFQ

- Sepolia acceptance remains valid with no unresolved regression or audit finding.
- A separate human approval authorizes exact contracts, makers, assets, caps, duration, monitoring, and emergency procedures.
- Mainnet starts tiny and hard-capped; expansion requires a later independent decision and evidence.

## What is complete now

- The canonical product route is `/rfq`; `/vault` is a hash-preserving legacy redirect only.
- Localnet supports STRK→USDC and USDC→STRK RFQs against two separate maker processes.
- Exact bigint units, deterministic quote ranking, signed quotes, inventory reservation, terminal refusal, lock/fill/claim, expiry/refund, single-host WAL recovery, and no automatic public fallback are tested.
- The active Ready Wallet API RFQ path does not receive STRK20 viewing keys, maker private keys, or raw maker balances. The separate optional Privy browser-owned SDK derives/holds a viewing key locally; that boundary is not evidence for a repo-wide no-viewing-key claim.
- Mainnet and Sepolia private RFQ policy fails closed; browser publication and Worker `/api/rfq/*` transport are immutable-off.
- Cairo and finalized localnet pool state—not Mail, UI state, quotes, WAL records, or transaction-link copy—remain localnet settlement authority.

## P0 — production blockers

### RFQ product lifecycle

- **P0-01 — Production RFQ is not mounted.** `src/app/rfq/production-private-intents.ts` fixes transport and value authority to `false`; `workers/relay/src/index.ts` fixes RFQ transport to `false` and returns `404` for `/api/rfq/*`.
- **P0-02 — No durable taker lifecycle.** Quote and flow state are React/in-memory state. Refresh, tab loss, wallet reconnect, ambiguous submission, and network changes have no authoritative resume path.
- **P0-03 — No final value review.** Production needs a post-selection confirmation binding exact base units, quote expiry, deadline, fees, public disclosures, network, contracts, refund condition, and a fresh wallet/account/balance snapshot.
- **P0-04 — No authoritative completion.** Current localnet transaction references must not be treated as production settlement receipts.

### Contracts and Wallet API settlement

- **P0-05 — Canonical `App20Escrow` is not implemented.** `cairo/src/escrow.cairo` is a localnet-only legacy design and does not bind the selected quote, reservation/fence, directory checkpoint, registry, assets, accounts, exact amounts, deadline, and claim identity required by `src/lib/escrow-vnext.ts`.
- **P0-06 — Canonical `App20Claim` is not implemented.** Historical/localnet `ClaimTicket` is never production-eligible.
- **P0-07 — No production ABI or deployment identity.** VNext selectors remain absent, `assertVnextAbiReady` fails closed, and the production manifest has zero addresses/class hashes and `releaseReady: false`.
- **P0-08 — Claim/timeout calldata is unresolved.** Destination-bound Wallet API open-note placeholders must be specified, implemented, and tested without falling back to localnet V2 calldata.
- **P0-09 — Contract assurance is absent.** Required invariant/property/fuzz coverage, independent Cairo/protocol audits, accepted remediation, two-builder Sierra/CASM/ABI reproduction, constructor evidence, and pause/drain/claim/refund recovery do not exist.

### Assets, pricing, and economics

- **P0-10 — Live USDC is unconfigured.** The canonical registry supports the RFQ pair only on localnet; a reviewed public-network USDC identity and decimals are absent.
- **P0-11 — Production pricing policy is absent.** The localnet fixture is not a price feed. Production needs signed maker pricing provenance, quote TTL, spread/deviation limits, stale-reference behavior, market suspension, and hedge/reconciliation rules.
- **P0-12 — Economic controls are absent.** Per-trade, maker, token, market, and daily caps; fee policy; full/partial-fill policy; exposure accounting; inventory concentration; and fail-closed oracle/venue behavior are not operationally configured.

### Maker directory, transport, and operators

- **P0-13 — No governed maker directory.** Validation primitives exist, but there is no approved authority root, signed genesis/checkpoint, durable high-water implementation, rotation/revocation governance, admission policy, or published production epoch.
- **P0-14 — No independent maker operators.** Localnet child processes are not independent legal, personnel, infrastructure, network, or failure domains.
- **P0-15 — No production key custody.** `packages/maker-node/src/production-ports.ts` intentionally supplies no HSM/KMS adapter for quote, HPKE, or settlement keys; authenticated administration, dual control, rotation, revocation, transaction policy, and compromise recovery are missing.
- **P0-16 — Reservation and replay state are not production durable.** Local WAL/PID locking and in-memory stores need replicated CAS/serializable fencing, idempotent attempt IDs, backup/PITR, retention, cross-region failover, split-brain resistance, and restored high-water/reconciliation evidence.
- **P0-17 — RFQ relay/DO transport is undeployed.** Dormant Worker/Durable Object code has no production bindings, restore/failover proof, monitoring, or rollout authority.
- **P0-18 — Capability issuance is undefined.** Maker/taker identity proof, root-key custody, issuance auditing, nonce/replay policy, rotation overlap, revocation, rate limits, and service authentication have no approved production design.
- **P0-19 — HPKE is not production-operational.** The RFC 9180 primitives need independent review, an HSM/KMS recipient-key resolver, end-to-end production-shaped tests, key lifecycle drills, and a decision on whether maker quotes must also be end-to-end encrypted from the relay.

### Chain receipts, finality, and reconciliation

- **P0-20 — No constructible production configured-chain verifier exists.** `src/lib/settlement-receipt-chain.ts` exposes a nominal capability but intentionally has no public constructor/composition root and always refuses execution. The separate server-only localnet authority fixture does not satisfy this production gate.
- **P0-21 — No generated pinned-ABI decoder.** Receipt decoding is not bound to accepted canonical ABI bytes, selectors, contract address, class hash, and deployment block.
- **P0-22 — No approved independent RPC quorum.** At least two independently administered, exact reviewed HTTPS origins and disagreement rules are missing.
- **P0-23 — RPC egress is not hardened.** DNS/public-IP pinning, re-resolution, private-address denial, redirect refusal, TLS/SNI/Host consistency, deadlines, response-size limits, and egress allowlisting require a server-only adapter.
- **P0-24 — No durable finality/reorg authority.** Canonical block-number membership, finalized policy, persistent freshness, reorg invalidation, UI rollback, operator alerting, and maker reconciliation are absent.
- **P0-25 — No production settlement reconciliation.** Reservation, custody submission, escrow state, finalized events, claim/timeout, inventory release, and accounting are not joined by an authoritative service.

### Security, operations, and release

- **P0-26 — No independent security acceptance.** Cairo, protocol, browser, HPKE/relay, maker service, custody, and operations have no accepted external review/remediation record.
- **P0-27 — No production operational controls.** Monitoring, privacy-safe logs, alerts, on-call response, pause/drain/refund procedures, stuck-claim handling, maker default response, end-of-day reconciliation, and key/offboarding drills are absent.
- **P0-28 — No immutable approved baseline.** The current tree is uncommitted; CI provenance, SBOM/dependency review, release signatures, two-builder artifacts, and rollback version are not bound to an approved commit.
- **P0-29 — No canonical Sepolia soak.** Historical proofs are denylisted. A bounded real-token, two-independent-maker soak must cover both directions, fill/claim, timeout/refund, refusal, restart, relay outage, ambiguous submission, RPC disagreement, reorg, key rotation/revocation, restore, and drain.
- **P0-30 — No Mainnet authorization.** Mainnet needs a later, separate, explicit, tiny hard-capped approval after every earlier gate passes.
- **P0-31 — No viewing-key or operator-secret leakage may be introduced.** Viewing keys, maker/settlement/HPKE private keys, directory roots, and capability secrets must remain absent from browser bundles, client storage, logs, analytics, crash reports, and artifacts.

## P1 — RFQ product and UX gaps

- **P1-01 — Persistent environment status.** `/rfq` should keep `LOCALNET DEMO`, `SEPOLIA RFQ DISABLED`, or `MAINNET RFQ DISABLED` visible through quote, confirmation, settlement, and evidence states.
- **P1-02 — Maker cohort visibility.** Show governed cohort count, directory epoch/checkpoint freshness, key validity, invitation status, and safe capacity bands without exposing raw balances.
- **P1-03 — Quote comparison.** Show every verified response, expiry, capacity/refusal state, and deterministic selection rationale before the user accepts one.
- **P1-04 — Explicit cancellation.** Add decline/cancel before funding and prove durable release of every reservation.
- **P1-05 — Expiry UX.** Add countdown, non-executable expiry transition, refresh/requote, and stale-quote explanation.
- **P1-06 — Active and historical RFQs.** Add durable `New`, `Active`, and `Activity` views for requested, quoted, selected, funded, filled, claimable, settled, expired, refundable, refunded, refused, and quarantined states.
- **P1-07 — User-oriented identifiers.** Expose copyable RFQ, quote, reservation, and deal IDs with explicit authority labels.
- **P1-08 — Fee disclosure.** Separate maker spread, STRK20 pool fee, network gas/sponsorship assumptions, and any APP20 fee before execution.
- **P1-09 — Full-fill policy.** State `Full fill only` until partial fills are specified consistently across quotes, reservation, escrow, receipt, accounting, and UI.
- **P1-10 — Refusal recovery.** Show maker-response summary and reservation release, with `Start new RFQ`; public execution remains a separate explicit route.
- **P1-11 — Funding readiness.** Show supported wallet actions, asset eligibility, public funding legs, and note-maturity evidence only when exposed by the wallet. Do not probe private balances merely for feature detection.
- **P1-12 — Market reference clarity.** CoinGecko is public, non-executable context; show retrieval time, stale/error state, and `not an RFQ quote` next to the chart.
- **P1-13 — Maker terminology.** Use `maker` in product copy; retain `solver` only as internal protocol terminology.
- **P1-14 — Mobile hierarchy.** Prioritize environment, RFQ ticket, quotes, confirmation, and lifecycle ahead of chart, funding education, public send, cross-chain review, and recovery utilities.
- **P1-15 — Surface separation.** Public send, cross-chain dry review, funding, and Privy recovery are separate secondary routes with `Not RFQ settlement authority` boundaries, so wallet custody and RFQ execution are not conflated.
- **P1-18 — Authority presentation is localnet-only.** `src/app/rfq/rfq-authority.ts` accepts only exact runtime/account/chain/RFQ/deal-bound projections from the build-gated local authority service, derives every visible label from the status enum, expires its non-serializable live mark, and demotes a restored `authoritative` row to `stale`. This is same-devnet fixture authority only; production configured-chain authority remains unconstructible.
- **P1-16 — Accessibility and navigation regression evidence.** Cover direct `/rfq` load, refresh, history, hash tabs, `/vault` compatibility redirect, keyboard/focus behavior, screen-reader labels, and responsive layouts.
- **P1-17 — Bundle/runtime compatibility warnings.** The production build passes and the browser-leak scan is clean, but Vite still reports externalized `async_hooks`/`crypto`, direct `eval` in `@module-federation/sdk`, and chunks above 500 kB. Verify affected Privy/STRK20 flows under the production CSP, review the dependency/supply-chain exposure, and split or explicitly budget large chunks.

## Milestone-2 local product evidence (not production closure)

The local `/rfq` workspace now has persistent environment copy and New/Active/Activity navigation; deterministic all-quote comparison; an exact pre-disclosure invitation review; explicit final review, decline, reservation release, and cancellation-pending failure semantics; expiry countdowns; non-authoritative evidence labels; and separate rail-gated `/funding` and `/recovery/privy` routes plus `/send` and `/cross-chain-review`. Live quote terms are immutable until explicit cancellation releases reservations. `/swap/:tokenA/:tokenB` is a non-executable pair handoff that preserves either reviewed direction in validated search state. CoinGecko is opt-in and is never contacted on initial `/rfq` load. The market-planning route is `/rfq/markets/:tokenA/:tokenB/proposal`; the legacy pool-creation route redirects to it.

The lifecycle/storage model persists account-and-chain-bound IndexedDB convenience records labelled `Local resume record · not settlement authority`, rejects sensitive fields, quarantines malformed/cross-context records, expires stale quotes, and records submission-unknown transaction hashes without any automatic resubmission. The Active view resumes only through fresh server and wallet revalidation. Localnet claim/refund continuation, chain verification, reorg rollback, and maker reconciliation are implemented; production configured-chain authority remains unavailable.

P1-01, P1-03, P1-05, P1-08, P1-09, P1-10, P1-12, P1-13, and P1-15 have local implementation evidence. P1-04 is locally strengthened by execution/cancellation interlocks but remains partial pending replicated durable release. P1-06 remains partial: saved labels and read-only local reconciliation are not a production-resumable lifecycle. P1-02 remains partial (fixture cohort only); P1-07, P1-11, P1-14, P1-16, and P1-17 need additional browser/device evidence. No P0 production row is closed by this milestone.

### Local authority and reconciliation evidence (M8–M10)

The build-gated localnet service now composes a server-only fixed decoder for the legacy `App20Escrow` fixture, pinned ABI digest, runtime epoch, chain alias, escrow address, dynamic local class hash, exact event selectors, deal and quote/coordinator terms, transaction membership, and event coordinates. Two separately modeled readers intentionally observe the **same devnet**; agreement is local fixture evidence, never independent production RPC quorum evidence. Its durable monotonic journal publishes finality, disagreement, staleness, and reorg invalidation before the browser projection. A reorged terminal deal durably reclaims the coordinator market fence and cannot be automatically resubmitted.

The real localnet composition root now joins exact coordinator selection, maker WAL reservation/fence/quote/terms, custody fill hash, and the durable authority lifecycle. Ticket creation durably binds the settlement target into the selected maker WAL. Expiry and status-4 convergence only advance coordinator observation; they do **not** release maker inventory. Missing evidence remains pending; disagreement, unavailable readers, substituted hashes, mutated terms, unknown outcomes, and reorgs quarantine. Only an exact authoritative settled/refunded lifecycle may invoke the maker's authenticated terminal-reconciliation endpoint, using one stable idempotency key; the maker WAL transition and reconciliation journal both survive response loss and restart. Startup re-verifies every stored authority row before serving, and uncertain journal mutation fail-stops new RFQs without resubmitting value operations. The unsigned deterministic harness covers both RFQ directions, claim, timeout/refund, refusal, restart, reader outage/disagreement, reorg rollback, and reconciliation without keys, signatures, broadcasts, or public-network access. Production configured-chain authority, public RFQ transport, and value authorization remain unconstructible and hard-disabled.

## Milestone-3 authority presentation and usability evidence (not production closure)

`/rfq` now carries one persistent `Private RFQ` page heading, moves focus to a labelled region after New/Active/Activity hash navigation, and keeps a single `h1` with a descending heading order. Every saved record renders one enum-derived authority strip that separates `Local observation`, `Verification pending`, `Finalized on the configured chain`, `Reader disagreement`, `Reorg-invalidated`, and `Quarantined`; disagreement, reorg, and quarantine block the record's resume action and say so. A restored `authoritative` row is shown as `Verification pending` so a stale or forged IndexedDB row cannot keep claiming a finalized settlement, and a forged label is discarded in favour of the enum label. Storage, deal-read, offline, and quarantine failures now render a recovery card with a verify-only retry that never resubmits. The invited-maker cohort is a responsive card grid rather than a five-column table, final review leads with sell/receive/maker/clocks/fees/refund/authority before a `Protocol details` disclosure and a full-width primary action, and every verified response/refusal plus deterministic selection rationale remains visible before final review. Lifecycle enums render as plain language, activity records are individually headed with distinguishing copy-button names, and `/funding`, `/send`, `/cross-chain-review`, and `/recovery/privy` share one secondary-rail shell carrying environment, `Not RFQ settlement authority`, and `Back to RFQ`; Public Send is labelled unavailable rather than actionable. Market proposal moved to `src/app/rfq/markets/proposal/` with an `RFQ / Markets / Pair / Proposal` breadcrumb while the hash-preserving `/pools/create/:tokenA/:tokenB` redirect is retained.

Browser evidence at 320, 375, and 1440 px reported zero horizontal overflow, no console or page errors, `/vault#activity` preserving its hash into `/rfq#activity`, the legacy pool bookmark redirecting with `#review` intact, and keyboard-only navigation reaching `Active` and landing focus on the `Active RFQs` region. P1-16 gains this evidence but stays open pending screen-reader and 200% zoom passes; P1-14 and P1-15 gain local evidence. This milestone closes no production P0 row: M8–M10 authority is a same-devnet local fixture only, while the production configured-chain verifier, independent readers, canonical contracts, and public value authorization remain unavailable.

## Privacy boundary gaps

Even after production work, `private RFQ` must not be described as complete anonymity or fully hidden settlement:

- invited makers learn pair, direction, exact size, floor, and expiry;
- a relay can observe source, timing, fanout, bucket size, and—unless the return path changes—maker quotes;
- shield and unshield amounts/timing are public and correlatable;
- the first settlement design exposes pair, exact amounts, deadline, helper activity, events, timing, and OPEN-note amounts;
- public hedges and reference-market activity remain public;
- disclosure packages are selected evidence, not zero-knowledge selective-disclosure proofs.

The UI must preserve an explicit hidden/visible review and must never infer user activity from transaction sender; private pool transactions are relayed, so user-attributed deposit activity comes from the pool `Deposit` event’s first indexed key.

## Market-proposal naming status

Locally implemented: `/rfq/markets/:tokenA/:tokenB/proposal` is the canonical **Market proposal** surface, while `/pools/create/:tokenA/:tokenB` redirects with token segments and hash preserved. It retains `PROPOSAL ONLY · NO DEPLOYMENT`, reviewed assets, owner/session, exact amounts, registry revision, non-executable reference price, and identifier-only checksum. It exposes no factory, calldata, deploy, fund-pool, LP, or venue-administration action.

## Future ideas outside the definitive RFQ goal

Atomic two-taker crossing, hidden-term settlement, recurring/milestone escrow, private SOL-market admission, live cross-chain funding, maker-yield/accounting, value-authorizing agents, and cryptographically constrained automated accounts are not backlog gaps for the narrow RFQ product. Each requires a separate future product decision, specification, security review, and approval before entering this register.

## Production evidence checklist

Production/public-network RFQ stays blocked until all of the following exist:

1. canonical audited `App20Escrow` and `App20Claim`;
2. reproduced ABI/Sierra/CASM/selectors/class hashes and verified deployment;
3. resolved Wallet API claim/timeout path;
4. reviewed real token registry and economic caps;
5. governed maker-directory checkpoint and durable high-water authority;
6. at least two independently administered makers with HSM/KMS custody;
7. deployed replay transport plus replicated reservation/fencing state;
8. exact-once crash/retry/failover and disaster-recovery evidence;
9. server-only configured-chain verifier, generated decoder, hardened RPC quorum, finality, and reorg invalidation;
10. honest privacy and fee confirmation;
11. independent contract/browser/transport/service/operations reviews with accepted remediation;
12. bounded Sepolia soak;
13. immutable approved release checkpoint;
14. fresh explicit deployment/value approval; and
15. separate later Mainnet approval.
