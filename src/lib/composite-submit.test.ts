import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import type { CompositePayload } from "./composite";
import { planCompositeSubmission, submissionStepLabel } from "./composite-submit";

const documentId = `0x${"41".repeat(32)}`;

function document(withEscrow: boolean): CompositePayload {
  return {
    documentId,
    body: "A stable document body",
    attachments: withEscrow
      ? [
          {
            type: "escrow_fund",
            payload: {
              dealId: "0x5151",
              escrowAddress: "0xe5c",
              maker: "0xa11ce",
              legA: {
                token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
                amount: "1",
              },
              legB: {
                token: { symbol: "USDC", address: "0x53c", decimals: 6 },
                amount: "2",
              },
              deadline: 2_000_000_000,
              claimPubkey: "0x123",
            },
          },
        ]
      : [],
  };
}

describe("composite submission plan", () => {
  it("uses two stable, independently idempotent steps when escrow is attached", () => {
    const first = planCompositeSubmission(document(true));
    const retry = planCompositeSubmission({
      ...document(true),
      body: "Body edits do not invent another value-moving id",
    });

    expect(first).toEqual(retry);
    expect(first).toHaveLength(2);
    expect(first[0]).toEqual({
      kind: "fund_escrow",
      label: "funding escrow",
      idempotencyKey: "0x5151",
    });
    expect(first[1].idempotencyKey).toMatch(/^0x[0-9a-f]+$/);
    expect(submissionStepLabel(first[0], 0, 2)).toBe(
      "Step 1 of 2 — funding escrow",
    );
    expect(submissionStepLabel(first[1], 1, 2)).toBe(
      "Step 2 of 2 — sending document",
    );
  });

  it("keeps body, payment, offer, and invoice in one mail transaction", () => {
    const payload: CompositePayload = {
      ...document(false),
      attachments: [
        {
          type: "payment",
          payload: {
            dealId: `0x${"42".repeat(32)}`,
            transfer: {
              token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
              amount: "1",
              to: "0xb0b",
            },
          },
        },
        {
          type: "offer",
          payload: {
            dealId: `0x${"43".repeat(32)}`,
            give: {
              token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
              amount: "1",
            },
            want: {
              token: { symbol: "USDC", address: "0x53c", decimals: 6 },
              amount: "2",
            },
            offerer: "0xa11ce",
            expiresAt: 0,
          },
        },
        {
          type: "payment_request",
          payload: {
            requestId: `0x${"44".repeat(32)}`,
            token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
            amount: "3",
            requester: "0xa11ce",
            expiresAt: 0,
          },
        },
      ],
    };
    expect(planCompositeSubmission(payload)).toHaveLength(1);
    expect(planCompositeSubmission(payload)[0].kind).toBe("send_document");
  });
});
