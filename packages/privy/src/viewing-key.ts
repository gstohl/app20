import {
  ec,
  num,
  type Account,
  type BigNumberish,
  type TypedData,
} from "starknet";
import {
  VIEWING_KEY_MESSAGE,
  VIEWING_KEY_TYPED_DATA_NAME,
  VIEWING_KEY_TYPED_DATA_VERSION,
} from "./constants.js";

const poseidonHashMany = ec.starkCurve.poseidonHashMany;
const CURVE_ORDER = ec.starkCurve.CURVE.n;
const HALF_ORDER = CURVE_ORDER >> 1n;
const KDF_ROUNDS = 1000;
const BYTES_PER_FELT = 31;

/**
 * Canonical viewing key accepted by the privacy pool:
 * a non-zero scalar below half the STARK curve order.
 */
export function canonicalViewingKey(key: bigint): bigint {
  let scalar = key % CURVE_ORDER;
  if (scalar >= HALF_ORDER) scalar = CURVE_ORDER - scalar;
  return scalar === 0n || scalar >= HALF_ORDER ? 1n : scalar;
}

function passphraseToFelts(passphrase: string): bigint[] {
  const bytes = new TextEncoder().encode(passphrase);
  const felts: bigint[] = [BigInt(bytes.length)];
  for (let offset = 0; offset < bytes.length; offset += BYTES_PER_FELT) {
    let limb = 0n;
    for (const byte of bytes.subarray(offset, offset + BYTES_PER_FELT)) {
      limb = (limb << 8n) | BigInt(byte);
    }
    felts.push(limb);
  }
  return felts;
}

/**
 * Official STRK20 passphrase KDF (salted with the account address, 1000 Poseidon rounds).
 * Use only when the user explicitly supplies a passphrase.
 */
export function deriveViewingKeyFromPassphrase(
  passphrase: string,
  address: BigNumberish,
): bigint {
  const salt = num.toBigInt(address);
  let key = poseidonHashMany([...passphraseToFelts(passphrase), salt]);
  for (let round = 1; round < KDF_ROUNDS; round++) {
    key = poseidonHashMany([key, salt]);
  }
  return canonicalViewingKey(key);
}

export function viewingKeyTypedData(chainId: string): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Message: [{ name: "purpose", type: "felt" }],
    },
    primaryType: "Message",
    domain: {
      name: VIEWING_KEY_TYPED_DATA_NAME,
      version: VIEWING_KEY_TYPED_DATA_VERSION,
      chainId,
      revision: "1",
    },
    message: { purpose: VIEWING_KEY_MESSAGE },
  };
}

/**
 * Default production path: sign a deterministic SNIP-12 message with the
 * Privy-backed account and fold the signature into a canonical viewing key.
 * Recoverable, never persisted, and unique per (wallet, network).
 */
export async function deriveViewingKeyFromAccount(
  account: Account,
  chainId: string,
): Promise<bigint> {
  const signature = await account.signMessage(viewingKeyTypedData(chainId));
  const parts = Array.isArray(signature)
    ? signature.map((part) => num.toBigInt(part))
    : [
        num.toBigInt((signature as { r: bigint }).r),
        num.toBigInt((signature as { s: bigint }).s),
      ];
  const material = poseidonHashMany([num.toBigInt(account.address), ...parts]);
  return canonicalViewingKey(material);
}

export function memoizedViewingKeyProvider(
  getViewingKey: () => Promise<bigint>,
) {
  let cached: bigint | undefined;
  let pending: Promise<bigint> | undefined;
  return {
    getViewingKey: () => {
      if (cached !== undefined) return Promise.resolve(cached);
      pending ??= getViewingKey()
        .then((viewingKey) => {
          cached = viewingKey;
          return viewingKey;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
