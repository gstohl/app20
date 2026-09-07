# Confidential RFQ feasibility experiment

The original capability probe below creates two separately signed, encrypted STRK20 transfer legs and attempts to apply both in one outer transaction. A minimal Cairo forwarding contract tests the same calls through a wrapper. It deliberately does not implement the proposed callback protocol: that candidate fails the earlier proof-composition prerequisite.

A separate [joint escrow experiment](JOINT_ESCROW.md) now passes local execution tests using one jointly authorized account and one proof-facts message. It changes the funding and custody protocol, and does not alter this negative regression. Neither harness generates real STARK proofs or enables production confidential RFQ.

The harness uses the unmodified pool compiler and server contract with upstream **simulated devnet proof facts**. It does not generate real STARK proofs. All signatures, viewing keys, screening keys and funds belong to disposable local test accounts. The mainnet-class mode deploys the downloaded mainnet class to devnet with local test governance; it does not reproduce mainnet storage, fees, screening policy or balances.

## Run

After the normal `npm run pool:setup` prerequisites, from the repository root:

```sh
PATH="$PWD/vendor/bin:$PATH" RUST_LOG=warn node --test pool-harness/tests/confidential-rfq-feasibility.e2e.test.mjs

# Read-only download and class-hash verification, then execution on devnet only:
node scripts/prepare-confidential-rfq-probe.mjs
PATH="$PWD/vendor/bin:$PATH" APP20_PROBE_MAINNET_CLASS=1 RUST_LOG=warn node --test pool-harness/tests/confidential-rfq-feasibility.e2e.test.mjs
```

Run these serially with other pool harnesses. Raw class downloads and result JSON files are written beneath ignored `artifacts/confidential-rfq/`. The test-only Cairo package is separate from `cairo/` and is not included in product deployment builds.

## Assertions

- Both parties first hold 9,999 units of their own shielded token and one unit of the other token, after channel-setup payments outside the proposed trade.
- Proposed trade legs contain only encrypted-note writes, encrypted-note events and nullifiers. They contain no OPEN outputs, public transfer/deposit/withdrawal actions or new public channel announcements. A supplemental scan checks that trade amounts and participants are absent as plaintext calldata felts; this is not a general cryptographic privacy proof.
- Two direct calls with either leg's singleton proof facts revert with `INVALID_PROOF_MSG`.
- Supplying two message hashes in one proof-facts envelope also reverts with `INVALID_PROOF_MSG`.
- Forwarding through the Cairo probe does not change either result.
- Encrypted-note discovery confirms that failed outer transactions leave both parties' balances unchanged.
- Each exact same prepared leg succeeds alone. After only Alice's leg executes, Bob has received her asset while she has received none of his trade amount. Separate transactions are therefore not an atomic-swap fallback.

The test passes when it **reproduces the incompatibility**. A green result must not be presented as a working confidential RFQ. A future pool version with supported proof composition should require revisiting this experiment and the protocol design, rather than changing its assertions until it is green.

## Required next capability

Verified September 7, 2026: both runs completed successfully as **negative capability tests**, each checking five reverted combinations and two independently successful transfer controls.

| Pool class executed locally | Result |
| --- | --- |
| Development `0x7af31b00093e5ba2d51a0bd68b5cb4ef3b011af349ade4bb6aa3dbb108f153c` | Paired proof composition rejected |
| Pinned mainnet `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` | Same rejection, including Cairo wrapper |

The proposed paired-`apply_actions` design needs a verified method for two independent authorizations to bind both encrypted transfer outputs and execute indivisibly. Merely accepting an array of proof messages is not sufficient: independently executable legs would still allow extraction attacks. A pool-supported primitive must also bind chain, pool class, recipient outputs, both leg commitments, deadline and replay protection, with wallet-side verification of incoming encrypted notes.

The separately funded, jointly authorized escrow is a different protocol with funding, custody, refund and liveness requirements. The original experiment neither implements nor disproves that alternative; the [new harness](JOINT_ESCROW.md) tests it independently. The original probe rules out composing the current independently generated action proofs using a straightforward outer account call or Cairo wrapper.
