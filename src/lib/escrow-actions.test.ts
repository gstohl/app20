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

describe("Retired public escrow settlement", () => {
  const fund = { escrowAddress, recoveryAddress, ticketAddress, dealId, token: tokenA, amount: "500", counterToken: tokenB, counterAmount: "700", deadline: 2_000_000_000 };
  const fill = { escrowAddress, recoveryAddress, dealId, token: tokenB, amount: "700", payoutToken: tokenA };
  const lock = { escrowAddress, recoveryAddress, lockTicketAddress: ticketAddress, lockId: "0x44", rfqId: dealId, tokenA, tokenB, takerCommitment: "0xc0", expiry: 2_000_000_000, schedule: [{ a: 100n, b: 199n }] };
  const take = { escrowAddress, recoveryAddress, rfqId: dealId, tokenA, tokenB, signatureR: "0x1234", signatureS: "0x5678", fills: [{ lockId: "0x41", amountA: 100n }] };
  it.each([
    ["Fund", () => buildEscrowFundActions(fund)],
    ["Fill", () => buildEscrowFillActions(fill)],
    ["Lock", () => buildEscrowLockActions(lock)],
    ["Take", () => buildEscrowTakeActions(take)],
  ] as const)("refuses %s for otherwise valid earlier terms", (_name, build) => {
    expect(build).toThrow(/Confidential settlement is required/);
  });
});

describe("Earlier escrow recovery batches", () => {
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

  it("retains payout recipient, ticket and amount validation", () => {
    const payout = { escrowAddress, recoveryAddress, ticketAddress, dealId, payoutToken: tokenA };
    expect(() => buildEscrowClaimActions({ ...payout, escrowAddress: "0x0" })).toThrow(/deployed/i);
    expect(() => buildEscrowClaimActions({ ...payout, ticketAddress: "0x0" })).toThrow(/ticket/i);
    expect(() => buildEscrowTimeoutActions({ ...payout, recoveryAddress: "0x0" })).toThrow(/Recovery address/i);
    expect(() => buildEscrowSettleProceedsActions({ escrowAddress, recoveryAddress, lockTicketAddress: ticketAddress, lockId: "0x44", payoutToken: tokenA, expectedPayout: 2n ** 128n })).toThrow(/u128/i);
  });
});
