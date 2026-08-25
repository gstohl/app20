# `@app20/domain`

Pure APP20 account, asset, intent, canonicalization, and lifecycle types. It has no React, wallet, network, storage, or secret dependency.

`canonicalizeStarknetFelt()`, `starknetFeltEquals()`, `parseTokenAmount()`, and `formatTokenAmount()` provide the shared bounded-felt and exact integer-unit boundary used by APP20 registry, proposal, and quote code. Decimal parsing rejects exponent/sign syntax, excess precision, zero, and u128 overflow without using floating-point arithmetic.

`assertCrossChainIntent()` fail-closes on unknown fields, hostile enum values, malformed identifiers or timestamps, duplicate set entries, non-canonical base-unit integers, and account/asset/refund chain mismatches. `digestCrossChainIntent()` binds explicit source, destination, and refund accounts; chain-scoped assets; provider and account modes; integer amount/output/fee bounds; slippage; deadlines; policy mode; and the disclosure set under `app20/intent/v1`.

Persisted execution should use `createCrossChainLifecycle()` and `transitionCrossChainLifecycle()`. Those functions bind the exact intent id, revision, canonical digest, and expiry. Requoting returns through validation and policy preflight; only `PREFLIGHT_POLICY` can enter `QUOTING`. An expired or changed revision cannot retry, and `SUBMISSION_UNKNOWN` can only be reconciled or finalized, never directly resubmitted. `transitionCrossChainStage()` is a topology helper and does not replace the revision-bound lifecycle API.

Do not store viewing keys, notes, witnesses, mail plaintext, raw signatures, or bearer credentials in records built from these types.
