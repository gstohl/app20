# Mainnet confidential proof rehearsal

The operator can prepare and prove an escrow operation before enabling transaction submission. This is a real-proof integration step; a returned proof envelope is not evidence that mainnet accepted it. Public release flags remain unchanged until the full settlement and independent-wallet workflow is verified.

Run the read-only preflight:

```sh
node scripts/confidential-mainnet-proof.mjs
```

It checks the canonical pool class, the pinned escrow class declaration, a recent accepted mainnet block, a storage-proof response for that block and the current pool application fee. An undeclared class is reported separately from an RPC failure. The current full-node path supports storage proofs; the disposable devnet's missing storage-proof method does not establish a mainnet limitation. L1 acceptance can lag past the pool's proof-validity window, so the proof client passes an explicit recent block hash and checks the returned proof's block binding and expiry.

After declaring and deploying an escrow, provide an operator-owned module outside the repository:

```js
// Exports from your secure wallet adapter; do not put private keys in this module.
export async function createOptions() {
  return {
    agreement: await secureTradeStore.loadAgreement(),
    provider: mainnetRpc,
    viewingKeyProvider: escrowOnlyViewingKeyProvider,
    proofProvider: authenticatedMainnetProofProvider,
    journal: durableEscrowJournal,
  };
}
export async function sign(role, digest, review) {
  return independentWallets[role].reviewAndSign(digest, review);
}
```

The two adapters must belong to the actual counterparties. This example does not implement browser-wallet support or justify sharing ordinary wallet viewing keys. Preserve the terms, salt, escrow-only viewing material and each party's separate signing capability in their own secure storage. The hosted prover receives the private witness; HTTPS alone does not hide it from that provider.

Build the SDK and generate the setup proof:

```sh
node packages/agent-sdk/build.mjs
node scripts/confidential-mainnet-proof.mjs \
  --adapter /absolute/path/to/secure-operator-adapter.mjs \
  --mode setup \
  --output artifacts/mainnet-release/confidential-setup-proof.json
```

Supported modes are `setup`, `settle`, `refundA` and `refundB`. Settlement requires both previously funded assets; refunds require chain expiry. The command uses `createConfidentialProofClient`, which has no `fund` or `execute` method. It verifies the live chain, canonical pool, pinned escrow class and exact constructor before retrieving escrow viewing material, then independently verifies the required signatures and returned public proof envelope. The output contains only the public submission and is created exclusively with owner-only permissions. Private invocations and arbitrary provider errors are never printed.

Broadcast is a separate operator step with its own durable transaction ledger and fee limit. Re-read pool fees, estimate network gas, preserve unknown-outcome fences, and verify the submitted receipt plus decrypted outputs before marking the protocol available. Do not submit the public constructor fixtures used for fee estimation.

The upstream [transaction prover](https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover) accepts Invoke V3 transactions against finalized state; [the SDK](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/src/interfaces.ts) exposes custom signers and `computeAndInvoke`. These primitives support this experiment, but upstream does not supply APP20's two-party escrow or independent wallet adapters.
