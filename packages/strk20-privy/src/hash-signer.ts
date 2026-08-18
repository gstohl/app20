import {
  CallData,
  ETransactionVersion3,
  ec,
  hash,
  stark,
  transaction,
  typedData,
  type Call,
  type DeclareSignerDetails,
  type DeployAccountSignerDetails,
  type InvocationsSignerDetails,
  type Signature,
  type SignerInterface,
  type TypedData,
} from "starknet";
import { PrivyError } from "./errors.js";

export type StarkSignature = readonly [string, string];

/** Normalize a Starknet transaction or message hash for a raw-signing API. */
export function normalizeStarknetHash(hashValue: string): `0x${string}` {
  return (
    hashValue.startsWith("0x") ? hashValue : `0x${hashValue}`
  ) as `0x${string}`;
}

/** Split Privy's 64-byte Stark signature into the `[r, s]` expected by starknet.js. */
export function splitStarkSignature(signature: string): [string, string] {
  const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) {
    throw new PrivyError(
      `Unexpected Starknet signature length or encoding: ${hex.length} hex chars.`,
    );
  }
  return [`0x${hex.slice(0, 64)}`, `0x${hex.slice(64)}`];
}

/** Verify a compact Stark ECDSA signature against Privy's x-only public key. */
export function verifyStarkSignature(
  signature: string,
  messageHash: string,
  publicKey: string,
): boolean {
  const compact = signature.replace(/^0x/, "");
  const key = publicKey.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{128}$/.test(compact) || !/^[0-9a-fA-F]+$/.test(key)) {
    return false;
  }
  const candidates =
    key.length === 130 || (key.length === 66 && /^(02|03)/i.test(key))
      ? [key]
      : key.length <= 64
        ? [`02${key.padStart(64, "0")}`, `03${key.padStart(64, "0")}`]
        : [];
  return candidates.some((candidate) => {
    try {
      return ec.starkCurve.verify(
        compact,
        normalizeStarknetHash(messageHash),
        candidate,
      );
    } catch {
      return false;
    }
  });
}

/**
 * Base `SignerInterface` for wallets that expose raw Stark-hash signing.
 * Hash construction remains local; subclasses choose the authorization transport.
 */
export abstract class StarknetHashSigner implements SignerInterface {
  constructor(private readonly publicKey: string) {}

  async getPubKey(): Promise<string> {
    return this.publicKey;
  }

  abstract signRaw(messageHash: string): Promise<[string, string]>;

  async signMessage(
    typed: TypedData,
    accountAddress: string,
  ): Promise<Signature> {
    return this.signRaw(typedData.getMessageHash(typed, accountAddress));
  }

  async signTransaction(
    calls: Call[],
    details: InvocationsSignerDetails,
  ): Promise<Signature> {
    const compiledCalldata = transaction.getExecuteCalldata(
      calls,
      details.cairoVersion,
    );
    if (!isV3(details.version)) {
      throw new PrivyError(
        `Unsupported invoke transaction version: ${String(details.version)}`,
      );
    }
    return this.signRaw(
      hash.calculateInvokeTransactionHash({
        ...details,
        senderAddress: details.walletAddress,
        compiledCalldata,
        version: details.version,
        nonceDataAvailabilityMode: stark.intDAM(
          details.nonceDataAvailabilityMode,
        ),
        feeDataAvailabilityMode: stark.intDAM(details.feeDataAvailabilityMode),
      }),
    );
  }

  async signDeployAccountTransaction(
    details: DeployAccountSignerDetails,
  ): Promise<Signature> {
    const compiledConstructorCalldata = CallData.compile(
      details.constructorCalldata,
    );
    if (!isV3(details.version)) {
      throw new PrivyError(
        `Unsupported deploy-account transaction version: ${String(details.version)}`,
      );
    }
    return this.signRaw(
      hash.calculateDeployAccountTransactionHash({
        ...details,
        salt: details.addressSalt,
        compiledConstructorCalldata,
        version: details.version,
        nonceDataAvailabilityMode: stark.intDAM(
          details.nonceDataAvailabilityMode,
        ),
        feeDataAvailabilityMode: stark.intDAM(details.feeDataAvailabilityMode),
      }),
    );
  }

  async signDeclareTransaction(
    details: DeclareSignerDetails,
  ): Promise<Signature> {
    if (!isV3(details.version)) {
      throw new PrivyError(
        `Unsupported declare transaction version: ${String(details.version)}`,
      );
    }
    return this.signRaw(
      hash.calculateDeclareTransactionHash({
        ...details,
        version: details.version,
        nonceDataAvailabilityMode: stark.intDAM(
          details.nonceDataAvailabilityMode,
        ),
        feeDataAvailabilityMode: stark.intDAM(details.feeDataAvailabilityMode),
      }),
    );
  }
}

function isV3(version: unknown): boolean {
  return Object.values(ETransactionVersion3).includes(version as never);
}
