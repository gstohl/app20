# APP20 negotiation and relationship channels

APP20 negotiation is encrypted correspondence and tamper-evident local evidence. It never authorizes value: only the connected wallet, the reviewed settlement call, and finalized chain state can do that.

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

## Authority and privacy boundaries

| Item | Authority | Visibility |
| --- | --- | --- |
| Offer/counter/accept/cancel | Correspondence evidence only | Encrypted Mail participants when transport is integrated |
| Wallet/Mail certificate | Attests Mail-key control at issuance | Parties receiving the certificate |
| Attachment manifest | Binds encrypted bytes, type, and size | Negotiation participants |
| Channel invitation and epoch | Authorizes correspondence quota only | Channel participants; relay should receive opaque capability and ciphertext |
| Quote and reservation | Maker/client protocol evidence | Invited maker and taker |
| Settlement | Cairo contract plus finalized chain events | Public settlement boundary |

No channel or negotiation object contains a STRK20 viewing key, maker private key, raw inventory balance, or universal disclosure key. Relays may still observe delivery timing and participation metadata; padding and batching are future transport controls, not current privacy claims.

## Verification

Focused tests:

```bash
npx vitest run src/lib/negotiation.test.ts src/lib/relationship-channel.test.ts
```

The tests cover canonicalization, semantic tampering, signature failure, parent/revision failure, active-term binding, terminal states, certificate revocation, invitation binding, epoch continuity, replay, quotas, and expiry.
