# Hackathon demonstration status

Updated September 8, 2026. Three historical mainnet settlement transactions are verified and recorded in `strk20.json`. They use the earlier protocol with public funded terms. The prior 2:16 narrated video includes localnet Chat and confidential escrow development, but its one-sided Chat offer acceptance and public maker onboarding predate the new private-only policy. Those scenes must be replaced before publication as the current product. The public video URL remains pending.

## Prior video: confidential development (version 8)

`artifacts/hackathon/app20-demo-v8-confidential.mp4` is a 136-second H.264/AAC export at 1920×1080/30 fps, with selectable English subtitles and a separate SRT. It keeps the selected ElevenLabs Liam voice, natural Chat examples, macOS cursor/window styling and compact title/caption bars. Five new narration chapters describe the implemented escrow, separate approvals, atomic encrypted-note settlement, independent timeout refund and current privacy limits. No confirmed-swaps chapter appears.

In the September 7 recording run, the browser's real local-contract flow passed, including incomplete funding and unilateral recovery. The shared SDK passed against the exact mainnet pool class deployed locally; all 26 adversarial escrow cases passed with simulated facts. The production build, full application/package regression suite, 134 Cairo tests and CSP verification passed. These checks do not establish real STARK proof acceptance for this new protocol. Mainnet activation remains disabled pending real proofs, independent wallet integration and review.

The export is checked for 4,080 frames, clean audio/video decoding and the complete waveform tail of all 12 narration chapters. Every clip leaves at least 1.5 seconds after its measured voice. [Timed script](../tools/demo-video/VOICEOVER.md) · [Recording guide](../tools/demo-video/README.md) · [Implementation and evidence limits](CONFIDENTIAL_RFQ.md).

All media and temporary evidence remain under ignored `artifacts/`. The sibling voiceover, SRT and poster accompany the export. No new mainnet transactions were submitted; the three existing hashes in `strk20.json` are for the earlier public-funded-terms protocol. The public video URL remains pending.

## Mainnet settlement evidence

The Node SDK completed three swaps using real STRK20 proofs through the authenticated APP20/Starkscan relay. Each exchanged **0.01 shielded STRK for 0.001 shielded native USDC**. The operator controlled both maker and taker; these are controlled settlement tests, not independent customer trades.

| Round | Transaction | Mainnet block |
| --- | --- | --- |
| 1 | [0x1e364ca1…](https://voyager.online/tx/0x1e364ca1c778fd304fae9506dabade0f2c958e0e867465db9a7ceb0f13af36d) | 14496051 |
| 2 | [0x30f926d2…](https://voyager.online/tx/0x30f926d2eddc5361ff96b0c3c5f173d87fef227fb87d1055899f32daf221c7e) | 14496125 |
| 3 | [0x6905abc5…](https://voyager.online/tx/0x6905abc575ffb6532b566695c86194d15dfe6e26afd8ab9b47f9e4bb749a171) | 14496197 |

All three have successful included receipts, a `QuoteFilled` event, and traces calling both APP20 private settlement and the STRK20 pool. Both deployed class hashes were verified at each receipt block. A read-only recheck at 11:00 UTC on September 7 confirmed all three as `ACCEPTED_ON_L1`; see [public execution evidence](../deployments/mainnet/smoke-test-2026-09-07.json). Local viewing-key discovery independently confirmed **0.003 USDC across three shielded notes**. Public USDC did not increase during the fills.

The maker's 0.03 STRK proceeds were withdrawn, its registration deactivated, and both inventory balances checked at zero. Wallet/viewing/transport keys and quote/proof journals remain outside the repository in owner-only local storage. Public receipts and cost evidence are in [the mainnet smoke-test record](../deployments/mainnet/smoke-test-2026-09-07.json).

The 17 setup, swap and cleanup transactions cost **11.863877034965690848 STRK network fees + 24 STRK pool fees = 35.863877034965690848 STRK**. Earlier deployment plus this demo totals **63.910369825551435280 STRK**, within the 65 STRK ceiling. A separate 0.5 STRK inventory purchase yielded 0.015442 native USDC; 0.003 USDC was used by the maker and 0.012442 USDC remains public in the operator wallet.

## Historical browser rehearsal verification

- Alice/Bob Chat localnet end-to-end test passed: message delivery, attached fixed offer, and payment response. Proving is simulated on localnet. Chat offers do not guarantee atomic settlement of both assets.
- Desktop RFQ browser rehearsal passed: minimum receive enforcement, ranked preliminary replies, only one funded reservation, explicit review of price changes, settlement recovery after reload, and duplicate-attempt prevention. RPC and wallet are fixtures; cryptography is real.
- Agent SDK tests passed (8 tests), including preserving proof arguments through fee estimation and transaction submission. The production build passed.
- Captured the live public RFQ, maker, agents, and Chat pages without connecting a wallet or submitting transactions.

Recordings and edits are in the ignored `artifacts/hackathon/` folder. The prior `app20-demo-v8-confidential.mp4` is a 136-second, 1920×1080 H.264 video with Liam narration, subtitles, a compact macOS-style window, conversational Chat examples and the new local confidential escrow flow. It omits the confirmed-swaps chapter at the user's request; the mainnet evidence remains in `strk20.json` and `deployments/mainnet/`. Older edits described below are preserved locally. See `tools/demo-video/README.md` for rendering instructions.

## Required before submission

The [hackathon submission requirements](https://github.com/starkience/strk20-hackathon#strk20json) require three successful mainnet transactions through the STRK20 pool and the project's deployed contract, plus a three-minute demo video URL. Deployment transactions and localnet/fixture hashes do not satisfy this requirement.

The mainnet transaction requirement now has verified evidence. To recheck the manifest without signing or broadcasting:

```sh
node scripts/verify-hackathon-transactions.mjs --rpc https://rpc.starknet.lava.build/rpc/v0_10
```

The verifier checks mainnet, successful included receipts, a completed APP20 quote event, pool and APP20 settlement calls in traces, and pinned contract classes. It records receipt evidence; `--write` additionally updates `strk20.json`. Historical trace availability is required. Lava handled the proof-bearing transactions and traces successfully; Cartridge's trace endpoint rejected the new proof-fact version during this run. Starkscan proving worked, but its RPC write gateway reported disabled writes, so signed transactions were broadcast through Lava without provider credentials.

Replace the superseded Chat acceptance and maker onboarding scenes, review the new MP4, then publish it and fill `demo_video` with the public URL. The prior cut omits the receipt chapter; its confidential escrow footage is localnet development with simulated proving. Remote proving exposes proving payloads to the relay/proving infrastructure; this recording does not establish anonymous proving or remove that documented limitation.

## Earlier recording and voiceover (version 3)

`artifacts/hackathon/app20-demo-v3.mp4` adds locally generated narration, refreshed Chat auto-discovery footage, maker and SDK chapters, and the verified mainnet receipts. The cursor and click rings remain visible during interactions; excerpts run at normal speed with reading holds. Cuts omit setup and waiting. Offer terms, maker registration and SDK examples use closer framing.

The fresh isolated Chat localnet round passed, including message delivery, the fixed offer, and its payment response. The RFQ capture also passed. The complete export decoded without errors; chapter frames were visually reviewed. Video duration is 180 seconds, with about 21 ms of AAC/container padding. Audio measured about −16.1 LUFS with a −1.2 dBTP peak. Recovery-key screens are blurred during capture and omitted from the final edit. No new mainnet transactions were submitted to make this video.

The version-3 script (299 spoken words) is preserved in its local voiceover artifact. The MP4 contains the generated voice track and optional English subtitles. The sibling `app20-demo-v3.srt`, `app20-demo-v3-voiceover.md`, and `app20-demo-v3-poster.png` files accompany the export. Older silent cuts are preserved.

## ElevenLabs edition

`artifacts/hackathon/app20-demo-v4-elevenlabs.mp4` replaces the local voice with 13 ElevenLabs recordings using Adam — Dominant, Firm and Eleven Multilingual v2. It retains the reviewed three-minute footage and evidence, with recalculated estimated sentence subtitle timings. The previous exports remain available. Source audio, chapter durations and SHA-256 hashes are saved under `artifacts/hackathon/v4/`. No new mainnet transactions or video publication were performed for this edition.

## Liam and motion edition

`artifacts/hackathon/app20-demo-v5-liam.mp4` uses the selected Liam — Energetic, Social Media Creator voice with Eleven v3. All 13 voice chapters were regenerated. Fresh UI captures use a smaller pointer, subtle halo, softer click rings, and curved movement with smooth acceleration and deceleration. Animated opening, RFQ transition and closing segments plus short chapter fades fit within the same 180-second timeline. The fresh Chat localnet round and simulated RFQ recording passed. Earlier cuts are preserved.

Version 5 export checks: 5,400 frames at 1920×1080/30 fps, 180 seconds of video, full audio/video decode passed, approximately −16.55 LUFS and −1.38 dBTP. Selected UI and animated chapter frames were reviewed. English subtitle sentence timings are estimated.

## Shorter macOS window edit (version 6)

`artifacts/hackathon/app20-demo-v6-macos.mp4` retains the selected ElevenLabs Liam narration in a 141-second cut. Fresh recordings use a black macOS-style pointer with a white outline, smooth curved motion, and no colored halo or click rings. The UI appears inside a macOS-style browser window with neutral surroundings. Localnet Chat, simulated RFQ and verified mainnet evidence remain labelled separately.

The complete `artifacts/` directory is ignored and removed from the Git index; local files are retained. Public execution evidence remains in `deployments/mainnet/`, and the submission hashes remain in root `strk20.json`. The ignore change does not rewrite earlier Git history.

See [the indexer diagnosis](HACKATHON_INDEXER_DIAGNOSIS.md) for the hub's missing transaction indicators and [the prepared Chat evidence plan](CHAT_MAINNET_EVIDENCE_PLAN.md) for additional mainnet operations. No additional transactions have been signed or sent.

Version 6 validation: fresh Chat and RFQ captures passed; the final H.264/AAC/subtitle export decoded without errors, with 4,230 video frames at 1920×1080/30 fps. Reviewed chapter frames confirm the window framing, pointer and offer terms remain visible.

## Compact edit with repaired narration (version 7)

The version-7 export is `artifacts/hackathon/app20-demo-v7.mp4`: 131 seconds, with the confirmed-swaps chapter removed, tighter 58/110-pixel top/bottom bars, and a freshly recorded conversational Chat sample. Liam narration is preserved. Normalization and padding now run separately; padded PCM chapters are joined into a continuous master track and encoded once, avoiding timestamp gaps found in the earlier chapter audio. Each voice clip has at least 1.5 seconds of trailing silence.

The source narration was transcribed to check sentence endings. Every final audio tail matched its source with correlation at least 0.9961. The complete export decoded successfully, and revised chapter frames were reviewed. All media and review output remain in the ignored `artifacts/` folder.

## Submission fields rechecked

On September 7, 2026 at 17:26 UTC, all three root-manifest transaction receipts were SUCCEEDED and ACCEPTED_ON_L1, with events from the STRK20 pool and the declared APP20 swap contract. Both declared contract addresses resolved to the expected mainnet class hashes. GitHub's Website field was corrected to `https://app20.io`. The remaining required manifest value is a public `demo_video` URL; the prior export is local and its superseded scenes need replacement before publication.


## Organizer registry and transaction display

The [supplied organizer commit](https://github.com/starkience/strk20-hackathon/commit/1a462e9ec1ea24f7336adbcd6923edaec9fca581) updates project identity in the hackathon's `registry.json`. APP20's own `strk20.json` supplies transactions, contracts, `demo_video` and `demo_url`; adding an app-name field there does not rename the panel entry.

At the September 8 local-time check, the organizer's [registry](https://github.com/starkience/strk20-hackathon/blob/main/registry.json) still named the `gstohl/quietline` entry Quietline, while that repository redirects to `gstohl/app20`. The display name, description and repository identity therefore need an organizer registry update. This note does not claim that such an update has been merged.

The organizer's [generated project data](https://github.com/starkience/strk20-hackathon/blob/main/projects.json) already included all three hashes with `verified_txs: 3`; each passed its transaction, pool and project-contract checks, and both contracts were identified as mainnet. Its requirement flags were `demo: true`, `mainnet: true`, `video: false`. The remaining `building` status was the missing public video URL, not missing mainnet receipts. The [project builder](https://github.com/starkience/strk20-hackathon/blob/main/scripts/build-projects.mjs#L967-L1043) defines these checks. This supersedes the earlier missing-transaction diagnosis for that snapshot.

Do not replace the valid historical hashes with localnet or unverified confidential hashes. They remain honestly scoped evidence of the earlier protocol; a new confidential mainnet claim needs new real-proof evidence after its release gates pass.
