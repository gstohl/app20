import { describe, expect, it } from "vitest";
import {
  beginRfqPhaseAttempt,
  confirmRfqV3Take,
  createRfqLifecycleRecord,
  lifecycleMaySubmit,
  restoreRfqLifecycle,
  revertRfqV3Take,
  reviseRfqLifecycle,
  takeAttemptTargetFromLifecycle,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;
const DIGEST = `0x${"11".repeat(32)}`;

function reviewing(): RfqLifecycleRecord {
  const record = createRfqLifecycleRecord({
    mode: "v3",
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "reviewing",
    now: NOW,
    requestDigest: DIGEST,
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
  return reviseRfqLifecycle(record, { quoteExpiresAt: NOW + 30 });
}

function submitted(): RfqLifecycleRecord {
  const base = reviewing();
  const preparing = beginRfqPhaseAttempt(
    base,
    "take",
    "take-1",
    NOW + 1,
    takeAttemptTargetFromLifecycle(base),
  );
  const unknown = updateRfqPhaseAttempt(
    preparing,
    "take",
    "submitted-unknown",
    NOW + 2,
    { transactionHash: "0xabc" },
  );
  return transitionRfqLifecycle(unknown, "submission-unknown", NOW + 2);
}

describe("RFQ lifecycle v3", () => {
  it("persists a requesting record before any maker fills exist", () => {
    const selected = reviewing();
    const requesting = createRfqLifecycleRecord({
      mode: "v3",
      chainId: selected.chainId,
      account: selected.account,
      rfqId: selected.rfqId,
      state: "requesting",
      now: NOW,
      requestDigest: selected.requestDigest,
      terms: selected.terms,
      bucket: selected.bucket,
      takerCommitment: selected.takerCommitment,
      takerSecret: selected.takerSecret,
    });
    expect(requesting).not.toHaveProperty("fills");
    expect(
      restoreRfqLifecycle(structuredClone(requesting), {
        chainId: requesting.chainId,
        account: requesting.account,
        now: NOW + 1,
      }).state,
    ).toBe("requesting");
  });

  it("binds the exact Take target and settles directly without retaining the secret", () => {
    const unknown = submitted();
    expect(unknown.attempts.take?.target).toEqual({
      operation: "take",
      chainId: "0x1",
      account: "0xabc",
      rfqId: "0x77",
      requestDigest: DIGEST,
      dealId: "0x77",
      expected: {
        tokenA: "0x1",
        totalA: "100",
        tokenB: "0x2",
        totalB: "200",
        fills: [{ lockId: "0x41", amountA: "100", amountB: "200" }],
      },
    });
    const settled = confirmRfqV3Take(
      unknown,
      {
        tokenA: "0x1",
        totalA: 100n,
        tokenB: "0x2",
        totalB: 200n,
        fillCount: 1,
      },
      NOW + 3,
    );
    expect(settled).toMatchObject({
      mode: "v3",
      state: "settled",
      takeTransactionHash: "0xabc",
      attempts: { take: { state: "confirmed" } },
    });
    expect(settled).not.toHaveProperty("takerSecret");
    expect(settled.attempts).not.toHaveProperty("funding");
  });

  it("settles a hashless wallet-boundary attempt only after the exact Take read", () => {
    const base = reviewing();
    const preparing = beginRfqPhaseAttempt(
      base,
      "take",
      "take-hashless",
      NOW + 1,
      takeAttemptTargetFromLifecycle(base),
    );
    const boundaryUnknown = transitionRfqLifecycle(
      updateRfqPhaseAttempt(
        preparing,
        "take",
        "wallet-boundary-unknown",
        NOW + 2,
        { walletBoundary: "entered" },
      ),
      "submission-unknown",
      NOW + 2,
    );
    const settled = confirmRfqV3Take(
      boundaryUnknown,
      {
        tokenA: "0x1",
        totalA: 100n,
        tokenB: "0x2",
        totalB: 200n,
        fillCount: 1,
      },
      NOW + 3,
    );
    expect(settled.state).toBe("settled");
    expect(
      restoreRfqLifecycle(structuredClone(settled), {
        chainId: settled.chainId,
        account: settled.account,
        now: NOW + 4,
      }).state,
    ).toBe("settled");
  });

  it("returns to review only after an exact reverted Take", () => {
    const reverted = revertRfqV3Take(submitted(), NOW + 3);
    expect(reverted).toMatchObject({
      state: "reviewing",
      takerSecret: "0x66",
      attempts: { take: { state: "reverted" } },
    });
    expect(() =>
      transitionRfqLifecycle(submitted(), "reviewing", NOW + 3),
    ).toThrow(/proven reverted Take/i);
    expect(() =>
      transitionRfqLifecycle(submitted(), "funded", NOW + 3),
    ).toThrow(/legacy funded/i);
    expect(lifecycleMaySubmit(reverted, NOW + 4)).toBe(true);
    expect(lifecycleMaySubmit(reverted, NOW + 60)).toBe(false);
    const retry = beginRfqPhaseAttempt(
      reverted,
      "take",
      "take-2",
      NOW + 4,
      takeAttemptTargetFromLifecycle(reverted),
    );
    expect(retry.attempts.take).toMatchObject({
      attemptId: "take-2",
      state: "preparing",
    });
    expect(retry).not.toHaveProperty("takeTransactionHash");
  });

  it("restores backup rows without the execution secret", () => {
    const source = reviewing();
    const restored = restoreRfqLifecycle(structuredClone(source), {
      chainId: source.chainId,
      account: source.account,
      now: NOW + 1,
      fromBackup: true,
    });
    expect(restored).toMatchObject({
      mode: "v3",
      state: "reviewing",
      restoredFromBackup: true,
      takerCommitment: "0x493619825a69dfc0fca6523f2714ded59c434c62d2d480d64439b96d9767006",
    });
    expect(restored).not.toHaveProperty("takerSecret");
    expect(() =>
      beginRfqPhaseAttempt(
        restored,
        "take",
        "take-backup",
        NOW + 2,
        takeAttemptTargetFromLifecycle(restored),
      ),
    ).toThrow(/verification-only/i);
  });

  it("quarantines a restored row whose exact fill totals changed", () => {
    const source = structuredClone(reviewing()) as unknown as {
      [key: string]: unknown;
      chainId: string;
      account: string;
      fills: Array<{
        makerId: string;
        lockId: string;
        amountA: string;
        amountB: string;
        lockExpiresAt: number;
      }>;
    };
    source.fills[0] = { ...source.fills[0]!, amountB: "199" };
    expect(
      restoreRfqLifecycle(source, {
        chainId: source.chainId,
        account: source.account,
        now: NOW + 1,
      }).state,
    ).toBe("quarantined");
  });
});
