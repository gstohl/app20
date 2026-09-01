# `@app20/policy-client`

Vendor-neutral APP20 policy receipt and attestation boundary. Signed, domain-separated receipt bytes bind workflow id and epoch; intent revision; intent, execution, quote, and constraint digests; policy version; attestation vendor, challenge, evidence digest, measurement, and ephemeral key; decision; nonce; monotonic counter; and validity window.

Verification fail-closes on unknown or malformed fields, binding changes, debug/stale/revoked evidence, an unapproved measurement, wrong key/challenge, non-boolean verifier results, replay, rollback, and invalid replay-guard outcomes. `rawEvidence` is structured-cloned into the snapshot so later mutation cannot change the bytes shown to verifiers, and non-cloneable or oversized payloads are rejected. The injected `PolicyReplayGuard.consume()` contract is an atomic check-and-consume operation across the workflow/key scope; an implementation that checks and writes separately is unsafe.

A verified approval reports cryptographic and attestation verification only. It neither accepts nor returns an enforcement level. `enforcementDisclosure()` describes separately established account/infrastructure behavior; verification does not turn a caller-selected label into cryptographic enforcement.

This package does not provide a TEE, custody, key provisioning, replay storage, or cryptographic account enforcement. Current Ready and threshold-1 Privy flows remain `advisory` or `backend-gated` until an account contract or signer quorum makes policy approval unavoidable.
