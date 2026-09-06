import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addrSTRK } from "@/utils/constants";
import { offerRecord } from "./chat-model";
import { ChatRecordFull } from "./ChatRecordCard";

const offer = {
  dealId: "0x123",
  give: { token: { symbol: "STRK", address: addrSTRK, decimals: 18 }, amount: "10000000000000000" },
  want: { token: { symbol: "TEST", address: "0x456", decimals: 6 }, amount: "10000" },
  offerer: "0xa11ce",
  expiresAt: 0,
};

describe("offer progress in the expanded Chat card", () => {
  it.each(["reserved", "submitted", "unknown"] as const)("keeps %s execution distinct from acceptance after a remount", (state) => {
    const record = offerRecord(offer, {
      dealId: offer.dealId, offer, status: "accepted", updatedAt: 1,
      acceptOperation: { state, updatedAt: 1 },
    }, false);
    // No transient actionState is needed: the durable operation drives status.
    const html = renderToStaticMarkup(<ChatRecordFull record={record} aliases={[]} actions={{
      selfAddress: "0xb0b", actionStates: {}, onAccept: () => undefined,
    }} />);
    expect(html).toContain(record.facts.status);
    expect(html).not.toContain("Unverified counterparty claim");
    expect(html).not.toContain("Transfer verified locally");
    expect(html).not.toContain("Accept &amp; send");
  });

  it("keeps receipt recovery visible without transient action state after payment confirmation", () => {
    const record = offerRecord(offer, {
      dealId: offer.dealId, offer, status: "accepted", updatedAt: 1,
      settlementVerified: true, acceptTxHash: "0xabc",
      acceptOperation: { state: "confirmed", updatedAt: 1 },
    }, false);
    const html = renderToStaticMarkup(<ChatRecordFull record={record} aliases={[]} actions={{
      selfAddress: "0xb0b", actionStates: {}, onAccept: () => undefined, onPostReceipt: () => undefined,
    }} />);
    expect(html).toContain("Payment complete. Only the receipt remains.");
    expect(html).toContain("Posting it will not send the payment again.");
    expect(html).toContain(">Post receipt</button>");
    expect(html).not.toContain("Accept &amp; send");
  });

});
