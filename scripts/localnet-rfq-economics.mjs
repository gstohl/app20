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

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
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
const ACCOUNTING_JOURNAL_DOMAIN = "app20/localnet-rfq-accounting/v1";
const STRK_SCALE = 10n ** 18n;
const USDC_SCALE = 10n ** 6n;
const LOCALNET_USDC_PER_STRK = 2n;
const RECOVERY_ACTIONS = new Set(["claim", "timeout", "refund"]);

function journalText(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error(`${label} must be non-empty text without a NUL byte.`);
  return value;
}

function journalCommitment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("RFQ accounting journal commitment is invalid.");
  const amount = value.usdcEquivalentBaseUnits;
  if (typeof amount !== "string" || !/^[1-9][0-9]*$/.test(amount))
    throw new Error("RFQ accounting journal amount is invalid.");
  if (!Number.isSafeInteger(value.committedAt) || value.committedAt <= 0)
    throw new Error("RFQ accounting journal commitment time is invalid.");
  return Object.freeze({
    commitmentId: journalText(value.commitmentId, "commitmentId"),
    makerId: journalText(value.makerId, "makerId"),
    usdcEquivalentBaseUnits: BigInt(amount),
    committedAt: value.committedAt,
  });
}

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

function trailingWindow(decisionAt) {
  // Policy timestamps are whole seconds and accounting windows are half-open.
  // Shifting the end one second past the decision represents (t - 24h, t]
  // exactly: a commitment made exactly 86,400 seconds ago has expired, while
  // one made 86,399 seconds ago is still counted.
  const endsAt = decisionAt + 1;
  const startsAt = endsAt - DAILY_WINDOW_SECONDS;
  return {
    windowId: `localnet-risk-trailing-24h-${startsAt}-${endsAt}`,
    startsAt,
    endsAt,
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
  const accountingPath =
    options.accountingPath === undefined
      ? undefined
      : journalText(options.accountingPath, "accountingPath");
  const commitmentTimes = [];
  const commitmentBuckets = new Map();
  let commitmentsById = new Map();
  let failed = false;

  function assertAvailable() {
    if (failed)
      throw new Error(
        "RFQ accounting is fail-stopped after uncertain persistence.",
      );
  }

  function firstTimeAtOrAfter(timestamp) {
    let low = 0;
    let high = commitmentTimes.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (commitmentTimes[middle] < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function indexCommitment(commitment) {
    let bucket = commitmentBuckets.get(commitment.committedAt);
    if (!bucket) {
      bucket = { market: 0n, byMaker: new Map() };
      commitmentBuckets.set(commitment.committedAt, bucket);
      const insertion = firstTimeAtOrAfter(commitment.committedAt);
      commitmentTimes.splice(insertion, 0, commitment.committedAt);
    }
    bucket.market += commitment.usdcEquivalentBaseUnits;
    bucket.byMaker.set(
      commitment.makerId,
      (bucket.byMaker.get(commitment.makerId) ?? 0n) +
        commitment.usdcEquivalentBaseUnits,
    );
  }

  function serializeCommitments(candidate) {
    const commitments = [...candidate.values()]
      .sort(
        (left, right) =>
          left.committedAt - right.committedAt ||
          left.commitmentId.localeCompare(right.commitmentId),
      )
      .map((commitment) => ({
        commitmentId: commitment.commitmentId,
        makerId: commitment.makerId,
        usdcEquivalentBaseUnits: commitment.usdcEquivalentBaseUnits.toString(),
        committedAt: commitment.committedAt,
      }));
    return `${JSON.stringify(
      { domain: ACCOUNTING_JOURNAL_DOMAIN, commitments },
      null,
      2,
    )}\n`;
  }

  function persistCommitments(candidate) {
    if (!accountingPath) return;
    const directory = dirname(accountingPath);
    let temporary;
    let renamed = false;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      temporary = `${accountingPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      options.faultInjector?.("before-write");
      writeFileSync(temporary, serializeCommitments(candidate), {
        mode: 0o600,
        flag: "wx",
      });
      options.faultInjector?.("after-write");
      const file = openSync(temporary, "r");
      try {
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      options.faultInjector?.("after-file-fsync");
      renameSync(temporary, accountingPath);
      renamed = true;
      chmodSync(accountingPath, 0o600);
      options.faultInjector?.("after-rename");
      const directoryFile = openSync(directory, "r");
      try {
        fsyncSync(directoryFile);
      } finally {
        closeSync(directoryFile);
      }
      options.faultInjector?.("after-directory-fsync");
    } catch (error) {
      failed = true;
      if (!renamed && temporary && existsSync(temporary)) {
        try {
          unlinkSync(temporary);
        } catch {
          // The accounting instance is fail-stopped; cleanup is best effort.
        }
      }
      throw new Error(
        "RFQ accounting persistence became uncertain; accounting is fail-stopped.",
        { cause: error },
      );
    }
  }

  if (accountingPath && existsSync(accountingPath)) {
    let journal;
    try {
      journal = JSON.parse(readFileSync(accountingPath, "utf8"));
    } catch (error) {
      throw new Error("RFQ accounting journal is not valid JSON.", {
        cause: error,
      });
    }
    if (
      !journal ||
      typeof journal !== "object" ||
      Array.isArray(journal) ||
      journal.domain !== ACCOUNTING_JOURNAL_DOMAIN ||
      !Array.isArray(journal.commitments)
    ) {
      throw new Error("RFQ accounting journal has an invalid schema.");
    }
    for (const raw of journal.commitments) {
      const commitment = journalCommitment(raw);
      if (commitmentsById.has(commitment.commitmentId))
        throw new Error(
          "RFQ accounting journal repeats a commitment identity.",
        );
      commitmentsById.set(commitment.commitmentId, commitment);
      indexCommitment(commitment);
    }
  }

  function snapshotAccounting(
    decisionAt,
    makerId,
    marketId = RFQ_REVIEWED_MARKET_ID,
  ) {
    assertAvailable();
    const window = trailingWindow(decisionAt);
    let makerCommittedUsdcBaseUnits = makerSeed;
    let marketCommittedUsdcBaseUnits = marketSeed;
    const endIndex = firstTimeAtOrAfter(window.endsAt);
    for (
      let index = firstTimeAtOrAfter(window.startsAt);
      index < endIndex;
      index += 1
    ) {
      const bucket = commitmentBuckets.get(commitmentTimes[index]);
      marketCommittedUsdcBaseUnits += bucket.market;
      makerCommittedUsdcBaseUnits += bucket.byMaker.get(makerId) ?? 0n;
    }
    return freezeAccounting({
      windowId: window.windowId,
      marketId,
      makerId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      observedAt: decisionAt,
      makerCommittedUsdcBaseUnits,
      marketCommittedUsdcBaseUnits,
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

  function commit(makerId, usdcEquivalentBaseUnits, decisionAt, commitmentId) {
    assertAvailable();
    const canonicalMakerId = journalText(makerId, "Committed makerId");
    if (
      typeof usdcEquivalentBaseUnits !== "bigint" ||
      usdcEquivalentBaseUnits <= 0n
    ) {
      throw new Error("Committed USDC equivalent must be a positive bigint.");
    }
    if (!Number.isSafeInteger(decisionAt) || decisionAt <= 0) {
      throw new Error("Commitment time must be a positive safe integer.");
    }
    const canonicalCommitmentId =
      commitmentId === undefined
        ? undefined
        : journalText(commitmentId, "commitmentId");
    if (accountingPath && canonicalCommitmentId === undefined) {
      throw new Error("Durable RFQ accounting requires a commitment identity.");
    }
    if (canonicalCommitmentId !== undefined) {
      const prior = commitmentsById.get(canonicalCommitmentId);
      if (prior) {
        if (
          prior.makerId !== canonicalMakerId ||
          prior.usdcEquivalentBaseUnits !== usdcEquivalentBaseUnits
        ) {
          throw new Error(
            "Commitment identity was reused with different economic terms.",
          );
        }
        return;
      }
    }
    const commitment = Object.freeze({
      ...(canonicalCommitmentId === undefined
        ? {}
        : { commitmentId: canonicalCommitmentId }),
      makerId: canonicalMakerId,
      usdcEquivalentBaseUnits,
      committedAt: decisionAt,
    });
    if (canonicalCommitmentId !== undefined) {
      const candidate = new Map(commitmentsById).set(
        canonicalCommitmentId,
        commitment,
      );
      persistCommitments(candidate);
      commitmentsById = candidate;
    }
    indexCommitment(commitment);
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
