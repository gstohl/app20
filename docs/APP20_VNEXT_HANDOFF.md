# APP20 Escrow VNext — Cairo team and audit handoff

**Status: app-side expectation only. No Cairo VNext exists, no selector/class hash/address is known, and nothing here authorizes deployment or value movement.** The localnet `App20Escrow` V2 and `ClaimTicket` must not be reused for Sepolia VNext.

The frozen TypeScript ↔ Cairo handoff is [`APP20_VNEXT_INTEGRATION_CONTRACT.md`](./APP20_VNEXT_INTEGRATION_CONTRACT.md). It does not change this unavailable status; the Cairo team exclusively owns all `.cairo` implementation and tests.

## Decisions

- Create a new immutable/versioned quote-bound escrow and **replace** ClaimTicket with a new reviewed version. Do not silently reuse localnet class hashes.
- Pre-quote context domain: `app20/escrow-vnext-settlement-context/v1`; it excludes winner/reservation/final buy fields so a maker can sign it without a hash cycle.
- Final post-selection commitment domain: `app20/escrow-vnext-commitment/v1`; it binds the pre-quote context digest, selected signed quote digest, reservation/fence and exact winning amount (`src/lib/escrow-vnext.ts`).
- Quote domain: `app20/private-intent-quote/v2`; it binds the pre-quote context, never the final commitment. V1 quotes are localnet-only.
- Fund/Fill/Claim/Timeout selectors and event selectors remain `null` until reproducible Cairo artifacts exist; `assertVnextAbiReady` therefore fails closed.
- Claim/Timeout require destination-bound Wallet API `${openNoteIds[n]}` calldata. This unresolved production path must not be bypassed.

## Required invariants

1. A deal stores exactly one canonical commitment digest and immutable chain/escrow/class/pool/registry/directory/RFQ/quote/reservation/asset/account/deadline/ticket identity.
2. Funding accepts exact positive base units and creates exactly one deal/ticket identity; duplicate funding cannot overwrite it.
3. Fill requires the selected quote digest, reservation ID and monotonic fence; wrong/short asset delivery fails atomically.
4. Claim and timeout are mutually exclusive, consume/burn the deal-unique ticket once, and route only through destination-bound open-note placeholders.
5. Deadline boundaries are explicit and tested; fill cannot occur after expiry and timeout cannot occur before it.
6. Every state transition emits the pinned selector and enough data to reconstruct every receipt binding field. Event address is the escrow.
7. Reentrancy, replay, class substitution, token aliasing, zero addresses, stale fences, overflow and malformed calldata fail closed.
8. Claim/refund remains available during pause/drain; operator controls cannot redirect value.

## Reproducible artifact procedure

The Cairo team must supply a reviewed source commit, Scarb/Cairo pins, exact build command, Sierra/CASM and ABI bytes/digests, declared class hashes, constructor calldata, chain ID, deployment transaction, and independent remediation acceptance. Two independent builders must reproduce hashes. App manifest constants are updated only from that accepted evidence; never from a UI, explorer guess or unreviewed RPC.

## Required tests/reviews

Property/invariant and integration tests must mutate every committed field and cover duplicate/reordered transitions, wrong class/address/selector/event payload, stale fence, ticket duplication, deadline edges, replay, reentrancy, token behavior, pause/drain, claim/timeout race and reorg recovery. Cairo, protocol, browser, maker/custody and operations reviews remain independent release gates.
