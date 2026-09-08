# Confidential RFQ — design and feasibility gates

Prepared September 7, 2026. Status: the paired-proof candidate failed; the alternative jointly authorized escrow passed local settlement/refund execution gates with simulated proof facts. The escrow has now been implemented in the normal Cairo build, with a Node SDK, recovery journal and local browser workspace. The September 8 follow-up enabled mainnet and verified a controlled real-proof settlement with both exact encrypted outputs. Browser integration is implemented; native Ready end-to-end acceptance, mainnet refunds and independent review remain unverified. See [the current development guide](CONFIDENTIAL_RFQ.md).

## Objective and limits

Replace APP20's public funded-quote settlement with an atomic exchange of two independently owned, encrypted STRK20 note balances. Exact amounts, pair, direction, price and funded terms must not appear in public settlement calldata, storage, events or ERC-20 trade movements. An accepted trade must deliver both agreed assets or neither. Each counterparty still sees the terms of its own trade.

“Fully private” is not a defensible unqualified product claim. Pool activity, timing, note/proof shapes and fixed protocol fees can remain public. Initial shielding, final unshielding and maker hedges have public token movements; do not bundle them with a trade. A party can disclose its own quote. Relayers and network operators observe their connection metadata. A hosted prover sees its witness unless a different, verified proving trust boundary is used. STRK20's protocol disclosure and screening rules remain unchanged.

## Findings in the current implementation

| Surface | Current disclosure | Required change |
|---|---|---|
| `cairo/src/private_swap.cairo` — reserve, quote storage, QuoteFilled | Plaintext pair, amounts, reservation, maker inventory/proceeds and fill | Replace this settlement path; removing events alone is insufficient |
| `packages/private-intents/src/private-settlement.ts` — buildPrivateSettlementActions | Withdraw sell amount to helper, create OPEN buy note | Trade entirely between encrypted notes; no public trade withdrawal or OPEN output |
| `cairo/src/maker_book.cairo` — request/respond | Taker account, selected maker, request ID and expiry publicly linked | Off-chain padded encrypted quote transport; public directory only for maker discovery |
| `packages/private-intents/src/starknet-maker.ts` | HPKE protects bodies, but scopes and request transactions identify participants | Fresh encrypted-session identifiers, no public per-RFQ account transaction |
| `packages/agent-sdk/src/index.ts` — request, settle; maker operator | Public reservations and inventory; signer-bound public request | Wallet-side encrypted-note reservations and confidential protocol adapter |
| `packages/agent-sdk/src/privacy.ts`, `workers/relay/src/starkscan-prover.ts` | Hosted proof payload accessible to relay/provider | Separate endpoint-encrypted intermediary transport from witness privacy; self-controlled proving for the stronger provider-excluding goal |
| `src/app/rfq/MainnetTradeWorkspace.tsx` | Current public settlement is the executable path | New explicit capability only after binding, atomicity and leak tests pass; never silently fall back |

## Upstream capability review

Inspected the pinned SDK and current upstream SDK interface, changelog, pool client/server actions and signature validation. The pool compiler authenticates one user per proof invocation. Its public SDK exposes encrypted transfers, withdrawals, OPEN notes, external invokes and ComputeAndInvoke, but no documented two-owner confidential atomic-swap operation. `ComputeAndInvoke` authenticates an identity-derived computation; arbitrary compute input is not automatically an attestation that a particular payment occurred. Signing two transfers and submitting them in a multicall does not prevent someone extracting and executing only one leg.

AVNU private swaps were considered. Its documented path withdraws the sell amount to an executor and returns the bought asset through an OPEN note. That is not a replacement for this amount-confidential RFQ requirement. Shadow accounts hide wallet links; they do not hide public DEX terms.

This review does not prove that a protocol cannot be built on STRK20. It establishes that there is no verified drop-in route in the interfaces inspected. No runtime capability should be inferred from a design sketch.

## Prototype finding: paired pool proofs cannot be composed this way

The first capability gate has a concrete rejection, not merely an undocumented SDK feature. `validate_proof` in the inspected pool requires `message_to_l1_hashes == [message_hash]`: exactly one message matching that call's actions. Two distinct action bodies require different singleton values in the same transaction-wide proof facts. Appending both hashes fails the equality check; a Cairo wrapper cannot change transaction-wide proof facts between calls.

The isolated SDK test and Cairo `ProofPairProbe` exercise this on the local pool and on a downloaded copy of the exact pinned mainnet class deployed to devnet. They build valid, independently signed encrypted-note transfers, try both singleton envelopes and a two-message envelope, and test a nested wrapper. Rejected bundles leave both balances unchanged. Separate execution of the same prepared legs is a control demonstrating one-sided payment, not a proposed workaround. See [the experiment and reproduction instructions](../pool-harness/CONFIDENTIAL_RFQ.md).

These are real contract executions with **simulated proof facts**, not real STARK proof generation or mainnet transactions. The mainnet-class experiment uses fresh local storage, governance and screening keys. It tests the deployed class's proof-message rule, not its live configuration. No mock acceptance is treated as cryptographic evidence.

The proposed paired-apply candidate below is therefore **not compatible with the tested pool validation rule**. Work on its callback coordinator and wallet UI stops at this prerequisite. This does not prove that every confidential exchange protocol is impossible: a supported multi-party pool primitive or a separately designed confidential escrow could have different authorizations and funding semantics. The jointly authorized escrow has since been implemented as the development path described below.

The subsequent [integration comparison and single-proof escrow candidate](CONFIDENTIAL_RFQ_ALTERNATIVES.md) records other routes. In particular, using one jointly authorized account is a different hypothesis from combining two pool proofs; its local custody/refund gates passed, followed by a [controlled real-proof mainnet settlement](../deployments/mainnet/confidential-settlement-2026-09-08.json). Native Ready end-to-end acceptance remains unverified.

## Rejected candidate: two mutually bound private legs

This was the protocol hypothesis for the isolated local prototype. The composition gate above failed before callback implementation. The sketch remains here to document the exact candidate rejected and its remaining requirements; it must not be treated as executable architecture.

1. Both parties fund and mature encrypted notes before negotiating. Establish needed private channels outside the trade. The maker retains its funds; no new central custodian receives a viewing key or signing authority.
2. Negotiate inside fresh, padded, authenticated encrypted sessions. Bind chain, pool/class, protocol version, quote nonce, both private transfer destinations, pair, quantities, floor and expiry. Keep the complete transcript off-chain. Public commitments need unpredictable randomness to resist dictionary attacks against common sizes.
3. Each wallet independently prepares its own private transfer leg. It must verify the other leg actually creates a decryptable encrypted note of the agreed token and amount for that wallet. A peer's plaintext JSON assertion or signature over an unrelated commitment is insufficient. Design and verify a wallet-side preview from the actual proof-bound note writes; do not send user viewing keys or private proof invocations to APP20 or the counterparty.
4. Couple the two proof outputs cryptographically. One candidate is a strict canonical hash of each leg's serialized public server actions, excluding only a narrowly specified final coordinator callback. Each leg's proof-bound callback must commit to the other leg's canonical body and the same random deal context, domain, role and expiry. This avoids a circular hash of two callbacks containing each other's full hashes. The omitted field, serialization and role checks are security-critical and require independent review.
5. A proposed coordinator entrypoint accepts exactly the two pinned-pool apply calls and proof facts. It computes both body commitments, establishes an internal active context, applies each leg, verifies both callbacks, and closes the context in one outer transaction. There is no separately callable public “begin” that leaves a context open. The callbacks require the pinned pool, correct active context and role. Calling either leg outside that atomic wrapper must revert its entire pool update. Reentrancy, duplicate callbacks and unexpected actions are refused.
6. Reject public trade deposits/withdrawals, OPEN outputs, token movements to arbitrary destinations and extra helper calls. Protocol-required fee movements must be a separately identified, exactly bounded fee allowance; a trade cannot be disguised as a fee. Reuse of old input nullifiers or a changed recipient, amount, peer leg or domain must fail.
7. The final relayed public transaction contains encrypted note writes, nullifiers, opaque commitments and protocol activity. Counterparties verify receipt inclusion and encrypted-note discovery before reporting completion. A transport timeout is not permission to release reserved notes or repeat a payment.

Unresolved compatibility details: obtaining and validating private incoming-note previews without exposing either owner's secrets; deterministic pre-signing leg-body compilation; the exact proof-fact aggregation accepted by the deployed pool and Starknet node; strict versioned server-action decoding; interaction with the pool's reentrancy protection, fee collection and screening; real wallet support for the paired authorizations. These are prototype acceptance criteria, not assumed APIs.

## Cancellation and failure semantics

Before signatures or executable proofs leave a wallet, local cancellation can discard preparation. After release, an unexpired authorized bundle may still execute; a UI cancel button must not claim otherwise. A reviewed expiry/revocation mechanism and authoritative nullifier state must decide when funds become available again. One-sided note spending must make the whole proposed swap fail, not let the surviving leg pay. Crashes, relay retries and duplicate submissions require durable state and reconciliation.

## Proving and metadata work

A relayer must never receive viewing keys, unsigned private actions or a readable quote transcript. OHTTP can hide payloads from an intermediary but the selected proving endpoint still sees the witness. A promise of secrecy from external proving providers requires working wallet/local/self-controlled proving, not a boolean or an unimplemented backend. Keep that capability unavailable until a real proof is generated and accepted through it. Do not promise laptop performance.

Move per-RFQ traffic off the public MakerBook while retaining permissionless maker discovery. The existing HPKE and dormant relay modules are reusable building blocks, not an already approved confidential transport: inspect authentication, session-to-account linkage, logs, quotas, request identifiers and ciphertext lengths. Padding and fresh sessions reduce linkage; they do not establish resistance to global timing analysis.

## Delivery and validation

### Phase 0 — complete: capability and leakage review

Source inspection and upstream freshness checks completed. No application behavior changed. Installed pins remain starknet 10.5.0, privacy SDK 0.14.3-rc.5, wallet types 0.10.3, discovery/wallet-standard 6.0.3, Cairo 2.18.0 and snforge 0.63.0. The freshness checker reported discovery 6.0.4, wallet-standard 6.0.5 and the shadow-account package rename. No upgrade is inferred to implement a confidential swap.

### Phase 1 — local escrow execution passed; real-proof gate remains open

Implemented `pool-harness/tests/confidential-rfq-feasibility.e2e.test.mjs`, the separate `pool-harness/contracts/` Cairo probe, and the read-only mainnet class download/verification script. Ordinary encrypted transfer legs work independently; their paired application is rejected. That negative regression remains unchanged.

The alternative `App20ConfidentialEscrow` and `joint-escrow.probe.mjs` now exercise one pool account with two distinct ephemeral signing keys. The exact mainnet pool class, deployed on devnet, accepts a single action bundle delivering both assets as encrypted notes. A strict action policy and identity-bound callback enforce committed amounts/recipients, joint settlement, actual execution deadlines and independent asset-bound refunds. Early refunds and stale settlements revert; both parties recover independently after expiry, including later one-sided funding. The final run passed 26 recorded cases and scanned pool/escrow calldata, events, call inputs/outputs and storage diffs for the private test fields. See [the protocol and evidence boundary](../pool-harness/JOINT_ESCROW.md).

This changes custody and funding semantics: counterparties first fund a shared shielded account in separate transactions. The escrow viewing key is shared limited-scope material, never an ordinary wallet key. The local harness simulates proof facts; it does not generate a cryptographic STARK proof. The node reports that storage proofs are unsupported. Real-proof execution, wallet support and review must pass before production activation. The user approved development implementation while these gates remain closed. Pool upgrades/pauses and recovery of unsupported-asset donations also remain outside the demonstrated liveness guarantees.

Use an isolated two-account SDK harness with in-memory test secrets and the real pool implementation. Add a new protocol namespace rather than changing old signed-message domains. Implement the wallet-side proof-output preview and commitment codec only against a verified ABI. The coordinator, if required, is a new contract, never an event-only patch to the current helper. Expected code areas: a new confidential-settlement module alongside `packages/private-intents/src/private-settlement.ts`, a Node adapter under `packages/agent-sdk/src/`, and a new test under `pool-harness/tests/`.

Acceptance: two differently owned encrypted balances exchange atomically; decrypted outputs are exact; an independently submitted leg fails; malicious peer outputs fail; no public trade amounts/pair or OPEN outputs appear in raw calldata, decoded events, traces or state changes. Devnet mock proofs alone are not cryptographic verification evidence. Repeat successful and adversarial cases with real proofs before asserting feasibility on the live protocol.

### Phase 2 — implementation delivered; controlled mainnet settlement verified

The normal Cairo contract, pinned class hashes, independent-signature Node client, private action review, public proof-output checks, durable funding/submission recovery, actual local browser flow, release denial checks and agent documentation are implemented. The SDK regression uses the same client as the browser fixture. [Current guide](CONFIDENTIAL_RFQ.md).

The browser wallet adapter, encrypted RFQ rooms, durable journals and a separate confidential maker are now implemented. Native Ready end-to-end acceptance and independently operated maker liquidity need separate verification. Continue testing transport, inventory reservations, cancellation/reconciliation and wallet capability detection. Test minimums, token decimals, stale quotes, key rotations, domain replay, peer substitution, partial fills, changed amounts, duplicate nullifiers, reentrancy, fee camouflage, callback stripping, timeout/reorg and provider failure. No automatic fallback to the public helper or two independent payments.

### Phase 3 — deployment recorded; independent review remains outstanding

Mainnet deployment and controlled settlement are recorded in the [September 8 evidence](../deployments/mainnet/confidential-settlement-2026-09-08.json), including receipt-block pins, trace checks and exact encrypted-output verification. The prior mainnet swaps remain evidence of the old design. Independent review of the cryptographic bindings, wallet trust boundary and Cairo is still outstanding; accepted chain execution does not substitute for that review. Keep product wording and new media scoped to the verified capability. The historical submission and GitHub release remain unchanged.

## Sources

- [Current upstream SDK interface](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/src/interfaces.ts)
- [Pool compiler and application code](https://github.com/starkware-libs/starknet-privacy/blob/main/packages/privacy/src/privacy.cairo)
- [Client/server action definitions](https://github.com/starkware-libs/starknet-privacy/blob/main/packages/privacy/src/actions.cairo)
- [SDK changelog](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/CHANGELOG.md)
- [STRK20 private transfers](https://strk20-by-example.org/sdk/transfer)
- [AVNU private-swap flow](https://docs.avnu.fi/docs/privacy/private-swap)
