# APP20 operations and integration boundaries

These modules are fail-closed policy and evidence models. They do not deploy contracts, prove maker solvency, submit cross-chain funding, authorize an agent, or make APP20 Mainnet RFQ-ready.

## Maker operations

`packages/private-intents/src/operations.ts` provides:

- canonical risk manifests with exact positive-u256 base units;
- independent Risk and Operations approval requirements;
- short-lived exceptions requiring two distinct Risk approvers plus Security/Compliance;
- per-trade, gross, net, daily, outstanding-escrow, and reconciliation gates;
- finalized and consented independent-fill netting before public restocking;
- approved venue, minimum dwell, standard denomination, and batch-floor policy;
- explicit public-hedge correlation warnings;
- pause and drain-only controls that leave claims and refunds enabled;
- browser-safe capacity bands and utilization, never raw maker balances.

`planOperationalNetting` does not provide atomic crossing. Every taker fill remains independently settled first; a separately designed and audited contract would be required for atomic two-taker crossing.

## Checkout and merchant webhooks

`src/lib/merchant-integration.ts` provides:

- canonical checkout requests labelled `unsigned-request`;
- HTTPS-origin-only returns, with no relationship data in return URLs;
- receipt-reference webhook events signed by a pinned Ed25519 merchant key;
- a verified-only idempotency/replay store that rejects equivocation;
- fail-closed partner, Sepolia, and capped-Mainnet release decisions.

A payment link or checkout request cannot authorize value. The payer must separately review and approve a wallet action. A webhook references a receipt; it does not replace direct chain-event verification.

The included replay store is an in-memory protocol model. Production requires durable, shared idempotency storage and reviewed server-side key custody.

## Cross-chain warehouse review

Cross-chain remains structurally dry:

- `dry: true` is mandatory;
- the purpose is maker-side inventory review, not direct taker routing;
- public boundaries must be acknowledged;
- `liveFundingAuthorized` is always `false`;
- there is no live submit method.

Live CCTP or 1Click funding remains a separate approval, custody, reconciliation, and tiny-value validation programme.

## Advisory automation

Advisory plans may explain preflight, suggest invitation cohorts, verify quote evidence, draft negotiation, release losing reservations, and monitor receipts. Their schema fixes `authority: "advisory"`, `canSign: false`, and `canSubmit: false`; calldata or extra execution fields fail schema validation.

Backend gating and cryptographic account enforcement must remain separately labelled. Any future value authority requires audited allowlists, caps, expiries, replay protection, fixed recovery, and independent bypass testing.

## Verification

```bash
npm test --workspace @app20/private-intents
npx vitest run src/lib/merchant-integration.test.ts
npm run typecheck
```
