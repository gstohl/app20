# APP20 RFQ v3 — collateralized, size-blind, atomic settlement

**Status: implementation contract (2026-09-01).** This document fixes every open decision for the v3 program so that independent lanes (Cairo, protocol, maker, localnet services, browser, Mail/backup) build against one specification. Where this document and older docs disagree, this document wins for localnet. Production/public networks stay immutable-off; nothing here changes the release boundary in [`APP20_RELEASE_GATES.md`](APP20_RELEASE_GATES.md).

## 1. What changes

| # | Feature | Mechanism |
| --- | --- | --- |
| 1 | Collateralized quotes | A maker locks the quoted inventory into `App20Escrow` **before** quoting. The lock carries the price schedule. A quote is a signed reference to an on-chain lock. Maker default is impossible. |
| 2 | Size-blind quoting | The RFQ carries a size **bucket** from a fixed ladder, never the exact size. Makers quote a piecewise-linear schedule over the bucket. Losing makers learn only the bucket. |
| 3 | Pay-any-token invoices | A USDC invoice can be paid from private STRK: Take → USDC OPEN note → private transfer to the payee once the note matures. |
| 4 | Multi-maker fills | One `Take` consumes up to 4 locks from different makers atomically. |
| 5 | Fair-loss transcripts | After local selection the taker sends each invited maker a transcript it can verify against its own quote digest. |
| 6 | Maturity-aware scheduling | The browser reads the pool's deposit events for the connected account and shows/aligns with note maturity (`NOTE_MATURITY_BLOCKS = 10`). |
| 7 | Chain-anchored encrypted backup | RFQ history (resume records) is backed up as self-addressed Mail like contacts today; large payloads go to an encrypted blob store with a Mail pointer. |
| 8 | Sealed floor | The floor never leaves the browser. Quotes are checked against it locally after schedule evaluation. |
| 9 | Encrypted IPFS blob store | Client-side AES-GCM blobs, CIDv1 raw/sha2-256, trustless verified fetch; localnet emulator; production disabled unless origins are configured. |
| 10 | Maker-signed indicative mids | Makers publish signed mids; the status endpoint aggregates them; the desk shows them as the default reference. CoinGecko stays opt-in. |

**Settlement becomes atomic.** Because the maker's leg is pre-locked, the taker's single `privacy_invoke(Take)` sells leg A and receives leg B in the same transaction. Takers no longer receive claim tickets; there is no funded-waiting state, no fill step, no taker timeout/refund for v3 deals. Makers settle their locks after expiry with a supply-two `LockTicket`.

The legacy v1 flow (`Fund`/`Fill`/`Claim`/`Timeout`) stays in the contract (ABI is additive, existing storage untouched) and in libraries/tests, but the localnet product flow uses v3 only.

## 2. Cairo — `App20Escrow` additive ABI

### 2.1 New contract `LockTicket` (`cairo/src/lock_ticket.cairo`)

Copy of `ClaimTicket` with **supply two**: `mint()` mints 2 to the escrow, `burn()` burns exactly 1, `transfer_balance` asserts `amount == 1`, recipient must be escrow or pool, `name() = "APP20 Lock Ticket"`, `symbol() = "A20LT"`. Constructor `(escrow, pool, lock_id)`.

Escrow constructor becomes `constructor(pool, ticket_class_hash, lock_ticket_class_hash)`. New storage `lock_ticket_class_hash`, `lock_tickets: Map<felt252, ContractAddress>`, `locks: Map<felt252, Lock>`, `takes: Map<felt252, TakeRecord>`. Existing storage fields keep their names and order.

### 2.2 Types

```cairo
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct LockParams {
    pub token: ContractAddress,         // token B (what the maker locks); the escrow measures its balance delta
    pub counter_token: ContractAddress, // token A (what the taker sells, what the maker earns)
    pub rfq_id: felt252,                // taker's RFQ felt (== deal_id used in Take)
    pub taker_commitment: felt252,      // poseidon_hash_span([taker_secret])
    pub expiry: u64,                    // unix seconds; takes allowed while now < expiry
    pub points_len: u8,                 // 1..=4
    pub p0_a: u128, pub p0_b: u128,
    pub p1_a: u128, pub p1_b: u128,
    pub p2_a: u128, pub p2_b: u128,
    pub p3_a: u128, pub p3_b: u128,
}
// Like Fund, `token` is the received token: its balance delta must equal p{len-1}_b (max payout).
// Both tokens must be non-zero and distinct (ZERO_TOKEN / SAME_TOKEN).

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct TakeFill { pub lock_id: felt252, pub amount_a: u128 }

#[derive(Serde, Drop, PartialEq, Debug)]
pub struct TakeParams {
    pub token: ContractAddress,          // token A received from the taker
    pub counter_token: ContractAddress,  // token B paid out
    pub taker_secret: felt252,
    pub fills: Array<TakeFill>,          // 1..=4, distinct lock ids
}

pub enum EscrowOperation {
    Fund: FundParams,      // 0
    Fill: FillParams,      // 1
    Claim,                 // 2
    Timeout,               // 3
    Lock: LockParams,      // 4   deal_id argument = lock_id (maker-chosen non-zero felt)
    Take: TakeParams,      // 5   deal_id argument = taker's rfq felt
    SettleProceeds,        // 6   deal_id argument = lock_id; spends 1 LockTicket unit
    ReleaseCollateral,     // 7   deal_id argument = lock_id; spends 1 LockTicket unit
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum LockStatus { #[default] Empty, Open }

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Lock {
    pub token_a: ContractAddress, pub token_b: ContractAddress,
    pub rfq_id: felt252, pub taker_commitment: felt252, pub expiry: u64,
    pub points_len: u8,
    pub p0_a: u128, pub p0_b: u128, pub p1_a: u128, pub p1_b: u128,
    pub p2_a: u128, pub p2_b: u128, pub p3_a: u128, pub p3_b: u128,
    pub remaining_b: u128, pub earned_a: u128,
    pub ticket: ContractAddress,
    pub proceeds_settled: bool, pub collateral_released: bool,
    pub status: LockStatus,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct TakeRecord {
    pub token_a: ContractAddress, pub total_a: u128,
    pub token_b: ContractAddress, pub total_b: u128,
    pub fill_count: u8, pub taken_at: u64,
}
```

New interface functions: `ensure_lock_ticket(lock_id) -> ContractAddress`, `get_lock_ticket(lock_id)`, `get_lock(lock_id) -> Lock`, `get_take(deal_id) -> TakeRecord`, and `pub fn evaluate_schedule(points_len, p0_a..p3_b, amount_a) -> u128` exposed as a pure library function (also `#[external] view` `quote_schedule(lock_id, amount_a) -> u128` for tooling).

### 2.3 Schedule semantics (shared with TypeScript — must be bit-identical)

- `points_len ∈ 1..=4`; `a` strictly increasing; `b` non-decreasing; all `a_i, b_i > 0`.
- Domain: `a_0 ≤ amount ≤ a_{n-1}`; outside → revert `OUT_OF_SCHEDULE`. With `n == 1`, `amount == a_0`.
- Segment `i` with `a_i ≤ amount ≤ a_{i+1}`: `b = b_i + floor((amount − a_i) · (b_{i+1} − b_i) / (a_{i+1} − a_i))` using u256 intermediates. Floor rounds in the maker's favor.
- Test vectors live in `packages/private-intents/src/fixtures/schedule-vectors.json`; the Cairo test embeds the same vectors.

### 2.4 Operation rules

**Lock** (caller = pool): `lock_id ≠ 0`, `locks[lock_id].status == Empty`, tokens non-zero and distinct, `expiry > now`, schedule valid, received B delta `== p_{n-1}_b`; `ensure_lock_ticket` must already have deployed the ticket (or deploy inline via `ensure_lock_ticket_internal`); mint 2 ticket units, approve pool for 2; store `Lock{ remaining_b: received, earned_a: 0, status: Open }`; emit `LockCreated`; return `[OpenNoteDeposit{note_id, token: ticket, amount: 2}]`.

**Take** (caller = pool): `deal_id ≠ 0`, `takes[deal_id].fill_count == 0` (`TAKE_EXISTS`), `1..=4` fills, distinct lock ids, received A delta `== Σ amount_a` (`SHORT_FILL`/`EXCESS_FILL`), `poseidon_hash_span([taker_secret]) == lock.taker_commitment` for every lock, every lock `Open`, `now < expiry`, `lock.rfq_id == deal_id`, `lock.token_a == token`, `lock.token_b == counter_token`, `amount_a` in schedule domain, `b_i = evaluate_schedule(...)`, `lock.remaining_b ≥ b_i`; update `remaining_b −= b_i`, `earned_a += amount_a`; accounted[A] += received, accounted[B] −= Σ b_i; approve pool for Σ b_i; write `TakeRecord`; emit `LockTaken` per fill and `DealTaken`; return `[OpenNoteDeposit{note_id, token: counter_token, amount: Σ b_i}]`. Any failure reverts the whole take.

**SettleProceeds** (caller = pool, spends 1 ticket unit exactly like `consume_ticket` but delta 1 of the lock ticket): requires `Open`, `now ≥ expiry`, `!proceeds_settled`, `earned_a > 0`; sets `proceeds_settled`, accounted[A] −= earned_a, approve, emit `LockProceedsSettled`, return `[{note_id, token_a, earned_a}]`.

**ReleaseCollateral**: requires `Open`, `now ≥ expiry`, `!collateral_released`, `remaining_b > 0`; sets `collateral_released`, accounted[B] −= remaining_b, approve, emit `LockCollateralReleased`, return `[{note_id, token_b, remaining_b}]`.

If a side has nothing to pay the call reverts (`NOTHING_TO_SETTLE`) and the unit stays in the maker's note; that leftover ticket unit is inert.

### 2.5 Events

```cairo
LockCreated { #[key] lock_id, #[key] rfq_id, token_a, token_b, expiry, max_b: u128,
              points_len: u8, p0_a, p0_b, p1_a, p1_b, p2_a, p2_b, p3_a, p3_b, ticket }
LockTaken   { #[key] lock_id, #[key] deal_id, amount_a: u128, amount_b: u128, remaining_b: u128 }
DealTaken   { #[key] deal_id, token_a, total_a: u128, token_b, total_b: u128, fill_count: u8 }
LockProceedsSettled   { #[key] lock_id, token: ContractAddress, amount: u128 }
LockCollateralReleased{ #[key] lock_id, token: ContractAddress, amount: u128 }
```

Existing events are unchanged. Error constants added: `LOCK_EXISTS`, `LOCK_NOT_OPEN`, `LOCK_EXPIRED`, `LOCK_NOT_EXPIRED`, `BAD_SCHEDULE`, `OUT_OF_SCHEDULE`, `BAD_COMMITMENT`, `WRONG_RFQ`, `TOO_MANY_FILLS`, `NO_FILLS`, `DUPLICATE_LOCK`, `INSUFFICIENT_LOCK`, `TAKE_EXISTS`, `ALREADY_SETTLED`, `NOTHING_TO_SETTLE`, `BAD_LOCK_AMOUNT`.

### 2.6 Wallet action arrays (browser and maker)

```
Lock (maker):    withdraw(tokenB, max_b, escrow); transfer(lockTicket, "OPEN", makerRecovery);
                 invoke(escrow, [0x4, tokenB, tokenA, rfqId, takerCommitment, expiry, len, p0a,p0b,p1a,p1b,p2a,p2b,p3a,p3b, lockId, ${poolAddress}, ${openNoteIds[0]}])
Take (taker):    withdraw(tokenA, Σamount, escrow); transfer(tokenB, "OPEN", takerRecovery);
                 invoke(escrow, [0x5, tokenA, tokenB, takerSecret, fillsLen, (lockId, amountA)*, rfqId, ${poolAddress}, ${openNoteIds[0]}])
SettleProceeds:  withdraw(lockTicket, 0x1, escrow); transfer(tokenA, "OPEN", makerRecovery);
                 invoke(escrow, [0x6, lockId, ${poolAddress}, ${openNoteIds[0]}])
ReleaseCollateral: withdraw(lockTicket, 0x1, escrow); transfer(tokenB, "OPEN", makerRecovery);
                 invoke(escrow, [0x7, lockId, ${poolAddress}, ${openNoteIds[0]}])
```

`TakeParams.fills` is Serde `Array` → `len` followed by `(lock_id, amount_a)` pairs. `u128` values are single felts.

## 3. Protocol (`@app20/private-intents`)

All new modules are additive; v1 types remain exported. Names below are binding.

### 3.1 Size buckets — `size-buckets.ts`

`SIZE_BUCKET_LADDER: Readonly<Record<"STRK" | "USDC", readonly { min: bigint; max: bigint }[]>>` in base units (STRK 18 decimals, USDC 6):

- STRK: 0.05–0.1, 0.1–0.25, 0.25–0.5, 0.5–1, 1–2.5, 2.5–5, 5–10, 10–25, 25–50
- USDC: 0.1–0.2, 0.2–0.5, 0.5–1, 1–2.5, 2.5–5, 5–10, 10–25, 25–50, 50–100

`bucketForAmount(symbol, amount) -> SizeBucket` (inclusive of max, exclusive of min except the first rung), `assertLadderBucket(symbol, bucket)` (makers reject non-ladder buckets to prevent size leakage via custom buckets).

### 3.2 RFQ v2 — `rfq-v2.ts`

```ts
export const PRIVATE_RFQ_V2_DOMAIN = "app20/private-rfq/v2";
export type PrivateRfqV2 = Readonly<{
  version: 2; domain: typeof PRIVATE_RFQ_V2_DOMAIN;
  rfqId: string;               // 32-byte digest (unchanged semantics: intentDigest on localnet)
  rfqFelt: string;             // the escrow rfq_id/deal_id felt (browser createLocalnetIntentId)
  takerCommitment: string;     // felt, poseidon([takerSecret])
  chainId: StarknetPool; registryRevision: string; directoryEpoch: number;
  settlementHelper: string;    // escrow address
  sellToken: string; buyToken: string;
  sellBucketMinBaseUnits: bigint; sellBucketMaxBaseUnits: bigint;   // ladder rung
  createdAt: number; responseDeadline: number; expiresAt: number;
  lockExpiresAt: number;       // makers must set lock.expiry == lockExpiresAt (== expiresAt)
}>;
```

No floor field. `canonicalPrivateRfqV2`, `digestPrivateRfqV2`, `assertPrivateRfqV2` mirror v1 conventions (sorted keys, decimal strings). `createTakerSecret()` (random felt < prime, ≥ 2^128), `takerCommitmentFor(secret)` via `@scure/starknet` `poseidonHashMany([secret])` (must equal Cairo `poseidon_hash_span([secret])`).

### 3.3 Schedule — `schedule.ts`

`PriceSchedulePoint = { a: bigint; b: bigint }`, `PriceSchedule = readonly PriceSchedulePoint[]` (1–4), `assertPriceSchedule`, `evaluatePriceSchedule(schedule, amountA): bigint` (bit-identical to Cairo §2.3), `invertPriceSchedule(schedule, targetB): bigint | null` (smallest `a` in domain with `evaluate(a) ≥ targetB`, binary search), `scheduleUnitPriceE18(schedule, a)`. Fixture vectors JSON exported for Cairo.

### 3.4 Quote v3 — `quote-v3.ts`

```ts
export const QUOTE_V3_DOMAIN = "app20/private-intent-quote/v3";
export type SolverQuoteV3 = Readonly<{
  domain: typeof QUOTE_V3_DOMAIN; version: 3;
  solverId: string; quoteKeyId: string; nonce: string;
  pool: StarknetPool; helper: string; escrowAddress: string;
  rfqDigest: string; rfqFelt: string;
  sellToken: string; buyToken: string;
  schedule: PriceSchedule;              // over [a_0, a_{n-1}] ⊆ bucket; a_{n-1} = maxFill
  lockId: string;                       // felt
  lockTicket: string;                   // felt address
  lockTransactionHash: string;          // felt
  lockExpiresAt: number;
  spreadBps: number; pricingProvenance: string;
  quotedAt: number; quoteExpiresAt: number;
  signature: string;                    // P-256 raw low-S over canonical JSON (same as v1/v2)
}>;
```

`canonicalSolverQuoteV3`, `encode/decodeSolverQuoteV3` (wire: bigints as decimal strings), `digestSolverQuoteV3` = SHA-256 of canonical (no signature, like localnet v1), `verifySolverQuoteV3(quote, now, { rfq: PrivateRfqV2, importPublicKey, verify, resolveKey, lockOnChain })` where `lockOnChain: Readonly<{ rfqId, takerCommitment, tokenA, tokenB, expiry, schedule, remainingB, status:"open" }>` is supplied by the caller from `get_lock`; the verifier requires the on-chain lock to match the signed schedule/expiry/tokens/rfq/commitment and `remainingB ≥ schedule max b`.

### 3.5 Selection v3 — `selection-v3.ts`

`selectFillsV3({ quotes, exactSellAmount, floorBuyAmount, maxFills = 4 })` →

```ts
{ kind: "selected", fills: [{ quote, amountA, amountB }], totalB, rule: "app20/rfq-selection/v3" }
| { kind: "refused", reason: "insufficient-depth" | "below-floor" | "no-quotes" }
```

Deterministic: (1) if any single quote's domain covers `S`, choose max `evaluate(S)`; ties → later `quoteExpiresAt`, then `solverId` ascending. (2) Otherwise order quotes by `unitPriceE18 at a_max` descending (ties `solverId`), allocate `min(remainder, a_max)` when ≥ `a_min`, stop at `maxFills`; if remainder > 0 → `insufficient-depth`. (3) `totalB < floor` → `below-floor`. Deterministic, pure, fully unit-tested including tie cases.

### 3.6 Transcript — `transcript.ts`

```ts
export const SELECTION_TRANSCRIPT_DOMAIN = "app20/rfq-selection-transcript/v1";
export type SelectionTranscriptV1 = Readonly<{
  version: 1; domain; rfqDigest: string; rule: "app20/rfq-selection/v3";
  bucket: { min: string; max: string };
  createdAt: number;
  entries: readonly { makerId: string; quoteDigest: string; outcome: "won" | "lost" | "refused"; rank: number; amountA?: string }[];
  clearingUnitPriceE18: string;   // best unit price among winning fills
  digest: string;                 // SHA-256 of canonical body without digest
}>;
```

`createSelectionTranscript({ rfqDigest, bucket: { min: bigint; max: bigint }, createdAt, selection: SelectFillsV3Result, quotes, refusals: { makerId; quoteDigest }[] })`. Refusal digests are supplied by the caller (coordinator digest of the refusal wire object); the all-zero 32-byte digest is accepted only for outcome `refused`. Ranks: winners in fill order `1..k`; then losers that cover the exact size by `evaluate(S)` descending; then losers that do not cover it by `scheduleUnitPriceE18` at their `a_max` descending; ties by `solverId`; refused last. The exact size never appears in the transcript. `verifySelectionTranscriptForMaker(transcript, { makerId, ownQuoteDigest, ownUnitPriceE18 })` → `{ consistent: boolean; reason? }` (own digest present; if lost, `clearingUnitPriceE18 ≥ ownUnitPriceE18`).

### 3.7 Indicative mids — `mids.ts`

```ts
export const MAKER_MID_DOMAIN = "app20/maker-indicative-mid/v1";
export type MakerIndicativeMidV1 = Readonly<{ version: 1; domain; makerId: string; quoteKeyId: string;
  marketId: "STRK_USDC"; midE18: bigint; observedAt: number; validUntil: number; signature: string }>;
```

`canonicalMakerMid`, `encode/decode`, `verifyMakerMid(mid, now, { importPublicKey, verify, resolveKey })`, `aggregateMids(mids) -> { medianE18: bigint; dispersionBps: number; count: number }` — median (even count → floor of the average of the two middle values), `dispersionBps = Number(((max − min) · 10_000n) / medianE18)` (0 when count ≤ 1), empty input → `{ medianE18: 0n, dispersionBps: 0, count: 0 }`. `formatSizeBucketLabel(symbol, bucket)` in `size-buckets.ts` renders e.g. `0.5–1 STRK`.

## 4. Maker node and localnet services

### 4.1 Maker node (`@app20/maker-node`, `scripts/localnet-maker-node.mjs`)

- New WAL record kind `LockRecordV1 { lockId, rfqDigest, rfqFelt, takerCommitment, tokenA, tokenB, schedule, maxB, expiry, ticket, lockTxHash, state: "locking"|"open"|"taken"|"expired"|"settling"|"settled"|"quarantined", takenA, takenB, proceedsTxHash?, releaseTxHash?, quoteDigest? }` alongside existing reservation records (same hash-chained WAL).
- Quote pipeline v3: validate RFQ v2 (ladder bucket, expiry ≤ 90 s TTL), build schedule (localnet: fixed price 2 USDC/STRK ± spread; maker B also tiers: 10 bps better above the bucket midpoint), cap `a_max` by inventory, evaluate economic policy at `a_max`, submit `Lock` through the pool (same custody path as today's fill), wait for the receipt, then sign quote v3 referencing the lock. If the lock tx fails → refuse.
- Settlement worker: every 5 s scan WAL locks with `expiry ≤ now` and settle (`SettleProceeds` when `earned_a > 0`, `ReleaseCollateral` when `remaining_b > 0`), driven by `get_lock`; idempotent; quarantines on unknown outcome.
- `GET /v1/mids` returns a fresh signed `MakerIndicativeMidV1` (localnet: 2.00 USDC/STRK, maker B 2.01).
- `POST /v1/transcripts` verifies with `verifySelectionTranscriptForMaker`, journals `{transcript, consistent}`; `GET /v1/transcripts` lists them for the ops dashboard.
- `GET /v1/locks` lists lock records (no secrets).
- `POST /v1/quotes-v3` (Bearer, called by the coordinator): body `PrivateRfqV2` wire → `{ quote: SolverQuoteV3Wire } | { refused: { reason } }`.

### 4.2 Localnet app (`scripts/localnet-app.mjs` and friends)

- Deploy `LockTicket` class; escrow constructor gets its class hash; `/config` gains `lockTicketClassHash`, `escrowAbiVersion: 3`, `ipfsProxyPath`.
- `POST /private-intents/quotes` accepts `{ account, chainId, rfq: PrivateRfqV2Wire, cohort }` and returns `{ quotes: SolverQuoteV3Wire[], refusals: [...], cohort }`; fans out to makers' `/v1/quotes-v3`; journals the request in the coordinator (`app20/localnet-reservation-coordinator/v4`, request keyed by rfqDigest; no selection lease, no loser release).
- `POST /escrow/lock` `{ lockId }` → `get_lock` as strings; `POST /escrow/take` `{ dealId }` → `get_take`.
- `POST /private-intents/transcript` `{ rfqDigest, transcript, makerIds }` → forwards to each maker, returns per-maker `{ makerId, accepted, consistent }`.
- `GET /rfq/operations/status` adds `mids: MakerIndicativeMidV1Wire[]` (fresh from makers, cached 5 s) and `locks: { open, expiredAwaitingSettlement, settled }` counts.
- Chain decoder: pin the v3 ABI (regenerate the JSON string and digest from `scarb build` output) and add selectors for the five new events; reader/authority stages for v3 deals: single stage `take` (tx hash of the taker's Take); `localnet-deal-validator` validates `get_take` totals against the browser's expected fills; `/rfq/unresolved-deals` and `/rfq/authority/verify` accept `{ lifecycle: "v3", transactions: { take } }`.
- Maker reconciler: consumes `LockTaken`/`DealTaken` for each maker's locks and posts terminal reconciliation exactly as today for fills.
- `scripts/localnet-ipfs.mjs`: in-memory emulator on `127.0.0.1:5054`: `POST /api/v0/add?cid-version=1&raw-leaves=true&hash=sha2-256&pin=true` (multipart, returns `{ Hash: cid, Size }`), `GET /ipfs/{cid}?format=raw` (also honours `Accept: application/vnd.ipld.raw`), `HEAD /ipfs/{cid}`, 404 for unknown. Booted by localnet-app; Vite proxy `/__app20_localnet_ipfs` → 5054.
- `pool-harness` real-pool tests: update escrow deployment calldata for the new constructor; add one real-pool test that locks, takes, and settles (both maker pulls) through the genuine pool — this is the authoritative check that a two-unit ticket note behaves under the real pool.

## 5. Browser

### 5.1 RFQ desk (`src/app/rfq/*`, `src/lib/escrow-actions.ts`)

- `buildEscrowLockActions`, `buildEscrowTakeActions`, `buildEscrowSettleProceedsActions`, `buildEscrowReleaseCollateralActions` in `escrow-actions.ts` with `ESCROW_OPERATION_VARIANT.Lock = "0x4"` … `ReleaseCollateral = "0x7"`.
- Request: exact sell amount stays local; the desk derives the ladder bucket and creates `takerSecret`/`takerCommitment` (persisted in the lifecycle record until the take). Floor stays local (swap surface: policy floor; block surface: typed floor within policy band). RFQ v2 is sent to `/private-intents/quotes`.
- Verification: for each quote, read `/escrow/lock` and run `verifySolverQuoteV3` with the on-chain lock; evaluate the schedule at the exact size; `selectFillsV3` with the local floor. Show every quote's evaluated receive amount, unit price, and the selection rationale (single vs split, ranks).
- Final review binds: exact sell amount, each fill's `lockId`/`amountA`/`amountB`, total receive, lock expiry, fees (0 bps), and the fresh balance snapshot. Accept → `buildEscrowTakeActions` → `submitActions` with the existing funding-orchestration/CAS/unknown-attempt discipline (renamed phase `take`). Outcome: `submission-unknown → settled` once `/escrow/take` shows the record; `reverted` → back to `quoted` only for a reverted attempt (existing rule).
- Lifecycle schema `app20/rfq-lifecycle/v3` (migrate v2 rows by keeping them readable; v3 records carry `mode: "v3"`, `fills`, `takerCommitment`, `takerSecret` until settled, `takeTransactionHash`). New allowed edges: `reviewing → submission-unknown → settled | reviewing(reverted)`; `funded/filled/claimable/refundable` are unreachable for `mode: "v3"`.
- After selection (before the wallet prompt) the desk sends the transcript via `/private-intents/transcript` and shows per-maker acknowledgement in the ops dashboard.
- Mids: `useRfqOperations` exposes verified mids; `DeskMarketBoard` shows "Maker mid · indicative" (median + dispersion) by default; CoinGecko remains opt-in and unchanged.
- Maturity: `src/lib/note-maturity.ts` — `readAccountDeposits({ provider, poolAddress, account, fromBlock })` reads the pool deposit events for the account (event name/selector discovered from the pinned vendor pool ABI in `vendor/starknet-privacy`; the first indexed key is the depositor), returns `{ blockNumber, matureAtBlock: blockNumber + NOTE_MATURITY_BLOCKS }[]`; `noteMaturityStatus(deposits, headBlock)` → `{ mature: n, pending: [{ matureAtBlock, blocksRemaining }] }`. The desk shows "Notes from your latest shield mature at block N (K blocks left)" and, when a request is attempted while the latest deposit is immature, offers "Request quotes when mature" (a local timer that re-polls the head block and then runs the request; the take still requires an explicit click). The Funding page shows the same computed status, labelled as a chain-derived estimate, replacing "Not exposed by this wallet".
- Invoice mode (`src/lib/desk-handoff.ts` v3): `{ mode: "invoice", requestId, payee, buyToken, targetBuyBaseUnits, memo?, returnTo: "/mail/inbox" }`. The desk fixes direction STRK→USDC, sizes the bucket from `invertPriceSchedule`-style estimation on the mids (`S ≈ target / medianMid × 1.02`), and after quotes chooses `S = min a : Σ fills evaluate ≥ target` (via `invertPriceSchedule` on the selected fills). After a settled take it records `{ requestId, takeTransactionHash, takeBlock, buyToken, amount: target }` in the OTC store as `awaiting-note-maturity` and returns to the inbox.
- Storage API for backups (owned here, consumed by Mail): `exportRfqResumeRecords(chainId, account) -> RfqResumeExportV1` (records minus `takerSecret`, plus tombstone digests) and `importRfqResumeRecords(export, { onConflict: "keep-newer" })` performing CAS puts and marking imported rows `restoredFromBackup: true` (they remain "verify-only" until `/rfq/authority/verify` confirms).

### 5.2 Mail, invoices, backup, IPFS (`src/lib`, `src/app/inbox`, `src/components/mail`, `workers/relay`)

- `envelope.ts`: new types `backup_snapshot = 0x0d` and `backup_pointer = 0x0e`.
- `src/lib/backup-snapshot.ts`: `BackupSnapshotV1 { version: 1, kind: "contacts" | "rfq-resume", seq, owner, chainId, helperAddress, mailboxFingerprint, createdAt, payload, digest, mac }` using the same HKDF/HMAC discipline as `contact-backup.ts` (domain `app20/backup/v1`); `contact_snapshot` v1 remains readable.
- `src/lib/backup-blob.ts`: `sealBackupBlob({ mailboxSeed, owner, chainId, kind, seq, bytes })` → AES-256-GCM (key = HKDF(seed, salt `app20/backup-blob/v1/salt`, info `app20/backup-blob/v1:owner:chainId:kind:seq`), 12-byte nonce, AAD = info), padded to 4096-byte buckets, header `[version=1][kind][seq u32]`; `openBackupBlob`.
- `src/lib/blob-store.ts`: `BlobStore { put(bytes): Promise<{ cid }>; get(cid): Promise<Uint8Array> }`; `computeCidV1Raw(bytes)` (multihash sha2-256 → base32 `bafkrei…`); `createIpfsBlobStore({ rpcOrigin, gatewayOrigins })` (upload via `/api/v0/add`, fetch via `/ipfs/{cid}?format=raw` on each gateway until one verifies; hash mismatch → reject); `createUnavailableBlobStore(reason)`. Configuration: localnet → `ipfsProxyPath` from `/config`; production → `VITE_IPFS_RPC_ORIGIN`/`VITE_IPFS_GATEWAY_ORIGINS` (default empty → unavailable, fail closed).
- Backup flow (inbox): "Back up RFQ history" and "Back up contacts" buttons → snapshot; if the encoded envelope fits in one Mail (≤ 4293 bytes) post `backup_snapshot` inline; else seal a blob, `put` it, and post `backup_pointer { kind, seq, cid, bucketBytes, blobDigest }`. Restore: scan finds the newest snapshot/pointer per kind; pointer → fetch → verify → open → verify snapshot → merge (contacts: existing merge; rfq-resume: `importRfqResumeRecords`). Auto-backup of RFQ history after each settled take is an opt-in toggle (default off; each backup is a public helper transaction).
- Invoices: `PaymentRequestPayload.token` may be localnet USDC (registry-resolved) in addition to STRK. `InvoiceCard` shows "Pay privately with STRK" when the invoice token is USDC, which navigates to the desk in invoice mode. Inbox shows "Complete payment" for `awaiting-note-maturity` records once `takeBlock + 10 ≤ head` (uses `note-maturity.ts`), which runs the existing memo-transfer pay path with the USDC token and the recorded amount; states `awaiting-note-maturity → reserved → submitted → confirmed`.
- Relay CSP: `headers.ts` adds `IPFS_ORIGINS` env (comma-separated HTTPS origins, same validation as Privy origins) appended to `connect-src`; default unset → unchanged CSP. `verify-production-csp.mjs` needs no change while unset.

## 6. Localnet fixture values

- Ladder as §3.1. Quote TTL 90 s; `lockExpiresAt = rfq.expiresAt = createdAt + 90`.
- Maker A: 2.00 USDC/STRK, spread 30 bps, linear 2-point schedule, `a_max = min(bucket max, inventory / price)`.
- Maker B: 2.01 mid, spread 20 bps, 3-point schedule with 10 bps better unit price above the bucket midpoint.
- Both directions (STRK→USDC, USDC→STRK) supported; USDC-sell schedules price in STRK.
- Caps unchanged (50 STRK / 100 USDC per trade on localnet).

## 7. Lifecycle of a v3 RFQ (localnet)

1. Taker enters exact size and floor → bucket + `takerSecret` created → RFQ v2 posted.
2. Coordinator fans out; each maker locks inventory on chain and returns a signed quote v3 (or refusal).
3. Browser verifies each quote against `get_lock`, evaluates schedules at the exact size, selects fills, checks the local floor.
4. Browser posts the fair-loss transcript to all invited makers.
5. Taker reviews and accepts → one `Take` transaction → USDC/STRK arrive as an OPEN note in the same transaction.
6. Locks expire at `lockExpiresAt`; maker nodes settle proceeds and release leftover collateral automatically.
7. Chain authority verifies the take; the maker reconciler journals the terminal state.

## 8. Out of scope for this program

Personal maker cohorts, constant-shape fanout, maker-sponsored fees, counter-offers, removal of the legacy v1 contract operations, production enablement of any kind.
