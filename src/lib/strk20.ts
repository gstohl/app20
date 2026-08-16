import type { WALLET_API } from "@starknet-io/types-js";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { ProviderInterface, WalletAccountV6 } from "starknet";
import { hash, num, TransactionExecutionStatus, walletV6 } from "starknet";
import type { EncryptedMailRecord } from "./mail";
import { assertSettlesStrk, type OfferPayload } from "./otc";
import { addrSTRK } from "../utils/constants";

export const MIN_STRK20_WALLET_API = "0.10";
export const STRK20_WAIT_TIMEOUT_MS = 20 * 60 * 1_000;
export const POOL_ADDRESS_PLACEHOLDER = "${poolAddress}";
export const OPEN_NOTE_ID_PLACEHOLDER = "${openNoteIds[0]}";

export type MailInvokeBatchInput = {
  helperAddress: string;
  recoveryAddress: string;
  record: EncryptedMailRecord;
  tokenAddress?: string;
  /** Non-zero makes the helper reject a replay of this exact action on-chain. */
  actionId?: string;
};

/**
 * Payer-owned attempt ids are 32 random bytes, which can exceed felt252. Hash
 * them into field-safe nullifiers. A reserved attempt reuses its id, while a
 * proven revert gets a fresh attempt; the helper's on-chain nullifier remains
 * the final duplicate-submission authority.
 */
export function computeActionId(kind: string, id: string): string {
  return num.toHex(hash.starknetKeccak(`quietline/action/v1/${kind}/${id}`));
}

export type MemoTransferBatchInput = MailInvokeBatchInput & {
  recipient: string;
  amount: string | bigint;
};

export type OtcAcceptBatchInput = MailInvokeBatchInput & {
  offer: OfferPayload;
  /** Payer-owned random attempt nullifier, persisted before wallet submission. */
  actionId: string;
};

function assertConfiguredHelper(address: string): void {
  try {
    if (BigInt(address) === 0n) throw new Error();
  } catch {
    throw new Error("A deployed mail helper is required before sending.");
  }
}

function baseUnitAmountHex(amount: string | bigint): string {
  if (typeof amount === "string" && !/^(?:0|[1-9]\d*)$/.test(amount)) {
    throw new Error("Transfer amount must be a decimal base-unit string.");
  }
  const parsed = BigInt(amount);
  if (parsed <= 0n)
    throw new Error("Transfer amount must be greater than zero.");
  return num.toHex(parsed);
}

function buildMailInvokeAction({
  helperAddress,
  record,
  tokenAddress = addrSTRK,
  actionId = "0x0",
}: MailInvokeBatchInput): WALLET_API.STRK20_INVOKE_ACTION {
  assertConfiguredHelper(helperAddress);
  return {
    type: "invoke",
    contract: helperAddress,
    calldata: [
      tokenAddress,
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
      record.ephemeralPub[0],
      record.ephemeralPub[1],
      num.toHex(record.viewTag),
      record.nonce[0],
      record.nonce[1],
      num.toHex(record.ciphertextFelts.length),
      ...record.ciphertextFelts,
      actionId,
    ],
  };
}

function buildRecoveryOpenNoteAction(
  token: string,
  recipient: string,
): WALLET_API.STRK20_TRANSFER_ACTION {
  return { type: "transfer", token, amount: "OPEN", recipient };
}

/** Message-only envelopes create the recovery note consumed by the invoke. */
export function buildMailInvokeActions(
  input: MailInvokeBatchInput,
): WALLET_API.STRK20_ACTION[] {
  const token = input.tokenAddress ?? addrSTRK;
  return [
    buildRecoveryOpenNoteAction(token, input.recoveryAddress),
    buildMailInvokeAction({ ...input, tokenAddress: token }),
  ];
}

/** Builds a private transfer, recovery open note, then encrypted memo invoke. */
export function buildMemoTransferActions({
  recipient,
  amount,
  ...mail
}: MemoTransferBatchInput): WALLET_API.STRK20_ACTION[] {
  const token = mail.tokenAddress ?? addrSTRK;
  return [
    {
      type: "transfer",
      token,
      amount: baseUnitAmountHex(amount),
      recipient,
    },
    buildRecoveryOpenNoteAction(token, mail.recoveryAddress),
    buildMailInvokeAction({ ...mail, tokenAddress: token }),
  ];
}

/** OTC v1 always transfers the offered STRK give leg to the offerer. */
export function buildOtcAcceptActions({
  offer,
  ...mail
}: OtcAcceptBatchInput): WALLET_API.STRK20_ACTION[] {
  assertSettlesStrk(offer);
  return buildMemoTransferActions({
    ...mail,
    tokenAddress: addrSTRK,
    recipient: offer.offerer,
    amount: offer.give.amount,
    actionId: mail.actionId,
  });
}

export const STRK20_REQUIRED_ACCOUNT_METHODS = [
  "strk20InvokeTransaction",
  "strk20Balances",
] as const;

export type Strk20AccountMethod =
  (typeof STRK20_REQUIRED_ACCOUNT_METHODS)[number];

export type Strk20Capability = {
  supported: boolean;
  versionSupported: boolean;
  walletName: string;
  /** Wallet Standard version exposed by the discovered wallet. */
  walletVersion?: string;
  walletApiVersions: string[];
  specVersions: string[];
  accountMethods: Record<Strk20AccountMethod, boolean>;
  missingMethods: Strk20AccountMethod[];
  declarationErrors: {
    walletApi?: string;
    specs?: string;
  };
};

export type Strk20CapabilityInput = {
  walletName: string;
  walletVersion?: string;
  walletApiVersions: readonly unknown[];
  specVersions: readonly unknown[];
  account?: unknown;
  declarationErrors?: Strk20Capability["declarationErrors"];
};

/** STRK20 wallet methods landed in Wallet API 0.10. */
export function supportsWalletApi010(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)/i.exec(version.trim());
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || (major === 0 && minor >= 10);
}

/** Evaluate declarations and runtime methods without invoking a private API. */
export function evaluateStrk20Capability({
  walletName,
  walletVersion,
  walletApiVersions: rawWalletApiVersions,
  specVersions: rawSpecVersions,
  account,
  declarationErrors = {},
}: Strk20CapabilityInput): Strk20Capability {
  const walletApiVersions = rawWalletApiVersions.map(String);
  const specVersions = rawSpecVersions.map(String);
  const accountRecord =
    account && (typeof account === "object" || typeof account === "function")
      ? (account as Record<string, unknown>)
      : undefined;
  const accountMethods = Object.fromEntries(
    STRK20_REQUIRED_ACCOUNT_METHODS.map((method) => [
      method,
      typeof accountRecord?.[method] === "function",
    ]),
  ) as Record<Strk20AccountMethod, boolean>;
  const missingMethods = STRK20_REQUIRED_ACCOUNT_METHODS.filter(
    (method) => !accountMethods[method],
  );
  const versionSupported = [...walletApiVersions, ...specVersions].some(
    supportsWalletApi010,
  );

  return {
    supported: versionSupported && missingMethods.length === 0,
    versionSupported,
    walletName,
    walletVersion,
    walletApiVersions,
    specVersions,
    accountMethods,
    missingMethods,
    declarationErrors,
  };
}

function capabilityError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return typeof error === "string" && error.trim()
    ? error
    : "The wallet did not answer this metadata request.";
}

/**
 * Detect dapp-facing STRK20 support from declarations and connected-account
 * methods. This stays metadata-only: querying private balances as a feature
 * probe can prompt, fail for unrelated reasons, and leak an unnecessary
 * request.
 */
export async function detectStrk20Capability(
  wallet: WalletWithStarknetFeatures,
  account: unknown,
): Promise<Strk20Capability> {
  const [walletApiResult, specsResult] = await Promise.allSettled([
    walletV6.supportedWalletApi(wallet),
    walletV6.supportedSpecs(wallet),
  ]);

  return evaluateStrk20Capability({
    walletName: wallet.name,
    walletVersion:
      typeof wallet.version === "string" ? wallet.version : undefined,
    walletApiVersions:
      walletApiResult.status === "fulfilled" ? walletApiResult.value : [],
    specVersions:
      specsResult.status === "fulfilled" ? specsResult.value : [],
    account,
    declarationErrors: {
      ...(walletApiResult.status === "rejected"
        ? { walletApi: capabilityError(walletApiResult.reason) }
        : {}),
      ...(specsResult.status === "rejected"
        ? { specs: capabilityError(specsResult.reason) }
        : {}),
    },
  });
}

/** Stable plain text for copying into a wallet-support report. */
export function formatStrk20CapabilityDiagnostic(
  capability: Strk20Capability,
): string {
  const list = (values: string[]) =>
    values.length ? JSON.stringify(values) : "[]";
  return [
    "Quietline STRK20 capability diagnostic",
    `Wallet: ${capability.walletName}`,
    `Wallet Standard version: ${capability.walletVersion ?? "not exposed"}`,
    `Required dapp-facing Wallet API: >= ${MIN_STRK20_WALLET_API}`,
    `walletApiVersions: ${list(capability.walletApiVersions)}`,
    `specVersions: ${list(capability.specVersions)}`,
    ...STRK20_REQUIRED_ACCOUNT_METHODS.map(
      (method) =>
        `${method}: ${capability.accountMethods[method] ? "present" : "missing"}`,
    ),
    `Version requirement: ${capability.versionSupported ? "met" : "not met"}`,
    `Overall support: ${capability.supported ? "supported" : "not supported"}`,
    ...(capability.declarationErrors.walletApi
      ? [`walletApiVersions query error: ${capability.declarationErrors.walletApi}`]
      : []),
    ...(capability.declarationErrors.specs
      ? [`specVersions query error: ${capability.declarationErrors.specs}`]
      : []),
  ].join("\n");
}

export type TransactionLifecycleState =
  | "reserved"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "unknown";

export class Strk20WaitTimeoutError extends Error {
  readonly transactionHash: string;

  constructor(transactionHash: string, timeoutMs: number) {
    super(
      `Transaction ${transactionHash} was submitted, but confirmation was not observed within ${Math.max(1, Math.round(timeoutMs / 60_000))} minute(s). Its outcome is unknown; check the transaction before retrying.`,
    );
    this.name = "Strk20WaitTimeoutError";
    this.transactionHash = transactionHash;
  }
}

export class Strk20RevertedError extends Error {
  readonly transactionHash: string;
  readonly receipt?: unknown;

  constructor(transactionHash: string, receipt?: unknown, cause?: unknown) {
    super(
      `Transaction ${transactionHash} reverted or was rejected. No successful value movement was confirmed.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "Strk20RevertedError";
    this.transactionHash = transactionHash;
    this.receipt = receipt;
  }
}

export class Strk20UnknownOutcomeError extends Error {
  readonly transactionHash: string;
  readonly receipt?: unknown;

  constructor(transactionHash: string, receipt?: unknown, cause?: unknown) {
    super(
      `Transaction ${transactionHash} was submitted, but its successful execution could not be proven. Its outcome is unknown; check the transaction before retrying.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "Strk20UnknownOutcomeError";
    this.transactionHash = transactionHash;
    this.receipt = receipt;
  }
}

export class Strk20SubmissionCallbackError extends Error {
  readonly transactionHash: string;

  constructor(transactionHash: string, cause: unknown) {
    super(
      `Transaction ${transactionHash} succeeded, but Quietline could not persist its submitted state. Local verification remains false; reconcile the transaction before retrying.`,
      { cause },
    );
    this.name = "Strk20SubmissionCallbackError";
    this.transactionHash = transactionHash;
  }
}

function receiptValue(receipt: unknown): Record<string, unknown> | undefined {
  if (!receipt || typeof receipt !== "object") return undefined;
  const outer = receipt as Record<string, unknown>;
  const value = outer.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : outer;
}

function statusText(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function assertSuccessfulReceipt(
  transactionHash: string,
  receipt: unknown,
): void {
  const value = receiptValue(receipt);
  const execution = statusText(
    value?.execution_status ?? value?.executionStatus,
  );
  const finality = statusText(value?.finality_status ?? value?.finalityStatus);
  const status = statusText(value?.status);
  const combined = [execution, finality, status].filter(Boolean);

  if (
    combined.some((candidate) => ["REVERTED", "REJECTED"].includes(candidate))
  ) {
    throw new Strk20RevertedError(transactionHash, receipt);
  }
  if (execution !== TransactionExecutionStatus.SUCCEEDED) {
    throw new Strk20UnknownOutcomeError(transactionHash, receipt);
  }
}

function isRevertedOrRejected(error: unknown): boolean {
  if (error instanceof Strk20RevertedError) return true;
  if (!error) return false;
  const candidate =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "object"
        ? JSON.stringify(error)
        : String(error);
  return /\b(?:REVERTED|REJECTED)\b/i.test(candidate);
}

async function waitForStrk20Transaction(
  provider: ProviderInterface,
  transactionHash: string,
  timeoutMs = STRK20_WAIT_TIMEOUT_MS,
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const receipt = await Promise.race([
      provider.waitForTransaction(transactionHash, {
        retries: 400,
        retryInterval: 3_000,
        successStates: [TransactionExecutionStatus.SUCCEEDED],
        errorStates: [
          TransactionExecutionStatus.REVERTED,
          // Older RPC/wallet bridges may still surface REJECTED as a status.
          "REJECTED" as never,
        ],
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Strk20WaitTimeoutError(transactionHash, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
    assertSuccessfulReceipt(transactionHash, receipt);
    return receipt;
  } catch (error: unknown) {
    if (error instanceof Strk20WaitTimeoutError) throw error;
    if (error instanceof Strk20RevertedError) throw error;
    if (isRevertedOrRejected(error)) {
      throw new Strk20RevertedError(transactionHash, undefined, error);
    }
    if (error instanceof Strk20UnknownOutcomeError) throw error;
    throw new Strk20UnknownOutcomeError(transactionHash, undefined, error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type SubmitActionsOptions = {
  timeoutMs?: number;
  onSubmitted?: (transactionHash: string) => void;
};

export function transactionStateFromError(
  error: unknown,
): "reverted" | "unknown" | undefined {
  if (error instanceof Strk20RevertedError) return "reverted";
  if (
    error instanceof Strk20WaitTimeoutError ||
    error instanceof Strk20UnknownOutcomeError ||
    error instanceof Strk20SubmissionCallbackError
  ) {
    return "unknown";
  }
  return undefined;
}

export function transactionHashFromError(error: unknown): string | undefined {
  return error instanceof Strk20WaitTimeoutError ||
    error instanceof Strk20RevertedError ||
    error instanceof Strk20UnknownOutcomeError ||
    error instanceof Strk20SubmissionCallbackError
    ? error.transactionHash
    : undefined;
}

/** Submit exactly one STRK20 action batch and confirm execution fail-closed. */
export async function submitActions(
  account: WalletAccountV6,
  provider: ProviderInterface,
  actions: WALLET_API.STRK20_ACTION[],
  options: SubmitActionsOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  const { transaction_hash: transactionHash } =
    await account.strk20InvokeTransaction(actions);

  let submissionCallbackError: unknown;
  try {
    options.onSubmitted?.(transactionHash);
  } catch (error: unknown) {
    submissionCallbackError = error;
  }

  const receipt = await waitForStrk20Transaction(
    provider,
    transactionHash,
    options.timeoutMs,
  );
  if (submissionCallbackError !== undefined) {
    throw new Strk20SubmissionCallbackError(
      transactionHash,
      submissionCallbackError,
    );
  }

  return { transactionHash, receipt };
}

export type SubmitMailInput = MailInvokeBatchInput & {
  account: WalletAccountV6;
  provider: ProviderInterface;
};

export type SubmitMemoTransferInput = MemoTransferBatchInput & {
  account: WalletAccountV6;
  provider: ProviderInterface;
};

export type SubmitOtcAcceptInput = OtcAcceptBatchInput & {
  account: WalletAccountV6;
  provider: ProviderInterface;
};

/** Submits one recovery-open-note + invoke batch for non-payment envelopes. */
export function submitMail(
  { account, provider, ...batch }: SubmitMailInput,
  options: SubmitActionsOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  return submitActions(
    account,
    provider,
    buildMailInvokeActions(batch),
    options,
  );
}

/** Submits one wallet batch containing a transfer, recovery note, and memo. */
export function submitMemoTransfer(
  { account, provider, ...batch }: SubmitMemoTransferInput,
  options: SubmitActionsOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  return submitActions(
    account,
    provider,
    buildMemoTransferActions(batch),
    options,
  );
}

/** A single wallet call settles the STRK give leg and posts the accept memo. */
export function submitOtcAccept(
  { account, provider, ...batch }: SubmitOtcAcceptInput,
  options: SubmitActionsOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  return submitActions(
    account,
    provider,
    buildOtcAcceptActions(batch),
    options,
  );
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const parts = [value.code, value.message, value.reason]
      .filter((part) => typeof part === "string" || typeof part === "number")
      .map(String);
    if (parts.length) return parts.join(": ");
  }
  return "The wallet did not complete the action.";
}

/** Convert wallet/protocol rejections into UI state instead of uncaught errors. */
export function strk20ErrorMessage(error: unknown): string {
  const details = errorDetails(error);

  if (
    /screen|sanction|compliance|blocked depositor|privacy_leak/i.test(details)
  ) {
    return "The deposit was declined by STRK20 protocol screening. No privacy action was submitted.";
  }
  if (/user.*(refus|reject)|rejected by user/i.test(details)) {
    return "The wallet request was declined.";
  }

  return details;
}
