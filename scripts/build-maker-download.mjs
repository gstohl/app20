import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('public/downloads', { recursive: true });
await build({ entryPoints: ['scripts/starknet-maker.mjs'], outfile: 'public/downloads/app20-maker.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', sourcemap: false, legalComments: 'inline', banner: { js: "import { createRequire as app20CreateRequire } from 'node:module'; const require = app20CreateRequire(import.meta.url);" } });
const bytes = await readFile('public/downloads/app20-maker.mjs');
await writeFile('public/downloads/app20-maker.sha256', createHash('sha256').update(bytes).digest('hex') + '  app20-maker.mjs\n');
console.log('Built standalone Node maker download (' + bytes.length + ' bytes); no operator credentials included.');
