/**
 * Reviewed APP20 RFQ economic policy for the first release.
 *
 * This pure module validates complete, caller-supplied evidence and fails
 * closed. It does not authenticate reference prices, read persisted
 * reservations or accounting, move value, or enable RFQ on a public network.
 */

export const RFQ_ECONOMIC_POLICY_ID =
  "app20/rfq-economics/reviewed-first-release-v1" as const;

export const RFQ_FULL_FILL_ONLY = true as const;
export const RFQ_APP20_FEE_BPS = 0 as const;
export const RFQ_MAX_MAKER_SPREAD_BPS = 50 as const;
export const RFQ_MAX_TOTAL_DEVIATION_BPS = 100 as const;
export const RFQ_MAX_QUOTE_TTL_SECONDS = 90 as const;
export const RFQ_REFERENCE_REJECT_AGE_SECONDS = 300 as const;
export const RFQ_REFERENCE_SUSPEND_AGE_SECONDS = 900 as const;
export const RFQ_SINGLE_MAKER_CONCENTRATION_BPS = 6_000 as const;
export const RFQ_PUBLIC_NETWORKS_ENABLED = false as const;

// The only reviewed local first-release market. These identifiers are policy
// identifiers, not public-network token addresses or runtime configuration.
export const RFQ_REVIEWED_MARKET_ID = "STRK_USDC" as const;
export const RFQ_REVIEWED_SELL_TOKEN_ID = "STRK" as const;
export const RFQ_REVIEWED_SELL_TOKEN_DECIMALS = 18 as const;
export const RFQ_REVIEWED_BUY_TOKEN_ID = "USDC" as const;
export const RFQ_REVIEWED_BUY_TOKEN_DECIMALS = 6 as const;

export const RFQ_USDC_BASE_UNITS = 1_000_000n;
export const RFQ_PER_TRADE_CAP_USDC_BASE_UNITS = 5_000n * RFQ_USDC_BASE_UNITS;
export const RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS =
  25_000n * RFQ_USDC_BASE_UNITS;
export const RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS =
  50_000n * RFQ_USDC_BASE_UNITS;

const MAX_U256 = (1n << 256n) - 1n;
const DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const BPS_SCALE = 10_000n;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;

export type RfqEconomicAction =
  | "request"
  | "quote"
  | "claim"
  | "timeout"
  | "refund";

export type RfqReferenceEvidence =
  | Readonly<{ available: false }>
  | Readonly<{
      available: true;
      marketId: string;
      observedAt: number;
      sellTokenId: string;
      sellTokenDecimals: number;
      buyTokenId: string;
      buyTokenDecimals: number;
      grossSellAmountBaseUnits: bigint;
      grossBuyAmountBaseUnits: bigint;
    }>;

/**
 * Usage counters cover the supplied 24-hour accounting window immediately
 * before this proposal. They must include fills and outstanding commitments;
 * this pure module does not infer a reset boundary or read custody state.
 */
export type RfqAccountingWindow = Readonly<{
  windowId: string;
  marketId: string;
  makerId: string;
  startsAt: number;
  endsAt: number;
  observedAt: number;
  makerCommittedUsdcBaseUnits: bigint;
  marketCommittedUsdcBaseUnits: bigint;
}>;

export type RfqEconomicProposal = Readonly<{
  marketId: string;
  makerId: string;
  sellTokenId: string;
  sellTokenDecimals: number;
  buyTokenId: string;
  buyTokenDecimals: number;
  requestedSellAmountBaseUnits: bigint;
  offeredSellAmountBaseUnits: bigint;
  offeredBuyAmountBaseUnits: bigint;
  /** Caller assertion only; policy derives and cross-checks this value. */
  usdcEquivalentBaseUnits: bigint;
  /** Caller assertion only; policy computes spread and cross-checks this value. */
  makerSpreadBps: number;
  app20FeeBps: number;
  quoteTtlSeconds: number;
}>;

export type RfqEconomicPolicyInput = Readonly<{
  action: RfqEconomicAction;
  /** Deliberately immutable-off outside localnet in this release. */
  network: "localnet";
  decisionAt: number;
  market: Readonly<{
    marketId: string;
    state: "active" | "suspended";
  }>;
  reference: RfqReferenceEvidence;
  proposal: RfqEconomicProposal;
  accounting: RfqAccountingWindow;
}>;

export type RfqEconomicRejectionCode =
  | "ACTION_UNSUPPORTED"
  | "PUBLIC_NETWORK_DISABLED"
  | "DECISION_TIME_MALFORMED"
  | "RECOVERY_REQUIRES_PERSISTED_RESERVATION"
  | "MARKET_STATE_UNAVAILABLE"
  | "MARKET_STATE_MALFORMED"
  | "MARKET_SUSPENDED"
  | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_MALFORMED"
  | "REFERENCE_STALE"
  | "REFERENCE_SUSPENSION_REQUIRED"
  | "PROPOSAL_UNAVAILABLE"
  | "PROPOSAL_MALFORMED"
  | "MARKET_BINDING_MISMATCH"
  | "TOKEN_BINDING_MISMATCH"
  | "TOKEN_DECIMALS_MISMATCH"
  | "REFERENCE_QUANTITY_MISMATCH"
  | "MAKER_BINDING_MISMATCH"
  | "PARTIAL_FILL_REFUSED"
  | "APP20_FEE_REFUSED"
  | "MAKER_SPREAD_MISMATCH"
  | "MAKER_SPREAD_EXCEEDED"
  | "TOTAL_DEVIATION_EXCEEDED"
  | "USDC_EQUIVALENT_MISMATCH"
  | "QUOTE_TTL_EXCEEDED"
  | "PER_TRADE_CAP_EXCEEDED"
  | "ACCOUNTING_UNAVAILABLE"
  | "ACCOUNTING_MALFORMED"
  | "ACCOUNTING_STALE"
  | "PER_MAKER_DAILY_CAP_EXCEEDED"
  | "PER_MARKET_DAILY_CAP_EXCEEDED"
  | "SINGLE_MAKER_CONCENTRATION_EXCEEDED";

export type RfqEconomicReason = Readonly<{
  code: RfqEconomicRejectionCode;
  message: string;
}>;

export type RfqEconomicPolicyDecision = Readonly<{
  allowed: boolean;
  policyId: typeof RFQ_ECONOMIC_POLICY_ID;
  action: RfqEconomicAction | "unknown";
  reasons: readonly RfqEconomicReason[];
  recoveryOnly: boolean;
}>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeBps(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safeDecimals(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 255
  );
}

function positiveU256(value: unknown): value is bigint {
  return typeof value === "bigint" && value > 0n && value <= MAX_U256;
}

function nonNegativeU256(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= MAX_U256;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function reason(
  code: RfqEconomicRejectionCode,
  message: string,
): RfqEconomicReason {
  return Object.freeze({ code, message });
}

function decision(
  action: RfqEconomicAction | "unknown",
  reasons: readonly RfqEconomicReason[],
  recoveryOnly: boolean,
): RfqEconomicPolicyDecision {
  return Object.freeze({
    allowed: reasons.length === 0,
    policyId: RFQ_ECONOMIC_POLICY_ID,
    action,
    reasons: Object.freeze([...reasons]),
    recoveryOnly,
  });
}

function recognizedAction(value: unknown): value is RfqEconomicAction {
  return ["request", "quote", "claim", "timeout", "refund"].includes(
    String(value),
  );
}

function isRecoveryAction(
  action: RfqEconomicAction,
): action is "claim" | "timeout" | "refund" {
  return action === "claim" || action === "timeout" || action === "refund";
}

/**
 * Evaluates new maker-targeted requests and quotes. Recovery actions are
 * classified but never authorized here: only the persistence authority can
 * bind one to an existing reservation and validate its state transition.
 */
export function evaluateRfqEconomicPolicy(
  input: unknown,
): RfqEconomicPolicyDecision {
  if (!isRecord(input) || !recognizedAction(input.action)) {
    return decision(
      "unknown",
      [
        reason(
          "ACTION_UNSUPPORTED",
          "RFQ economic action is unsupported or missing.",
        ),
      ],
      false,
    );
  }
  const action = input.action;

  if (isRecoveryAction(action)) {
    const recoveryReasons: RfqEconomicReason[] = [];
    if (input.network !== "localnet") {
      recoveryReasons.push(
        reason(
          "PUBLIC_NETWORK_DISABLED",
          "Public-network RFQ remains disabled for this release.",
        ),
      );
    }
    if (!safeTimestamp(input.decisionAt)) {
      recoveryReasons.push(
        reason(
          "DECISION_TIME_MALFORMED",
          "Recovery decision time must be a positive safe-integer timestamp.",
        ),
      );
    }
    recoveryReasons.push(
      reason(
        "RECOVERY_REQUIRES_PERSISTED_RESERVATION",
        "Economic policy cannot authorize recovery without an existing persisted reservation and state binding.",
      ),
    );
    return decision(action, recoveryReasons, true);
  }

  const reasons: RfqEconomicReason[] = [];
  if (input.network !== "localnet") {
    reasons.push(
      reason(
        "PUBLIC_NETWORK_DISABLED",
        "Public-network RFQ remains disabled for this release.",
      ),
    );
  }
  if (!safeTimestamp(input.decisionAt)) {
    reasons.push(
      reason(
        "DECISION_TIME_MALFORMED",
        "Economic decision time must be a positive safe-integer timestamp.",
      ),
    );
  }
  const decisionAt = safeTimestamp(input.decisionAt)
    ? input.decisionAt
    : undefined;

  let marketId: string | undefined;
  if (input.market === undefined || input.market === null) {
    reasons.push(
      reason(
        "MARKET_STATE_UNAVAILABLE",
        "Market control state is unavailable.",
      ),
    );
  } else if (
    !isRecord(input.market) ||
    !safeId(input.market.marketId) ||
    (input.market.state !== "active" && input.market.state !== "suspended")
  ) {
    reasons.push(
      reason("MARKET_STATE_MALFORMED", "Market control state is malformed."),
    );
  } else {
    marketId = input.market.marketId;
    if (input.market.state === "suspended") {
      reasons.push(
        reason(
          "MARKET_SUSPENDED",
          "Market is suspended; no new RFQ request or quote is accepted.",
        ),
      );
    }
    if (marketId !== RFQ_REVIEWED_MARKET_ID) {
      reasons.push(
        reason(
          "MARKET_BINDING_MISMATCH",
          "Market is outside the reviewed local first-release market.",
        ),
      );
    }
  }

  let reference:
    | Extract<RfqReferenceEvidence, Readonly<{ available: true }>>
    | undefined;
  if (input.reference === undefined || input.reference === null) {
    reasons.push(
      reason(
        "REFERENCE_UNAVAILABLE",
        "Reference price is unavailable; no new RFQ request or quote is accepted.",
      ),
    );
  } else if (!isRecord(input.reference)) {
    reasons.push(
      reason("REFERENCE_MALFORMED", "Reference evidence is malformed."),
    );
  } else if (input.reference.available === false) {
    reasons.push(
      reason(
        "REFERENCE_UNAVAILABLE",
        "Reference price is unavailable; no new RFQ request or quote is accepted.",
      ),
    );
  } else if (
    input.reference.available !== true ||
    !safeId(input.reference.marketId) ||
    !safeTimestamp(input.reference.observedAt) ||
    !safeId(input.reference.sellTokenId) ||
    !safeDecimals(input.reference.sellTokenDecimals) ||
    !safeId(input.reference.buyTokenId) ||
    !safeDecimals(input.reference.buyTokenDecimals) ||
    !positiveU256(input.reference.grossSellAmountBaseUnits) ||
    !positiveU256(input.reference.grossBuyAmountBaseUnits) ||
    decisionAt === undefined ||
    input.reference.observedAt > decisionAt
  ) {
    reasons.push(
      reason("REFERENCE_MALFORMED", "Reference evidence is malformed."),
    );
  } else {
    reference = {
      available: true,
      marketId: input.reference.marketId,
      observedAt: input.reference.observedAt,
      sellTokenId: input.reference.sellTokenId,
      sellTokenDecimals: input.reference.sellTokenDecimals,
      buyTokenId: input.reference.buyTokenId,
      buyTokenDecimals: input.reference.buyTokenDecimals,
      grossSellAmountBaseUnits: input.reference.grossSellAmountBaseUnits,
      grossBuyAmountBaseUnits: input.reference.grossBuyAmountBaseUnits,
    };
    if (
      reference.marketId !== RFQ_REVIEWED_MARKET_ID ||
      (marketId !== undefined && reference.marketId !== marketId)
    ) {
      reasons.push(
        reason(
          "MARKET_BINDING_MISMATCH",
          "Reference and market control must bind the reviewed market.",
        ),
      );
    }
    if (
      reference.sellTokenId !== RFQ_REVIEWED_SELL_TOKEN_ID ||
      reference.buyTokenId !== RFQ_REVIEWED_BUY_TOKEN_ID
    ) {
      reasons.push(
        reason(
          "TOKEN_BINDING_MISMATCH",
          "Reference token identities are outside the reviewed token pair.",
        ),
      );
    }
    if (
      reference.sellTokenDecimals !== RFQ_REVIEWED_SELL_TOKEN_DECIMALS ||
      reference.buyTokenDecimals !== RFQ_REVIEWED_BUY_TOKEN_DECIMALS
    ) {
      reasons.push(
        reason(
          "TOKEN_DECIMALS_MISMATCH",
          "Reference token decimals disagree with the reviewed token units.",
        ),
      );
    }
    const referenceAge = decisionAt - reference.observedAt;
    if (referenceAge > RFQ_REFERENCE_SUSPEND_AGE_SECONDS) {
      reasons.push(
        reason(
          "REFERENCE_SUSPENSION_REQUIRED",
          "Reference price is older than 900 seconds; the market must remain suspended.",
        ),
      );
    } else if (referenceAge > RFQ_REFERENCE_REJECT_AGE_SECONDS) {
      reasons.push(
        reason(
          "REFERENCE_STALE",
          "Reference price is older than 300 seconds; no new RFQ request or quote is accepted.",
        ),
      );
    }
  }

  let proposal: RfqEconomicProposal | undefined;
  let derivedUsdcEquivalentBaseUnits: bigint | undefined;
  if (input.proposal === undefined || input.proposal === null) {
    reasons.push(
      reason("PROPOSAL_UNAVAILABLE", "RFQ economic proposal is unavailable."),
    );
  } else if (
    !isRecord(input.proposal) ||
    !safeId(input.proposal.marketId) ||
    !safeId(input.proposal.makerId) ||
    !safeId(input.proposal.sellTokenId) ||
    !safeDecimals(input.proposal.sellTokenDecimals) ||
    !safeId(input.proposal.buyTokenId) ||
    !safeDecimals(input.proposal.buyTokenDecimals) ||
    !positiveU256(input.proposal.requestedSellAmountBaseUnits) ||
    !positiveU256(input.proposal.offeredSellAmountBaseUnits) ||
    !positiveU256(input.proposal.offeredBuyAmountBaseUnits) ||
    !positiveU256(input.proposal.usdcEquivalentBaseUnits) ||
    !safeBps(input.proposal.makerSpreadBps) ||
    !safeBps(input.proposal.app20FeeBps) ||
    !Number.isSafeInteger(input.proposal.quoteTtlSeconds) ||
    Number(input.proposal.quoteTtlSeconds) <= 0
  ) {
    reasons.push(
      reason("PROPOSAL_MALFORMED", "RFQ economic proposal is malformed."),
    );
  } else {
    proposal = {
      marketId: input.proposal.marketId,
      makerId: input.proposal.makerId,
      sellTokenId: input.proposal.sellTokenId,
      sellTokenDecimals: input.proposal.sellTokenDecimals,
      buyTokenId: input.proposal.buyTokenId,
      buyTokenDecimals: input.proposal.buyTokenDecimals,
      requestedSellAmountBaseUnits: input.proposal.requestedSellAmountBaseUnits,
      offeredSellAmountBaseUnits: input.proposal.offeredSellAmountBaseUnits,
      offeredBuyAmountBaseUnits: input.proposal.offeredBuyAmountBaseUnits,
      usdcEquivalentBaseUnits: input.proposal.usdcEquivalentBaseUnits,
      makerSpreadBps: input.proposal.makerSpreadBps,
      app20FeeBps: input.proposal.app20FeeBps,
      quoteTtlSeconds: Number(input.proposal.quoteTtlSeconds),
    };
    if (
      proposal.marketId !== RFQ_REVIEWED_MARKET_ID ||
      (marketId !== undefined && proposal.marketId !== marketId) ||
      (reference !== undefined && proposal.marketId !== reference.marketId)
    ) {
      reasons.push(
        reason(
          "MARKET_BINDING_MISMATCH",
          "Proposal, market control, and reference must bind the reviewed market.",
        ),
      );
    }
    if (
      proposal.sellTokenId !== RFQ_REVIEWED_SELL_TOKEN_ID ||
      proposal.buyTokenId !== RFQ_REVIEWED_BUY_TOKEN_ID ||
      (reference !== undefined &&
        (proposal.sellTokenId !== reference.sellTokenId ||
          proposal.buyTokenId !== reference.buyTokenId))
    ) {
      reasons.push(
        reason(
          "TOKEN_BINDING_MISMATCH",
          "Proposal and reference must bind the reviewed token identities.",
        ),
      );
    }
    if (
      proposal.sellTokenDecimals !== RFQ_REVIEWED_SELL_TOKEN_DECIMALS ||
      proposal.buyTokenDecimals !== RFQ_REVIEWED_BUY_TOKEN_DECIMALS ||
      (reference !== undefined &&
        (proposal.sellTokenDecimals !== reference.sellTokenDecimals ||
          proposal.buyTokenDecimals !== reference.buyTokenDecimals))
    ) {
      reasons.push(
        reason(
          "TOKEN_DECIMALS_MISMATCH",
          "Proposal and reference must use the reviewed token decimals.",
        ),
      );
    }
    if (
      proposal.offeredSellAmountBaseUnits !==
      proposal.requestedSellAmountBaseUnits
    ) {
      reasons.push(
        reason(
          "PARTIAL_FILL_REFUSED",
          "The first-release RFQ policy permits full fills only.",
        ),
      );
    }
    if (proposal.app20FeeBps !== RFQ_APP20_FEE_BPS) {
      reasons.push(
        reason(
          "APP20_FEE_REFUSED",
          "The first-release APP20 fee is fixed at 0 bps.",
        ),
      );
    }
    if (proposal.quoteTtlSeconds > RFQ_MAX_QUOTE_TTL_SECONDS) {
      reasons.push(
        reason(
          "QUOTE_TTL_EXCEEDED",
          "Quote TTL exceeds the reviewed 90-second maximum.",
        ),
      );
    }

    if (reference !== undefined) {
      if (
        reference.grossSellAmountBaseUnits !==
          proposal.requestedSellAmountBaseUnits ||
        reference.grossSellAmountBaseUnits !==
          proposal.offeredSellAmountBaseUnits
      ) {
        reasons.push(
          reason(
            "REFERENCE_QUANTITY_MISMATCH",
            "Reference and proposal must price the identical sell base quantity.",
          ),
        );
      }

      const referenceBuy = reference.grossBuyAmountBaseUnits;
      const spreadNumerator =
        proposal.offeredBuyAmountBaseUnits < referenceBuy
          ? referenceBuy - proposal.offeredBuyAmountBaseUnits
          : 0n;
      const computedSpreadBps = Number(
        (spreadNumerator * BPS_SCALE) / referenceBuy,
      );
      if (proposal.makerSpreadBps !== computedSpreadBps) {
        reasons.push(
          reason(
            "MAKER_SPREAD_MISMATCH",
            "Self-reported maker spread disagrees with the exact reference/proposal amounts.",
          ),
        );
      }
      if (
        spreadNumerator * BPS_SCALE >
        referenceBuy * BigInt(RFQ_MAX_MAKER_SPREAD_BPS)
      ) {
        reasons.push(
          reason(
            "MAKER_SPREAD_EXCEEDED",
            "Computed maker spread exceeds the reviewed 50 bps maximum.",
          ),
        );
      }

      const deviationNumerator =
        proposal.offeredBuyAmountBaseUnits >= referenceBuy
          ? proposal.offeredBuyAmountBaseUnits - referenceBuy
          : referenceBuy - proposal.offeredBuyAmountBaseUnits;
      if (
        deviationNumerator * BPS_SCALE >
        referenceBuy * BigInt(RFQ_MAX_TOTAL_DEVIATION_BPS)
      ) {
        reasons.push(
          reason(
            "TOTAL_DEVIATION_EXCEEDED",
            "Quote exceeds the reviewed 100 bps total reference-deviation band.",
          ),
        );
      }

      // Convert the reference quote quantity into six-decimal USDC with exact
      // integer arithmetic. The reviewed pair currently has six quote-token
      // decimals, but retaining the scale equation prevents unit confusion.
      const quoteTokenScale = 10n ** BigInt(reference.buyTokenDecimals);
      const usdcNumerator = referenceBuy * RFQ_USDC_BASE_UNITS;
      if (usdcNumerator % quoteTokenScale === 0n) {
        derivedUsdcEquivalentBaseUnits = usdcNumerator / quoteTokenScale;
        if (
          proposal.usdcEquivalentBaseUnits * quoteTokenScale !==
          usdcNumerator
        ) {
          reasons.push(
            reason(
              "USDC_EQUIVALENT_MISMATCH",
              "Claimed USDC equivalent disagrees with the exact reviewed reference conversion.",
            ),
          );
        }
        if (
          usdcNumerator >
          RFQ_PER_TRADE_CAP_USDC_BASE_UNITS * quoteTokenScale
        ) {
          reasons.push(
            reason(
              "PER_TRADE_CAP_EXCEEDED",
              "Trade exceeds the reviewed 5,000 USDC-equivalent cap.",
            ),
          );
        }
      } else {
        reasons.push(
          reason(
            "REFERENCE_MALFORMED",
            "Reference quantity cannot be represented in exact USDC base units.",
          ),
        );
      }
    }
  }

  let accounting: RfqAccountingWindow | undefined;
  if (input.accounting === undefined || input.accounting === null) {
    reasons.push(
      reason(
        "ACCOUNTING_UNAVAILABLE",
        "Daily cap accounting is unavailable; no new RFQ request or quote is accepted.",
      ),
    );
  } else if (
    !isRecord(input.accounting) ||
    !safeId(input.accounting.windowId) ||
    !safeId(input.accounting.marketId) ||
    !safeId(input.accounting.makerId) ||
    !safeTimestamp(input.accounting.startsAt) ||
    !safeTimestamp(input.accounting.endsAt) ||
    !safeTimestamp(input.accounting.observedAt) ||
    !nonNegativeU256(input.accounting.makerCommittedUsdcBaseUnits) ||
    !nonNegativeU256(input.accounting.marketCommittedUsdcBaseUnits) ||
    decisionAt === undefined ||
    input.accounting.endsAt - input.accounting.startsAt !==
      DAILY_WINDOW_SECONDS ||
    decisionAt < input.accounting.startsAt ||
    decisionAt >= input.accounting.endsAt ||
    input.accounting.observedAt < input.accounting.startsAt ||
    input.accounting.observedAt > decisionAt ||
    input.accounting.makerCommittedUsdcBaseUnits >
      input.accounting.marketCommittedUsdcBaseUnits
  ) {
    reasons.push(
      reason(
        "ACCOUNTING_MALFORMED",
        "Daily cap accounting window is malformed.",
      ),
    );
  } else {
    accounting = {
      windowId: input.accounting.windowId,
      marketId: input.accounting.marketId,
      makerId: input.accounting.makerId,
      startsAt: input.accounting.startsAt,
      endsAt: input.accounting.endsAt,
      observedAt: input.accounting.observedAt,
      makerCommittedUsdcBaseUnits: input.accounting.makerCommittedUsdcBaseUnits,
      marketCommittedUsdcBaseUnits:
        input.accounting.marketCommittedUsdcBaseUnits,
    };
    if (accounting.observedAt !== decisionAt) {
      reasons.push(
        reason(
          "ACCOUNTING_STALE",
          "Daily cap accounting must be current at the economic decision time.",
        ),
      );
    }
    if (marketId !== undefined && accounting.marketId !== marketId) {
      reasons.push(
        reason(
          "MARKET_BINDING_MISMATCH",
          "Accounting and market control must bind the same market.",
        ),
      );
    }
    if (proposal !== undefined) {
      if (accounting.marketId !== proposal.marketId) {
        reasons.push(
          reason(
            "MARKET_BINDING_MISMATCH",
            "Proposal and accounting must bind the same market.",
          ),
        );
      }
      if (accounting.makerId !== proposal.makerId) {
        reasons.push(
          reason(
            "MAKER_BINDING_MISMATCH",
            "Proposal and accounting must bind the same maker.",
          ),
        );
      }
    }
    if (
      proposal !== undefined &&
      derivedUsdcEquivalentBaseUnits !== undefined
    ) {
      const makerAfter =
        accounting.makerCommittedUsdcBaseUnits + derivedUsdcEquivalentBaseUnits;
      const marketAfter =
        accounting.marketCommittedUsdcBaseUnits +
        derivedUsdcEquivalentBaseUnits;
      if (makerAfter > RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS) {
        reasons.push(
          reason(
            "PER_MAKER_DAILY_CAP_EXCEEDED",
            "Proposal exceeds the reviewed 25,000 USDC-equivalent maker daily cap.",
          ),
        );
      }
      if (marketAfter > RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS) {
        reasons.push(
          reason(
            "PER_MARKET_DAILY_CAP_EXCEEDED",
            "Proposal exceeds the reviewed 50,000 USDC-equivalent market daily cap.",
          ),
        );
      }
      if (
        makerAfter * BPS_SCALE >
        marketAfter * BigInt(RFQ_SINGLE_MAKER_CONCENTRATION_BPS)
      ) {
        reasons.push(
          reason(
            "SINGLE_MAKER_CONCENTRATION_EXCEEDED",
            "Maker usage exceeds 60% of actual market usage in the accounting window.",
          ),
        );
      }
    }
  }

  return decision(action, reasons, false);
}
