# @app20/private-intents

Taker intents over STRK20 notes, sealed invited-maker quotes, and a
fill-or-refund lifecycle. APP20 is the private venue and verifier, not the
user's counterparty. Any future NEAR 1Click use remains a separate liquidity
warehouse behind the dry-only boundary.

```text
intent  → invited makers reserve inventory and return scoped offers
        → verify every signature; select best amount deterministically
        → accept consumes one quote nonce, then locks the sell note
        → selected maker delivers ≥ quoted buyAmount before expiry
        → otherwise refund after expiry
restock → fills net per token; residuals ≥ minBatch round up to a
          standard denomination; smaller residuals wait
```

## Boundaries

- **No custody.** Canonical production escrow authority is not implemented or
  configured. Historical proof fixtures are runtime-ineligible; this package
  builds and validates, fail-closed.
- **No live 1Click.** `PricingSource` is injected; review builds back it with
  the dry-only connector fixture.
- **Inventory-first.** A signed quote carries an opaque, expiring reservation
  identifier—not the maker's balance. Fill from pre-positioned notes and
  restock later; never take a note and hedge after.
- **Honest netting.** `planRestock` reduces amount/timing correlation on the
  public hedge. A same-size instant restock is still correlatable, and this
  package never claims otherwise.
- **Signed sealed quotes.** `selectBestSolverQuote` verifies every invited
  maker before deterministic ranking. `acceptQuote` consumes only the selected
  nonce. A digest is consistency, not authenticity; a checksum is never
  authorization.
- **Canonical Starknet contracts.** Intent, quote, helper, and inventory token
  comparisons use the shared bounded-felt canonicalizer, so case and leading-zero
  aliases cannot create distinct economic terms.

## Protocol foundations

`protocol.ts` freezes the first app-code schemas without claiming production
infrastructure:

- `PrivateRfqV1` binds exact u256 base units, floor, deadlines, registry,
  directory epoch, and configured settlement helper. The RFQ has no public-book
  representation and does not reveal the invited-maker set to each recipient.
- Signed maker-directory epochs are deterministically ordered, predecessor-bound,
  validity-bounded, and verified against the authority key valid at the signed
  `issuedAt` time. Quote and transport keys retain historical validity windows
  and explicit revocation times; public JWKs reject private `d` material.
- `EncryptedRfqEnvelopeV1` fixes maker-specific RFC 9180 HPKE suite metadata,
  canonical AAD, replay nonce, expiry, and fixed reviewed padding buckets.
  Browser-safe `hpke.ts` seals once per invited maker with pinned
  `@hpke/core@1.9.0`; the separate `@app20/private-intents/hpke-open` export
  opens through a maker key-id handle and must never enter the browser graph.
  Openers require decrypted plaintext to equal canonical `PrivateRfqV1` JSON.
  The upstream library passes RFC/Wycheproof vectors but is **not formally
  audited**. Padding does not hide timing, source, maker fanout, or bucket size.
- `MakerReservationV1` provides monotonic fencing and legal reserve → select →
  begin-fill → consume/release/expire/quarantine transitions. The pure model is
  not storage; `@app20/maker-node` supplies the localnet fsynced hash-chain WAL.
  Replay now uses an async accepted/idempotent/conflict contract after
  successful HPKE authentication. The memory adapter is test/local only;
  production relay storage uses a SQLite Durable Object UNIQUE transaction,
  which is not maker custody or multi-host replication.

Directory signatures authenticate canonical epochs. RFQ/receipt/reservation
digests only bind supplied bytes and never authorize value or prove chain truth.

## RFQ v3

The additive localnet-only RFQ v3 protocol keeps the exact size and floor in the
browser while binding signed maker schedules to pre-funded escrow locks:

- `size-buckets.ts` defines the fixed STRK/USDC ladder, exact boundary rules,
  maker-side ladder validation, and compact UI labels.
- `rfq-v2.ts` canonicalizes bucket-only requests, creates high-entropy taker
  secrets, derives Cairo-compatible Poseidon commitments, and provides a closed
  decimal-string wire codec.
- `schedule.ts` validates one-to-four-point u128 schedules, evaluates them with
  Cairo-identical floor arithmetic, inverts them, and reports E18 unit prices.
- `quote-v3.ts` signs canonical lock references and verifies the RFQ, active
  P-256 key, and caller-supplied `get_lock` state before a quote is eligible.
- `selection-v3.ts` deterministically chooses one covering lock or greedily
  assembles up to four fills, then applies the browser-only floor.
- `transcript.ts` creates digest-bound fair-loss transcripts for every invited
  maker and verifies each maker's own outcome without disclosing the exact size
  as a separate transcript field.
- `mids.ts` validates signed STRK/USDC indicative mids and aggregates their
  median and full-range dispersion.

The existing HPKE envelope remains intentionally typed to canonical RFQ v1
plaintext in both its opener and authenticated acceptance path. Generalizing
that path is not a thin sealing-only change, so this package does not
misrepresent RFQ v2 as accepted by the reviewed v1 envelope. Production and
public-network RFQ settlement remain immutable-off.

## Operations policy

`operations.ts` adds production-shaped but non-custodial controls:

- predecessor-ready risk manifests with independent Risk and Operations approvals;
- short-lived exceptions requiring two distinct Risk approvers plus
  Security/Compliance;
- fail-closed per-trade, gross, net, daily, reconciliation, and outstanding
  escrow checks;
- finalized, consented, independent-fill netting before any public restock;
- minimum dwell, standard-denomination rounding, approved-venue enforcement,
  and explicit public-correlation warnings;
- pause and drain-only controls that never disable claims or refunds;
- browser-safe capacity bands and utilization without raw inventory balances.

This is operational netting, not atomic two-taker crossing, a proof of reserves,
or proof that maker notes cannot be spent elsewhere. Atomic crossing needs a
separately designed and audited contract.
