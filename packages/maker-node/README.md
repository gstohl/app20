# @app20/maker-node

Server-only foundations for independently operated APP20 invited makers.

## Guarantees in this slice

- Each maker uses a distinct process, settlement account, quote key, private-note
  inventory, auth token, and `0600` reservation WAL.
- Quote signing happens only after a durable reservation snapshot is fsynced.
  Repeated signing returns the persisted signature; changed canonical terms are
  refused as equivocation.
- WAL records are sequence- and hash-chain-bound. A truncated final write is
  discarded, a modified complete record fails closed, and a PID lock prevents
  two live writers from opening one custody database.
- Reservation fences advance through reserve → select → begin-fill →
  consume/release/expire/quarantine. `begin-fill` is persisted before wallet
  execution, so concurrent fill calls cannot spend the same inventory. Unknown
  submission outcomes and crash-recovered in-flight attempts quarantine rather
  than release inventory.
- Intent replay history is retained independently from capacity accounting.
  Known expired/released inventory can become available again, while unknown or
  authority-quarantined inventory stays locked across pruning and restart until
  an exact, higher-revision authoritative terminal reconciliation releases it.
- The authority quarantine operation is idempotent and binds the reservation,
  intent, quote, selection fence, deal, assets, amounts, deadline, ticket,
  outcome, authority digest, and authority revision before it changes capacity.
- V3 accepts only reviewed STRK/USDC ladder buckets. It builds a one-to-four-point schedule within available private inventory, evaluates economics at maximum fill, persists `locking`, and signs only after `get_lock` confirms the exact RFQ/commitment/pair/schedule/expiry/ticket binding.
- V3 lock records retain exact schedule, maximum collateral, taken A/B, quote digest, and maker settlement hashes. Every five-second localnet scan pulls non-zero proceeds and unused collateral after expiry; unknown outcomes quarantine.
- Short-lived maker mids use the quote key. Full selection transcripts are journaled with the maker's consistency result; quoted makers verify their digest and loss price.
- Offers, lock lists, mids, transcripts, and health responses expose no raw private balances or private keys.
- Durable field strings, felt hex, lock files, and reservation-ledger HTTP bodies are length-capped. Oversize ledger responses are cancelled without JSON parse.

## Localnet service

`scripts/localnet-maker-node.mjs` adapts this package to the real vendored
privacy pool on native devnet. The orchestrator creates distinct demo-user and
maker custody accounts. Each maker discovers only its own notes, signs with a
deterministic **localnet-only** P-256 fixture, and handles:

- `POST /v1/quotes-v3`: bucket validation, inventory-capped schedule, on-chain
  token B lock, receipt/readback, then quote signature;
- `GET /v1/mids`: a fresh 30-second signed 2.00 (A) or 2.01 (B) USDC/STRK mid;
- `POST`/`GET /v1/transcripts`: verify/journal the full fair-loss transcript;
- `GET /v1/locks`: no-secret durable lock records; and
- automatic `SettleProceeds` / `ReleaseCollateral` scans every five seconds.

The coordinator fans out RFQ v2, journals quote/refusal outcomes, verifies mids,
and forwards the same transcript to all invited makers. It never receives raw
maker inventory. The request contains a fixed ladder bucket rather than exact
size/floor, although transcript winning allocations can reveal size after
selection.

Legacy reservation/fill endpoints and WAL records remain for the mounted v1
desk and its existing restart journey. The v3 service/data path is implemented,
but the RFQ presentation does not yet invoke it.

## Honest boundary

This is production-shaped localnet, not production custody:

- Devnet itself exposes deterministic predeployed account keys. Each child reads
  only its configured account index, but the fixture is not an HSM or TEE.
- Localnet HTTP remains authenticated loopback HTTP. Production-shaped
  `openEnvelopeThenReserve` uses the reviewed HPKE opener and async replay seam,
  but no HSM/KMS key resolver or deployed relay is configured.
- On-chain v3 collateral prevents default on the signed schedule, but does not
  replicate RFQ plans, transcript history, settlement attempts, or accounting.
- The WAL is single-host and PID-locked, not a replicated linearizable database.
  `LocalnetWalReservationRepository` is labelled localnet-only. Production
  repository/CAS-fence, custody, quote-signer, admin-auth and reconciliation
  ports fail closed through unavailable adapters.
- Backup/failover/PITR, multi-host linearizability, independent administration,
  dual control and key rotation are required operator procedures/interfaces;
  this repository does not claim to implement or evidence them.
- Localnet proof bytes are the upstream mock. Cairo VNext, deployment, audit,
  key governance, operator reconciliation, and Mainnet release remain closed
  gates.
