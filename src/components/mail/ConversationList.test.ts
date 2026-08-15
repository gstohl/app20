import { describe, expect, it } from "vitest";
import { addrSTRK } from "../../utils/constants";
import { decodeEnvelope, encodeEnvelope } from "../../lib/envelope";
import type { LocalMailMessage } from "./Thread";
import {
  conversationCorrespondent,
  mailboxMatchesFilter,
} from "./ConversationList";

const strk = { symbol: "STRK", address: addrSTRK, decimals: 18 };
const usdc = { symbol: "USDC", address: "0x53c", decimals: 6 };

function compositeMessage(direction: "incoming" | "outgoing"): LocalMailMessage {
  const envelope = decodeEnvelope(
    encodeEnvelope("composite", {
      documentId: `0x${"21".repeat(32)}`,
      body: "Invoice with contract-backed settlement terms",
      attachments: [
        {
          type: "payment_request",
          payload: {
            requestId: `0x${"22".repeat(32)}`,
            token: strk,
            amount: "4",
            requester: "0xa11ce",
            expiresAt: 2_000_000_000,
          },
        },
        {
          type: "escrow_fund",
          payload: {
            dealId: "0x23",
            escrowAddress: "0xe5c",
            maker: "0xa11ce",
            legA: { token: strk, amount: "5" },
            legB: { token: usdc, amount: "6" },
            deadline: 2_000_000_000,
            claimPubkey: "0x123",
          },
        },
      ],
    }),
  );
  return {
    id: `${direction}:composite`,
    index: "1",
    plaintext: "Invoice with contract-backed settlement terms",
    envelope,
    record: {
      ephemeralPub: ["0x1", "0x2"],
      viewTag: 3,
      nonce: ["0x4", "0x5"],
      ciphertextFelts: ["0x6"],
    },
    transactionHash: "0x7",
    direction,
  };
}

describe("foldered composite reachability", () => {
  it.each(["incoming", "outgoing"] as const)(
    "surfaces an %s invoice-plus-escrow document under both filters",
    (direction) => {
      const message = compositeMessage(direction);
      expect(mailboxMatchesFilter(message, "all")).toBe(true);
      expect(mailboxMatchesFilter(message, "letters")).toBe(true);
      expect(mailboxMatchesFilter(message, "invoices")).toBe(true);
      expect(mailboxMatchesFilter(message, "escrow")).toBe(true);
      expect(mailboxMatchesFilter(message, "deals")).toBe(false);
    },
  );

  it("keeps the raw unauthenticated financial address primary when an alias exists", () => {
    const message = compositeMessage("incoming");
    const correspondent = conversationCorrespondent(
      message,
      [{ address: "0xa11ce", label: "Alice", addedAt: 1 }],
      "0xb0b",
    );

    expect(correspondent).toEqual({
      primary: "Claimed address: 0xa11ce",
      detail: "Unauthenticated payload claim · local alias “Alice”",
      fullAddress: "0xa11ce",
    });
    expect(correspondent.primary).not.toBe("Alice");
  });
});
