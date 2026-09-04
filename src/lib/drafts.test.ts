import { describe, expect, it } from "vitest";
import {
  createBlankDraft,
  createDraftAttachment,
  deleteDraft,
  isBlankDraft,
  loadDrafts,
  saveDraft,
} from "./drafts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("device-private drafts", () => {
  it("persists, resumes, and explicitly deletes a composite draft", () => {
    const storage = new MemoryStorage();
    const draft = createBlankDraft(100);
    const payment = createDraftAttachment("payment");
    expect(payment.amount).toBe("0.1");
    payment.amount = "0.5";
    const invoice = createDraftAttachment("payment_request");
    expect(invoice.token).toBe("STRK");
    invoice.token = "USDC";
    invoice.memo = "Invoice 12";
    draft.recipient = "alice";
    draft.body = "All terms in one document";
    draft.attachments = [
      payment,
      createDraftAttachment("offer"),
      invoice,
      createDraftAttachment("escrow_fund"),
    ];

    const saved = saveDraft(storage, "SN_SEPOLIA", "0xa11ce", draft, 200);
    expect(saved).toHaveLength(1);
    expect(loadDrafts(storage, "SN_SEPOLIA", "0xa11ce")[0]).toMatchObject({
      id: draft.id,
      body: "All terms in one document",
      updatedAt: 200,
      attachments: [
        { type: "payment", amount: "0.5" },
        { type: "offer" },
        { type: "payment_request", token: "USDC", memo: "Invoice 12" },
        { type: "escrow_fund" },
      ],
    });
    expect(loadDrafts(storage, "SN_MAIN", "0xa11ce")).toEqual([]);

    expect(deleteDraft(storage, "SN_SEPOLIA", "0xa11ce", draft.id)).toEqual([]);
    expect(loadDrafts(storage, "SN_SEPOLIA", "0xa11ce")).toEqual([]);
  });

  it("migrates tokenless invoice drafts to STRK and rejects unknown tokens", () => {
    const storage = new MemoryStorage();
    const draft = createBlankDraft(100);
    const invoice = createDraftAttachment("payment_request");
    const { token: _legacyToken, ...legacyInvoice } = invoice;
    storage.setItem(
      "app20/drafts/v1/SN_SEPOLIA/0xa11ce",
      JSON.stringify([{ ...draft, attachments: [legacyInvoice] }]),
    );
    expect(
      loadDrafts(storage, "SN_SEPOLIA", "0xa11ce")[0]?.attachments[0],
    ).toMatchObject({
      type: "payment_request",
      token: "STRK",
    });

    storage.setItem(
      "app20/drafts/v1/SN_SEPOLIA/0xa11ce",
      JSON.stringify([
        {
          ...draft,
          attachments: [{ ...invoice, token: "ETH" }],
        },
      ]),
    );
    expect(loadDrafts(storage, "SN_SEPOLIA", "0xa11ce")).toEqual([]);
  });

  it("ignores malformed local records instead of inventing a draft", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "app20/drafts/v1/SN_SEPOLIA/0xa11ce",
      JSON.stringify([{ version: 1, id: "not-a-draft" }]),
    );
    expect(loadDrafts(storage, "SN_SEPOLIA", "0xa11ce")).toEqual([]);
  });
});

describe("blank drafts", () => {
  it("treats an untouched draft as blank", () => {
    expect(isBlankDraft(createBlankDraft())).toBe(true);
  });

  it("treats whitespace-only edits as still blank", () => {
    const draft = { ...createBlankDraft(), recipient: "  ", body: "\n  " };
    expect(isBlankDraft(draft)).toBe(true);
  });

  it("stops being blank once a recipient, body, or attachment exists", () => {
    const base = createBlankDraft();
    expect(isBlankDraft({ ...base, recipient: "0xa11ce" })).toBe(false);
    expect(isBlankDraft({ ...base, body: "Terms as discussed." })).toBe(false);
    expect(
      isBlankDraft({
        ...base,
        attachments: [createDraftAttachment("payment")],
      }),
    ).toBe(false);
  });
});
