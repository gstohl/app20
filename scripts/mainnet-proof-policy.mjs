// Pure public-envelope checks. The chain must still verify the cryptographic proof.
import { createHash } from 'node:crypto';
import { CallData, hash, shortString } from 'starknet';
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { MAINNET_PROOF_FORMAT, realProofConfigHash } from '../src/lib/mainnet-proof-format.ts';

const decoder = new CallData(PrivacyPoolABI);
const FIELD = 2n ** 251n + 17n * 2n ** 192n + 1n;
const hex = value => {
  if (!['string', 'bigint', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isSafeInteger(value))) throw Error('Invalid public felt.');
  const n = BigInt(value); if (n < 0n || n >= FIELD) throw Error('Invalid public felt.');
  return `0x${n.toString(16)}`;
};
const same = (a, b) => hex(a) === hex(b);
const sequence = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
const domain = shortString.encodeShortString;
const addressOf = value => typeof value === 'string' ? value : value?.address;
const modes = { setup: 0, settle: 1, refundA: 2, refundB: 3 };
const stages = new Set(['registerRecipientB', 'chat', 'setup', 'settle', 'refundA', 'refundB', 'private-transfer', 'fundA', 'fundB', 'shield']);
const DEFAULT_SHIELD = Object.freeze({ owner: '0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3', token: deployment.sellToken.address, amount: '20000000000000000' });

export function validateMainnetProof({ record, stage, recipient, escrow, chatAddress, expectedCallback, publicInput = DEFAULT_SHIELD }) {
  if (!stages.has(stage) || !record || !same(record.chainId, deployment.chainId)) throw Error('Unexpected proof stage or network.');
  if (record.mode !== undefined && record.mode !== stage) throw Error('Proof record belongs to another operation.');
  const owned = structuredClone(record.submission), { proof, call } = owned ?? {};
  if (!proof || !call || typeof proof.data !== 'string' || !proof.data.length || proof.data.length > 640000 || proof.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(proof.data) || Buffer.from(proof.data, 'base64').toString('base64') !== proof.data) throw Error('A bounded base64 cryptographic proof is required.');
  if (!Array.isArray(proof.output) || proof.output.length < 2 || proof.output.length > 5000 || !same(proof.output[0], deployment.settlement.poolClassHash)) throw Error('Proof output does not use the pinned pool class.');
  proof.output = proof.output.map(hex);
  const facts = proof.proofFacts;
  if (!Array.isArray(facts) || facts.length !== 9) throw Error('Unexpected proof facts.');
  proof.proofFacts = facts.map(hex);
  const baseNumber = Number(BigInt(facts[4]));
  if (!Number.isSafeInteger(baseNumber) || baseNumber <= 0 || BigInt(facts[5]) === 0n) throw Error('Accepted proving block identity is required.');
  const wanted = [domain(MAINNET_PROOF_FORMAT.version), domain('VIRTUAL_SNOS'), MAINNET_PROOF_FORMAT.virtualProgramHash, domain('VIRTUAL_SNOS0'), facts[4], facts[5], realProofConfigHash(deployment.chainId, deployment.sellToken.address), 1, hash.computePoseidonHashOnElements([deployment.settlement.pool, 0, proof.output.length, ...proof.output])];
  if (!sequence(facts, wanted)) throw Error('Proof facts do not bind the supported mainnet program and pool output.');
  if (record.block && (!same(record.block.number, facts[4]) || !same(record.block.hash, facts[5]))) throw Error('Proof block differs from the saved request.');
  let suffix = ['1'];
  if (stage === 'shield') {
    const extra = proof.additionalData, signature = extra?.signature;
    if (!extra || Object.keys(extra).some(key => key !== 'signature') || !signature || Object.keys(signature).some(key => !['issued_at', 'sig_r', 'sig_s'].includes(key)) || !Number.isSafeInteger(signature.issued_at) || signature.issued_at <= 0 || BigInt(hex(signature.sig_r)) === 0n || BigInt(hex(signature.sig_s)) === 0n) throw Error('Shielding requires a screening attestation.');
    suffix = ['0', String(signature.issued_at), signature.sig_r, signature.sig_s];
  } else if (proof.additionalData != null) throw Error('Unexpected screening or proving side-channel.');
  if (!same(call.contractAddress, deployment.settlement.pool) || call.entrypoint !== 'apply_actions' || !sequence(call.calldata, [...proof.output.slice(1), ...suffix])) throw Error('Public submission differs from the proven pool action bundle.');
  call.contractAddress = hex(call.contractAddress); call.calldata = call.calldata.map(hex);
  const actions = decoder.decodeParameters('core::array::Span::<privacy::actions::ServerAction>', proof.output.slice(1));
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 128) throw Error('Expected a bounded pool action bundle.');
  let callbacks = 0, registrations = 0, inputs = 0, outputs = 0, transfersFrom = 0, deposits = 0;
  const kinds = actions.map(action => action.activeVariant());
  const permitted = stage === 'chat' ? ['WriteOnce', 'EmitNoteUsed', 'EmitEncNoteCreated', 'InvokeWithComputation']
    : stage === 'registerRecipientB' || stage === 'setup' ? ['WriteOnce', 'Append', 'EmitViewingKeySet', ...(stage === 'setup' ? ['InvokeWithComputation'] : [])]
    : stage === 'shield' ? ['WriteOnce', 'Append', 'TransferFrom', 'EmitDeposit', 'EmitEncNoteCreated']
    : ['WriteOnce', 'Append', 'EmitEncNoteCreated', 'EmitNoteUsed', ...(Object.hasOwn(modes, stage) ? ['InvokeWithComputation'] : [])];
  for (const [index, action] of actions.entries()) {
    const kind = kinds[index], value = action.unwrap();
    if (!permitted.includes(kind)) throw Error('Proof contains a public or unsupported value operation.');
    if (kind === 'WriteOnce') inputs++;
    if (kind === 'EmitEncNoteCreated') outputs++;
    if (kind === 'Append' && stage === 'registerRecipientB' && !same(value.recipient_addr, addressOf(recipient))) throw Error('Registration channel targets another recipient.');
    if (kind === 'EmitViewingKeySet') {
      const owner = stage === 'setup' ? addressOf(escrow) : addressOf(recipient);
      if (!owner || !same(value.user_addr, owner)) throw Error('Registration identity differs from the reviewed owner.');
      const publicKey = stage === 'setup' ? escrow?.publicKey : recipient?.publicKey;
      if (publicKey && !same(value.public_key, publicKey)) throw Error('Registration viewing key differs from the reviewed key.');
      registrations++;
    }
    if (kind === 'InvokeWithComputation') {
      callbacks++;
      if (index !== actions.length - 1) throw Error('Callback must be the final action.');
      if (stage === 'chat') {
        if (!chatAddress || !same(value.contract_address, chatAddress) || !Array.isArray(value.calldata) || value.calldata.length < 3) throw Error('Expected the encrypted Chat callback.');
        if (expectedCallback && !sequence(value.calldata, expectedCallback)) throw Error('Chat callback differs from the reviewed encrypted payload.');
        if (record.replaySlot && !same(value.calldata[0], record.replaySlot)) throw Error('Chat replay slot differs.');
        if (record.payloadCommitment && !same(value.calldata[1], record.payloadCommitment)) throw Error('Chat payload commitment differs.');
      } else if (!addressOf(escrow) || !same(value.contract_address, addressOf(escrow)) || !sequence(value.calldata, [domain('APP20_JOINT_COMPUTE_V1'), modes[stage]])) throw Error('Escrow callback differs from the approved operation.');
    }
    if (kind === 'TransferFrom' || kind === 'EmitDeposit') {
      if (!same(kind === 'TransferFrom' ? value.from_addr : value.user_addr, publicInput.owner) || !same(value.token, publicInput.token) || !same(value.amount, publicInput.amount) || BigInt(publicInput.amount) <= 0n) throw Error('Public shielding input differs from the reviewed amount, token or owner.');
      if (kind === 'TransferFrom') transfersFrom++; else deposits++;
    }
  }
  if ((stage === 'chat' || Object.hasOwn(modes, stage)) && callbacks !== 1) throw Error('Required callback is missing.');
  if (inputs === 0) throw Error('Proof lacks replay protection.');
  if ((stage === 'registerRecipientB' || stage === 'setup') && registrations !== 1) throw Error('Expected exactly one account registration.');
  if (stage === 'shield' && (transfersFrom !== 1 || deposits !== 1 || outputs === 0)) throw Error('Shielding must create an encrypted note for the exact public deposit.');
  if (['chat', 'private-transfer', 'fundA', 'fundB', 'settle', 'refundA', 'refundB'].includes(stage) && (outputs === 0 || !kinds.includes('EmitNoteUsed'))) throw Error('Encrypted transfer proof lacks spent notes or outputs.');
  const proofId = createHash('sha256').update(JSON.stringify({ call, facts: proof.proofFacts })).digest('hex');
  return { call, proof, proofId, mode: stage, baseBlock: { number: baseNumber, hash: hex(facts[5]) }, publicActionKinds: kinds, publicInputs: stage === 'shield' ? [{ owner: hex(publicInput.owner), token: hex(publicInput.token), amount: BigInt(publicInput.amount).toString() }] : [] };
}
