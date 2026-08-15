import { describe, expect, it } from "vitest";
import {
  ESCROW_OPERATION_VARIANT,
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
  buildEscrowClaimActions,
  buildEscrowFillActions,
  buildEscrowFundActions,
  buildEscrowTimeoutActions,
} from "./escrow-actions";

const escrowAddress = "0xe5c";
const dealId = "0xd001";
const tokenA = "0xaaa";
const tokenB = "0xbbb";
const recoveryAddress = "0xa11ce";
const signature = { sigR: "0x123", sigS: "0x456" };

describe("QuietlineEscrow STRK20 action batches", () => {
  it("flattens Fund in Cairo enum and privacy_invoke order", () => {
    expect(
      buildEscrowFundActions({
        escrowAddress,
        dealId,
        token: tokenA,
        amount: "500",
        counterToken: tokenB,
        counterAmount: "700",
        deadline: 2_000_000_000,
        claimPubkey: "0xc1a1",
      }),
    ).toEqual([
      {
        type: "transfer",
        token: tokenA,
        amount: "0x1f4",
        recipient: escrowAddress,
      },
      {
        type: "invoke",
        contract: escrowAddress,
        calldata: [
          ESCROW_OPERATION_VARIANT.Fund,
          tokenA,
          tokenB,
          "0x2bc",
          "0x77359400",
          "0xc1a1",
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          "0x0",
        ],
      },
    ]);
  });

  it("deposits leg B, opens leg A, and flattens Fill with literal placeholders", () => {
    const actions = buildEscrowFillActions({
      escrowAddress,
      recoveryAddress,
      dealId,
      token: tokenB,
      amount: "700",
      payoutToken: tokenA,
    });

    expect(actions).toEqual([
      {
        type: "transfer",
        token: tokenB,
        amount: "0x2bc",
        recipient: escrowAddress,
      },
      {
        type: "transfer",
        token: tokenA,
        amount: "OPEN",
        recipient: recoveryAddress,
      },
      {
        type: "invoke",
        contract: escrowAddress,
        calldata: [
          ESCROW_OPERATION_VARIANT.Fill,
          tokenB,
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
      },
    ]);
    if (actions[2].type !== "invoke") throw new Error("Expected invoke.");
    expect(actions[2].calldata[3]).toBe("${poolAddress}");
    expect(actions[2].calldata[4]).toBe("${openNoteIds[0]}");
  });

  it("builds Claim and Timeout OPEN-note batches without inventing signatures", () => {
    const claim = buildEscrowClaimActions({
      escrowAddress,
      recoveryAddress,
      dealId,
      payoutToken: tokenB,
      signature,
      noteId: OPEN_NOTE_ID_PLACEHOLDER,
    });
    const timeout = buildEscrowTimeoutActions({
      escrowAddress,
      recoveryAddress,
      dealId,
      payoutToken: tokenA,
      signature,
      noteId: OPEN_NOTE_ID_PLACEHOLDER,
    });

    expect(claim).toEqual([
      {
        type: "transfer",
        token: tokenB,
        amount: "OPEN",
        recipient: recoveryAddress,
      },
      {
        type: "invoke",
        contract: escrowAddress,
        calldata: [
          ESCROW_OPERATION_VARIANT.Claim,
          signature.sigR,
          signature.sigS,
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
      },
    ]);
    expect(timeout).toEqual([
      {
        type: "transfer",
        token: tokenA,
        amount: "OPEN",
        recipient: recoveryAddress,
      },
      {
        type: "invoke",
        contract: escrowAddress,
        calldata: [
          ESCROW_OPERATION_VARIANT.Timeout,
          signature.sigR,
          signature.sigS,
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
      },
    ]);
  });

  it("accepts an explicitly assembled note id without creating a mismatched OPEN note", () => {
    expect(
      buildEscrowClaimActions({
        escrowAddress,
        recoveryAddress,
        dealId,
        payoutToken: tokenB,
        signature,
        noteId: "0xcafe",
      }),
    ).toEqual([
      {
        type: "invoke",
        contract: escrowAddress,
        calldata: [
          ESCROW_OPERATION_VARIANT.Claim,
          signature.sigR,
          signature.sigS,
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          "0xcafe",
        ],
      },
    ]);
  });

  it("rejects zero deployment and out-of-range Cairo integer fields", () => {
    expect(() =>
      buildEscrowFundActions({
        escrowAddress: "0x0",
        dealId,
        token: tokenA,
        amount: "1",
        counterToken: tokenB,
        counterAmount: "1",
        deadline: 1,
        claimPubkey: "0x1",
      }),
    ).toThrow(/deployed/i);
    expect(() =>
      buildEscrowFundActions({
        escrowAddress,
        dealId,
        token: tokenA,
        amount: 2n ** 128n,
        counterToken: tokenB,
        counterAmount: "1",
        deadline: 1,
        claimPubkey: "0x1",
      }),
    ).toThrow(/range/i);
  });
});
