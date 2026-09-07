import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = fileURLToPath(new URL('./', import.meta.url));
await mkdir(resolve(pkg, 'dist'), { recursive: true });
const banner = { js: "import { createRequire as app20CreateRequire } from 'node:module'; const require = app20CreateRequire(import.meta.url);" };
await build({ absWorkingDir: root, entryPoints: ['packages/agent-sdk/src/index.ts'], outfile: 'packages/agent-sdk/dist/index.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['starknet'], banner, legalComments: 'inline' });
await build({ absWorkingDir: root, entryPoints: ['packages/agent-sdk/src/confidential-node.ts'], outfile: 'packages/agent-sdk/dist/confidential.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['starknet'], banner, legalComments: 'inline' });
const browser = await build({ absWorkingDir: root, entryPoints: ['packages/agent-sdk/src/confidential-browser.ts'], outfile: 'packages/agent-sdk/dist/confidential-browser.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022', external: ['starknet'], legalComments: 'inline', metafile: true });
if (Object.keys(browser.metafile.inputs).some(name => name.endsWith('/src/confidential-journal.ts')) || Object.values(browser.metafile.outputs).some(output => output.imports.some(item => item.path.startsWith('node:')))) throw Error('Browser confidential entrypoint contains a Node dependency.');
await build({ absWorkingDir: root, entryPoints: ['scripts/starknet-maker.mjs'], outfile: 'packages/agent-sdk/dist/maker.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['starknet'], banner, legalComments: 'inline' });
const temp = resolve(pkg, '.types');
try {
  execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', resolve(pkg, 'tsconfig.json'), '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--rootDir', root, '--outDir', temp], { cwd: root, stdio: 'inherit' });
  const declarations = [
    ...['index', 'types', 'privacy', 'confidential-protocol', 'confidential-journal', 'confidential-browser'].map(name => [name, `packages/agent-sdk/src/${name}.d.ts`]),
    ['confidential', 'packages/agent-sdk/src/confidential-node.d.ts'],
    ['confidential-runtime', 'packages/agent-sdk/src/confidential.d.ts'],
    ['confidential-browser-journal', 'src/lib/confidential-browser-journal.d.ts'],
  ];
  for (const [name, file] of declarations) {
    const source = resolve(temp, file);
    const text = (await readFile(source, 'utf8'))
      .replaceAll('./confidential.js', './confidential-runtime.js')
      .replaceAll('../../../src/lib/confidential-browser-journal', './confidential-browser-journal.js')
      .replaceAll('../../packages/agent-sdk/src/confidential', './confidential-runtime.js');
    if (/from ['"](?:\.\.\/|@app20\/)/.test(text)) throw Error('Declaration leaked private workspace dependency');
    await writeFile(resolve(pkg, 'dist', name + '.d.ts'), text);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Built standalone agent SDK and TypeScript declarations.');
