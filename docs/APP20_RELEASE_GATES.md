# APP20 gated release evidence

**Current verdict: not release-ready (`releaseReady: false`).** The allowed product surface is the build-gated localnet demonstration plus dry review. Historical Sepolia proof deployments exist, but no canonical production deployment is configured or authorized and no review, operator, custody, quorum, or soak evidence exists. Production RFQ transport, RFQ execution, and authoritative receipts are immutable-off. No source-writing approval authorizes deployment, Mainnet value movement, live cross-chain funding, cap increases, or production agent authority.

The canonical definitive goals, non-goals, and production-gap inventory is [`APP20_RFQ_GAPS.md`](APP20_RFQ_GAPS.md).

Current local evidence: [`evidence/app20-release-evidence-2026-08-29.json`](evidence/app20-release-evidence-2026-08-29.json), with its deterministic CycloneDX SBOM at [`evidence/app20-sbom.cdx.json`](evidence/app20-sbom.cdx.json). The committed parent baseline is `e4084f301a3d4f4ade312d443b8a00e65f674871`, with rollback target `4e32ef1ceb932610a0fd98ff56f37ef25464816c`; this change set was uncommitted at capture time and its eventual delivering commit can only be attested externally. This remains self-reported local evidence, not CI provenance, a release signature, independent reproduction, an audit, or production authorization.

Historical machine-readable checkpoint: [`evidence/app20-release-evidence-2026-08-26.json`](evidence/app20-release-evidence-2026-08-26.json). It predates the current app-code seam work and its older test counts/missing-feature list must not be treated as a current release capture.

## Gate summary

| Gate | Result | Evidence or blocker |
| --- | --- | --- |
| Immutable baseline | **Partial local evidence; release blocked** | The parent baseline is committed at `e4084f301a3d4f4ade312d443b8a00e65f674871`, with rollback target `4e32ef1ceb932610a0fd98ff56f37ef25464816c`. This validated change set was uncommitted at capture time. Its lockfile/SBOM and repeat-build checks are local evidence only; the delivering commit, CI provenance, release signature, and independent-builder reproduction remain absent |
| Pure protocol models | **Pass for app-code scope** | Strict schemas/tests cover preflight, receipts/disclosure, RFQ/directory/transport/reservations, negotiation/channels, risk/operations, checkout/webhooks, dry cross-chain, and advisory automation |
| Localnet maker demonstration | **Pass** | Two separately configured maker processes, private inventories, distinct devnet settlement identities, `0600` hash-chain WALs, full RFQ digest binding, and SIGKILL recovery passed |
| Production transport/custody | **Blocked** | Dormant app-code primitives exist, but browser publication and Worker `/api/rfq/*` routing are immutable-off. External review, independent operators, HSM/KMS custody, replicated reservation ledger, and production reconciliation evidence remain absent |
| Internal adversarial round | **Pass for tested app-code scope** | See [`APP20_ADVERSARIAL_VALIDATION.md`](APP20_ADVERSARIAL_VALIDATION.md) |
| Independent review | **Blocked** | No accepted external Cairo, protocol, transport, maker-service, browser, or operations review |
| Sepolia soak | **Blocked** | Runtime helper addresses remain `0x0`; historical proof transactions are not a canonical two-maker cycle, soak, review, or authorization record |
| Tiny Mainnet evidence | **Blocked** | No explicit approval, audited deployed quote-bound escrow, independent live makers, hard caps, or verified timeout/refund lifecycle |
| STRK20 submission | **Blocked** | `strk20.json` contains no transactions, contracts, demo URL, or video |

A passing model or localnet gate cannot satisfy a later gate. The browser must continue to fail closed when required evidence is unavailable.

## Validation capture

The historical checkpoint linked above records earlier test/build/UI results only. The new evidence record names the committed parent baseline and records that the validated follow-up change set was uncommitted at capture time; it does not freeze or attest a delivering commit. The dependency/SBOM checks are reproducible from repository scripts. Local validation still cannot provide CI provenance, a release signature, two-independent-builder reproduction, audit acceptance, or a production release gate by itself.

The localnet-final validation commands are:

```text
npm run test:all
npm run build
npm run check:csp
npm run check:build-determinism
npm run test:ui
npm run sepolia:manifest:validate
npm run sepolia:evidence:validate
git diff --check
git diff --cached --stat
git status --short -- cairo
```

Current capture (2026-08-29):

- `npm run test:all`: passed, now including the supply-chain suite and dependency/SBOM review.
- `npm run build`: passed; typechecks, Vite build, enforced per-chunk byte budgets, the 294-file browser-leak scan, and release-deny.
- `npm run check:csp`: passed; eight routes exercised through the shipping `createRelayHandler()` asset path, with the observed `connect-src` violation's exact blocked URI and occurrence count matching the reviewed CoinGecko baseline.
- `npm run check:build-determinism`: passed on one machine; each pass rebuilt `@app20/privy` before Vite, and both the workspace package output and emitted app assets byte-matched.
- `npm run test:ui`: passed 16/16 in 3.2 minutes, including accessibility, 200% reflow, and responsive-hierarchy evidence.
- `git diff --check`: passed. Staged files: none at capture time. Cairo status/diff: none.

These are self-reported local checks over an uncommitted change set on one machine, not an immutable attested checkpoint, independent reproduction, independent audit, or production release attestation.

## Version drift

`check_freshness.py --quick` found expected upstream drift:

- get-starknet discovery `next` moved from `6.0.3` to `6.0.4`;
- wallet-standard `next` moved from `6.0.3` to `6.0.5`;
- `packages/sub_account_anonymizer` disappeared and `packages/shadow_account_anonymizer` appeared.

APP20 retains the reviewed get-starknet `6.0.3` pins. The repository currently uses `starknet@10.5.0`, while the approved plan described `10.4.0`; manual Ready compatibility is therefore still an explicit gate. No capability is inferred from an upstream rename or version number alone.

## Contract and network evidence

- live Mainnet/Sepolia Mail helper constants are hard-coded to `0x0`
- live Mainnet/Sepolia escrow helper constants are hard-coded to `0x0`
- public build-variable injection cannot override those constants
- localnet helper/escrow addresses are ephemeral and environment-generated
- historical App20Mail and legacy App20Escrow/ClaimTicket Sepolia proof records are denylisted under [`evidence/historical-sepolia-proofs/`](evidence/historical-sepolia-proofs/)
- no historical proof address is configured in runtime, the blocked production manifest, or `strk20.json`

Contract source or historical proof presence is not production configuration, deployment approval, or audit evidence. The team owns contract specification, implementation, independent review, deployment keys, class-hash verification, and maintenance.

## Human approvals that remain mandatory

Explicit approval is required before:

1. any later source push beyond the explicitly approved APP20 checkpoint;
2. engaging/accepting independent contract or protocol audits;
3. any additional Sepolia helper deployment or any canonical escrow/claim deployment;
4. any Mainnet declare, deploy, scoring transaction, or value movement;
5. adding live USDC or raising any maker/venue cap;
6. enabling live CCTP/1Click funding;
7. enabling value-authorizing agent or TEE operation;
8. populating `strk20.json` with anything other than independently verified artifacts.

## Next evidence needed

1. Attach CI and independent reviewer acceptance to the pushed source checkpoint.
2. Keep dormant maker-specific HPKE/durable relay seams unwired unless a new production scope is explicitly approved.
3. If production scope is reopened, add independently administered replicated reservation consistency, HSM custody, backup/failover, and chain reconciliation evidence.
4. Implement and independently review a server-only runtime-provenanced chain receipt/event composition root (the self-issuable public factory was removed), with exact approved RPC origins, DNS-pinned/no-redirect networking, VNext ABI/class/address evidence, canonical block-number membership, durable freshness/reorg state, and a generated pinned-ABI decoder.
5. Complete independent Cairo and app/transport/service review with remediation acceptance.
6. Run manual Ready compatibility and a bounded Sepolia soak with two independent makers.
7. Obtain a separate approval for tiny capped Mainnet evidence.
8. Populate `strk20.json` only after Voyager/RPC verification of real artifacts.
