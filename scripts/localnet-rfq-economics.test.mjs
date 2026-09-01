import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LOCALNET_RFQ_ECONOMICS_DELTA,
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
  UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING,
  buildLocalnetMakerSchedule,
  buildLocalnetRfqEconomicPolicyInput,
  createLocalnetRfqEconomics,
  deriveLocalnetReferenceBuyAmount,
  deriveMakerSpreadBps,
  deriveUsdcEquivalentBaseUnits,
  formatRfqEconomicRefusal,
  localnetPairTokenIds,
  reservedBuyAmountFromGross,
} from "./localnet-rfq-economics.mjs";

const NOW = 2_000_000_000;
const SELL = 10n ** 17n;
const REFERENCE_BUY = 200_000n;
const OFFERED_30_BPS = (REFERENCE_BUY * 9_970n) / 10_000n;
const REVERSE_SELL = 100_000n;
const REVERSE_REFERENCE_BUY = 50_000_000_000_000_000n;
const REVERSE_OFFERED_20_BPS = 49_900_000_000_000_000n;

function codes(decision) {
  return decision.reasons.map((item) => item.code);
}

function quoteInput(overrides = {}) {
  return {
    action: "quote",
    decisionAt: NOW,
    makerId: "app20-localnet-solver",
    sellTokenId: RFQ_REVIEWED_SELL_TOKEN_ID,
    buyTokenId: RFQ_REVIEWED_BUY_TOKEN_ID,
    requestedSellAmountBaseUnits: SELL,
    offeredSellAmountBaseUnits: SELL,
    offeredBuyAmountBaseUnits: OFFERED_30_BPS,
    quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS,
    referenceObservedAt: NOW - 1,
    makerSpreadBps: 0,
    usdcEquivalentBaseUnits: 1n,
    spreadBps: 0,
    ...overrides,
  };
}

test("delta is specified → enforced on localnet, not P0 closure", () => {
  assert.equal(
    LOCALNET_RFQ_ECONOMICS_DELTA,
    "specified → enforced on localnet with unapproved default values",
  );
  assert.equal(
    RFQ_ECONOMIC_POLICY_ID,
    "app20/rfq-economics/reviewed-first-release-v1",
  );
});

test("both directions preserve exact 18↔6 decimal reference, spread, and USDC units", () => {
  assert.equal(
    deriveLocalnetReferenceBuyAmount({
      sellTokenId: "STRK",
      buyTokenId: "USDC",
      sellAmountBaseUnits: SELL,
    }),
    REFERENCE_BUY,
  );
  assert.equal(
    deriveLocalnetReferenceBuyAmount({
      sellTokenId: "USDC",
      buyTokenId: "STRK",
      sellAmountBaseUnits: REVERSE_SELL,
    }),
    REVERSE_REFERENCE_BUY,
  );
  assert.equal(deriveMakerSpreadBps(REFERENCE_BUY, OFFERED_30_BPS), 30);
  assert.equal(
    deriveMakerSpreadBps(REVERSE_REFERENCE_BUY, REVERSE_OFFERED_20_BPS),
    20,
  );
  assert.equal(deriveUsdcEquivalentBaseUnits(REFERENCE_BUY), REFERENCE_BUY);
  assert.equal(deriveUsdcEquivalentBaseUnits(REVERSE_SELL, 6), REVERSE_SELL);
  assert.equal(reservedBuyAmountFromGross(REFERENCE_BUY, 30), OFFERED_30_BPS);
  assert.equal(
    reservedBuyAmountFromGross(REVERSE_REFERENCE_BUY, 20),
    REVERSE_OFFERED_20_BPS,
  );
  assert.deepEqual(localnetPairTokenIds("STRK_USDC"), {
    sellTokenId: "STRK",
    buyTokenId: "USDC",
  });
  assert.deepEqual(localnetPairTokenIds("USDC_STRK"), {
    sellTokenId: "USDC",
    buyTokenId: "STRK",
  });
});

test("maker schedules use the fixed localnet prices, shapes, tier, and inventory cap", () => {
  const bucketMinBaseUnits = 5n * 10n ** 17n;
  const bucketMaxBaseUnits = 10n ** 18n;
  const makerA = buildLocalnetMakerSchedule({
    maker: "A",
    direction: "STRK_USDC",
    bucketMinBaseUnits,
    bucketMaxBaseUnits,
    availableBuyBaseUnits: 10_000_000n,
  });
  assert.deepEqual(makerA.schedule, [
    { a: bucketMinBaseUnits, b: 997_000n },
    { a: bucketMaxBaseUnits, b: 1_994_000n },
  ]);
  assert.equal(makerA.midE18, 2n * 10n ** 18n);
  assert.equal(makerA.spreadBps, 30);

  const makerB = buildLocalnetMakerSchedule({
    maker: "B",
    direction: "STRK_USDC",
    bucketMinBaseUnits,
    bucketMaxBaseUnits,
    availableBuyBaseUnits: 10_000_000n,
  });
  assert.equal(makerB.schedule.length, 3);
  assert.deepEqual(makerB.schedule, [
    { a: bucketMinBaseUnits, b: 1_002_990n },
    { a: 75n * 10n ** 16n, b: 1_504_485n },
    { a: bucketMaxBaseUnits, b: 2_006_482n },
  ]);
  assert.equal(makerB.midE18, 2_010_000_000_000_000_000n);
  assert.equal(makerB.spreadBps, 20);

  const capped = buildLocalnetMakerSchedule({
    maker: "A",
    direction: "USDC_STRK",
    bucketMinBaseUnits: 1_000_000n,
    bucketMaxBaseUnits: 2_500_000n,
    availableBuyBaseUnits: 600_000_000_000_000_000n,
  });
  assert.ok(capped.aMax < 2_500_000n);
  assert.ok(capped.maxB <= 600_000_000_000_000_000n);
  assert.equal(
    buildLocalnetMakerSchedule({
      maker: "B",
      direction: "USDC_STRK",
      bucketMinBaseUnits: 1_000_000n,
      bucketMaxBaseUnits: 2_500_000n,
      availableBuyBaseUnits: 500_000_000_000_000_000n,
    }),
    null,
  );
});

test("schedule economics evaluates only the authenticated maximum point", () => {
  const economics = createLocalnetRfqEconomics();
  const schedule = Object.freeze([
    Object.freeze({ a: SELL / 2n, b: OFFERED_30_BPS / 2n }),
    Object.freeze({ a: SELL, b: OFFERED_30_BPS }),
  ]);
  const decision = economics.evaluateSchedule({
    action: "quote",
    decisionAt: NOW,
    makerId: "app20-localnet-solver",
    sellTokenId: "STRK",
    buyTokenId: "USDC",
    schedule,
    quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS,
    referenceObservedAt: NOW - 1,
    requestedSellAmountBaseUnits: 1n,
    offeredBuyAmountBaseUnits: 1n,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.derivedMakerSpreadBps, 30);
  assert.equal(decision.derivedUsdcEquivalentBaseUnits, REFERENCE_BUY);
  const makerBReverse = buildLocalnetMakerSchedule({
    maker: "B",
    direction: "USDC_STRK",
    bucketMinBaseUnits: 1_000_000n,
    bucketMaxBaseUnits: 2_500_000n,
    availableBuyBaseUnits: 10n ** 19n,
  });
  const makerBDecision = economics.evaluateSchedule({
    action: "quote",
    decisionAt: NOW,
    makerId: "app20-localnet-solver-b",
    sellTokenId: "USDC",
    buyTokenId: "STRK",
    schedule: makerBReverse.schedule,
    quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS,
    referenceObservedAt: NOW,
    referenceMidE18: makerBReverse.midE18,
  });
  assert.equal(makerBDecision.allowed, true);
  assert.ok(makerBDecision.derivedMakerSpreadBps <= 20);

  const malformed = economics.evaluateSchedule({
    action: "quote",
    decisionAt: NOW,
    schedule: [],
  });
  assert.equal(malformed.allowed, false);
  assert.ok(codes(malformed).includes("ACTION_UNSUPPORTED"));
});

test("self-reported spread and USDC-equivalent are ignored when building policy input", () => {
  const built = buildLocalnetRfqEconomicPolicyInput(quoteInput(), {
    marketState: "active",
    accounting: {
      windowId: "localnet-risk-day-1",
      marketId: RFQ_REVIEWED_MARKET_ID,
      makerId: "app20-localnet-solver",
      startsAt: NOW - 3_600,
      endsAt: NOW - 3_600 + 86_400,
      observedAt: NOW,
      makerCommittedUsdcBaseUnits:
        UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING.makerCommittedUsdcBaseUnits,
      marketCommittedUsdcBaseUnits:
        UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING.marketCommittedUsdcBaseUnits,
    },
  });
  assert.equal(built.derivedMakerSpreadBps, 30);
  assert.equal(built.derivedUsdcEquivalentBaseUnits, REFERENCE_BUY);
  assert.equal(built.policyInput.proposal.makerSpreadBps, 30);
  assert.equal(
    built.policyInput.proposal.usdcEquivalentBaseUnits,
    REFERENCE_BUY,
  );
  assert.equal(built.policyInput.proposal.app20FeeBps, 0);
  assert.notEqual(built.policyInput.proposal.makerSpreadBps, 0);
  assert.notEqual(built.policyInput.proposal.usdcEquivalentBaseUnits, 1n);
});

test("a compliant localnet STRK→USDC quote is allowed", () => {
  const economics = createLocalnetRfqEconomics();
  const decision = economics.evaluate(quoteInput());
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.policyId, RFQ_ECONOMIC_POLICY_ID);
  assert.equal(decision.derivedMakerSpreadBps, 30);
  assert.equal(decision.derivedUsdcEquivalentBaseUnits, REFERENCE_BUY);
  assert.equal(economics.marketState(), "active");
});

test("per-trade, per-maker, per-market, and concentration breaches are refused with exact reasons", () => {
  const overTrade = 2_501n * 10n ** 18n;
  const overTradeBuy = deriveLocalnetReferenceBuyAmount({
    sellTokenId: "STRK",
    buyTokenId: "USDC",
    sellAmountBaseUnits: overTrade,
  });
  const trade = createLocalnetRfqEconomics().evaluate(
    quoteInput({
      requestedSellAmountBaseUnits: overTrade,
      offeredSellAmountBaseUnits: overTrade,
      offeredBuyAmountBaseUnits: overTradeBuy,
    }),
  );
  assert.equal(trade.allowed, false);
  assert.ok(codes(trade).includes("PER_TRADE_CAP_EXCEEDED"));
  assert.ok(overTradeBuy > RFQ_PER_TRADE_CAP_USDC_BASE_UNITS);

  const makerCap = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: {
      makerCommittedUsdcBaseUnits:
        RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - REFERENCE_BUY + 1n,
      marketCommittedUsdcBaseUnits: 45_000n * 1_000_000n,
    },
  }).evaluate(quoteInput());
  assert.equal(makerCap.allowed, false);
  assert.ok(codes(makerCap).includes("PER_MAKER_DAILY_CAP_EXCEEDED"));

  const marketCap = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: {
      makerCommittedUsdcBaseUnits: 1_000n * 1_000_000n,
      marketCommittedUsdcBaseUnits:
        RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS - REFERENCE_BUY + 1n,
    },
  }).evaluate(quoteInput());
  assert.equal(marketCap.allowed, false);
  assert.ok(codes(marketCap).includes("PER_MARKET_DAILY_CAP_EXCEEDED"));

  const concentration = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: {
      makerCommittedUsdcBaseUnits: 0n,
      marketCommittedUsdcBaseUnits: 0n,
    },
  }).evaluate(quoteInput());
  assert.equal(concentration.allowed, false);
  assert.ok(
    codes(concentration).includes("SINGLE_MAKER_CONCENTRATION_EXCEEDED"),
  );
});

test("spread, deviation, and TTL breaches are refused with exact reasons", () => {
  const economics = createLocalnetRfqEconomics();
  const spread = economics.evaluate(
    quoteInput({
      offeredBuyAmountBaseUnits: (REFERENCE_BUY * 9_900n) / 10_000n,
      makerSpreadBps: 0,
    }),
  );
  assert.equal(spread.allowed, false);
  assert.ok(codes(spread).includes("MAKER_SPREAD_EXCEEDED"));
  assert.equal(spread.derivedMakerSpreadBps, 100);
  assert.ok(!codes(spread).includes("MAKER_SPREAD_MISMATCH"));

  const exactDeviation = (REFERENCE_BUY * 10_100n) / 10_000n;
  const deviation = economics.evaluate(
    quoteInput({
      offeredBuyAmountBaseUnits: exactDeviation + 1n,
    }),
  );
  assert.equal(deviation.allowed, false);
  assert.ok(codes(deviation).includes("TOTAL_DEVIATION_EXCEEDED"));

  const ttl = economics.evaluate(
    quoteInput({ quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS + 1 }),
  );
  assert.equal(ttl.allowed, false);
  assert.ok(codes(ttl).includes("QUOTE_TTL_EXCEEDED"));
});

test("a stale reference is refused and a 900s+ reference suspends the market", () => {
  const economics = createLocalnetRfqEconomics();
  const stale = economics.evaluate(
    quoteInput({
      referenceObservedAt: NOW - RFQ_REFERENCE_REJECT_AGE_SECONDS - 1,
    }),
  );
  assert.equal(stale.allowed, false);
  assert.ok(codes(stale).includes("REFERENCE_STALE"));
  assert.equal(economics.marketState(), "active");

  const dark = createLocalnetRfqEconomics();
  const suspend = dark.evaluate(
    quoteInput({
      referenceObservedAt: NOW - RFQ_REFERENCE_SUSPEND_AGE_SECONDS - 1,
    }),
  );
  assert.equal(suspend.allowed, false);
  assert.ok(codes(suspend).includes("REFERENCE_SUSPENSION_REQUIRED"));
  assert.equal(dark.marketState(), "suspended");

  const after = dark.evaluate(quoteInput());
  assert.equal(after.allowed, false);
  assert.ok(codes(after).includes("MARKET_SUSPENDED"));
  assert.equal(dark.marketState(), "suspended");
});

test("an unavailable reference is refused instead of quoting into the dark", () => {
  const decision = createLocalnetRfqEconomics().evaluate(
    quoteInput({ referenceAvailable: false }),
  );
  assert.equal(decision.allowed, false);
  assert.ok(codes(decision).includes("REFERENCE_UNAVAILABLE"));
});

test("a compliant USDC→STRK quote uses the sell-side USDC notional and is allowed", () => {
  const input = quoteInput({
    sellTokenId: "USDC",
    buyTokenId: "STRK",
    requestedSellAmountBaseUnits: REVERSE_SELL,
    offeredSellAmountBaseUnits: REVERSE_SELL,
    offeredBuyAmountBaseUnits: REVERSE_OFFERED_20_BPS,
  });
  const built = buildLocalnetRfqEconomicPolicyInput(input, {
    marketState: "active",
    accounting: {
      windowId: "localnet-risk-day-1",
      marketId: RFQ_REVIEWED_MARKET_ID,
      makerId: "app20-localnet-solver",
      startsAt: NOW - 3_600,
      endsAt: NOW - 3_600 + 86_400,
      observedAt: NOW,
      makerCommittedUsdcBaseUnits:
        UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING.makerCommittedUsdcBaseUnits,
      marketCommittedUsdcBaseUnits:
        UNAPPROVED_LOCALNET_FIXTURE_ACCOUNTING.marketCommittedUsdcBaseUnits,
    },
  });
  assert.equal(built.referenceGrossBuyAmountBaseUnits, REVERSE_REFERENCE_BUY);
  assert.equal(built.derivedMakerSpreadBps, 20);
  assert.equal(built.derivedUsdcEquivalentBaseUnits, REVERSE_SELL);
  assert.equal(built.policyInput.market.marketId, RFQ_REVIEWED_MARKET_ID);

  const decision = createLocalnetRfqEconomics().evaluate(input);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.derivedMakerSpreadBps, 20);
  assert.equal(decision.derivedUsdcEquivalentBaseUnits, REVERSE_SELL);
});

test("recovery actions are classified and never authorized", () => {
  const decision = createLocalnetRfqEconomics().evaluate({
    action: "claim",
    decisionAt: NOW,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.recoveryOnly, true);
  assert.ok(
    codes(decision).includes("RECOVERY_REQUIRES_PERSISTED_RESERVATION"),
  );
});

test("malformed input fails closed without throwing and is not retried", () => {
  const economics = createLocalnetRfqEconomics();
  assert.doesNotThrow(() => economics.evaluate(null));
  const first = economics.evaluate(null);
  const second = economics.evaluate(null);
  assert.equal(first.allowed, false);
  assert.equal(second.allowed, false);
  assert.deepEqual(codes(first), codes(second));
  assert.ok(codes(first).includes("ACTION_UNSUPPORTED"));
  assert.match(formatRfqEconomicRefusal(first), /ACTION_UNSUPPORTED/);
});

test("commit records outstanding USDC and can trip the maker daily cap", () => {
  const economics = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: {
      makerCommittedUsdcBaseUnits:
        RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - REFERENCE_BUY,
      marketCommittedUsdcBaseUnits: 45_000n * 1_000_000n,
    },
  });
  const first = economics.evaluate(quoteInput());
  assert.equal(first.allowed, true);
  economics.commit(
    "app20-localnet-solver",
    first.derivedUsdcEquivalentBaseUnits,
    NOW,
  );
  const second = economics.evaluate(quoteInput());
  assert.equal(second.allowed, false);
  assert.ok(codes(second).includes("PER_MAKER_DAILY_CAP_EXCEEDED"));
});

test("trailing accounting does not reset across a UTC-day boundary", () => {
  const utcBoundary = NOW - (NOW % 86_400) + 86_400;
  const economics = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: {
      makerCommittedUsdcBaseUnits:
        RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - REFERENCE_BUY,
      marketCommittedUsdcBaseUnits: 45_000n * 1_000_000n,
    },
  });
  economics.commit(
    "app20-localnet-solver",
    REFERENCE_BUY,
    utcBoundary - 1,
    "reservation-before-midnight",
  );
  const afterMidnight = economics.evaluate(
    quoteInput({
      decisionAt: utcBoundary + 1,
      referenceObservedAt: utcBoundary + 1,
    }),
  );
  assert.equal(afterMidnight.allowed, false);
  assert.ok(codes(afterMidnight).includes("PER_MAKER_DAILY_CAP_EXCEEDED"));
});

test("trailing 24-hour lower boundary expires at exactly 86,400 seconds", () => {
  const economics = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: {
      makerCommittedUsdcBaseUnits:
        RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - 2n * REFERENCE_BUY + 1n,
      marketCommittedUsdcBaseUnits: 45_000n * 1_000_000n,
    },
  });
  economics.commit(
    "app20-localnet-solver",
    REFERENCE_BUY,
    NOW,
    "boundary-reservation",
  );

  const oneSecondInside = economics.evaluate(
    quoteInput({
      decisionAt: NOW + 86_399,
      referenceObservedAt: NOW + 86_399,
    }),
  );
  assert.equal(oneSecondInside.allowed, false);
  assert.ok(codes(oneSecondInside).includes("PER_MAKER_DAILY_CAP_EXCEEDED"));

  const exactlyExpired = economics.evaluate(
    quoteInput({
      decisionAt: NOW + 86_400,
      referenceObservedAt: NOW + 86_400,
    }),
  );
  assert.equal(exactlyExpired.allowed, true);
  assert.ok(!codes(exactlyExpired).includes("PER_MAKER_DAILY_CAP_EXCEEDED"));
});

test("accounting snapshots use a moving half-open window and exact maker totals", () => {
  const economics = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: null,
  });
  economics.commit("maker-a", 10n, NOW - 86_400, "expired");
  economics.commit("maker-a", 20n, NOW - 86_399, "inside");
  economics.commit("maker-b", 30n, NOW, "other-maker");
  economics.commit("maker-a", 40n, NOW + 1, "future");

  const snapshot = economics.accountingSnapshot(NOW, "maker-a");
  assert.equal(snapshot.startsAt, NOW - 86_399);
  assert.equal(snapshot.endsAt, NOW + 1);
  assert.equal(snapshot.endsAt - snapshot.startsAt, 86_400);
  assert.match(snapshot.windowId, /^localnet-risk-trailing-24h-/);
  assert.equal(snapshot.makerCommittedUsdcBaseUnits, 20n);
  assert.equal(snapshot.marketCommittedUsdcBaseUnits, 50n);
});

test("commitment identities make replay idempotent and reject equivocation", () => {
  const economics = createLocalnetRfqEconomics({
    unapprovedFixtureAccounting: null,
  });
  economics.commit("maker-a", 20n, NOW, "reservation-a");
  economics.commit("maker-a", 20n, NOW + 1, "reservation-a");
  assert.equal(
    economics.accountingSnapshot(NOW + 1, "maker-a")
      .makerCommittedUsdcBaseUnits,
    20n,
  );
  assert.throws(
    () => economics.commit("maker-a", 21n, NOW + 1, "reservation-a"),
    /different economic terms/i,
  );
  assert.throws(
    () => economics.commit("maker-a", 1n, Number.NaN),
    /commitment time/i,
  );
});

test("durable accounting survives restart and preserves the exact boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "app20-rfq-accounting-"));
  const accountingPath = join(directory, "accounting.json");
  try {
    const first = createLocalnetRfqEconomics({
      accountingPath,
      unapprovedFixtureAccounting: null,
    });
    first.commit("maker-a", 20n, NOW, "reservation-a");
    assert.equal(statSync(accountingPath).mode & 0o777, 0o600);

    const restarted = createLocalnetRfqEconomics({
      accountingPath,
      unapprovedFixtureAccounting: null,
    });
    assert.equal(
      restarted.accountingSnapshot(NOW + 86_399, "maker-a")
        .makerCommittedUsdcBaseUnits,
      20n,
    );
    assert.equal(
      restarted.accountingSnapshot(NOW + 86_400, "maker-a")
        .makerCommittedUsdcBaseUnits,
      0n,
    );
    restarted.commit("maker-a", 20n, NOW + 1, "reservation-a");
    assert.equal(
      JSON.parse(readFileSync(accountingPath, "utf8")).commitments.length,
      1,
    );

    const journal = JSON.parse(readFileSync(accountingPath, "utf8"));
    journal.commitments.push(journal.commitments[0]);
    writeFileSync(accountingPath, JSON.stringify(journal));
    assert.throws(
      () =>
        createLocalnetRfqEconomics({
          accountingPath,
          unapprovedFixtureAccounting: null,
        }),
      /repeats a commitment identity/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uncertain accounting persistence fail-stops future risk decisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "app20-rfq-accounting-"));
  const accountingPath = join(directory, "accounting.json");
  try {
    const economics = createLocalnetRfqEconomics({
      accountingPath,
      unapprovedFixtureAccounting: null,
      faultInjector(stage) {
        if (stage === "after-write") throw new Error("fault");
      },
    });
    assert.throws(
      () => economics.commit("maker-a", 20n, NOW, "reservation-a"),
      /fail-stopped/i,
    );
    assert.throws(
      () => economics.accountingSnapshot(NOW, "maker-a"),
      /fail-stopped/i,
    );
    assert.equal(
      economics.evaluate({ action: "refund", decisionAt: NOW }).recoveryOnly,
      true,
    );
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
