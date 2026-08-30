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
/** Reviewed amount atomically withdrawn to App20Mail and returned to the OPEN note. */
export const APP20_HELPER_FUNDING_BASE_UNITS = 7n;

export type MailInvokeBatchInput = {
  helperAddress: string;
  recoveryAddress: string;
  record: EncryptedMailRecord;
  tokenAddress?: string;
  /** Explicit private withdrawal that funds the helper's recovery OPEN note. */
  helperFundingAmount: string | bigint;
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
  return num.toHex(hash.starknetKeccak(`app20/action/v1/${kind}/${id}`));
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

function buildHelperFundingAction(
  token: string,
  helperAddress: string,
  amount: string | bigint,
): WALLET_API.STRK20_WITHDRAW_ACTION {
  return {
    type: "withdraw",
    token,
    amount: baseUnitAmountHex(amount),
    recipient: helperAddress,
  };
}

function buildRecoveryOpenNoteAction(
  token: string,
  recipient: string,
): WALLET_API.STRK20_TRANSFER_ACTION {
  return { type: "transfer", token, amount: "OPEN", recipient };
}

/** Message-only envelopes fund the helper, then create the recovery OPEN note. */
export function buildMailInvokeActions(
  input: MailInvokeBatchInput,
): WALLET_API.STRK20_ACTION[] {
  const token = input.tokenAddress ?? addrSTRK;
  return [
    buildHelperFundingAction(
      token,
      input.helperAddress,
      input.helperFundingAmount,
    ),
    buildRecoveryOpenNoteAction(token, input.recoveryAddress),
    buildMailInvokeAction({ ...input, tokenAddress: token }),
  ];
}

/** Builds private transfer, helper funding, recovery OPEN note, then invoke. */
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
    buildHelperFundingAction(
      token,
      mail.helperAddress,
      mail.helperFundingAmount,
    ),
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
    specVersions: specsResult.status === "fulfilled" ? specsResult.value : [],
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
    "APP20 STRK20 capability diagnostic",
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
      ? [
          `walletApiVersions query error: ${capability.declarationErrors.walletApi}`,
        ]
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

export class Strk20NotSubmittedError extends Error {
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Transaction policy failed before the wallet submission call; no transaction was submitted. ${reason}`,
      { cause },
    );
    this.name = "Strk20NotSubmittedError";
  }
}

export class Strk20DeterministicSubmissionRejectedError extends Error {
  constructor(reason: string, cause: unknown) {
    super(
      `${reason} No transaction was submitted. Shield funds first, then retry explicitly.`,
      { cause },
    );
    this.name = "Strk20DeterministicSubmissionRejectedError";
  }
}

export class Strk20WalletSubmissionUnknownError extends Error {
  constructor(cause: unknown) {
    super(
      "The wallet submission call was entered, but no transaction hash was returned. Its outcome is unknown; reconcile before retrying.",
      { cause },
    );
    this.name = "Strk20WalletSubmissionUnknownError";
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
      `Transaction ${transactionHash} succeeded, but Mail could not persist its submitted state. Local verification remains false; reconcile the transaction before retrying.`,
      { cause },
    );
    this.name = "Strk20SubmissionCallbackError";
    this.transactionHash = transactionHash;
  }
}

const LOCALNET_INSUFFICIENT_BALANCE_CODE =
  "APP20_LOCALNET_PRE_SUBMISSION_INSUFFICIENT_BALANCE";
const INSUFFICIENT_BALANCE_MESSAGE =
  /^Insufficient balance for token \S+: need \d+ more \(total available: \d+\)$/;

/**
 * The build-gated localnet wallet attaches this attestation only to the known
 * HTTP 400 note-selection rejection raised before executeOutside is called.
 * Unmarked wallet errors remain unknown even when their text looks similar.
 */
function deterministicPreSubmissionReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  const message = candidate.message;
  return candidate.app20SubmissionOutcome === "not-submitted" &&
    candidate.code === LOCALNET_INSUFFICIENT_BALANCE_CODE &&
    candidate.httpStatus === 400 &&
    typeof message === "string" &&
    INSUFFICIENT_BALANCE_MESSAGE.test(message)
    ? message
    : undefined;
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

export async function waitForStrk20Transaction(
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

export type SubmitLifecycleOptions = {
  timeoutMs?: number;
  /** Durably fences retries; policy is re-run after it and before the wallet call. */
  beforeWalletSubmission?: () => void | Promise<void>;
  onSubmitted?: (transactionHash: string) => void | Promise<void>;
};

export type SubmitActionsOptions = SubmitLifecycleOptions & {
  /** Must reassert network and wallet policy immediately before submission. */
  policy: () => void;
};

export function transactionStateFromError(
  error: unknown,
): "reverted" | "unknown" | undefined {
  if (error instanceof Strk20NotSubmittedError) return "reverted";
  if (error instanceof Strk20DeterministicSubmissionRejectedError)
    return "reverted";
  if (error instanceof Strk20RevertedError) return "reverted";
  if (
    error instanceof Strk20WaitTimeoutError ||
    error instanceof Strk20WalletSubmissionUnknownError ||
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
  options: SubmitActionsOptions,
): Promise<{ transactionHash: string; receipt: unknown }> {
  try {
    options.policy();
  } catch (error: unknown) {
    throw new Strk20NotSubmittedError(error);
  }
  if (options.beforeWalletSubmission) {
    try {
      await options.beforeWalletSubmission();
    } catch (error: unknown) {
      // The fence may have committed before its response was lost. Treat the
      // boundary as unknown rather than claiming the wallet was never entered.
      throw new Strk20WalletSubmissionUnknownError(error);
    }
    try {
      // The awaited fence is a TOCTOU boundary: re-run the complete caller
      // policy immediately before entering the wallet method.
      options.policy();
    } catch (error: unknown) {
      throw new Strk20WalletSubmissionUnknownError(error);
    }
  }
  let submitted: { transaction_hash: string };
  try {
    submitted = await account.strk20InvokeTransaction(actions);
  } catch (error: unknown) {
    const deterministicReason = deterministicPreSubmissionReason(error);
    if (deterministicReason) {
      throw new Strk20DeterministicSubmissionRejectedError(
        deterministicReason,
        error,
      );
    }
    throw new Strk20WalletSubmissionUnknownError(error);
  }
  const { transaction_hash: transactionHash } = submitted;

  let submissionCallbackError: unknown;
  try {
    await options.onSubmitted?.(transactionHash);
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
  policy: () => void;
};

export type SubmitMemoTransferInput = MemoTransferBatchInput & {
  account: WalletAccountV6;
  provider: ProviderInterface;
  policy: () => void;
};

export type SubmitOtcAcceptInput = OtcAcceptBatchInput & {
  account: WalletAccountV6;
  provider: ProviderInterface;
  policy: () => void;
};

/** Submits one recovery-open-note + invoke batch for non-payment envelopes. */
export function submitMail(
  { account, provider, policy, ...batch }: SubmitMailInput,
  options: SubmitLifecycleOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  return submitActions(account, provider, buildMailInvokeActions(batch), {
    ...options,
    policy,
  });
}

/** Submits one wallet batch containing a transfer, recovery note, and memo. */
export function submitMemoTransfer(
  { account, provider, policy, ...batch }: SubmitMemoTransferInput,
  options: SubmitLifecycleOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  return submitActions(account, provider, buildMemoTransferActions(batch), {
    ...options,
    policy,
  });
}

/** A single wallet call settles the STRK give leg and posts the accept memo. */
export function submitOtcAccept(
  { account, provider, policy, ...batch }: SubmitOtcAcceptInput,
  options: SubmitLifecycleOptions = {},
): Promise<{ transactionHash: string; receipt: unknown }> {
  return submitActions(account, provider, buildOtcAcceptActions(batch), {
    ...options,
    policy,
  });
}

/** Parse one token's exact private balance from the declared Wallet API shape. */
export function readStrk20PrivateBalance(raw: unknown, token: string): bigint {
  const value =
    raw && typeof raw === "object" && "value" in raw
      ? (raw as { value?: unknown }).value
      : raw;
  if (!Array.isArray(value)) {
    throw new Error(
      "The wallet returned an unfamiliar private-balance response.",
    );
  }

  const expectedToken = num.toBigInt(token);
  for (const entry of value) {
    const tuple = Array.isArray(entry) ? entry : [];
    const record =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const entryToken = record.token ?? record.token_address ?? tuple[0];
    let matches = false;
    try {
      matches = num.toBigInt(String(entryToken)) === expectedToken;
    } catch {
      continue;
    }
    if (!matches) continue;

    const amount = record.amount ?? record.balance ?? tuple[1];
    try {
      const parsed = num.toBigInt(String(amount));
      if (parsed < 0n) throw new Error();
      return parsed;
    } catch {
      throw new Error(
        "The wallet returned an invalid private balance for STRK.",
      );
    }
  }
  return 0n;
}

export class Strk20PrivateBalanceUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      "The wallet's private STRK balance could not be verified. Nothing was submitted; check the wallet and retry.",
      { cause },
    );
    this.name = "Strk20PrivateBalanceUnavailableError";
  }
}

export class InsufficientPrivateStrkBalanceError extends Error {
  readonly required: bigint;

  constructor(required: bigint) {
    super(
      `Private STRK is insufficient for this batch, which requires ${required} base units. Shield STRK first, then retry explicitly. Nothing was submitted.`,
    );
    this.name = "InsufficientPrivateStrkBalanceError";
    this.required = required;
  }
}

function exactPositiveBaseUnits(amount: string | bigint): bigint {
  if (typeof amount === "string" && !/^(?:0|[1-9]\d*)$/.test(amount)) {
    throw new Error("Batch amounts must be decimal base-unit strings.");
  }
  const parsed = BigInt(amount);
  if (parsed <= 0n) throw new Error("Batch amounts must be greater than zero.");
  return parsed;
}

/**
 * Fail closed before submission unless the wallet-declared private balance
 * covers every withdrawal/transfer in the batch.
 */
export async function assertPrivateStrk20BatchBalance(
  account: WalletAccountV6,
  token: string,
  amounts: readonly (string | bigint)[],
): Promise<{ required: bigint; balance: bigint }> {
  const required = amounts.reduce<bigint>(
    (total, amount) => total + exactPositiveBaseUnits(amount),
    0n,
  );
  if (required <= 0n) throw new Error("A private batch must contain value.");

  let balance: bigint;
  try {
    const raw = await account.strk20Balances([token]);
    balance = readStrk20PrivateBalance(raw, token);
  } catch (error: unknown) {
    if (error instanceof InsufficientPrivateStrkBalanceError) throw error;
    throw new Strk20PrivateBalanceUnavailableError(error);
  }
  if (balance < required) {
    throw new InsufficientPrivateStrkBalanceError(required);
  }
  return { required, balance };
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
