# APP20 Private RFQ

APP20 joins three surfaces into one workflow:

1. **RFQ** — inventory-backed private USDC↔STRK quote and settlement.
2. **Mailbox** — encrypted correspondence, authenticated backup, and non-authoritative evidence.
3. **Counterparties** — a device-encrypted address book with RFQ and Mail handoffs.

APP20 is a bookless invited-maker venue using the existing STRK20 privacy pool. It does not create a pool, AMM, public order book, or automatic public fallback. See [`GAPS.md`](GAPS.md) for open engineering work.

## Localnet-only boundary

RFQ v3 contracts, protocol modules, maker nodes, localnet routes, browser orchestration, Mail backup, invoice handoff, maturity controls, maker mids, transcript acknowledgements, and atomic Take are wired into the build-gated localnet desk. The browser journey is localnet evidence only: it does not authorize configured-chain or public-network RFQ. Legacy `Fund`/`Fill`/`Claim`/`Timeout` lifecycle rows remain recoverable rather than being reinterpreted as v3.

Production/public-network RFQ remains immutable-off. Worker `/api/rfq/*` routes return `404`, Mainnet and Sepolia escrow helper addresses remain zero, and nothing in localnet authorizes a public deployment. The localnet coordinator and two maker services communicate over authenticated loopback HTTP; RFQ v2 is not carried by the existing production-shaped HPKE envelope, which remains typed to RFQ v1.

## RFQ v3 lifecycle

```text
Exact size + local floor
  → browser derives a fixed ladder bucket and ephemeral Stark authorization key
  → invited makers receive pair, direction, bucket, chain/helper, and expiry
  → each maker locks token B collateral with a one-to-four-point schedule
  → maker signs quote v3 only after the lock is confirmed
  → browser verifies signature + get_lock, evaluates at the local exact size,
    selects one lock or up to four fills, and applies the local floor
  → browser sends the selection transcript
  → one pool privacy_invoke(Take) atomically deposits total A and returns total B
  → maker workers pull proceeds and unused collateral after lock expiry
  → same-devnet chain authority verifies the Take totals
```

The STRK and USDC bucket ladders are fixed in base units. Makers reject custom bucket bounds, so a caller cannot encode an exact size in a bespoke interval. The request sent to a maker contains no exact sell amount and no floor. It contains the pair/direction, ladder bucket, RFQ identifiers, `takerCommitment`, helper/network context, and timestamps including the 90-second localnet lock expiry. The retained wire name `takerCommitment` means the x-coordinate of the taker's ephemeral Stark public key; it is not a hash or secret.

Each quote references an on-chain lock and a signed piecewise-linear schedule. The browser checks the maker's active P-256 key and signed RFQ context, then compares the RFQ id, taker public key, tokens, expiry, schedule, remaining collateral, ticket, and creation transaction hash with the `get_lock` record selected by `lockId`. Selection first prefers the best single schedule that covers the exact amount; otherwise it allocates deterministic depth across at most four distinct makers. A total below the browser-only floor is refused.

`Take` is all-or-nothing. Every lock must be open, unexpired, tied to the same RFQ and taker public key, and able to cover its evaluated payout. Cairo verifies an ephemeral Stark signature over the escrow address, RFQ/deal id, ordered tokens, and mandatory ordered `fillsDigest`. Any failed fill reverts the transaction. A successful Take creates one OPEN note for the aggregate token B output; there is no taker claim ticket, funded waiting state, maker fill call, or taker timeout/refund in v3. The private signing key is never calldata and is deleted after a terminal Take. The output note id/ownership is not covered by the signature, however, so a relayer or sequencer that obtains a valid signed Take can copy it and race the original while choosing another output note. `TAKE_EXISTS` makes the first accepted transaction terminal but does not remove this copy-sniping risk.

## Collateral and maker recovery

`App20Escrow` mints two units of a lock-unique `LockTicket` when token B collateral is locked. The two units become the maker's OPEN ticket note. At or after expiry, one unit authorizes `SettleProceeds` for earned token A and one authorizes `ReleaseCollateral` for unused token B. A zero side reverts and leaves that unit inert. Maker nodes scan every five seconds, read `get_lock`, submit only the required pulls, and persist transaction attempts and hashes in their hash-chained WAL. Transient RPC/read failures become durable `reconcile-pending`; uncertain submitted settlement becomes `settlement-unknown`. Neither state is complete or reusable inventory. Reconciliation retries with bounded backoff and only chain evidence can move the record to `taken`, `expired`, or `settled`; contradictory or irrecoverably malformed evidence remains quarantined.

The lock makes default on the signed schedule impossible for the collateralized amount, but it does not make local operations production-grade. Maker WALs and the coordinator journal are single-host state, deterministic devnet accounts are not HSM custody, proof bytes are fixture-grade, and configured-chain finality/reorg authority is not available.

The contract and recovery UI retain legacy `Fund`, `Fill`, `Claim`, and `Timeout` variants for compatibility. They are not the intended v3 product flow, must remain available in this release, and must never be silently reinterpreted.

## Fair-loss transcript and privacy limit

The transcript is digest-bound and records:

- RFQ digest, selection rule, bucket, creation time, and clearing unit price;
- one entry per invited maker with maker id, quote/refusal digest, outcome, and rank;
- `amountA` for each winning entry; and
- a SHA-256 digest of the canonical body.

The coordinator checks every entry against its durable quote/refusal plan and forwards the same transcript to every invited maker. It therefore sees winning allocations, and the Take orchestration endpoints later receive expected exact fills/totals; loopback transport does not hide these from the coordinator. A maker with a signed quote verifies that its own digest is present and, if it lost, that the clearing price is not below its quoted unit price. A refused maker currently journals receipt as inconsistent because it has no signed quote lock to verify.

There is no top-level `exactSellAmount` or floor field. However, winning `amountA` allocations can be summed, so the current post-selection transcript can reveal the exact sell size to every invited maker. “Bucket, not size” is true of the quote request, not an end-to-end property of the implemented transcript. This deviation is tracked in the implementation notes of [`APP20_RFQ_V3_DESIGN.md`](APP20_RFQ_V3_DESIGN.md).

## Indicative mids and note maturity

Each localnet maker signs a short-lived `STRK_USDC` indicative mid with its quote key. The localnet status service verifies fixture-key bindings, caches valid mids for five seconds, and returns them with lock and transcript counts. Browser operations code verifies the signatures again and aggregates the median and full-range dispersion. Maker A reports 2.00 USDC/STRK and maker B 2.01 in the fixture. CoinGecko remains a separate direct-browser opt-in and is not quote authority.

`readAccountDeposits` derives an estimate from public pool `Deposit` and `OpenNoteDeposited` events keyed to the connected account. Notes are treated as mature ten blocks after the observed event. The default scan is bounded to the latest 2,048 blocks and eight pages of 128 events. It does not use a viewing key and cannot see notes received by private transfer, so it is an estimate, not a complete private-balance or spendability oracle.

The localnet desk renders the maturity estimate and verified maker-mid context. It blocks quote solicitation while the estimate is unavailable or a matching deposit is immature and offers a local “Request quotes when mature” poller that sends nothing to makers until the public-event gate passes.

## Pay-any-token invoice path

Mail accepts a registry-resolved localnet USDC payment request as well as STRK. For USDC, **Pay privately with STRK** stores an account/chain-scoped, five-minute invoice handoff and opens `/rfq`. The v3 invoice model estimates a STRK bucket from the verified maker median with a 2% buffer, then finds the minimum selected schedule allocations whose USDC output reaches the invoice amount.

The localnet desk consumes the scoped handoff, requires a fresh verified maker median for preliminary sizing, minimizes the sell amount against verified schedules, and enforces the exact invoice amount as its floor. After a confirmed Take, it binds the request to the Take hash, Take block, USDC token, and exact invoice amount in state `awaiting-note-maturity`, then returns to Mail. At `takeBlock + 10`, Mail can reserve and submit the existing private memo-transfer path in USDC, then move through submitted to confirmed.

## Chain-anchored encrypted backup

The unlocked mailbox can back up contacts or RFQ history to self-addressed Mail. `BackupSnapshotV1` binds kind, monotonic sequence, owner, chain, helper, mailbox fingerprint, creation time, canonical payload digest, and an HKDF/HMAC authentication tag derived from the 32-byte mailbox seed.

If the snapshot fits one Mail envelope, it is encrypted to the mailbox key and posted inline. Otherwise the browser:

1. encodes the snapshot envelope;
2. derives a kind/owner/chain/sequence-specific AES-256-GCM key from the mailbox seed;
3. encrypts and zero-pads the blob to a 4,096-byte bucket, up to 1 MiB;
4. computes/uploads a CIDv1 raw sha2-256 block; and
5. posts a self-addressed encrypted Mail pointer containing the CID, padded size, and blob digest.

Restore authenticates every candidate before sequence ranking. Authenticated same-sequence disagreement is rejected as equivocation, and an unavailable or invalid newest authenticated RFQ backup cannot fall back to an older candidate. A pointer fetch tries configured gateways until one returns bytes whose CID matches, then checks pointer size/digest, authenticates and opens AES-GCM, verifies snapshot scope/MAC, enforces the local sequence high-water, and asks before a keep-newer merge. Rollback, ambiguous record/tombstone collisions, duplicates, oversized payloads, forged scope, and malformed lifecycle rows fail closed. Mail/IPFS evidence never proves RFQ settlement.

RFQ history payload v2 carries bounded authenticated portable tombstones as well as records. Forget wins over any included record for the same lifecycle id, including on a fresh database, and the tombstone is persisted before the row is removed. Export recursively strips signing-key fields. Every restored v3 row is durably marked `restoredFromBackup`, local, and non-authoritative; it has no `takerSigningKey`, cannot submit Take, and remains verify-only through reload, re-export, and re-import. A fresh device that receives only an old snapshot which predates a deletion cannot infer the missing newer tombstone, so operators must preserve the newest authenticated self-backup.

The localnet IPFS emulator binds only to `127.0.0.1:5054` and stores blocks in an in-memory `Map`; restart loses them. On a configured production deployment, the IPFS RPC service would learn the source network metadata, upload timing, CID, and padded ciphertext size; gateways would learn fetch timing and requested CID. They receive encrypted padded blob bytes, not snapshot plaintext. The APP20 relay only permits reviewed origins in CSP and does not proxy or pin blobs itself. Production blob storage fails closed unless both browser IPFS origin settings and matching relay `IPFS_ORIGINS` are configured. A settled Take queues the opt-in RFQ auto-backup for the next unlocked Mailbox session.

## Contact storage and recovery

The browser address book is AES-GCM encrypted under a random device-local key at `app20/address-book/v1/<wallet>`. The key lives in the same profile, so this protects against casual storage inspection, not XSS, malicious extensions, or code already running there. The new authenticated backup can carry contacts inline or through an encrypted blob. Legacy `contact_snapshot` v1 Mail remains readable.

Recovery requires the same connected wallet scope and the mailbox recovery phrase. Ready signatures are not encryption keys, and the Ready Mail path does not request a STRK20 viewing key. Restore never runs automatically; newer local contact timestamps win. Deleting a local contact or RFQ row cannot delete prior chain ciphertext, an IPFS copy, maker/coordinator records, or restored copies.

## Privacy boundary

| Protected from a stated observer                   | Still public or disclosed                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact size and floor during RFQ invitation         | Makers receive pair, direction, bucket, expiry, helper/RFQ bindings; transcript winner allocations can reveal size later                                                                                                                                                                 |
| Private note ownership and private transfers       | `LockCreated` schedule/collateral facts and public taker key, the Take signature and ordered fills, per-fill `LockTaken` amounts, aggregate `DealTaken` totals/digest, OPEN-note amount, helper use, and timing; output-note ownership is not signature-bound, leaving copy-sniping risk |
| Backup plaintext from Mail/IPFS operators          | Mail ciphertext metadata; IPFS CID, padded blob size, timing, and source metadata                                                                                                                                                                                                        |
| Mail plaintext and contact labels in ciphertext    | APP20/browser code while unlocked; mailbox-seed compromise decrypts retained ciphertext                                                                                                                                                                                                  |
| Device-local labels at rest from casual inspection | Code in the browser profile can read the local key and plaintext                                                                                                                                                                                                                         |

Mail, quotes, transcript digests, local lifecycle records, WAL entries, and backup pointers are evidence or resume material. Only the localnet contract plus pool-applied chain state confirms value in this fixture, and that same-devnet result is not production authority.
