# APP20 demo recording

## Current confidential development edit (version 8)

`artifacts/hackathon/app20-demo-v8-confidential.mp4` is the current 136-second, 1080p/30 fps edit. It keeps the natural Chat conversation, selected ElevenLabs Liam voice, black macOS-style cursor, smooth movements, compact bars and macOS window frame. New chapters show the implemented local confidential escrow, separate funding, joint settlement, independent timeout recovery and updated SDK. There is no confirmed-swaps chapter. The earlier maker network is identified as a separate protocol.

The new local browser flow passed using the same SDK as the integration tests. Localnet and simulated-proof labels stay visible. Five new Liam recordings update the settlement, refund, privacy and closing narration. The renderer checks the full measured voice duration plus 0.5 seconds before and at least 1.5 seconds after every clip. It creates one continuous audio master; `verify-film.mjs` checks frame count, clean decoding and waveform correlation for every spoken ending in the delivered MP4.

```sh
npm run dev:confidential
# In another terminal:
APP20_DEMO_VIDEO=1 node scripts/e2e-confidential-browser.mjs
# After building the production app:
node tools/demo-video/capture-confidential-preview.mjs
node tools/demo-video/render-film.mjs artifacts/hackathon/v8/film-plan.json
node tools/demo-video/verify-film.mjs artifacts/hackathon/v8/film-plan.json
```

`film-plan.example.json` is the complete current edit plan, with normal-speed excerpts and end-frame reading holds. The capture chapter markers are under ignored `artifacts/hackathon/`; source timings must be rechecked after a fresh recording. The setup excerpt joins 2–6, 9–14 and 25–29 seconds; settlement joins 80.2–87.2 and 117.2–121.2; refund joins 186–192 and 214–215. Refund crops differ across the cut because the progress notice changes the viewport position. Exclude the full-page screenshot frames after the final reading hold. Download narration through the signed-in Chrome connection; preserve the chosen voice and clear the old editor text before filling a chapter.

The video, SRT, voiceover, poster, audio manifest and delivery report stay in ignored `artifacts/`. A public video URL has not been assigned, so `strk20.json` retains an empty `demo_video`. The three real mainnet transaction hashes remain evidence of the earlier deployed settlement protocol. No new mainnet transaction was submitted for version 8.

## Previous edits


The previous ElevenLabs edit is `artifacts/hackathon/app20-demo-v4-elevenlabs.mp4`: three minutes of desktop footage with ElevenLabs narration (Adam — Dominant, Firm; Eleven Multilingual v2), visible cursor and click rings, chapter captions, selectable English subtitles, and verified mainnet receipt evidence. Version 3 with local narration is preserved. Raw media and rendered outputs stay outside source control.

## Compact edit (version 7)

The version-7 plan is `artifacts/hackathon/v7/film-plan.json`, rendered to `artifacts/hackathon/app20-demo-v7.mp4`. It omits the confirmed-swaps chapter and retains the selected Liam narration. The top and bottom bars are 58 and 110 pixels high; the window content gets the recovered space. The Chat recording uses conversational sample messages rather than visible run identifiers. Non-demo tests still use unique identifiers to isolate repeated runs.

Each chapter must fit the complete measured voice file, its 0.5-second lead-in, and at least 1.5 seconds after it ends. The renderer rejects shorter timings instead of clipping speech. The version-7 review also transcribes the source narration and compares each source audio tail against the final mix.

## macOS window edition (version 6)

`artifacts/hackathon/app20-demo-v6-macos.mp4` is the shorter 141-second edit with the same selected ElevenLabs Liam narration. Fresh captures use a black, white-outlined pointer, curved easing and a small press animation, with no colored halo or click rings. Footage is framed in a macOS-style browser window on a neutral background. Short excerpts omit waits without accelerating the UI or voice.

Render with `node tools/demo-video/render-film.mjs artifacts/hackathon/v6/film-plan.json`. The renderer accepts positive durations up to 180 seconds. The entire `artifacts/` folder is ignored, including receipt rechecks; durable public transaction evidence remains under `deployments/mainnet/` and submission hashes remain in `strk20.json`.

## Liam edition (version 5)

`artifacts/hackathon/app20-demo-v5-liam.mp4` uses the user-selected Liam — Energetic, Social Media Creator voice with Eleven v3. All 13 chapters were regenerated through Chrome. Fresh Chat, RFQ and product-tour footage uses a smaller pointer, subtle orange halo, soft click rings and curved movement with smooth acceleration/deceleration. The edit adds an animated opening, a three-second RFQ transition and an animated closing, with short fades between chapters.

The 180-second plan is `artifacts/hackathon/v5/film-plan.json`. Render it with:

```sh
node tools/demo-video/render-film.mjs artifacts/hackathon/v5/film-plan.json
```

`motionOpening` delays a chapter's footage by the specified number of seconds while an animated graphic introduces it. `transitions: true` adds 0.2-second fades within the existing durations. Localnet Chat and simulated RFQ labels remain visible, and the existing verified receipt evidence is preserved. Subtitle sentence timings are estimated from measured chapter audio durations.

## ElevenLabs narration (version 4)

The 13 chapter recordings were generated and downloaded through the signed-in ElevenLabs Chrome UI. The plan is `artifacts/hackathon/v4/film-plan.json`; source MP3s and their duration/hash manifest are in `artifacts/hackathon/v4/`. Each chapter's optional `audioFile` replaces macOS speech generation. The renderer measures the imported audio, rejects overlong narration, and recalculates estimated sentence subtitle timings. RFQ, SDK and USDC were spelled out in synthesis text for pronunciation; subtitles keep the usual abbreviations.

```sh
node tools/demo-video/render-film.mjs artifacts/hackathon/v4/film-plan.json
```

Version 4 uses the reviewed version-3 footage, cuts and mainnet evidence. It does not submit new transactions or publish the video.

The film distinguishes three sources throughout: localnet Chat with mock proving, RFQ UI with simulated wallets/RPC, and read-only previews of the current production build. Its mainnet evidence chapter shows earlier real Node SDK transactions. The browser fixture confirmation is not mainnet execution evidence. Mainnet Chat remains undeployed.

## Capture

Install the pinned video dependencies with `npm ci --prefix tools/demo-video`. Rendering needs FFmpeg/ffprobe and, for the generated narration, macOS `say` with the Daniel voice. Playwright comes from the root workspace.

Run the Chat recording against a fresh localnet so old rehearsal messages do not contaminate the conversation:

```sh
APP20_DEMO_VIDEO=1 npm run test:ui -- chat.localnet.spec.ts
APP20_DEMO_VIDEO=1 node scripts/e2e-maker-browser.mjs --settlement
```

The UI runner creates an isolated localnet unless `APP20_TEST_BASE_URL` points at a caller-managed instance. Chat's Playwright video is under `test-results/playwright/`; save it as `artifacts/hackathon/v3/chat-localnet-round.webm` before another test run. Copy the RFQ recording from `artifacts/hackathon/rfq-ui-rehearsal.webm` into the same `v3` directory.

Build the current production assets with `npm run build`, then run:

```sh
node tools/demo-video/capture-film-tour.mjs
```

The tour serves the local `dist` build through the real Worker handler with its production CSP, inside an isolated browser. Requests to the APP20 origin are intercepted locally, no wallet connects, and no transactions are submitted. The recording includes RFQ, permissionless maker registration, and the Node SDK guide. It is labelled **PRODUCT PREVIEW · READ-ONLY**, not a live wallet demonstration.

`presentation.mjs` is installed only in the recording browser. It adds a visible cursor and click rings, deliberate movement and typing, smooth scrolling, reading pauses, and blurred recovery-key displays. Normal tests retain their speed and assertions. Presentation mode omits the RFQ reload/viewport checks and the Chat search/layout detour; regular tests cover those separately.

Chapter markers are saved to `artifacts/hackathon/*-chapters.json`. Inspect the new source clips and adjust edit timestamps after each recording. Exclude setup/recovery screens and inspect footage before publication.

## Verify mainnet evidence

The three submission hashes are already recorded in `strk20.json`. Recheck them without signing or broadcasting:

```sh
node scripts/verify-hackathon-transactions.mjs --rpc https://rpc.starknet.lava.build/rpc/v0_10
```

The verifier writes `artifacts/hackathon/verified-mainnet-transactions.json` after checking successful receipts, completed quote events, APP20/STRK20 execution traces, and the pinned deployed classes at each receipt block. All three were confirmed on L1 on September 7, 2026. Do not use deployment or fixture hashes as settlement proof.

## Render version 3

Copy `film-plan.example.json` to `artifacts/hackathon/v3/film-plan.json`. It contains the reviewed version-3 cuts, captions, narration, and crop coordinates. Durations total 180 seconds. `sourceSeconds` plays at normal speed; remaining chapter time holds the final frame. Labels remain visible throughout.

This edit joins Bob's typing/submission with the later confirmed state, omitting the wait at a clean cut. It also joins the RFQ confirmation click with the later simulated settled state, while the preceding review chapter holds the full funded terms. Create these excerpts from the captured videos; update the timestamps and crops if the source recordings change:

```sh
ffmpeg -y -ss 57.3 -t 11.4 -i artifacts/hackathon/v3/chat-localnet-round.webm -ss 87.85 -t 5.1 -i artifacts/hackathon/v3/chat-localnet-round.webm -filter_complex '[0:v]setpts=PTS-STARTPTS,fps=30[a];[1:v]setpts=PTS-STARTPTS,fps=30[b];[a][b]concat=n=2:v=1:a=0[out]' -map '[out]' -an -c:v libx264 -crf 18 -preset fast -threads 4 artifacts/hackathon/v3/chat-message-brief.mp4

ffmpeg -y -ss 46.3 -t 1.25 -i artifacts/hackathon/v3/rfq-ui-rehearsal.webm -ss 53.6 -t 7.5 -i artifacts/hackathon/v3/rfq-ui-rehearsal.webm -filter_complex '[0:v]crop=920:480:260:140,setpts=PTS-STARTPTS,fps=30[a];[1:v]crop=920:480:260:285,setpts=PTS-STARTPTS,fps=30[b];[a][b]concat=n=2:v=1:a=0[out]' -map '[out]' -an -c:v libx264 -crf 18 -preset fast -threads 4 artifacts/hackathon/v3/rfq-confirm-brief.mp4

node tools/demo-video/render-film.mjs artifacts/hackathon/v3/film-plan.json
```

Remotion renders `DemoFilm.tsx` chapter artwork; FFmpeg composites the captured footage and voice, then muxes English subtitles into the MP4. The renderer rejects narration that exceeds a chapter, out-of-range footage, edits exceeding 180 seconds, and receipt identities/amounts that do not match the deployment and submission manifest. Set `narrated: false` for a silent export with chapter captions and subtitles.

[VOICEOVER.md](VOICEOVER.md) contains the timed 299-word script. Version 3 generates speech locally; version 4 sends the chapter narration to ElevenLabs. Subtitle sentence timing is estimated within each measured voice segment and should be reviewed if the narration changes.

Review chapter frames and cuts, then check the complete export with `ffprobe` and a full FFmpeg decode. Version 3 has 5,400 video frames at 1920×1080/30 fps and an AAC stereo voice track. The video is 180 seconds; the MP4 container includes about 21 ms of audio padding. The final export measured approximately −16.1 LUFS with a −1.2 dBTP peak and decoded without errors.

`render-edit.mjs`, `Root.tsx`, and `video-plan.example.json` retain the earlier silent rehearsal workflow. They are not the version-3 renderer and do not include the verified mainnet chapter. Publication remains separate: upload the reviewed MP4 and put its public URL in `strk20.json`'s `demo_video` field.

Version 7 audio uses separate normalization and padding passes, then concatenates uncompressed PCM chapter audio into one master before AAC encoding. This avoids timestamp gaps observed when `loudnorm` and `adelay` shared a filter pass in FFmpeg 7.1. Each padded WAV duration is checked before rendering.
