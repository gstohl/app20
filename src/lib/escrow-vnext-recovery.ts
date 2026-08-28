import { canonicalizeStarknetFelt, parseDigest256 } from "@app20/domain";
import {
  buildVnextClaimActions,
  buildVnextTimeoutActions,
  canonicalVnextOperation,
  type CanonicalVnextOperation,
  type VnextClaimOperationPayload,
  type VnextTimeoutOperationPayload,
} from "./escrow-vnext-actions";

export type VnextRecoveryAttemptStatus =
  | "not-started"
  | "preparing"
  | "submitted-unknown"
  | "reverted";

export type VnextRecoveryBinding = Readonly<{
  chainId: string;
  account: string;
  escrowAddress: string;
  escrowClassHash: string;
  app20ClaimAddress: string;
  app20ClaimClassHash: string;
  app20ClaimIdentity: string;
  dealId: string;
  commitmentDigest: string;
  poolAddress: string;
  destinationAddress: string;
  deadline: number;
  authorityRevision: number;
  attemptId: string;
}>;

export type VnextClaimRecoveryTuple = VnextRecoveryBinding &
  Readonly<{
    phase: "claim";
    buyToken: string;
    buyAmountBaseUnits: bigint;
  }>;

export type VnextRefundRecoveryTuple = VnextRecoveryBinding &
  Readonly<{
    phase: "refund";
    sellToken: string;
    sellAmountBaseUnits: bigint;
  }>;

export type VnextRecoveryTuple =
  | VnextClaimRecoveryTuple
  | VnextRefundRecoveryTuple;

export type VnextRecoveryPolicySnapshot = Readonly<{
  activeAccount: string;
  minimumAuthorityRevision: number;
  attempt: Readonly<{ id: string; status: VnextRecoveryAttemptStatus }>;
  now: number;
}>;

type RecoveryTerms = Readonly<{
  sellToken: string;
  sellAmountBaseUnits: bigint;
  buyToken: string;
  buyAmountBaseUnits: bigint;
}>;

type RecoveryObservationBase = Readonly<{
  /** Complete event/deployment binding supplied by the future quorum verifier. */
  binding: VnextRecoveryBinding;
  finalized: true;
  observedAt: number;
}>;

export type VnextClaimRecoveryObservation = RecoveryObservationBase &
  Readonly<{
    stage: "Filled";
    buyToken: string;
    buyAmountBaseUnits: bigint;
  }>;

export type VnextRefundRecoveryObservation = RecoveryObservationBase &
  Readonly<{
    stage: "Funded";
    fillObserved: false;
    sellToken: string;
    sellAmountBaseUnits: bigint;
  }>;

export type VnextRecoveryInput =
  | (VnextRecoveryBinding &
      VnextRecoveryPolicySnapshot &
      RecoveryTerms &
      Readonly<{
        phase: "claim";
        observation: VnextClaimRecoveryObservation;
      }>)
  | (VnextRecoveryBinding &
      VnextRecoveryPolicySnapshot &
      RecoveryTerms &
      Readonly<{
        phase: "refund";
        observation: VnextRefundRecoveryObservation;
      }>);

const FELT_BINDING_KEYS = [
  "account",
  "escrowAddress",
  "escrowClassHash",
  "app20ClaimAddress",
  "app20ClaimClassHash",
  "app20ClaimIdentity",
  "dealId",
  "poolAddress",
  "destinationAddress",
] as const satisfies readonly (keyof VnextRecoveryBinding)[];

function sameFelt(left: string, right: string): boolean {
  return canonicalizeStarknetFelt(left) === canonicalizeStarknetFelt(right);
}

function requireNonzeroFelt(value: string, label: string): string {
  let canonical: string;
  try {
    canonical = canonicalizeStarknetFelt(value);
  } catch {
    throw new Error(`${label} must be a canonicalizable Starknet felt.`);
  }
  if (canonical === "0x0") throw new Error(`${label} must not be zero.`);
  return canonical;
}

function requireDigest(value: string, label: string): string {
  try {
    parseDigest256(value);
  } catch {
    throw new Error(`${label} must be a canonical Digest256.`);
  }
  return value.toLowerCase();
}

function requireIdentifier(value: string, label: string): string {
  if (!value || value !== value.trim() || /\s/u.test(value)) {
    throw new Error(`${label} must be a non-empty persisted identifier.`);
  }
  return value;
}

function requirePositiveAmount(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value <= 0n || value >= 1n << 256n) {
    throw new Error(`${label} must be a positive u256 bigint.`);
  }
  return value;
}

/**
 * Purely shapes the canonical terminal operation shared with action builders.
 * It grants no authority, accepts no ABI/calldata, and cannot invoke an encoder.
 */
export function canonicalVnextRecoveryOperation(
  tuple: VnextRecoveryTuple,
): Extract<CanonicalVnextOperation, { kind: "Claim" | "Timeout" }> {
  if (tuple.phase === "claim") {
    requirePositiveAmount(tuple.buyAmountBaseUnits, "buyAmountBaseUnits");
    return canonicalVnextOperation({
      kind: "Claim",
      payload: {
        commitmentDigest: tuple.commitmentDigest,
        claimIdentity: tuple.app20ClaimIdentity,
      },
    });
  }
  if (tuple.phase === "refund") {
    requirePositiveAmount(tuple.sellAmountBaseUnits, "sellAmountBaseUnits");
    return canonicalVnextOperation({
      kind: "Timeout",
      payload: {
        commitmentDigest: tuple.commitmentDigest,
        claimIdentity: tuple.app20ClaimIdentity,
      },
    });
  }
  throw new Error("Recovery tuple phase must be claim or refund.");
}

function assertNoPrivateMaterial(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:openNoteIds?|notes?|witness(?:es)?|viewingKeys?)$/i.test(key)) {
      throw new Error(
        `Recovery input must not contain private material (${key}).`,
      );
    }
    assertNoPrivateMaterial(entry);
  }
}

function assertPolicy(
  binding: VnextRecoveryBinding,
  policy: VnextRecoveryPolicySnapshot,
): void {
  if (!sameFelt(binding.account, policy.activeAccount)) {
    throw new Error(
      "The recovery account changed after the attempt was persisted.",
    );
  }
  if (
    !Number.isSafeInteger(binding.authorityRevision) ||
    binding.authorityRevision <= 0 ||
    !Number.isSafeInteger(policy.minimumAuthorityRevision) ||
    policy.minimumAuthorityRevision <= 0 ||
    binding.authorityRevision < policy.minimumAuthorityRevision
  ) {
    throw new Error("The recovery authority revision is stale.");
  }
  if (policy.attempt.status !== "not-started") {
    throw new Error(
      "The persisted recovery attempt is already in progress or reconciled; allocate a new attempt ID.",
    );
  }
  if (policy.attempt.id !== binding.attemptId) {
    throw new Error(
      "The persisted recovery attempt ID does not match the bound tuple.",
    );
  }
  if (!Number.isSafeInteger(policy.now) || policy.now <= 0) {
    throw new Error("Recovery time must be safe-integer unix seconds.");
  }
}

function assertObservationBinding(
  expected: VnextRecoveryBinding,
  observed: VnextRecoveryBinding,
): void {
  requireIdentifier(observed.chainId, "observed chainId");
  requireIdentifier(observed.attemptId, "observed attemptId");
  requireDigest(observed.commitmentDigest, "observed commitmentDigest");
  for (const key of FELT_BINDING_KEYS) {
    if (!sameFelt(expected[key], observed[key])) {
      throw new Error(`Finalized recovery observation does not match ${key}.`);
    }
  }
  for (const key of ["chainId", "attemptId"] as const) {
    if (expected[key] !== observed[key]) {
      throw new Error(`Finalized recovery observation does not match ${key}.`);
    }
  }
  if (
    expected.commitmentDigest.toLowerCase() !==
    observed.commitmentDigest.toLowerCase()
  ) {
    throw new Error(
      "Finalized recovery observation does not match commitmentDigest.",
    );
  }
  for (const key of ["deadline", "authorityRevision"] as const) {
    if (expected[key] !== observed[key]) {
      throw new Error(`Finalized recovery observation does not match ${key}.`);
    }
  }
}

function canonicalBinding(input: VnextRecoveryBinding): VnextRecoveryBinding {
  requireIdentifier(input.chainId, "chainId");
  requireIdentifier(input.attemptId, "attemptId");
  const commitmentDigest = requireDigest(
    input.commitmentDigest,
    "commitmentDigest",
  );
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0) {
    throw new Error("Recovery deadline must be safe-integer unix seconds.");
  }
  const binding = {
    chainId: input.chainId,
    account: requireNonzeroFelt(input.account, "account"),
    escrowAddress: requireNonzeroFelt(input.escrowAddress, "escrowAddress"),
    escrowClassHash: requireNonzeroFelt(
      input.escrowClassHash,
      "escrowClassHash",
    ),
    app20ClaimAddress: requireNonzeroFelt(
      input.app20ClaimAddress,
      "app20ClaimAddress",
    ),
    app20ClaimClassHash: requireNonzeroFelt(
      input.app20ClaimClassHash,
      "app20ClaimClassHash",
    ),
    app20ClaimIdentity: requireNonzeroFelt(
      input.app20ClaimIdentity,
      "app20ClaimIdentity",
    ),
    dealId: requireNonzeroFelt(input.dealId, "dealId"),
    commitmentDigest,
    poolAddress: requireNonzeroFelt(input.poolAddress, "poolAddress"),
    destinationAddress: requireNonzeroFelt(
      input.destinationAddress,
      "destinationAddress",
    ),
    deadline: input.deadline,
    authorityRevision: input.authorityRevision,
    attemptId: input.attemptId,
  } as const;
  if (!sameFelt(binding.app20ClaimAddress, binding.app20ClaimIdentity)) {
    throw new Error(
      "The App20Claim address and committed identity do not match.",
    );
  }
  return Object.freeze(binding);
}

/**
 * Purely validates a persistence candidate. It does not authorize recovery;
 * only the unavailable trusted composition root may mint an authorized tuple.
 */
export function validateVnextRecoveryCandidate(
  input: VnextRecoveryInput,
): VnextRecoveryTuple {
  assertNoPrivateMaterial(input);
  if (input.phase !== "claim" && input.phase !== "refund") {
    throw new Error("Recovery phase must be claim or refund.");
  }
  const sellAmountBaseUnits = requirePositiveAmount(
    input.sellAmountBaseUnits,
    "sellAmountBaseUnits",
  );
  const buyAmountBaseUnits = requirePositiveAmount(
    input.buyAmountBaseUnits,
    "buyAmountBaseUnits",
  );
  const binding = canonicalBinding(input);
  assertPolicy(binding, input);
  if (input.observation.finalized !== true) {
    throw new Error("Recovery requires a finalized observation.");
  }
  if (
    !Number.isSafeInteger(input.observation.observedAt) ||
    input.observation.observedAt <= 0 ||
    input.observation.observedAt > input.now
  ) {
    throw new Error(
      "Finalized observation time must be safe and no later than the trusted clock.",
    );
  }
  assertObservationBinding(binding, input.observation.binding);

  if (input.phase === "claim") {
    if (input.observation.stage !== "Filled") {
      throw new Error(
        "Claim recovery requires a finalized Filled observation.",
      );
    }
    const observedBuyAmount = requirePositiveAmount(
      input.observation.buyAmountBaseUnits,
      "observed buyAmountBaseUnits",
    );
    if (
      !sameFelt(input.observation.buyToken, input.buyToken) ||
      observedBuyAmount !== buyAmountBaseUnits
    ) {
      throw new Error(
        "Claim recovery cannot invert or change the committed buy asset.",
      );
    }
    return Object.freeze({
      ...binding,
      phase: "claim",
      buyToken: requireNonzeroFelt(input.buyToken, "buyToken"),
      buyAmountBaseUnits,
    });
  }

  if (
    input.observation.stage !== "Funded" ||
    input.observation.fillObserved !== false
  ) {
    throw new Error(
      "Refund recovery requires a finalized Funded-without-Fill observation.",
    );
  }
  if (
    input.now < input.deadline ||
    input.observation.observedAt < input.deadline
  ) {
    throw new Error(
      "Refund recovery is unavailable before the commitment deadline.",
    );
  }
  const observedSellAmount = requirePositiveAmount(
    input.observation.sellAmountBaseUnits,
    "observed sellAmountBaseUnits",
  );
  if (
    !sameFelt(input.observation.sellToken, input.sellToken) ||
    observedSellAmount !== sellAmountBaseUnits
  ) {
    throw new Error(
      "Refund recovery cannot invert or change the committed sell asset.",
    );
  }
  return Object.freeze({
    ...binding,
    phase: "refund",
    sellToken: requireNonzeroFelt(input.sellToken, "sellToken"),
    sellAmountBaseUnits,
  });
}

declare const RECOVERY_AUTHORITY: unique symbol;
/** Nominal server-side authority; there is intentionally no exported constructor. */
export type ConfiguredVnextRecoveryAuthority = Readonly<{
  [RECOVERY_AUTHORITY]: true;
}>;

function assertConfiguredRecoveryAuthority(
  _authority: ConfiguredVnextRecoveryAuthority,
): void {
  throw new Error(
    "Configured VNext recovery authority is unavailable until trusted attempt, clock, and quorum-verifier adapters are composed.",
  );
}

/** The public authorization path remains closed until the trusted composition root exists. */
export function createVnextRecoveryTuple(
  authority: ConfiguredVnextRecoveryAuthority,
  input: VnextRecoveryInput,
): VnextRecoveryTuple {
  const tuple = validateVnextRecoveryCandidate(input);
  assertConfiguredRecoveryAuthority(authority);
  return tuple;
}

export type VnextPrivacyInvokeInput = Readonly<{
  funding: Readonly<{ token: string; recipient: string; amount: bigint }>;
  recovery: Readonly<{ token: string; recipient: string }>;
  calldata: (args: Record<string, unknown>) => unknown;
}>;

export type VnextRecoveryExecution =
  | Readonly<{
      kind: "ready";
      actions: ReturnType<typeof buildVnextClaimActions>;
    }>
  | Readonly<{ kind: "privy"; invokeExternal: VnextPrivacyInvokeInput }>;

export type VnextRecoveryCurrentContext = VnextRecoveryPolicySnapshot &
  Readonly<{
    observation: VnextClaimRecoveryObservation | VnextRefundRecoveryObservation;
  }>;

function assertCurrentRecovery(
  tuple: VnextRecoveryTuple,
  current: VnextRecoveryCurrentContext,
): void {
  assertPolicy(tuple, current);
  assertObservationBinding(tuple, current.observation.binding);
  if (
    current.observation.finalized !== true ||
    !Number.isSafeInteger(current.observation.observedAt) ||
    current.observation.observedAt <= 0 ||
    current.observation.observedAt > current.now
  ) {
    throw new Error(
      "Recovery execution requires a current finalized observation and trusted clock.",
    );
  }
  if (tuple.phase === "claim") {
    const tupleAmount = requirePositiveAmount(
      tuple.buyAmountBaseUnits,
      "buyAmountBaseUnits",
    );
    const observedAmount =
      current.observation.stage === "Filled"
        ? requirePositiveAmount(
            current.observation.buyAmountBaseUnits,
            "observed buyAmountBaseUnits",
          )
        : undefined;
    if (
      current.observation.stage !== "Filled" ||
      !sameFelt(current.observation.buyToken, tuple.buyToken) ||
      observedAmount !== tupleAmount
    ) {
      throw new Error(
        "Current observation no longer authorizes the claim tuple.",
      );
    }
  } else if (tuple.phase === "refund") {
    const tupleAmount = requirePositiveAmount(
      tuple.sellAmountBaseUnits,
      "sellAmountBaseUnits",
    );
    const observedAmount =
      current.observation.stage === "Funded"
        ? requirePositiveAmount(
            current.observation.sellAmountBaseUnits,
            "observed sellAmountBaseUnits",
          )
        : undefined;
    if (
      current.observation.stage !== "Funded" ||
      current.observation.fillObserved !== false ||
      current.now < tuple.deadline ||
      current.observation.observedAt < tuple.deadline ||
      !sameFelt(current.observation.sellToken, tuple.sellToken) ||
      observedAmount !== tupleAmount
    ) {
      throw new Error(
        "Current observation no longer authorizes the refund tuple.",
      );
    }
  } else {
    throw new Error("Recovery tuple phase must be claim or refund.");
  }
}

/**
 * Revalidates current policy/observation immediately before shaping output.
 * ABI, operation, and Privy calldata are never accepted from callers.
 */
export function buildVnextRecoveryExecution(
  input: Readonly<{
    authority: ConfiguredVnextRecoveryAuthority;
    tuple: VnextRecoveryTuple;
    current: VnextRecoveryCurrentContext;
    mode: "ready" | "privy";
  }>,
): VnextRecoveryExecution {
  if (input.mode !== "ready" && input.mode !== "privy") {
    throw new Error("Recovery execution mode must be ready or privy.");
  }
  assertCurrentRecovery(input.tuple, input.current);
  assertConfiguredRecoveryAuthority(input.authority);

  const payoutToken =
    input.tuple.phase === "claim"
      ? input.tuple.buyToken
      : input.tuple.sellToken;
  const common = {
    escrowAddress: input.tuple.escrowAddress,
    recoveryAddress: input.tuple.destinationAddress,
    dealId: input.tuple.dealId,
  };

  // Both recovery modes go through the action layer's sole artifact-pinned
  // encoder seam. Ready returns this exact tuple-bound batch; Privy reuses the
  // same encoded operation rather than maintaining a second codec or accepting
  // caller-supplied calldata.
  const operation = canonicalVnextRecoveryOperation(input.tuple);
  const actions =
    operation.kind === "Claim"
      ? buildVnextClaimActions({
          ...common,
          buyToken: payoutToken,
          payload: operation.payload satisfies VnextClaimOperationPayload,
        })
      : buildVnextTimeoutActions({
          ...common,
          sellToken: payoutToken,
          payload: operation.payload satisfies VnextTimeoutOperationPayload,
        });
  if (input.mode === "ready") {
    return Object.freeze({ kind: "ready", actions });
  }

  const invoke = actions[2];
  if (invoke?.type !== "invoke") {
    throw new Error(
      "VNext recovery action shape is not the pinned three-action batch.",
    );
  }
  const operationCalldata = invoke.calldata.slice(0, -3);

  return Object.freeze({
    kind: "privy",
    invokeExternal: Object.freeze({
      funding: Object.freeze({
        token: input.tuple.app20ClaimIdentity,
        recipient: input.tuple.escrowAddress,
        amount: 1n,
      }),
      recovery: Object.freeze({
        token: payoutToken,
        recipient: input.tuple.destinationAddress,
      }),
      calldata: (args: Record<string, unknown>) => {
        const poolAddress =
          typeof args.poolAddress === "bigint"
            ? `0x${args.poolAddress.toString(16)}`
            : String(args.poolAddress ?? "");
        if (!sameFelt(poolAddress, input.tuple.poolAddress))
          throw new Error(
            "Privy pool does not match the authorized recovery tuple.",
          );
        const openNotes = args.openNotes;
        if (
          !Array.isArray(openNotes) ||
          !openNotes[0] ||
          typeof openNotes[0] !== "object" ||
          !("noteId" in openNotes[0])
        ) {
          throw new Error("Privy recovery requires the destination open note.");
        }
        const rawNoteId = (openNotes[0] as { noteId: unknown }).noteId;
        const noteId =
          typeof rawNoteId === "bigint"
            ? `0x${rawNoteId.toString(16)}`
            : String(rawNoteId ?? "");
        const canonicalNoteId = canonicalizeStarknetFelt(noteId);
        if (canonicalNoteId === "0x0")
          throw new Error("Privy destination open note must not be zero.");
        return {
          contractAddress: input.tuple.escrowAddress,
          calldata: [
            ...operationCalldata,
            input.tuple.dealId,
            input.tuple.poolAddress,
            canonicalNoteId,
          ],
        };
      },
    }),
  });
}
