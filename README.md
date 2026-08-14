# Quietline

Encrypted on-chain mail on Starknet.

Addresses never appear on the message. Content decrypts only on the
recipient's device. A private transfer can carry a memo in the same
transaction — remittance with a note, on a public chain.

Built for the [STRK20 Private Sprint](https://github.com/starkience/strk20-hackathon)
against the live mainnet pool. Inspired by
[RFP-01](https://strk20.starknet.io/rfp/private-messaging).

This repository was started as Feltproof (private poker) and pivoted.
The GitHub URL is still `gstohl/feltproof`. The product is Quietline.

## What we are shipping

One complete private-mail loop on Starknet mainnet:

1. Two Ready wallets register in the pool (wallet does this on first use).
2. Alice sends Bob an encrypted message through a `privacy_invoke` helper.
3. Bob discovers and decrypts it locally. No server holds plaintext.
4. Optionally, Alice attaches the memo to a private STRK transfer in the same tx.
5. Observer sees that *a* pool transaction happened, and when. Not who, not what.

## Hidden vs visible

| Element | Hidden | Visible |
| --- | --- | --- |
| Sender identity | Yes — pool is `msg.sender` | |
| Recipient identity | Yes — only via the recipient's viewing key | |
| Message content | Yes — encrypted to the channel key | |
| That a message was sent | Partially | Block timestamp, that a pool tx occurred |
| Payment amount (if attached) | Yes, inside the pool | Shield / unshield legs stay public |

## Stack

Wallet API + a `privacy_invoke` helper. The dapp never touches a viewing key.
Ready wallet. Alchemy RPC in an env var, never committed.

## Sprint artifacts

Scoring reads this repository every 30 minutes. Fill in `strk20.json` as they exist:

- `transactions` — three successful mainnet hashes that touched the STRK20 pool
- `contracts` — deployed helper addresses
- `demo_video` — a 3-minute walkthrough of send + discover + optional memo
- `demo_url` — only if GitHub Pages / Website / Vercel does not already find it

## Status

Phase 1 wallet plumbing is in: connect Ready, detect Wallet API/spec ≥ 0.10,
shield / private transfer / unshield / balances on Sepolia. Inbox UI and the
message helper are next. This is not a gambling product.

```bash
npm ci
npm run typecheck
npm run build
```

## License

MIT
