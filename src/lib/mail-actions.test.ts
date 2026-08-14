import { describe, expect, it, vi } from "vitest";
import type { WALLET_API } from "@starknet-io/types-js";
import type { ProviderInterface, WalletAccountV6 } from "starknet";
import type { EncryptedMailRecord } from "./mail";
import { addrSTRK } from "../utils/constants";
import {
  buildOtcAcceptActions,
  submitMail,
  submitOtcAccept,
} from "./strk20";
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

    expect(actions).toHaveLength(1);

    const invoke = actions[0];
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

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: "0x456",
      amount: "0x22b1c8c1227a0000",
      recipient: "0xabc",
    });
    expect(actions[1]).toMatchObject({
      type: "invoke",
      contract: "0x123",
    });
  });

  it("builds accept as transfer then invoke and refuses non-STRK give", () => {
    const offer = {
      dealId: `0x${"11".repeat(32)}`,
      give: {
        token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
        amount: "10000000000000000",
      },
      want: {
        token: { symbol: "USDC", address: "0x53c", decimals: 6 },
        amount: "2500000",
      },
      offerer: "0xa11ce",
      expiresAt: 0,
    };
    const actions = buildOtcAcceptActions({
      helperAddress: "0x123",
      record,
      offer,
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: addrSTRK,
      amount: "0x2386f26fc10000",
      recipient: "0xa11ce",
    });
    expect(actions[1]).toMatchObject({ type: "invoke", contract: "0x123" });
    if (actions[1].type !== "invoke") throw new Error("Expected invoke.");
    expect(actions[1].calldata[1]).toBe("${poolAddress}");
    expect(actions[1].calldata[2]).toBe("${openNoteIds[0]}");

    expect(() =>
      buildOtcAcceptActions({
        helperAddress: "0x123",
        record,
        offer: {
          ...offer,
          give: {
            ...offer.give,
            token: { ...offer.give.token, address: "0x53c" },
          },
        },
      }),
    ).toThrow(/only STRK/i);
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

  it("submits each invoke-only or accept batch through one wallet call", async () => {
    const batches: WALLET_API.STRK20_ACTION[][] = [];
    const invoke = vi.fn(async (actions: WALLET_API.STRK20_ACTION[]) => {
      batches.push(actions);
      return { transaction_hash: "0x999" };
    });
    const wait = vi.fn(async () => ({ finality_status: "ACCEPTED_ON_L2" }));
    const account = {
      strk20InvokeTransaction: invoke,
    } as unknown as WalletAccountV6;
    const provider = { waitForTransaction: wait } as unknown as ProviderInterface;

    await submitMail({
      account,
      provider,
      helperAddress: "0x123",
      tokenAddress: addrSTRK,
      record,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(batches[0]).toHaveLength(1);

    const offer = {
      dealId: `0x${"44".repeat(32)}`,
      give: {
        token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
        amount: "1000",
      },
      want: {
        token: { symbol: "USDC", address: "0x53c", decimals: 6 },
        amount: "1",
      },
      offerer: "0xa11ce",
      expiresAt: 0,
    };
    await submitOtcAccept({
      account,
      provider,
      helperAddress: "0x123",
      offer,
      record,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(batches[1]).toHaveLength(2);
    expect(batches[1].map((action) => action.type)).toEqual([
      "transfer",
      "invoke",
    ]);
  });
});
