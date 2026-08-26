# APP20 Private Trading Desk

APP20 joins three existing surfaces into one professional workflow:

1. **Desk** — inventory-backed private USDC↔STRK RFQ settlement.
2. **Mailbox** — encrypted correspondence and non-authoritative evidence.
3. **Counterparties** — a device-encrypted address book with RFQ and Mail handoffs.

## Desk lifecycle

```text
Counterparty → Privacy preflight + confirm → Sealed maker requests
             → Verify all → Select one → Lock
                                      ↘ Maker fill → Claim → Receipt
                                      ↘ Expiry → Refund
```

Before sending exact terms, the Desk reports evidence-labelled amount
fingerprinting, denomination, note-maturity, timing, invited-maker, and public
settlement findings. Missing evidence is shown as unavailable, no synthetic
privacy score is invented, and known maker/public disclosures require explicit
confirmation.

The localnet market uses a deterministic price fixture and two P-256 makers
with separate child processes, devnet settlement accounts, quote keys,
private-note inventories, auth scopes, and `0600` reservation WALs. A quote is
signed only after its reservation snapshot is fsynced. Both signatures are
verified before deterministic best-amount selection; losing reservations are
released durably. The selected maker persists `begin-fill` before wallet
execution, preventing concurrent double fill. The Playwright journey SIGKILLs
that process after selection, verifies automatic WAL recovery, and then settles
against the real pool with mock proof bytes.

Exact maker balances and private keys are never returned to the browser, and no
order book is published. Devnet still exposes deterministic predeployed keys,
loopback maker HTTP is not HPKE yet, and a single-host PID lock is not a
replicated production database. Cairo and finalized pool state remain
authoritative. A Mail letter, local lifecycle state, quote, WAL entry, or digest
cannot prove settlement.

## Localnet claim authorization

App20Escrow V2 authorizes claim or timeout with a deal-unique, supply-one
ERC-20 ticket held as a private note. Funding mints that ticket into an OPEN
note; payout atomically withdraws and burns it before creating the OPEN payout
note. The Mail seed cannot derive or spend the ticket. Ticket and deal contract
addresses, token amounts, deadline, and escrow events remain public, and OPEN
notes remain subject to pool maturity. This path is localnet-only: Mainnet and
Sepolia escrow helper addresses remain zero and Mainnet RFQ execution is still
disabled.

## Contact storage and recovery

The live address book remains AES-GCM encrypted under a random device-local key
at `app20/address-book/v1/<wallet>`. The key is stored in the same browser
profile, so this protects against casual storage inspection—not XSS, malicious
extensions, or code already running in that profile.

An unlocked Mailbox can create a full authenticated contact snapshot and post
it as self-addressed Mail ciphertext. Snapshot v1 binds:

- normalized wallet address;
- Starknet chain ID;
- exact Mail helper address;
- mailbox public-key fingerprint;
- random 32-byte snapshot ID;
- creation and per-entry update times;
- up to 200 validated contacts;
- canonical SHA-256 digest;
- HMAC-SHA256 under a domain-separated key derived from the mailbox seed.

The snapshot never contains the address-book AES key, Mail seed, viewing key,
or wallet signature. The existing X25519 + AES-GCM Mail layer encrypts the
whole authenticated envelope before `MessagePosted` stores ciphertext on-chain.

### Restore

Recovery requires both:

1. the same connected wallet identity; and
2. the mailbox recovery phrase/seed registered to that wallet.

Ready signatures are not stable encryption secrets and are never used as
wrapping keys. The dapp never requests the STRK20 viewing key.

After decryption APP20 verifies every scope field, digest, MAC, timestamp,
label, address, duplicate, and limit before allowing an explicit **Merge**.
Merge is additive and the newest timestamp for a label wins. Destructive full
replacement is intentionally unavailable in snapshot v1 because it would need
an entry-level deletion preview and a verified local rollback copy.

Restore never runs automatically. APP20 shows an entry preview and warns when
the selected snapshot predates local updates or another authenticated snapshot
already loaded from a later block/event. Older snapshots remain on-chain
forever.

## Size policy

Snapshot v1 occupies one single-recipient Mail envelope. APP20 computes the
exact envelope and ciphertext size before asking the wallet to sign. Oversized
books fail without truncation or submission. Chunking is deliberately deferred
because it needs authenticated manifests, missing-chunk handling, and bounded
transaction costs.

## Privacy boundary

| Protected from public observers | Still public or disclosed |
| --- | --- |
| Contact labels and addresses inside the Mail ciphertext | Mail helper interaction, ciphertext size, timing, recipient count, backup frequency |
| Mail plaintext | APP20/browser code while the mailbox is unlocked |
| Private note ownership and transfers | Shield/unshield boundaries |
| Link between RFQ input and output notes | Prototype escrow pair, amounts, deadline, OPEN-note amount, and timing |
| Device-local labels at rest from casual inspection | Code running in the browser profile can read the local key and plaintext |

Snapshot v1 restores through the same configured Mail helper and mailbox key.
Before either rotates, restore the latest snapshot and post a new one under the
replacement scope; legacy helper scanning is not automatic.

Permanent ciphertext can be decrypted later by anyone who obtains the mailbox
seed. The current Ed25519 Mail auth key is not registered by the directory, so
its signature is shown only as an unbound signature—not wallet or mailbox
identity proof. Mail is correspondence and evidence; it is not settlement
authority.
