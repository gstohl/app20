import { describe, expect, it, vi } from "vitest";
import {
  buildLocalnetIntentPayoutActions,
  createLocalnetIntentId,
  formatLocalnetTokenAmount,
  parseLocalnetTokenAmount,
  requestLocalnetSolverQuote,
  signLocalnetSolverQuote,
  type LocalnetMarketToken,
} from "./localnet-private-intents";

const STRK = "0x4718";
const ETH = "0x455448";
const STRK_TOKEN: LocalnetMarketToken = {
  symbol: "STRK",
  address: STRK,
  decimals: 18,
};
const USDC_TOKEN: LocalnetMarketToken = {
  symbol: "USDC",
  address: "0x05dc",
  decimals: 6,
};

describe("localnet private-intent adapter", () => {
  it("parses and formats token amounts without assuming 18 decimals", () => {
    expect(parseLocalnetTokenAmount("0.1", STRK_TOKEN)).toBe(10n ** 17n);
    expect(parseLocalnetTokenAmount("0.19", USDC_TOKEN)).toBe(190_000n);
    expect(formatLocalnetTokenAmount(199_400n, USDC_TOKEN)).toBe("0.1994");
    expect(
      formatLocalnetTokenAmount(49_850_000_000_000_000n, STRK_TOKEN, 6),
    ).toBe("0.04985");
  });

  it("rejects zero, excess precision, and escrow-overflow amounts", () => {
    expect(() => parseLocalnetTokenAmount("0", USDC_TOKEN)).toThrow(
      "greater than zero",
    );
    expect(() => parseLocalnetTokenAmount("0.0000001", USDC_TOKEN)).toThrow(
      "at most 6 decimal places",
    );
    expect(() =>
      parseLocalnetTokenAmount((2n ** 128n).toString(), USDC_TOKEN),
    ).toThrow("does not fit the escrow");
  });

  it("creates a non-zero felt-sized unpredictable intent id", () => {
    const first = createLocalnetIntentId();
    const second = createLocalnetIntentId();
    expect(first).toMatch(/^0x[0-9a-f]{62}$/);
    expect(BigInt(first)).toBeGreaterThan(0n);
    expect(second).not.toBe(first);
  });

  it.each([
    ["claim", "0x2"],
    ["timeout", "0x3"],
  ] as const)("builds claim-ticket %s actions", (operation, variant) => {
    const actions = buildLocalnetIntentPayoutActions({
      operation,
      escrowAddress: "0xe5c",
      recoveryAddress: "0xa11ce",
      ticketAddress: "0x71c",
      dealId: "0xd001",
      payoutToken: ETH,
    });
    expect(actions).toEqual([
      {
        type: "withdraw",
        token: "0x71c",
        amount: "0x1",
        recipient: "0xe5c",
      },
      {
        type: "transfer",
        token: ETH,
        amount: "OPEN",
        recipient: "0xa11ce",
      },
      {
        type: "invoke",
        contract: "0xe5c",
        calldata: [variant, "0xd001", "${poolAddress}", "${openNoteIds[0]}"],
      },
    ]);
  });

  it("parses a bounded quote from the local solver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                solverId: "app20-localnet-solver",
                buyAmount: "100",
                solverInventory: "1000",
                sellToken: STRK,
                buyToken: ETH,
                provenance: "fixture",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      requestLocalnetSolverQuote({
        sellToken: STRK,
        sellAmount: 1_000n,
        buyToken: ETH,
      }),
    ).resolves.toMatchObject({
      solverId: "app20-localnet-solver",
      buyAmount: 100n,
      solverInventory: 1_000n,
    });
    vi.unstubAllGlobals();
  });

  it("rejects a solver signature over a different canonical payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                signature: "0xab",
                canonical: "different",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      signLocalnetSolverQuote("expected", {
        domain: "app20/private-intent-quote/v1",
        pool: "starknet:APP20_LOCALNET",
        helper: "0x1",
        sellToken: STRK,
        sellAmount: 1n,
        buyToken: ETH,
        intentDigest: "0x2",
        solverId: "app20-localnet-solver",
        solverKey: "app20-localnet-solver/ecdsa-p256-v1",
        nonce: `0x${"11".repeat(32)}`,
        buyAmount: 1n,
        spreadBps: 30,
        pricingProvenance: "fixture",
        quotedAt: 1,
        quoteExpiresAt: 2,
      }),
    ).rejects.toThrow(/different quote payload/i);
    vi.unstubAllGlobals();
  });
});
