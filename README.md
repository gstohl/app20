# Feltproof

Provably fair private poker on Starknet.

Hole cards are encrypted STRK20 notes. The dealer shuffle is a STARK, not a server.
Your stack, your session, your lifetime results stay in the pool. Bet sizes stay
public — that is poker. Who is sitting is not.

Built for the [STRK20 Private Sprint](https://github.com/starkience/strk20-hackathon)
against the live mainnet pool. Inspired by
[RFP-03](https://strk20.starknet.io/rfp/private-poker).

## The hand we are shipping

One complete heads-up NLHE cash-game loop on Starknet mainnet:

1. Two players shield USDC and buy in.
2. The dealer commits a seed and deals encrypted hole cards as notes.
3. Betting is public. Identities are not — a paymaster submits every action.
4. Board deals. Fold or showdown.
5. The pot settles as private notes.
6. Cash out to any address.

Trusted-dealer shuffle first, proven from a committed seed. Mental poker is later.

## Hidden vs visible

| Element | Hidden | Visible |
| --- | --- | --- |
| Player identities | Yes — paymaster submits | |
| Hole cards | Yes — encrypted notes | |
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

Repository initialized. Integration plan and first playable table come next.

## License

MIT
