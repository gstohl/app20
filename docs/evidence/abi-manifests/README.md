# Pinned-ABI decoder manifests

This directory is generator evidence only. It is not runtime configuration, not
a production ABI, and not a deployment identity. Files here do not enable RFQ,
transport, or value movement on any public network.

P0-21 stays **open** until P0-07 supplies accepted canonical ABI bytes together
with contract address, class hash, selectors, and deployment block. The
generator in `scripts/generate-abi-decoder.mjs` is the verification path that
will bind a decoder to those pins when they exist. Given no canonical artifact,
it fails closed and emits no decoder.

## What is checked in

- `abi-manifest.schema.json` — strict shape for an ABI manifest artifact.
- `p0-21-generator-test-fixture.json` — a **TEST FIXTURE** used only to prove
  the generator. It is not App20Escrow, not App20Claim, not historical Sepolia
  evidence, and not a candidate production ABI.
- `index.json` — records that no canonical ABI is present and that no generated
  production decoder is present.

Do not copy localnet `scripts/localnet-chain-decoder.mjs` into this directory
or treat that fixed fixture decoder as the P0-21 decoder. The generator must
not overwrite it.

## Human-controlled workflow (blocked on P0-07)

1. Keep `canonicalAbiPresent` false until independently reproduced canonical
   ABI bytes exist.
2. When P0-07 evidence is accepted, add a separate canonical record. Do not
   relabel this test fixture.
3. Run `node scripts/generate-abi-decoder.mjs --artifact <canonical.json>
   --out <server-only-path>`. Omitting `--artifact` still fails closed while
   the index reports no canonical ABI.
4. Do not import a generated decoder into browser/`src/` paths. Do not claim
   P0-21 closed from test-fixture output.
