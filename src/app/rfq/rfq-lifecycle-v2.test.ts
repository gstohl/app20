import { describe, expect, it } from "vitest";
import { LOCALNET_CHAIN_ID } from "@/utils/constants";
import {
  RFQ_LIFECYCLE_SCHEMA_REVISION,
  applyRfqAuthoritySignal,
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
  observeLocalSettlementExpiry,
  restoreRfqLifecycle,
  transitionRfqLifecycle,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;

function base() {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    now: NOW,
    requestDigest: "0x1234",
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
      buyAmount: "199",
      rfqExpiresAt: NOW + 100,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "key-a",
      nonce: "nonce-a",
      reservationId: "reservation-a",
      spreadBps: 1,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 50,
      reservationExpiresAt: NOW + 50,
      buyAmount: "199",
      intentDigest: "0x1234",
      signature: "signature",
      quoteDigest: "0x5678",
      reservationFence: "1",
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x77",
      ticketAddress: "0x4",
      deadline: NOW + 100,
    },
  });
}

describe("RFQ lifecycle v2", () => {
  it("canonicalizes executable local RFQ/deal aliases and quarantines opaque legacy IDs", () => {
    const canonical = createRfqLifecycleRecord({
      chainId: LOCALNET_CHAIN_ID,
      account: "0xabc",
      rfqId: "0X0077",
      now: NOW,
      settlement: {
        version: "Localnet V2",
        escrowAddress: "0x3",
        dealId: "119",
        ticketAddress: "0X0004",
        deadline: NOW + 100,
      },
    });
    expect(canonical).toMatchObject({
      rfqId: "0x77",
      settlement: { dealId: "0x77", ticketAddress: "0x4" },
    });
    expect(() =>
      createRfqLifecycleRecord({
        chainId: LOCALNET_CHAIN_ID,
        account: "0xabc",
        rfqId: "opaque-id",
        now: NOW,
      }),
    ).toThrow(/bounded Starknet felt/i);
    expect(
      restoreRfqLifecycle(
        { ...canonical, rfqId: "opaque-id", settlement: undefined },
        { chainId: LOCALNET_CHAIN_ID, account: "0xabc", now: NOW + 1 },
      ),
    ).toMatchObject({ state: "quarantined", rfqId: "malformed-local-record" });
  });

  it("migrates v1 records into safe v2 quarantine instead of guessing missing exact terms", () => {
    const restored = restoreRfqLifecycle(
      {
        schemaRevision: "app20/rfq-lifecycle/v1",
        authority: "Local resume record · not settlement authority",
        chainId: "0x1",
        account: "0xabc",
        rfqId: "legacy-1",
        state: "submission-unknown",
        updatedAt: NOW - 1,
        transactionHash: "0xfeed",
      },
      { chainId: "0x1", account: "0xabc", now: NOW },
    );
    expect(restored).toMatchObject({
      schemaRevision: RFQ_LIFECYCLE_SCHEMA_REVISION,
      rfqId: "legacy-1",
      state: "quarantined",
      transactionHash: "0xfeed",
      attempts: { funding: { state: "submitted-unknown" } },
    });
  });

  it("offers refund only after the local harness explicitly observes expiry", () => {
    const funded = { ...base(), state: "funded" as const };
    expect(() => observeLocalSettlementExpiry(funded, NOW + 99)).toThrow(
      /not observed/i,
    );
    const refundable = observeLocalSettlementExpiry(funded, NOW + 100);
    expect(refundable).toMatchObject({
      state: "refundable",
      latestObservation: { stage: "expired" },
    });
  });

  it("allows terminal rollback only from an increasing authority revision", () => {
    const settled = { ...base(), state: "settled" as const };
    expect(() => transitionRfqLifecycle(settled, "reorged", NOW + 1)).toThrow(
      /authority signal/i,
    );
    const signal = {
      status: "reorged" as const,
      label: "Test authority reported canonical membership loss",
      revision: 1,
      observedAt: NOW + 1,
    };
    expect(applyRfqAuthoritySignal(settled, signal).state).toBe("reorged");
    expect(() =>
      applyRfqAuthoritySignal(settled, { ...signal, revision: 0 }),
    ).toThrow(/increase/i);
  });

  it("locks an unknown pre-wallet attempt so it cannot be silently resubmitted", () => {
    const reviewing = {
      ...base(),
      state: "reviewing" as const,
      quoteExpiresAt: NOW + 50,
      reservationExpiresAt: NOW + 50,
    };
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "attempt-before-wallet",
      NOW + 1,
      fundingTicketAttemptTargetFromLifecycle(reviewing),
    );
    expect(preparing.attempts.funding?.state).toBe("preparing");
    expect(() =>
      beginRfqPhaseAttempt(preparing, "funding", "replacement", NOW + 2),
    ).toThrow(/verify/i);
  });
});
