# APP20 gated release evidence

**Current verdict: not release-ready.** The allowed surface is the build-gated localnet demonstration plus dry review. The user explicitly authorized the source commit and push on 2026-08-26; that approval does not authorize deployment, Mainnet value movement, live cross-chain funding, cap increases, or production agent authority.

Machine-readable capture: [`evidence/app20-release-evidence-2026-08-26.json`](evidence/app20-release-evidence-2026-08-26.json).

## Gate summary

| Gate | Result | Evidence or blocker |
| --- | --- | --- |
| Immutable baseline | **Pass for this source checkpoint** | The commit containing this document freezes the validated candidate tree; release, audit, and deployment gates remain separate |
| Pure protocol models | **Pass for app-code scope** | Strict schemas/tests cover preflight, receipts/disclosure, RFQ/directory/transport/reservations, negotiation/channels, risk/operations, checkout/webhooks, dry cross-chain, and advisory automation |
| Localnet maker demonstration | **Pass** | Two separately configured maker processes, private inventories, distinct devnet settlement identities, `0600` hash-chain WALs, full RFQ digest binding, and SIGKILL recovery passed |
| Production transport/custody | **Blocked** | No wired RFC 9180 HPKE opener, split relay delivery, HSM/KMS custody, replicated reservation ledger, or production reconciliation |
| Internal adversarial round | **Pass for tested app-code scope** | See [`APP20_ADVERSARIAL_VALIDATION.md`](APP20_ADVERSARIAL_VALIDATION.md) |
| Independent review | **Blocked** | No accepted external Cairo, protocol, transport, maker-service, browser, or operations review |
| Sepolia soak | **Blocked** | Helper addresses remain `0x0`; no two-maker Sepolia cycle or one-week reconciliation record |
| Tiny Mainnet evidence | **Blocked** | No explicit approval, audited deployed quote-bound escrow, independent live makers, hard caps, or verified timeout/refund lifecycle |
| STRK20 submission | **Blocked** | `strk20.json` contains no transactions, contracts, demo URL, or video |

A passing model or localnet gate cannot satisfy a later gate. The browser must continue to fail closed when required evidence is unavailable.

## Validation capture

The exact pre-commit candidate tree passed:

```text
npm run test:all
  67 application files / 495 tests
  every package and relay suite
npm run build
  root and workspace typechecks
  Vite production build
  browser leak scan: 302 files
npm run test:ui
  localnet Playwright: 4/4
  includes selected-maker SIGKILL and WAL recovery
git diff --check
fresh pi-lens error scan
  no errors across 336 files
  fresh gitleaks/opengrep/knip/jscpd/madge completed
```

These results show that the candidate tree behaved as described. The containing commit freezes that source, but the evidence remains self-reported and is not an independent audit or production release attestation.

## Version drift

`check_freshness.py --quick` found expected upstream drift:

- get-starknet discovery `next` moved from `6.0.3` to `6.0.4`;
- wallet-standard `next` moved from `6.0.3` to `6.0.5`;
- `packages/sub_account_anonymizer` disappeared and `packages/shadow_account_anonymizer` appeared.

APP20 retains the reviewed get-starknet `6.0.3` pins. The repository currently uses `starknet@10.5.0`, while the approved plan described `10.4.0`; manual Ready compatibility is therefore still an explicit gate. No capability is inferred from an upstream rename or version number alone.

## Contract and network evidence

- `VITE_MAIL_HELPER_MAINNET=0x0`
- `VITE_MAIL_HELPER_SEPOLIA=0x0`
- `VITE_ESCROW_HELPER_MAINNET=0x0`
- `VITE_ESCROW_HELPER_SEPOLIA=0x0`
- localnet helper/escrow addresses are ephemeral and environment-generated
- no contract deployment evidence is recorded in `strk20.json`

Contract source presence is not deployment or audit evidence. The team owns contract specification, implementation, independent review, deployment keys, class-hash verification, and maintenance.

## Human approvals that remain mandatory

Explicit approval is required before:

1. any later source push beyond the explicitly approved APP20 checkpoint;
2. engaging/accepting independent contract or protocol audits;
3. any Sepolia helper or escrow deployment;
4. any Mainnet declare, deploy, scoring transaction, or value movement;
5. adding live USDC or raising any maker/venue cap;
6. enabling live CCTP/1Click funding;
7. enabling value-authorizing agent or TEE operation;
8. populating `strk20.json` with anything other than independently verified artifacts.

## Next evidence needed

1. Attach CI and independent reviewer acceptance to the pushed source checkpoint.
2. Wire reviewed maker-specific HPKE and durable replay storage.
3. Add replicated reservation consistency and chain reconciliation evidence.
4. Implement configured-chain receipt/event verification with reorg handling.
5. Complete independent Cairo and app/transport/service review with remediation acceptance.
6. Run manual Ready compatibility and a bounded Sepolia soak with two independent makers.
7. Obtain a separate approval for tiny capped Mainnet evidence.
8. Populate `strk20.json` only after Voyager/RPC verification of real artifacts.
