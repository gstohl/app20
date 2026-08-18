# `@app20/near-intents`

Vendor-isolated NEAR 1Click integration boundary. The shipped client is deliberately **dry-only**:

- only canonical `dry: true` quote requests;
- mandatory policy preflight, completed before quote transport;
- an immutable request snapshot shared by preflight, transport, echo validation, and verification;
- a strict pinned response allowlist at the response, echoed-request, and quote levels;
- fail-closed rejection of unknown or funding-shaped fields, including deposit addresses, memos, nested funding objects, chain deposit maps, and live funding windows;
- mandatory quote-signature verification with structured algorithm, key-id, and signed-payload-digest provenance;
- no partner credential or default network transport;
- no submit, deposit, funding, status, or refund method.

`mapCrossChainIntentToDryQuote()` is the single canonical intent-to-1Click dry-request mapping. `assertDryQuoteSatisfiesIntent()` binds the parsed quote back to the exact request, exact input where applicable, user minimum output, and explicit fee ceiling.

NEAR Intents has no testnet. Adding live quotes, deposits, signed intents, status, or refunds requires a separate Mainnet release review and must never put partner JWTs or API keys in browser assets.
