import { describe, expect, it, vi } from "vitest";
import { readLocalnetRfqAuthority } from "./localnet-private-intents";
import {
  beginRfqPhaseAttempt,
  confirmRfqV3Take,
  createRfqLifecycleRecord,
  takeAttemptTargetFromLifecycle,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;

function settledV3() {
  const reviewing = createRfqLifecycleRecord({
    mode: "v3",
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "reviewing",
    now: NOW,
    requestDigest: `0x${"11".repeat(32)}`,
    terms: {
      pairId: "STRK_USDC",
      sellSymbol: "STRK",
      sellAddress: "0x1",
      sellDecimals: 18,
      sellAmount: "100",
      buySymbol: "USDC",
      buyAddress: "0x2",
      buyDecimals: 6,
      minBuyAmount: "190",
      buyAmount: "200",
      rfqExpiresAt: NOW + 60,
    },
    settlement: {
      version: "Localnet V3",
      escrowAddress: "0x5",
      dealId: "0x77",
      deadline: NOW + 60,
    },
    bucket: { min: "50", max: "100" },
    takerCommitment: "0x493619825a69dfc0fca6523f2714ded59c434c62d2d480d64439b96d9767006",
    takerSecret: "0x66",
    fills: [
      {
        makerId: "maker-a",
        lockId: "0x41",
        amountA: "100",
        amountB: "200",
        lockExpiresAt: NOW + 60,
      },
    ],
  });
  const preparing = beginRfqPhaseAttempt(
    reviewing,
    "take",
    "take-1",
    NOW + 1,
    takeAttemptTargetFromLifecycle(reviewing),
  );
  const submitted = updateRfqPhaseAttempt(
    preparing,
    "take",
    "submitted-unknown",
    NOW + 2,
    { transactionHash: "0xabc" },
  );
  return confirmRfqV3Take(
    transitionRfqLifecycle(submitted, "submission-unknown", NOW + 2),
    {
      tokenA: "0x1",
      totalA: 100n,
      tokenB: "0x2",
      totalB: 200n,
      fillCount: 1,
    },
    NOW + 3,
  );
}

describe("RFQ v3 authority request", () => {
  it("sends one exact Take candidate and its fill projection", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            result: {
              source: "localnet-chain-authority",
              runtimeEpoch: "a".repeat(32),
              chainId: "0x1",
              account: "0xabc",
              rfqId: "0x77",
              dealId: "0x77",
              lifecycle: "v3",
              status: "authoritative",
              revision: 1,
              observedAt: NOW + 4,
              validUntil: NOW + 34,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await expect(readLocalnetRfqAuthority(settledV3())).resolves.toMatchObject({
      status: "authoritative",
      lifecycle: "v3",
      dealId: "0x77",
    });
    expect(body).toMatchObject({
      lifecycle: "v3",
      rfqId: "0x77",
      dealId: "0x77",
      expected: {
        tokenA: "0x1",
        totalA: "100",
        tokenB: "0x2",
        totalB: "200",
        fills: [{ lockId: "0x41", amountA: "100", amountB: "200" }],
      },
      transactions: { take: "0xabc" },
    });
    vi.unstubAllGlobals();
  });
});
