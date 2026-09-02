# APP20 negotiation and relationship channels

APP20 negotiation is encrypted correspondence and tamper-evident local evidence. It never authorizes value. In the build-gated localnet fixture, only the connected wallet, Cairo settlement transition, and finalized pool state can do so; no production configured-chain settlement authority is available.

## Implemented protocol models

### Negotiation documents

`src/lib/negotiation.ts` defines `app20/negotiation-document/v1`:

- strict `offer`, `counter`, `accept`, and `cancel` documents;
- exact decimal base units bounded to positive `u256` values;
- canonical terms and document digests;
- predecessor-bound revisions and terminal transcript states;
- full-document Ed25519 signatures from the mailbox authentication key;
- encrypted attachment manifests with allowlisted media types, ciphertext digests, and size limits;
- expiry checks and explicit `expired` state rather than treating idle as refusal.

An acceptance binds the active terms digest. It does not invoke a helper, sign a quote, select a reservation, or call settlement. `NEGOTIATION_HAS_SETTLEMENT_AUTHORITY` is permanently `false` in v1.

### Wallet-to-Mail binding

`src/lib/relationship-channel.ts` defines `app20/wallet-mail-binding/v1` and builds a SNIP-12 typed-data statement that binds:

- Starknet account and chain;
- independently generated x25519 mailbox public key;
- independently generated Ed25519 Mail authentication public key;
- issue and expiry times;
- one-use nonce and revocation id.

The wallet signature is an attestation only. It is never used as encryption input or key-derivation material. Certificate verification requires an external account-signature verifier and fails on invalid signatures, expiry, or revocation.

### Relationship channels

The channel protocol defines:

- opaque invitation, channel, and relay-capability identifiers;
- signatures bound to verified inviter and invitee wallet/Mail certificates;
- invitation expiry and explicit message/byte quotas;
- predecessor-bound key epochs;
- replay-safe monotonic message sequence numbers;
- terminal block, report, revoke, and expiry states.

The epoch schema records the required `Double-Ratchet/X25519/HKDF-SHA256/AES-256-GCM` suite and root-key commitments. APP20 does **not** implement or claim an audited Double Ratchet yet; production channel encryption remains blocked on a reviewed library, recovery design, relay integration, and independent security review.

## RFQ v3 quote and transcript channel

Localnet RFQ v3 does not use negotiation documents as quote authority. The coordinator sends each invited maker a canonical RFQ v2 containing the pair/direction, fixed ladder bucket, taker commitment, helper/network bindings, and expiry; exact size and floor are absent. A maker returns a P-256-signed quote only after its on-chain collateral lock is confirmed. The browser verifies the signature and value-critical `get_lock` fields before selection. The current verifier neither compares the quote's signed `lockTicket` with the returned lock's `ticket` nor resolves its `lockTransactionHash`, so those evidence fields are not yet chain-bound.

After selection, the coordinator forwards one digest-bound transcript to every invited maker. It contains all maker ids, quote/refusal digests, outcomes, ranks, bucket, clearing unit price, and each winner's `amountA`. The latter allocations can be summed to infer exact size, so bucket-only disclosure applies to invitation, not the complete post-selection channel. This transcript is fairness evidence, not settlement authorization.

## Authority and privacy boundaries

| Item | Authority | Visibility |
| --- | --- | --- |
| Offer/counter/accept/cancel | Correspondence evidence only | Encrypted Mail participants when transport is integrated |
| Wallet/Mail certificate | Attests Mail-key control at issuance | Parties receiving the certificate |
| Attachment manifest | Binds encrypted bytes, type, and size | Negotiation participants |
| Channel invitation and epoch | Authorizes correspondence quota only | Channel participants; relay should receive opaque capability and ciphertext |
| RFQ v3 request | Quote invitation only | Invited maker learns pair, direction, bucket, bindings, and expiry; not exact size/floor |
| Signed quote and collateral lock | Maker/client protocol evidence; lock constrains collateral | Taker/coordinator; lock schedule and collateral facts are public on chain |
| Selection transcript | Fair-loss evidence only | Every invited maker; winner allocations can reveal exact size |
| Settlement | Localnet Cairo contract plus pool-applied chain state | `LockCreated`, Take `takerSecret` calldata, `LockTaken`, and `DealTaken` facts are public |

No channel or negotiation object contains a STRK20 viewing key, maker private key, raw inventory balance, or universal disclosure key. Relays may still observe delivery timing and participation metadata; padding and batching are future transport controls, not current privacy claims.

## Verification

Focused tests:

```bash
npx vitest run src/lib/negotiation.test.ts src/lib/relationship-channel.test.ts
```

The tests cover canonicalization, semantic tampering, signature failure, parent/revision failure, active-term binding, terminal states, certificate revocation, invitation binding, epoch continuity, replay, quotas, and expiry.
