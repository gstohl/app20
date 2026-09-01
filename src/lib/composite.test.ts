import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import { parseCompositePayload } from "./composite";

const documentId = `0x${"41".repeat(32)}`;

describe("composite payload parser", () => {
  it("accepts one attachment of each kind and lowercases the document id", () => {
    const parsed = parseCompositePayload({
      documentId: `0x${"AB".repeat(32)}`,
      body: "Invoice plus escrow",
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
      ],
    });
    expect(parsed?.documentId).toBe(`0x${"ab".repeat(32)}`);
    expect(parsed?.attachments.map((attachment) => attachment.type)).toEqual([
      "payment",
      "escrow_fund",
    ]);
  });

  it("rejects duplicate attachment kinds so retries cannot fork value-moving intent", () => {
    expect(
      parseCompositePayload({
        documentId,
        body: "Ambiguous escrow",
        attachments: [
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
          {
            type: "escrow_fund",
            payload: {
              dealId: "0x5152",
              escrowAddress: "0xe5c",
              maker: "0xa11ce",
              legA: {
                token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
                amount: "3",
              },
              legB: {
                token: { symbol: "USDC", address: "0x53c", decimals: 6 },
                amount: "4",
              },
              deadline: 2_000_000_000,
              claimPubkey: "0x123",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects empty documents and unknown attachment types", () => {
    expect(
      parseCompositePayload({
        documentId,
        body: "   ",
        attachments: [],
      }),
    ).toBeNull();
    expect(
      parseCompositePayload({
        documentId,
        body: "Hello",
        attachments: [{ type: "unknown", payload: {} }],
      }),
    ).toBeNull();
  });
});
