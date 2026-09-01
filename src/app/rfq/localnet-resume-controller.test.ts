import { describe, expect, it } from "vitest";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
} from "./rfq-lifecycle";
import {
  authorizeLocalnetResumeCommand,
  localnetResumeDecision,
} from "./localnet-resume-controller";
import {
  prepareFundedSettlementExpiry,
  preparePreFundingReservationRelease,
} from "./localnet-release-recovery";

const NOW = 1_900_000_000;
function record(
  state: Parameters<typeof createRfqLifecycleRecord>[0]["state"],
) {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x1",
    state,
    now: NOW,
    requestDigest: `0x${"ab".repeat(32)}`,
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
      rfqExpiresAt: NOW + 20,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "key-a",
      nonce: "nonce-a",
      reservationId: `0x${"bc".repeat(32)}`,
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 10,
      reservationExpiresAt: NOW + 15,
      buyAmount: "199",
      intentDigest: `0x${"ab".repeat(32)}`,
      signature: "signature-a",
      reservationFence: "7",
      quoteDigest: `0x${"cd".repeat(32)}`,
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x2",
      dealId: "0x1",
      ticketAddress: "0x4",
      deadline: NOW + 20,
    },
  });
}

function v3Record() {
  return createRfqLifecycleRecord({
    mode: "v3",
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "reviewing",
    now: NOW,
    requestDigest: `0x${"ef".repeat(32)}`,
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
      rfqExpiresAt: NOW + 20,
    },
    settlement: {
      version: "Localnet V3",
      escrowAddress: "0x5",
      dealId: "0x77",
      deadline: NOW + 20,
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
        lockExpiresAt: NOW + 20,
      },
    ],
  });
}

describe("localnet resume controller", () => {
  it("uses Take-only resume rules for RFQ v3", () => {
    const reviewing = v3Record();
    expect(localnetResumeDecision(reviewing, NOW + 1)).toMatchObject({
      action: "take",
      disabled: false,
    });
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "take",
      "take-1",
      NOW + 1,
      {
        operation: "take",
        chainId: reviewing.chainId,
        account: reviewing.account,
        rfqId: reviewing.rfqId,
        requestDigest: reviewing.requestDigest!,
        dealId: reviewing.settlement!.dealId,
        expected: {
          tokenA: "0x1",
          totalA: "100",
          tokenB: "0x2",
          totalB: "200",
          fills: [{ lockId: "0x41", amountA: "100", amountB: "200" }],
        },
      },
    );
    expect(localnetResumeDecision(preparing, NOW + 2)).toMatchObject({
      action: "verify-take",
      label: "Check pre-submission Take lease",
    });
    expect(
      localnetResumeDecision(
        { ...reviewing, restoredFromBackup: true, takerSecret: undefined },
        NOW + 1,
      ),
    ).toMatchObject({ action: "none", disabled: true });
  });

  it("never offers a duplicate fund while an attempt is unknown", () => {
    const reviewing = record("reviewing");
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "attempt-1",
      NOW + 1,
      fundingTicketAttemptTargetFromLifecycle(reviewing),
    );
    expect(localnetResumeDecision(preparing, NOW + 2)).toMatchObject({
      action: "verify-funding",
      label: "Check pre-submission funding lease",
    });
  });

  it("offers fill rather than fund for a confirmed funded record", () => {
    expect(localnetResumeDecision(record("funded"), NOW + 1).action).toBe(
      "request-maker-fill",
    );
  });

  it("scopes a verifier failure to its row and offers only a read retry", () => {
    const failed = {
      ...record("funded"),
      recoveryReadFailure: {
        detail: "RPC timed out while reading deal 0x1.",
        observedAt: NOW + 1,
      },
    };
    expect(localnetResumeDecision(failed, NOW + 2)).toMatchObject({
      action: "verify-deal",
      label: "Retry deal verification",
      disabled: false,
    });
    expect(localnetResumeDecision(failed, NOW + 2).reason).toContain(
      "RPC timed out while reading deal 0x1.",
    );
    expect(localnetResumeDecision(record("claimable"), NOW + 2).action).toBe(
      "claim",
    );
  });

  it("exposes only a user-triggered exact retry for persisted preparing fill", () => {
    const pending = beginRfqPhaseAttempt(
      record("funded"),
      "fill",
      "fill-exact",
      NOW + 1,
      {
        operation: "maker-fill",
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x1",
        requestDigest: `0x${"ab".repeat(32)}`,
        dealId: "0x1",
        solverId: "maker-a",
        reservationId: `0x${"bc".repeat(32)}`,
        reservationFence: "7",
        quoteDigest: `0x${"cd".repeat(32)}`,
        sellToken: "0x1",
        sellAmount: "100",
        buyToken: "0x2",
        buyAmount: "199",
        deadline: NOW + 20,
        ticketAddress: "0x4",
      },
    );
    expect(localnetResumeDecision(pending, NOW + 2)).toMatchObject({
      action: "retry-maker-fill",
      label: "Retry exact maker-fill request",
      disabled: false,
    });
  });

  it.each([
    ["authoritative", "claimable", "claim"],
    ["stale", "refundable", "refund"],
    ["disagreement", "funded", "request-maker-fill"],
    ["reorged", "claimable", "claim"],
    ["quarantined", "refundable", "refund"],
  ] as const)(
    "blocks the former %s authority path before it can return %s",
    (status, state, forbiddenAction) => {
      const blocked = {
        ...record(state),
        evidenceAuthority: {
          status,
          label: status,
          revision: 8,
          observedAt: NOW,
        },
      };
      const result = localnetResumeDecision(blocked, NOW + 1);
      expect(result).toMatchObject({ action: "none", disabled: true });
      expect(result.action).not.toBe(forbiddenAction);
    },
  );

  it("rejects stale-tab and direct-call attempts at the command boundary", () => {
    const presented = record("claimable");
    const current = {
      ...presented,
      storageRevision: presented.storageRevision + 1,
      updatedAt: presented.updatedAt + 1,
      evidenceAuthority: {
        status: "disagreement" as const,
        label: "disagreement",
        revision: 2,
        observedAt: NOW + 1,
      },
    };
    expect(() =>
      authorizeLocalnetResumeCommand(presented, current, "claim", NOW + 2),
    ).toThrow(/changed after it was displayed/);
    expect(() =>
      authorizeLocalnetResumeCommand(current, current, "claim", NOW + 2),
    ).toThrow(/remains read-only/);
  });

  it("allows only the exact action selected from the latest safe record", () => {
    const funded = record("funded");
    expect(
      authorizeLocalnetResumeCommand(
        funded,
        funded,
        "request-maker-fill",
        NOW + 1,
      ),
    ).toBe(funded);
    expect(() =>
      authorizeLocalnetResumeCommand(funded, funded, "claim", NOW + 1),
    ).toThrow(/not authorized/);
  });

  it("offers refund only after explicit observed-expiry state", () => {
    expect(
      localnetResumeDecision(
        {
          ...record("funded"),
          settlement: { ...record("funded").settlement!, deadline: NOW },
        },
        NOW + 1,
      ).action,
    ).toBe("observe-expiry");
    expect(localnetResumeDecision(record("refundable"), NOW + 1).action).toBe(
      "refund",
    );
    expect(
      localnetResumeDecision(record("refundable"), NOW + 1).action,
    ).not.toBe("claim");
  });

  it("distinguishes funded expiry from request-backed release without allocating a retry", () => {
    const funded = prepareFundedSettlementExpiry(
      record("funded"),
      "expiry-1",
      NOW + 1,
    );
    const requestBacked = preparePreFundingReservationRelease(
      createRfqLifecycleRecord({
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x2",
        state: "cancel-pending",
        now: NOW,
        requestDigest: `0x${"ab".repeat(32)}`,
      }),
      "release-1",
      NOW + 1,
    );
    expect(localnetResumeDecision(funded, NOW + 2)).toMatchObject({
      action: "verify-reservation-release",
      label: "Verify funded settlement expiry",
      disabled: false,
    });
    expect(localnetResumeDecision(requestBacked, NOW + 2)).toMatchObject({
      action: "verify-reservation-release",
      label: "Verify request reservation release",
      disabled: false,
    });
  });

  it("offers explicit coordinator release for ambiguous and restored requests", () => {
    expect(localnetResumeDecision(record("requesting"), NOW)).toMatchObject({
      action: "release-request-reservations",
      disabled: false,
    });
    expect(localnetResumeDecision(record("quoted"), NOW)).toMatchObject({
      action: "decline-and-release",
      disabled: false,
    });
    expect(localnetResumeDecision(record("reviewing"), NOW)).toMatchObject({
      action: "decline-and-release",
      disabled: false,
    });
  });

  it("requires coordinator release after pre-funding expiry and permits fresh quotes only after refusal", () => {
    expect(
      localnetResumeDecision(
        { ...record("expired"), settlement: undefined },
        NOW,
      ).action,
    ).toBe("release-request-reservations");
    expect(localnetResumeDecision(record("refused"), NOW).action).toBe(
      "request-fresh-quotes",
    );
  });

  it("makes an exact pre-funding quarantine actionable without dropping its fence", () => {
    expect(
      localnetResumeDecision(
        { ...record("quarantined"), settlement: undefined },
        NOW,
      ),
    ).toMatchObject({
      action: "release-request-reservations",
      disabled: false,
    });
    expect(
      localnetResumeDecision(
        {
          ...record("quarantined"),
          requestDigest: undefined,
          settlement: undefined,
        },
        NOW,
      ),
    ).toMatchObject({ action: "none", disabled: true });
  });
});
