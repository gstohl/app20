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
- **P0-11 — Production pricing policy is absent.** *Local capability only; row stays open.* `packages/private-intents/src/economic-policy.ts` and `scripts/localnet-rfq-economics.mjs` now enforce a reviewed 90-second quote TTL, a 50 bps maker-spread ceiling, a 100 bps total-deviation ceiling computed from exact bigint amounts over identical sell quantities, stale-reference rejection beyond 300s, and market suspension beyond 900s, in both market directions. **Still absent:** any real price feed, signed maker pricing provenance, and hedge/reconciliation rules. The localnet fixture is not a price feed.
- **P0-12 — Economic controls are absent.** *Local capability only; row stays open.* Per-trade (5,000 USDC), per-maker-daily (25,000), per-market-daily (50,000), a 60% single-maker concentration ratio against actual post-trade market usage, 0 bps APP20 fee, full-fill-only policy, and fail-closed refusal on missing or malformed inputs are enforced in exact bigint units against a supplied accounting window. **Still absent:** operational configuration, custody-backed exposure accounting, token-specific caps, and venue behaviour under a real oracle. **Known defect:** the localnet adapter buckets usage into fixed UTC days (`scripts/localnet-rfq-economics.mjs:179-185,340-346`) and clears committed usage at the boundary, so two 5,000 USDC trades either side of midnight both pass, contradicting the trailing-24-hour window the policy contract specifies.

### Maker directory, transport, and operators

- **P0-13 — No governed maker directory.** Validation primitives exist, but there is no approved authority root, signed genesis/checkpoint, durable high-water implementation, rotation/revocation governance, admission policy, or published production epoch.
- **P0-14 — No independent maker operators.** Localnet child processes are not independent legal, personnel, infrastructure, network, or failure domains.
- **P0-15 — No production key custody.** `packages/maker-node/src/production-ports.ts` intentionally supplies no HSM/KMS adapter for quote, HPKE, or settlement keys; authenticated administration, dual control, rotation, revocation, transaction policy, and compromise recovery are missing.
- **P0-16 — Reservation and replay state are not production durable.** *Local capability only; row stays open.* A dormant SQLite-backed `ReservationLedgerDurableObject` implements monotonic fence tokens, compare-and-set transitions, exactly-once idempotency keys, durable tombstones, and atomic pending-attempt recovery from persisted state alone; one shared codec and lifecycle contract suite runs against both it and the localnet WAL repository. **Still absent:** deployment, replicated independently administered storage, backup/PITR and restore drills, retention, cross-region failover, split-brain evidence, and restored high-water reconciliation. One Cloudflare account is one administrative domain. **Known defect:** `isStorageWriteFailure()` (`workers/relay/src/reservation-ledger-do.ts:228-232`) recognises only the test mock's exact message, so a real platform storage failure is returned as a non-retryable HTTP 409 conflict; a caller honouring that status may abandon a safe retry and strand inventory in `selected` or `filling`.
- **P0-17 — RFQ relay/DO transport is undeployed.** A ReservationLedgerDurableObject binding is declared but remains dormant with no route and transport immutable-off; restore/failover proof, monitoring, and rollout authority are absent.
- **P0-32 — The relay abuse gate has accepted review findings and must not be deployed as-is.** An independent review of `workers/relay/src/gate.ts` returned CHANGES with no blocker but one high and three medium findings, none currently exploitable because no relay is deployed. **High:** rejected requests still mutate and rewrite durable state, and `currentRate()` creates attacker-keyed entries before all dimensions pass, so sustained unique-subject traffic can grow the snapshot without bound and inflate write cost. **Medium:** service and budget are validated independently, so a mismatched pairing can draw a more generous quota than its policy intends; a readable but malformed snapshot is trusted without schema validation and can bypass rate comparisons, never sweep, or throw on startup; and `release()` marks a lease released before confirming the response, so a failed release cannot be retried and can hold a concurrency-one subject for up to four minutes. The relay suite's 31 passing tests exercise `SharedGate` and one durable concurrency case, not rate limits, window boundaries, malformed state, restart restoration, storage failure, or resource growth. Fix and cover these before any relay deployment.
- **P0-18 — Capability issuance is undefined.** Maker/taker identity proof, root-key custody, issuance auditing, nonce/replay policy, rotation overlap, revocation, rate limits, and service authentication have no approved production design.
- **P0-19 — HPKE is not production-operational.** The RFC 9180 primitives need independent review, an HSM/KMS recipient-key resolver, end-to-end production-shaped tests, key lifecycle drills, and a decision on whether maker quotes must also be end-to-end encrypted from the relay.

### Chain receipts, finality, and reconciliation

- **P0-20 — No constructible production configured-chain verifier exists.** `src/lib/settlement-receipt-chain.ts` exposes a nominal capability but intentionally has no public constructor/composition root and always refuses execution. The separate server-only localnet authority fixture does not satisfy this production gate.
- **P0-21 — No generated pinned-ABI decoder.** *Generator only; row stays open.* `scripts/generate-abi-decoder.mjs` plus the manifest schema and fixtures under `docs/evidence/abi-manifests/` can generate a decoder bound to a pinned manifest. **Still absent:** an accepted canonical ABI, real selectors, a deployed contract address, class hash, and deployment block to pin it to — none of which can exist before the canonical Cairo contracts do. **Known defects:** decoded names are validated for identifier syntax only (`scripts/generate-abi-decoder.mjs:147-160`), so a manifest naming a field `stage`, `status`, or `blockNumber` silently overwrites decoder-owned authority fields; and an explicit `--artifact` bypasses the governed index (`:631-635`), letting a manifest self-declare `productionEligible` and a closed P0-21 status in generated output.
- **P0-22 — No approved independent RPC quorum.** At least two independently administered, exact reviewed HTTPS origins and disagreement rules are missing.
- **P0-23 — RPC egress is not hardened.** *Local capability only; row stays open.* `scripts/egress-policy.mjs` is a shared server-only module — now consumed by `scripts/verify-token-identity.mjs` rather than duplicated — that resolves hostnames, refuses every non-public IPv4 and IPv6 range including IPv4-mapped forms, validates every resolved answer, pins the validated address through connection establishment against DNS rebinding, disables socket reuse, refuses redirects, and applies deadlines and response-size limits. **Still absent:** application to production RPC members, an approved egress allowlist, and TLS/SNI/Host consistency checks. **Known defect:** a refused redirect throws without cancelling the response body (`scripts/egress-policy.mjs:434-435`, unlike the re-resolution path at `:422-432`), so a hostile RPC can return redirect headers followed by an endless body and leak the socket after the deadline timer is cleared.
- **P0-24 — No durable finality/reorg authority.** Canonical block-number membership, finalized policy, persistent freshness, reorg invalidation, UI rollback, operator alerting, and maker reconciliation are absent.
- **P0-25 — No production settlement reconciliation.** Reservation, custody submission, escrow state, finalized events, claim/timeout, inventory release, and accounting are not joined by an authoritative service.

### Security, operations, and release

- **P0-26 — No independent security acceptance.** Cairo, protocol, browser, HPKE/relay, maker service, custody, and operations have no accepted external review/remediation record.
- **P0-27 — No production operational controls.** Monitoring, privacy-safe logs, alerts, on-call response, pause/drain/refund procedures, stuck-claim handling, maker default response, end-of-day reconciliation, and key/offboarding drills are absent.
- **P0-28 — No immutable approved baseline.** *Partially closed by local evidence only.* The committed parent baseline is `e4084f301a3d4f4ade312d443b8a00e65f674871`, with rollback target `4e32ef1ceb932610a0fd98ff56f37ef25464816c`; this validated follow-up change set was uncommitted at capture time, so its delivering commit is not attested here. A deterministic CycloneDX 1.5 SBOM is generated from the lockfile and byte-checked in local gates, registry dependencies are bound to canonical package-name/version tarball URLs, the reviewed vendored tarball's bytes are checked against a pinned SHA-256, and two production-shaped passes rebuild `@app20/privy` before Vite and produce byte-identical package and app artifacts. **Still blocked:** a delivering commit attested externally, CI provenance attached to that exact commit and SBOM digest, a release signature, reproduction by two independent builders, and explicit checkpoint approval. Single-machine repeatability is not independent reproduction.
- **P0-29 — No canonical Sepolia soak.** Historical proofs are denylisted. A bounded real-token, two-independent-maker soak must cover both directions, fill/claim, timeout/refund, refusal, restart, relay outage, ambiguous submission, RPC disagreement, reorg, key rotation/revocation, restore, and drain.
- **P0-30 — No Mainnet authorization.** Mainnet needs a later, separate, explicit, tiny hard-capped approval after every earlier gate passes.
- **P0-31 — No viewing-key or operator-secret leakage may be introduced.** Viewing keys, maker/settlement/HPKE private keys, directory roots, and capability secrets must remain absent from browser bundles, client storage, logs, analytics, crash reports, and artifacts.
- **P0-33 — No user mailbox key rotation, revocation, or compromise recovery.** *Risk disclosure implemented; protocol remains open.* The mailbox recovery phrase deterministically derives the Mail signing key (`src/lib/mail-auth.ts`), so anyone holding it can both decrypt correspondence and mint payment requests that pass the current Mail-signature check. Onboarding, backup/restore, `/pay`, and invoice surfaces now state that authority and limit what signature verification proves. These copy changes provide no revocation. The app still correctly refuses to overwrite a registered key, and the contract still has no enforceable key epoch, revocation path, correspondent transition, or multi-epoch old-mail recovery. [`APP20_MAIL_KEY_ROTATION_HANDOFF.md`](APP20_MAIL_KEY_ROTATION_HANDOFF.md) specifies the unimplemented Cairo/application handoff. **P0-33 stays open until that on-chain design, application migration, recovery flow, tests, review, and deployment evidence exist.**
- **P0-34 — No legal, regulatory, or data-protection launch acceptance.** The repository defines no privacy policy, terms, data-controller identity, retention schedule, rights process, or operator/maker eligibility, sanctions, and licensing review, and exposes no such surface in `src/app/routes.ts`. `packages/privy/docs/PROXY.md:117-120` itself requires a privacy/retention policy that does not exist. The technical disclosures are honest and local purge controls exist; the missing item is organizational policy and approval, which no engineering change can supply.
- **P0-35 — No third-party licence inventory, policy, or generated release notices.** `scripts/generate-sbom.mjs` emits identity, scope, integrity, and source but no licence field, so the committed SBOM records no licence for any of its 755 components, and `scripts/check-dependency-review.mjs` cannot detect a licence change. Three OFL-1.1 fonts are redistributed as binaries in `dist`, which is the entire deployable surface, with no accompanying notice; `NOTICE` covers only the starter-kit MIT material.

## P1 — RFQ product and UX gaps

- **P1-01 — Persistent environment status.** `/rfq` should keep `LOCALNET DEMO`, `SEPOLIA RFQ DISABLED`, or `MAINNET RFQ DISABLED` visible through quote, confirmation, settlement, and evidence states.
- **P1-02 — Maker cohort visibility.** *Locally closed.* The cohort panel shows governed cohort size and the invited/responded/refused/unavailable breakdown, maker-directory epoch, checkpoint and freshness state, per-maker key status and validity deadline, invitation status, and coarse capacity bands. An expired or rotated key cannot be presented as eligible, and the strict schema still rejects unknown or sensitive fields rather than defaulting them. The cohort itself remains a local fixture, so P0-13 and P0-14 stay open.
- **P1-03 — Quote comparison.** Show every verified response, expiry, capacity/refusal state, and deterministic selection rationale before the user accepts one.
- **P1-04 — Explicit cancellation.** Add decline/cancel before funding and prove durable release of every reservation.
- **P1-05 — Expiry UX.** Add countdown, non-executable expiry transition, refresh/requote, and stale-quote explanation.
- **P1-06 — Active and historical RFQs.** Add durable `New`, `Active`, and `Activity` views for requested, quoted, selected, funded, filled, claimable, settled, expired, refundable, refunded, refused, and quarantined states.
- **P1-07 — User-oriented identifiers.** *Locally closed.* RFQ, quote, reservation, and deal identifiers are copyable from the active card, final review, and activity records through one shared control. Each copy button carries a distinguishing accessible name and each identifier carries an explicit authority label separating a local reference from a localnet chain-verified value.
- **P1-08 — Fee disclosure.** Separate maker spread, STRK20 pool fee, network gas/sponsorship assumptions, and any APP20 fee before execution.
- **P1-09 — Full-fill policy.** State `Full fill only` until partial fills are specified consistently across quotes, reservation, escrow, receipt, accounting, and UI.
- **P1-10 — Refusal recovery.** Show maker-response summary and reservation release, with `Start new RFQ`; public execution remains a separate explicit route.
- **P1-11 — Funding readiness.** *Locally closed for the reviewed Wallet API surface.* `/funding` states the wallet-declared STRK20 funding actions, canonical asset eligibility and decimals for the active network, and the public shield/unshield legs. Wallet API 0.10 exposes `strk20InvokeTransaction` and `strk20Balances` but no declared note-maturity capability or metadata method, so APP20 truthfully shows `not exposed by this wallet` and does not claim it can become available from today's declaration. Showing maturity would require a future reviewed dapp-facing Wallet API or Wallet Standard feature that explicitly declares and returns note-maturity evidence without APP20 probing private balances. Funding controls stay hidden until the implemented readiness model passes.
- **P1-12 — Market reference clarity.** CoinGecko is public, non-executable context; show retrieval time, stale/error state, and `not an RFQ quote` next to the chart.
- **P1-13 — Maker terminology.** Use `maker` in product copy; retain `solver` only as internal protocol terminology.
- **P1-14 — Mobile hierarchy.** *Locally closed.* Browser evidence asserts DOM priority of environment, RFQ ticket, quotes/confirmation, and lifecycle ahead of the public chart, funding education, public send, cross-chain review, and recovery utilities, with no horizontal overflow at 320, 375, 768, and 1440 px.
- **P1-15 — Surface separation.** Public send, cross-chain dry review, funding, and Privy recovery are separate secondary routes with `Not RFQ settlement authority` boundaries, so wallet custody and RFQ execution are not conflated.
- **P1-18 — Authority presentation is localnet-only.** `src/app/rfq/rfq-authority.ts` accepts only exact runtime/account/chain/RFQ/deal-bound projections from the build-gated local authority service, derives every visible label from the status enum, expires its non-serializable live mark, and demotes a restored `authoritative` row to `stale`. This is same-devnet fixture authority only; production configured-chain authority remains unconstructible.
- **P1-16 — Accessibility and navigation regression evidence.** *Locally closed.* `tests/ui/rfq-accessibility.spec.ts` asserts landmark and heading structure with exactly one non-skipping `h1`, accessible names and roles for navigation, the authority strip, the maker cohort, every copy control and the primary action, unambiguous copy-control names, keyboard-only reachability with a visible focus indicator and focus landing in the labelled region after hash navigation, colour-independent authority state, and 200% zoom reflow at a 640 CSS-pixel viewport. Two real defects found this way were fixed: connected-wallet overflow at 640 px and header overflow at 320 px. Reflow uses the standards-equivalent halved viewport rather than browser chrome zoom, and no assistive-technology user testing has been performed.
- **P1-19 — Late RFQ completion can inject records across account and network scopes.** `src/app/rfq/LocalnetPrivateIntentDesk.tsx:490-492` invalidates on account, chain, or provider change, but an in-flight quote continues from `:813` and persists and displays at `:919-921` without rechecking scope. Observed live: switching Alice → Bob mid-flight showed Bob the exact selected quote, amount, maker responses, and timing; switching LOCAL → SEPOLIA surfaced completed localnet records with their identifiers under a network that simultaneously claims records need the exact connected context. Value actions stayed disabled throughout, so this is an information-scope defect rather than a value defect.
- **P1-20 — Storage-unavailable recovery guidance contradicts the fail-closed request gate.** `src/app/rfq/RfqRecoveryCard.tsx:13-19` tells a user whose IndexedDB is blocked that they may "continue with a new request", while `src/app/rfq/RfqWorkspace.tsx:1116-1122` deliberately blocks every request until storage and unresolved-deal discovery load. The gate is correct; the guidance sends users and support into a dead end.
- **P1-17 — Bundle/runtime compatibility warnings.** *Locally closed with recorded residuals.* Every emitted chunk is checked against recorded per-chunk byte budgets enforced during `npm run build`, and wallet discovery — the `@starknet-io/get-starknet-discovery@6.0.3` → `virtual-wallet@6.0.4` → `@module-federation/runtime`/`sdk@0.12.0` chain — loads only on explicit connect intent, outside the initial module graph. The emitted lazy wallet-discovery chunk **does ship** the dependency's direct `eval` of the `require` identifier; APP20 does not invoke that dormant Node CommonJS loader path during route load or wallet enumeration. The shipping CSP omits `'unsafe-eval'`, so the browser would block that expression if the dormant path were ever invoked. The build checker detects direct eval independent of string-literal quote style, fails if it enters the initial graph or appears outside the reviewed lazy chunk, and also requires emitted artifacts to contain no Node builtin import or externalization shim. `npm run check:csp` exercises eight routes under the policy that actually ships (derived from `spaSecurityHeaders()` in `workers/relay/src/headers.ts` with the `wrangler.jsonc` origins) rather than a static-asset policy the Worker would overwrite, and fails on any violation outside `scripts/production-csp-known-violations.json`, which is now empty: eight routes, including the opt-in price-history request, produce zero violations. `https://api.coingecko.com` is the one reviewed third-party origin, declared in code in `workers/relay/src/headers.ts` rather than runtime configuration, so widening it is a security decision rather than a deployment setting. It is reached only after the user opts into public market context, and that request discloses the user's IP and timing to that third party. **Residual:** the shipped lazy chunk retains direct eval behind the `'unsafe-eval'`-free CSP boundary; changing that boundary requires explicit compatibility review.

## Milestone-2 local product evidence (not production closure)

The local `/rfq` workspace now has persistent environment copy and New/Active/Activity navigation; deterministic all-quote comparison; an exact pre-disclosure invitation review; explicit final review, decline, reservation release, and cancellation-pending failure semantics; expiry countdowns; non-authoritative evidence labels; and separate rail-gated `/funding` and `/recovery/privy` routes plus `/send` and `/cross-chain-review`. Live quote terms are immutable until explicit cancellation releases reservations. `/swap/:tokenA/:tokenB` is a non-executable pair handoff that preserves either reviewed direction in validated search state. CoinGecko is opt-in and is never contacted on initial `/rfq` load. The market-planning route is `/rfq/markets/:tokenA/:tokenB/proposal`; the legacy pool-creation route redirects to it.

The lifecycle/storage model persists account-and-chain-bound IndexedDB convenience records labelled `Local resume record · not settlement authority`, rejects sensitive fields, quarantines malformed/cross-context records, expires stale quotes, and records submission-unknown transaction hashes without any automatic resubmission. The Active view resumes only through fresh server and wallet revalidation. Localnet claim/refund continuation, chain verification, reorg rollback, and maker reconciliation are implemented; production configured-chain authority remains unavailable.

P1-01, P1-03, P1-05, P1-08, P1-09, P1-10, P1-12, P1-13, and P1-15 have local implementation evidence. P1-04 is locally strengthened by execution/cancellation interlocks but remains partial pending replicated durable release. P1-06 remains partial: saved labels and read-only local reconciliation are not a production-resumable lifecycle. No P0 production row is closed by this milestone.

### Local authority and reconciliation evidence (M8–M10)

The build-gated localnet service now composes a server-only fixed decoder for the legacy `App20Escrow` fixture, pinned ABI digest, runtime epoch, chain alias, escrow address, dynamic local class hash, exact event selectors, deal and quote/coordinator terms, transaction membership, and event coordinates. Two separately modeled readers intentionally observe the **same devnet**; agreement is local fixture evidence, never independent production RPC quorum evidence. Its durable monotonic journal publishes finality, disagreement, staleness, and reorg invalidation before the browser projection. A reorged terminal deal durably reclaims the coordinator market fence and cannot be automatically resubmitted.

The real localnet composition root now joins exact coordinator selection, maker WAL reservation/fence/quote/terms, custody fill hash, and the durable authority lifecycle. Ticket creation durably binds the settlement target into the selected maker WAL. Expiry and status-4 convergence only advance coordinator observation; they do **not** release maker inventory. Missing evidence remains pending; disagreement, unavailable readers, substituted hashes, mutated terms, unknown outcomes, and reorgs quarantine. Only an exact authoritative settled/refunded lifecycle may invoke the maker's authenticated terminal-reconciliation endpoint, using one stable idempotency key; the maker WAL transition and reconciliation journal both survive response loss and restart. Startup re-verifies every stored authority row before serving, and uncertain journal mutation fail-stops new RFQs without resubmitting value operations. The unsigned deterministic harness covers both RFQ directions, claim, timeout/refund, refusal, restart, reader outage/disagreement, reorg rollback, and reconciliation without keys, signatures, broadcasts, or public-network access. Production configured-chain authority, public RFQ transport, and value authorization remain unconstructible and hard-disabled.

## Milestone-3 authority presentation and usability evidence (not production closure)

`/rfq` now carries one persistent `Private RFQ` page heading, moves focus to a labelled region after New/Active/Activity hash navigation, and keeps a single `h1` with a descending heading order. Every saved record renders one enum-derived authority strip that separates `Local observation`, `Verification pending`, `Finalized on the configured chain`, `Reader disagreement`, `Reorg-invalidated`, and `Quarantined`; disagreement, reorg, and quarantine block the record's resume action and say so. A restored `authoritative` row is shown as `Verification pending` so a stale or forged IndexedDB row cannot keep claiming a finalized settlement, and a forged label is discarded in favour of the enum label. Storage, deal-read, offline, and quarantine failures now render a recovery card with a verify-only retry that never resubmits. The invited-maker cohort is a responsive card grid rather than a five-column table, final review leads with sell/receive/maker/clocks/fees/refund/authority before a `Protocol details` disclosure and a full-width primary action, and every verified response/refusal plus deterministic selection rationale remains visible before final review. Lifecycle enums render as plain language, activity records are individually headed with distinguishing copy-button names, and `/funding`, `/send`, `/cross-chain-review`, and `/recovery/privy` share one secondary-rail shell carrying environment, `Not RFQ settlement authority`, and `Back to RFQ`; Public Send is labelled unavailable rather than actionable. Market proposal moved to `src/app/rfq/markets/proposal/` with an `RFQ / Markets / Pair / Proposal` breadcrumb while the hash-preserving `/pools/create/:tokenA/:tokenB` redirect is retained.

Browser evidence at 320, 375, and 1440 px reported zero horizontal overflow, no console or page errors, `/vault#activity` preserving its hash into `/rfq#activity`, the legacy pool bookmark redirecting with `#review` intact, and keyboard-only navigation reaching `Active` and landing focus on the `Active RFQs` region. P1-16 gains this evidence but stays open pending screen-reader and 200% zoom passes; P1-14 and P1-15 gain local evidence. This milestone closes no production P0 row: M8–M10 authority is a same-devnet local fixture only, while the production configured-chain verifier, independent readers, canonical contracts, and public value authorization remain unavailable.

## Milestone-4 product completeness and supply-chain evidence (not production closure)

Every P1 row that can be closed without external operators, audits, custody, or a public network is now closed: P1-02, P1-07, P1-11, P1-14, P1-16, and P1-17 join the earlier set. P1-04 and P1-06 stay partial by definition, because durable release and a resumable lifecycle mean replicated independently administered state, which localnet cannot supply.

The supply-chain and baseline work adds local evidence toward P0-28 without closing its immutable-source requirement. `npm run test:all` now includes a supply-chain suite; `scripts/generate-sbom.mjs` derives a deterministic CycloneDX 1.5 SBOM from `package-lock.json` with no network access, no wall-clock timestamp, and no random serial number; `scripts/check-dependency-review.mjs` fails on any entry lacking an integrity hash, its own canonical registry package-name/version URL (or the exact vendored exception), or SBOM byte agreement, and it verifies the vendored tarball bytes against a pinned SHA-256; and `scripts/check-build-determinism.mjs` runs the production workspace package build before each isolated Vite pass and compares both outputs. `SECURITY.md` records the private reporting channel, scope, absent audit, absent bounty, and the privacy boundary. None of that is CI provenance, a signature, independent reproduction, or independent security acceptance.

One honest correction landed here. A static-asset `_headers` policy was written first, then deleted: `wrangler.jsonc` runs the Worker first and `serveAsset()` overwrites asset security headers, so that policy would never have reached a browser while appearing to be enforced. The CSP gate now drives built assets through `createRelayHandler()` with a stub `ASSETS` binding, checks the exact CSP emitted by the Worker's real `serveAsset()` path, and requires exact blocked-URI and occurrence-count equality with the baseline. This also exposed the recorded CoinGecko `connect-src` residual under P1-17.

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
