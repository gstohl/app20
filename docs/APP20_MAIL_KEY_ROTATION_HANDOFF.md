# APP20 Mail key rotation, revocation, and compromise recovery handoff

**Status: design handoff only — unimplemented. P0-33 remains open.**

This document specifies requirements for the Cairo and application teams. It is not a deployed protocol, an ABI, an authorization decision, or permission to enable Mail, RFQ, or value movement on Sepolia or Mainnet. The current application still has one non-overwritable mailbox encryption key, derives its Ed25519 Mail signing key from the same recovery phrase, and has no rotation or revocation mechanism.

## Threat and authority boundary

The 32-byte mailbox seed controls two powers:

1. the X25519 private key that decrypts correspondence addressed to the mailbox; and
2. the derived Ed25519 key that signs Mail documents and canonical payment requests.

A valid current signature proves only that a particular message was signed by a particular Mail key. It does not prove which person signed it or that the signer controls a claimed wallet. Possession of the recovery phrase is therefore a compromise of both confidentiality and signing authority.

The current app correctly refuses to overwrite a registered key. An app-only overwrite or local denylist would be unsafe: another client could ignore it. Epoch selection and revocation must be represented in, and enforced against, canonical on-chain state.

## Required on-chain state model

For each directory scope (at minimum chain ID, Mail contract/helper, and mailbox account identity), the replacement contract must expose:

- a monotonically increasing, never-reused `key_epoch`;
- the epoch's X25519 encryption public key and Ed25519 authentication public key;
- an explicit state: `ACTIVE`, `SUPERSEDED`, or `REVOKED`;
- the finalized block/transaction at which the state became effective;
- the current active epoch, with at most one active epoch per scope; and
- an append-only transition history sufficient for light clients and indexers to reconstruct every epoch without trusting an application cache.

Keys must not be silently overwritten, deleted, reused in a later epoch, or moved between accounts/scopes. Events and read methods must commit to the full scope, epoch, both keys, prior epoch, transition type, and effective block. A transition must be atomic: observers must never see two active epochs or a state where a revoked epoch became active again.

### Authorization is a required human/Cairo-team decision

A transition cannot be authorized only by the old Mail signing key: an attacker holding the recovery phrase has that key. The Cairo design must bind rotation and emergency revocation to a separately governed account/recovery authority and document how that authority is authenticated through the STRK20 `privacy_invoke` route. The present helper's caller and privacy model must not be assumed to provide wallet ownership without a reviewed proof.

The product/security owners and Cairo team must choose and review the recovery authority, including lost-wallet behavior, guardians or delay (if any), cancellation, account migration, and denial-of-service risk. This repository does not make that human security/governance decision. No UI should offer rotation until the chosen authorization is enforced by the deployed contract and independently reviewed.

## Transition semantics

### Planned rotation

A planned rotation creates epoch `n + 1`, marks epoch `n` `SUPERSEDED`, and makes the new epoch active in one finalized transition. Clients must stop encrypting new correspondence to epoch `n` and stop creating new signatures with it once the transition is final.

### Compromise revocation

Emergency recovery creates a fresh epoch and marks every compromised epoch `REVOKED` atomically. Revocation is permanent. A revoked key can never be reactivated, and another key with the same bytes must not be registered.

A payment request whose signing epoch is `REVOKED` must be treated as invalid, even if its signature is mathematically correct, it was allegedly created before revocation, or it has not expired. It must not display a verified badge, be imported as an authenticated request, or enable a payment action. The UI must fail closed with a specific "revoked Mail key" result. There is no grandfathering for payment requests because a compromised holder can backdate data unless issuance was independently anchored.

For the first safe implementation, requests signed by a `SUPERSEDED` epoch should also fail closed at review time. If product later wants a grace period, that is a new protocol decision requiring an on-chain issuance anchor, a bounded maximum lifetime, explicit effective-block rules, and an audit; a client-supplied timestamp is insufficient.

## Signed artifact changes

Signature verification alone is not enough. Every new Mail document and payment request format must bind, inside its canonical signed bytes:

- chain ID and exact directory contract/helper address;
- claimed mailbox account identity;
- `key_epoch`;
- X25519 mailbox public key and Ed25519 authentication public key;
- document/request domain and all existing canonical terms; and
- expiry where the artifact type supports action.

A verifier must resolve finalized directory state for that exact scope and epoch. It must reject missing/unknown epochs, key mismatches, revoked or superseded epochs, ambiguous/reorged state, unavailable state reads, and unsupported legacy versions. Cached state needs a bounded freshness rule and must never convert an RPC failure into acceptance.

Legacy signed payment links do not carry an enforceable epoch. After the migration activation block they must remain visibly legacy/unverifiable and must not receive the current-key verified treatment merely because their Ed25519 signature checks.

## Correspondence encrypted under old keys

Rotation cannot re-encrypt or erase ciphertext already posted on-chain. A device that needs old correspondence must retain a versioned local keyring containing the private decryption key for each historical epoch. Mail scanning must select the private key by the recipient epoch committed in the envelope; it must not trial an unbounded set of secrets or silently label unknown-epoch ciphertext as current.

A new recovery export format must be versioned and authenticated and must contain the current seed/key plus any historical decryption keys the user elects to retain. Restoring it must verify every epoch against finalized directory history before merging. The existing eight-group seed backup recovers only its deterministic key pair; it cannot recover independently generated successor or prior keys.

Revocation does not claw back confidentiality. Anyone who copied a compromised old seed can continue reading correspondence that was encrypted to that old epoch. Recovery protects only correspondence sent to the fresh epoch. The UI and incident runbook must state this limitation.

Keeping an old decryption key for reading must never keep its signing authority enabled. Implementations should store historical encryption capability separately from active signing material, erase superseded/revoked signing seeds when feasible, and ensure no "reply" or payment-request path can sign with a non-active epoch.

## How correspondents learn a transition

The on-chain directory is authoritative, not an in-message transition notice.

- Before every send, the sender must resolve the recipient's current active epoch from finalized state and encrypt only to that key.
- Drafts and queued sends must re-resolve immediately before signing/submission and require review if the epoch changed.
- Directory transition events may invalidate caches and notify users, but event delivery alone is not proof; clients must confirm the resulting state through a canonical read.
- Each encrypted envelope must identify the recipient epoch(s). A recipient may send a transition notice for usability, but clients must treat it only as a hint and verify it on-chain.
- If state is stale, unavailable, inconsistent, or in a reorg window, sending and authenticated payment-link review must stop rather than fall back to an old key.

Correspondents who remain offline cannot be forced to learn the transition. When they return, the client must check the directory before showing an old Mail key as current or sending a reply.

## Compromise-recovery flow

A complete implementation must provide this fail-closed sequence:

1. The user authenticates with the separately approved recovery authority.
2. Fresh, independent encryption and signing material is generated; it must not be derived from the compromised seed.
3. One on-chain transaction permanently revokes compromised epochs and activates the next epoch.
4. The client waits for the specified finality threshold and verifies the exact transition from canonical state.
5. Local caches, drafts, pending links, correspondents, and keyrings are reconciled to the new epoch. Anything signed by a revoked/superseded epoch loses verified status.
6. The user receives a new versioned recovery export and an explicit warning that old ciphertext remains readable to the attacker.

Partial completion must not be presented as recovery. In particular, generating a new local seed without a finalized on-chain transition leaves correspondents and verifiers on the compromised key.

## Cairo/application acceptance gates

P0-33 stays open until all of the following exist and are accepted:

- reviewed Cairo storage, ABI, events, authorization, monotonicity, and atomic transition invariants;
- application formats binding signatures and encrypted envelopes to directory scope and epoch;
- finalized-state verification that rejects revoked, superseded, unknown, legacy, unavailable, and reorg-ambiguous cases;
- migration behavior for current single-key mailboxes and legacy payment links;
- versioned multi-epoch backup/restore and explicit old-correspondence behavior;
- planned-rotation and compromise-recovery UX with truthful confidentiality limits;
- contract, application, adversarial, restore, multi-device, reorg, and cache-staleness tests;
- independent security review and remediation; and
- separately authorized deployment evidence. No Mainnet or Sepolia enablement follows automatically.

The current copy changes only disclose the risk. They do not implement any item above and do not close P0-33.
