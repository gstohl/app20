import { RpcProvider, type Call, type ProviderInterface } from 'starknet';
import { open as openFile, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MAINNET_DEPLOYMENT } from '../../../src/lib/mainnet-deployment';
import { makerRegistration, makerInventoryCalls, makerOperatorConfig, makerUnits } from '../../../src/lib/maker-setup';
import { verifyMakerBook, verifySettlement, readMakerPage, readMakerAnswer, readExecutableQuote } from '../../../src/lib/starknet-maker-client';
import { coordinatesKey, publicKey, randomRequestId, felt, validateTerms, seal, open, requestCall } from '../../private-intents/src/starknet-maker';
import { settlementCommitment, decodeExecutableAnswer, buildPrivateSettlementActions } from '../../private-intents/src/private-settlement';
import type { Deployment, Head, Maker, Scope, Terms, Quote, PrivateAction, Attempt, OperatorInput, OperatorConfig, RunMakerOptions, PublicExecutor, PrivacyExecutor, ClientOptions } from './types.js';
export type * from './types.js';

// Copy so a consumer cannot change the pins used by a client through this export.
export const MAINNET: Deployment = structuredClone(MAINNET_DEPLOYMENT);
export const capabilities: Readonly<{ maker: true; encryptedRfq: true; chat: false; bundledPrivacyProver: false }> = Object.freeze({ maker: true, encryptedRfq: true, chat: false, bundledPrivacyProver: false });
export function units(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Decimals must be between 0 and 18.');
  return makerUnits(value, decimals);
}
export function createOperatorConfig(input: OperatorInput, now = Math.floor(Date.now() / 1000)): OperatorConfig {
  return makerOperatorConfig(input, now);
}

async function writeNew(path: string, value: unknown): Promise<void> {
  const file = await openFile(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
  await syncDirectory(path);
}
async function syncDirectory(path: string): Promise<void> {
  const dir = await openFile(dirname(resolve(path)), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
/** Writes a local secret with mode 0600, never overwrites; returns ONLY the public key. */
export async function createTransportKey(path: string): Promise<JsonWebKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  await writeNew(path, await crypto.subtle.exportKey('jwk', pair.privateKey));
  return crypto.subtle.exportKey('jwk', pair.publicKey);
}
/** Runs the bundled maker with its persistent transaction journal and explicit fee limits. */
export async function runMaker(options: RunMakerOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const allowed = ['check', 'register', 'run', 'deactivate', 'fund', 'withdraw', 'release', 'reconcile'];
  if (!allowed.includes(options.command)) throw new Error('Unsupported maker command.');
  // Never inherit unrelated operator keys or NODE_OPTIONS from the parent process.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  if (options.command !== 'check') {
    if (options.signingKey) env.APP20_MAKER_SIGNING_KEY = options.signingKey;
    if (options.transportKeyFile) env.APP20_MAKER_TRANSPORT_FILE = resolve(options.cwd ?? process.cwd(), options.transportKeyFile);
  }
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./maker.mjs', import.meta.url)), resolve(options.cwd ?? process.cwd(), options.configFile), `--${options.command}`], { cwd: options.cwd, env, signal: options.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-262144); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-262144); });
    child.once('error', reject);
    child.once('close', code => accept({ exitCode: code ?? 1, stdout, stderr }));
  });
}

type RecordFile = { version: 1; scope: Scope; terms: Terms; secret: string; privateKey: JsonWebKey; call: Call; request?: Attempt; settlement?: Attempt; answer?: Quote };
async function save(path: string, record: RecordFile): Promise<void> {
  const temp = `${path}.${randomRequestId()}.next`;
  await writeNew(temp, record);
  await rename(temp, path);
  await syncDirectory(path);
}
async function locked<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await openFile(`${path}.lock`, 'wx', 0o600);
  try { return await fn(); } finally { await lock.close(); await unlink(`${path}.lock`); }
}

/** Mainnet client. Reading/building never signs; submission requires an explicit executor. */
export class App20Client {
  readonly provider: ProviderInterface;
  private readonly deployment: Deployment = structuredClone(MAINNET_DEPLOYMENT);
  constructor(options: ClientOptions = {}) {
    const url = new URL(options.rpcUrl ?? this.deployment.rpcUrl);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS RPC or loopback for development.');
    this.provider = options.provider ?? new RpcProvider({ nodeUrl: url.href });
  }
  async verify(): Promise<Head> { return verifySettlement(this.provider, this.deployment, this.deployment.settlement); }
  async listMakers(offset = 0): Promise<{ makers: Maker[]; nextOffset?: number; head: Head }> {
    return readMakerPage(this.provider, this.deployment, offset);
  }
  async registrationCall(key: JsonWebKey, days: number): Promise<Call> {
    const head = await verifyMakerBook(this.provider, this.deployment);
    return makerRegistration(JSON.stringify(key), days, head.timestamp);
  }
  async inventoryCalls(action: 'fund' | 'withdraw', token: string, humanAmount: string): Promise<Call[]> {
    if (!['fund', 'withdraw'].includes(action)) throw new Error('Unsupported inventory action.');
    await verifySettlement(this.provider, this.deployment, this.deployment.settlement, action === 'fund');
    return makerInventoryCalls(action, token, humanAmount);
  }
  async availableInventory(account: string, token: string): Promise<string> {
    const head = await verifySettlement(this.provider, this.deployment, this.deployment.settlement, false);
    const values = await this.provider.callContract({ contractAddress: this.deployment.settlement.address, entrypoint: 'available', calldata: [felt(account), felt(token)] }, head.block);
    if (values.length !== 2 || values.some(v => BigInt(v) < 0n || BigInt(v) >= 1n << 128n)) throw new Error('Invalid inventory response.');
    return (BigInt(values[0]!) + (BigInt(values[1]!) << 128n)).toString();
  }
  private async load(path: string): Promise<RecordFile> {
    const record = JSON.parse(await readFile(path, 'utf8')) as RecordFile;
    if (record.version !== 1 || felt(record.scope.chainId) !== felt(this.deployment.chainId) || felt(record.scope.book) !== felt(this.deployment.address)) throw new Error('Request journal belongs to another deployment.');
    validateTerms(record.terms);
    return record;
  }
  /** Save reply keys and settlement secret BEFORE exposing the request for submission. */
  async prepareQuote(input: { file: string; maker: string; taker: string; terms: Terms; ttlSeconds?: number }): Promise<{ id: string; call: Call; expiresAt: number }> {
    validateTerms(input.terms);
    const ttl = input.ttlSeconds ?? 1800;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 1800) throw new Error('Quote TTL must be 1–1800 seconds.');
    const head = await this.verify();
    const maker = felt(input.maker), taker = felt(input.taker);
    const values = await this.provider.callContract({ contractAddress: this.deployment.address, entrypoint: 'maker', calldata: [maker] }, head.block);
    if (values.length !== 6) throw new Error('Invalid maker record.');
    const revision = Number(BigInt(values[4]!)), validUntil = Number(BigInt(values[5]!));
    if (!Number.isSafeInteger(revision) || revision <= 0 || !Number.isSafeInteger(validUntil) || validUntil <= head.timestamp) throw new Error('Maker key is inactive.');
    const scope: Scope = { chainId: felt(this.deployment.chainId), book: felt(this.deployment.address), id: randomRequestId(), maker, taker, revision, expiresAt: Math.min(head.timestamp + ttl, validUntil) };
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const secret = randomRequestId();
    const body = { ...input.terms, replyKey: await crypto.subtle.exportKey('jwk', keys.publicKey), settlementCommitment: settlementCommitment(scope.chainId, this.deployment.settlement.address, secret) };
    const call = requestCall(scope, await seal(scope, 'request', body, await publicKey(coordinatesKey(values.slice(0, 4)))));
    await writeNew(input.file, { version: 1, scope, terms: input.terms, secret, privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey), call } satisfies RecordFile);
    return { id: scope.id, call, expiresAt: scope.expiresAt };
  }
  private assertExecutor(record: RecordFile, executor: { address: string; chainId: string }): void {
    if (felt(executor.address) !== felt(record.scope.taker) || felt(executor.chainId) !== felt(record.scope.chainId)) throw new Error('Executor does not match the request account and chain.');
  }
  async submitRequest(file: string, executor: PublicExecutor): Promise<string> {
    return locked(file, async () => {
      const record = await this.load(file);
      this.assertExecutor(record, executor);
      if (record.request && record.request.status !== 'reverted') throw new Error('Request already attempted. Reconcile before retrying.');
      const head = await this.verify();
      if (head.timestamp >= record.scope.expiresAt) throw new Error('Request expired.');
      record.request = { status: 'prepared' }; await save(file, record);
      const tx = await executor.execute([record.call]);
      record.request = { status: 'submitted', transactionHash: felt(tx.transaction_hash) }; await save(file, record);
      return tx.transaction_hash;
    });
  }
  async readQuote(file: string): Promise<Quote | undefined> {
    const record = await this.load(file);
    const payload = await readMakerAnswer(this.provider, this.deployment, record.scope);
    if (!payload) return undefined;
    const { d: _secret, ...pub } = record.privateKey;
    const privateKey = await crypto.subtle.importKey('jwk', record.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const body = await open(record.scope, 'quote', payload, { privateKey, publicKey: await publicKey(pub) });
    const answer = decodeExecutableAnswer(body, record.scope, record.terms, this.deployment.settlement, settlementCommitment(record.scope.chainId, this.deployment.settlement.address, record.secret), Math.floor(Date.now() / 1000));
    const quote = await readExecutableQuote(this.provider, this.deployment, this.deployment.settlement, record.scope, record.terms, answer);
    if (quote.status !== 1 || quote.expired) throw new Error('Quote is no longer reserved.');
    return answer;
  }
  /** Executor must submit ALL actions atomically using a compatible privacy wallet, never Account.execute. */
  async settle(file: string, executor: PrivacyExecutor, maxPoolFee: string): Promise<string> {
    if (!/^(0|[1-9][0-9]*)$/.test(maxPoolFee)) throw new Error('Set a pool fee cap in STRK base units.');
    return locked(file, async () => {
      const record = await this.load(file);
      this.assertExecutor(record, executor);
      if (record.settlement && record.settlement.status !== 'reverted') throw new Error('Settlement already attempted. Reconcile before retrying.');
      const answer = await this.readQuote(file);
      if (!answer) throw new Error('No quote yet.');
      const head = await this.verify();
      if (head.timestamp >= answer.expiresAt) throw new Error('Quote expired.');
      const fee = await this.provider.callContract({ contractAddress: this.deployment.settlement.pool, entrypoint: 'get_fee_amount', calldata: [] }, head.block);
      if (fee.length !== 1 || BigInt(fee[0]!) < 0n || BigInt(fee[0]!) >= 1n << 128n || BigInt(fee[0]!) > BigInt(maxPoolFee)) throw new Error('Pool fee exceeds limit or is invalid.');
      record.answer = answer; record.settlement = { status: 'prepared' }; await save(file, record);
      const actions: PrivateAction[] = buildPrivateSettlementActions(record.scope, record.terms, answer, record.secret, record.scope.taker);
      const tx = await executor.execute(actions);
      record.settlement = { status: 'submitted', transactionHash: felt(tx.transaction_hash) }; await save(file, record);
      return tx.transaction_hash;
    });
  }
  async reconcile(file: string): Promise<{ request?: Attempt; settlement?: Attempt }> {
    return locked(file, async () => {
      const record = await this.load(file);
      await verifyMakerBook(this.provider, this.deployment);
      for (const phase of ['request', 'settlement'] as const) {
        const attempt = record[phase];
        if (!attempt?.transactionHash || attempt.status !== 'submitted') continue;
        const receipt = await this.provider.getTransactionReceipt(attempt.transactionHash);
        if (receipt.isReverted()) attempt.status = 'reverted';
        else if (receipt.isSuccess()) {
          if (phase === 'settlement') {
            if (!record.answer) throw new Error('Missing settlement quote.');
            const quote = await readExecutableQuote(this.provider, this.deployment, this.deployment.settlement, record.scope, record.terms, record.answer, false);
            if (quote.status !== 2) throw new Error('Receipt succeeded but quote was not filled.');
          }
          attempt.status = 'confirmed';
        }
      }
      await save(file, record);
      return { request: record.request, settlement: record.settlement };
    });
  }
}
export { createPrivacyWallet } from './privacy.js';
export type { NodePrivacyOptions, NodePrivacyWallet } from './privacy.js';
