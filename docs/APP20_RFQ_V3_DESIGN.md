# APP20 RFQ v3 — collateralized, bucket-only invitation, atomic settlement

**Status: mounted and browser-tested on the build-gated localnet (2026-09-02); production/public networks remain immutable-off.** This document fixes every open decision for the v3 program so that independent lanes (Cairo, protocol, maker, localnet services, browser, Mail/backup) build against one specification. Where this document and older docs disagree, this document wins for localnet. Nothing here changes the release boundary in [`APP20_RELEASE_GATES.md`](APP20_RELEASE_GATES.md).

## 1. What changes

| #   | Feature                         | Mechanism                                                                                                                                                                                                                                        |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Collateralized quotes           | A maker locks the quoted token B maximum into `App20Escrow` **before** quoting. The lock carries the schedule, so the taker's atomic payout cannot default within that confirmed collateral.                                                     |
| 2   | Bucket-only quoting             | The RFQ carries a size bucket from a fixed ladder, never exact size or floor. Makers quote a piecewise-linear schedule over it. Post-selection winner allocations reveal exact size to the coordinator and can reveal it to every invited maker. |
| 3   | Pay-any-token invoices          | Mail hands a scoped USDC request to the desk; the desk sizes private STRK against verified schedules, records the Take, and Mail completes payment after note maturity.                                                                          |
| 4   | Multi-maker fills               | One `Take` consumes one to four distinct locks atomically.                                                                                                                                                                                       |
| 5   | Fair-loss transcripts           | Every invited maker receives the same transcript before Take. Quoted makers verify their own digest/loss price; refused makers currently record it as inconsistent.                                                                              |
| 6   | Maturity-aware scheduling       | The desk renders a bounded public-event estimate and can wait locally until the ten-block gate passes before soliciting makers.                                                                                                                  |
| 7   | Chain-anchored encrypted backup | Contacts/RFQ history can be self-backed through Mail; large payloads use encrypted padded blobs and a Mail pointer. RFQ history v2 includes portable authenticated tombstones and permanent verify-only restore provenance.                      |
| 8   | Sealed floor                    | The floor remains in the browser and is applied locally after schedule evaluation.                                                                                                                                                               |
| 9   | Encrypted IPFS blob store       | Client-side AES-GCM blobs, CIDv1 raw/sha2-256, verified fetch, a loopback in-memory emulator, and production fail-closed origin configuration are implemented.                                                                                   |
| 10  | Maker-signed indicative mids    | Makers and status/browser operations publish, verify, aggregate, and render signed fixture mids. CoinGecko stays independent and opt-in.                                                                                                         |

**Settlement becomes atomic.** Because the maker's leg is pre-locked, the taker's protected ComputeAndInvoke `Take` sells leg A and receives leg B in the same transaction. The retained wire field `takerCommitment` is the taker's ephemeral Stark public key. Cairo derives `H('app20-take-id-v1', private pool identity key, deal id)` without exposing the raw key, then verifies a Take v4 signature over native chain ID, escrow, that identity commitment, deal, ordered tokens, and mandatory ordered `fillsDigest`. Takers no longer receive claim tickets; there is no funded-waiting state, no fill step, no taker timeout/refund for v3 deals. Makers settle their locks after expiry with a supply-two `LockTicket`. The public identity commitment differs across RFQs, while the signature, fills, and events still link activity within the same RFQ. The protected action is a pinned local client shim, not production-wallet compatibility.

The legacy v1 flow (`Fund`/`Fill`/`Claim`/`Timeout`) stays in the contract and retains enum discriminants 0–3, with v3 operations at 4–7. This is not a fully additive wire change: `FundParams` now includes an explicit amount, the protected nonzero Mail and Take call paths changed, and Take uses the v4 signed message. Current clients and helpers must use the matching ABI and builders. V3 is the mounted localnet product flow; legacy lifecycle records keep separate recovery actions.

Deploy the current Mail helper, escrow, tickets, and client/builders together on a fresh localnet. These repository changes do not upgrade or migrate existing deployed contracts or private notes, and old runtime/history must remain preserved as historical evidence. No public-network deployment is authorized.

## 2. Cairo — `App20Escrow` localnet ABI evolution

### 2.1 New contract `LockTicket` (`cairo/src/lock_ticket.cairo`)

Copy of `ClaimTicket` with **supply two**: `mint()` mints 2 to the escrow and `burn()` burns exactly 1. Normal settlement transfers require `amount == 1`; the initial escrow→pool OPEN-note deposit alone may transfer both minted units at once. Recipients are restricted to escrow or pool. `name() = "APP20 Lock Ticket"`, `symbol() = "A20LT"`. Constructor `(escrow, pool, lock_id)`.

Escrow constructor becomes `constructor(pool, ticket_class_hash, lock_ticket_class_hash)`. New storage `lock_ticket_class_hash`, `lock_tickets: Map<felt252, ContractAddress>`, `locks: Map<felt252, Lock>`, `takes: Map<felt252, TakeRecord>`. Existing storage fields keep their names and order.

### 2.2 Types

```cairo
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct LockParams {
    pub token: ContractAddress,         // token B (what the maker locks); exact same-transaction delta
    pub counter_token: ContractAddress, // token A (what the taker sells, what the maker earns)
    pub rfq_id: felt252,                // taker's RFQ felt (== deal_id used in Take)
    pub taker_commitment: felt252,      // taker's ephemeral Stark public-key x-coordinate
    pub expiry: u64,                    // unix seconds; takes allowed while now < expiry
    pub points_len: u8,                 // 1..=4
    pub p0_a: u128, pub p0_b: u128,
    pub p1_a: u128, pub p1_b: u128,
    pub p2_a: u128, pub p2_b: u128,
    pub p3_a: u128, pub p3_b: u128,
}
// `token` is received after prepare_funding(token); its new delta must equal p{len-1}_b.
// Both tokens must be non-zero and distinct (ZERO_TOKEN / SAME_TOKEN).

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct TakeFill { pub lock_id: felt252, pub amount_a: u128 }

#[derive(Serde, Drop, PartialEq, Debug)]
pub struct TakeParams {
    pub token: ContractAddress,          // token A received from the taker
    pub counter_token: ContractAddress,  // token B paid out
    pub signature_r: felt252,
    pub signature_s: felt252,
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
pub enum LockStatus { #[default] Empty, Open, Closed }

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
    pub fills_digest: felt252,
}
```

New interface functions: `ensure_lock_ticket(lock_id) -> ContractAddress`, `get_lock_ticket(lock_id)`, `get_lock(lock_id) -> Lock`, `get_take(deal_id) -> TakeRecord`, and `pub fn evaluate_schedule(points_len, p0_a..p3_b, amount_a) -> u128` exposed as a pure library function (also `#[external] view` `quote_schedule(lock_id, amount_a) -> u128` for tooling). The view quotes only an `Open`, unexpired lock; the pure evaluator remains available for historical calculations.

### 2.3 Schedule semantics (shared with TypeScript — must be bit-identical)

- `points_len ∈ 1..=4`; `a` strictly increasing; `b` non-decreasing; all `a_i, b_i > 0`.
- Domain: `a_0 ≤ amount ≤ a_{n-1}`; outside → revert `OUT_OF_SCHEDULE`. With `n == 1`, `amount == a_0`.
- Segment `i` with `a_i ≤ amount ≤ a_{i+1}`: `b = b_i + floor((amount − a_i) · (b_{i+1} − b_i) / (a_{i+1} − a_i))` using u256 intermediates. Floor rounds in the maker's favor.
- Test vectors live in `packages/private-intents/src/fixtures/schedule-vectors.json`; the Cairo test embeds the same vectors.

### 2.4 Operation rules

**Funding preflight** (public account call, before the pool transfer in the same outer transaction): `prepare_funding(token)` snapshots the escrow's actual token balance and native transaction hash. The next funded operation for that token consumes the snapshot exactly once and requires the post-transfer delta to equal its expected input: explicit `FundParams.amount`, legacy Fill terms, Lock schedule maximum, or the Take fill sum. Pre-existing donations are excluded and both short and excess input revert. `scripts/escrow-funding-preflight.mjs` inserts these calls for the local wallet and maker and rejects more than one funded operation per token in one batch.

**Lock** (caller = pool): `lock_id ≠ 0`, `locks[lock_id].status == Empty`, tokens non-zero and distinct, `expiry > now`, schedule valid, prepared B delta `== p_{n-1}_b`; `ensure_lock_ticket` must already have deployed the ticket (or deploy inline via `ensure_lock_ticket_internal`); mint 2 ticket units, approve pool for 2; store `Lock{ remaining_b: received, earned_a: 0, status: Open }`; emit `LockCreated`; return `[OpenNoteDeposit{note_id, token: ticket, amount: 2}]`.

**Take** (caller = pool through protected ComputeAndInvoke): `deal_id ≠ 0`, `takes[deal_id].fill_count == 0` (`TAKE_EXISTS`), `1..=4` fills, distinct lock ids, prepared A delta `== Σ amount_a` (`SHORT_FILL`/`EXCESS_FILL`), and every lock carries the same non-zero `taker_commitment`. Define `fills_digest = poseidon_hash_span([lock_id_1, amount_a_1, ..., lock_id_n, amount_a_n])` in fill order, `identity_commitment = poseidon_hash_span([TAKE_IDENTITY_DOMAIN, identity_key, deal_id])`, and `message = poseidon_hash_span([TAKE_DOMAIN, get_tx_info().chain_id, get_contract_address(), identity_commitment, deal_id, token, counter_token, fills_digest])`, where the domains are `'app20-take-v4'` and `'app20-take-id-v1'`. The pool supplies its private contract-specific identity key only to `privacy_compute`, with `deal_id` supplied as compute calldata so the commitment is not a stable cross-RFQ identifier; ordinary `privacy_invoke(Take)` is rejected. Verify `core::ecdsa::check_ecdsa_signature(message, taker_commitment, signature_r, signature_s)` exactly once and revert `BAD_SIGNATURE` on failure. Then require every lock `Open`, `now < expiry`, `lock.rfq_id == deal_id`, `lock.token_a == token`, `lock.token_b == counter_token`, `amount_a` in schedule domain, `b_i = evaluate_schedule(...)`, and `lock.remaining_b ≥ b_i`; update `remaining_b −= b_i`, `earned_a += amount_a`; accounted[A] += received, accounted[B] −= Σ b_i; approve pool for Σ b_i; write `TakeRecord` including `fills_digest`; emit `LockTaken` per fill and `DealTaken` including `fills_digest`; return `[OpenNoteDeposit{note_id, token: counter_token, amount: Σ b_i}]`. Any failure reverts the whole take.

**SettleProceeds** (caller = pool, spends 1 ticket unit exactly like `consume_ticket` but delta 1 of the lock ticket): requires `Open`, `now ≥ expiry`, `!proceeds_settled`; sets `proceeds_settled`, and when `earned_a > 0` updates accounted[A], approves the pool, and returns `[{note_id, token_a, earned_a}]`. A zero side returns no deposit. It emits `LockProceedsSettled` in either case.

**ReleaseCollateral**: requires `Open`, `now ≥ expiry`, `!collateral_released`; sets `collateral_released`, and when `remaining_b > 0` updates accounted[B], approves the pool, and returns `[{note_id, token_b, remaining_b}]`. A zero side returns no deposit. It emits `LockCollateralReleased` in either case.

Each side consumes its own ticket unit even when its payout is zero. Off-chain builders omit an OPEN output note and pass note id zero for that cleanup call. When both flags are set, the lock transitions to `Closed`; this exhausts both ticket units without forfeiting a nonzero opposite side.

### 2.5 Events

```cairo
LockCreated { #[key] lock_id, #[key] rfq_id, token_a, token_b, expiry, max_b: u128,
              points_len: u8, p0_a, p0_b, p1_a, p1_b, p2_a, p2_b, p3_a, p3_b, ticket }
LockTaken   { #[key] lock_id, #[key] deal_id, amount_a: u128, amount_b: u128, remaining_b: u128 }
DealTaken   { #[key] deal_id, token_a, total_a: u128, token_b, total_b: u128, fill_count: u8, fills_digest: felt252 }
LockProceedsSettled   { #[key] lock_id, token: ContractAddress, amount: u128 }
LockCollateralReleased{ #[key] lock_id, token: ContractAddress, amount: u128 }
```

Legacy events are unchanged. Error constants added: `LOCK_EXISTS`, `LOCK_NOT_OPEN`, `LOCK_EXPIRED`, `LOCK_NOT_EXPIRED`, `BAD_SCHEDULE`, `OUT_OF_SCHEDULE`, `BAD_SIGNATURE`, `WRONG_RFQ`, `TOO_MANY_FILLS`, `NO_FILLS`, `DUPLICATE_LOCK`, `INSUFFICIENT_LOCK`, `TAKE_EXISTS`, `ALREADY_SETTLED`, `NOTHING_TO_SETTLE`, `BAD_LOCK_AMOUNT`.

### 2.6 Wallet action arrays (browser and maker)

```
Lock (maker):    withdraw(tokenB, max_b, escrow); transfer(lockTicket, "OPEN", makerRecovery);
                 invoke(escrow, [0x4, tokenB, tokenA, rfqId, takerCommitment, expiry, len, p0a,p0b,p1a,p1b,p2a,p2b,p3a,p3b, lockId, ${poolAddress}, ${openNoteIds[0]}])
Take (taker):    withdraw(tokenA, Σamount, escrow); transfer(tokenB, "OPEN", takerRecovery);
                 compute_and_invoke(escrow, [0x5, tokenA, tokenB, signatureR, signatureS, fillsLen, (lockId, amountA)*, rfqId, ${poolAddress}, ${openNoteIds[0]}])
SettleProceeds:  withdraw(lockTicket, 0x1, escrow); transfer(tokenA, "OPEN", makerRecovery);
                 invoke(escrow, [0x6, lockId, ${poolAddress}, ${openNoteIds[0]}])
ReleaseCollateral: withdraw(lockTicket, 0x1, escrow); transfer(tokenB, "OPEN", makerRecovery);
                 invoke(escrow, [0x7, lockId, ${poolAddress}, ${openNoteIds[0]}])
```

For a zero-valued settlement side, omit the transfer action and pass literal note id `0x0`; the ticket withdrawal and invoke remain. `TakeParams.fills` is Serde `Array` → `len` followed by `(lock_id, amount_a)` pairs. `u128` values are single felts. The account-call assembler prepends `prepare_funding(token)` before each funded operation's pool call.

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
  version: 2;
  domain: typeof PRIVATE_RFQ_V2_DOMAIN;
  rfqId: string; // 32-byte digest (unchanged semantics: intentDigest on localnet)
  rfqFelt: string; // the escrow rfq_id/deal_id felt (browser createLocalnetIntentId)
  takerCommitment: string; // felt, ephemeral taker Stark public-key x-coordinate
  chainId: StarknetPool;
  registryRevision: string;
  directoryEpoch: number;
  settlementHelper: string; // escrow address
  sellToken: string;
  buyToken: string;
  sellBucketMinBaseUnits: bigint;
  sellBucketMaxBaseUnits: bigint; // ladder rung
  createdAt: number;
  responseDeadline: number;
  expiresAt: number;
  lockExpiresAt: number; // makers must set lock.expiry == lockExpiresAt (== expiresAt)
}>;
```

No floor field. `canonicalPrivateRfqV2`, `digestPrivateRfqV2`, `assertPrivateRfqV2` mirror v1 conventions (sorted keys, decimal strings); the canonical RFQ v2 shape is unchanged apart from the semantics of `takerCommitment`. `createTakerAuthorizationKey()` uses `@scure/starknet` `utils.randomPrivateKey()` and `getStarkKey(signingKey)` to return `{ signingKey, publicKey }`; the wire `takerCommitment` is `publicKey`. `fillsDigest(fills)` is `poseidonHashMany([lockId1, amountA1, ...])` in fill order. `takeIdentityCommitment(identityKey, rfqFelt)` hashes the identity domain, pool-private key, and RFQ so the commitment differs across deals rather than becoming a stable cross-RFQ identifier. `takeMessageHash({ chainId, escrowAddress, identityCommitment, rfqFelt, tokenA, tokenB, fills })` is `poseidonHashMany([shortString('app20-take-v4'), chainId, escrowAddress, identityCommitment, rfqFelt, tokenA, tokenB, fillsDigest])`. `signTake(signingKey, message)` returns felt `{ r, s }`, and `verifyTakeSignature(publicKey, message, r, s)` verifies with `@scure/starknet`.

The browser lifecycle stores the private scalar only as `takerSigningKey` while the RFQ is active. Terminal records and history backups remove it. A Take that reached the chain and reverted terminates the RFQ as `expired` with reason `take-reverted`; its key/signature must never be reused. Only an attempt proven not submitted before wallet entry may return to review.

### 3.3 Schedule — `schedule.ts`

`PriceSchedulePoint = { a: bigint; b: bigint }`, `PriceSchedule = readonly PriceSchedulePoint[]` (1–4), `assertPriceSchedule`, `evaluatePriceSchedule(schedule, amountA): bigint` (bit-identical to Cairo §2.3), `invertPriceSchedule(schedule, targetB): bigint | null` (smallest `a` in domain with `evaluate(a) ≥ targetB`, binary search), `scheduleUnitPriceE18(schedule, a)`. Fixture vectors JSON exported for Cairo.

### 3.4 Quote v3 — `quote-v3.ts`

```ts
export const QUOTE_V3_DOMAIN = "app20/private-intent-quote/v3";
export type SolverQuoteV3 = Readonly<{
  domain: typeof QUOTE_V3_DOMAIN;
  version: 3;
  solverId: string;
  quoteKeyId: string;
  nonce: string;
  pool: StarknetPool;
  helper: string;
  escrowAddress: string;
  rfqDigest: string;
  rfqFelt: string;
  sellToken: string;
  buyToken: string;
  schedule: PriceSchedule; // over [a_0, a_{n-1}] ⊆ bucket; a_{n-1} = maxFill
  lockId: string; // felt
  lockTicket: string; // felt address
  lockTransactionHash: string; // felt
  lockExpiresAt: number;
  spreadBps: number;
  pricingProvenance: string;
  quotedAt: number;
  quoteExpiresAt: number;
  signature: string; // P-256 raw low-S over canonical JSON (same as v1/v2)
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
  version: 1;
  domain;
  rfqDigest: string;
  rule: "app20/rfq-selection/v3";
  bucket: { min: string; max: string };
  createdAt: number;
  entries: readonly {
    makerId: string;
    quoteDigest: string;
    outcome: "won" | "lost" | "refused";
    rank: number;
    amountA?: string;
  }[];
  clearingUnitPriceE18: string; // best unit price among winning fills
  digest: string; // SHA-256 of canonical body without digest
}>;
```

`createSelectionTranscript({ rfqDigest, bucket: { min: bigint; max: bigint }, createdAt, selection: SelectFillsV3Result, quotes, refusals: { makerId; quoteDigest }[] })`. Refusal digests are supplied by the caller (coordinator digest of the refusal wire object); the all-zero 32-byte digest is accepted only for outcome `refused`. Ranks: winners in fill order `1..k`; then losers that cover the exact size by `evaluate(S)` descending; then losers that do not cover it by `scheduleUnitPriceE18` at their `a_max` descending; ties by `solverId`; refused last. There is no dedicated exact-size field, but each winning entry includes `amountA`, so the full transcript reveals size by summation. `verifySelectionTranscriptForMaker(transcript, { makerId, ownQuoteDigest, ownUnitPriceE18 })` → `{ consistent: boolean; reason? }` (own digest present; if lost, `clearingUnitPriceE18 ≥ ownUnitPriceE18`). The maker node can call this only when it has a signed quote; a refused maker journals an inconsistent acknowledgement.

### 3.7 Indicative mids — `mids.ts`

```ts
export const MAKER_MID_DOMAIN = "app20/maker-indicative-mid/v1";
export type MakerIndicativeMidV1 = Readonly<{
  version: 1;
  domain;
  makerId: string;
  quoteKeyId: string;
  marketId: "STRK_USDC";
  midE18: bigint;
  observedAt: number;
  validUntil: number;
  signature: string;
}>;
```

`canonicalMakerMid`, `encode/decode`, `verifyMakerMid(mid, now, { importPublicKey, verify, resolveKey })`, `aggregateMids(mids) -> { medianE18: bigint; dispersionBps: number; count: number }` — median (even count → floor of the average of the two middle values), `dispersionBps = Number(((max − min) · 10_000n) / medianE18)` (0 when count ≤ 1), empty input → `{ medianE18: 0n, dispersionBps: 0, count: 0 }`. `formatSizeBucketLabel(symbol, bucket)` in `size-buckets.ts` renders e.g. `0.5–1 STRK`.

## 4. Maker node and localnet services

### 4.1 Maker node (`@app20/maker-node`, `scripts/localnet-maker-node.mjs`)

- New WAL record kind `LockRecordV1 { lockId, rfqDigest, rfqFelt, takerCommitment, tokenA, tokenB, schedule, maxB, expiry, ticket, lockTxHash, state: "locking"|"open"|"taken"|"expired"|"settling"|"reconcile-pending"|"settlement-unknown"|"settled"|"quarantined", priorState?, settlementAttempt?, takenA, takenB, proceedsTxHash?, releaseTxHash?, quoteDigest? }` alongside existing reservation records (same hash-chained WAL).
- Quote pipeline v3: validate RFQ v2 (ladder bucket, expiry ≤ 90 s TTL), build schedule (localnet: fixed price 2 USDC/STRK ± spread; maker B also tiers: 10 bps better above the bucket midpoint), cap `a_max` by inventory, evaluate economic policy at `a_max`, submit `Lock` through the pool (same custody path as today's fill), wait for the receipt, then sign quote v3 referencing the lock. If the lock tx fails → refuse.
- Settlement worker: every 5 s scan WAL locks with `expiry ≤ now` and finalize each unset side, including a zero-valued side, driven by `get_lock`. RPC/read uncertainty persists as `reconcile-pending`; submitted settlement uncertainty persists the exact attempt as `settlement-unknown`. Both remain active, back off, and require chain evidence before capacity is released. Contradictory or malformed durable evidence is quarantined.
- `GET /v1/mids` returns a fresh signed `MakerIndicativeMidV1` (localnet: 2.00 USDC/STRK, maker B 2.01).
- `POST /v1/transcripts` runs `verifySelectionTranscriptForMaker` when this maker has a signed quote; otherwise it journals an inconsistent “no signed quote” result. `GET /v1/transcripts` lists journaled acknowledgements for the local operations display.
- `GET /v1/locks` lists lock records (no secrets).
- `POST /v1/quotes-v3` (Bearer, called by the coordinator): body `PrivateRfqV2` wire → `{ quote: SolverQuoteV3Wire } | { refused: { reason } }`.

### 4.2 Localnet app (`scripts/localnet-app.mjs` and friends)

- Deploy `LockTicket` class; escrow constructor gets its class hash; `/config` gains `lockTicketClassHash`, `escrowAbiVersion: 3`, `ipfsProxyPath`.
- `POST /private-intents/quotes` accepts `{ account, chainId, rfq: PrivateRfqV2Wire, cohort }` and returns `{ quotes: SolverQuoteV3Wire[], refusals: [...], cohort }`; fans out to makers' `/v1/quotes-v3`; journals the request in the coordinator (`app20/localnet-reservation-coordinator/v4`, request keyed by rfqDigest; no selection lease, no loser release).
- `POST /escrow/lock` `{ lockId }` → `get_lock` as strings; `POST /escrow/take` `{ dealId }` → `get_take`.
- `POST /private-intents/transcript` `{ rfqDigest, transcript, makerIds }` → forwards to each maker, returns per-maker `{ makerId, accepted, consistent }`.
- `GET /rfq/operations/status` adds `mids: MakerIndicativeMidV1Wire[]` (fresh from makers, cached 5 s) and `locks: { open, expiredAwaitingSettlement, settled }` counts.
- The chain decoder pins the v3 ABI/digest and five new event selectors. Reader/authority uses one v3 `take` stage; `localnet-deal-validator` validates `get_take` totals against expected fills; `/rfq/unresolved-deals` and `/rfq/authority/verify` accept `{ lifecycle: "v3", transactions: { take } }`.
- The maker reconciler consumes `LockTaken`/`DealTaken` for each maker's locks and posts terminal reconciliation.
- `scripts/localnet-ipfs.mjs` is an in-memory emulator on `127.0.0.1:5054`: `POST /api/v0/add?cid-version=1&raw-leaves=true&hash=sha2-256&pin=true` (multipart, returns `{ Hash: cid, Size }`), `GET /ipfs/{cid}?format=raw` (also honours `Accept: application/vnd.ipld.raw`), `HEAD /ipfs/{cid}`, and 404 for unknown. Localnet app boots it and proxies `/__app20_localnet_ipfs` to port 5054.
- The real-pool harness deploys with the three-argument constructor and covers lock, Take, and both maker pulls through the genuine pool, including the two-unit ticket note.

## 5. Browser

### 5.1 RFQ desk (`src/app/rfq/*`, `src/lib/escrow-actions.ts`)

- `escrow-actions.ts` implements `buildEscrowLockActions`, `buildEscrowTakeActions`, `buildEscrowSettleProceedsActions`, and `buildEscrowReleaseCollateralActions` with variants `0x4` through `0x7`.
- `rfq-v3-request.ts` keeps exact sell amount/floor local, derives a fixed ladder bucket, creates/persists an ephemeral Stark signing key and public `takerCommitment`, and posts RFQ v2. The mounted desk renders its maturity gate and can defer solicitation until the estimated head block.
- `rfq-v3-selection.ts` reads each lock, verifies the maker signature and value-critical lock fields including ticket and observed creation transaction, evaluates exact size, selects one to four fills, applies the local floor, builds quote-comparison rows, and creates the transcript.
- `rfq-final-review.ts`, `rfq-funding-orchestration.ts`, and lifecycle v3 bind exact ordered fills/`fillsDigest` and implement the `reviewing → submission-unknown → settled | expired(reverted)` discipline. A Take that reached chain and reverted closes the RFQ and deletes its key; retry is possible only when non-submission was proved before wallet entry.
- `localnet-private-intents.ts` implements quote, lock, Take, transcript, and authority routes. The desk delivers the transcript before enabling Take and renders per-maker acknowledgements; chain evidence, not the transcript, establishes settlement.
- `useRfqOperations` verifies maker mids and exposes median/dispersion plus lock/transcript counts to `DeskMarketBoard` and `OperationsDashboard`; CoinGecko remains an independent browser opt-in.
- `note-maturity.ts` reads bounded public `Deposit`/`OpenNoteDeposited` events keyed to the account and estimates maturity at `blockNumber + NOTE_MATURITY_BLOCKS`. It cannot observe privately transferred notes. The desk displays this limit and offers local wait-until-mature polling.
- `rfq-v3-invoice.ts` estimates a STRK bucket from verified mids and computes the minimum selected schedule allocations that reach the exact USDC target. The desk consumes the account/chain-scoped `InvoiceDeskHandoff`, records the settled Take, and returns to Mail for maturity-gated completion.
- `rfq-history-backup.ts` implements authenticated `exportRfqHistory` / `importRfqHistory` payload v2. It exports bounded portable tombstones, recursively strips signing secrets, authenticates before ranking, rejects rollback/equivocation and ambiguous collisions, and durably stamps all restored v3 rows local/non-authoritative/`restoredFromBackup` so they remain verify-only across reload and re-export. A settled Take queues the opt-in auto-backup.

### 5.2 Mail, invoices, backup, IPFS (`src/lib`, `src/app/inbox`, `src/components/mail`, `workers/relay`)

- Nonzero Mail action IDs compile to the pinned pool's proof-bound `compute_and_invoke` path. Cairo derives an identity/action replay slot without exposing the raw identity key and separately verifies a commitment to the exact encrypted payload; plain `privacy_invoke` remains available only for repeatable zero-ID messages. This is a local shim over pool support, not a claim that the published Wallet API 0.10 action union or production wallets support the variant.
- `envelope.ts`: new types `backup_snapshot = 0x0d` and `backup_pointer = 0x0e`.
- `src/lib/backup-snapshot.ts`: `BackupSnapshotV1 { version: 1, kind: "contacts" | "rfq-resume", seq, owner, chainId, helperAddress, mailboxFingerprint, createdAt, payload, digest, mac }` using the same HKDF/HMAC discipline as `contact-backup.ts` (domain `app20/backup/v1`); `contact_snapshot` v1 remains readable.
- `src/lib/backup-blob.ts`: `sealBackupBlob({ mailboxSeed, owner, chainId, kind, seq, bytes })` → AES-256-GCM (key = HKDF(seed, salt `app20/backup-blob/v1/salt`, info `app20/backup-blob/v1:owner:chainId:kind:seq`), 12-byte nonce, AAD = info), padded to 4096-byte buckets, header `[version=1][kind][seq u32]`; `openBackupBlob`.
- `src/lib/blob-store.ts`: `BlobStore { put(bytes): Promise<{ cid }>; get(cid): Promise<Uint8Array> }`; `computeCidV1Raw(bytes)` (multihash sha2-256 → base32 `bafkrei…`); `createIpfsBlobStore({ rpcOrigin, gatewayOrigins })` (upload via `/api/v0/add`, fetch via `/ipfs/{cid}?format=raw` on each gateway until one verifies; hash mismatch → reject); `createUnavailableBlobStore(reason)`. Configuration: localnet → `ipfsProxyPath` from `/config`; production → `VITE_IPFS_RPC_ORIGIN`/`VITE_IPFS_GATEWAY_ORIGINS` (default empty → unavailable, fail closed).
- Backup flow (Chat mailbox tools): "Back up RFQ history" and "Back up contacts to this mailbox" buttons create a snapshot; if its encoded envelope fits one Mail (≤ 4,293 bytes), post `backup_snapshot` inline; otherwise seal/upload a blob and post `backup_pointer { kind, seq, cid, bucketBytes, blobDigest }`. Candidate snapshots/pointers are authenticated before sequence ranking; same-sequence disagreement is rejected and RFQ restore never falls back past an unavailable/invalid newest authenticated candidate. Import enforces scope, a durable sequence high-water, strict bounded v2 record/tombstone shape, and an explicit keep-newer merge. Every backup is a public helper transaction; settled Take only queues the opt-in request for the next unlocked Mailbox session.
- Invoices: `PaymentRequestPayload.token` may be localnet USDC (registry-resolved) in addition to STRK. `InvoiceCard` shows "Pay privately with STRK" when the invoice token is USDC, which navigates to the desk in invoice mode. Inbox shows "Complete payment" for `awaiting-note-maturity` records once `takeBlock + 10 ≤ head` (uses `note-maturity.ts`), which runs the existing memo-transfer pay path with the USDC token and the recorded amount; states `awaiting-note-maturity → reserved → submitted → confirmed`.
- Relay CSP: `headers.ts` adds `IPFS_ORIGINS` env (comma-separated HTTPS origins, same validation as Privy origins) appended to `connect-src`; default unset → unchanged CSP. `verify-production-csp.mjs` needs no change while unset.

## 6. Localnet fixture values

- Ladder as §3.1. Quote TTL 90 s; `lockExpiresAt = rfq.expiresAt = createdAt + 90`.
- Maker A: 2.00 USDC/STRK, spread 30 bps, linear 2-point schedule, `a_max = min(bucket max, inventory / price)`.
- Maker B: 2.01 mid, spread 20 bps, 3-point schedule with 10 bps better unit price above the bucket midpoint.
- Both directions (STRK→USDC, USDC→STRK) supported; USDC-sell schedules price in STRK.
- Caps unchanged (50 STRK / 100 USDC per trade on localnet).

## 7. Lifecycle of a v3 RFQ (localnet)

1. Taker enters exact size and floor → bucket + ephemeral Stark key created (`takerCommitment` is its public key) → RFQ v2 posted.
2. Coordinator fans out; each maker locks inventory on chain and returns a signed quote v3 (or refusal).
3. Browser verifies each quote against `get_lock`, evaluates schedules at the exact size, selects fills, checks the local floor.
4. Browser posts the fair-loss transcript to all invited makers.
5. Taker reviews and accepts → one `Take` transaction → USDC/STRK arrive as an OPEN note in the same transaction.
6. Locks expire at `lockExpiresAt`; maker nodes settle proceeds and release leftover collateral automatically.
7. Chain authority verifies the take; the maker reconciler journals the terminal state.

## 8. Out of scope for this program

Personal maker cohorts, constant-shape fanout, maker-sponsored fees, counter-offers, removal of the legacy v1 contract operations, production enablement of any kind.

## 9. Implementation notes

Verified against the current tree after the Cairo, protocol, maker, localnet-service, browser, and Mail/backup lanes merged:

- `LocalnetPrivateIntentDesk.tsx` mounts the v3 request, quote, transcript, final review, Take, maturity, invoice, and auto-backup orchestration. `DeskMarketBoard.tsx` and `OperationsDashboard.tsx` render verified mids and local lock/transcript status. Browser evidence remains serial localnet evidence, not production authority.
- `LockParams.token` is the implemented ABI name for token B, the collateral received from the maker; `counter_token` is token A, received later from the taker. The implementation deliberately stores them as `Lock.token_b` and `Lock.token_a`, respectively. Documentation must not reinterpret `LockParams.token` as token A.
- `SolverQuoteV3` signs `lockTicket` and `lockTransactionHash`; the browser compares them with the chain-derived `get_lock` view before selection. Take value remains defined by current contract state.
- `LockTicket.transfer_balance` accepts normal one-unit settlement transfers plus one narrowly scoped bootstrap exception: the initial two-unit escrow→pool move that deposits the maker's OPEN ticket note.
- A transcript has no top-level exact-size field, but each winning entry carries `amountA`. The coordinator receives the full transcript and forwards it to every invited maker, so summing winning allocations reveals exact sell size to the coordinator and can reveal it to each maker after selection. Refused makers can acknowledge receipt but, because they have no signed quote lock, their current maker-node verification is recorded as inconsistent rather than proving a refusal digest. These limit bucket-only disclosure to invitation time and fair-loss verification to makers that produced signed quotes.
- Take authorization binds escrow address, RFQ/deal id, ordered tokens, and mandatory ordered `fillsDigest` to the ephemeral Stark public key retained under the wire name `takerCommitment`. It does not bind the pool's output note id/owner. A copied signed Take can therefore be raced by a relayer or sequencer; the first accepted transaction consumes the RFQ. This cannot be fully repaired without an ownership-binding pool API.
- RFQ history payload v2 carries lifecycle tombstones and a per-tombstone digest. Import authenticates the containing snapshot first, then rejects rollback, equivocation, duplicates, cross-scope values, record/tombstone ambiguity, malformed/oversized IDs or payloads, and invalid lifecycle state. Tombstones persist on fresh databases and win over records. Restored v3 rows have no signing key and permanently preserve `restoredFromBackup` through reload/export/re-import. A device presented only an older authentic snapshot from before a deletion still cannot infer the absent newer tombstone.
- Invoice handoff storage is `app20/desk-handoff/invoice/v1` with a dedicated `InvoiceDeskHandoff` shape rather than a `mode: "invoice"` v3 union. Mail creates it; the mounted desk records a settled Take; Mail then enforces the ten-block completion gate.
