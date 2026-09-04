import { describe, expect, it, vi } from "vitest";
import type { ProviderInterface, WalletAccountV6 } from "starknet";
import type { EncryptedMailRecord } from "./mail";
import { addrSTRK } from "../utils/constants";
import {
  type App20Strk20Action,
  buildMemoTransferActions,
  buildOtcAcceptActions,
  computeActionId,
  APP20_HELPER_FUNDING_BASE_UNITS,
  Strk20RevertedError,
  Strk20SubmissionCallbackError,
  Strk20WaitTimeoutError,
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
  it("atomically funds the helper before creating and consuming a recovery note", () => {
    const actions = buildMailActions(baseInput);

    expect(actions).toEqual([
      {
        type: "withdraw",
        token: "0x456",
        amount: "0x7",
        recipient: "0x123",
      },
      {
        type: "transfer",
        token: "0x456",
        amount: "OPEN",
        recipient: "0x789",
      },
      {
        type: "invoke",
        contract: "0x123",
        calldata: [
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
          "0x0",
        ],
      },
    ]);
  });

  it("places an optional private transfer before helper funding, recovery, and invoke", () => {
    const actions = buildMailActions({
      ...baseInput,
      attachmentAmount: 25n * 10n ** 17n,
    });

    expect(actions).toEqual([
      {
        type: "transfer",
        token: "0x456",
        amount: "0x22b1c8c1227a0000",
        recipient: "0xabc",
      },
      {
        type: "withdraw",
        token: "0x456",
        amount: "0x7",
        recipient: "0x123",
      },
      {
        type: "transfer",
        token: "0x456",
        amount: "OPEN",
        recipient: "0x789",
      },
      {
        type: "invoke",
        contract: "0x123",
        calldata: [
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
          "0x0",
        ],
      },
    ]);
  });

  it("binds one payer-owned attempt to a stable unpredictable action id", () => {
    const attemptId = `0x${"24".repeat(32)}`;
    const actionId = computeActionId("payment-attempt", attemptId);
    const actions = buildMemoTransferActions({
      helperAddress: "0x123",
      recoveryAddress: "0xb0b",
      tokenAddress: addrSTRK,
      recipient: "0xa11ce",
      amount: "1000",
      record,
      actionId,
      helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
    });

    const invoke = actions.at(-1);
    if (invoke?.type !== "compute_and_invoke")
      throw new Error("Expected protected compute/invoke.");
    expect(invoke.compute_calldata).toEqual([
      addrSTRK,
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
      actionId,
    ]);
    expect(invoke.invoke_calldata).toEqual([
      addrSTRK,
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
      actionId,
    ]);
    expect(computeActionId("payment-attempt", attemptId)).toBe(actionId);
    expect(computeActionId("payment-attempt", `0x${"25".repeat(32)}`)).not.toBe(
      actionId,
    );
  });

  it("builds accept as transfer, funding, recovery, and protected invoke", () => {
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
      recoveryAddress: "0xb0b",
      record,
      offer,
      helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
      actionId: computeActionId("otc-accept-attempt", `0x${"aa".repeat(32)}`),
    });

    expect(actions.map((action) => action.type)).toEqual([
      "transfer",
      "withdraw",
      "transfer",
      "compute_and_invoke",
    ]);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: addrSTRK,
      amount: "0x2386f26fc10000",
      recipient: "0xa11ce",
    });
    expect(actions[1]).toEqual({
      type: "withdraw",
      token: addrSTRK,
      amount: "0x7",
      recipient: "0x123",
    });
    expect(actions[2]).toEqual({
      type: "transfer",
      token: addrSTRK,
      amount: "OPEN",
      recipient: "0xb0b",
    });
    if (actions[3].type !== "compute_and_invoke")
      throw new Error("Expected protected compute/invoke.");
    expect(actions[3].compute_calldata[1]).toBe("${openNoteIds[0]}");
    expect(actions[3].invoke_calldata[1]).toBe("${poolAddress}");
    expect(actions[3].invoke_calldata[2]).toBe("${openNoteIds[0]}");

    expect(() =>
      buildOtcAcceptActions({
        helperAddress: "0x123",
        recoveryAddress: "0xb0b",
        record,
        helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
        actionId: computeActionId("otc-accept-attempt", `0x${"bb".repeat(32)}`),
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
      /18 decimal/i,
    );
  });

  it("rejects missing or zero helper addresses", () => {
    expect(isConfiguredMailHelper(undefined)).toBe(false);
    expect(isConfiguredMailHelper("0x0")).toBe(false);
    expect(isConfiguredMailHelper("not-an-address")).toBe(false);
    expect(isConfiguredMailHelper("0x123")).toBe(true);
    expect(() =>
      buildMailActions({ ...baseInput, helperAddress: "0x0" }),
    ).toThrow(/helper/i);
  });

  it("reasserts policy before the wallet receives any private action", async () => {
    const invoke = vi.fn();
    const policy = vi.fn(() => {
      throw new Error("blocked by network policy");
    });

    await expect(
      submitMail({
        account: { strk20InvokeTransaction: invoke } as unknown as WalletAccountV6,
        provider: {} as ProviderInterface,
        policy,
        helperAddress: "0x123",
        recoveryAddress: "0xb0b",
        helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
        record,
      }),
    ).rejects.toThrow("blocked by network policy");
    expect(policy).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("submits each mail or accept batch through one wallet call", async () => {
    const batches: App20Strk20Action[][] = [];
    const invoke = vi.fn(async (actions: App20Strk20Action[]) => {
      batches.push(actions);
      return { transaction_hash: "0x999" };
    });
    const wait = vi.fn(async () => ({
      finality_status: "ACCEPTED_ON_L2",
      execution_status: "SUCCEEDED",
    }));
    const account = {
      strk20InvokeTransaction: invoke,
    } as unknown as WalletAccountV6;
    const provider = {
      waitForTransaction: wait,
    } as unknown as ProviderInterface;

    await submitMail({
      account,
      provider,
      policy: () => undefined,
      helperAddress: "0x123",
      recoveryAddress: "0xb0b",
      tokenAddress: addrSTRK,
      helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
      record,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(batches[0].map((action) => action.type)).toEqual([
      "withdraw",
      "transfer",
      "invoke",
    ]);
    expect(batches[0][1]).toMatchObject({
      amount: "OPEN",
      recipient: "0xb0b",
    });

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
      policy: () => undefined,
      helperAddress: "0x123",
      recoveryAddress: "0xb0b",
      offer,
      record,
      helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
      actionId: computeActionId("otc-accept-attempt", `0x${"cc".repeat(32)}`),
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(batches[1].map((action) => action.type)).toEqual([
      "transfer",
      "withdraw",
      "transfer",
      "compute_and_invoke",
    ]);
    expect(batches[1][2]).toMatchObject({
      amount: "OPEN",
      recipient: "0xb0b",
    });
    expect(wait).toHaveBeenCalledWith(
      "0x999",
      expect.objectContaining({
        successStates: ["SUCCEEDED"],
        errorStates: ["REVERTED", "REJECTED"],
      }),
    );
  });

  it("fails closed when an accepted receipt says execution reverted", async () => {
    const account = {
      strk20InvokeTransaction: vi.fn(async () => ({
        transaction_hash: "0x999",
      })),
    } as unknown as WalletAccountV6;
    const provider = {
      waitForTransaction: vi.fn(async () => ({
        finality_status: "ACCEPTED_ON_L2",
        execution_status: "REVERTED",
      })),
    } as unknown as ProviderInterface;

    await expect(
      submitMail({
        account,
        provider,
        policy: () => undefined,
        helperAddress: "0x123",
        recoveryAddress: "0xb0b",
        helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
        record,
      }),
    ).rejects.toBeInstanceOf(Strk20RevertedError);
  });

  it("keeps a submitted transaction unknown when confirmation times out", async () => {
    const account = {
      strk20InvokeTransaction: vi.fn(async () => ({
        transaction_hash: "0x999",
      })),
    } as unknown as WalletAccountV6;
    const provider = {
      waitForTransaction: vi.fn(() => new Promise(() => undefined)),
    } as unknown as ProviderInterface;
    const submitted = vi.fn();

    await expect(
      submitMail(
        {
          account,
          provider,
          policy: () => undefined,
          helperAddress: "0x123",
          recoveryAddress: "0xb0b",
          helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
          record,
        },
        { timeoutMs: 5, onSubmitted: submitted },
      ),
    ).rejects.toBeInstanceOf(Strk20WaitTimeoutError);
    expect(submitted).toHaveBeenCalledWith("0x999");
  });

  it("waits for execution but never treats a throwing submitted callback as verified", async () => {
    const account = {
      strk20InvokeTransaction: vi.fn(async () => ({
        transaction_hash: "0x999",
      })),
    } as unknown as WalletAccountV6;
    const wait = vi.fn(async () => ({
      finality_status: "ACCEPTED_ON_L2",
      execution_status: "SUCCEEDED",
    }));
    const provider = {
      waitForTransaction: wait,
    } as unknown as ProviderInterface;

    await expect(
      submitMail(
        {
          account,
          provider,
          policy: () => undefined,
          helperAddress: "0x123",
          recoveryAddress: "0xb0b",
          helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
          record,
        },
        {
          onSubmitted: () => {
            throw new Error("storage failed");
          },
        },
      ),
    ).rejects.toBeInstanceOf(Strk20SubmissionCallbackError);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
