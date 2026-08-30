import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALNET_FIXTURE_ETH_BASE_UNITS,
  LOCALNET_FIXTURE_STRK_BASE_UNITS,
  createLocalnetPrivateBalanceFixture,
  formatLocalnetPrivateBalanceSummary,
} from "./localnet-user-fixture.mjs";

const identities = Object.freeze({
  alice: Object.freeze({ id: "alice", label: "Alice" }),
  bob: Object.freeze({ id: "bob", label: "Bob" }),
});
const tokens = Object.freeze({ strk: "0xstrk", eth: "0xeth" });

test("gives both localnet demo identities the same exact private STRK fixture", () => {
  const fixture = createLocalnetPrivateBalanceFixture(identities, tokens);

  assert.equal(LOCALNET_FIXTURE_STRK_BASE_UNITS, 10_000_000_000_000_000_000n);
  assert.equal(LOCALNET_FIXTURE_ETH_BASE_UNITS, 10_000_000_000_000_000_000n);
  assert.deepEqual(
    fixture.map(
      ({ identityId, tokenKey, tokenSymbol, token, amountBaseUnits }) => ({
        identityId,
        tokenKey,
        tokenSymbol,
        token,
        amountBaseUnits,
      }),
    ),
    [
      {
        identityId: "alice",
        tokenKey: "strk",
        tokenSymbol: "STRK",
        token: "0xstrk",
        amountBaseUnits: 10_000_000_000_000_000_000n,
      },
      {
        identityId: "bob",
        tokenKey: "strk",
        tokenSymbol: "STRK",
        token: "0xstrk",
        amountBaseUnits: 10_000_000_000_000_000_000n,
      },
      {
        identityId: "bob",
        tokenKey: "eth",
        tokenSymbol: "ETH",
        token: "0xeth",
        amountBaseUnits: 10_000_000_000_000_000_000n,
      },
    ],
  );
});

test("prints deterministic exact shielded holdings for each identity", () => {
  const fixture = createLocalnetPrivateBalanceFixture(identities, tokens);

  assert.deepEqual(formatLocalnetPrivateBalanceSummary(fixture), [
    "  Alice private fixture: 10 STRK shielded (10000000000000000000 base units)",
    "  Bob private fixture: 10 STRK shielded (10000000000000000000 base units) · 10 ETH shielded (10000000000000000000 base units)",
  ]);
});
