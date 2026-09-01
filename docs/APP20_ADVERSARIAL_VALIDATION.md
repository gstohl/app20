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
| High | Caller-labelled finality was reported authoritative | Raw evidence is non-authoritative; the self-issuable verifier factory was removed and configured-chain authority is unconditionally unavailable. Pure validators require exact reviewed public-hostname origins, canonical block-number membership, and all VNext transcript bindings. | A server-only runtime-provenanced RPC/decoder composition root, approved providers, VNext ABI/deployment and durable reorg monitoring remain external |
| High | Random bytes could pass RFQ transport metadata checks | Real pinned RFC 9180 Base seal/open validates authenticated plaintext/context; maker ingress now requires an atomic replay+reservation result seam | Production HSM resolver and independently administered repository remain external; localnet stays loopback HTTP |
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

## 2026-08-26 production-wiring adversarial matrix

| Surface | Automated/refusal coverage | Residual external boundary |
| --- | --- | --- |
| HPKE | real matching open; wrong key/info/suite/AAD, deterministic decoded-byte ciphertext tamper, truncation, malformed/non-canonical base64url, padding boundary/non-zero pad; protocol transport-key expiry/revocation and rotation resolution | Library is vector-conformant, not audited; HSM resolver/operator review absent |
| Directory | signed-body mutation/signature failure, chain mismatch, rollback, predecessor fork, authority/key revocation and expired window | No production authority keys/operators or published epoch |
| Replay | async idempotent same digest and conflict on nonce/different bytes; SQLite UNIQUE transaction seam | DO not deployed; retention/restore/failover drill absent |
| Maker | CAS fence port, authenticated operation requirement, duplicate/unknown outcome quarantine, localnet WAL crash tests | No replicated ledger, HSM custody or independent administration |
| Receipts | raw binding/finality checks plus pure exact-origin, canonical block-number membership, and full VNext transcript-binding validators; no public capability constructor | Configured-chain authority is disabled; no runtime-provenanced adapter, approved RPC set, VNext ABI decoder/deployment, or persistent reorg listener |
| Desk/network | zero/partial/stale manifest refusal, hard Mainnet denial, separate localnet component, no public fallback | Manifest intentionally incomplete; production Desk unavailable |

These tests validate app behavior only and do not constitute deployment, audit, soak or operational evidence.

## Validation evidence

Historical successful runs before the first remediation follow-up included:

```text
npm run test:all
  application at that checkpoint: 76 files / 519 tests passed
  all package suites passed; relay at that checkpoint: 21 tests passed
npm run typecheck
npm run test:ui
  an earlier pre-remediation Playwright localnet run passed 4/4
```

The first remediation follow-up's final `npm run test:ui` invocation did **not** pass: it exceeded the bounded 300-second timeout while still emitting localnet RPC progress and was terminated. A later historical remediation tree passed 4/4 in 2.6 minutes. Both results predate later scope, CSP, mailbox, and licence hardening and are historical only; neither attests the current tree. Current acceptance requires fresh repository-command evidence. `APP20_RELEASE_GATES.md` explains why the dated generated captures and any machine-local handoff are insufficient.

## Gate verdict

The app-code models and localnet demonstration passed this dated internal adversarial round. App-code HPKE, exact-tuple relay capability, quote-wire/replay, directory-checkpoint/high-water and atomic maker seams now exist; configured receipt authority has instead been removed/disabled, but the production Desk is unconditionally disabled. **P3 production transport/release remains blocked** until those seams have deployed durable adapters, independent maker custody/persistence, approved RPC/ABI/reorg evidence, Cairo audit/remediation, external review, and Sepolia soak.
