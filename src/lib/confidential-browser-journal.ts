import type { ConfidentialJournal, ConfidentialJournalState } from '../../packages/agent-sdk/src/confidential';

const DATABASE = 'app20-confidential-sessions';
const DOMAIN = 'app20/confidential-browser-secrets/v1';
const FIELD = 2n ** 251n + 17n * 2n ** 192n + 1n;
const MODES = new Set(['setup', 'settle', 'refundA', 'refundB', 'fundA', 'fundB']);
let databasePromise: Promise<IDBDatabase> | undefined;

function felt(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0x[\da-fA-F]+|\d+)$/.test(value)) throw new Error('Invalid confidential recovery identity.');
  const n = BigInt(value);
  if (n <= 0n || n >= FIELD) throw new Error('Invalid confidential recovery identity.');
  return `0x${n.toString(16)}`;
}
function normalizeScope(scope: string): string {
  if (typeof scope !== 'string' || scope.length > 256 || scope.split('/').length !== 3) throw new Error('A chain/escrow/commitment scope is required.');
  return scope.split('/').map(felt).join('/');
}
function locks(): LockManager {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('This browser cannot coordinate confidential recovery safely.');
  return navigator.locks;
}
function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Confidential recovery requires persistent browser storage.'));
    const request = indexedDB.open(DATABASE, 1);
    let abandoned = false;
    request.onupgradeneeded = () => {
      for (const name of ['metadata', 'secrets', 'keys']) request.result.createObjectStore(name);
    };
    request.onerror = () => { abandoned = true; reject(new Error('Unable to open confidential recovery storage.')); };
    request.onblocked = () => { abandoned = true; reject(new Error('Close older APP20 tabs before updating confidential recovery storage.')); };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  });
  databasePromise.catch(() => { databasePromise = undefined; });
  return databasePromise;
}
async function readRecord(store: string, scope: string): Promise<unknown> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(scope);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error('Unable to read confidential recovery storage.'));
  });
}
async function writeRecord(store: string, scope: string, value: unknown): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite', { durability: 'strict' });
    tx.objectStore(store).put(value, scope);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('Unable to persist confidential recovery state.'));
  });
}
function cleanState(value: ConfidentialJournalState, scope: string): ConfidentialJournalState {
  if (!value || value.schema !== 'app20/confidential-journal/v1' || normalizeScope(value.scope) !== scope || !Array.isArray(value.confirmed) || value.confirmed.length > 10_000) throw new Error('Confidential journal does not match this session.');
  const attempt = (item: NonNullable<ConfidentialJournalState['pending']>) => {
    if (!item || !MODES.has(item.mode)) throw new Error('Invalid confidential recovery operation.');
    return { id: felt(item.id), mode: item.mode, ...(item.hash === undefined ? {} : { hash: felt(item.hash) }) };
  };
  // Project only public metadata. Caller-added agreements, keys and witnesses cannot leak here.
  return { schema: 'app20/confidential-journal/v1', scope, ...(value.pending ? { pending: attempt(value.pending) } : {}), confirmed: value.confirmed.map(attempt) };
}

/** Keep the entire inspect/prepare/broadcast/reconcile sequence inside runExclusive. */
export function createBrowserConfidentialJournal(rawScope: string): ConfidentialJournal {
  const scope = normalizeScope(rawScope);
  locks();
  return {
    runExclusive: async task => await locks().request(`app20-confidential:${scope}`, { mode: 'exclusive' }, task),
    async load() {
      const state = await readRecord('metadata', scope);
      return state === undefined ? undefined : cleanState(state as ConfidentialJournalState, scope);
    },
    async save(state) {
      const snapshot = cleanState(state, scope); // Own inputs before awaiting storage.
      await writeRecord('metadata', scope, snapshot);
    },
  };
}

type SealedSecret = { version: 1; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
export interface ConfidentialBrowserSecretStore {
  /** Plaintext is returned only to the caller's wallet adapter; never to the public journal. */
  load(): Promise<Uint8Array<ArrayBuffer> | undefined>;
  save(payload: Uint8Array): Promise<void>;
}
function validKey(value: unknown): value is CryptoKey {
  return value instanceof CryptoKey && value.type === 'secret' && !value.extractable && value.algorithm.name === 'AES-GCM' && (value.algorithm as AesKeyAlgorithm).length === 256 && value.usages.includes('encrypt') && value.usages.includes('decrypt');
}
async function secretKey(scope: string): Promise<CryptoKey> {
  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['keys', 'secrets'], 'readwrite', { durability: 'strict' });
    const key = tx.objectStore('keys').get(scope), existing = tx.objectStore('secrets').get(scope);
    let result: CryptoKey;
    const finish = () => {
      if (key.readyState !== 'done' || existing.readyState !== 'done') return;
      if (key.result === undefined && existing.result === undefined) {
        result = candidate;
        tx.objectStore('keys').put(candidate, scope);
      } else if (validKey(key.result)) result = key.result;
      else tx.abort(); // Never replace a missing key while encrypted recovery material exists.
    };
    key.onsuccess = existing.onsuccess = finish;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(new Error('Confidential recovery encryption key is unavailable. Restore wallet recovery material before continuing.'));
  });
}
/** Separate encrypted wallet material. Browser storage is local persistence, not an external backup. */
export function createBrowserConfidentialSecretStore(rawScope: string): ConfidentialBrowserSecretStore {
  const scope = normalizeScope(rawScope);
  locks();
  const aad = new TextEncoder().encode(`${DOMAIN}\0${scope}`);
  const exclusive = async <T>(task: () => Promise<T>): Promise<T> => await locks().request(`app20-confidential-secrets:${scope}`, { mode: 'exclusive' }, task);
  return {
    load: () => exclusive(async () => {
      const stored = await readRecord('secrets', scope) as SealedSecret | undefined;
      if (stored === undefined) return undefined;
      if (stored.version !== 1 || !(stored.iv instanceof Uint8Array) || stored.iv.length !== 12 || !(stored.ciphertext instanceof ArrayBuffer)) throw new Error('Confidential recovery ciphertext is invalid.');
      const key = await secretKey(scope);
      try {
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv, additionalData: aad }, key, stored.ciphertext);
        return new Uint8Array(plaintext);
      } catch { throw new Error('Confidential recovery material could not be authenticated.'); }
    }),
    async save(payload) {
      if (!(payload instanceof Uint8Array) || payload.byteLength === 0 || payload.byteLength > 1_048_576) throw new Error('Confidential wallet material must be a bounded byte array.');
      const snapshot = new Uint8Array(payload);
      await exclusive(async () => {
        const key = await secretKey(scope), iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, snapshot);
        await writeRecord('secrets', scope, { version: 1, iv, ciphertext } satisfies SealedSecret);
      });
    },
  };
}
