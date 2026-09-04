import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadProductionSecurityHeaders,
  reconcileViolations,
  validateCoinGeckoOptInRequests,
  validateKnownViolations,
} from "./verify-production-csp.mjs";

const knownViolation = {
  route: "/rfq",
  directive: "connect-src",
  blockedURI:
    "https://api.coingecko.com/api/v3/coins/starknet/ohlc?vs_currency=usd&days=1",
  occurrenceCount: 1,
  affectedFeature: "Opt-in public price history",
  userVisibleConsequence: "The chart is unavailable after opt-in.",
  exactFile: "workers/relay/src/headers.ts",
  exactChange: "Add the reviewed origin to connect-src.",
};

test("production headers include exact Wrangler and reviewed public-data origins", async () => {
  const { csp, frameOrigins, connectOrigins, assetProbeBody } =
    await loadProductionSecurityHeaders();

  assert.equal(assetProbeBody, "APP20 Worker asset-path probe");
  assert.deepEqual(frameOrigins, ["https://auth.privy.io"]);
  assert.deepEqual(connectOrigins, [
    "https://auth.privy.io",
    "https://api.privy.io",
  ]);
  assert.match(csp, /frame-src 'self' https:\/\/auth\.privy\.io(?:;|$)/);
  assert.match(
    csp,
    /connect-src 'self' https:\/\/auth\.privy\.io https:\/\/api\.privy\.io https:\/\/api\.coingecko\.com(?:;|$)/,
  );
});

test("known baseline records require the descriptive resolution fields", () => {
  assert.deepEqual(
    validateKnownViolations({
      schemaVersion: 2,
      knownViolations: [knownViolation],
    }),
    [knownViolation],
  );
  assert.throws(
    () =>
      validateKnownViolations({
        schemaVersion: 2,
        knownViolations: [{ ...knownViolation, exactChange: "" }],
      }),
    /non-empty exactChange/,
  );
});

test("violation reconciliation matches the exact blocked URI and count", () => {
  const observed = [
    {
      route: "/rfq",
      directive: "connect-src",
      blockedURI: knownViolation.blockedURI,
    },
  ];

  assert.deepEqual(reconcileViolations(observed, [knownViolation]), {
    unexpected: [],
    missing: [],
  });
});

test("violation reconciliation rejects an extra identical occurrence", () => {
  const expected = {
    route: "/rfq",
    directive: "connect-src",
    blockedURI: knownViolation.blockedURI,
  };

  assert.deepEqual(
    reconcileViolations([expected, { ...expected }], [knownViolation]),
    { unexpected: [{ ...expected }], missing: [] },
  );
});

test("violation reconciliation rejects an extra same-origin different-path violation", () => {
  const expected = {
    route: "/rfq",
    directive: "connect-src",
    blockedURI: knownViolation.blockedURI,
  };
  const exfiltration = {
    route: "/rfq",
    directive: "connect-src",
    blockedURI: "https://api.coingecko.com/exfiltrate",
  };

  assert.deepEqual(
    reconcileViolations([expected, exfiltration], [knownViolation]),
    { unexpected: [exfiltration], missing: [] },
  );
});

test("violation reconciliation rejects new violations and stale records", () => {
  const unexpected = {
    route: "/funding",
    directive: "img-src",
    blockedURI: "https://unexpected.example/image.png",
  };

  assert.deepEqual(reconcileViolations([unexpected], [knownViolation]), {
    unexpected: [unexpected],
    missing: [{ ...knownViolation, observedCount: 0 }],
  });
});

test("CoinGecko remains idle until the explicit public-context opt-in", () => {
  assert.deepEqual(
    validateCoinGeckoOptInRequests({
      beforeDisclosure: 0,
      beforeOptIn: 0,
      afterOptIn: 1,
    }),
    [],
  );
});

test("CoinGecko request checks reject eager and missing public-context loads", () => {
  assert.deepEqual(
    validateCoinGeckoOptInRequests({
      beforeDisclosure: 1,
      beforeOptIn: 2,
      afterOptIn: 2,
    }),
    [
      "CoinGecko was contacted 1 time(s) before the public-market disclosure was opened",
      "opening the public-market disclosure contacted CoinGecko (1 -> 2 request(s))",
      "the explicit CoinGecko opt-in did not make a price-history request",
    ],
  );
});
