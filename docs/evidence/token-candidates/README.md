# Untrusted token identity candidates

This directory contains candidate records, not verified identity evidence or
runtime configuration. No checked-in record claims that verification occurred.
Files here are not imported by the token registry and do not enable RFQ,
transport, or value movement on any public network.

`token-candidate.schema.json` defines the strict record shape. The checked-in
`UNREVIEWED.example.json` uses a deliberately non-address placeholder and
non-real metadata. It is expected to be refused by the verifier.

## Human-controlled workflow

1. Copy the example and replace the placeholder and expected metadata only from
   a traceable HTTPS source. Leave `verified` as `false`.
2. A human reviews the source claim and records their identity and review date.
   The read-only verifier refuses records without both fields.
3. Run `node scripts/verify-token-identity.mjs <record.json> --rpc-url
   <operator-supplied-https-rpc-url>`. Alternatively, supply the URL only for
   that process as `APP20_TOKEN_IDENTITY_RPC_URL`. A matching response exits
   with status 3 rather than success, preventing a conventional success-status
   check from treating an untrusted single-source RPC match as verification.
4. Preserve the RPC-reported output as untrusted single-source evidence for a
   human reviewer. The script never edits the record and never changes
   `verified`.

A matching read shows only that one operator-supplied, untrusted RPC reported
candidate-consistent name, symbol, decimals, and chain ID at that time. That RPC
can fabricate every field. The result is not verified on-chain identity, does
not independently verify provenance, does not configure runtime, and does not
authorize release or establish production readiness. P0-10 remains open; this
directory contains no reviewed real address and records no completed token
identity verification.
