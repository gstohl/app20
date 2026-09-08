import { ec, hash, shortString } from 'starknet';

export const CONFIDENTIAL_RFQ_SCHEMA = 'app20/confidential-rfq/v1' as const;
export const CONFIDENTIAL_MODES = { setup: 0, settle: 1, refundA: 2, refundB: 3 } as const;
export type ConfidentialMode = keyof typeof CONFIDENTIAL_MODES;
export type ConfidentialRole = 'a' | 'b';
export type ConfidentialTerms = Readonly<{ tokenA: string; tokenB: string; amountA: string; amountB: string; partyA: string; partyB: string; salt: string }>;
export type ConfidentialAgreement = Readonly<{
  schema: typeof CONFIDENTIAL_RFQ_SCHEMA;
  chainId: string; pool: string; poolClassHash: string; escrowClassHash: string;
  signerA: string; signerB: string; deadline: number; terms: ConfidentialTerms;
  commitment: string; address: string;
}>;
export type ConfidentialAgreementInput = Omit<ConfidentialAgreement, 'schema' | 'commitment' | 'address'> & { address?: string };
export type ConfidentialInvocation = Readonly<{ sender_address: string; calldata: readonly string[]; signature: readonly string[]; [key: string]: unknown }>;
export type ConfidentialPrepared = Readonly<{ agreement: ConfidentialAgreement; mode: ConfidentialMode; invocation: ConfidentialInvocation; digest: string }>;
export type ConfidentialApproval = Readonly<{ role: ConfidentialRole; digest: string; signature: readonly [string, string] }>;
export type ConfidentialReview = Readonly<{ mode: ConfidentialMode; digest: string; commitment: string; account: string; chainId: string; pool: string; deadline: number; terms: ConfidentialTerms; requiredSigners: readonly ConfidentialRole[]; inputs: number; outputs: number }>;

const FIELD = 2n ** 251n + 17n * 2n ** 192n + 1n;
const ADDRESS_LIMIT = 2n ** 251n - 256n;
export const domain = (value: string) => shortString.encodeShortString(value);
export const sameFelt = (a: string | bigint | number, b: string | bigint | number) => BigInt(a) === BigInt(b);
export const poseidon = (values: readonly (string | bigint | number)[]) => hash.computePoseidonHashOnElements(values.map(BigInt));
export function confidentialFelt(value: unknown, nonzero = true): string {
  if (typeof value !== 'string' || !/^(?:0x[\da-fA-F]+|\d+)$/.test(value)) throw new Error('Expected a felt string.');
  const n = BigInt(value);
  if (n < (nonzero ? 1n : 0n) || n >= FIELD) throw new Error('Felt out of range.');
  return `0x${n.toString(16)}`;
}
function address(value: string): string {
  const normalized = confidentialFelt(value);
  if (BigInt(normalized) >= ADDRESS_LIMIT) throw new Error('Contract address out of range.');
  return normalized;
}
function amount(value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= 2n ** 128n) throw new Error('Amounts must be positive u128 integer strings.');
  return BigInt(value).toString();
}
export function confidentialTermsFelts(t: ConfidentialTerms): string[] {
  return [t.tokenA, t.tokenB, t.amountA, t.amountB, t.partyA, t.partyB, t.salt];
}
export function createConfidentialAgreement(input: ConfidentialAgreementInput): ConfidentialAgreement {
  const terms = Object.freeze({ tokenA: address(input.terms.tokenA), tokenB: address(input.terms.tokenB), amountA: amount(input.terms.amountA), amountB: amount(input.terms.amountB), partyA: address(input.terms.partyA), partyB: address(input.terms.partyB), salt: confidentialFelt(input.terms.salt) });
  if (terms.tokenA === terms.tokenB || terms.partyA === terms.partyB) throw new Error('Distinct assets and recipients required.');
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0) throw new Error('Invalid deadline.');
  const config = { chainId: confidentialFelt(input.chainId), pool: address(input.pool), poolClassHash: confidentialFelt(input.poolClassHash), escrowClassHash: confidentialFelt(input.escrowClassHash), signerA: confidentialFelt(input.signerA), signerB: confidentialFelt(input.signerB), deadline: input.deadline };
  if (config.signerA === config.signerB) throw new Error('Independent signing keys required.');
  const commitment = poseidon([domain('APP20_JOINT_TERMS_V1'), config.chainId, config.pool, config.poolClassHash, config.signerA, config.signerB, config.deadline, ...confidentialTermsFelts(terms)]);
  // Address may be supplied after deployment; no secret terms enter the constructor.
  return Object.freeze({ schema: CONFIDENTIAL_RFQ_SCHEMA, ...config, terms, commitment, address: input.address ? address(input.address) : '0x0' });
}
export function normalizeConfidentialAgreement(value: ConfidentialAgreement): ConfidentialAgreement {
  if (value.schema !== CONFIDENTIAL_RFQ_SCHEMA) throw new Error('Unsupported confidential RFQ version.');
  const result = createConfidentialAgreement({ ...value, address: sameFelt(value.address, 0) ? undefined : value.address });
  if (!sameFelt(result.commitment, value.commitment)) throw new Error('Terms commitment mismatch.');
  return result;
}
export function confidentialConstructor(agreement: ConfidentialAgreement): string[] {
  const a = normalizeConfidentialAgreement(agreement);
  return [a.pool, a.poolClassHash, a.commitment, a.signerA, a.signerB, String(a.deadline)];
}
export function confidentialRequiredSigners(mode: ConfidentialMode): readonly ConfidentialRole[] {
  if (mode === 'refundA') return ['a'];
  if (mode === 'refundB') return ['b'];
  if (mode !== 'setup' && mode !== 'settle') throw new Error('Unsupported operation.');
  return ['a', 'b'];
}
export function confidentialDigest(a: ConfidentialAgreement, mode: ConfidentialMode, inner: readonly string[]): string {
  return poseidon([domain('APP20_JOINT_AUTH_V1'), a.chainId, a.address, a.pool, a.poolClassHash, a.commitment, CONFIDENTIAL_MODES[mode], poseidon(inner)]);
}
export function confidentialInner(invocation: ConfidentialInvocation): string[] {
  const c = invocation.calldata;
  if (!Array.isArray(c) || c.length < 7 || c.length > 4096 || !sameFelt(c[0]!, 1) || Number(c[3]) !== c.length - 4) throw new Error('Expected exactly one bounded compile call.');
  return c.slice(4).map(value => confidentialFelt(value, false));
}
/** Wallet-side policy: every private field is reviewed before a signing callback runs. */
export function reviewConfidentialOperation(prepared: ConfidentialPrepared, viewingKey: bigint): ConfidentialReview {
  const a = normalizeConfidentialAgreement(prepared.agreement), mode = prepared.mode, m = CONFIDENTIAL_MODES[mode];
  const requiredSigners = confidentialRequiredSigners(mode);
  if (a.address === '0x0' || viewingKey <= 0n || viewingKey > ec.starkCurve.CURVE.n / 2n) throw new Error('Deployed account and canonical escrow viewing material required.');
  const c = prepared.invocation.calldata, inner = confidentialInner(prepared.invocation);
  if (!sameFelt(prepared.invocation.sender_address, a.pool) || !sameFelt(c[1]!, a.pool) || !sameFelt(c[2]!, hash.getSelectorFromName('compile_actions'))) throw new Error('Operation must compile on the pinned pool.');
  let at = 0;
  const take = () => { if (at >= inner.length) throw new Error('Truncated private action.'); return BigInt(inner[at++]!); };
  const skip = (n: number) => { for (let i = 0; i < n; i++) take(); };
  if (take() !== BigInt(a.address) || take() !== viewingKey) throw new Error('Escrow identity mismatch.');
  const count = Number(take());
  if (count < 1 || count > 64) throw new Error('Invalid action count.');
  const t = a.terms;
  const tokenAllowed = (v: bigint) => {
    if (!(v === BigInt(t.tokenA) && m !== 3) && !(v === BigInt(t.tokenB) && m !== 2)) throw new Error('Asset violates refund policy.');
  };
  const recipientAllowed = (v: bigint) => {
    if (!(v === BigInt(t.partyA) && m !== 3) && !(v === BigInt(t.partyB) && m !== 2) && !(m === 0 && v === BigInt(a.address))) throw new Error('Recipient violates policy.');
  };
  let tradedA = 0n, tradedB = 0n, refunded = 0n, callback = false, inputs = 0, outputs = 0;
  for (let i = 0; i < count; i++) {
    switch (Number(take())) {
      case 0: if (m !== 0) throw new Error('Registration outside setup.'); skip(1); break;
      case 1: recipientAllowed(take()); skip(3); break;
      case 2: recipientAllowed(take()); skip(3); tokenAllowed(take()); skip(1); break;
      case 3: {
        if (m === 0) throw new Error('Setup cannot move value.');
        const recipient = take(); skip(1); const token = take(), value = take(); skip(2);
        tokenAllowed(token); if (value >= 2n ** 128n) throw new Error('Invalid output amount.'); outputs++;
        if (m === 1) {
          if (token === BigInt(t.tokenA) && recipient === BigInt(t.partyB)) tradedA += value;
          else if (token === BigInt(t.tokenB) && recipient === BigInt(t.partyA)) tradedB += value;
          else if (!(token === BigInt(t.tokenA) && recipient === BigInt(t.partyA)) && !(token === BigInt(t.tokenB) && recipient === BigInt(t.partyB))) throw new Error('Surplus recipient changed.');
        } else { recipientAllowed(recipient); refunded += value; }
        break;
      }
      case 6: if (m === 0) throw new Error('Setup cannot spend notes.'); skip(1); tokenAllowed(take()); skip(1); inputs++; break;
      case 9:
        if (i !== count - 1 || callback || take() !== BigInt(a.address) || take() !== 2n || take() !== viewingKey || take() !== BigInt(m) || take() !== 0n) throw new Error('Invalid identity-bound callback.');
        callback = true; break;
      default: throw new Error('Only encrypted notes and the escrow computation are allowed.');
    }
  }
  if (at !== inner.length || !callback) throw new Error('Trailing data or missing callback.');
  if (m === 1 && (inputs === 0 || tradedA !== BigInt(t.amountA) || tradedB !== BigInt(t.amountB))) throw new Error('Swap outputs differ from the agreed amounts.');
  if (m >= 2 && (inputs === 0 || refunded === 0n)) throw new Error('Refund must return an input asset.');
  const digest = confidentialDigest(a, mode, inner);
  if (!sameFelt(digest, prepared.digest)) throw new Error('Private operation digest mismatch.');
  return Object.freeze({ mode, digest, commitment: a.commitment, account: a.address, chainId: a.chainId, pool: a.pool, deadline: a.deadline, terms: a.terms, requiredSigners: Object.freeze([...requiredSigners]), inputs, outputs });
}
export function verifyConfidentialApproval(a: ConfidentialAgreement, digest: string, approval: ConfidentialApproval): boolean {
  try {
    if (!sameFelt(digest, approval.digest) || !['a', 'b'].includes(approval.role) || approval.signature.length !== 2) return false;
    const publicKey = (approval.role === 'a' ? a.signerA : a.signerB).slice(2).padStart(64, '0');
    const signature = new ec.starkCurve.Signature(BigInt(approval.signature[0]), BigInt(approval.signature[1]));
    return ['02', '03'].some(parity => ec.starkCurve.verify(signature, digest, parity + publicKey));
  } catch { return false; }
}
/** A peer signs with its own key provider. This function never receives the other key. */
export async function approveConfidentialOperation(prepared: ConfidentialPrepared, viewingKey: bigint, role: ConfidentialRole, sign: (digest: string, review: ConfidentialReview) => Promise<readonly [string, string]>): Promise<ConfidentialApproval> {
  const review = reviewConfidentialOperation(prepared, viewingKey);
  if (!review.requiredSigners.includes(role)) throw new Error('This role cannot authorize the operation.');
  const signature = await sign(review.digest, review);
  const approval = Object.freeze({ role, digest: review.digest, signature: Object.freeze([...signature]) as readonly [string, string] });
  if (!verifyConfidentialApproval(prepared.agreement, review.digest, approval)) throw new Error('Signing key does not match the agreed role.');
  return approval;
}
export function authorizeConfidentialOperation(prepared: ConfidentialPrepared, viewingKey: bigint, approvals: readonly ConfidentialApproval[]): ConfidentialInvocation {
  const review = reviewConfidentialOperation(prepared, viewingKey);
  const roles = new Set(approvals.map(a => a.role));
  if (roles.size !== approvals.length || approvals.length !== review.requiredSigners.length || review.requiredSigners.some(role => !roles.has(role))) throw new Error('Every required party must approve exactly once.');
  for (const approval of approvals) if (!verifyConfidentialApproval(prepared.agreement, review.digest, approval)) throw new Error('Invalid or mismatched approval.');
  const signatureFor = (role: ConfidentialRole) => approvals.find(a => a.role === role)?.signature ?? ['0', '0'];
  // The hosted prover consumes RPC JSON directly, without Starknet.js normalizing
  // decimal amounts/signatures. Every felt on this wire must use 0x notation.
  const signature = [String(CONFIDENTIAL_MODES[prepared.mode]), ...confidentialTermsFelts(prepared.agreement.terms), ...signatureFor('a'), ...signatureFor('b')].map(value => confidentialFelt(value, false));
  return { ...structuredClone(prepared.invocation), signature };
}
