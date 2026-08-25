# @app20/private-intents

Taker intents over STRK20 notes, solver quotes, and a fill-or-refund
lifecycle. APP20 is the first solver; NEAR 1Click is its liquidity warehouse,
never the user's counterparty.

```text
intent  → quote (injected pricing + spread, signed over terms + digest)
        → accept verifies the solver signature, then locks the sell note
        → fill delivers ≥ quoted buyAmount before expiry
        → otherwise refund after expiry
restock → fills net per token; residuals ≥ minBatch round up to a
          standard denomination; smaller residuals wait
```

## Boundaries

- **No custody.** The Cairo escrow (not yet deployed) is the settlement
  authority. This package builds and validates, fail-closed.
- **No live 1Click.** `PricingSource` is injected; review builds back it with
  the dry-only connector fixture.
- **Inventory-first.** `assertInventoryCovers` encodes the rule: fill from
  pre-positioned notes, restock later. Never take a note and hedge after.
- **Honest netting.** `planRestock` reduces amount/timing correlation on the
  public hedge. A same-size instant restock is still correlatable, and this
  package never claims otherwise.
- **Signed quotes.** `acceptQuote` fail-closes without a solver ECDSA P-256
  signature over the canonical quote. A digest is consistency, not authenticity.
