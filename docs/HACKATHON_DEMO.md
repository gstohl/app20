# Hackathon demonstration status

Updated September 7, 2026. Three mainnet settlement transactions are verified and recorded in `strk20.json`. The existing video is a labelled rehearsal; the final video URL and submission are still pending.

## Mainnet settlement evidence

The Node SDK completed three swaps using real STRK20 proofs through the authenticated APP20/Starkscan relay. Each exchanged **0.01 shielded STRK for 0.001 shielded native USDC**. The operator controlled both maker and taker; these are controlled settlement tests, not independent customer trades.

| Round | Transaction | Mainnet block |
| --- | --- | --- |
| 1 | [0x1e364ca1…](https://voyager.online/tx/0x1e364ca1c778fd304fae9506dabade0f2c958e0e867465db9a7ceb0f13af36d) | 14496051 |
| 2 | [0x30f926d2…](https://voyager.online/tx/0x30f926d2eddc5361ff96b0c3c5f173d87fef227fb87d1055899f32daf221c7e) | 14496125 |
| 3 | [0x6905abc5…](https://voyager.online/tx/0x6905abc575ffb6532b566695c86194d15dfe6e26afd8ab9b47f9e4bb749a171) | 14496197 |

All three had successful included receipts (`ACCEPTED_ON_L2` at verification), a `QuoteFilled` event, and traces calling both APP20 private settlement and the STRK20 pool. Both deployed class hashes were verified at each receipt block. Local viewing-key discovery independently confirmed **0.003 USDC across three shielded notes**. Public USDC did not increase during the fills.

The maker's 0.03 STRK proceeds were withdrawn, its registration deactivated, and both inventory balances checked at zero. Wallet/viewing/transport keys and quote/proof journals remain outside the repository in owner-only local storage. Public receipts and cost evidence are in [the mainnet smoke-test record](../deployments/mainnet/smoke-test-2026-09-07.json).

The 17 setup, swap and cleanup transactions cost **11.863877034965690848 STRK network fees + 24 STRK pool fees = 35.863877034965690848 STRK**. Earlier deployment plus this demo totals **63.910369825551435280 STRK**, within the 65 STRK ceiling. A separate 0.5 STRK inventory purchase yielded 0.015442 native USDC; 0.003 USDC was used by the maker and 0.012442 USDC remains public in the operator wallet.

## Browser rehearsal verification

- Alice/Bob Chat localnet end-to-end test passed: message delivery, attached fixed offer, and payment response. Proving is simulated on localnet. Chat offers do not guarantee atomic settlement of both assets.
- Desktop RFQ browser rehearsal passed: minimum receive enforcement, ranked preliminary replies, only one funded reservation, explicit review of price changes, settlement recovery after reload, and duplicate-attempt prevention. RPC and wallet are fixtures; cryptography is real.
- Agent SDK tests passed (8 tests), including preserving proof arguments through fee estimation and transaction submission. The production build passed.
- Captured the live public RFQ, maker, agents, and Chat pages without connecting a wallet or submitting transactions.

Recordings and the Remotion draft are in `artifacts/hackathon/`. The rendered `app20-demo-rehearsal.mp4` is a captioned, silent 1920×1080 H.264 video: 5,400 frames at 30 fps (180 seconds). Exported frames were visually reviewed. See `tools/demo-video/README.md` for rendering instructions. The draft is visibly labelled and must not be presented as mainnet settlement evidence.

## Required before submission

The [hackathon submission requirements](https://github.com/starkience/strk20-hackathon#strk20json) require three successful mainnet transactions through the STRK20 pool and the project's deployed contract, plus a three-minute demo video URL. Deployment transactions and localnet/fixture hashes do not satisfy this requirement.

The mainnet transaction requirement now has verified evidence. To recheck the manifest without signing or broadcasting:

```sh
node scripts/verify-hackathon-transactions.mjs --rpc https://rpc.starknet.lava.build/rpc/v0_10
```

The verifier checks mainnet, successful included receipts, a completed APP20 quote event, pool and APP20 settlement calls in traces, and pinned contract classes. It records receipt evidence; `--write` additionally updates `strk20.json`. Historical trace availability is required. Lava handled the proof-bearing transactions and traces successfully; Cartridge's trace endpoint rejected the new proof-fact version during this run. Starkscan proving worked, but its RPC write gateway reported disabled writes, so signed transactions were broadcast through Lava without provider credentials.

Replace the rehearsal RFQ segment with captured real execution and receipt evidence, review the exported video for sensitive material, publish it, and fill `demo_video`. Remote proving exposes proving payloads to the relay/proving infrastructure; this recording does not establish anonymous proving or remove that documented limitation.

## Revised recording and voiceover

`artifacts/hackathon/app20-demo-v2.mp4` replaces the first cut: visible cursor and click rings, slower typing, smooth target scrolling, normal-speed excerpts, end-frame reading holds, and closer framing of funded terms. It is exactly 180 seconds at 1920×1080/30 fps; exported chapter frames were reviewed. The paced Chat localnet round and the regular RFQ browser regression both passed. See [the timed voiceover script](../tools/demo-video/VOICEOVER.md) (343 spoken words). The video is silent; narration has been scripted, not recorded. The verified mainnet evidence above has not yet been incorporated into this rehearsal video.
