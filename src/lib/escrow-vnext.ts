import { canonicalizeStarknetFelt } from "@app20/domain";

export const ESCROW_VNEXT_COMMITMENT_DOMAIN =
  "app20/escrow-vnext-commitment/v1" as const;
export const ESCROW_VNEXT_SETTLEMENT_CONTEXT_DOMAIN =
  "app20/escrow-vnext-settlement-context/v1" as const;
export const ESCROW_VNEXT_ABI_VERSION = "app20/escrow-vnext-abi/v1" as const;
export const LOCALNET_ESCROW_V2_IS_VNEXT = false as const;

const DIGEST = /^0x[0-9a-fA-F]{64}$/;
const MAX_U256 = (1n << 256n) - 1n;

export type VnextCommitment = Readonly<{
  chainId: string;
  escrowAddress: string;
  escrowClassHash: string;
  /** Frozen codec key: the immutable App20Claim class hash. */
  claimTicketClassHash: string;
  poolAddress: string;
  registryRevision: string;
  directoryDigest: string;
  directoryEpoch: number;
  transportKeyId: string;
  quoteKeyId: string;
  makerId: string;
  makerSettlementAccount: string;
  takerSettlementAccount: string;
  intentDigest: string;
  rfqDigest: string;
  settlementContextDigest: string;
  winningQuoteDigest: string;
  reservationId: string;
  reservationFence: bigint;
  sellToken: string;
  sellAmountBaseUnits: bigint;
  buyToken: string;
  buyAmountBaseUnits: bigint;
  deadline: number;
  dealId: string;
  /** Frozen codec key: the deterministic per-deal App20Claim identity/address. */
  claimTicketIdentity: string;
}>;

export type VnextSettlementContext = Readonly<
  Omit<
    VnextCommitment,
    | "winningQuoteDigest"
    | "reservationId"
    | "reservationFence"
    | "buyAmountBaseUnits"
    | "settlementContextDigest"
  >
>;

export type VnextEntrypoint = "privacyInvoke";
export type VnextOperation = "Fund" | "Fill" | "Claim" | "Timeout";
export type VnextEvent = "Funded" | "Filled" | "Claimed" | "TimedOut";

export type VnextAbiExpectation = Readonly<{
  version: typeof ESCROW_VNEXT_ABI_VERSION;
  entrypoints: Readonly<
    Record<
      VnextEntrypoint,
      Readonly<{
        selector: string | null;
        calldata: readonly string[];
      }>
    >
  >;
  operations: Readonly<
    Record<
      VnextOperation,
      Readonly<{
        payload: readonly string[];
      }>
    >
  >;
  events: Readonly<
    Record<
      VnextEvent,
      Readonly<{
        selector: string | null;
        keys: readonly string[];
        data: readonly string[];
      }>
    >
  >;
}>;

const FUND_PAYLOAD = Object.freeze([
  "chainId",
  "escrowAddress",
  "escrowClassHash",
  "claimTicketClassHash",
  "poolAddress",
  "registryRevision",
  "directoryDigest",
  "directoryEpoch",
  "transportKeyId",
  "quoteKeyId",
  "makerId",
  "makerSettlementAccount",
  "takerSettlementAccount",
  "intentDigest",
  "rfqDigest",
  "settlementContextDigest",
  "winningQuoteDigest",
  "reservationId",
  "reservationFence",
  "sellToken",
  "sellAmountBaseUnits",
  "buyToken",
  "buyAmountBaseUnits",
  "deadline",
  "dealId",
  "claimTicketIdentity",
  "commitmentDigest",
]);
const STATIC_EVENT_BINDING = [
  "abiVersion",
  "chainId",
  "escrowAddress",
  "escrowClassHash",
  "claimTicketClassHash",
  "claimTicketIdentity",
  "poolAddress",
  "registryRevision",
  "directoryDigest",
  "directoryEpoch",
  "transportKeyId",
  "quoteKeyId",
  "makerId",
  "makerSettlementAccount",
  "takerSettlementAccount",
  "intentDigest",
  "rfqDigest",
  "settlementContextDigest",
  "winningQuoteDigest",
  "reservationId",
  "reservationFence",
  "sellToken",
  "sellAmountBaseUnits",
  "buyToken",
  "buyAmountBaseUnits",
  "deadline",
] as const;
const EVENT_KEYS = Object.freeze([
  "dealId",
  "commitmentDigestLow",
  "commitmentDigestHigh",
]);

/** Selectors intentionally stay null until audited Cairo and its ABI exist. */
export const ESCROW_VNEXT_ABI_EXPECTATION: VnextAbiExpectation = Object.freeze({
  version: ESCROW_VNEXT_ABI_VERSION,
  entrypoints: Object.freeze({
    privacyInvoke: Object.freeze({
      selector: null,
      calldata: Object.freeze([
        "operation",
        "dealId",
        "poolAddressPlaceholder",
        "destinationOpenNoteId",
      ]),
    }),
  }),
  operations: Object.freeze({
    Fund: Object.freeze({ payload: FUND_PAYLOAD }),
    Fill: Object.freeze({
      payload: Object.freeze([
        "commitmentDigest",
        "reservationId",
        "reservationFence",
        "winningQuoteDigest",
        "buyToken",
        "buyAmount",
      ]),
    }),
    Claim: Object.freeze({
      payload: Object.freeze(["commitmentDigest", "claimIdentity"]),
    }),
    Timeout: Object.freeze({
      payload: Object.freeze(["commitmentDigest", "claimIdentity"]),
    }),
  }),
  events: Object.freeze({
    Funded: Object.freeze({
      selector: null,
      keys: EVENT_KEYS,
      data: Object.freeze([...STATIC_EVENT_BINDING]),
    }),
    Filled: Object.freeze({
      selector: null,
      keys: EVENT_KEYS,
      data: Object.freeze([...STATIC_EVENT_BINDING]),
    }),
    Claimed: Object.freeze({
      selector: null,
      keys: EVENT_KEYS,
      data: Object.freeze([
        ...STATIC_EVENT_BINDING,
        "actualOutputToken",
        "actualOutputAmount",
      ]),
    }),
    TimedOut: Object.freeze({
      selector: null,
      keys: EVENT_KEYS,
      data: Object.freeze([
        ...STATIC_EVENT_BINDING,
        "actualOutputToken",
        "actualOutputAmount",
      ]),
    }),
  }),
});

function text(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}
function felt(value: string, label: string): string {
  let result: string;
  try {
    result = canonicalizeStarknetFelt(value);
  } catch {
    throw new Error(`${label} must be a Starknet felt.`);
  }
  if (result === "0x0") throw new Error(`${label} must not be zero.`);
  return result;
}
function digest(value: string, label: string): string {
  if (typeof value !== "string")
    throw new Error(`${label} must be a 32-byte digest.`);
  const result = value.toLowerCase();
  if (!DIGEST.test(result))
    throw new Error(`${label} must be a 32-byte digest.`);
  return result;
}
function nonzeroDigestIdentifier(value: string, label: string): string {
  const result = digest(value, label);
  if (/^0x0{64}$/.test(result)) throw new Error(`${label} must not be zero.`);
  return result;
}
function amount(value: bigint, label: string): string {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_U256) {
    throw new Error(`${label} must be a positive u256 bigint.`);
  }
  return value.toString();
}

export function canonicalVnextSettlementContext(
  value: VnextSettlementContext,
): string {
  if (!Number.isSafeInteger(value.deadline) || value.deadline <= 0)
    throw new Error("deadline must be positive unix seconds.");
  if (!Number.isSafeInteger(value.directoryEpoch) || value.directoryEpoch < 0)
    throw new Error("directoryEpoch must be non-negative.");
  return JSON.stringify({
    buyToken: felt(value.buyToken, "buyToken"),
    chainId: text(value.chainId, "chainId"),
    claimTicketClassHash: felt(
      value.claimTicketClassHash,
      "claimTicketClassHash",
    ),
    claimTicketIdentity: felt(value.claimTicketIdentity, "claimTicketIdentity"),
    deadline: value.deadline,
    dealId: felt(value.dealId, "dealId"),
    directoryDigest: digest(value.directoryDigest, "directoryDigest"),
    directoryEpoch: value.directoryEpoch,
    domain: ESCROW_VNEXT_SETTLEMENT_CONTEXT_DOMAIN,
    escrowAddress: felt(value.escrowAddress, "escrowAddress"),
    escrowClassHash: felt(value.escrowClassHash, "escrowClassHash"),
    intentDigest: digest(value.intentDigest, "intentDigest"),
    makerId: text(value.makerId, "makerId"),
    makerSettlementAccount: felt(
      value.makerSettlementAccount,
      "makerSettlementAccount",
    ),
    poolAddress: felt(value.poolAddress, "poolAddress"),
    quoteKeyId: text(value.quoteKeyId, "quoteKeyId"),
    registryRevision: text(value.registryRevision, "registryRevision"),
    rfqDigest: digest(value.rfqDigest, "rfqDigest"),
    sellAmountBaseUnits: amount(
      value.sellAmountBaseUnits,
      "sellAmountBaseUnits",
    ),
    sellToken: felt(value.sellToken, "sellToken"),
    takerSettlementAccount: felt(
      value.takerSettlementAccount,
      "takerSettlementAccount",
    ),
    transportKeyId: text(value.transportKeyId, "transportKeyId"),
  });
}
export async function digestVnextSettlementContext(
  value: VnextSettlementContext,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalVnextSettlementContext(value)),
    ),
  );
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function settlementContextFromCommitment(
  value: VnextCommitment,
): VnextSettlementContext {
  const {
    winningQuoteDigest: _winningQuoteDigest,
    reservationId: _reservationId,
    reservationFence: _reservationFence,
    buyAmountBaseUnits: _buyAmountBaseUnits,
    settlementContextDigest: _settlementContextDigest,
    ...context
  } = value;
  return context;
}

/** Final post-selection commitment. Call only after recomputing its quote-bound context. */
function canonicalVnextCommitment(value: VnextCommitment): string {
  if (!Number.isSafeInteger(value.deadline) || value.deadline <= 0)
    throw new Error("deadline must be positive unix seconds.");
  if (!Number.isSafeInteger(value.directoryEpoch) || value.directoryEpoch < 0)
    throw new Error("directoryEpoch must be non-negative.");
  return JSON.stringify({
    buyAmountBaseUnits: amount(value.buyAmountBaseUnits, "buyAmountBaseUnits"),
    buyToken: felt(value.buyToken, "buyToken"),
    chainId: text(value.chainId, "chainId"),
    claimTicketClassHash: felt(
      value.claimTicketClassHash,
      "claimTicketClassHash",
    ),
    claimTicketIdentity: felt(value.claimTicketIdentity, "claimTicketIdentity"),
    deadline: value.deadline,
    dealId: felt(value.dealId, "dealId"),
    directoryDigest: digest(value.directoryDigest, "directoryDigest"),
    directoryEpoch: value.directoryEpoch,
    domain: ESCROW_VNEXT_COMMITMENT_DOMAIN,
    escrowAddress: felt(value.escrowAddress, "escrowAddress"),
    escrowClassHash: felt(value.escrowClassHash, "escrowClassHash"),
    intentDigest: digest(value.intentDigest, "intentDigest"),
    makerId: text(value.makerId, "makerId"),
    makerSettlementAccount: felt(
      value.makerSettlementAccount,
      "makerSettlementAccount",
    ),
    poolAddress: felt(value.poolAddress, "poolAddress"),
    quoteKeyId: text(value.quoteKeyId, "quoteKeyId"),
    registryRevision: text(value.registryRevision, "registryRevision"),
    reservationFence: amount(value.reservationFence, "reservationFence"),
    reservationId: nonzeroDigestIdentifier(
      value.reservationId,
      "reservationId",
    ),
    rfqDigest: digest(value.rfqDigest, "rfqDigest"),
    settlementContextDigest: digest(
      value.settlementContextDigest,
      "settlementContextDigest",
    ),
    sellAmountBaseUnits: amount(
      value.sellAmountBaseUnits,
      "sellAmountBaseUnits",
    ),
    sellToken: felt(value.sellToken, "sellToken"),
    takerSettlementAccount: felt(
      value.takerSettlementAccount,
      "takerSettlementAccount",
    ),
    transportKeyId: text(value.transportKeyId, "transportKeyId"),
    winningQuoteDigest: digest(value.winningQuoteDigest, "winningQuoteDigest"),
  });
}

export async function digestVnextCommitment(
  value: VnextCommitment,
): Promise<string> {
  const expectedContextDigest = await digestVnextSettlementContext(
    settlementContextFromCommitment(value),
  );
  if (
    digest(value.settlementContextDigest, "settlementContextDigest") !==
    expectedContextDigest
  ) {
    throw new Error(
      "settlementContextDigest does not match the final commitment context.",
    );
  }
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalVnextCommitment(value)),
    ),
  );
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function assertVnextAbiReady(manifest: VnextAbiExpectation): void {
  const selectors = [
    ...Object.values(manifest.entrypoints).map((entry) => entry.selector),
    ...Object.values(manifest.events).map((event) => event.selector),
  ];
  if (selectors.some((selector) => selector === null))
    throw new Error(
      "Escrow VNext Cairo ABI/selectors are not configured; localnet V2 calldata is refused.",
    );
  for (const selector of selectors) felt(selector!, "VNext ABI selector");
}
