# APP20 Private RFQ

APP20 joins three surfaces into one workflow:

1. **RFQ** — inventory-backed private USDC↔STRK quote and settlement.
2. **Mailbox** — encrypted correspondence, authenticated backup, and non-authoritative evidence.
3. **Counterparties** — a device-encrypted address book with RFQ and Mail handoffs.

APP20 is a bookless invited-maker venue using the existing STRK20 privacy pool. It does not create a pool, AMM, public order book, or automatic public fallback. See [`GAPS.md`](GAPS.md) for open engineering work.

## Localnet-only boundary

RFQ v3 contracts, protocol modules, maker nodes, localnet routes, browser data/orchestration modules, and Mail backup/invoice primitives are implemented for the build-gated localnet. **The RFQ presentation is not migrated yet:** `LocalnetPrivateIntentDesk.tsx` still drives the legacy v1 `Fund`/`Fill`/`Claim`/`Timeout` flow, while `DeskMarketBoard.tsx` and `OperationsDashboard.tsx` do not render the v3 mids, maturity, lock, or transcript models. The v3 path below is therefore an implemented lower-layer flow, not yet a complete clickable desk journey.

Production/public-network RFQ remains immutable-off. Worker `/api/rfq/*` routes return `404`, Mainnet and Sepolia escrow helper addresses remain zero, and nothing in localnet authorizes a public deployment. The localnet coordinator and two maker services communicate over authenticated loopback HTTP; RFQ v2 is not carried by the existing production-shaped HPKE envelope, which remains typed to RFQ v1.

## RFQ v3 lifecycle

```text
Exact size + local floor
  → browser derives a fixed ladder bucket and Poseidon taker commitment
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

The STRK and USDC bucket ladders are fixed in base units. Makers reject custom bucket bounds, so a caller cannot encode an exact size in a bespoke interval. The request sent to a maker contains no exact sell amount and no floor. It contains the pair/direction, ladder bucket, RFQ identifiers, taker commitment, helper/network context, and timestamps including the 90-second localnet lock expiry.

Each quote references an on-chain lock and a signed piecewise-linear schedule. The browser checks the maker's active P-256 key and signed RFQ context, then compares the RFQ id, taker commitment, tokens, expiry, schedule, and remaining collateral with the `get_lock` record selected by `lockId`. Selection first prefers the best single schedule that covers the exact amount; otherwise it allocates deterministic depth across at most four distinct makers. A total below the browser-only floor is refused. The quote also signs `lockTicket` and `lockTransactionHash`, but the current verifier neither compares the ticket with `get_lock.ticket` nor resolves that transaction receipt. These are evidence/provenance gaps even though Take uses current lock contract state rather than either quote field.

`Take` is all-or-nothing. Every lock must be open, unexpired, tied to the same RFQ and taker commitment, and able to cover its evaluated payout. Any failed fill reverts the transaction. A successful Take creates one OPEN note for the aggregate token B output; there is no taker claim ticket, funded waiting state, maker fill call, or taker timeout/refund in v3. The helper invocation carries `takerSecret` so Cairo can recompute the commitment: it is local during quoting but becomes transaction calldata at Take.

## Collateral and maker recovery

`App20Escrow` mints two units of a lock-unique `LockTicket` when token B collateral is locked. The two units become the maker's OPEN ticket note. At or after expiry, one unit authorizes `SettleProceeds` for earned token A and one authorizes `ReleaseCollateral` for unused token B. A zero side reverts and leaves that unit inert. Maker nodes scan every five seconds, read `get_lock`, submit only the required pulls, persist transaction hashes in their hash-chained WAL, and quarantine unknown outcomes rather than assuming inventory is free.

The lock makes default on the signed schedule impossible for the collateralized amount, but it does not make local operations production-grade. Maker WALs and the coordinator journal are single-host state, deterministic devnet accounts are not HSM custody, proof bytes are fixture-grade, and configured-chain finality/reorg authority is not available.

The contract still contains legacy `Fund`, `Fill`, `Claim`, and `Timeout` variants for compatibility. They are not the intended v3 product flow and are slated for an explicit later removal; they must never be silently reinterpreted.

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

The maturity data and maker-mid market model exist, but the current desk/funding presentation has not wired the v3 display or “request when mature” control.

## Pay-any-token invoice path

Mail accepts a registry-resolved localnet USDC payment request as well as STRK. For USDC, **Pay privately with STRK** stores an account/chain-scoped, five-minute invoice handoff and opens `/rfq`. The v3 invoice model estimates a STRK bucket from the verified maker median with a 2% buffer, then finds the minimum selected schedule allocations whose USDC output reaches the invoice amount.

After a confirmed Take, `recordInvoiceTakeSettled` can bind the request to the Take hash, Take block, USDC token, and exact invoice amount in state `awaiting-note-maturity`. At `takeBlock + 10`, Mail can reserve and submit the existing private memo-transfer path in USDC, then move through submitted to confirmed. The RFQ presentation does not yet consume the handoff or call `recordInvoiceTakeSettled`, so the complete STRK→USDC→payee journey remains unwired even though Mail completion and data-layer rules exist.

## Chain-anchored encrypted backup

The unlocked mailbox can back up contacts or RFQ history to self-addressed Mail. `BackupSnapshotV1` binds kind, monotonic sequence, owner, chain, helper, mailbox fingerprint, creation time, canonical payload digest, and an HKDF/HMAC authentication tag derived from the 32-byte mailbox seed.

If the snapshot fits one Mail envelope, it is encrypted to the mailbox key and posted inline. Otherwise the browser:

1. encodes the snapshot envelope;
2. derives a kind/owner/chain/sequence-specific AES-256-GCM key from the mailbox seed;
3. encrypts and zero-pads the blob to a 4,096-byte bucket, up to 1 MiB;
4. computes/uploads a CIDv1 raw sha2-256 block; and
5. posts a self-addressed encrypted Mail pointer containing the CID, padded size, and blob digest.

Restore scans the newest backup message for each kind. A pointer fetch tries configured gateways until one returns bytes whose CID matches, then checks pointer size/digest, authenticates and opens AES-GCM, verifies the snapshot scope/MAC, and asks before a keep-newer merge. Mail/IPFS evidence never proves RFQ settlement.

The localnet IPFS emulator binds only to `127.0.0.1:5054` and stores blocks in an in-memory `Map`; restart loses them. On a configured production deployment, the IPFS RPC service would learn the source network metadata, upload timing, CID, and padded ciphertext size; gateways would learn fetch timing and requested CID. They receive encrypted padded blob bytes, not snapshot plaintext. The APP20 relay only permits reviewed origins in CSP and does not proxy or pin blobs itself. Production blob storage fails closed unless both browser IPFS origin settings and matching relay `IPFS_ORIGINS` are configured.

RFQ export strips `takerSecret`, and imported evidence is marked local/non-authoritative. The current exporter does not include tombstone digests or reliably preserve the `restoredFromBackup` provenance required for unresolved v3 rows; the opt-in auto-backup preference is also not called after settlement. Those gaps are recorded in [`GAPS.md`](GAPS.md).

## Contact storage and recovery

The browser address book is AES-GCM encrypted under a random device-local key at `app20/address-book/v1/<wallet>`. The key lives in the same profile, so this protects against casual storage inspection, not XSS, malicious extensions, or code already running there. The new authenticated backup can carry contacts inline or through an encrypted blob. Legacy `contact_snapshot` v1 Mail remains readable.

Recovery requires the same connected wallet scope and the mailbox recovery phrase. Ready signatures are not encryption keys, and the Ready Mail path does not request a STRK20 viewing key. Restore never runs automatically; newer local contact timestamps win. Deleting a local contact or RFQ row cannot delete prior chain ciphertext, an IPFS copy, maker/coordinator records, or restored copies.

## Privacy boundary

| Protected from a stated observer | Still public or disclosed |
| --- | --- |
| Exact size and floor during RFQ invitation | Makers receive pair, direction, bucket, expiry, helper/RFQ bindings; transcript winner allocations can reveal size later |
| Private note ownership and private transfers | `LockCreated` schedule/collateral facts, Take's `takerSecret` preimage, per-fill `LockTaken` amounts, aggregate `DealTaken` totals, helper use, and timing |
| Backup plaintext from Mail/IPFS operators | Mail ciphertext metadata; IPFS CID, padded blob size, timing, and source metadata |
| Mail plaintext and contact labels in ciphertext | APP20/browser code while unlocked; mailbox-seed compromise decrypts retained ciphertext |
| Device-local labels at rest from casual inspection | Code in the browser profile can read the local key and plaintext |

Mail, quotes, transcript digests, local lifecycle records, WAL entries, and backup pointers are evidence or resume material. Only the localnet contract plus pool-applied chain state confirms value in this fixture, and that same-devnet result is not production authority.
