# APP20 demo recording

Use `APP20_DEMO_VIDEO=1 npm run test:ui -- tests/ui/chat.localnet.spec.ts` for a real localnet Chat rehearsal. Use `APP20_DEMO_VIDEO=1 node scripts/e2e-maker-browser.mjs --settlement` for the RFQ browser fixture rehearsal. The latter uses mocked RPC/wallets and must never be described as a mainnet trade.

Capture the public pages with `node tools/demo-video/capture-tour.mjs` (fresh browser, no wallet).

Install the pinned video dependencies with `npm ci --prefix tools/demo-video`. Render the paced edit with `node tools/demo-video/render-edit.mjs artifacts/hackathon/video-plan.json`. Copy `tools/demo-video/video-plan.example.json` to `artifacts/hackathon/video-plan.json` after capturing the referenced clips. The plan contains clips with file, title, caption, label, seconds, sourceSeconds and optional start/crop fields; durations must total 180 seconds. Keep raw footage outside source control, inspect it for keys/recovery material, and label every localnet or fixture segment.

Mainnet proof is separate: `node scripts/verify-hackathon-transactions.mjs HASH1 HASH2 HASH3 --write` checks successful included receipts, actual STRK20 and APP20 settlement calls in traces, and pinned deployed classes before updating `strk20.json`. Never put demo or deployment transaction hashes in the proof list.

## Paced demo and narration

[VOICEOVER.md](VOICEOVER.md) contains the timed three-minute narration (343 spoken words), visual cues, and recording notes. It is a script; the video does not contain a recorded voice track.

Recording mode installs `presentation.mjs` only in the isolated Playwright browser. It draws a visible cursor and click rings, moves deliberately, types short inputs, scrolls smoothly to controls, and pauses between actions. Normal test runs keep their original speed and assertions. Presentation mode omits the RFQ reload/viewport checks and the Chat search/layout detour; run normal tests separately for those checks.

Chapter timestamps are saved to `artifacts/hackathon/*-chapters.json`. The revised edit uses normal-speed excerpts and held end frames, never accelerated footage. Each edit clip has `start`, `sourceSeconds`, and `seconds` (including the end hold). Run `node tools/demo-video/render-edit.mjs artifacts/hackathon/video-plan.json` to render `artifacts/hackathon/app20-demo-v2.mp4`. Remotion renders the chapter artwork; FFmpeg composites it over the recordings. Review the exported frames before sharing.
