# APP20 localnet-final scope decision

Decision date: 2026-08-26

APP20 is returning to a **localnet-only** product scope. Mainnet remains Ready-only wallet functionality; Sepolia remains Ready plus optional Privy wallet functionality. The build-gated development wallet, Mail fixtures, and private RFQ run only on localnet. Production RFQ transport, RFQ publication/value execution, and authoritative browser receipts remain disabled.

APP20's definitive product is a bookless invited-maker RFQ using the existing STRK20 privacy pool; creating a new dark pool, AMM, order book, liquidity pool, or pool factory is not a goal. The canonical goals and gaps are in [`APP20_RFQ_GAPS.md`](APP20_RFQ_GAPS.md).

The historical Sepolia transactions are one-off deployability evidence, not runtime configuration, release approval, an audit, or canonical production deployment provenance. Their denylisted records live under [`evidence/historical-sepolia-proofs/`](evidence/historical-sepolia-proofs/); the separate production manifest remains blocked with `releaseReady: false`, zero addresses/class hashes, no audits, and no approvals.

## Closure matrix

| Todo | Localnet-final closure | Factual state |
| --- | --- | --- |
| #142 authoritative chain receipts | **Deferred/out of scope** | Pure checks and a nominal capability type exist, but no constructible runtime-provenanced capability, generated decoder, RPC adapter, or durable reorg authority exists. Localnet Cairo/finalized state remains authority; browser receipts are non-authoritative. |
| #143 production RFQ flow | **Deferred/out of scope** | Browser publication and Worker RFQ routing are immutable-off. Dormant protocol primitives are not a production flow. |
| #148 receipt authority prerequisites | **Deferred/out of scope** | Origin and canonical-membership models do not supply server composition, DNS pinning, ABI decoding, approved quorum, or durable freshness/reorg state. |
| #152 Sepolia deployment pipeline | **Completed only as a superseding one-off proof spike** | A deployer, App20Mail, and the historical escrow fixture demonstrated deployability. No reusable or authorized funding/deployment pipeline is retained or delivered. |
| #153 deployment candidate validation | **Completed for the recorded proof fixtures** | The offline evidence index pins source/artifact digests, class hashes, transactions, deployed identities, and canonical-vs-legacy labels. The records cannot configure runtime. |
| #154 funding/deployment handoff | **Deferred/out of scope** | The one-off deployer paid fees, but no funding transaction, custody restoration result, custody handoff, or approval attestation is recorded. |
| #155 reproducibility checkpoint approval | **Deferred/out of scope** | Artifact digests exist, but there is no independent reproduction, bundle digest, two-builder record, or approval. `releaseReady` remains false. |
| #156 reviewed deployable contracts | **Deferred/out of scope** | App20Mail proof was unaudited; deployed escrow/ticket classes are legacy; canonical production App20Escrow/App20Claim do not exist. |

## Historical Sepolia facts and deny policy

- The deployer account was publicly observed as `ACCEPTED_ON_L1`; the retained proof does not separately attest its execution status. App20Mail declaration and deployment were publicly observed as `ACCEPTED_ON_L1` and `SUCCEEDED`.
- App20Mail proof address `0x0204ce7efff77e4bef8f05ea4ee0e810c51cd1f1532ec0c04da3fdcb662fe545` has recorded class hash `0x05f066234003eb6f9104e7730c88f50dab82113ad5e9dbbc0db3f75972d586ca`.
- Historical/localnet `App20Escrow` proof address `0x06a9ea8288df876d1e174db1e0b8d58bc8bc4641b3ed9f592fb56003f69712a4` was publicly observed as `ACCEPTED_ON_L2` and `SUCCEEDED`, with legacy class hash `0x0638d8554dc095f63f253c8dd32ac09a3e9ffedd5a308b0d0f188e5fca6c8c3b`.
- Historical `ClaimTicket` was declared with class hash `0x07619ea7dcb8615874fb9d29b217f649e9b7b596f01d47d673e4e37132b17196` and pinned by that legacy escrow. No standalone ticket instance is claimed.
- None of these values may be copied into application constants, build variables, the production manifest, or `strk20.json`. Legacy `App20Escrow`/`ClaimTicket` are never canonical production `App20Escrow`/`App20Claim`.
- Local-test token fixtures stay local-only and are excluded from every Sepolia proof artifact.

## Approval boundary

Any future live helper, canonical escrow/claim, RFQ transport, authoritative receipt adapter, deployment tooling, or Mainnet value path requires a new scoped design/review and explicit human approval. The old release checkpoint JSON is historical and superseded by this scope decision; it is not rewritten because its immutability claim belongs to its containing checkpoint.
