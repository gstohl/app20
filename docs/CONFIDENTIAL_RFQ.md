# Confidential RFQ integration guide

Updated September 8, 2026. APP20 now includes a jointly authorized escrow contract, a Node SDK, durable submission recovery and a browser workspace backed by disposable local wallets. A mainnet escrow instance is deployed at `0x11b28bb270f1c9c7eefd1205cfba6c1a686436fcb5f5c3281d5a0a77011438f`; deployment is not yet real-proof settlement validation. Contract execution with simulated proof facts is verified; a real STARK proof for this protocol, compatible independent wallet adapters and independent review are still required.

## Private-only application policy

The default `/rfq` page now presents this confidential path. New legacy public-funded-term requests, maker registration/funding/quoting and settlement are blocked in the browser, SDK and CLI. The rule also covers Chat: payments and same-token invoices use encrypted transfers plus an unfunded encrypted message operation; fixed-offer acceptance and invoice conversion requiring a swap wait for confidential atomic wallet integration.

Historical recovery remains explicit and public under the original contracts. Existing deployed contracts and earlier transaction data cannot be revoked by changing the application. [Complete settlement policy](PRIVATE_SETTLEMENT_POLICY.md).

## Run it

From the repository root, with the normal dependencies and pinned pool toolchain installed:

```sh
npm run pool:setup
npm run dev:confidential
# Open http://127.0.0.1:5198/rfq
```

The workspace creates a disposable devnet, registers two controlled wallets and shields test STRK and ETH. Create an escrow, approve setup, fund each side and approve the exchange. A second trade can be funded on just one side; advance the local clock and refund that party independently. The quote is a local example, not a market price. The workspace controls both wallets for demonstration; actual counterparties need separate signing adapters.

The local control service binds to loopback, rejects cross-origin writes and serializes mutations. Its routes and wallet controls are omitted from production bundles. A production build rejects `VITE_CONFIDENTIAL_RFQ_LAB` configuration. The public `/rfq` page provides the swap form and current network availability; mainnet quote submission remains disabled. Earlier RFQ URLs redirect to this same workspace. Stop the command to delete its disposable keys, state and devnet; this is not persistent wallet storage.

## Protocol and privacy

1. Counterparties agree on exact asset amounts, destinations, expiry and a fresh cryptographically random 248-bit salt. The public constructor contains only a commitment to the terms, two distinct ephemeral public signing keys, deadline and pool/class pins.
2. They approve setup with separate signing keys. They share a **new escrow-only viewing key**, which reveals only this escrow. Neither party supplies its ordinary wallet viewing key to the other or to APP20.
3. Each sends its asset from its own shielded wallet. Funding is separate and non-atomic. The first funder may wait until expiry if the other party stops responding.
4. Both approve the exact private action bundle. One pool proof/application creates both encrypted outputs together. Encrypted change returns only to the original owner of that asset. The contract rejects OPEN notes, trade withdrawals, deposits, extra invokes, changed amounts/destinations and missing callbacks.
5. After expiry, either party independently proves a refund of its original asset to its original destination. This is newly prepared from current notes, not a stale pre-signed refund. Recovery can be repeated for later deposits of the agreed assets.

Amounts, asset addresses and destinations are private inputs to the settlement proof. Escrow deployment/activity, public ephemeral signing keys, deadline, timing, nullifiers, ciphertext/proof sizes and fees remain observable. Public shielding/unshielding and external hedges reveal their own amounts and assets. The peer knows this trade; it can disclose it. An external proving service can read the witness. The current local environment simulates proving and does not establish secrecy from a hosted prover or traffic analysis resistance.

The deployed mainnet MakerBook/PrivateSwap flow is a separate, earlier protocol with public funded terms. Current clients disable new use of it; they retain receipt reads and historical recovery only. No failed confidential operation falls back to that protocol. Encrypted Chat messages cannot conceal public trade legs, so Chat swap acceptance is also blocked until the confidential path is integrated.

## Node API and trust boundaries

Import `@app20/agent-sdk/confidential`; see [the package guide](../packages/agent-sdk/README.md) and [the adapter example](../packages/agent-sdk/examples/confidential-session.mjs).

`createConfidentialAgreement` computes canonical commitments; `confidentialConstructor` produces public deployment arguments. After deployment, `createConfidentialClient` verifies chain, the pinned escrow/pool classes and all constructor fields before accessing escrow viewing material. `inspect()` checks registration, decrypted funding, deadline, settlement status and pending recovery state.

`prepare(mode)` builds and reviews the exact private operation. `approve(prepared, role, sign)` repeats that review and passes the digest, terms, destinations, chain and deadline to only that role's signing adapter. The peer independently approves using its own client and key. `execute(prepared, approvals)` verifies both signatures, requests a proof, validates its program/network/message binding and allowed public action types, then hands only the public call/proof to the fee-limited submission adapter. Mainnet clients verify the pinned deployment and canonical pool before key retrieval; simulated proofs require loopback.

Agreements, prepared operations and the shared viewing material are sensitive. Exchange them only through an authenticated encrypted channel and retain them in each wallet's secure storage. The SDK does not provide a public quote relay or claim that an arbitrary transport is secure. The existing mainnet bot and public inventory reservations do not operate this protocol. Real-proof and wallet gates precede production transport, inventory reservation and permissionless maker activation.

## Recovery

Use one `createConfidentialJournal(directory)` per escrow and preserve it across client restarts. It stores only public operation digests, modes, transaction hashes and completion metadata, using an exclusive process lock, owner-only files, atomic replacement and filesystem sync. Wallet secrets and terms belong in separate secure wallet storage.

Before broadcast the journal records an attempt. A missing response/hash leaves an unknown outcome that blocks another operation. A known pending hash is reconciled with the receipt; reverted attempts can be cleared, while successful settlement also requires the escrow's settled flag. Never erase the journal or repeat funding to resolve a timeout. With an unknown hash, inspect the relayer account and original operation before repairing metadata. After a crash, remove a stale lock only after checking that its recorded process has exited. Recreate the client using the same agreement, viewing material and journal, then reconcile and inspect before preparing a refund.

The journal is not an encrypted backup of the wallet. Refunds still require retained terms, salt, escrow viewing material and the correct party's signing key. Pool pauses/upgrades, unavailable proving and unsupported-asset donations are outside the demonstrated recovery guarantee. Approval release cannot be revoked by closing a dialog; an authorized settlement can execute until its chain-enforced deadline.

## Reproduce validation

Run devnet commands serially, after stopping any instance on port 7050:

```sh
node scripts/check-confidential-contract.mjs
npm test --workspace @app20/agent-sdk
PATH="$PWD/vendor/bin:$PATH" RUST_LOG=warn node --test pool-harness/tests/confidential-rfq-sdk.e2e.test.mjs
# Read-only mainnet class download, then repeat against that exact class locally:
node scripts/prepare-confidential-rfq-probe.mjs
PATH="$PWD/vendor/bin:$PATH" RUST_LOG=warn APP20_CONFIDENTIAL_MAINNET_CLASS=1 node --test pool-harness/tests/confidential-rfq-sdk.e2e.test.mjs
PATH="$PWD/vendor/bin:$PATH" RUST_LOG=warn node --test pool-harness/tests/joint-escrow.probe.mjs
# With npm run dev:confidential running:
APP20_DEMO_VIDEO=1 node scripts/e2e-confidential-browser.mjs
```

The SDK integration test uses the same client as the browser service, performs exact settlement, rejects incomplete funding/approvals and changed terms, then reopens a partially funded session and refunds it independently. The separate adversarial contract harness checks the full policy and scans public transaction surfaces for private test values. [Detailed contract evidence](../pool-harness/JOINT_ESCROW.md) distinguishes these local executions from real cryptographic proof generation.

`cairo/src/confidential_escrow.cairo` is part of the normal Cairo build. `src/lib/confidential-rfq-deployment.ts` pins both Sierra and CASM hashes. The check script refuses a mismatch without rewriting the pins. CI's real-pool suite runs the SDK integration test; release checks require the mainnet activation setting to match the release and keep real-proof verification false until evidence supports it. Generated media and proof artifacts are ignored under `artifacts/`. Public submission hashes remain the three verified transactions of the earlier mainnet protocol.


## Verification recorded for this implementation

September 7, 2026: `npm run build` and the full `npm run test:all` suite passed; the standard Cairo suite passed 134 tests. The confidential SDK passed the exact mainnet-pool-class settlement/restart/refund test on devnet, the separate contract harness passed 26 adversarial cases, and the browser flow passed settlement and one-party recovery. Both contract hashes match their source build. Production CSP checks reported no violations, and a fresh installation of the generated package resolved its confidential entrypoint correctly.

The historical version-8 demo is 136 seconds / 4,080 frames at 1080p30. Its one-sided Chat offer acceptance and public maker onboarding predate the private-only policy and must be recaptured before publication as the current product. Its delivered audio/video decodes cleanly, and all 12 spoken endings match their source waveforms with at least 1.5 seconds of space after narration. [Demo notes](HACKATHON_DEMO.md). These are local development and media checks; no public deployment or new mainnet transaction was performed.
