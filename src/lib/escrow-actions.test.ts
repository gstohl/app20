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
const ticketAddress = "0x71c";
const dealId = "0xd001";
const tokenA = "0xaaa";
const tokenB = "0xbbb";
const recoveryAddress = "0xa11ce";

describe("App20Escrow V2 STRK20 action batches", () => {
  it("locks leg A, opens the ticket note, and flattens Fund exactly", () => {
    expect(
      buildEscrowFundActions({
        escrowAddress,
        recoveryAddress,
        ticketAddress,
        dealId,
        token: tokenA,
        amount: "500",
        counterToken: tokenB,
        counterAmount: "700",
        deadline: 2_000_000_000,
      }),
    ).toEqual([
      {
        type: "withdraw",
        token: tokenA,
        amount: "0x1f4",
        recipient: escrowAddress,
      },
      {
        type: "transfer",
        token: ticketAddress,
        amount: "OPEN",
        recipient: recoveryAddress,
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
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
      },
    ]);
  });

  it("deposits leg B, opens leg A, and flattens Fill", () => {
    expect(
      buildEscrowFillActions({
        escrowAddress,
        recoveryAddress,
        dealId,
        token: tokenB,
        amount: "700",
        payoutToken: tokenA,
      }),
    ).toEqual([
      {
        type: "withdraw",
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
  });

  it("withdraws the ticket, opens payout, and invokes signature-free Claim/Timeout", () => {
    for (const [variant, actions] of [
      [
        ESCROW_OPERATION_VARIANT.Claim,
        buildEscrowClaimActions({
          escrowAddress,
          recoveryAddress,
          ticketAddress,
          dealId,
          payoutToken: tokenB,
        }),
      ],
      [
        ESCROW_OPERATION_VARIANT.Timeout,
        buildEscrowTimeoutActions({
          escrowAddress,
          recoveryAddress,
          ticketAddress,
          dealId,
          payoutToken: tokenA,
        }),
      ],
    ] as const) {
      expect(actions).toEqual([
        {
          type: "withdraw",
          token: ticketAddress,
          amount: "0x1",
          recipient: escrowAddress,
        },
        {
          type: "transfer",
          token: variant === ESCROW_OPERATION_VARIANT.Claim ? tokenB : tokenA,
          amount: "OPEN",
          recipient: recoveryAddress,
        },
        {
          type: "invoke",
          contract: escrowAddress,
          calldata: [
            variant,
            dealId,
            POOL_ADDRESS_PLACEHOLDER,
            OPEN_NOTE_ID_PLACEHOLDER,
          ],
        },
      ]);
    }
  });

  it("rejects zero deployments, zero tickets, and out-of-range fields", () => {
    const valid = {
      escrowAddress,
      recoveryAddress,
      ticketAddress,
      dealId,
      token: tokenA,
      amount: "1",
      counterToken: tokenB,
      counterAmount: "1",
      deadline: 1,
    };
    expect(() =>
      buildEscrowFundActions({ ...valid, escrowAddress: "0x0" }),
    ).toThrow(/deployed/i);
    expect(() =>
      buildEscrowFundActions({ ...valid, ticketAddress: "0x0" }),
    ).toThrow(/ticket/i);
    expect(() =>
      buildEscrowFundActions({ ...valid, amount: 2n ** 128n }),
    ).toThrow(/range/i);
  });
});
