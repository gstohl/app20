import { CallData, ec, hash, type Call, type RpcProvider } from 'starknet';
import { loadPrivacySdk, loadPrivacyPoolAbi } from '../../privy/src/sdk';
import { contractDiscovery } from '../../privy/src/discovery';
import { MAINNET_DEPLOYMENT } from '../../../src/lib/mainnet-deployment';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../../../src/lib/confidential-rfq-deployment';
import { CONFIDENTIAL_RFQ_STATUS } from '../../../src/lib/confidential-rfq-status';
import {
  CONFIDENTIAL_MODES, approveConfidentialOperation, authorizeConfidentialOperation, confidentialConstructor, confidentialDigest,
  confidentialFelt, confidentialInner, confidentialTermsFelts, domain, normalizeConfidentialAgreement,
  poseidon, reviewConfidentialOperation, sameFelt,
} from './confidential-protocol.js';
import type { ConfidentialAgreement, ConfidentialApproval, ConfidentialInvocation, ConfidentialMode, ConfidentialPrepared, ConfidentialReview, ConfidentialRole } from './confidential-protocol.js';
export * from './confidential-protocol.js';
export { createConfidentialJournal } from './confidential-journal.js';
export const confidentialCapabilities = CONFIDENTIAL_RFQ_STATUS;
export const confidentialContract = Object.freeze({ ...CONFIDENTIAL_RFQ_CONTRACT });

export type ConfidentialProof = Readonly<{ data?: string; output: readonly string[]; proofFacts: readonly string[]; additionalData?: unknown }>;
export type ConfidentialSubmission = Readonly<{ call: Call; proof: ConfidentialProof }>;
export type ConfidentialAttempt = { id: string; mode: ConfidentialMode | 'fundA' | 'fundB'; hash?: string };
export type ConfidentialJournalState = { schema: 'app20/confidential-journal/v1'; scope: string; pending?: ConfidentialAttempt; confirmed: ConfidentialAttempt[] };
export interface ConfidentialJournal {
  runExclusive<T>(action: () => Promise<T>): Promise<T>;
  load(): Promise<ConfidentialJournalState | undefined>;
  save(state: ConfidentialJournalState): Promise<void>;
}
export interface ConfidentialProofProvider {
  getDefaultDetails(): Promise<unknown>;
  prove(invocation: unknown, block?: unknown): Promise<ConfidentialProof>;
}
export interface ConfidentialClientOptions {
  agreement: ConfidentialAgreement;
  provider: RpcProvider;
  /** Escrow-only material, supplied by the owning wallet's secure key provider. */
  viewingKeyProvider: { getViewingKey(): Promise<bigint> };
  proofProvider: ConfidentialProofProvider;
  journal: ConfidentialJournal;
  /** Receives only the public pool call and proof. Apply explicit fee budgets in this adapter. */
  submit: (submission: ConfidentialSubmission) => Promise<{ transaction_hash: string }>;
  discovery?: { resolve(context: { provider: RpcProvider; poolAddress: string }): Promise<unknown> };
  /** Accepted exclusively on a loopback devnet. Never enables a public network. */
  simulatedProofs?: boolean;
}
export type ConfidentialSnapshot = Readonly<{ block: number; timestamp: number; settled: boolean; registered: boolean; balanceA: string; balanceB: string; status: 'setup' | 'funding' | 'ready' | 'settled' | 'refundable' | 'closed'; pending?: ConfidentialAttempt }>;
type RuntimeToken = { setup(recipient: string): RuntimeToken; surplusTo(recipient: string, withdraw: boolean): RuntimeToken; transfer(value: { recipient: string; amount: bigint }): RuntimeToken };
type RuntimeBuilder = { register(): RuntimeBuilder; setup(recipient: string): RuntimeBuilder; with(token: string, fn: (token: RuntimeToken) => void): RuntimeBuilder; computeAndInvoke(fn: () => unknown): RuntimeBuilder; createProofInvocation(): Promise<{ invocation: ConfidentialInvocation }> };
type RuntimeTransfers = { build(options: Record<string, unknown>): RuntimeBuilder; discoverNotes(options: { tokens: bigint[] }): Promise<{ notes: Map<string | bigint, { amount: bigint; open?: boolean }[]> }> };

const DEV_POOL_CLASS = '0x7af31b00093e5ba2d51a0bd68b5cb4ef3b011af349ade4bb6aa3dbb108f153c';
// Pinned with the SDK's proof-facts format; changing this requires protocol review.
const VIRTUAL_PROGRAM_HASH = '0x3e98c2d7703b03a7edb73ed7f075f97f1dcbaa8f717cdf6e1a57bf058265473';
const scopeOf = (a: ConfidentialAgreement) => `${a.chainId}/${a.address}/${a.commitment}`;
function safeError(message: string): never { throw new Error(message); }
export async function inspectConfidentialDeployment(provider: RpcProvider, agreement: ConfidentialAgreement) {
  const a = normalizeConfidentialAgreement(agreement);
  if (a.address === '0x0' || !sameFelt(a.escrowClassHash, CONFIDENTIAL_RFQ_CONTRACT.classHash)) throw new Error('Unreviewed or undeployed confidential escrow.');
  const [chain, poolClass, accountClass, config, state, block] = await Promise.all([
    provider.getChainId(), provider.getClassHashAt(a.pool), provider.getClassHashAt(a.address),
    provider.callContract({ contractAddress: a.address, entrypoint: 'configuration', calldata: [] }),
    provider.callContract({ contractAddress: a.address, entrypoint: 'is_settled', calldata: [] }), provider.getBlockWithTxHashes('latest'),
  ]);
  if (!sameFelt(chain, a.chainId) || !sameFelt(poolClass, a.poolClassHash) || !sameFelt(accountClass, a.escrowClassHash)) throw new Error('Chain or contract identity changed.');
  const expected = confidentialConstructor(a);
  if (config.length !== expected.length || config.some((value, i) => !sameFelt(value, expected[i]!))) throw new Error('Escrow configuration differs from the agreement.');
  if (state.length !== 1 || ![0n, 1n].includes(BigInt(state[0]!)) || !('block_number' in block)) throw new Error('Invalid escrow state.');
  return { block: block.block_number, timestamp: block.timestamp, settled: BigInt(state[0]!) === 1n };
}

export async function createConfidentialClient(options: ConfidentialClientOptions) {
  const a = normalizeConfidentialAgreement(options.agreement), provider = options.provider;
  const chain = await provider.getChainId();
  if (sameFelt(chain, MAINNET_DEPLOYMENT.chainId) || sameFelt(a.chainId, MAINNET_DEPLOYMENT.chainId)) throw new Error('Confidential RFQ mainnet activation awaits real proofs and independent review.');
  if (!sameFelt(chain, a.chainId)) throw new Error('Wrong confidential RFQ network.');
  if (options.simulatedProofs) {
    const url = (provider as unknown as { channel?: { nodeUrl?: string } }).channel?.nodeUrl;
    if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Simulated proofs are confined to loopback devnet.');
  }
  if (![MAINNET_DEPLOYMENT.settlement.poolClassHash, ...(options.simulatedProofs ? [DEV_POOL_CLASS] : [])].some(value => sameFelt(value, a.poolClassHash))) throw new Error('Unreviewed pool class.');
  await inspectConfidentialDeployment(provider, a);
  const viewingKey = await options.viewingKeyProvider.getViewingKey();
  if (viewingKey <= 0n || viewingKey > ec.starkCurve.CURVE.n / 2n) throw new Error('Canonical escrow viewing material required.');
  const sdk = await loadPrivacySdk();
  const discoveryProvider = await (options.discovery ?? contractDiscovery({ rateLimit: false })).resolve({ provider, poolAddress: a.pool });
  let preparing: ConfidentialMode = 'setup';
  const transfers = sdk.createPrivateTransfers({
    account: { address: a.address, signer: { signTransaction: async () => [String(CONFIDENTIAL_MODES[preparing]), ...confidentialTermsFelts(a.terms), '0', '0', '0', '0'] } },
    viewingKeyProvider: { getViewingKey: async () => viewingKey }, provingProvider: options.proofProvider, discoveryProvider, poolContractAddress: a.pool,
  }) as RuntimeTransfers;
  const abi = await loadPrivacyPoolAbi();
  const decoder = new CallData(abi.PrivacyPoolABI as ConstructorParameters<typeof CallData>[0]);
  const emptyJournal = (): ConfidentialJournalState => ({ schema: 'app20/confidential-journal/v1', scope: scopeOf(a), confirmed: [] });
  async function journal() {
    const state = await options.journal.load() ?? emptyJournal();
    if (state.schema !== 'app20/confidential-journal/v1' || state.scope !== scopeOf(a) || !Array.isArray(state.confirmed)) throw new Error('Journal belongs to another confidential session.');
    for (const attempt of [...state.confirmed, ...(state.pending ? [state.pending] : [])]) {
      if (!attempt || !['setup', 'settle', 'refundA', 'refundB', 'fundA', 'fundB'].includes(attempt.mode)) throw new Error('Invalid confidential recovery metadata.');
      confidentialFelt(attempt.id);
      if (attempt.hash !== undefined) confidentialFelt(attempt.hash);
    }
    return state;
  }
  async function snapshot(): Promise<ConfidentialSnapshot> {
    const state = await inspectConfidentialDeployment(provider, a);
    const pub = await provider.callContract({ contractAddress: a.pool, entrypoint: 'get_public_key', calldata: [a.address] });
    if (pub.length !== 1) throw new Error('Invalid pool registration response.');
    const registered = BigInt(pub[0]!) !== 0n;
    if (registered && !sameFelt(pub[0]!, ec.starkCurve.getStarkKey(`0x${viewingKey.toString(16)}`))) throw new Error('Escrow viewing material does not match its registered key.');
    const notes = registered ? (await transfers.discoverNotes({ tokens: [BigInt(a.terms.tokenA), BigInt(a.terms.tokenB)] })).notes : new Map();
    const balance = (token: string) => [...notes.entries()].filter(([key]) => sameFelt(key, token)).flatMap(([, entries]) => entries).reduce((sum: bigint, note: { open?: boolean; amount: bigint }) => {
      if (note.open) throw new Error('Unexpected OPEN note in confidential escrow.');
      return sum + note.amount;
    }, 0n);
    const balanceA = balance(a.terms.tokenA), balanceB = balance(a.terms.tokenB);
    const status = state.timestamp >= a.deadline && (balanceA || balanceB) ? 'refundable' : state.settled ? 'settled' : state.timestamp >= a.deadline ? 'closed' : !registered ? 'setup' : balanceA >= BigInt(a.terms.amountA) && balanceB >= BigInt(a.terms.amountB) ? 'ready' : 'funding';
    return { ...state, registered, balanceA: balanceA.toString(), balanceB: balanceB.toString(), status, pending: (await journal()).pending };
  }
  function checkTime(mode: ConfidentialMode, state: Awaited<ReturnType<typeof inspectConfidentialDeployment>>) {
    if ((mode === 'setup' || mode === 'settle') && (state.settled || state.timestamp >= a.deadline)) throw new Error('Escrow is settled or expired.');
    if (mode.startsWith('refund') && state.timestamp < a.deadline) throw new Error('Refund is available after the agreed deadline.');
  }
  async function prepare(mode: ConfidentialMode): Promise<ConfidentialPrepared> {
    return options.journal.runExclusive(async () => {
      const state = await snapshot(); if (state.pending) throw new Error('Reconcile the pending submission first.'); checkTime(mode, state);
      if (mode !== 'setup' && !state.registered) throw new Error('Both parties must register the escrow before funding.');
      if (mode === 'setup' && state.registered) throw new Error('Escrow is already registered.');
      if (mode === 'settle' && state.status !== 'ready') throw new Error('Both agreed assets must be funded before settlement.');
      preparing = mode;
      const builder = transfers.build({ autoRegister: mode === 'setup', autoSetup: true, autoSelectNotes: 'naive', autoDiscover: { channels: 'refresh', notes: 'refresh' } });
      if (mode === 'setup') {
        builder.register().setup(a.terms.partyA).setup(a.terms.partyB);
        for (const token of [a.terms.tokenA, a.terms.tokenB]) builder.with(token, t => t.setup(a.terms.partyA).setup(a.terms.partyB));
      } else if (mode === 'settle') {
        builder.with(a.terms.tokenA, t => t.surplusTo(a.terms.partyA, false).transfer({ recipient: a.terms.partyB, amount: BigInt(a.terms.amountA) }));
        builder.with(a.terms.tokenB, t => t.surplusTo(a.terms.partyB, false).transfer({ recipient: a.terms.partyA, amount: BigInt(a.terms.amountB) }));
      } else {
        const isA = mode === 'refundA', total = BigInt(isA ? state.balanceA : state.balanceB);
        if (total <= 0n) throw new Error('No refundable balance for this party.');
        builder.with(isA ? a.terms.tokenA : a.terms.tokenB, t => t.surplusTo(isA ? a.terms.partyA : a.terms.partyB, false).transfer({ recipient: isA ? a.terms.partyA : a.terms.partyB, amount: total }));
      }
      builder.computeAndInvoke(() => ({ contractAddress: a.address, computeAdditionalData: [viewingKey, CONFIDENTIAL_MODES[mode]], invokeAdditionalData: [] }));
      let invocation: ConfidentialInvocation;
      try { ({ invocation } = await builder.createProofInvocation()); }
      catch { return safeError('Unable to prepare the private operation. Check escrow discovery and funding; private inputs have not been logged.'); }
      const result = { agreement: a, mode, invocation: structuredClone(invocation), digest: confidentialDigest(a, mode, confidentialInner(invocation)) };
      reviewConfidentialOperation(result, viewingKey);
      return result;
    });
  }
  function verifyProof(proof: ConfidentialProof, mode: ConfidentialMode): ConfidentialSubmission {
    if (!Array.isArray(proof.output) || proof.output.length < 2 || !sameFelt(proof.output[0]!, a.poolClassHash) || proof.additionalData != null) throw new Error('Unexpected proof output or screening payload.');
    if (!options.simulatedProofs && (typeof proof.data !== 'string' || proof.data.length === 0)) throw new Error('Cryptographic proof bytes are required.');
    const facts = proof.proofFacts;
    if (!Array.isArray(facts) || facts.length !== 9 || !sameFelt(facts[0]!, domain('PROOF0')) || !sameFelt(facts[1]!, domain('VIRTUAL_SNOS')) || !sameFelt(facts[3]!, domain('VIRTUAL_SNOS0')) || !sameFelt(facts[7]!, 1) || !sameFelt(facts[8]!, poseidon([a.pool, 0, proof.output.length, ...proof.output]))) throw new Error('Proof facts do not bind this pool action bundle.');
    if (!sameFelt(facts[2]!, VIRTUAL_PROGRAM_HASH)) throw new Error('Unsupported virtual proof program.');
    const configHash = hash.computeHashOnElements([domain('StarknetOsConfig3'), a.chainId, MAINNET_DEPLOYMENT.sellToken.address]);
    if (!sameFelt(facts[6]!, configHash)) throw new Error('Proof is for another network.');
    type Action = { activeVariant(): string; unwrap(): unknown };
    const actions = decoder.decodeParameters('core::array::Span::<privacy::actions::ServerAction>', proof.output.slice(1)) as unknown as Action[];
    const allowed = mode === 'setup' ? ['WriteOnce', 'Append', 'EmitViewingKeySet', 'InvokeWithComputation'] : ['WriteOnce', 'EmitEncNoteCreated', 'EmitNoteUsed', 'InvokeWithComputation'];
    let callbacks = 0;
    for (const [i, action] of actions.entries()) {
      const kind = action.activeVariant(); if (!allowed.includes(kind)) throw new Error('Proof contains a public or unsupported value operation.');
      if (kind === 'InvokeWithComputation') {
        const call = action.unwrap() as { contract_address: string; calldata: string[] };
        if (i !== actions.length - 1 || !sameFelt(call.contract_address, a.address) || call.calldata.length !== 2 || !sameFelt(call.calldata[0]!, domain('APP20_JOINT_COMPUTE_V1')) || !sameFelt(call.calldata[1]!, CONFIDENTIAL_MODES[mode])) throw new Error('Proof callback differs from the approved escrow operation.');
        callbacks++;
      }
    }
    if (callbacks !== 1 || !actions.some(action => action.activeVariant() === 'WriteOnce')) throw new Error('Missing callback or replay protection.');
    return { call: { contractAddress: a.pool, entrypoint: 'apply_actions', calldata: [...proof.output.slice(1), '1'] }, proof: structuredClone(proof) };
  }
  async function reconcileUnlocked() {
    const state = await journal(); if (!state.pending) return;
    if (!state.pending.hash) throw new Error('Unknown submission outcome. Inspect the relayer account before repairing the journal; do not retry blindly.');
    const receipt = await provider.getTransactionReceipt(state.pending.hash);
    if (!receipt.isSuccess() && !receipt.isReverted()) throw new Error('Submission is still pending.');
    if (receipt.isSuccess() && state.pending.mode === 'settle' && !(await inspectConfidentialDeployment(provider, a)).settled) throw new Error('Successful receipt did not settle this escrow.');
    if (receipt.isSuccess()) state.confirmed.push(state.pending);
    delete state.pending; await options.journal.save(state);
  }
  async function broadcast(mode: ConfidentialAttempt['mode'], id: string, send: () => Promise<{ transaction_hash: string }>) {
    await reconcileUnlocked(); const state = await journal();
    state.pending = { id, mode }; await options.journal.save(state);
    let tx: { transaction_hash: string };
    try { tx = await send(); } catch { return safeError('Submission outcome is uncertain. Reconcile before taking another action.'); }
    state.pending.hash = confidentialFelt(tx.transaction_hash); await options.journal.save(state);
    await provider.waitForTransaction(state.pending.hash); await reconcileUnlocked();
    const receipt = await provider.getTransactionReceipt(tx.transaction_hash);
    if (receipt.isReverted()) throw new Error('Confidential operation reverted; inspect current balances before retrying.');
    return tx.transaction_hash;
  }
  function sameAgreement(prepared: ConfidentialPrepared) {
    if (JSON.stringify(normalizeConfidentialAgreement(prepared.agreement)) !== JSON.stringify(a)) throw new Error('Operation belongs to another escrow configuration.');
  }
  async function funding(role: ConfidentialRole) {
      if (role !== 'a' && role !== 'b') throw new Error('Invalid funding role.');
      const state = await snapshot(); checkTime('settle', state);
      if (!state.registered || state.pending) throw new Error('Registered escrow with no pending submission required.');
      const amount = BigInt(role === 'a' ? a.terms.amountA : a.terms.amountB) - BigInt(role === 'a' ? state.balanceA : state.balanceB);
      if (amount <= 0n) throw new Error('This side is already funded.');
      return { token: role === 'a' ? a.terms.tokenA : a.terms.tokenB, recipient: a.address, amount: amount.toString() };
  }
  return {
    agreement: a, inspect: snapshot, prepare, funding,
    reconcile: () => options.journal.runExclusive(reconcileUnlocked),
    async approve(prepared: ConfidentialPrepared, role: ConfidentialRole, sign: (digest: string, review: ConfidentialReview) => Promise<readonly [string, string]>) {
      sameAgreement(prepared); checkTime(prepared.mode, await inspectConfidentialDeployment(provider, a));
      return approveConfidentialOperation(prepared, viewingKey, role, sign);
    },
    async execute(prepared: ConfidentialPrepared, approvals: readonly ConfidentialApproval[]) {
      return options.journal.runExclusive(async () => {
        sameAgreement(prepared);
        await reconcileUnlocked(); checkTime(prepared.mode, await inspectConfidentialDeployment(provider, a));
        const invocation = authorizeConfidentialOperation(prepared, viewingKey, approvals);
        let proof: ConfidentialProof;
        try { proof = await options.proofProvider.prove(invocation); } catch { return safeError('Proof generation failed. The private invocation has not been logged or submitted.'); }
        const submission = verifyProof(proof, prepared.mode);
        checkTime(prepared.mode, await inspectConfidentialDeployment(provider, a));
        return broadcast(prepared.mode, prepared.digest, () => options.submit(submission));
      });
    },
    /** Durable funding uses the caller's own shielded wallet, in a separate transaction. */
    async fund(role: ConfidentialRole, transfer: (payment: { token: string; recipient: string; amount: string }) => Promise<{ transaction_hash: string }>) {
      return options.journal.runExclusive(async () => {
        await reconcileUnlocked();
        const payment = await funding(role);
        return broadcast(role === 'a' ? 'fundA' : 'fundB', poseidon([a.commitment, role === 'a' ? 0 : 1]), () => transfer(payment));
      });
    },
  };
}
