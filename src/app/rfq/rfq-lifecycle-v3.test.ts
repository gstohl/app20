import { fillsDigest } from "@app20/private-intents";
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
    takerCommitment:
      "0x746db56abc4d9fab4832ee42e92e96bbbf8cf4c9fd063b8515bda90d1e8aa5d",
    takerSigningKey: "0x66",
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
      takerSigningKey: selected.takerSigningKey,
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
    expect(settled).not.toHaveProperty("takerSigningKey");
    expect(settled.attempts).not.toHaveProperty("funding");
  });

  it("quarantines a Take whose digest or LockTaken composition changed", () => {
    const unknown = submitted();
    const exactDigest = fillsDigest([{ lockId: "0x41", amountA: 100n }]);
    const observed = {
      tokenA: "0x1",
      totalA: 100n,
      tokenB: "0x2",
      totalB: 200n,
      fillCount: 1,
      fillsDigest: exactDigest,
      lockTaken: [{ lockId: "0x41", amountA: 100n }],
    };
    expect(confirmRfqV3Take(unknown, observed, NOW + 3).state).toBe("settled");
    expect(
      confirmRfqV3Take(
        unknown,
        { ...observed, fillsDigest: "0x123" },
        NOW + 3,
      ),
    ).toMatchObject({
      state: "quarantined",
      reason: expect.stringMatching(/fill composition/i),
    });
    expect(
      confirmRfqV3Take(
        unknown,
        {
          ...observed,
          lockTaken: [{ lockId: "0x42", amountA: 100n }],
        },
        NOW + 3,
      ).state,
    ).toBe("quarantined");
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

  it("closes an RFQ and deletes its key after an on-chain reverted Take", () => {
    const reverted = revertRfqV3Take(submitted(), NOW + 3);
    expect(reverted).toMatchObject({
      state: "expired",
      reason: "take-reverted",
      attempts: { take: { state: "reverted" } },
    });
    expect(reverted).not.toHaveProperty("takerSigningKey");
    expect(() =>
      transitionRfqLifecycle(submitted(), "reviewing", NOW + 3),
    ).toThrow(/cannot return to review/i);
    expect(() =>
      transitionRfqLifecycle(submitted(), "funded", NOW + 3),
    ).toThrow(/legacy funded/i);
    expect(lifecycleMaySubmit(reverted, NOW + 4)).toBe(false);
    expect(
      restoreRfqLifecycle(structuredClone(reverted), {
        chainId: reverted.chainId,
        account: reverted.account,
        now: NOW + 4,
      }),
    ).toMatchObject({ state: "expired", reason: "take-reverted" });
    expect(() =>
      beginRfqPhaseAttempt(
        reverted,
        "take",
        "take-2",
        NOW + 4,
        takeAttemptTargetFromLifecycle(reverted),
      ),
    ).toThrow(/cannot begin|unavailable/i);
  });

  it("allows a new deliberate attempt only when pre-wallet submission was disproved", () => {
    const base = reviewing();
    const preparing = beginRfqPhaseAttempt(
      base,
      "take",
      "take-not-submitted",
      NOW + 1,
      takeAttemptTargetFromLifecycle(base),
    );
    const unproven = updateRfqPhaseAttempt(
      preparing,
      "take",
      "reverted",
      NOW + 2,
    );
    expect(lifecycleMaySubmit(unproven, NOW + 3)).toBe(false);
    expect(() =>
      beginRfqPhaseAttempt(
        unproven,
        "take",
        "take-unproven",
        NOW + 3,
        takeAttemptTargetFromLifecycle(unproven),
      ),
    ).toThrow(/proven not submitted/i);
    const disproved = updateRfqPhaseAttempt(
      preparing,
      "take",
      "reverted",
      NOW + 2,
      {
        walletBoundary: "not-entered",
        observation: "Take was proven not submitted before wallet entry.",
      },
    );
    expect(lifecycleMaySubmit(disproved, NOW + 3)).toBe(true);
    const retry = beginRfqPhaseAttempt(
      disproved,
      "take",
      "take-2",
      NOW + 3,
      takeAttemptTargetFromLifecycle(disproved),
    );
    expect(retry.attempts.take).toMatchObject({
      attemptId: "take-2",
      state: "preparing",
    });
  });

  it("restores backup rows without the taker signing key", () => {
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
      takerCommitment:
        "0x746db56abc4d9fab4832ee42e92e96bbbf8cf4c9fd063b8515bda90d1e8aa5d",
    });
    expect(restored).not.toHaveProperty("takerSigningKey");
    expect(() =>
      beginRfqPhaseAttempt(
        restored,
        "take",
        "take-backup",
        NOW + 2,
        takeAttemptTargetFromLifecycle(restored),
      ),
    ).toThrow(/signing authority|verification-only/i);
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
