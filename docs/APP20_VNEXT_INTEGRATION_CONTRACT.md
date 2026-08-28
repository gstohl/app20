# APP20 VNext TypeScript ↔ Cairo integration contract

**Status:** frozen implementation handoff; non-deployable. No canonical Cairo, ABI selector, class hash, address, or public-network approval exists. **The Cairo team owns every `.cairo` source and test; APP20 will not author Cairo.** Legacy localnet `App20Escrow`/`ClaimTicket` remain fixtures only.

## C1. Classes and deployment model

- Production uses new immutable, versioned `App20Escrow` and `App20Claim` classes. `cairo/src/escrow.cairo` and `cairo/src/claim_ticket.cairo` must never be declared on a public network or copied into runtime configuration.
- Each approved network/release has one escrow, one escrow-pinned claim class, and one deterministic claim instance per deal, deployed by escrow. Use the existing reviewed STRK20 pool and never `MockErc20` publicly.
- Semantic upgrades require new class/address pairs. There is no `replace_class`, proxy, delegate call, registry setter, token setter, or pool setter.

Constructor calldata order is frozen:

```text
constructor(
  pool: ContractAddress,
  claim_class_hash: ClassHash,
  native_chain_id: felt252,
  registry_revision_digest: Digest256,
  token_0: ContractAddress,
  token_1: ContractAddress,
  controls: ContractAddress
)
```

All addresses/class hashes are nonzero, tokens differ, runtime chain ID equals `native_chain_id`, and pool/claim class/chain/registry/assets never change. `controls` changes only pause/drain. It cannot change recipients, assets, amounts, deadlines, tickets, or bindings. V1 has no surplus sweep. Removing controls requires a new versioned class.

UDC—not the deployer account—is the constructor caller. Sepolia/Mainnet UDC is `0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125`. Prefer origin-independent deployment (`not_from_zero=false`; no sncast `--unique`). Claim deployer is escrow, salt is `deal_id`, class is the pinned claim class, and calldata is `(escrow, pool, deal_id, commitment_digest)`. Its precomputed address must equal committed `claimTicketIdentity` before Fund.

Do not declare with `sncast --no-abi`. Pin Scarb/Cairo and `Scarb.lock`; build and declare with the same named profile and `casm = true`. Two independent builders must reproduce ABI/Sierra/CASM bytes plus Sierra and compiled class hashes. `sncast --wait` is not L1 finality.

## C2. Digest256 and commitment codec

SHA-256 is never one felt:

```text
struct Digest256 { low: u128, high: u128 }
```

For an exact `0x`-prefixed 32-byte big-endian digest, `low = digest & (2^128 - 1)` and `high = digest >> 128`. Cairo ABI order is `[low, high]`. Amounts and reservation fences are positive `u256`; deadlines are `u64` and remain JavaScript safe integers. Addresses, deal IDs, note IDs, and class hashes are field values.

Cairo must SHA-256 the exact UTF-8 JSON produced by `canonicalVnextSettlementContext` and `canonicalVnextCommitment` in `src/lib/escrow-vnext.ts`. If SHA-256-of-JSON is infeasible, stop and request a versioned TypeScript codec migration; never substitute a typed preimage silently.

Frozen JSON keys include `claimTicketClassHash` and `claimTicketIdentity`; semantically they are the App20Claim class hash and per-deal App20Claim address. Renaming changes the digest. Domains:

- pre-quote: `app20/escrow-vnext-settlement-context/v1`
- final: `app20/escrow-vnext-commitment/v1`
- quote: `app20/private-intent-quote/v2`

The pre-quote context omits only `winningQuoteDigest`, `reservationId`, `reservationFence`, `buyAmountBaseUnits`, and `settlementContextDigest`.

Golden canonical settlement-context UTF-8 JSON:

```json
{"buyToken":"0x8","chainId":"starknet:SN_SEPOLIA","claimTicketClassHash":"0x3","claimTicketIdentity":"0xa","deadline":1900000000,"dealId":"0x9","directoryDigest":"0x1111111111111111111111111111111111111111111111111111111111111111","directoryEpoch":1,"domain":"app20/escrow-vnext-settlement-context/v1","escrowAddress":"0x1","escrowClassHash":"0x2","intentDigest":"0x1111111111111111111111111111111111111111111111111111111111111111","makerId":"maker","makerSettlementAccount":"0x5","poolAddress":"0x4","quoteKeyId":"q1","registryRevision":"r1","rfqDigest":"0x1111111111111111111111111111111111111111111111111111111111111111","sellAmountBaseUnits":"2","sellToken":"0x7","takerSettlementAccount":"0x6","transportKeyId":"t1"}
```

```text
settlement context
  0x8fa8b01bdcf2baabd010d1a31782ce546467127f552f08e0c38cb442cc3ab17b
  low  0x6467127f552f08e0c38cb442cc3ab17b
  high 0x8fa8b01bdcf2baabd010d1a31782ce54
final commitment
  0x5a9260555142293af540e5dea09ec23f7ebbf4e386d71a7b5b36352e396583fc
  low  0x7ebbf4e386d71a7b5b36352e396583fc
  high 0x5a9260555142293af540e5dea09ec23f
repeated 0x11…11
  low  0x11111111111111111111111111111111
  high 0x11111111111111111111111111111111
```

All exceed the Stark field; one-felt designs are incompatible.

## C3. STRK20 transport ABI

There is one pool-callable entrypoint, not four public selectors:

```text
privacy_invoke(
  operation: EscrowOperationV1,
  deal_id: felt252,
  pool_address_placeholder: ContractAddress,
  destination_open_note_id: felt252
) -> Span<OpenNoteDeposit>

EscrowOperationV1 = Fund(FundV1) | Fill(FillV1) | Claim(ClaimV1) | Timeout(TimeoutV1)
```

`pool_address_placeholder` is not authority; caller must equal the pinned pool.

```text
FundV1: complete VnextCommitment preimage; commitment_digest: Digest256
FillV1: commitment_digest, reservation_id, reservation_fence,
        winning_quote_digest, buy_token, buy_amount
ClaimV1: commitment_digest, claim_identity
TimeoutV1: commitment_digest, claim_identity
```

Return exactly one deposit per operation: Fund `(destination, claim_identity, 1)`; Fill `(destination, sell_token, sell_amount)`; Claim `(destination, buy_token, buy_amount)`; Timeout `(destination, sell_token, sell_amount)`. Empty spans are forbidden.

Every VNext Wallet API batch has exactly one `transfer { amount: "OPEN" }` before one `invoke`, with raw `${poolAddress}` and `${openNoteIds[0]}` strings. Until reviewed Ready+pool confirmation, preserve the three-action shape: explicit incoming-asset withdrawal to helper, OPEN transfer, invoke. Do not invent `shadow_account_invoke` or copy localnet variants `0x0..0x3`.

Production Claim/Timeout remain disabled until the Ready wallet provides preassembly note IDs or wallet-resolved signing over `${openNoteIds[n]}`. Destination binding cannot be removed. Localnet V2 keeps its vendored `args.openNotes` callback and remains separate.

## C4. State, accounting, claim, deadline, and fence policy

```text
Empty --Fund--> Funded
Funded --Fill, timestamp < deadline--> Filled
Funded --Timeout, timestamp >= deadline--> TimedOut
Filled --Claim, any later timestamp--> Claimed
```

Full fill is exact; short/excess revert. At the deadline Fill fails and Timeout succeeds. Claim remains indefinitely. Terminal transitions never replay. The ticket mints once and burns once, supply is 0/1, decimals 0, only escrow mints/burns, only escrow/pool transfers or approves, and amount is exactly one.

Each deal and commitment/reservation/claim identity is unique. `highest_fence[reservation_id]` only increases. Final commitment binds the maker-selected fence, which must be at least the positive signed quote fence. Per-token liability equals unresolved obligations; balances never fall below it. Fund adds exact sell liability; Fill subtracts exact sell and adds exact buy; Claim subtracts exact buy; Timeout subtracts exact sell. Surplus never credits a deal. Shared `balance delta >= expected` is forbidden. State, ticket action, value transition, approval, and returned deposit are atomic.

| mode | Fund | Fill | Claim | Timeout |
| --- | --- | --- | --- | --- |
| normal | yes | before deadline | yes | at/after deadline |
| paused | no | no | yes | yes |
| draining | no | before deadline | yes | yes |

Off-chain policy sets commitment deadline to `min(quoteExpiresAt, reservationExpiresAt, RFQ expiry, directory validUntil)` before Fund. The contract sees only that one deadline.

## C5. Events and receipts

Canonical event source is escrow. Names are exactly `Funded`, `Filled`, `Claimed`, `TimedOut`. Every event key list is `deal_id`, `commitment_digest.low`, `commitment_digest.high`. Every event repeats an ABI-versioned static binding sufficient to recover the complete receipt binding plus pool, claim class/identity, transport key, maker identity, settlement accounts, and deadline.

Stage data includes: Funded sell token/amount, deadline, claim identity; Filled maker account, reservation ID/fence, winning quote digest, buy token/amount; Claimed claim identity and actual buy token/amount; TimedOut claim identity and actual original sell token/amount. If payload size is infeasible, stop and renegotiate before ABI freeze—never ship sparse unrecoverable events.

`Funded → Filled → Claimed` maps to `settled`; `Funded → TimedOut` maps to `refunded`, returning the exact input asset/amount.

APP20 finality means block `l1_accepted`, receipt `ACCEPTED_ON_L1` and `SUCCEEDED`, unanimous canonical block-number membership from at least two reviewed independent RPC operators, and matching class hash at the event block. Never use `latest`, `PRE_CONFIRMED`, `RECEIVED`, `sncast --wait`, or one provider as finality.

## C6. Cairo-team deliverables

The separate Cairo lane supplies: reviewed source commit; production package separated from MockErc20/legacy fixtures; pinned Scarb/Cairo/snforge/sncast and container digest; exact named-profile build; ABI/Sierra/CASM bytes and SHA-256; Sierra/compiled class hashes; constructor calldata/digest; two-builder attestations; and an adversarial snforge matrix covering deployment, state transitions, claim rules, accounting, hostile tokens, reentrancy, pause/drain, events, and upgrade denial. This APP20 session declares/deploys nothing.

APP20 manifests may be updated only from an accepted evidence pack, never from UI, explorer, or unreviewed RPC.

## C7. External and sibling boundaries

- `strk20-privvy` provenance/package tracking is sibling work. Generic `PrivacyInvokeInput` must not contain APP20 recovery policy.
- Cairo/protocol/operations audits remain external and are not closed by local tests.
- HSM/KMS custody, independent maker operators, production Postgres, and reviewed RPC operators are out of this localnet-only contract.
- Existing localnet V2 actions and `LocalnetPrivateIntentDesk` wiring remain unchanged. Public RFQ, production helpers, deployment, funding, signing, broadcasting, and network transactions remain disabled.
