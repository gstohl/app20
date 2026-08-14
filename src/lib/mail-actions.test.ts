import { describe, expect, it } from "vitest";
import type { EncryptedMailRecord } from "./mail";
import {
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
  buildMailActions,
  isConfiguredMailHelper,
  parseOptionalStrkAmount,
} from "./mail-actions";

const record: EncryptedMailRecord = {
  ephemeralPub: ["0x11", "0x22"],
  viewTag: 0x7a,
  nonce: ["0x33", "0x44"],
  ciphertextFelts: ["0x2", "0xabc", "0xdef"],
};

const baseInput = {
  helperAddress: "0x123",
  tokenAddress: "0x456",
  senderAddress: "0x789",
  recipientAddress: "0xabc",
  record,
};

describe("mail STRK20 actions", () => {
  it("keeps wallet placeholders literal in the invoke calldata", () => {
    const actions = buildMailActions(baseInput);

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: "0x456",
      amount: "OPEN",
      recipient: "0x789",
    });

    const invoke = actions[1];
    expect(invoke.type).toBe("invoke");
    if (invoke.type !== "invoke") throw new Error("Expected invoke action.");
    expect(invoke.calldata).toEqual([
      "0x456",
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
      "0x11",
      "0x22",
      "0x7a",
      "0x33",
      "0x44",
      "0x3",
      "0x2",
      "0xabc",
      "0xdef",
    ]);
    expect(invoke.calldata[1]).toBe("${poolAddress}");
    expect(invoke.calldata[2]).toBe("${openNoteIds[0]}");
  });

  it("prepends an optional private STRK transfer", () => {
    const actions = buildMailActions({
      ...baseInput,
      attachmentAmount: 25n * 10n ** 17n,
    });

    expect(actions).toHaveLength(3);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: "0x456",
      amount: "0x22b1c8c1227a0000",
      recipient: "0xabc",
    });
    expect(actions[1]).toMatchObject({ type: "transfer", amount: "OPEN" });
    expect(actions[2]).toMatchObject({
      type: "invoke",
      contract: "0x123",
    });
  });

  it("parses optional STRK amounts without floating-point rounding", () => {
    expect(parseOptionalStrkAmount(" ")).toBeUndefined();
    expect(parseOptionalStrkAmount("0.001")).toBe(10n ** 15n);
    expect(parseOptionalStrkAmount("2.5")).toBe(25n * 10n ** 17n);
    expect(() => parseOptionalStrkAmount("0")).toThrow(/greater than zero/i);
    expect(() => parseOptionalStrkAmount("1.0000000000000000001")).toThrow(
      /18 decimal/i
    );
  });

  it("rejects missing or zero helper addresses", () => {
    expect(isConfiguredMailHelper(undefined)).toBe(false);
    expect(isConfiguredMailHelper("0x0")).toBe(false);
    expect(isConfiguredMailHelper("not-an-address")).toBe(false);
    expect(isConfiguredMailHelper("0x123")).toBe(true);
    expect(() =>
      buildMailActions({ ...baseInput, helperAddress: "0x0" })
    ).toThrow(/helper/i);
  });
});
