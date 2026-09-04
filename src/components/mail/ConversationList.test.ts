import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addrSTRK } from "../../utils/constants";
import { createBackupSnapshot } from "../../lib/backup-snapshot";
import { decodeEnvelope, encodeEnvelope } from "../../lib/envelope";
import type { LocalMailMessage } from "./Thread";
import ConversationList, {
  conversationCorrespondent,
  mailboxMatchesFilter,
  messageMatchesSearch,
} from "./ConversationList";

const strk = { symbol: "STRK", address: addrSTRK, decimals: 18 };
const usdc = { symbol: "USDC", address: "0x53c", decimals: 6 };

function compositeMessage(
  direction: "incoming" | "outgoing",
): LocalMailMessage {
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

  it("shows device-local Sent recipients instead of Private recipient", () => {
    const message = compositeMessage("outgoing");
    message.recipients = ["0xb0b"];
    const correspondent = conversationCorrespondent(
      message,
      [{ address: "0xb0b", label: "Bob", addedAt: 1 }],
      "0xa11ce",
    );
    expect(correspondent.primary).toContain("0xb0b");
    expect(correspondent.primary).toContain("Bob");
    expect(correspondent.detail).toMatch(/not on-chain/i);
  });
});

describe("conversation list accessibility", () => {
  it("exposes unread state and a machine-readable timestamp", () => {
    const message = compositeMessage("incoming");
    message.localCreatedAt = Date.UTC(2026, 0, 2, 15, 4);
    const List = ConversationList as ComponentType<{
      messages: LocalMailMessage[];
      selectedMessageId: string | null;
      readMessageIds: ReadonlySet<string>;
      aliases: [];
      selfAddress: string;
      folderLabel: string;
      filterLabel: string;
      onSelect: (messageId: string) => void;
    }>;
    const markup = renderToStaticMarkup(
      createElement(List, {
        messages: [message],
        selectedMessageId: null,
        readMessageIds: new Set<string>(),
        aliases: [],
        selfAddress: "0xb0b",
        folderLabel: "Inbox",
        filterLabel: "All types",
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('aria-label="Unread.');
    expect(markup).toMatch(/dateTime="2026-01-02T15:04:00.000Z"/i);
  });

  it("labels authenticated backup envelopes instead of presenting them as unsupported", () => {
    const message = compositeMessage("incoming");
    message.envelope = decodeEnvelope(
      encodeEnvelope(
        "backup_snapshot",
        createBackupSnapshot({
          owner: "0xa11ce",
          chainId: "SN_SEPOLIA",
          helperAddress: "0x1234",
          mailboxFingerprint: "ab".repeat(32),
          mailboxSeed: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
          kind: "contacts",
          seq: 1,
          payload: { entries: [] },
        }),
      ),
    );
    const markup = renderToStaticMarkup(
      createElement(ConversationList, {
        messages: [message],
        selectedMessageId: null,
        readMessageIds: new Set<string>(),
        aliases: [],
        selfAddress: "0xa11ce",
        folderLabel: "Inbox",
        filterLabel: "All types",
        onSelect: () => undefined,
      }),
    );

    expect(markup).toContain("Contact backup");
    expect(markup).toContain("Wallet + mailbox recovery phrase required");
    expect(markup).toContain("This mailbox");
    expect(markup).not.toContain("Unsupported decrypted record");
  });
});

describe("device-local search", () => {
  const message = compositeMessage("incoming");
  const correspondent = conversationCorrespondent(message, [], "0xb0b");

  it("matches an empty query so an unsearched rail shows everything", () => {
    expect(messageMatchesSearch(message, correspondent, "   ")).toBe(true);
  });

  it("matches decrypted body text, the record type and the index", () => {
    expect(messageMatchesSearch(message, correspondent, "settlement")).toBe(
      true,
    );
    expect(messageMatchesSearch(message, correspondent, "document")).toBe(true);
    expect(messageMatchesSearch(message, correspondent, message.index)).toBe(
      true,
    );
  });

  it("matches the correspondent, including a claimed address", () => {
    expect(messageMatchesSearch(message, correspondent, "0xa11ce")).toBe(true);
  });

  it("does not match text that is absent from the decrypted record", () => {
    expect(messageMatchesSearch(message, correspondent, "zzz-not-here")).toBe(
      false,
    );
  });
});

describe("naming a sealed sender", () => {
  it("shows the name everywhere once a record carries an assignment", () => {
    const message = compositeMessage("incoming");
    message.envelope = decodeEnvelope(encodeEnvelope("text", { body: "hi" }));
    message.assignedAddress = "0xb0b";
    const named = conversationCorrespondent(message, [], "0xa11ce");
    expect(named.primary).toBe("0xb0b");
    expect(named.detail).toMatch(/not authenticated/i);
    expect(named.fullAddress).toBe("0xb0b");

    const labelled = conversationCorrespondent(
      message,
      [{ address: "0xb0b", label: "Bob", addedAt: 1 }],
      "0xa11ce",
    );
    expect(labelled.primary).toBe("Bob");
  });

  it("stays sealed when nothing has been named", () => {
    const message = compositeMessage("incoming");
    message.envelope = decodeEnvelope(encodeEnvelope("text", { body: "hi" }));
    expect(conversationCorrespondent(message, [], "0xa11ce").primary).toBe(
      "Sealed sender",
    );
  });

  it("makes a named counterparty searchable by name and address", () => {
    const message = compositeMessage("incoming");
    message.envelope = decodeEnvelope(encodeEnvelope("text", { body: "hi" }));
    message.assignedAddress = "0xb0b";
    const named = conversationCorrespondent(
      message,
      [{ address: "0xb0b", label: "Bob", addedAt: 1 }],
      "0xa11ce",
    );
    expect(messageMatchesSearch(message, named, "bob")).toBe(true);
    expect(messageMatchesSearch(message, named, "0xb0b")).toBe(true);
  });
});
