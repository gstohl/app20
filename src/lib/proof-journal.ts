import type { ProofJournal, ProofJob } from '@app20/privy/browser';
// The browser owns the encryption key. No proof payload is sent to APP20 storage.
export function browserProofJournal(scope: string): ProofJournal {
  const db = new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('app20-proof-journal',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('proofs');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  async function key(): Promise<CryptoKey> {
    const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const database=await db;
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('proofs','readwrite'),store=tx.objectStore('proofs');
      const get=store.get('key:'+scope);let result:CryptoKey;
      get.onsuccess=()=>{result=get.result ?? candidate;if(!get.result)store.put(candidate,'key:'+scope);};
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);
    });
  }
  const encryptionKey=key();
  return {
    runExclusive: async task => {
      if (!navigator.locks) throw new Error('This browser cannot coordinate proof recovery safely.');
      return await navigator.locks.request('app20-proof:'+scope, task);
    },
    async load(id) {
      const database=await db;
      const stored=await new Promise<{iv:Uint8Array;data:ArrayBuffer}|undefined>((resolve,reject)=>{
        const r=database.transaction('proofs').objectStore('proofs').get(scope+':'+id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      if(!stored)return undefined;
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:stored.iv as Uint8Array<ArrayBuffer>},await encryptionKey,stored.data);
      return JSON.parse(new TextDecoder().decode(plain)) as ProofJob;
    },
    async save(id,value) {
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey,new TextEncoder().encode(JSON.stringify(value)));
      const database=await db;
      await new Promise<void>((resolve,reject)=>{
        const tx=database.transaction('proofs','readwrite');tx.objectStore('proofs').put({iv,data},scope+':'+id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      });
    },
  };
}
