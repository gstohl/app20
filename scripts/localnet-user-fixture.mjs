const LOCALNET_FIXTURE_TOKEN_SCALE = 10n ** 18n;

export const LOCALNET_FIXTURE_ALICE_STRK_BASE_UNITS =
  20n * LOCALNET_FIXTURE_TOKEN_SCALE;
export const LOCALNET_FIXTURE_STRK_BASE_UNITS =
  10n * LOCALNET_FIXTURE_TOKEN_SCALE;
export const LOCALNET_FIXTURE_ETH_BASE_UNITS =
  10n * LOCALNET_FIXTURE_TOKEN_SCALE;

const PRIVATE_BALANCE_FIXTURE = Object.freeze([
  Object.freeze({
    identityId: "alice",
    tokenKey: "strk",
    tokenSymbol: "STRK",
    amountBaseUnits: LOCALNET_FIXTURE_ALICE_STRK_BASE_UNITS,
  }),
  Object.freeze({
    identityId: "bob",
    tokenKey: "strk",
    tokenSymbol: "STRK",
    amountBaseUnits: LOCALNET_FIXTURE_STRK_BASE_UNITS,
  }),
  Object.freeze({
    identityId: "bob",
    tokenKey: "eth",
    tokenSymbol: "ETH",
    amountBaseUnits: LOCALNET_FIXTURE_ETH_BASE_UNITS,
  }),
]);

/**
 * Resolve the deterministic, localnet-only private balance fixture against one
 * devnet runtime. Values remain bigint base units through the seed path.
 */
export function createLocalnetPrivateBalanceFixture(identities, tokens) {
  return PRIVATE_BALANCE_FIXTURE.map((entry) => {
    const identity = identities[entry.identityId];
    const token = tokens[entry.tokenKey];
    if (!identity || !token) {
      throw new Error(
        `Localnet private fixture could not resolve ${entry.identityId} ${entry.tokenSymbol}.`,
      );
    }
    return Object.freeze({ ...entry, identity, token });
  });
}

function exactFixtureTokenAmount(amountBaseUnits) {
  const whole = amountBaseUnits / LOCALNET_FIXTURE_TOKEN_SCALE;
  const remainder = amountBaseUnits % LOCALNET_FIXTURE_TOKEN_SCALE;
  if (remainder === 0n) return whole.toString();
  const fractional = remainder.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${fractional}`;
}

export function formatLocalnetPrivateBalanceSummary(fixture) {
  const byIdentity = new Map();
  for (const entry of fixture) {
    const balances = byIdentity.get(entry.identityId) ?? {
      label: entry.identity.label ?? entry.identityId,
      values: [],
    };
    balances.values.push(
      `${exactFixtureTokenAmount(entry.amountBaseUnits)} ${entry.tokenSymbol} shielded (${entry.amountBaseUnits.toString()} base units)`,
    );
    byIdentity.set(entry.identityId, balances);
  }
  return [...byIdentity.values()].map(
    ({ label, values }) => `  ${label} private fixture: ${values.join(" · ")}`,
  );
}
