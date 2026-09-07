import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = fileURLToPath(new URL('./', import.meta.url));
await mkdir(resolve(pkg, 'dist'), { recursive: true });
const banner = { js: "import { createRequire as app20CreateRequire } from 'node:module'; const require = app20CreateRequire(import.meta.url);" };
await build({ absWorkingDir: root, entryPoints: ['packages/agent-sdk/src/index.ts'], outfile: 'packages/agent-sdk/dist/index.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['starknet'], banner, legalComments: 'inline' });
await build({ absWorkingDir: root, entryPoints: ['scripts/starknet-maker.mjs'], outfile: 'packages/agent-sdk/dist/maker.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['starknet'], banner, legalComments: 'inline' });
const temp = resolve(pkg, '.types');
try {
  execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', resolve(pkg, 'tsconfig.json'), '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--rootDir', root, '--outDir', temp], { cwd: root, stdio: 'inherit' });
  for (const name of ['index', 'types', 'privacy']) {
    const source = resolve(temp, 'packages/agent-sdk/src', name + '.d.ts');
    const text = await readFile(source, 'utf8');
    if (/from ['"](?:\.\.\/|@app20\/)/.test(text)) throw Error('Declaration leaked private workspace dependency');
    await copyFile(source, resolve(pkg, 'dist', name + '.d.ts'));
  }
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Built standalone agent SDK and TypeScript declarations.');
