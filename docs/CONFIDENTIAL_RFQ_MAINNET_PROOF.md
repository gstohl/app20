# Mainnet confidential proof rehearsal

The complete controlled Node SDK settlement is verified on mainnet: setup, separate encrypted funding and one atomic exchange succeeded, and receipt/trace checks plus fixed-block private discovery confirmed both agreed encrypted outputs. See [the sanitized September 8 evidence](../deployments/mainnet/confidential-settlement-2026-09-08.json). `realProofVerified` is true. One operator controlled both wallets and funded both legs; native Ready wallet acceptance, mainnet refunds and independent review remain unverified.

The operator can still prepare and prove an escrow operation without submitting it. A returned proof envelope alone is not evidence of chain acceptance; the separate receipt and encrypted-output checks remain necessary for every claimed execution.

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

All Invoke V3 signature felts must use canonical `0x`-prefixed hexadecimal strings. Decimal strings caused a raw JSON-RPC `-32602` rejection before Cairo execution; canonical serialization fixed the setup proof without changing its signed values or policy.

For the verified run, Publicnode supported proof-aware fee estimation, fully validated simulation, submission and the PROOF1 transaction trace. Cartridge supplied storage proofs, but its trace replay rejected PROOF1. Use exact accepted block hashes for proving and verify the returned block binding; provider capability differences must not be bypassed by skipping final transaction validation.

Broadcast is a separate operator step with its own durable transaction ledger and fee limit. Re-read pool fees, estimate network gas, preserve unknown-outcome fences, and verify the submitted receipt plus decrypted outputs before marking the settlement flow verified. Do not submit the public constructor fixtures used for fee estimation.

The upstream [transaction prover](https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover) accepts Invoke V3 transactions against finalized state; [the SDK](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/src/interfaces.ts) exposes custom signers and `computeAndInvoke`. These primitives support this experiment, but upstream does not supply APP20's two-party escrow or independent wallet adapters.
