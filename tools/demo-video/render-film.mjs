// Produce an edit of at most three minutes from normal-speed footage and complete narration.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderStill, renderMedia, openBrowser} from '@remotion/renderer';
import {chromium} from '@playwright/test';
import {MAINNET_DEPLOYMENT} from '../../src/lib/mainnet-deployment.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(process.argv[2] ?? 'artifacts/hackathon/v3/film-plan.json', 'utf8'));
const work = resolve(plan.workDirectory ?? 'artifacts/hackathon/v3/edit');
const output = resolve(plan.output ?? 'artifacts/hackathon/app20-demo-v3.mp4');
// Optional paths are repository/cwd-relative; the historic composition remains the default.
const entryPoint = plan.entryPoint ? resolve(plan.entryPoint) : resolve(directory, 'DemoFilm.tsx');
const captureFrame = plan.captureFrame ?? {x: 96, y: 134, width: 1728, height: 804};
if (!['x', 'y', 'width', 'height'].every(key => Number.isInteger(captureFrame[key]) && captureFrame[key] % 2 === 0) ||
    captureFrame.x < 0 || captureFrame.y < 0 || captureFrame.width <= 0 || captureFrame.height <= 0 ||
    captureFrame.x + captureFrame.width > 1920 || captureFrame.y + captureFrame.height > 1080) throw Error('Capture frame must use even pixel coordinates and fit within 1920×1080.');
const sampleRate = 48000;
const leadSamples = sampleRate / 2;
const minimumTailSamples = sampleRate * 1.5;
await mkdir(work, {recursive: true});
await mkdir(dirname(output), {recursive: true});
const needsEvidence = plan.clips.some(clip => clip.kind === 'evidence');
const evidence = needsEvidence ? JSON.parse(await readFile(plan.evidenceFile, 'utf8')) : { transactions: [], verifiedAt: '1970-01-01T00:00:00Z' };
if (needsEvidence) {
const submission = JSON.parse(await readFile('strk20.json', 'utf8'));
const normalized = value => BigInt(value).toString();
if (normalized(evidence.chainId) !== normalized(MAINNET_DEPLOYMENT.chainId) || evidence.transactions?.length !== 3) throw Error('Three verified mainnet receipts are required.');
const hashes = new Set(evidence.transactions.map(receipt => receipt.hash));
if (hashes.size !== 3 || !Array.isArray(submission.transactions) || [...hashes].some(hash => !submission.transactions.includes(hash))) throw Error('Every receipt shown must be included in the submission manifest.');
for (const receipt of evidence.transactions) {
  if (!['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(receipt.finality) || !Number.isInteger(receipt.blockNumber) ||
    normalized(receipt.appContract) !== normalized(MAINNET_DEPLOYMENT.settlement.address) ||
    normalized(receipt.pool) !== normalized(MAINNET_DEPLOYMENT.settlement.pool) ||
    receipt.sellAmount !== '10000000000000000' || receipt.buyAmount !== '1000') throw Error('Unexpected receipt identity, status, or amounts.');
}
}
const duration = plan.clips.reduce((sum, clip) => sum + clip.seconds, 0);
if (!(duration > 0 && duration <= 180)) throw Error('The edit must be at most 180 seconds.');
for (const clip of plan.clips) {
  if (!clip.label || !Number.isFinite(clip.seconds) || !(clip.seconds > 0) || Math.abs(clip.seconds * 30 - Math.round(clip.seconds * 30)) > .000001 || !clip.narration) throw Error('Every chapter needs a label, a positive whole-frame duration at 30 fps, and narration text.');
  if ((!clip.kind || clip.kind === 'capture') && (!clip.file || !(clip.sourceSeconds > 0) || clip.sourceSeconds > clip.seconds)) throw Error('Capture chapters need normal-speed footage and a valid hold duration.');
}
async function run(command, args) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let error = '';
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-8000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept() : reject(Error(`${command}: ${error}`)));
  });
}
function mediaInfo(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {encoding: 'utf8'}));
}
function pcmSamples(file) {
  const stream = mediaInfo(file).streams.find(value => value.codec_type === 'audio');
  if (!stream || stream.codec_name !== 'pcm_s16le' || Number(stream.sample_rate) !== sampleRate || stream.time_base !== `1/${sampleRate}` || !Number.isSafeInteger(Number(stream.duration_ts)) || Number(stream.duration_ts) <= 0) throw Error('Narration must decode to a complete 48 kHz PCM stream.');
  return Number(stream.duration_ts);
}
const browserExecutable = chromium.executablePath();
const serveUrl = await bundle({entryPoint});
const puppeteerInstance = await openBrowser('chrome', {browserExecutable});
try {
const narrated = plan.narrated !== false;
const captions = [];
const timings = [];
let offset = 0;
const stamp = seconds => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
for (const [index, clip] of plan.clips.entries()) {
  const graphic = ['evidence', 'closing', 'intro'].includes(clip.kind);
  const animated = ['closing', 'intro'].includes(clip.kind);
  const overlay = resolve(work, `${index}-artwork.${animated ? 'mp4' : 'png'}`);
  const audio = clip.audioFile ? resolve(clip.audioFile) : resolve(work, `${index}.aiff`);
  const speech = resolve(work, `${index}.txt`);
  await writeFile(speech, clip.narration + '\n');
  let audioSeconds = 0;
  const clipFrames = Math.round(clip.seconds * 30);
  const clipSamples = clipFrames * (sampleRate / 30);
  if (narrated) {
    if (!clip.audioFile) await run('say', ['-v', plan.voice ?? 'Daniel', '-r', String(clip.voiceRate ?? 150), '-f', speech, '-o', audio]);
  }
  // Keep normalization and padding in separate passes: combining loudnorm with
  // adelay produced timestamp gaps and shortened decoded audio on FFmpeg 7.1.
  const paddedVoice = resolve(work, `${index}-voice.wav`);
  if (narrated) {
    const normalizedVoice = resolve(work, `${index}-normalized.wav`);
    await run('ffmpeg', ['-y', '-i', audio, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', normalizedVoice]);
    // Measure the fully decoded source, not an MP3/container duration estimate.
    const voiceSamples = pcmSamples(normalizedVoice);
    audioSeconds = voiceSamples / sampleRate;
    if (voiceSamples + leadSamples + minimumTailSamples > clipSamples) throw Error(`Narration exceeds chapter ${index + 1}: ${audioSeconds}s / ${clip.seconds}s. Allow the full decoded audio, 0.5s lead-in and at least 1.5s tail; the voice will not be trimmed.`);
    await run('ffmpeg', ['-y', '-i', normalizedVoice, '-af', `adelay=${leadSamples}S:all=1,apad=whole_len=${clipSamples},atrim=end_sample=${clipSamples},asetpts=N/SR/TB`, '-c:a', 'pcm_s16le', paddedVoice]);
  } else {
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(clip.seconds), '-c:a', 'pcm_s16le', paddedVoice]);
  }
  if (pcmSamples(paddedVoice) !== clipSamples) throw Error(`Chapter ${index + 1} audio sample count mismatch.`);
  const inputProps = {scene: clip, index, total: plan.clips.length, receipts: evidence.transactions, verifiedAt: evidence.verifiedAt};
  const composition = await selectComposition({serveUrl, id: 'DemoFrame', inputProps, browserExecutable, puppeteerInstance});
  if (animated) await renderMedia({serveUrl, composition: {...composition, durationInFrames: clipFrames}, inputProps, browserExecutable, puppeteerInstance, outputLocation: overlay, codec: 'h264', concurrency: 4});
  else await renderStill({serveUrl, composition: {...composition, durationInFrames: clipFrames}, inputProps, browserExecutable, puppeteerInstance, frame: (clip.motionOpening ?? 0) * 30, output: overlay, imageFormat: 'png'});
  const motion = resolve(work, `${index}-opening.mp4`);
  if (clip.motionOpening) await renderMedia({serveUrl, composition: {...composition, durationInFrames: clip.motionOpening * 30}, inputProps, browserExecutable, puppeteerInstance, outputLocation: motion, codec: 'h264', concurrency: 4});
  const args = ['-y'];
  let picture;
  if (graphic) {
    if (!animated) args.push('-loop', '1', '-framerate', '30');
    args.push('-i', overlay);
    picture = '[0:v]format=yuv420p[vout]';
  } else {
    const info = mediaInfo(resolve(clip.file));
    if ((clip.start ?? 0) + clip.sourceSeconds > Number(info.format.duration) + .05) throw Error(`Chapter ${index + 1} exceeds its source footage.`);
    args.push('-ss', String(clip.start ?? 0), '-t', String(clip.sourceSeconds), '-i', resolve(clip.file), '-i', overlay);
    const crop = clip.crop ? `crop=${clip.crop.width}:${clip.crop.height}:${clip.crop.x}:${clip.crop.y},` : '';
    picture = `[0:v]${crop}setpts=PTS-STARTPTS,fps=30,tpad=start_mode=clone:start_duration=${clip.motionOpening ?? 0}:stop_mode=clone:stop_duration=${clip.seconds},scale=${captureFrame.width}:${captureFrame.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${captureFrame.width}:${captureFrame.height}:(ow-iw)/2:(oh-ih)/2:0x101211,pad=1920:1080:${captureFrame.x}:${captureFrame.y}:0x151821,setsar=1[footage];[footage][1:v]overlay=0:0,format=yuv420p[${clip.motionOpening ? 'baseout' : 'vout'}]`;
    if (clip.motionOpening) {
      args.push('-i', motion);
      picture += ';[baseout][2:v]overlay=0:0:eof_action=pass:repeatlast=0,format=yuv420p[vout]';
    }
  }
  if (plan.transitions) {
    picture = picture.replace(/\[vout\]$/, '[picture]') + `;[picture]fade=t=in:st=0:d=0.2,fade=t=out:st=${clip.seconds - 0.2}:d=0.2[vout]`;
  }
  const audioIndex = graphic ? 1 : clip.motionOpening ? 3 : 2;
  args.push('-i', paddedVoice);
  args.push('-filter_complex', `${picture};[${audioIndex}:a]anull[aout]`, '-map', '[vout]', '-map', '[aout]', '-frames:v', String(clipFrames), '-t', String(clip.seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', resolve(work, `${index}.mp4`));
  await run('ffmpeg', args);
  const sentences = clip.narration.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clip.narration];
  const totalWords = sentences.reduce((sum, sentence) => sum + sentence.trim().split(/\s+/).length, 0);
  const spokenSeconds = audioSeconds || clip.seconds - 1;
  let captionAt = offset + .5;
  for (const sentence of sentences) {
    const seconds = spokenSeconds * sentence.trim().split(/\s+/).length / totalWords;
    captions.push(`${captions.length + 1}\n${stamp(captionAt)} --> ${stamp(captionAt + seconds)}\n${sentence.trim()}\n`);
    captionAt += seconds;
  }
  timings.push({title: clip.title, start: offset, end: offset + clip.seconds, voiceSeconds: audioSeconds, voiceStart: offset + 0.5, voiceEnd: offset + 0.5 + audioSeconds, tailSeconds: clip.seconds - 0.5 - audioSeconds});
  offset += clip.seconds;
  console.log(`Rendered ${index + 1}/${plan.clips.length}: ${clip.title} (${clip.seconds}s, voice ${audioSeconds.toFixed(1)}s)`);
}
await writeFile(resolve(work, 'concat.txt'), plan.clips.map((_, index) => `file '${index}.mp4'`).join('\n'));
const audioConcat = resolve(work, 'audio-concat.txt');
const masterAudio = resolve(work, 'narration.wav');
await writeFile(audioConcat, plan.clips.map((_, index) => `file '${index}-voice.wav'`).join('\n'));
await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', audioConcat, '-c:a', 'pcm_s16le', masterAudio]);
const expectedSamples = plan.clips.reduce((sum, clip) => sum + Math.round(clip.seconds * 30) * (sampleRate / 30), 0);
if (pcmSamples(masterAudio) !== expectedSamples) throw Error('Complete narration master has an unexpected sample count.');
const subtitleFile = output.replace(/\.mp4$/, '.srt');
await writeFile(subtitleFile, captions.join('\n'));
await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', resolve(work, 'concat.txt'), '-i', masterAudio, '-i', subtitleFile, '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English captions', '-disposition:s:0', '0', '-t', String(duration), '-movflags', '+faststart', output]);
await writeFile(resolve(work, 'chapter-timings.json'), JSON.stringify(timings, null, 2) + '\n');
console.log(output);
} finally { await puppeteerInstance.close({silent: true}); }
