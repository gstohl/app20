# APP20 adversarial validation — 2026-08-26

This is an internal app-code review record, not an audit report. It does not approve Cairo, HPKE transport, contract deployment, Sepolia, Mainnet RFQ, production maker custody, or live cross-chain funding.

## Scope

Reviewed surfaces:

- privacy preflight, settlement receipts, and selective disclosure;
- maker directory, RFQ transport metadata, and reservation protocol;
- durable localnet maker WAL and child-process recovery;
- negotiation, wallet/Mail bindings, and relationship-channel epochs;
- risk manifests, exceptions, exposure, netting, and restock policy;
- checkout requests, merchant webhooks, dry warehouse review, and advisory plans;
- localnet browser integration and crash recovery.

A read-only `app20-security` review identified ten trust-boundary failures. Focused adversarial probes reproduced them before remediation.

## Findings and remediation

| Severity | Finding | App-code remediation | Remaining boundary |
| --- | --- | --- | --- |
| Critical | Signed maker directory could be mutated after verification | Verified directories are normalized, cloned, frozen, tracked in a private `WeakSet`, and re-digested at acceptance; key resolution requires the verified object | Directory delivery, governance keys, and durable transparency storage remain unimplemented |
| Critical | Forged risk manifest/exception objects could bypass caps | Verified policies are frozen and runtime-provenanced; decisions require fresh snapshots and current exceptions; v1 exceptions can waive only the per-trade cap | Approval-key governance and durable policy distribution remain operator responsibilities |
| High | Channel bindings and key rotations were structural only | Wallet/Mail bindings now have runtime provenance and revocation snapshots; opening rechecks expiry/revocation; every key epoch requires both wallet-bound Mail authentication signatures | Audited Double Ratchet, recovery, and relay storage remain unimplemented |
| High | One Mail key could impersonate taker and maker | Transcript evaluation requires verified role bindings and matches both binding digest and authentication key; an equivocation-store interface detects same-role revision forks | Production requires a durable shared equivocation store |
| High | Caller-labelled finality was reported authoritative | Raw chain evidence is always non-authoritative; authority requires a private-runtime-provenanced result from a configured-chain verifier | RPC quorum, escrow event decoding, class-hash pinning, and reorg handling remain unimplemented |
| High | Random bytes could pass RFQ transport metadata checks | Acceptance now requires an external reviewed HPKE opener, validates the decrypted canonical RFQ/context, and consumes replay state only after authentication | APP20 still has no RFC 9180 implementation wired to maker transport; localnet remains authenticated loopback HTTP |
| High | Missing/future privacy evidence could pass | Future evidence and overlong validity fail; missing maker/public-settlement disclosures block; unavailable noncritical evidence requires informed confirmation | Public event/indexer evidence is still unavailable in localnet and is labelled accordingly |
| High | Disclosure values were not checked against their receipt | Verification can recompute every selected value against the full canonical receipt; null-prototype canonical maps preserve prototype-named keys | A disclosure remains a package/digest, not a cryptographic selective-disclosure proof |
| Medium | Maker reservation stored the intent digest as `rfqDigest` | Maker requests now carry the complete canonical RFQ and independent digest; the maker recomputes it and persists the RFQ digest | Quote-bound audited Cairo is still required |
| Medium | Checkout/webhook context and lifecycle were incomplete | Checkout digests are recomputed; webhook verification pins merchant/checkout/chain, freshness, and verified receipt digest; terminal lifecycle equivocation is rejected; live submission remains hard-disabled | Production requires durable shared replay storage and reviewed server-side webhook key custody |

## Adversarial coverage

The focused suites exercise:

- verified-object mutation and forgery;
- directory predecessor/key revocation and stale-key rejection;
- HPKE opener failure, decrypted-RFQ mismatch, and post-authentication replay;
- concurrent reservation serialization, signature equivocation, WAL tampering, truncated-tail recovery, PID locking, crash quarantine, and SIGKILL recovery;
- one-key role impersonation, revision forks, wrong parents, terminal transcript edits, unsigned/tampered channel epochs, revocation, replay, and quotas;
- future/stale/missing preflight evidence;
- forged receipt finality and disclosure substitution;
- stale risk exceptions, stale exposure snapshots, duplicate finalized fills, missing venues, cap breaches, and browser balance leakage;
- checkout tampering, webhook context/freshness/signature/idempotency/lifecycle replay, dry-only cross-chain review, and non-submitting advisory plans.

## Validation evidence

Latest successful runs during this review:

```text
npm run test:all
  application: 67 files / 495 tests passed
  packages + relay: all passed
npm run typecheck
npm run test:ui
  Playwright localnet: 4/4 passed, including selected-maker SIGKILL/WAL recovery
```

The first adversarial UI rerun exposed a Node ESM TypeScript export-resolution failure; package imports were moved to the package import map. A later payment-link run exposed nondeterministic network selection; the test now explicitly selects the build-gated local network. The final fresh run passed 4/4.

## Gate verdict

The implemented app-code models and localnet demonstration pass this internal adversarial round. **P3 production transport/release remains closed** until real maker-specific HPKE, durable replay/equivocation/idempotency stores, independently administered maker custody, configured-chain receipt verification, replicated reservation consistency, Cairo audit/remediation, and external protocol/security review are complete.
