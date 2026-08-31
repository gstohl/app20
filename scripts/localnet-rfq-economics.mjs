/**
 * Localnet coordinator adapter for the reviewed RFQ economic policy.
 *
 * The TypeScript module is specified but unwired. This adapter is the only
 * localnet call site: it derives spread and USDC-equivalent from exact base
 * units, ignores any self-reported spread or USDC fields, and suspends the
 * market when the reference is older than 900 seconds instead of quoting
 * into the dark.
 *
 * Constants (5k/25k/50k caps, 50/100 bps, 90s TTL) remain unapproved
 * defaults. This is "specified → enforced on localnet with unapproved default
 * values", not P0-11/P0-12 closure. Public-network RFQ stays disabled.
 */

import {
  RFQ_APP20_FEE_BPS,
  RFQ_ECONOMIC_POLICY_ID,
  RFQ_MAX_QUOTE_TTL_SECONDS,
  RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS,
  RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS,
  RFQ_PER_TRADE_CAP_USDC_BASE_UNITS,
  RFQ_REFERENCE_REJECT_AGE_SECONDS,
  RFQ_REFERENCE_SUSPEND_AGE_SECONDS,
  RFQ_REVIEWED_BUY_TOKEN_DECIMALS,
  RFQ_REVIEWED_BUY_TOKEN_ID,
  RFQ_REVIEWED_MARKET_ID,
  RFQ_REVIEWED_SELL_TOKEN_DECIMALS,
  RFQ_REVIEWED_SELL_TOKEN_ID,
  RFQ_USDC_BASE_UNITS,
  evaluateRfqEconomicPolicy,
} from "../packages/private-intents/src/economic-policy.ts";

const BPS_SCALE = 10_000n;
const DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const STRK_SCALE = 10n ** 18n;
const USDC_SCALE = 10n ** 6n;
const LOCALNET_USDC_PER_STRK = 2n;
const RECOVERY_ACTIONS = new Set(["claim", "timeout", "refund"]);

export const LOCALNET_RFQ_ECONOMICS_DELTA =
  "specified → enforced on localnet with unapproved default values";

export {
  RFQ_ECONOMIC_POLICY_ID,
  RFQ_MAX_QUOTE_TTL_SECONDS,
  RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS,
  RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS,
  RFQ_PER_TRADE_CAP_USDC_BASE_UNITS,
  RFQ_REFERENCE_REJECT_AGE_SECONDS,
  RFQ_REFERENCE_SUSPEND_AGE_SECONDS,
  RFQ_REVIEWED_BUY_TOKEN_ID,
  RFQ_REVIEWED_MARKET_ID,
  RFQ_REVIEWED_SELL_TOKEN_ID,
};

/** Unapproved localnet fixture so concentration is not vacuously 100% at cold start. */
export const UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING = Object.freeze({
  makerCommittedUsdcBaseUnits: 5_000n * RFQ_USDC_BASE_UNITS,
  marketCommittedUsdcBaseUnits: 15_000n * RFQ_USDC_BASE_UNITS,
});

export function localnetPairTokenIds(direction) {
  if (direction === "STRK_USDC") {
    return Object.freeze({
      sellTokenId: RFQ_REVIEWED_SELL_TOKEN_ID,
      buyTokenId: RFQ_REVIEWED_BUY_TOKEN_ID,
    });
  }
  if (direction === "USDC_STRK") {
    return Object.freeze({
      sellTokenId: RFQ_REVIEWED_BUY_TOKEN_ID,
      buyTokenId: RFQ_REVIEWED_SELL_TOKEN_ID,
    });
  }
  throw new Error("localnet RFQ direction is outside the USDC↔STRK pair.");
}

function decimalsForLocalnetToken(tokenId) {
  if (tokenId === RFQ_REVIEWED_SELL_TOKEN_ID)
    return RFQ_REVIEWED_SELL_TOKEN_DECIMALS;
  if (tokenId === RFQ_REVIEWED_BUY_TOKEN_ID)
    return RFQ_REVIEWED_BUY_TOKEN_DECIMALS;
  return undefined;
}

export function deriveLocalnetReferenceBuyAmount({
  sellTokenId,
  buyTokenId,
  sellAmountBaseUnits,
}) {
  if (typeof sellAmountBaseUnits !== "bigint" || sellAmountBaseUnits <= 0n) {
    return undefined;
  }
  let buy;
  if (
    sellTokenId === RFQ_REVIEWED_SELL_TOKEN_ID &&
    buyTokenId === RFQ_REVIEWED_BUY_TOKEN_ID
  ) {
    buy =
      (sellAmountBaseUnits * LOCALNET_USDC_PER_STRK * USDC_SCALE) / STRK_SCALE;
  } else if (
    sellTokenId === RFQ_REVIEWED_BUY_TOKEN_ID &&
    buyTokenId === RFQ_REVIEWED_SELL_TOKEN_ID
  ) {
    buy =
      (sellAmountBaseUnits * STRK_SCALE) /
      (LOCALNET_USDC_PER_STRK * USDC_SCALE);
  } else {
    return undefined;
  }
  return buy > 0n ? buy : undefined;
}

export function deriveMakerSpreadBps(referenceBuy, offeredBuy) {
  if (
    typeof referenceBuy !== "bigint" ||
    referenceBuy <= 0n ||
    typeof offeredBuy !== "bigint" ||
    offeredBuy <= 0n
  ) {
    return undefined;
  }
  const spreadNumerator =
    offeredBuy < referenceBuy ? referenceBuy - offeredBuy : 0n;
  return Number((spreadNumerator * BPS_SCALE) / referenceBuy);
}

export function deriveUsdcEquivalentBaseUnits(
  referenceBuy,
  buyTokenDecimals = RFQ_REVIEWED_BUY_TOKEN_DECIMALS,
) {
  if (typeof referenceBuy !== "bigint" || referenceBuy <= 0n) return undefined;
  if (
    !Number.isSafeInteger(buyTokenDecimals) ||
    buyTokenDecimals < 0 ||
    buyTokenDecimals > 255
  ) {
    return undefined;
  }
  const quoteTokenScale = 10n ** BigInt(buyTokenDecimals);
  const usdcNumerator = referenceBuy * RFQ_USDC_BASE_UNITS;
  if (usdcNumerator % quoteTokenScale !== 0n) return undefined;
  const derived = usdcNumerator / quoteTokenScale;
  return derived > 0n ? derived : undefined;
}

/**
 * Reconstruct the maker-reserved buy amount from the DurableMakerNode integer
 * formula. Callers must still feed the reconstructed amount into evaluate();
 * spreadBps is never a policy assertion.
 */
export function reservedBuyAmountFromGross(grossBuyAmount, spreadBps) {
  if (typeof grossBuyAmount !== "bigint" || grossBuyAmount <= 0n) {
    throw new Error("grossBuyAmount must be a positive bigint.");
  }
  if (
    !Number.isSafeInteger(spreadBps) ||
    spreadBps < 0 ||
    spreadBps >= 10_000
  ) {
    throw new Error("spreadBps must be an integer in [0, 10000).");
  }
  const offered = (grossBuyAmount * BigInt(10_000 - spreadBps)) / 10_000n;
  if (offered <= 0n) {
    throw new Error("Reserved buy amount must be positive after spread.");
  }
  return offered;
}

export function formatRfqEconomicRefusal(decision) {
  const reasons = Array.isArray(decision?.reasons) ? decision.reasons : [];
  const codes = reasons.map((item) => item.code).join(",");
  const messages = reasons.map((item) => item.message).join(" ");
  const action = decision?.action ?? "unknown";
  const policyId = decision?.policyId ?? RFQ_ECONOMIC_POLICY_ID;
  return `RFQ economic policy ${policyId} refused ${action}: ${codes}. ${messages}`.trim();
}

function dailyWindow(decisionAt) {
  const startsAt = decisionAt - (decisionAt % DAILY_WINDOW_SECONDS);
  return {
    windowId: `localnet-risk-day-${startsAt}`,
    startsAt,
    endsAt: startsAt + DAILY_WINDOW_SECONDS,
  };
}

function reviewedMarketId(sellTokenId, buyTokenId) {
  if (
    (sellTokenId === RFQ_REVIEWED_SELL_TOKEN_ID &&
      buyTokenId === RFQ_REVIEWED_BUY_TOKEN_ID) ||
    (sellTokenId === RFQ_REVIEWED_BUY_TOKEN_ID &&
      buyTokenId === RFQ_REVIEWED_SELL_TOKEN_ID)
  ) {
    return RFQ_REVIEWED_MARKET_ID;
  }
  if (typeof sellTokenId === "string" && typeof buyTokenId === "string") {
    return `${sellTokenId}_${buyTokenId}`;
  }
  return RFQ_REVIEWED_MARKET_ID;
}

function freezeAccounting(value) {
  return Object.freeze({
    windowId: value.windowId,
    marketId: value.marketId,
    makerId: value.makerId,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    observedAt: value.observedAt,
    makerCommittedUsdcBaseUnits: value.makerCommittedUsdcBaseUnits,
    marketCommittedUsdcBaseUnits: value.marketCommittedUsdcBaseUnits,
  });
}

export function buildLocalnetRfqEconomicPolicyInput(
  input,
  { marketState, accounting } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Object.freeze({
      policyInput: input,
      derivedMakerSpreadBps: undefined,
      derivedUsdcEquivalentBaseUnits: undefined,
      referenceGrossBuyAmountBaseUnits: undefined,
    });
  }

  if (RECOVERY_ACTIONS.has(input.action)) {
    return Object.freeze({
      policyInput: Object.freeze({
        action: input.action,
        network: "localnet",
        decisionAt: input.decisionAt,
      }),
      derivedMakerSpreadBps: undefined,
      derivedUsdcEquivalentBaseUnits: undefined,
      referenceGrossBuyAmountBaseUnits: undefined,
    });
  }

  const sellTokenId = input.sellTokenId;
  const buyTokenId = input.buyTokenId;
  const sellDecimals = decimalsForLocalnetToken(sellTokenId);
  const buyDecimals = decimalsForLocalnetToken(buyTokenId);
  const marketId = reviewedMarketId(sellTokenId, buyTokenId);
  const referenceBuy = deriveLocalnetReferenceBuyAmount({
    sellTokenId,
    buyTokenId,
    sellAmountBaseUnits: input.requestedSellAmountBaseUnits,
  });
  const offeredBuy = input.offeredBuyAmountBaseUnits;
  const derivedMakerSpreadBps = deriveMakerSpreadBps(referenceBuy, offeredBuy);
  const usdcReferenceAmount =
    sellTokenId === RFQ_REVIEWED_BUY_TOKEN_ID
      ? input.requestedSellAmountBaseUnits
      : referenceBuy;
  const usdcReferenceDecimals =
    sellTokenId === RFQ_REVIEWED_BUY_TOKEN_ID ? sellDecimals : buyDecimals;
  const derivedUsdcEquivalentBaseUnits = deriveUsdcEquivalentBaseUnits(
    usdcReferenceAmount,
    usdcReferenceDecimals ?? RFQ_REVIEWED_BUY_TOKEN_DECIMALS,
  );
  const referenceAvailable = input.referenceAvailable !== false;

  let reference;
  if (!referenceAvailable || referenceBuy === undefined) {
    reference = Object.freeze({ available: false });
  } else {
    reference = Object.freeze({
      available: true,
      marketId,
      observedAt: input.referenceObservedAt,
      sellTokenId,
      sellTokenDecimals: sellDecimals,
      buyTokenId,
      buyTokenDecimals: buyDecimals,
      grossSellAmountBaseUnits: input.requestedSellAmountBaseUnits,
      grossBuyAmountBaseUnits: referenceBuy,
    });
  }

  const proposal = Object.freeze({
    marketId,
    makerId: input.makerId,
    sellTokenId,
    sellTokenDecimals: sellDecimals,
    buyTokenId,
    buyTokenDecimals: buyDecimals,
    requestedSellAmountBaseUnits: input.requestedSellAmountBaseUnits,
    offeredSellAmountBaseUnits:
      input.offeredSellAmountBaseUnits ?? input.requestedSellAmountBaseUnits,
    offeredBuyAmountBaseUnits: offeredBuy,
    usdcEquivalentBaseUnits: derivedUsdcEquivalentBaseUnits,
    makerSpreadBps: derivedMakerSpreadBps,
    app20FeeBps: RFQ_APP20_FEE_BPS,
    quoteTtlSeconds: input.quoteTtlSeconds,
  });

  return Object.freeze({
    policyInput: Object.freeze({
      action: input.action,
      network: "localnet",
      decisionAt: input.decisionAt,
      market: Object.freeze({
        marketId,
        state: marketState === "suspended" ? "suspended" : "active",
      }),
      reference,
      proposal,
      accounting,
    }),
    derivedMakerSpreadBps,
    derivedUsdcEquivalentBaseUnits,
    referenceGrossBuyAmountBaseUnits: referenceBuy,
  });
}

export function createLocalnetRfqEconomics(options = {}) {
  const fixture = options.unapprovedFixtureAccounting;
  const makerSeed =
    fixture && typeof fixture.makerCommittedUsdcBaseUnits === "bigint"
      ? fixture.makerCommittedUsdcBaseUnits
      : fixture === null
        ? 0n
        : UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING.makerCommittedUsdcBaseUnits;
  const marketSeed =
    fixture && typeof fixture.marketCommittedUsdcBaseUnits === "bigint"
      ? fixture.marketCommittedUsdcBaseUnits
      : fixture === null
        ? 0n
        : UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING.marketCommittedUsdcBaseUnits;

  let marketState =
    options.marketState === "suspended" ? "suspended" : "active";
  let activeWindowId;
  const makerCommitted = new Map();
  let marketCommitted = marketSeed;

  function ensureWindow(decisionAt) {
    const window = dailyWindow(decisionAt);
    if (activeWindowId !== window.windowId) {
      activeWindowId = window.windowId;
      makerCommitted.clear();
      marketCommitted = marketSeed;
    }
    return window;
  }

  function makerUsage(makerId) {
    if (!makerCommitted.has(makerId)) makerCommitted.set(makerId, makerSeed);
    return makerCommitted.get(makerId);
  }

  function snapshotAccounting(
    decisionAt,
    makerId,
    marketId = RFQ_REVIEWED_MARKET_ID,
  ) {
    const window = ensureWindow(decisionAt);
    return freezeAccounting({
      windowId: window.windowId,
      marketId,
      makerId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      observedAt: decisionAt,
      makerCommittedUsdcBaseUnits: makerUsage(makerId),
      marketCommittedUsdcBaseUnits: marketCommitted,
    });
  }

  function evaluate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      const decision = evaluateRfqEconomicPolicy(input);
      return Object.freeze({
        ...decision,
        derivedMakerSpreadBps: undefined,
        derivedUsdcEquivalentBaseUnits: undefined,
        referenceGrossBuyAmountBaseUnits: undefined,
      });
    }

    const accounting = RECOVERY_ACTIONS.has(input.action)
      ? undefined
      : snapshotAccounting(
          input.decisionAt,
          input.makerId,
          reviewedMarketId(input.sellTokenId, input.buyTokenId),
        );
    const built = buildLocalnetRfqEconomicPolicyInput(input, {
      marketState,
      accounting,
    });
    const decision = evaluateRfqEconomicPolicy(built.policyInput);
    if (
      decision.reasons.some(
        (reason) => reason.code === "REFERENCE_SUSPENSION_REQUIRED",
      )
    ) {
      marketState = "suspended";
    }
    return Object.freeze({
      ...decision,
      derivedMakerSpreadBps: built.derivedMakerSpreadBps,
      derivedUsdcEquivalentBaseUnits: built.derivedUsdcEquivalentBaseUnits,
      referenceGrossBuyAmountBaseUnits: built.referenceGrossBuyAmountBaseUnits,
    });
  }

  function commit(makerId, usdcEquivalentBaseUnits, decisionAt) {
    if (
      typeof usdcEquivalentBaseUnits !== "bigint" ||
      usdcEquivalentBaseUnits <= 0n
    ) {
      throw new Error("Committed USDC equivalent must be a positive bigint.");
    }
    ensureWindow(decisionAt);
    makerCommitted.set(makerId, makerUsage(makerId) + usdcEquivalentBaseUnits);
    marketCommitted += usdcEquivalentBaseUnits;
  }

  return Object.freeze({
    evaluate,
    commit,
    marketState: () => marketState,
    accountingSnapshot: snapshotAccounting,
    policyId: RFQ_ECONOMIC_POLICY_ID,
    delta: LOCALNET_RFQ_ECONOMICS_DELTA,
  });
}
