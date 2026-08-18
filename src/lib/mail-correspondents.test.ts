import { describe, expect, it } from "vitest";
import {
  claimedFinancialAddress,
  describeMailScanCursor,
  formatDeviceSentRecipients,
  replyAddressForMessage,
  uniqueCanonicalAddresses,
} from "./mail-correspondents";

describe("device-local correspondents", () => {
  it("dedupes canonical recipient addresses", () => {
    expect(
      uniqueCanonicalAddresses([
        "0xA11CE",
        "0xa11ce",
        "0xb0b",
        "not-an-address",
      ]),
    ).toEqual(["0xa11ce", "0xb0b"]);
  });

  it("labels a Sent copy with the stored address, not as delivered", () => {
    expect(
      formatDeviceSentRecipients(
        ["0xa11ce"],
        [{ address: "0xa11ce", label: "Alice", addedAt: 1 }],
      ),
    ).toMatchObject({
      primary: "Alice · 0xa11ce",
      detail: expect.stringMatching(/not on-chain/i),
    });
  });

  it("only offers Reply when an unauthenticated claimed address exists", () => {
    const incomingInvoice = {
      direction: "incoming" as const,
      envelope: {
        type: "payment_request",
        payload: { requester: "0xa11ce" },
      },
    };
    expect(replyAddressForMessage(incomingInvoice, "0xb0b")).toBe("0xa11ce");
    expect(
      replyAddressForMessage(
        { direction: "incoming", envelope: { type: "text", payload: {} } },
        "0xb0b",
      ),
    ).toBeNull();
    expect(claimedFinancialAddress(incomingInvoice, "0xa11ce")).toBeNull();
  });

  it("describes an unused or paused scan cursor", () => {
    expect(
      describeMailScanCursor({
        newestScannedBlock: null,
        oldestScannedBlock: null,
      }),
    ).toMatch(/no inbox check/i);
    expect(
      describeMailScanCursor({
        newestScannedBlock: 40,
        oldestScannedBlock: 10,
        pending: { continuationToken: "token" },
      }),
    ).toMatch(/resume/i);
  });
});
