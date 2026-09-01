import { describe, expect, it } from "vitest";
import { LOCALNET_CHAIN_ID } from "@/utils/constants";
import {
  RFQ_LIFECYCLE_SCHEMA_REVISION,
  RFQ_RESUME_AUTHORITY_LABEL,
  createRfqLifecycleRecord,
  restoreRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

const NOW = 1_850_000_000;
const CONTEXT = { chainId: "0x1", account: "0xabc", now: NOW };

function quotedRecord(): RfqLifecycleRecord {
  return createRfqLifecycleRecord({
    ...CONTEXT,
    rfqId: "0x99",
    state: "quoted",
    now: NOW - 20,
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
      rfqExpiresAt: NOW + 120,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-b",
      solverKey: "local-key-b",
      nonce: "nonce-1",
      reservationId: "reservation-1",
      spreadBps: 20,
      pricingProvenance: "local-fixture",
      quotedAt: NOW - 18,
      quoteExpiresAt: NOW + 60,
      reservationExpiresAt: NOW + 90,
      buyAmount: "199",
      intentDigest: "0x1234",
      signature: "0xsigned",
      quoteDigest: "0x5678",
      reservationFence: "1",
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x99",
      ticketAddress: "0x4",
      deadline: NOW + 120,
    },
  });
}

describe("RFQ lifecycle restore of malformed, stale, and cross-scope records", () => {
  it.each([
    ["null", null],
    ["array", []],
    ["string", "lifecycle"],
    [
      "missing schema",
      { authority: RFQ_RESUME_AUTHORITY_LABEL, state: "draft" },
    ],
    [
      "unknown schema",
      {
        schemaRevision: "app20/rfq-lifecycle/v9",
        authority: RFQ_RESUME_AUTHORITY_LABEL,
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x1",
        state: "draft",
        updatedAt: NOW,
      },
    ],
    [
      "unknown state",
      {
        schemaRevision: RFQ_LIFECYCLE_SCHEMA_REVISION,
        authority: RFQ_RESUME_AUTHORITY_LABEL,
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x1",
        state: "funded-enough",
        updatedAt: NOW,
      },
    ],
    [
      "non-decimal sell amount",
      {
        ...quotedRecord(),
        terms: { ...quotedRecord().terms!, sellAmount: "01" },
      },
    ],
    ["viewing-key object", { viewingKey: "never" }],
  ] as const)("quarantines a malformed %s payload", (_label, value) => {
    expect(restoreRfqLifecycle(value, CONTEXT)).toMatchObject({
      state: "quarantined",
      rfqId: "malformed-local-record",
    });
  });

  it.each([
    ["account", { account: "0xdef" }],
    ["chain", { chainId: "0x2" }],
  ] as const)(
    "quarantines a live quote restored under another %s",
    (_label, patch) => {
      expect(
        restoreRfqLifecycle(quotedRecord(), { ...CONTEXT, ...patch }),
      ).toMatchObject({
        state: "quarantined",
        reason: expect.stringMatching(/account or chain/i),
      });
    },
  );

  it("accepts canonical aliases of the bound account and chain", () => {
    const padded = `0x${"0".repeat(61)}abc`;
    expect(
      restoreRfqLifecycle(quotedRecord(), {
        chainId: "0x01",
        account: padded,
        now: NOW,
      }).state,
    ).toBe("quoted");
  });

  it("quarantines a local record whose settlement deal id is a different felt", () => {
    const local = createRfqLifecycleRecord({
      chainId: LOCALNET_CHAIN_ID,
      account: "0xabc",
      rfqId: "0x99",
      state: "quoted",
      now: NOW - 20,
      requestDigest: "0x1234",
      terms: quotedRecord().terms,
      selectedQuote: quotedRecord().selectedQuote,
      settlement: {
        version: "Localnet V2",
        escrowAddress: "0x3",
        dealId: "0x99",
        deadline: NOW + 120,
      },
    });
    const swapped = {
      ...local,
      settlement: { ...local.settlement!, dealId: "0x98" },
    };
    expect(
      restoreRfqLifecycle(swapped, {
        chainId: LOCALNET_CHAIN_ID,
        account: "0xabc",
        now: NOW,
      }),
    ).toMatchObject({ state: "quarantined" });
  });

  it.each([
    [
      "quote expiry",
      {
        quoteExpiresAt: NOW,
        selectedQuote: {
          ...quotedRecord().selectedQuote!,
          quoteExpiresAt: NOW,
        },
      },
    ],
    [
      "reservation expiry",
      {
        quoteExpiresAt: NOW + 120,
        selectedQuote: {
          ...quotedRecord().selectedQuote!,
          quoteExpiresAt: NOW + 120,
          reservationExpiresAt: NOW,
        },
        reservationExpiresAt: NOW,
      },
    ],
  ])("expires a stale restored %s at the exact boundary", (_label, patch) => {
    const reviewing = {
      ...quotedRecord(),
      state: "reviewing" as const,
      ...patch,
    };
    expect(restoreRfqLifecycle(reviewing, CONTEXT).state).toBe("expired");
    expect(
      restoreRfqLifecycle(reviewing, { ...CONTEXT, now: NOW - 1 }).state,
    ).toBe("reviewing");
  });

  it("round-trips hash-only v1 migration evidence without dropping the hash", () => {
    const restored = restoreRfqLifecycle(
      {
        schemaRevision: "app20/rfq-lifecycle/v1",
        authority: RFQ_RESUME_AUTHORITY_LABEL,
        chainId: "0x1",
        account: "0xabc",
        rfqId: "legacy-hash",
        state: "submission-unknown",
        updatedAt: NOW - 1,
        transactionHash: "0xfeed",
      },
      CONTEXT,
    );
    expect(restored).toMatchObject({
      state: "quarantined",
      transactionHash: "0xfeed",
      attempts: {
        funding: { state: "submitted-unknown", transactionHash: "0xfeed" },
      },
    });
    const again = restoreRfqLifecycle(restored, CONTEXT);
    expect(again).toMatchObject({
      state: "quarantined",
      transactionHash: "0xfeed",
      attempts: {
        funding: { state: "submitted-unknown", transactionHash: "0xfeed" },
      },
    });
  });
});
