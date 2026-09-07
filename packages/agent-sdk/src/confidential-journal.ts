import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConfidentialJournal, ConfidentialJournalState } from './confidential.js';

/** Metadata-only journal. Keys, agreements, private invocations and proof witnesses stay in the wallet. */
export async function createConfidentialJournal(directory: string): Promise<ConfidentialJournal> {
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = resolve(dir, 'confidential-session.json'), lock = resolve(dir, 'confidential-session.lock');
  return {
    async runExclusive<T>(action: () => Promise<T>): Promise<T> {
      let handle;
      try { handle = await open(lock, 'wx', 0o600); }
      catch { throw new Error('Confidential session is locked. After a crash, verify the recorded process has exited before removing its lock.'); }
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await handle.sync(); return await action(); }
      finally { await handle.close(); await unlink(lock); }
    },
    async load() {
      try { return JSON.parse(await readFile(file, 'utf8')) as ConfidentialJournalState; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Unable to read confidential recovery journal.'); }
    },
    async save(state) {
      // Copy only public recovery metadata; never serialize arbitrary caller properties.
      const clean = { schema: state.schema, scope: state.scope, pending: state.pending && { id: state.pending.id, mode: state.pending.mode, hash: state.pending.hash }, confirmed: state.confirmed.map(item => ({ id: item.id, mode: item.mode, hash: item.hash })) };
      const temporary = resolve(dir, randomUUID() + '.next');
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(clean) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, file);
      const parent = await open(dir, 'r'); try { await parent.sync(); } finally { await parent.close(); }
    },
  };
}
