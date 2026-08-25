import { describe, expect, it } from "vitest";
import {
  POOL_PROPOSAL_SCHEMA_REVISION,
  canonicalizePoolCreationReview,
  digestPoolCreationReview,
  validatePoolCreationDraft,
  type CanonicalPoolToken,
  type PoolCreationDraft,
  type PoolCreationReview,
} from "./pool-creation";

const STRK: CanonicalPoolToken = {
  network: "sepolia",
  address: "0x01",
  symbol: "STRK",
  decimals: 18,
};

const USDC: CanonicalPoolToken = {
  network: "sepolia",
  address: "0x02",
  symbol: "USDC",
  decimals: 6,
};

const DRAFT: PoolCreationDraft = {
  account: "0x0abc",
  chainId: "0x534e5f5345504f4c4941",
  registryRevision: "app20-token-registry/test-7",
  tokenA: STRK,
  tokenB: USDC,
  proposedAmountA: "1.25",
  proposedAmountB: "2.500001",
  referencePrice: "2.5",
};

function reviewFor(
  overrides: Partial<PoolCreationDraft> = {},
): PoolCreationReview {
  const result = validatePoolCreationDraft({ ...DRAFT, ...overrides });
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  if (!result.ok) throw new Error("Expected a valid pool proposal fixture.");
  return result.review;
}

function asReview(value: unknown): PoolCreationReview {
  return value as PoolCreationReview;
}

describe("neutral pool proposal", () => {
  it("prepares canonical exact units and a non-executable reference price", () => {
    const result = validatePoolCreationDraft({
      ...DRAFT,
      account: " 0x000ABC ",
      chainId: "0x00534E5F5345504F4C4941",
      registryRevision: " app20-token-registry/test-7 ",
      tokenA: { ...STRK, address: "0x0001", symbol: " strk " },
      tokenB: { ...USDC, address: "0X0002", symbol: "usdc" },
      proposedAmountA: " 001.2500 ",
      proposedAmountB: "0002.500001",
      referencePrice: " 0002.5000 ",
    });

    expect(result).toEqual({
      ok: true,
      errors: {},
      review: {
        proposalSchemaRevision: POOL_PROPOSAL_SCHEMA_REVISION,
        registryRevision: "app20-token-registry/test-7",
        account: "0xabc",
        chainId: "0x534e5f5345504f4c4941",
        tokenA: { address: "0x1", symbol: "STRK", decimals: 18 },
        tokenB: { address: "0x2", symbol: "USDC", decimals: 6 },
        proposedAmountABaseUnits: "1250000000000000000",
        proposedAmountBBaseUnits: "2500001",
        referencePrice: {
          orientation: "token-b-per-token-a",
          canonicalDecimal: "2.5",
          executable: false,
        },
      },
    });
  });

  it("uses reviewed six- and eighteen-decimal precision without floating point", () => {
    const review = reviewFor({
      proposedAmountA: "1.000000000000000001",
      proposedAmountB: "1.000001",
    });

    expect(review.proposedAmountABaseUnits).toBe("1000000000000000001");
    expect(review.proposedAmountBBaseUnits).toBe("1000001");

    for (const proposedAmountB of ["0.0000001", "1.0000010"]) {
      const tooPrecise = validatePoolCreationDraft({
        ...DRAFT,
        proposedAmountB,
      });
      expect(tooPrecise.ok, proposedAmountB).toBe(false);
      expect(tooPrecise.errors.proposedAmountB).toMatch(/exact amount/i);
    }
  });

  it("rejects canonical duplicates, unresolved tokens, and cross-network pairs", () => {
    const duplicate = validatePoolCreationDraft({
      ...DRAFT,
      tokenB: { ...USDC, address: "0x0001" },
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.pair).toMatch(/canonically different/i);

    const unverified = validatePoolCreationDraft({ ...DRAFT, tokenA: null });
    expect(unverified.ok).toBe(false);
    expect(unverified.errors.tokenA).toMatch(/not verified/i);

    const crossNetwork = validatePoolCreationDraft({
      ...DRAFT,
      tokenB: { ...USDC, network: "mainnet" },
    });
    expect(crossNetwork.ok).toBe(false);
    expect(crossNetwork.errors.pair).toMatch(/same network/i);
  });

  it("rejects malformed scope, inexact amounts, zero, signs, exponent notation, and u128 overflow", () => {
    const badScope = validatePoolCreationDraft({
      ...DRAFT,
      account: "0x0",
      chainId: "SN_SEPOLIA",
      registryRevision: "revision with spaces",
      tokenA: { ...STRK, decimals: 1.5 },
      proposedAmountB: "+1",
      referencePrice: "1e3",
    });
    expect(badScope.ok).toBe(false);
    expect(badScope.errors).toMatchObject({
      account: expect.stringMatching(/nonzero/i),
      chainId: expect.stringMatching(/canonical/i),
      registryRevision: expect.stringMatching(/canonical/i),
      tokenA: expect.stringMatching(/not verified/i),
      proposedAmountA: expect.stringMatching(/exact amount/i),
      proposedAmountB: expect.stringMatching(/exact amount/i),
      referencePrice: expect.stringMatching(/plain-decimal/i),
    });

    for (const proposedAmountA of ["0", "-1", "+1", "1e3", "."]) {
      const result = validatePoolCreationDraft({ ...DRAFT, proposedAmountA });
      expect(result.ok, proposedAmountA).toBe(false);
    }

    const zeroPrice = validatePoolCreationDraft({
      ...DRAFT,
      referencePrice: "000.000",
    });
    expect(zeroPrice.ok).toBe(false);
    expect(zeroPrice.errors.referencePrice).toMatch(/positive/i);

    for (const decimals of [-0, 1.5, 256]) {
      const invalidDecimals = validatePoolCreationDraft({
        ...DRAFT,
        tokenA: { ...STRK, decimals },
      });
      expect(invalidDecimals.ok, String(decimals)).toBe(false);
      expect(invalidDecimals.errors.tokenA).toMatch(/not verified/i);
    }

    const overflow = validatePoolCreationDraft({
      ...DRAFT,
      tokenA: { ...STRK, decimals: 0 },
      proposedAmountA: (1n << 128n).toString(),
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.errors.proposedAmountA).toMatch(/exact amount/i);
  });

  it("contains no fee, LP, AMM, liquidity, or combined-value fields", () => {
    const review = reviewFor();
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        visit(child);
      }
    };
    visit(review);

    expect(keys.join("|")).not.toMatch(
      /fee|(?:^|[^a-z])lp(?:[^a-z]|$)|amm|liquidity|combined.?value/i,
    );
    expect(JSON.stringify(review)).not.toContain("2500003.5");
  });
});

describe("pool proposal review checksum", () => {
  it("is deterministic for equivalent canonical inputs and key order", async () => {
    const canonical = reviewFor();
    const equivalent = reviewFor({
      account: "2748",
      chainId: "0x00534E5F5345504F4C4941",
      registryRevision: " app20-token-registry/test-7 ",
      tokenA: { ...STRK, address: "0x00001", symbol: "strk" },
      tokenB: { ...USDC, address: "0X00002", symbol: " usdc " },
      proposedAmountA: "001.2500",
      proposedAmountB: "2.500001",
      referencePrice: "002.500",
    });

    const reordered = asReview({
      referencePrice: {
        executable: false,
        canonicalDecimal: canonical.referencePrice.canonicalDecimal,
        orientation: canonical.referencePrice.orientation,
      },
      proposedAmountBBaseUnits: canonical.proposedAmountBBaseUnits,
      tokenB: {
        decimals: canonical.tokenB.decimals,
        symbol: canonical.tokenB.symbol,
        address: canonical.tokenB.address,
      },
      chainId: canonical.chainId,
      account: canonical.account,
      registryRevision: canonical.registryRevision,
      proposedAmountABaseUnits: canonical.proposedAmountABaseUnits,
      tokenA: {
        symbol: canonical.tokenA.symbol,
        address: canonical.tokenA.address,
        decimals: canonical.tokenA.decimals,
      },
      proposalSchemaRevision: canonical.proposalSchemaRevision,
    });

    expect(equivalent).toEqual(canonical);
    expect(canonicalizePoolCreationReview(reordered)).toBe(
      canonicalizePoolCreationReview(canonical),
    );
    expect(await digestPoolCreationReview(equivalent)).toBe(
      await digestPoolCreationReview(canonical),
    );
    expect(await digestPoolCreationReview(reordered)).toBe(
      await digestPoolCreationReview(canonical),
    );
  });

  it("binds every prepared review field", async () => {
    const review = reviewFor();
    const baseline = await digestPoolCreationReview(review);
    const mutations: readonly [string, PoolCreationReview][] = [
      [
        "proposal schema revision",
        asReview({
          ...review,
          proposalSchemaRevision: "app20/pool-proposal/v2",
        }),
      ],
      [
        "registry revision",
        asReview({
          ...review,
          registryRevision: "app20-token-registry/test-8",
        }),
      ],
      ["account", asReview({ ...review, account: "0xabd" })],
      ["chain", asReview({ ...review, chainId: "0x123" })],
      [
        "token A address",
        asReview({ ...review, tokenA: { ...review.tokenA, address: "0x3" } }),
      ],
      [
        "token A symbol",
        asReview({ ...review, tokenA: { ...review.tokenA, symbol: "WSTARK" } }),
      ],
      [
        "token A decimals",
        asReview({ ...review, tokenA: { ...review.tokenA, decimals: 17 } }),
      ],
      [
        "token B address",
        asReview({ ...review, tokenB: { ...review.tokenB, address: "0x4" } }),
      ],
      [
        "token B symbol",
        asReview({ ...review, tokenB: { ...review.tokenB, symbol: "USDT" } }),
      ],
      [
        "token B decimals",
        asReview({ ...review, tokenB: { ...review.tokenB, decimals: 7 } }),
      ],
      [
        "amount A",
        asReview({
          ...review,
          proposedAmountABaseUnits: "1250000000000000001",
        }),
      ],
      [
        "amount B",
        asReview({ ...review, proposedAmountBBaseUnits: "2500002" }),
      ],
      [
        "price orientation",
        asReview({
          ...review,
          referencePrice: {
            ...review.referencePrice,
            orientation: "token-a-per-token-b",
          },
        }),
      ],
      [
        "price decimal",
        asReview({
          ...review,
          referencePrice: {
            ...review.referencePrice,
            canonicalDecimal: "2.6",
          },
        }),
      ],
    ];

    for (const [label, mutation] of mutations) {
      expect(await digestPoolCreationReview(mutation), label).not.toBe(
        baseline,
      );
    }

    const executableMutation = asReview({
      ...review,
      referencePrice: { ...review.referencePrice, executable: true },
    });
    await expect(digestPoolCreationReview(executableMutation)).rejects.toThrow(
      /non-executable/i,
    );
  });

  it("returns an identifier only and rejects unbound fields", async () => {
    const review = reviewFor();
    const identifier = await digestPoolCreationReview(review);

    expect(identifier).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(identifier).not.toMatch(
      /signature|approval|transaction|pool.?id|policy|expiry/i,
    );

    expect(() =>
      canonicalizePoolCreationReview(asReview({ ...review, feeBps: 30 })),
    ).toThrow(/unrecognized field/i);
  });
});
