import { describe, expect, it } from "vitest";
import { paymentLinkToLocal } from "@/app/chat/mailbox-model";
import type { RfqLifecycleRecord } from "@/app/rfq/rfq-lifecycle";
import type { LocalMailMessage } from "@/components/mail/message";
import { feltEquals } from "@/lib/addresses";
import { decodeEnvelope, encodeEnvelope, type EnvelopeType } from "@/lib/envelope";
import type { EscrowState } from "@/lib/escrow";
import { ONE_SIDED_WARNING, type OtcState } from "@/lib/otc";
import { addrSTRK } from "@/utils/constants";
import {
  SELF_CONVERSATION_KEY,
  buildChatModel,
  buildContactContext,
  contactDisplayName,
  filterConversations,
  invoiceRecord,
  namingTarget,
  rfqNamesContact,
  sealedConversationKey,
  type ChatModelInput,
} from "./chat-model";

const NOW = 1_900_000_000;
const SELF = "0xa11ce";
const BOB = "0xb0b";
const CAROL = "0xca401";
const DAVE = "0xdaee";
const ERIN = "0xe41";
const STRK = { symbol: "STRK", address: addrSTRK, decimals: 18 };
const USDC = { symbol: "USDC", address: "0x53c", decimals: 6 };
const RECORD: LocalMailMessage["record"] = {
  ephemeralPub: ["0x1", "0x2"],
  viewTag: 3,
  nonce: ["0x4", "0x5"],
  ciphertextFelts: ["0x6"],
};
const id = (byte: string) => `0x${byte.repeat(32)}`;
const THREAD = id("cc");

function sent(
  documentId: string,
  type: EnvelopeType,
  payload: unknown,
  plaintext: string,
  recipients: string[],
  createdAt: number,
): LocalMailMessage {
  return {
    id: `sent:${documentId}`,
    documentId,
    index: "local",
    plaintext,
    envelope: decodeEnvelope(encodeEnvelope(type, payload)),
    record: RECORD,
    transactionHash: "0x7",
    direction: "outgoing",
    recipientCount: recipients.length,
    recipients,
    localCreatedAt: createdAt,
  };
}

function incoming(
  messageId: string,
  type: EnvelopeType,
  payload: unknown,
  plaintext: string,
  blockTimestamp: number,
  extra: Partial<LocalMailMessage> = {},
): LocalMailMessage {
  return {
    id: messageId,
    index: messageId.replace(/\D/g, "") || "9",
    plaintext,
    envelope: decodeEnvelope(encodeEnvelope(type, payload)),
    record: RECORD,
    transactionHash: `0x${messageId.replace(/\D/g, "") || "9"}`,
    direction: "incoming",
    blockNumber: 12,
    blockTimestamp,
    ...extra,
  };
}

const sentOffer = {
  dealId: id("22"),
  give: { token: STRK, amount: "1000000000000000000" },
  want: { token: USDC, amount: "2500000" },
  offerer: SELF,
  expiresAt: NOW + 3_600,
};
const incomingOffer = {
  dealId: id("11"),
  give: { token: STRK, amount: "3000000000000000000" },
  want: { token: USDC, amount: "7000000" },
  offerer: BOB,
  expiresAt: NOW + 3_600,
};
const carolRequest = {
  requestId: id("33"),
  token: STRK,
  amount: "4000000000000000000",
  requester: CAROL,
  expiresAt: NOW + 3_600,
  memo: "Desk fee",
};
const daveFund = {
  dealId: "0x23",
  escrowAddress: "0xe5c",
  maker: DAVE,
  legA: { token: STRK, amount: "5000000000000000000" },
  legB: { token: USDC, amount: "6000000" },
  deadline: NOW + 3_600,
  claimPubkey: "0x123",
};

const otc: OtcState = {
  version: 1,
  deals: {
    [sentOffer.dealId]: {
      dealId: sentOffer.dealId,
      status: "accepted",
      offer: sentOffer,
      counterpartyAcceptClaim: {
        dealId: sentOffer.dealId,
        transfer: { token: STRK, amount: "1000000000000000000", to: SELF },
      },
      settlementVerified: false,
      updatedAt: NOW - 40,
    },
    [incomingOffer.dealId]: {
      dealId: incomingOffer.dealId,
      status: "offered",
      offer: incomingOffer,
      updatedAt: NOW - 10,
    },
  },
  payments: {
    [carolRequest.requestId]: {
      requestId: carolRequest.requestId,
      status: "requested",
      request: carolRequest,
      origin: "payment_link",
      linkAuthenticity: { kind: "unsigned" },
      updatedAt: NOW - 5,
    },
  },
};

const escrow: EscrowState = {
  version: 1,
  deals: {
    [daveFund.dealId]: {
      dealId: daveFund.dealId,
      fund: daveFund,
      chainStatus: "funded",
      chainDeal: {
        legAToken: addrSTRK,
        legAAmount: daveFund.legA.amount,
        legBToken: USDC.address,
        legBTerms: daveFund.legB.amount,
        legBAmount: "0",
        deadline: daveFund.deadline,
        ticket: "0x123",
        claimPubkey: "0x123",
        status: "funded",
      },
      operations: {},
      counterpartyClaims: {},
      updatedAt: NOW - 20,
    },
  },
};

const letterToBob = sent(
  id("44"),
  "text",
  { body: "See you at the desk", documentId: id("44"), conversationId: THREAD },
  "See you at the desk",
  [BOB],
  (NOW - 100) * 1_000,
);
const offerToBob = sent(
  id("55"),
  "composite",
  {
    documentId: id("55"),
    body: "",
    attachments: [{ type: "offer", payload: sentOffer }],
    conversationId: THREAD,
  },
  "",
  [BOB],
  (NOW - 50) * 1_000,
);
/* Bob answers inside the same thread: no claim, no name, still attributed. */
const bobReply = incoming(
  "0x77:1",
  "text",
  { body: "Firm at 2.5", documentId: id("66"), conversationId: THREAD },
  "Firm at 2.5",
  NOW - 30,
);
const sealedLetter = incoming(
  "0x88:1",
  "text",
  { body: "Who is this?", documentId: id("99"), conversationId: id("dd") },
  "Who is this?",
  NOW - 15,
);
const carolLink = paymentLinkToLocal(carolRequest, NOW - 5, { kind: "unsigned" });
const selfBackup = sent(
  id("ab"),
  "contact_snapshot",
  { any: "thing" },
  "",
  [SELF],
  (NOW - 1) * 1_000,
);
const noRecipient = sent(id("ac"), "text", { body: "orphan" }, "orphan", [], (NOW - 2) * 1_000);

function input(overrides: Partial<ChatModelInput> = {}): ChatModelInput {
  return {
    selfAddress: SELF,
    messages: [
      letterToBob,
      offerToBob,
      bobReply,
      sealedLetter,
      carolLink,
      selfBackup,
      noRecipient,
    ],
    otc,
    escrow,
    addressBook: [
      { label: "Bob", address: BOB, updatedAt: 1 },
      { label: "Erin", address: ERIN, updatedAt: 1 },
    ],
    aliases: [{ address: CAROL, label: "Carol desk", addedAt: 1 }],
    readIds: new Set<string>(),
    now: NOW,
    ...overrides,
  };
}

function conversation(model: ReturnType<typeof buildChatModel>, key: string) {
  const found = model.conversations.find(
    (candidate) =>
      candidate.contact.key === key ||
      (candidate.contact.address !== null &&
        feltEquals(candidate.contact.address, key)),
  );
  if (!found) throw new Error(`No conversation for ${key}`);
  return found;
}

describe("chat conversations", () => {
  it("groups every mailbox record by counterparty and orders by activity", () => {
    const model = buildChatModel(input());
    expect(model.unattributedSent).toBe(1);
    const names = model.conversations.map((row) => contactDisplayName(row.contact));
    expect(names).toEqual([
      "This mailbox",
      "Carol desk",
      "Bob",
      "Sealed sender",
      "0xdaee",
      "Erin",
    ]);
  });

  it("attributes a thread reply without a name or claim to its counterparty", () => {
    const bob = conversation(buildChatModel(input()), BOB);
    expect(bob.contact.saved).toBe(true);
    expect(bob.items.map((item) => item.kind)).toEqual([
      "letter",
      "document",
      "letter",
      "offer",
    ]);
    const reply = bob.items[2];
    expect(reply.direction).toBe("incoming");
    expect(reply.provenance).toBe("decrypted");
    expect(reply.body).toBe("Firm at 2.5");
    expect(bob.unreadCount).toBe(2);
    expect(bob.needsAction).toBe(true);
    expect(bob.items[1].records[0].own).toBe(true);
    expect(bob.items[1].records[0].needsAction).toMatch(/claims to have settled/);
    expect(bob.items[3].provenance).toBe("mailbox-record");
    expect(bob.items[3].records[0].own).toBe(false);
    expect(bob.items[3].needsAction).toMatch(/Accept or decline/);
  });

  it("keeps an unnamed thread sealed and exposes the record that names it", () => {
    const model = buildChatModel(input());
    const sealed = conversation(model, sealedConversationKey(id("dd")));
    expect(sealed.contact.kind).toBe("sealed");
    expect(sealed.contact.address).toBeNull();
    expect(sealed.items).toHaveLength(1);
    expect(sealed.unreadCount).toBe(1);
    expect(namingTarget(sealed)?.id).toBe("0x88:1");
  });

  it("moves a sealed thread to the counterparty once it is named on this device", () => {
    const named = { ...sealedLetter, assignedAddress: DAVE };
    const model = buildChatModel(
      input({
        messages: [letterToBob, offerToBob, bobReply, named, carolLink],
      }),
    );
    expect(
      model.conversations.some((row) => row.contact.kind === "sealed"),
    ).toBe(false);
    const dave = conversation(model, DAVE);
    expect(dave.items.map((item) => item.kind)).toEqual(["escrow", "letter"]);
    expect(dave.items[0].needsAction).toMatch(/Deposit leg B/);
  });

  it("prefers a decrypted record over saved deal state for the same deal", () => {
    const decryptedOffer = incoming(
      "0x11:1",
      "offer",
      incomingOffer,
      "",
      NOW - 9,
    );
    const bob = conversation(
      buildChatModel(input({ messages: [letterToBob, decryptedOffer] })),
      BOB,
    );
    const offers = bob.items.filter((item) => item.kind === "offer");
    expect(offers).toHaveLength(1);
    expect(offers[0].provenance).toBe("decrypted");
    expect(offers[0].records[0].deal?.status).toBe("offered");
  });

  it("skips the decrypted echo of a letter this wallet sent to several recipients", () => {
    const circular = sent(
      id("ee"),
      "text",
      { body: "circular", documentId: id("ee") },
      "circular",
      [BOB, CAROL],
      (NOW - 3) * 1_000,
    );
    const echo = incoming(
      "0xee:1",
      "text",
      { body: "circular", documentId: id("ee") },
      "circular",
      NOW - 3,
    );
    const model = buildChatModel(input({ messages: [circular, echo] }));
    const bob = conversation(model, BOB);
    const letters = bob.items.filter((item) => item.kind === "letter");
    expect(letters).toHaveLength(1);
    expect(letters[0].otherRecipients).toBe(1);
    expect(letters[0].provenance).toBe("device-sent");
    expect(model.conversations.some((row) => row.contact.kind === "sealed")).toBe(false);
  });

  it("keeps an invoice paid through the private exchange as pending work until the note matures", () => {
    const paying = invoiceRecord(
      carolRequest,
      {
        ...otc.payments[carolRequest.requestId],
        paymentOperation: {
          state: "awaiting-note-maturity",
          updatedAt: NOW,
        } as NonNullable<OtcState["payments"][string]["paymentOperation"]>,
      },
      false,
      NOW,
    );
    expect(paying.facts.status).toBe("Paying · awaiting note maturity");
    expect(paying.needsAction).toMatch(/Complete the payment once the STRK note matures/);
  });

  it("files a memo that names a deal under that deal's counterparty", () => {
    // Bob accepts the offer this wallet sent him: the memo carries only the
    // deal id, and the Sent copy says who that deal is with.
    const bobAccept = incoming(
      "0x91:1",
      "accept",
      {
        dealId: sentOffer.dealId,
        transfer: { token: STRK, amount: "1000000000000000000", to: SELF },
      },
      "",
      NOW - 20,
    );
    // Dave's escrow is known only from saved state; his fill notice still
    // lands with him rather than as a sealed thread of its own.
    const daveFill = incoming(
      "0x92:1",
      "escrow_fill",
      { dealId: daveFund.dealId, escrowAddress: daveFund.escrowAddress },
      "",
      NOW - 8,
    );
    // A memo for an unknown deal stays sealed: nothing on this device says
    // who sent it.
    const strayReceipt = incoming(
      "0x93:1",
      "receipt",
      {
        dealId: id("ef"),
        txHash: "0x5",
        transfer: { token: STRK, amount: "1", to: SELF },
        warning: ONE_SIDED_WARNING,
      },
      "",
      NOW - 6,
    );
    const model = buildChatModel(
      input({ messages: [offerToBob, bobAccept, daveFill, strayReceipt] }),
    );
    const bob = conversation(model, BOB);
    // The saved-state offer Bob made earlier still shows after the memo.
    expect(bob.items.map((item) => item.kind)).toEqual([
      "document",
      "memo",
      "offer",
    ]);
    expect(bob.items[1].label).toBe("Accept memo");
    expect(bob.unreadCount).toBe(2);
    const dave = conversation(model, DAVE);
    expect(dave.items.map((item) => item.kind)).toEqual(["escrow", "memo"]);
    expect(dave.items[1].label).toBe("Escrow notice");
    const sealed = model.conversations.filter(
      (row) => row.contact.kind === "sealed",
    );
    expect(sealed).toHaveLength(1);
    expect(sealed[0].items[0].kind).toBe("receipt");
  });

  it("keeps backups and self-addressed copies under this mailbox", () => {
    const self = conversation(buildChatModel(input()), SELF_CONVERSATION_KEY);
    expect(self.contact.kind).toBe("self");
    expect(self.items).toHaveLength(1);
    expect(self.items[0].kind).toBe("backup");
    expect(self.items[0].backupKind).toBe("contacts");
  });

  it("reads an imported payment link as work for the requester", () => {
    const carol = conversation(buildChatModel(input()), CAROL);
    expect(carol.contact.nameSource).toBe("alias");
    expect(carol.items[0].provenance).toBe("payment-link");
    expect(carol.items[0].needsAction).toMatch(/Pay this request/);
    expect(carol.unreadCount).toBe(1);
  });

  it("filters by search and by needs-action", () => {
    const model = buildChatModel(input());
    expect(
      filterConversations(model.conversations, { search: "erin" }).map((row) =>
        contactDisplayName(row.contact),
      ),
    ).toEqual(["Erin"]);
    expect(
      filterConversations(model.conversations, { search: "firm at" }).map(
        (row) => contactDisplayName(row.contact),
      ),
    ).toEqual(["Bob"]);
    // Terms are searchable even when a document's preview is its body.
    expect(
      filterConversations(model.conversations, { search: "2.5 usdc" }).map(
        (row) => contactDisplayName(row.contact),
      ),
    ).toEqual(["Bob"]);
    expect(
      filterConversations(model.conversations, { needsActionOnly: true }).map(
        (row) => contactDisplayName(row.contact),
      ),
    ).toEqual(["Carol desk", "Bob", "0xdaee"]);
  });
});

describe("contact context", () => {
  const rfq = (state: RfqLifecycleRecord["state"], solverId: string) =>
    ({
      rfqId: "0x77",
      mode: "v3",
      state,
      updatedAt: NOW,
      chainId: "0x1",
      account: SELF,
      terms: {
        pairId: "STRK_USDC",
        sellSymbol: "STRK",
        sellAddress: "0x1",
        sellDecimals: 18,
        sellAmount: "100000000000000000000",
        buySymbol: "USDC",
        buyAddress: "0x2",
        buyDecimals: 6,
        minBuyAmount: "180",
        rfqExpiresAt: NOW + 600,
      },
      selectedQuote: { solverId },
      authority: "Local resume record · not settlement authority",
    }) as unknown as RfqLifecycleRecord;

  it("lists open offers, pending payments and escrows for the contact", () => {
    const model = buildChatModel(input());
    const bob = buildContactContext(conversation(model, BOB));
    expect(bob.rfqs.map((entry) => entry.direction)).toEqual([
      "incoming",
      "outgoing",
    ]);
    expect(bob.payments).toEqual([]);
    expect(buildContactContext(conversation(model, CAROL)).payments).toHaveLength(1);
    const dave = buildContactContext(conversation(model, DAVE));
    expect(dave.escrows).toHaveLength(1);
    expect(dave.escrows[0].open).toBe(true);
  });

  it("mirrors a workspace RFQ only when a maker id names the contact", () => {
    const model = buildChatModel(input());
    const bob = conversation(model, BOB);
    expect(rfqNamesContact(rfq("quoted", "bob"), bob.contact)).toBe(true);
    expect(rfqNamesContact(rfq("quoted", "maker-a"), bob.contact)).toBe(false);
    const withRfq = buildContactContext(bob, [
      rfq("quoted", "bob"),
      rfq("settled", "bob"),
    ]);
    expect(withRfq.rfqs.filter((entry) => entry.direction === "workspace")).toHaveLength(1);
    expect(withRfq.rfqs.at(-1)?.terms).toBe("100 STRK → USDC");
    const sealed = conversation(model, sealedConversationKey(id("dd")));
    expect(rfqNamesContact(rfq("quoted", "bob"), sealed.contact)).toBe(false);
  });
});
