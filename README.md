# Feltproof

Provably fair private poker on Starknet.

Hole cards are helper-stored ciphertexts with on-chain commitments; STRK20 notes
hold shielded chips, not cards. The planned trusted-dealer V1 commits and later
reveals its shuffle seed. Stacks and session PnL stay in the pool while bet sizes
remain public — that is poker. Who is sitting is not.

Built for the [STRK20 Private Sprint](https://github.com/starkience/strk20-hackathon)
against the live mainnet pool. Inspired by
[RFP-03](https://strk20.starknet.io/rfp/private-poker).

## The hand we are shipping

One complete heads-up NLHE cash-game loop on Starknet mainnet:

1. Two players shield STRK and buy in.
2. The dealer commits a seed and stores encrypted hole cards plus commitments.
3. Betting is public. Identities are not — a paymaster submits every action.
4. Board deals. Fold or showdown.
5. The pot settles as private notes.
6. Cash out to any address.

Trusted-dealer shuffle first, proven from a committed seed. Mental poker is later.

## Hidden vs visible

| Element | Hidden | Visible |
| --- | --- | --- |
| Player identities | Yes — paymaster submits | |
| Hole cards | Yes — helper ciphertexts + commitments | |
| Stacks, session history | Yes — private notes | |
| Bet amounts | | Yes — poker bets are public |
| Board / fold / showdown | | Yes |
| That a hand happened | | Yes — a pool transaction occurred |

## Stack

Wallet API + a `privacy_invoke` helper. The dapp never touches a viewing key.
Ready wallet on mainnet. Alchemy RPC in an env var, never committed.

## Sprint artifacts

Scoring reads this repository every 30 minutes. Fill in `strk20.json` as they exist:

- `transactions` — three successful mainnet hashes that touched the STRK20 pool
- `contracts` — deployed helper addresses
- `demo_video` — a 3-minute walkthrough of a full hand
- `demo_url` — only if GitHub Pages / Website / Vercel does not already find it

## Status

Phase 1 app code is complete: connect Ready, detect Wallet API/spec support ≥0.10,
and exercise shield, private self-transfer, unshield, and balances with STRK. Manual
wallet checks remain on Sepolia. No poker helper or table UI is included yet.

```bash
npm ci
npm run typecheck
npm run build
```

## License

MIT
