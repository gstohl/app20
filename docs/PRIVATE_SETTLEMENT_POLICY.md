# Private settlement policy

Updated September 8, 2026. Every new APP20 settlement must keep the payment or trade amount, asset and destination out of public settlement data. The rule applies equally to RFQs, Chat payments, invoices and offers. An unavailable confidential path stops the action; it must never become a public transfer, an OPEN note or a one-sided swap payment.

## Available paths

| Operation | Required path | Current availability |
| --- | --- | --- |
| Chat payment or same-token invoice | Encrypted transfer from existing shielded notes; encrypted message receipt in the same operation | Localnet implementation; mainnet Chat helper and compatible wallet actions remain unavailable |
| Chat fixed offer or an invoice requiring conversion | Confidential atomic exchange with approval from both parties | Acceptance/conversion blocked until the confidential wallet flow is available |
| RFQ exchange | Joint confidential escrow, both outputs encrypted, independently approved by both parties | Development SDK and local workspace only; real proofs and mainnet activation remain disabled |
| Confidential escrow timeout refund | Fresh encrypted transfer of the original asset to its original owner, authorized by that owner | Development SDK and local workspace only |
| Earlier maker inventory and pending records | Read/reconcile existing records, release expired reservations, withdraw available inventory or deactivate registration | Explicit historical recovery; its original public disclosures remain |

For Chat payments, the helper receives an unfunded `compute_and_invoke` message operation. Its fixed public STRK token argument is a helper constant, not the payment asset. Payment amounts, assets and recipient appear only in the encrypted transfer and encrypted message. The payment batch rejects deposits, withdrawals, OPEN notes and ordinary public invokes. The helper can still reveal that a Chat operation occurred, its timing and ciphertext shape. Encrypted messages by themselves never make an otherwise public settlement private.

## Enforcement

`packages/domain/src/settlement-privacy.ts` fixes public settlement and one-sided Chat acceptance to false. Browser actions, the legacy settlement builders, the Node SDK and standalone maker entrypoint reject new public-term execution. The default `/rfq` page presents confidential availability. `App20Client.prepareQuote`, `submitRequest`, `settle`, registration, public inventory funding and the maker's `register`, `fund` and `run` commands are blocked. Existing quote reads and receipt reconciliation remain available.

The earlier `App20MakerBook` and `App20PrivateSwap` contracts already exist on mainnet. An application release cannot revoke those contracts, erase earlier transactions or prevent third parties from calling them directly. The three September 7 swaps remain evidence of that earlier protocol, whose funded terms were public. They are not confidential-settlement evidence.

Recovering assets from those older contracts is a separate, explicit operation. Available-inventory withdrawals and expired-reservation releases preserve the old protocol's public token, amount and activity visibility. Recovery must not fund new quotes or silently resume trading. Preserve old journals and investigate unknown submissions before retrying.

## Privacy limits and release gates

Shielding and unshielding are public wallet boundaries, offered separately from settlement. They reveal their own token and amount; placing them immediately next to a payment can still aid correlation. Settlement timing, escrow activity, fees, ephemeral public keys, deadlines, nullifiers and ciphertext/proof sizes may remain visible. The counterparty knows its agreement. A hosted prover can read the witness; HTTPS or OHTTP does not hide inputs from the prover that executes them.

The new escrow has local contract-execution evidence with simulated proof facts. It still needs a real accepted STARK proof, compatible independent wallet adapters, authenticated encrypted negotiation and independent review before public-network activation. Chat needs its own compatible deployed helper and real-wallet evidence. No current mainnet confidential settlement or mainnet Chat capability is claimed.

See [confidential implementation](CONFIDENTIAL_RFQ.md), [agent API](../packages/agent-sdk/README.md), and [historical maker recovery](makers/README.md). The version-8 demo predates this policy: its one-sided Chat offer acceptance and maker onboarding scenes must be replaced before it is presented as the current product.
