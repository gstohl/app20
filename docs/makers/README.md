# Historical maker recovery and confidential RFQ development

Updated September 8, 2026. APP20 now requires private settlement for every new trade, including trades discussed in Chat. The earlier `App20MakerBook` / `App20PrivateSwap` route exposed funded amounts, assets and maker inventory. **New registration, inventory funding, quote creation and settlement through that route are disabled in the app, SDK and bundled maker CLI.**

The contracts remain on mainnet at the [recorded deployment](../../deployments/mainnet/private-settlement.json); a client release cannot prevent direct contract calls or erase earlier transactions. The three September 7 swaps are historical evidence of public-term settlement, not evidence of the new confidential escrow. See [the private settlement policy](../PRIVATE_SETTLEMENT_POLICY.md).

## Recover an existing operator

Use Node 24+, the original operator configuration, persistent state and a signer controlling its recorded account. Start with a read-only check:

```sh
npm run maker -- /absolute/path/existing-operator.json --check
npm run maker -- /absolute/path/existing-operator.json --reconcile
```

The supported commands are:

| Command | Behavior |
| --- | --- |
| `--check` | Verify configuration and deployment identities without loading a signing key or submitting |
| `--reconcile` | Check a saved pending transaction receipt without submitting |
| `--release` | Release tracked expired reservations to their original maker's available inventory |
| `--withdraw` | Withdraw the explicit available amount to its original maker account |
| `--deactivate` | Disable new requests to the historical maker registration |

`--register`, `--fund` and `--run` reject with a confidential-settlement requirement. There is no new public-term quoting mode. `--init-key` only creates a protected local transport-key file; it does not enable registration.

For withdrawals, configure `inventoryWithdrawal: { "token": "TOKEN_ADDRESS", "amount": "DECIMAL_BASE_UNITS" }` explicitly. Supply `APP20_MAKER_SIGNING_KEY` through local secret management and retain any transport material needed by the original config. Never place private keys in browser fields, source control, URLs, shell history or `VITE_*` variables. The signer must control the configured account. `maxFeePerTransaction` and `maxTotalFees` remain explicit STRK base-unit limits.

These recovery transactions remain public under the old contracts: asset, amount, account and timing may be visible. Withdrawals cannot spend reserved output or another maker's available balance. Releases require expiry and always credit the original maker. Deactivation does not cancel funded reservations; the deployed contract can still honor them until expiry even though this application no longer offers acceptance.

## Preserve recovery state

The bot records pending attempts before broadcast, atomically writes state and prevents concurrent processes sharing one journal. A known transaction hash can be reconciled. An attempt with no hash needs account-activity investigation; never clear it and blindly resubmit. After a crash, verify that the process has exited and inspect its attempt before removing a stale lock.

Preserve the state file, account keys and original config. Deleting state resets local fee accounting and its tracked reservation index, not on-chain ownership or broadcasts. `QuoteReserved` events and the `quote(id)` view can identify old reservations; `release_expired(id)` remains permissionless after expiry. Recovery verifies deployment identities even when new pool output-note deposits are unavailable. This is not a claim of complete economic finality before L1 confirmation.

The `/rfq/maker` page and [agent SDK](../../packages/agent-sdk/README.md) expose historical inspection and recovery. The downloadable CLI and its checksum remain under `/downloads/`. Downloaded older binaries are not automatically updated; use the current release's checksum-verified build.

## Confidential maker integration

The replacement is `App20ConfidentialEscrow` with `@app20/agent-sdk/confidential`. Each party funds from its own shielded notes, retains its own signing key, and approves the exact action bundle. One bundle produces both encrypted outputs. After expiry a party can independently recover its original asset using current notes. The protocol rejects OPEN notes, trade withdrawals and altered destinations.

The existing maker's public inventory contract, reservation loop and MakerBook quote messages do not operate this escrow. Production encrypted negotiation, independent wallet adapters, private inventory reservation and operator integration remain required. Do not construct a pair of independent transfers as a swap fallback.

```sh
npm run dev:confidential
# Open http://127.0.0.1:5198/rfq/confidential
```

The development workspace controls two disposable wallets and executes local Cairo with simulated proof facts. **Mainnet activation remains disabled.** Real STARK proof acceptance, independent wallet integration and review remain open. A hosted prover sees its witness; escrow activity, timing, fees and ciphertext shape remain observable. [Development and recovery guide](../CONFIDENTIAL_RFQ.md).

## Historical protocol and evidence

The older protocol used public maker inventory, one fixed reservation and an atomic taker `withdraw → transfer OPEN → invoke` batch. Its request/reply bodies were encrypted, but funded terms were public. That history explains existing positions; it is not an execution recipe for new trades.

Historical contract tests still cover ownership, conservation, expiry, replay rejection and recovery. New policy tests cover rejection before signing across builders, SDK, CLI and browser controls. The three real mainnet receipts remain in [the smoke-test record](../../deployments/mainnet/smoke-test-2026-09-07.json). Local simulated proofs and those earlier receipts do not prove the confidential protocol's production readiness.
