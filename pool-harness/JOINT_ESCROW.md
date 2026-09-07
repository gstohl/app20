# Joint escrow: local STRK20 capability probe

This isolated experiment tests a different protocol from the rejected two-proof multicall. It uses one logical shielded account, two independent ephemeral signing keys, and one `compile_actions`/`apply_actions` bundle containing both encrypted transfer outputs. The contract is **experimental and unaudited**. It is now part of the normal Cairo build, but mainnet activation is disabled. The reusable SDK and browser development flow are documented in [the development guide](../docs/CONFIDENTIAL_RFQ.md).

The account and harness are in `../cairo/src/confidential_escrow.cairo` and `tests/joint-escrow.probe.mjs`. The existing paired-proof regression stays unchanged. This experiment runs explicitly, outside the ordinary `*.e2e.test.mjs` suite, because it needs the downloaded mainnet class fixture.

## Reproduce

From the repository root, after the normal pool harness dependencies are installed:

```sh
# Read-only class download. No declaration, deployment or spend on mainnet.
node scripts/prepare-confidential-rfq-probe.mjs
PATH="$PWD/vendor/bin:$PATH" RUST_LOG=warn node --test pool-harness/tests/joint-escrow.probe.mjs
```

Run serially with other pool harnesses. The test checks the downloaded Sierra hash against the pinned mainnet class and deploys that class on disposable devnet with test governance and screening keys. Reports and downloads are beneath ignored `artifacts/confidential-rfq/`; never commit proof invocations, private registries or test key exports.

## Authorization and value flow

1. Both parties agree on two distinct assets, exact positive amounts, recipient addresses, an expiry, and a random 248-bit salt. Public constructor data contains the salted terms commitment, ephemeral public signing keys, deadline, pool address and pinned pool class. It does not contain the plaintext pair, amounts or recipients.
2. They jointly authorize registration of one escrow viewing key and the required outgoing channels. This key is shared escrow material, distinct from either party's ordinary wallet viewing key. The test keeps all private data in memory.
3. Each party funds its agreed asset using a separate encrypted pool transfer. Funding is not atomic: a party that funds first may have to wait for the deadline to recover its asset.
4. Settlement requires both signing keys. The policy parses the exact pinned client-action ABI and requires encrypted asset A to party B and encrypted asset B to party A, in the committed amounts. Surplus may return only to that asset's original owner. OPEN notes, withdrawals, deposits and plain external invokes are rejected.
5. After expiry, either party can independently authorize refunds of its original asset to its original address. This uses a new signature/proof, not a pre-signed refund that may expire. Refunds are repeatable so partial recovery or later funding cannot permanently close the recovery path.

Each authorization binds a separate domain, chain, deployed escrow address, pool address/class, terms commitment, mode and the complete private compile calldata. The standard transaction-hash and CallSet signature fallbacks always reject. Unknown actions, extra calls, trailing calldata and a missing callback fail closed.

## Deadline and callback binding

Every accepted operation ends with `ComputeAndInvoke` targeting this escrow. The compute step checks the pool-derived identity against the escrow address and its private viewing key. A different pool user cannot obtain an accepted callback by copying the public result tag. There is no plain `privacy_invoke` endpoint.

The server callback requires the pinned pool as caller and rechecks its class. It enforces the **actual execution timestamp**: settlement expires, refunds cannot execute early, and a settlement can succeed only once. A callback failure reverts the entire pool operation, including the encrypted outputs and nullifier writes. A local cancel after releasing signatures does not revoke an otherwise valid pre-expiry settlement.

## Evidence boundary

September 7, 2026: **26 recorded cases passed** against pinned mainnet class `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` deployed locally. The final run completed in approximately 307 seconds. It inspected five pool/escrow receipt events and both the pool and escrow callback traces. Final decrypted balances accounted for exactly one 1,234-unit/2,345-unit swap; all other funding was returned. No new mainnet transaction was submitted.

The promoted `App20ConfidentialEscrow` class was rechecked in this run. The shared SDK also passed its independent-approval and restart/refund test against the same pinned pool class. The result is saved locally as `artifacts/confidential-rfq/joint-escrow-feasibility.json`. Contract compilation, Cairo formatting, JavaScript syntax and whitespace checks also passed.

The harness simulates the pool's signed `__execute__`, so Cairo custom-signature checks really run. It fabricates the proof-facts envelope for devnet, which deliberately runs without cryptographic proof verification. The test asserts that proof bytes are absent and that both asset outputs are covered by one message hash. This is an execution and authorization experiment, **not a generated STARK proof, formal verification or evidence of mainnet execution**.

Public settlement actions are decoded and restricted to encrypted-note writes/events, nullifiers and the identity-bound callback. Supplemental scans check for plaintext test amounts, assets, recipients, viewing key and terms salt in the submitted calldata, pool/escrow receipt events, their call inputs/outputs and their storage diffs. Protocol gas/fee transfers are outside that scan. This does not establish cryptographic indistinguishability or resistance to traffic analysis.

The local RPC preflight currently returns error 42, `Devnet doesn't support storage proofs`, for `starknet_getStorageProof`. The upstream transaction prover's RPC runner uses a storage-proof provider to construct the virtual OS input. A real-proof test needs compatible state and storage proofs from a full node with this account deployed; starting a prover against this devnet alone cannot supply that missing evidence. No public chain has been modified to satisfy that requirement. See the [upstream transaction prover](https://github.com/starkware-libs/sequencer/tree/avi/privacy/configmap-docs/crates/starknet_transaction_prover) and [RPC runner](https://github.com/starkware-libs/sequencer/blob/avi/privacy/configmap-docs/crates/starknet_transaction_prover/src/running/runner.rs).

## Remaining protocol and product work

- Real STARK proof generation and independent verification, plus adversarial execution against compatible full-node state.
- Independent review of the parser, account authentication, callback binding, encrypted-note validity and concurrency/reorg behavior.
- Independent wallet adapters and secure escrow-key exchange. The development SDK now verifies terms, destinations, deployed configuration and funded notes before signing, and journals submissions durably. The normal browser wallet API is not assumed to support this protocol.
- Authenticated private negotiation and confidential inventory reservations; no public MakerBook transaction for each confidential quote.
- A measured proving trust boundary. A hosted prover sees the private invocation, including escrow terms and viewing material. This account does not hide the witness from it. Pool auditor/screening capabilities remain as specified by STRK20.
- Metadata review: escrow deployment, public ephemeral signing keys, expiry, registration/channel setup, callback identity, settlement flag, fees, output count and timing remain observable. Initial shielding, final unshielding and hedges may reveal amounts separately.
- Recovery remains conditional on the pool being available and retaining the pinned class. An upgrade or pause can prevent refunds; pinning avoids silently accepting new semantics but is not unconditional liveness. Unsupported-asset donations are outside the policy.

The probe does not activate production or alter mainnet submission evidence. The separately implemented SDK, browser workspace and matching demo describe a development capability, with real-proof and mainnet gates kept closed.
