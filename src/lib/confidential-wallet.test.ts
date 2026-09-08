import { describe, expect, it, vi } from 'vitest';
import { ec, hash, type TypedData } from 'starknet';
import { createConfidentialAgreement, confidentialDigest, domain, verifyConfidentialApproval, type ConfidentialPrepared, type ConfidentialSubmission } from '../../packages/agent-sdk/src/confidential';
import { createReadyConfidentialProofSession, createReadyConfidentialWallet, openConfidentialEscrowIdentity } from './confidential-wallet';
import { MAINNET_DEPLOYMENT } from './mainnet-deployment';
import { CONFIDENTIAL_RFQ_CONTRACT } from './confidential-rfq-deployment';
const seams = vi.hoisted(() => ({ options: undefined as any, journal: {}, proof: { getDefaultDetails: async () => ({}), prove: async () => ({}) } }));
vi.mock('@app20/privy/browser', () => ({ starkscanProver: () => ({ resolve: async () => seams.proof }) }));
vi.mock('./proof-journal', () => ({ browserProofJournal: () => ({}) }));
vi.mock('./confidential-browser-journal', async original => ({ ...await original<typeof import('./confidential-browser-journal')>(), createBrowserConfidentialJournal: () => seams.journal }));
vi.mock('../../packages/agent-sdk/src/confidential', async original => ({ ...await original<typeof import('../../packages/agent-sdk/src/confidential')>(), createConfidentialClient: async (options: any) => {
  seams.options = options;
  return { agreement: options.agreement, inspect: async () => ({}), prepare: async () => ({}), reconcile: async () => {}, approve: async (_prepared: unknown, _role: unknown, sign: () => unknown) => sign(), execute: async (submission: unknown) => options.submit(submission), fund: async (_role: unknown, transfer: (payment: unknown) => unknown) => transfer({ token: options.agreement.terms.tokenA, recipient: options.agreement.address, amount: options.agreement.terms.amountA }) };
} }));
const memory = () => { let bytes: Uint8Array<ArrayBuffer> | undefined; return { load: async () => bytes && new Uint8Array(bytes), save: async (next: Uint8Array) => { bytes = new Uint8Array(next); } }; };
const exclusive = async <T>(work: () => Promise<T>) => work();
function agreement(signerA: string) { return createConfidentialAgreement({ chainId: MAINNET_DEPLOYMENT.chainId, pool: MAINNET_DEPLOYMENT.settlement.pool, poolClassHash: MAINNET_DEPLOYMENT.settlement.poolClassHash, escrowClassHash: CONFIDENTIAL_RFQ_CONTRACT.classHash, address: '0x1234', signerA, signerB: ec.starkCurve.getStarkKey('0x987654'), deadline: 1_900_000_000, terms: { tokenA: MAINNET_DEPLOYMENT.sellToken.address, tokenB: MAINNET_DEPLOYMENT.buyToken.address, amountA: '100', amountB: '200', partyA: '0x123', partyB: '0x456', salt: '0x789' } }); }
function prepared(a: ReturnType<typeof agreement>): ConfidentialPrepared {
  const inner = [a.address, '0x12345', '2', '0', '0', '9', a.address, '2', '0x12345', '0', '0'];
  return { agreement: a, mode: 'setup', digest: confidentialDigest(a, 'setup', inner), invocation: { sender_address: a.pool, calldata: ['1', a.pool, hash.getSelectorFromName('compile_actions'), String(inner.length), ...inner], signature: [] } };
}
describe('independent browser escrow signing', () => {
  it('persists one role identity and immutable agreement, without returning its private key', async () => {
    const store = memory(), identity = await openConfidentialEscrowIdentity({ scope: '0x1/0x2/0x3', store, runExclusive: exclusive });
    const reopened = await openConfidentialEscrowIdentity({ scope: '0x1/0x2/0x3', store, runExclusive: exclusive });
    expect(reopened.publicKey).toBe(identity.publicKey);
    expect(Object.keys(identity)).not.toContain('key');
    const a = agreement(identity.publicKey);
    await identity.bind(a, 'a', 0x12345n);
    expect((await reopened.restore())?.agreement).toEqual(a);
    await expect(identity.bind(a, 'b', 0x12345n)).rejects.toThrow(/independent signing identity/);
    await expect(identity.bind(a, 'a', 0x54321n)).rejects.toThrow(/already bound/);
    const other = createConfidentialAgreement({ ...a, terms: { ...a.terms, amountB: '201' } });
    await expect(identity.bind(other, 'a', 0x12345n)).rejects.toThrow(/already bound/);
    await expect(identity.approve(prepared(other))).rejects.toThrow(/another escrow/);
    const operation = prepared(a), approval = await identity.approve(operation);
    expect(approval.role).toBe('a');
    expect(verifyConfidentialApproval(a, operation.digest, approval)).toBe(true);
    await expect(identity.approve(operation, () => { throw new Error('Wallet changed'); })).rejects.toThrow(/Wallet changed/);
    // Invalid private operations cannot reach the signature callback.
    const beforeSign = vi.fn();
    const invalid = prepared(a); (invalid.invocation.calldata as string[])[2] = '0x1';
    await expect(identity.approve(invalid, beforeSign)).rejects.toThrow(/compile on the pinned pool/);
    expect(beforeSign).not.toHaveBeenCalled();
  });
});
describe('Ready service authentication', () => {
  it('shares concurrent authentication and signs a service-only purpose', async () => {
    let time = 1_800_000_000_000;
    const wallet = { address: '0x123', signMessage: vi.fn(async (_data: TypedData) => ['0x1', '0x2']) };
    const fetcher = vi.fn(async (_url, init) => { const { claim } = JSON.parse(String(init.body)); return Response.json({ token: 'app20-ready-proof-v1.test.mac', expiresAt: claim.expiresAt, account: claim.account, origin: claim.origin }); });
    const session = createReadyConfidentialProofSession({ wallet: wallet as never, assertCurrent: () => {}, origin: 'https://app20.io', fetch: fetcher as typeof fetch, now: () => time });
    const tokens = await Promise.all([session.accessToken(), session.accessToken()]);
    expect(tokens[0]).toBe(tokens[1]); expect(wallet.signMessage).toHaveBeenCalledTimes(1);
    expect(wallet.signMessage.mock.calls[0]?.[0]).toMatchObject({ message: { purpose: 'Authenticate confidential trading and proving', account: '0x123', origin: 'https://app20.io' }, domain: { name: 'APP20 Proof Session', chainId: 'SN_MAIN', revision: '1' } });
    await session.accessToken(); expect(fetcher).toHaveBeenCalledTimes(1);
    time += 850_000;
    await session.accessToken(); expect(wallet.signMessage).toHaveBeenCalledTimes(2);
  });
  it('cancels a changed wallet before sending its signed service claim', async () => {
    let changed = false;
    const fetcher = vi.fn();
    const session = createReadyConfidentialProofSession({ wallet: { address: '0x123', signMessage: async () => { changed = true; return ['0x1', '0x2']; } } as never, assertCurrent: () => { if (changed) throw new Error('Account changed'); }, origin: 'https://app20.io', fetch: fetcher });
    await expect(session.accessToken()).rejects.toThrow(/Account changed/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('Ready confidential wallet boundary', () => {
  it('forwards exact proof fields and only one encrypted funding transfer, with account drift fenced', async () => {
    const identity = await openConfidentialEscrowIdentity({ scope: '0x1/0x2/0x3', store: memory(), runExclusive: exclusive }), a = agreement(identity.publicKey);
    let changed = false;
    let fee = 6n * 10n ** 18n;
    let allowance = 0n, changeDuringRead = false;
    const provider = { callContract: async ({ entrypoint }: { entrypoint: string }) => { if (changeDuringRead) changed = true; return entrypoint === 'allowance' ? [`0x${allowance.toString(16)}`, '0x0'] : [`0x${fee.toString(16)}`]; } };
    const executeWithProof = vi.fn(async () => ({ transaction_hash: '0xabc' })), strk20InvokeTransaction = vi.fn(async () => ({ transaction_hash: '0xdef' }));
    const wallet = await createReadyConfidentialWallet({ agreement: a, role: 'a', viewingKey: 0x12345n, identity, provider: provider as never, wallet: { address: '0x123', executeWithProof, strk20InvokeTransaction } as never, assertCurrent: () => { if (changed) throw new Error('Account changed'); }, proofSession: { accessToken: async () => 'token', reauthenticate: async () => 'token' }, origin: 'https://app20.io' });
    const submission: ConfidentialSubmission = { call: { contractAddress: a.pool, entrypoint: 'apply_actions', calldata: ['0', '1'] }, proof: { data: 'TEST_PROOF_BYTES', output: [a.poolClassHash, '0'], proofFacts: [domain('PROOF1')] } };
    await (wallet.execute as unknown as (value: unknown) => Promise<unknown>)(submission);
    expect(executeWithProof).toHaveBeenCalledWith([{ contractAddress: MAINNET_DEPLOYMENT.sellToken.address, entrypoint: 'approve', calldata: [a.pool, `0x${fee.toString(16)}`, '0x0'] }, submission.call], { data: 'TEST_PROOF_BYTES', output: [...submission.proof.output], proof_facts: [...submission.proof.proofFacts] });
    allowance = fee;
    await (wallet.execute as unknown as (value: unknown) => Promise<unknown>)(submission);
    expect(executeWithProof).toHaveBeenLastCalledWith([submission.call], expect.any(Object));
    await wallet.fund();
    expect(strk20InvokeTransaction).toHaveBeenCalledWith([{ type: 'transfer', token: a.terms.tokenA, recipient: a.address, amount: '0x64' }]);
    changeDuringRead = true;
    await expect((wallet.execute as unknown as (value: unknown) => Promise<unknown>)(submission)).rejects.toThrow(/Account changed/);
    await expect(wallet.fund()).rejects.toThrow(/Account changed/);
    await expect((wallet.execute as unknown as (value: unknown) => Promise<unknown>)(submission)).rejects.toThrow(/Account changed/);
    expect(executeWithProof).toHaveBeenCalledTimes(2); expect(strk20InvokeTransaction).toHaveBeenCalledTimes(1);
    changed = false; changeDuringRead = false; fee = 11n * 10n ** 18n;
    await expect((wallet.execute as unknown as (value: unknown) => Promise<unknown>)(submission)).rejects.toThrow(/fee exceeds/);
    expect(executeWithProof).toHaveBeenCalledTimes(2);
  });
});
