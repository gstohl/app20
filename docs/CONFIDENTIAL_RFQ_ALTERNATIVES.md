# Confidential RFQ alternatives

Implementation update: the joint escrow candidate now has a Cairo contract, Node SDK, durable recovery and a local browser workflow. Mainnet and real-proof gates remain closed. See [the current development guide](CONFIDENTIAL_RFQ.md). The comparison below records the alternatives considered.

Reviewed September 7, 2026. This compares documented capabilities; no new integration, privacy guarantee or production deployment is enabled. The failed two-proof experiment does not establish that confidential RFQ is impossible.

## Existing integrations

| Route | Documented capability | Limitation for APP20 |
| --- | --- | --- |
| AVNU STRK20 private swaps | Wallet/SDK integration, deployed executor, atomic swap from shielded balances | Sell tokens leave the pool for public execution and bought tokens return through an OPEN note; trade amounts/pair are not confidential |
| STRK20 OTC helper pattern | Counterparties agree off-chain, helper settles on the second funded leg with timeout/reclaim | The official hidden/visible table explicitly identifies trade amounts and pair as visible |
| Tongo v2 on Starknet | Encrypted ERC-20 transfer amounts with client-side proving; per-asset vaults and encrypted ledgers | Public token identity and transfer public keys remain observable. The reviewed ABI does not provide a ready-made atomic RFQ operation. This is a different privacy protocol, not the STRK20 pool |
| Renegade internal matching | Its documented internal dark-pool matches retain trade confidentiality | A different settlement system and wallet/liquidity integration. Its external matches explicitly expose side, pair and match size, so using an external-match SDK does not deliver the internal privacy model |
| RAILGUN DEX adapter | Shielded balances with public DEX execution | Its own docs explicitly say token type and swap amounts are visible at the external DEX call |
| Penumbra V1 swaps | Anonymous swap initiation and private output claims | Current protocol documentation says input assets and amounts are public; sealed-bid input confidentiality is described as a future upgrade |

Tongo and external dark pools are not automatic replacements for the hackathon's required STRK20-touching settlement transactions. A public withdrawal into another protocol can also disclose the funding amount. Do not present a bridge or subsequent encrypted transfer as erasing an already public swap.

## Tested locally: a jointly authorized account, one proof

This began as an inference from single-owner multi-asset transfers and the pool's custom account-signature validation. It now has an isolated Cairo implementation and a successful local execution experiment against the exact pinned mainnet pool class. It is not a documented upstream escrow integration or an enabled APP20 feature.

Instead of applying two separately proven updates, counterparties could fund a dedicated, jointly authorized account with encrypted transfers ahead of settlement. That account would authorize one action bundle creating both encrypted outputs. The pool would see one logical user and one action message, avoiding the exact singleton-facts conflict observed by the probe. There must be no central operator with unilateral spending power.

This changes the protocol's funding and custody semantics. A bare 2-of-2 wallet is not sufficient: either party could otherwise lock the other party's funds indefinitely. Required feasibility gates before using this candidate:

1. Both parties can verify the exact single proof invocation and jointly authorize it without exposing their ordinary wallet viewing/signing keys. Any escrow viewing material has an explicit, limited sharing boundary.
2. A malicious peer cannot substitute an output, spend the other party's asset, or use standard signature validation to bypass a custom settlement/refund policy. The pool attempts custom, transaction-hash and CallSet signature paths; all accepted paths must enforce the same policy.
3. Cancellation and non-cooperation have unilateral, asset- and recipient-bound refunds. Refund authorization must survive nonce changes, proof expiry, partial funding and client crashes without allowing theft. A stale proof or local timer is not a refund mechanism.
4. Settlement and refunds remain encrypted inside the pool. Constructor parameters, signer registration, channel setup, fee movements and timing must be reviewed for metadata leakage; a visible ephemeral account is still an observable identifier.
5. Test the exact pinned mainnet class locally, then validate real proofs and actual wallet support. Hosted proving still exposes witnesses to the provider; account construction does not solve that separate limitation.

The [joint escrow harness](../pool-harness/JOINT_ESCROW.md) settled both encrypted outputs in one transaction, rejected adversarial authorizations and callbacks, and exercised independent timeout refunds and later one-sided funding recovery. It uses simulated proof facts while running the actual Cairo signature checks. The local node explicitly rejects `starknet_getStorageProof`, preventing the full-node proving path from using this fixture. Real STARK proofs, wallet integration and independent review remain required; hosted witness disclosure and public metadata are not solved by this prototype. The two-proof regression remains unchanged.

## Primary references

- [AVNU private-swap flow](https://docs.avnu.fi/docs/privacy/private-swap)
- [STRK20 OTC proposal and visibility table](https://strk20.starknet.io/rfp/private-otc-settlement)
- [Tongo documentation](https://docs.tongo.cash/), [v2 vault architecture](https://docs.tongo.cash/protocol/vault.html), [v2 ABI and events](https://docs.tongo.cash/protocol/abi.html)
- [Renegade internal versus external matching](https://help.renegade.fi/hc/en-us/articles/35455732014355-What-are-External-Matches), [protocol whitepaper](https://whitepaper.renegade.fi/)
- [RAILGUN's DEX swap visibility](https://docs.railgun.org/wiki/learn/integrating-railgun/example-dex-swaps)
- [Penumbra swap protocol and future sealed-bid design](https://protocol.penumbra.zone/main/dex/swap.html)
- [STRK20 account authentication](https://github.com/starkware-libs/starknet-privacy/blob/main/packages/privacy/src/utils.cairo), [SDK interfaces](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/src/interfaces.ts)
