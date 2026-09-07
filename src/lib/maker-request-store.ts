import type { ExecutableMakerAnswer } from '@app20/private-intents/private-settlement';
import type { MakerAnswer, MakerScope, MakerTerms } from '@app20/private-intents/starknet-maker';
export type SavedMakerRequest = { scope: MakerScope; terms: MakerTerms; replyKey: CryptoKeyPair; status: 'prepared' | 'submitted'; comparisonId?: string; stage?: 'comparison' | 'reservation'; indicativeAnswer?: MakerAnswer; replyRejected?: boolean; expectedBuyAmount?: string; transactionHash?: string; settlementSecret?: string; executableAnswer?: ExecutableMakerAnswer; settlementAttempt?: { status: 'prepared' | 'submitted' | 'confirmed' | 'reverted'; transactionHash?: string } };
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('app20-independent-makers-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('requests', { keyPath: 'scope.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot open quote recovery storage.'));
  });
}
export async function saveMakerRequest(value: SavedMakerRequest): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('requests', 'readwrite');
      const store = tx.objectStore('requests');
      const get = store.get(value.scope.id);
      get.onsuccess = () => {
        const current = get.result as SavedMakerRequest | undefined;
        // A quote refresh from another tab must not erase a settlement fence.
        const preserveAttempt = current?.settlementAttempt && (!value.settlementAttempt || current.settlementAttempt.status === 'confirmed' || (current.settlementAttempt.transactionHash && value.settlementAttempt.status === 'prepared'));
        store.put(preserveAttempt ? { ...value, settlementAttempt: current!.settlementAttempt } : value);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('Cannot save quote recovery. No new request should be sent.'));
    });
  } finally { db.close(); }
}
export async function loadMakerRequests(): Promise<SavedMakerRequest[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('requests', 'readonly');
      const request = tx.objectStore('requests').getAll();
      request.onsuccess = () => resolve(request.result as SavedMakerRequest[]);
      request.onerror = () => reject(new Error('Cannot load quote recovery.'));
    });
  } finally { db.close(); }
}

/** IndexedDB serializes this read/write transaction across tabs. */
export async function beginMakerSettlement(id: string): Promise<SavedMakerRequest> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('requests', 'readwrite');
      const store = tx.objectStore('requests');
      const get = store.get(id);
      let updated: SavedMakerRequest | undefined;
      get.onsuccess = () => {
        const row = get.result as SavedMakerRequest | undefined;
        if (!row?.executableAnswer || !row.settlementSecret || (row.settlementAttempt && row.settlementAttempt.status !== 'reverted')) { tx.abort(); return; }
        updated = { ...row, settlementAttempt: { status: 'prepared' } };
        store.put(updated);
      };
      tx.oncomplete = () => updated ? resolve(updated) : reject(new Error('Quote recovery is missing.'));
      tx.onabort = tx.onerror = () => reject(new Error('This quote already has a settlement attempt, or recovery storage is unavailable. Check its status before retrying.'));
    });
  } finally { db.close(); }
}

/** Claim the single funded child before signing. Uncertain submissions remain fenced. */
export async function saveMakerBatch(rows: SavedMakerRequest[], reserveComparison?: string): Promise<void> {
  if (!rows.length || rows.length > 5 || (reserveComparison && (rows.length !== 1 || rows[0]?.comparisonId !== reserveComparison || rows[0]?.stage !== 'reservation'))) throw new Error('Invalid quote request batch.');
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('requests', 'readwrite');
      const store = tx.objectStore('requests');
      const get = store.getAll();
      get.onsuccess = () => {
        const existing = get.result as SavedMakerRequest[];
        if (reserveComparison && existing.some(row => (row.comparisonId === reserveComparison && row.stage === 'reservation') || (row.scope.taker === rows[0]?.scope.taker && row.scope.book === rows[0]?.scope.book && row.scope.chainId === rows[0]?.scope.chainId && ((row.settlementAttempt?.status === 'prepared' || row.settlementAttempt?.status === 'submitted') || (row.stage === 'reservation' && row.scope.expiresAt > Math.floor(Date.now() / 1000) && row.settlementAttempt?.status !== 'confirmed'))))) { tx.abort(); return; }
        for (const row of rows) store.add(row);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('This comparison already has a reservation attempt, or storage is unavailable. Check its records before retrying.'));
    });
  } finally { db.close(); }
}
