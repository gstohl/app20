import { loadPrivacySdk } from './sdk.js';
import type { Strk20Prover } from './prover.js';
export interface ProofJournal { runExclusive<T>(task: () => Promise<T>): Promise<T>; load(key: string): Promise<ProofJob | undefined>; save(key: string, value: ProofJob): Promise<void>; }
export interface ProofJob { idempotencyKey: string; phase: 'prepared' | 'queued' | 'polling' | 'complete'; jobId?: string; capability?: string; response?: Record<string, unknown>; }
export interface StarkscanProverOptions {
  relayUrl: string;
  accessToken: () => Promise<string>;
  journal: ProofJournal;
  submittable?: boolean;
  fetch?: typeof fetch;
  poolClassHash?: string;
}
/** HTTPS proving. Relay and upstream can read payloads; this is deliberately NOT OHTTP. */
export function starkscanProver(options: StarkscanProverOptions): Strk20Prover {
  return { kind: 'custom', submittable: options.submittable !== false, async resolve(context) {
    if (context.network !== 'mainnet') throw new Error('Starkscan proving is mainnet only.');
    if (BigInt(await context.provider.getChainId()) !== BigInt(context.chainId)) throw new Error('Proving network mismatch.');
    if (options.poolClassHash && BigInt(await context.provider.getClassHashAt(context.poolAddress)) !== BigInt(options.poolClassHash)) throw new Error('Privacy pool class mismatch.');
    const sdk = await loadPrivacySdk();
    if (!sdk.ProvingServiceProofProvider) throw new Error('Official proof provider unavailable.');
    // Reuse the SDK default invocation details/nonce logic, never its HTTP transport.
    const defaults = new sdk.ProvingServiceProofProvider(options.relayUrl, context.chainId, { nodeUrl: context.nodeUrl, poolAddress: context.poolAddress });
    const fetcher = options.fetch ?? fetch;
    let proving = false;
    return {
      getDefaultDetails: () => defaults.getDefaultDetails(),
      invalidateNonceCache: () => defaults.invalidateNonceCache(),
      async prove(invocation: { sender_address: string }, block?: unknown) {
        if (proving) throw new Error('A proof is already in progress in this session.');
        proving = true;
        try { return await options.journal.runExclusive(async () => {
          let blockId = typeof block === "number" || typeof block === "bigint" ? { block_number: Number(block) } : block;
          if (!blockId || typeof blockId === 'string') {
            const head = await context.provider.getBlockWithTxHashes('l1_accepted');
            if (!('block_hash' in head) || !head.block_hash) throw new Error('An explicit finalized proving block is required.');
            blockId = { block_hash: head.block_hash };
          }
          if (typeof blockId !== 'object') throw new Error('Invalid proving block.');
          const body = JSON.stringify({ block_id: blockId, transaction: invocation }, (_key,v)=>typeof v==='bigint'?'0x'+v.toString(16):v);
          const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
          const id = Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
          let job = await options.journal.load(id) ?? { idempotencyKey: crypto.randomUUID(), phase: 'prepared' as const };
          if (job.phase === 'polling') throw new Error('A previous proof-result delivery is uncertain. Inspect the saved job before resubmitting.');
          await options.journal.save(id,job);
          const send = async (url: string, init: RequestInit) => {
            const token = await options.accessToken();
            if (!token) throw new Error('Proof authentication expired.');
            const response = await fetcher(url,{...init,headers:{...init.headers,authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
            if (!response.ok) throw new Error(`Proving relay returned ${response.status}; preserve this job and respect provider quotas.`);
            return await response.json() as Record<string,unknown>;
          };
          let reply = job.response;
          if (!job.jobId) {
            reply = await send(options.relayUrl,{method:'POST',headers:{'content-type':'application/json','idempotency-key':job.idempotencyKey},body});
            if (typeof reply.jobId!=='string' || typeof reply.capability!=='string') throw new Error('Invalid proof job.');
            job={...job,jobId:reply.jobId,capability:reply.capability,phase:'queued',response:reply};
            await options.journal.save(id,job);
          }
          const deadline = Date.now()+20*60*1000;
          while (job.phase !== 'complete') {
            if (reply?.terminal === true) { job={...job,phase:'complete',response:reply};await options.journal.save(id,job);break; }
            if (Date.now()>deadline) throw new Error('Proof is still pending. Resume the same journal; do not create another job.');
            const delay = Number(reply?.pollAfterSeconds ?? 10);
            await new Promise(r=>setTimeout(r,Math.max(10,Number.isFinite(delay)?delay:10)*1000));
            job={...job,phase:'polling'}; await options.journal.save(id,job);
            reply=await send(`${options.relayUrl}/${encodeURIComponent(job.jobId!)}`,{method:'GET',headers:{'x-app20-proof-capability':job.capability!}});
            if (reply.jobId !== job.jobId) throw new Error('Proof job mismatch.');
            job={...job,phase:reply.terminal===true?'complete':'queued',response:reply};
            // Persist the COMPLETE one-time result before interpreting any fields.
            await options.journal.save(id,job);
          }
          const result = job.response?.result as { proof?: string; proof_facts?: string[]; l2_to_l1_messages?: {from_address:string;payload:string[]}[]; additional_data?: unknown } | undefined;
          if (job.response?.status!=='succeeded' || !result?.proof) throw new Error(`Proof not available (${String(job.response?.status)}). Do not automatically resubmit.`);
          const messages = result.l2_to_l1_messages?.filter(m=>BigInt(m.from_address)===BigInt(invocation.sender_address)) ?? [];
          if (messages.length!==1 || !Array.isArray(result.proof_facts)) throw new Error('Invalid proof output.');
          return { data:result.proof,output:messages[0]!.payload,proofFacts:result.proof_facts,additionalData:result.additional_data };
        }); } finally { proving=false; }
      },
    };
  } };
}
