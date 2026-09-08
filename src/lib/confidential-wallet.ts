import { ec, type RpcProvider, type TypedData, type WalletAccountV6 } from 'starknet';
import { starkscanProver } from '@app20/privy/browser';
import {
  approveConfidentialOperation, createConfidentialClient, normalizeConfidentialAgreement,
  type ConfidentialAgreement, type ConfidentialPrepared, type ConfidentialRole, type ConfidentialProofProvider,
} from '../../packages/agent-sdk/src/confidential';
import { createBrowserConfidentialJournal, createBrowserConfidentialSecretStore, type ConfidentialBrowserSecretStore } from './confidential-browser-journal';
import { browserProofJournal } from './proof-journal';
import { MAINNET_DEPLOYMENT } from './mainnet-deployment';
import { buildReadyProofSessionTypedData, normalizeReadyProofSession, READY_PROOF_SESSION_TTL, type ReadyProofSessionClaim } from './ready-proof-session';

const randomFelt = () => `0x${Array.from(crypto.getRandomValues(new Uint8Array(31)), v => v.toString(16).padStart(2, '0')).join('')}`;
const same = (a: string, b: string) => BigInt(a) === BigInt(b);
type Wallet = Pick<WalletAccountV6, 'address' | 'signMessage' | 'executeWithProof' | 'strk20InvokeTransaction'>;
export type ReadyConfidentialProofSession = { accessToken(): Promise<string>; reauthenticate(): Promise<string> };

/** A message signature authenticates service access; it does not authorize a payment. */
export function createReadyConfidentialProofSession(options: {
  wallet: Pick<Wallet, 'address' | 'signMessage'>; assertCurrent(): void; origin?: string; fetch?: typeof fetch; now?: () => number;
}): ReadyConfidentialProofSession {
  const origin = options.origin ?? location.origin, fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  const startedAddress = options.wallet.address;
  let saved: { token: string; expiresAt: number } | undefined, pending: Promise<string> | undefined;
  const current = () => { options.assertCurrent(); if (!same(options.wallet.address, startedAddress)) throw new Error('The wallet account changed.'); };
  async function authenticate(): Promise<string> {
    current();
    const issuedAt = Math.floor(now() / 1000);
    const claim: ReadyProofSessionClaim = normalizeReadyProofSession({ account: startedAddress, chainId: MAINNET_DEPLOYMENT.chainId, origin, issuedAt, expiresAt: issuedAt + READY_PROOF_SESSION_TTL, nonce: randomFelt() });
    const signature = await options.wallet.signMessage(buildReadyProofSessionTypedData(claim) as TypedData);
    current();
    if (!Array.isArray(signature) || signature.length < 2 || signature.length > 64) throw new Error('Wallet did not return a supported message signature.');
    const response = await fetcher(`${origin}/api/privacy/ready-proof-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim, signature: signature.map(value => `0x${BigInt(value).toString(16)}`) }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    current();
    if (!response.ok) throw new Error('Wallet authentication failed. Retry signing in to confidential trading.');
    const result = await response.json() as { token?: unknown; expiresAt?: unknown; account?: unknown; origin?: unknown };
    current();
    if (typeof result.token !== 'string' || !result.token.startsWith('app20-ready-proof-v1.') || result.token.length > 4096 || result.expiresAt !== claim.expiresAt || result.account !== claim.account || result.origin !== claim.origin) throw new Error('Wallet authentication returned an invalid session.');
    saved = { token: result.token, expiresAt: claim.expiresAt };
    return saved.token;
  }
  const start = () => pending ?? (pending = authenticate().finally(() => { pending = undefined; }));
  return {
    async accessToken() { current(); return saved && saved.expiresAt > Math.floor(now() / 1000) + 60 ? saved.token : start(); },
    async reauthenticate() { saved = undefined; return start(); },
  };
}

type IdentityMaterial = { schema: 'app20/confidential-identity/v1'; key: string; publicKey: string; binding?: { agreement: ConfidentialAgreement; role: ConfidentialRole; viewingKey: string } };
export type ConfidentialEscrowIdentity = {
  readonly publicKey: string;
  bind(agreement: ConfidentialAgreement, role: ConfidentialRole, viewingKey: bigint): Promise<void>;
  approve(prepared: ConfidentialPrepared, beforeSign?: () => void): ReturnType<typeof approveConfidentialOperation>;
  restore(): Promise<IdentityMaterial['binding']>;
};
/** Allocate a room-specific scope before agreeing terms. Only this role's key is generated here. */
export async function openConfidentialEscrowIdentity(options: {
  scope: string; store?: ConfidentialBrowserSecretStore; runExclusive?: <T>(task: () => Promise<T>) => Promise<T>;
}): Promise<ConfidentialEscrowIdentity> {
  const store = options.store ?? createBrowserConfidentialSecretStore(options.scope);
  const exclusive = options.runExclusive ?? (async <T>(task: () => Promise<T>) => {
    if (!navigator.locks) throw new Error('This browser cannot coordinate confidential signing safely.');
    return navigator.locks.request(`app20-confidential-identity:${options.scope}`, task);
  });
  const encode = (value: IdentityMaterial) => new TextEncoder().encode(JSON.stringify(value));
  const load = async (): Promise<IdentityMaterial> => {
    const bytes = await store.load();
    if (!bytes) throw new Error('Confidential signing recovery material is unavailable.');
    const value = JSON.parse(new TextDecoder().decode(bytes)) as IdentityMaterial;
    if (value.schema !== 'app20/confidential-identity/v1' || typeof value.key !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(value.key) || BigInt(value.key) <= 0n || BigInt(value.key) >= ec.starkCurve.CURVE.n || value.publicKey !== ec.starkCurve.getStarkKey(value.key)) throw new Error('Confidential signing recovery material is invalid.');
    return value;
  };
  const publicKey = await exclusive(async () => {
    if (!(await store.load())) {
      const key = randomFelt();
      await store.save(encode({ schema: 'app20/confidential-identity/v1', key, publicKey: ec.starkCurve.getStarkKey(key) }));
    }
    return (await load()).publicKey;
  });
  const validateBinding = (agreement: ConfidentialAgreement, role: ConfidentialRole, viewingKey: bigint) => {
    const a = normalizeConfidentialAgreement(agreement);
    if (a.address === '0x0' || !['a', 'b'].includes(role) || !same(role === 'a' ? a.signerA : a.signerB, publicKey) || viewingKey <= 0n || viewingKey > ec.starkCurve.CURVE.n / 2n) throw new Error('The escrow agreement does not match this independent signing identity.');
    return { agreement: a, role, viewingKey: `0x${viewingKey.toString(16)}` };
  };
  return Object.freeze({
    publicKey,
    bind: async (agreement: ConfidentialAgreement, role: ConfidentialRole, viewingKey: bigint) => exclusive(async () => {
      const value = await load(), binding = validateBinding(agreement, role, viewingKey);
      if (value.binding && JSON.stringify(value.binding) !== JSON.stringify(binding)) throw new Error('This signing identity is already bound to another escrow agreement.');
      await store.save(encode({ ...value, binding }));
    }),
    restore: async () => exclusive(async () => {
      const binding = (await load()).binding;
      return binding ? validateBinding(binding.agreement, binding.role, BigInt(binding.viewingKey)) : undefined;
    }),
    approve: async (prepared: ConfidentialPrepared, beforeSign?: () => void) => {
      const owned = structuredClone(prepared);
      return exclusive(async () => {
        const value = await load();
        if (!value.binding) throw new Error('Review and bind this escrow agreement before approving.');
        const binding = validateBinding(value.binding.agreement, value.binding.role, BigInt(value.binding.viewingKey));
        if (JSON.stringify(normalizeConfidentialAgreement(owned.agreement)) !== JSON.stringify(binding.agreement)) throw new Error('Approval belongs to another escrow agreement.');
        return approveConfidentialOperation(owned, BigInt(binding.viewingKey), binding.role, async digest => {
          beforeSign?.();
          const signature = ec.starkCurve.sign(digest, value.key);
          return [`0x${signature.r.toString(16)}`, `0x${signature.s.toString(16)}`];
        });
      });
    },
  });
}

/** User funding stays in Ready; the shared SDK sees only escrow-specific viewing material. */
export async function createReadyConfidentialWallet(options: {
  agreement: ConfidentialAgreement; role: ConfidentialRole; viewingKey: bigint; identity: ConfidentialEscrowIdentity;
  provider: RpcProvider; wallet: Wallet; assertCurrent(): void; proofSession: ReadyConfidentialProofSession; origin?: string;
  /** Pool fee approval ceiling in STRK base units. Wallet approval also covers network fees. */
  maxPoolFee?: bigint;
}) {
  const agreement = normalizeConfidentialAgreement(options.agreement), origin = options.origin ?? location.origin;
  const startedAddress = options.wallet.address;
  const assertCurrent = () => {
    options.assertCurrent();
    if (!same(agreement.chainId, MAINNET_DEPLOYMENT.chainId) || !same(options.wallet.address, startedAddress) || !same(startedAddress, options.role === 'a' ? agreement.terms.partyA : agreement.terms.partyB)) throw new Error('The connected wallet does not own this side of the agreement.');
  };
  assertCurrent();
  await options.identity.bind(agreement, options.role, options.viewingKey);
  assertCurrent();
  const scope = `${agreement.chainId}/${agreement.address}/${agreement.commitment}`;
  const proofProvider = await starkscanProver({ relayUrl: `${origin}/api/privacy/prove`, accessToken: options.proofSession.accessToken, journal: browserProofJournal(`${scope}/${options.role}`), poolClassHash: agreement.poolClassHash }).resolve({ provider: options.provider, network: 'mainnet', chainId: agreement.chainId, nodeUrl: `${origin}/api/starknet/mainnet`, poolAddress: agreement.pool }) as ConfidentialProofProvider;
  const client = await createConfidentialClient({ agreement, provider: options.provider, viewingKeyProvider: { getViewingKey: async () => options.viewingKey }, proofProvider, journal: createBrowserConfidentialJournal(scope), submit: async submission => {
    const owned = structuredClone(submission);
    assertCurrent();
    if (!owned.proof.data) throw new Error('Real proof bytes are required.');
    const [feeResult, allowanceResult] = await Promise.all([
      options.provider.callContract({ contractAddress: agreement.pool, entrypoint: 'get_fee_amount', calldata: [] }),
      options.provider.callContract({ contractAddress: MAINNET_DEPLOYMENT.sellToken.address, entrypoint: 'allowance', calldata: [startedAddress, agreement.pool] }),
    ]);
    assertCurrent();
    const uint = (result: string[]) => {
      if (!Array.isArray(result) || result.length < 1 || result.length > 2 || result.some(value => typeof value !== 'string' || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(value) || BigInt(value) >= 2n ** 128n)) throw new Error('Invalid pool fee or allowance response.');
      return BigInt(result[0]!) + (BigInt(result[1] ?? '0') << 128n);
    };
    const fee = uint(feeResult), allowance = uint(allowanceResult), ceiling = options.maxPoolFee ?? 10n * 10n ** 18n;
    if (ceiling < 0n || fee > ceiling) throw new Error('Pool fee exceeds the approved session ceiling.');
    const calls = allowance < fee ? [{ contractAddress: MAINNET_DEPLOYMENT.sellToken.address, entrypoint: 'approve', calldata: [agreement.pool, `0x${fee.toString(16)}`, '0x0'] }, owned.call] : [owned.call];
    assertCurrent();
    return options.wallet.executeWithProof(calls, { data: owned.proof.data, output: [...owned.proof.output], proof_facts: [...owned.proof.proofFacts] });
  } });
  return Object.freeze({
    agreement: client.agreement,
    inspect: client.inspect,
    prepare: client.prepare,
    reconcile: client.reconcile,
    accessToken: options.proofSession.accessToken,
    reauthenticate: options.proofSession.reauthenticate,
    async approve(prepared: ConfidentialPrepared) { const owned = structuredClone(prepared); assertCurrent(); return client.approve(owned, options.role, async () => { assertCurrent(); return (await options.identity.approve(owned, assertCurrent)).signature; }); },
    execute: client.execute,
    async fund() {
      assertCurrent();
      return client.fund(options.role, async payment => {
        assertCurrent();
        return options.wallet.strk20InvokeTransaction([{ type: 'transfer', token: payment.token, recipient: payment.recipient, amount: `0x${BigInt(payment.amount).toString(16)}` }]);
      });
    },
  });
}
