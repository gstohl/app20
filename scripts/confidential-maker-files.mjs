// Shared private-state boundary. Keep this module independent of maker CLI entry points.
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export async function protectedMakerDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw Error('Absolute external journal directory required.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(directory), local = relative(await realpath(root), actual), stat = await lstat(directory);
  if (!local.startsWith('..' + '/') && local !== '..' || stat.isSymbolicLink() || !stat.isDirectory() || stat.mode & 0o077) throw Error('Maker journal must be a private directory outside the repository.');
  return actual;
}
