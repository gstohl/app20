import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import { MAIL_SCAN_MAX_MESSAGES } from "@/lib/mail-scan";
import { addrSTRK } from "@/utils/constants";
import type { LocalMailMessage } from "@/components/mail/Thread";
import type { EncryptedMailRecord } from "@/lib/mail";
import {
  countMailboxFilterHits,
  escrowForNetwork,
  helperForNetwork,
  mailboxMatchesFilter,
  mailMessageDateTime,
  mergeDisplayAliases,
  mergeMailMessages,
  parseBlockTimestamp,
  partitionMailboxFolders,
  paymentLinkToLocal,
  sortMailMessages,
} from "./mailbox-model";

const emptyRecord: EncryptedMailRecord = {
  ephemeralPub: ["0x1", "0x2"],
  viewTag: 3,
  nonce: ["0x4", "0x5"],
  ciphertextFelts: ["0x6"],
};

function textMessage(
  id: string,
  extras: Partial<LocalMailMessage> = {},
): LocalMailMessage {
  return {
    id,
    index: extras.index ?? id,
    plaintext: extras.plaintext ?? "hello",
    envelope: decodeEnvelope(encodeEnvelope("text", { body: "hello" })),
    record: emptyRecord,
    transactionHash: extras.transactionHash ?? `0x${id}`,
    direction: extras.direction ?? "incoming",
    ...extras,
  };
}

function invoiceMessage(
  requestId: string,
  transport?: "payment_link",
): LocalMailMessage {
  const request = {
    requestId,
    token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
    amount: "1",
    requester: "0xa11ce",
    expiresAt: 2_000_000_000,
  };
  if (transport === "payment_link") {
    return paymentLinkToLocal(request, 1_700_000_000);
  }
  return {
    id: `chain:${requestId}`,
    index: "9",
    plaintext: "",
    envelope: decodeEnvelope(encodeEnvelope("payment_request", request)),
    record: emptyRecord,
    transactionHash: "0xabc",
    direction: "incoming",
    blockNumber: 12,
    eventIndex: 1,
  };
}

describe("localnet-final mailbox contract routing", () => {
  it.each([0, 2])(
    "keeps Mail unavailable on live provider index %i",
    (providerIndex) => {
      expect(helperForNetwork(providerIndex)).toBeNull();
    },
  );

  it.each([0, 2])(
    "keeps legacy escrow unavailable on live provider index %i",
    (providerIndex) => {
      expect(escrowForNetwork(providerIndex)).toBeNull();
    },
  );
});

describe("mailbox list model", () => {
  it("sorts without mutating the input array", () => {
    const older = textMessage("older", { localCreatedAt: 1_000 });
    const newer = textMessage("newer", { localCreatedAt: 2_000 });
    const input = [older, newer];
    const sorted = sortMailMessages(input);

    expect(input.map((message) => message.id)).toEqual(["older", "newer"]);
    expect(sorted.map((message) => message.id)).toEqual(["newer", "older"]);
    expect(sorted).not.toBe(input);
  });

  it("prefers sealed invoice mail over a payment-link projection of the same request", () => {
    const requestId = `0x${"22".repeat(32)}`;
    const merged = mergeMailMessages(
      [invoiceMessage(requestId, "payment_link")],
      [invoiceMessage(requestId)],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.transport).toBeUndefined();
    expect(merged[0]?.id).toBe(`chain:${requestId}`);
  });

  it("caps merged mail at the scan message budget", () => {
    const current = Array.from({ length: MAIL_SCAN_MAX_MESSAGES }, (_, index) =>
      textMessage(`keep-${index}`, { localCreatedAt: index }),
    );
    const incoming = [textMessage("overflow", { localCreatedAt: 10_000_000 })];
    const merged = mergeMailMessages(current, incoming);

    expect(merged).toHaveLength(MAIL_SCAN_MAX_MESSAGES);
    expect(merged[0]?.id).toBe("overflow");
  });

  it("partitions inbox and sent in one pass", () => {
    const folders = partitionMailboxFolders([
      textMessage("in"),
      textMessage("out", { direction: "outgoing" }),
    ]);
    expect(folders.inbox.map((message) => message.id)).toEqual(["in"]);
    expect(folders.sent.map((message) => message.id)).toEqual(["out"]);
  });

  it("counts composite filter hits without extra full-list scans", () => {
    const message = invoiceMessage(`0x${"22".repeat(32)}`);
    expect(mailboxMatchesFilter(message, "invoices")).toBe(true);
    expect(mailboxMatchesFilter(message, "letters")).toBe(false);
    expect(countMailboxFilterHits([message, textMessage("letter")])).toEqual({
      all: 2,
      letters: 1,
      deals: 0,
      invoices: 1,
      escrow: 0,
    });
  });

  it("exposes an ISO timestamp for accessible list times", () => {
    const message = textMessage("dated", {
      localCreatedAt: Date.UTC(2026, 0, 2),
    });
    expect(mailMessageDateTime(message)).toBe("2026-01-02T00:00:00.000Z");
  });

  it("merges aliases without throwing on an unparseable address", () => {
    const merged = mergeDisplayAliases(
      [{ address: "0x1", label: "Book", addedAt: 1 }],
      [
        { address: "0x1", label: "Duplicate", addedAt: 2 },
        { address: "not-a-felt", label: "Broken", addedAt: 3 },
      ],
    );
    expect(merged.map((entry) => entry.label)).toEqual(["Book", "Broken"]);
  });

  it("merges 512 messages well under a 50ms local budget", () => {
    const current = Array.from({ length: 256 }, (_, index) =>
      textMessage(`a-${index}`, { localCreatedAt: index }),
    );
    const incoming = Array.from({ length: 256 }, (_, index) =>
      textMessage(`b-${index}`, { localCreatedAt: index + 1_000 }),
    );
    const started = performance.now();
    const merged = mergeMailMessages(current, incoming);
    const elapsed = performance.now() - started;
    expect(merged).toHaveLength(512);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("parseBlockTimestamp", () => {
  it.each([
    ["decimal string", "1700000000", 1_700_000_000],
    ["hex string", "0x656", 1_622],
    ["safe integer", 42, 42],
    ["bigint", 99n, 99],
  ] as const)("accepts a %s timestamp", (_label, value, expected) => {
    expect(parseBlockTimestamp(value)).toBe(expected);
  });

  it.each([1.5, -1, "0xzz", "hello", Number.MAX_SAFE_INTEGER + 1])(
    "rejects %s",
    (value) => {
      expect(parseBlockTimestamp(value)).toBeUndefined();
    },
  );
});
