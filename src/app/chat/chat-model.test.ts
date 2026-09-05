import { describe, expect, it } from "vitest";
import { paymentLinkToLocal } from "@/app/inbox/mailbox-model";
import type { RfqLifecycleRecord } from "@/app/rfq/rfq-lifecycle";
import type { LocalMailMessage } from "@/components/mail/Thread";
import { feltEquals } from "@/lib/addresses";
import { decodeEnvelope, encodeEnvelope, type EnvelopeType } from "@/lib/envelope";
import type { EscrowState } from "@/lib/escrow";
import type { EncryptedMailRecord } from "@/lib/mail";
import type { OtcState, PaymentRequestPayload } from "@/lib/otc";
import { addrSTRK } from "@/utils/constants";
import {
  buildChatModel,
  buildContactContext,
  contactDisplayName,
  filterConversations,
  rfqNamesContact,
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
const RECORD: EncryptedMailRecord = {
  ephemeralPub: ["0x1", "0x2"],
  viewTag: 3,
  nonce: ["0x4", "0x5"],
  ciphertextFelts: ["0x6"],
};

const wideId = (byte: string) => `0x${byte.repeat(32)}`;
const INCOMING_DEAL = wideId("11");
const SENT_DEAL = wideId("22");
const CAROL_REQUEST = wideId("33");
const LETTER_DOCUMENT = wideId("44");
const OFFER_DOCUMENT = wideId("55");
const SELF_DOCUMENT = wideId("66");
const LOST_DOCUMENT = wideId("77");

function sent(
  documentId: string,
  type: EnvelopeType,
  payload: unknown,
  plaintext: string,
  recipients: string[],
  createdAtSeconds: number,
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
    localCreatedAt: createdAtSeconds * 1_000,
  };
}

const sentOffer = {
  dealId: SENT_DEAL,
  give: { token: STRK, amount: "1000000000000000000" },
  want: { token: USDC, amount: "2500000" },
  offerer: SELF,
  expiresAt: NOW + 3_600,
};

const incomingOffer = {
  dealId: INCOMING_DEAL,
  give: { token: STRK, amount: "3000000000000000000" },
  want: { token: USDC, amount: "7000000" },
  offerer: BOB,
  expiresAt: NOW + 3_600,
};

const carolRequest: PaymentRequestPayload = {
  requestId: CAROL_REQUEST,
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
  legA: { token: STRK, amount: "5" },
  legB: { token: USDC, amount: "6" },
  deadline: NOW + 3_600,
  claimPubkey: "0x123",
};

const otc: OtcState = {
  version: 1,
  deals: {
    [INCOMING_DEAL]: {
      dealId: INCOMING_DEAL,
      status: "offered",
      offer: incomingOffer,
      updatedAt: NOW - 10,
    },
    [SENT_DEAL]: {
      dealId: SENT_DEAL,
      status: "accepted",
      offer: sentOffer,
      counterpartyAcceptClaim: {
        dealId: SENT_DEAL,
        transfer: { token: STRK, amount: "1000000000000000000", to: SELF },
      },
      updatedAt: NOW - 40,
    },
  },
  payments: {
    [CAROL_REQUEST]: {
      requestId: CAROL_REQUEST,
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
    "0x23": {
      dealId: "0x23",
      fund: daveFund,
      chainStatus: "funded",
      chainDeal: {
        legAToken: addrSTRK,
        legAAmount: "5",
        legBToken: "0x53c",
        legBTerms: "6",
        legBAmount: "0",
        deadline: NOW + 3_600,
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

const input: ChatModelInput = {
  selfAddress: SELF,
  sent: [
    sent(LETTER_DOCUMENT, "text", { body: "See you at the desk" }, "See you at the desk", [BOB], NOW - 100),
    sent(
      OFFER_DOCUMENT,
      "composite",
      {
        documentId: OFFER_DOCUMENT,
        body: "",
        attachments: [{ type: "offer", payload: sentOffer }],
      },
      "",
      [BOB],
      NOW - 50,
    ),
    sent(SELF_DOCUMENT, "text", { body: "note to self" }, "note to self", [SELF], NOW - 30),
    sent(LOST_DOCUMENT, "text", { body: "recipient not stored" }, "recipient not stored", [], NOW - 30),
  ],
  paymentLinks: [paymentLinkToLocal(carolRequest, NOW - 5, { kind: "unsigned" })],
  otc,
  escrow,
  addressBook: [
    { label: "Bob", address: BOB, updatedAt: 1 },
    { label: "Erin", address: ERIN, updatedAt: 1 },
  ],
  aliases: [{ address: CAROL, label: "Carol desk", addedAt: 1 }],
  readIds: new Set([`record:deal:${INCOMING_DEAL}`]),
  now: NOW,
};

function conversationFor(address: string) {
  const conversation = buildChatModel(input).conversations.find((candidate) =>
    feltEquals(candidate.contact.address, address),
  );
  if (!conversation) throw new Error(`No conversation for ${address}`);
  return conversation;
}

describe("chat conversations", () => {
  it("groups device-local records by counterparty, newest activity first", () => {
    const model = buildChatModel(input);
    expect(
      model.conversations.map((conversation) => contactDisplayName(conversation.contact)),
    ).toEqual(["Carol desk", "Bob", "0xdaee", "Erin"]);
    expect(model.unattributedSent).toBe(1);
  });

  it("reads Bob's letter, sent offer and received offer in order with their status", () => {
    const bob = conversationFor(BOB);
    expect(bob.contact).toMatchObject({ label: "Bob", nameSource: "address-book", saved: true });
    expect(bob.items.map((item) => item.kind)).toEqual(["letter", "document", "offer"]);
    expect(bob.items.map((item) => item.direction)).toEqual([
      "outgoing",
      "outgoing",
      "incoming",
    ]);
    expect(bob.items[0].body).toBe("See you at the desk");
    expect(bob.items[1].preview).toBe("Offer: 1 STRK for 2.5 USDC");
    expect(bob.items[1].records[0].facts.status).toMatch(/Accepted · unverified claim/);
    expect(bob.items[1].needsAction).toMatch(/claims to have settled/);
    expect(bob.items[2].records[0].facts).toMatchObject({
      kind: "offer",
      terms: "3 STRK for 7 USDC",
      status: "Open offer",
      open: true,
    });
    expect(bob.items[2].needsAction).toMatch(/Accept or decline/);
    expect(bob.latest?.id).toBe(`record:deal:${INCOMING_DEAL}`);
    expect(bob.unreadCount).toBe(0);
    expect(bob.needsAction).toBe(true);
  });

  it("shows an imported payment link under its aliased requester as unread work", () => {
    const carol = conversationFor(CAROL);
    expect(carol.contact).toMatchObject({ label: "Carol desk", nameSource: "alias", saved: false });
    expect(carol.items).toHaveLength(1);
    expect(carol.items[0]).toMatchObject({
      kind: "invoice",
      direction: "incoming",
      provenance: "payment-link",
      preview: "4 STRK · Desk fee",
    });
    expect(carol.items[0].needsAction).toMatch(/Pay this request/);
    expect(carol.unreadCount).toBe(1);
  });

  it("offers a fillable escrow from an unnamed maker only after the contract terms match", () => {
    const dave = conversationFor(DAVE);
    expect(dave.contact.label).toBeNull();
    expect(dave.items[0].records[0]).toMatchObject({
      escrowTermsVerified: true,
      needsAction: "Deposit leg B in Mailbox to receive leg A.",
    });
    const unmatched = buildChatModel({
      ...input,
      escrow: {
        version: 1,
        deals: {
          "0x23": { ...escrow.deals["0x23"], chainDeal: undefined },
        },
      },
    });
    const daveUnmatched = unmatched.conversations.find((candidate) =>
      feltEquals(candidate.contact.address, DAVE),
    );
    expect(daveUnmatched?.items[0].needsAction).toBeNull();
  });

  it("lists a saved counterparty with no records last and keeps self-mail out", () => {
    const erin = conversationFor(ERIN);
    expect(erin.items).toEqual([]);
    expect(erin.latest).toBeNull();
    expect(
      buildChatModel(input).conversations.some((conversation) =>
        feltEquals(conversation.contact.address, SELF),
      ),
    ).toBe(false);
  });

  it("filters by local names, record terms and pending action", () => {
    const { conversations } = buildChatModel(input);
    const names = (filtered: typeof conversations) =>
      filtered.map((conversation) => contactDisplayName(conversation.contact));
    expect(names(filterConversations(conversations, { search: "erin" }))).toEqual(["Erin"]);
    expect(names(filterConversations(conversations, { search: "2.5 usdc" }))).toEqual(["Bob"]);
    expect(names(filterConversations(conversations, { search: "desk fee" }))).toEqual([
      "Carol desk",
    ]);
    expect(names(filterConversations(conversations, { needsActionOnly: true }))).toEqual([
      "Carol desk",
      "Bob",
      "0xdaee",
    ]);
    expect(
      names(filterConversations(conversations, { needsActionOnly: true, search: "bob" })),
    ).toEqual(["Bob"]);
  });
});

describe("contact context", () => {
  const workspaceRfq = (state: RfqLifecycleRecord["state"]) =>
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
      selectedQuote: { solverId: "bob" },
      attempts: {},
    }) as unknown as RfqLifecycleRecord;

  it("keeps open offers, pending payments and escrows per counterparty", () => {
    const bob = buildContactContext(conversationFor(BOB));
    expect(bob.rfqs.map((entry) => [entry.direction, entry.terms])).toEqual([
      ["incoming", "3 STRK for 7 USDC"],
      ["outgoing", "1 STRK for 2.5 USDC"],
    ]);
    expect(bob.rfqs.every((entry) => entry.itemId)).toBe(true);
    expect(bob.payments).toEqual([]);
    expect(bob.escrows).toEqual([]);
    expect(buildContactContext(conversationFor(CAROL)).payments).toHaveLength(1);
    expect(buildContactContext(conversationFor(DAVE)).escrows[0]).toMatchObject({
      open: true,
      status: "Funded · awaiting fill",
    });
  });

  it("mirrors a workspace RFQ only while it names this contact and stays open", () => {
    const bob = conversationFor(BOB);
    expect(rfqNamesContact(workspaceRfq("quoted"), bob.contact)).toBe(true);
    expect(rfqNamesContact(workspaceRfq("quoted"), conversationFor(DAVE).contact)).toBe(false);
    const open = buildContactContext(bob, [workspaceRfq("quoted")]);
    expect(open.rfqs.at(-1)).toMatchObject({
      direction: "workspace",
      terms: "100 STRK → USDC",
      status: "Locked quotes received",
      open: true,
    });
    expect(buildContactContext(bob, [workspaceRfq("settled")]).rfqs).toHaveLength(2);
  });
});
