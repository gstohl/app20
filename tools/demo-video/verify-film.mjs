// Checks the delivered media and compares every spoken tail against its complete source mix.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const plan = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = resolve(plan.output), work = resolve(plan.workDirectory);
const chapters = JSON.parse(await readFile(resolve(work, 'chapter-timings.json'), 'utf8'));
const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
const duration = plan.clips.reduce((total, clip) => total + clip.seconds, 0);
const video = info.streams.find(s => s.codec_type === 'video');
assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.equal(video.r_frame_rate, '30/1');
assert.equal(Number(video.nb_read_frames), duration * 30);
assert(info.streams.some(s => s.codec_type === 'audio')); assert(info.streams.some(s => s.codec_type === 'subtitle'));
execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
const rate = 16000;
function pcm(file) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-sn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const delivered = pcm(output), tails = [];
for (const [index, chapter] of chapters.entries()) {
  assert(chapter.tailSeconds >= 1.5, `Chapter ${index + 1} has too little space after narration.`);
  const source = pcm(resolve(work, `${index}-voice.wav`));
  let peak = 0; for (const sample of source) peak = Math.max(peak, Math.abs(sample));
  assert(peak > .02, `Chapter ${index + 1} has no audible narration.`);
  let last = source.length - 1;
  while (last > 0 && Math.abs(source[last]) < Math.max(.004, peak * .025)) last--;
  const from = Math.max(0, last - rate), length = last - from + 1;
  const expected = Math.round(chapter.start * rate) + from;
  let sourceEnergy = 0; for (let i = 0; i < length; i++) sourceEnergy += source[from + i] ** 2;
  let best = { correlation: -1, shift: 0, energyRatio: 0 };
  // AAC/resampling can shift the waveform slightly. Search at most 25 ms.
  for (let shift = -400; shift <= 400; shift++) {
    if (expected + shift < 0 || expected + shift + length > delivered.length) continue;
    let dot = 0, energy = 0;
    for (let i = 0; i < length; i++) { const value = delivered[expected + shift + i]; dot += source[from + i] * value; energy += value * value; }
    const correlation = dot / Math.sqrt(sourceEnergy * energy || 1);
    if (correlation > best.correlation) best = { correlation, shift, energyRatio: Math.sqrt(energy / sourceEnergy) };
  }
  assert(best.correlation > .95 && best.energyRatio > .85 && best.energyRatio < 1.15, `Chapter ${index + 1} narration tail differs from its source: ${JSON.stringify(best)}`);
  tails.push({ chapter: index + 1, title: chapter.title, tailSeconds: chapter.tailSeconds, ...best });
}
const report = { file: plan.output, videoSeconds: duration, width: video.width, height: video.height, frames: Number(video.nb_read_frames), decodedWithoutErrors: true, narrationTails: tails, sha256: createHash('sha256').update(await readFile(output)).digest('hex'), newMainnetTransactions: 0 };
await writeFile(resolve(work, '../delivery-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Verified ${duration}s, ${video.nb_read_frames} frames, clean decoding and ${tails.length} complete narration tails.`);
