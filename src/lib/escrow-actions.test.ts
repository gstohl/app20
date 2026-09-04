import { describe, expect, it } from "vitest";
import {
  ESCROW_OPERATION_VARIANT,
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
  buildEscrowClaimActions,
  buildEscrowFillActions,
  buildEscrowFundActions,
  buildEscrowLockActions,
  buildEscrowReleaseCollateralActions,
  buildEscrowSettleProceedsActions,
  buildEscrowTakeActions,
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
          "0x1f4",
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
    expect(() => buildEscrowFundActions({ ...valid, token: "0x0" })).toThrow(
      /Funding token/i,
    );
    expect(() =>
      buildEscrowFundActions({ ...valid, recoveryAddress: "0x0" }),
    ).toThrow(/Recovery address/i);
    expect(() =>
      buildEscrowFundActions({ ...valid, counterToken: tokenA }),
    ).toThrow(/different tokens/i);
    expect(() =>
      buildEscrowFillActions({
        escrowAddress,
        recoveryAddress,
        dealId,
        token: "not-a-felt",
        amount: "1",
        payoutToken: tokenA,
      }),
    ).toThrow(/Fill token/i);
  });
});

describe("App20Escrow V3 STRK20 action batches", () => {
  it("locks max B and flattens all four fixed schedule slots", () => {
    expect(
      buildEscrowLockActions({
        escrowAddress,
        recoveryAddress,
        lockTicketAddress: ticketAddress,
        lockId: "0x44",
        rfqId: dealId,
        tokenA,
        tokenB,
        takerCommitment: "0xc0",
        expiry: 2_000_000_000,
        schedule: [
          { a: 100n, b: 199n },
          { a: 250n, b: 500n },
        ],
      }),
    ).toEqual([
      {
        type: "withdraw",
        token: tokenB,
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
          "0x4",
          tokenB,
          tokenA,
          dealId,
          "0xc0",
          "0x77359400",
          "0x2",
          "0x64",
          "0xc7",
          "0xfa",
          "0x1f4",
          "0x0",
          "0x0",
          "0x0",
          "0x0",
          "0x44",
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
      },
    ]);
  });

  it("builds one atomic Take with distinct lock/amount pairs", () => {
    expect(
      buildEscrowTakeActions({
        escrowAddress,
        recoveryAddress,
        rfqId: dealId,
        tokenA,
        tokenB,
        signatureR: "0x1234",
        signatureS: "0x5678",
        fills: [
          { lockId: "0x41", amountA: 100n },
          { lockId: "0x42", amountA: "150" },
        ],
      }),
    ).toEqual([
      {
        type: "withdraw",
        token: tokenA,
        amount: "0xfa",
        recipient: escrowAddress,
      },
      {
        type: "transfer",
        token: tokenB,
        amount: "OPEN",
        recipient: recoveryAddress,
      },
      {
        type: "compute_and_invoke",
        contract: escrowAddress,
        compute_calldata: [dealId],
        invoke_calldata: [
          "0x5",
          tokenA,
          tokenB,
          "0x1234",
          "0x5678",
          "0x2",
          "0x41",
          "0x64",
          "0x42",
          "0x96",
          dealId,
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
      },
    ]);
  });

  it.each([
    [buildEscrowSettleProceedsActions, "0x6", tokenA],
    [buildEscrowReleaseCollateralActions, "0x7", tokenB],
  ] as const)(
    "spends one LockTicket for operation %s",
    (builder, variant, payoutToken) => {
      expect(
        builder({
          escrowAddress,
          recoveryAddress,
          lockTicketAddress: ticketAddress,
          lockId: "0x44",
          payoutToken,
          expectedPayout: 1n,
        }),
      ).toEqual([
        {
          type: "withdraw",
          token: ticketAddress,
          amount: "0x1",
          recipient: escrowAddress,
        },
        {
          type: "transfer",
          token: payoutToken,
          amount: "OPEN",
          recipient: recoveryAddress,
        },
        {
          type: "invoke",
          contract: escrowAddress,
          calldata: [
            variant,
            "0x44",
            POOL_ADDRESS_PLACEHOLDER,
            OPEN_NOTE_ID_PLACEHOLDER,
          ],
        },
      ]);
    },
  );

  it("finalizes a zero-valued lock side without opening an unfunded note", () => {
    expect(
      buildEscrowSettleProceedsActions({
        escrowAddress,
        recoveryAddress,
        lockTicketAddress: ticketAddress,
        lockId: "0x44",
        payoutToken: tokenA,
        expectedPayout: 0n,
      }),
    ).toEqual([
      {
        type: "withdraw",
        token: ticketAddress,
        amount: "0x1",
        recipient: escrowAddress,
      },
      {
        type: "invoke",
        contract: escrowAddress,
        calldata: ["0x6", "0x44", POOL_ADDRESS_PLACEHOLDER, "0x0"],
      },
    ]);
  });

  it("rejects malformed schedules, duplicate fills, and overflowing totals", () => {
    expect(() =>
      buildEscrowLockActions({
        escrowAddress,
        recoveryAddress,
        lockTicketAddress: ticketAddress,
        lockId: "0x44",
        rfqId: dealId,
        tokenA,
        tokenB,
        takerCommitment: "0xc0",
        expiry: 1,
        schedule: [
          { a: 2n, b: 2n },
          { a: 1n, b: 3n },
        ],
      }),
    ).toThrow(/strictly increasing/i);
    expect(() =>
      buildEscrowTakeActions({
        escrowAddress,
        recoveryAddress,
        rfqId: dealId,
        tokenA,
        tokenB,
        signatureR: "0x0",
        signatureS: "0x5678",
        fills: [{ lockId: "0x41", amountA: 1n }],
      }),
    ).toThrow(/signature r/i);
    expect(() =>
      buildEscrowTakeActions({
        escrowAddress,
        recoveryAddress,
        rfqId: dealId,
        tokenA,
        tokenB,
        signatureR: "0x1234",
        signatureS: "0x5678",
        fills: [
          { lockId: "0x41", amountA: 1n },
          { lockId: "0x041", amountA: 1n },
        ],
      }),
    ).toThrow(/distinct/i);
    expect(() =>
      buildEscrowTakeActions({
        escrowAddress,
        recoveryAddress,
        rfqId: dealId,
        tokenA,
        tokenB,
        signatureR: "0x1234",
        signatureS: "0x5678",
        fills: [
          { lockId: "0x41", amountA: 2n ** 128n - 1n },
          { lockId: "0x42", amountA: 1n },
        ],
      }),
    ).toThrow(/total amount A/i);
  });
});
