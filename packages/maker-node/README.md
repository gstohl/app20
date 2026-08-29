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
- Offers and health responses expose no raw private balances or private keys.

## Localnet service

`scripts/localnet-maker-node.mjs` adapts this package to the real vendored
privacy pool on native devnet. The localnet orchestrator creates four
predeployed accounts: Alice and Bob remain demo users, while two extra accounts
become distinct maker custody domains. Each maker service discovers its own
notes, signs with its own deterministic **localnet-only** P-256 fixture, and
submits its own private escrow fill. The coordinator only fans out requests,
returns sealed offers, releases losers, and forwards the selected fill.

The Playwright journey SIGKILLs the selected maker after quote selection. The
orchestrator restarts it with the same auth scope and WAL, after which the
selected reservation settles successfully.

## Honest boundary

This is production-shaped localnet, not production custody:

- Devnet itself exposes deterministic predeployed account keys. Each child reads
  only its configured account index, but the fixture is not an HSM or TEE.
- Localnet HTTP remains authenticated loopback HTTP. Production-shaped
  `openEnvelopeThenReserve` uses the reviewed HPKE opener and async replay seam,
  but no HSM/KMS key resolver or deployed relay is configured.
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
