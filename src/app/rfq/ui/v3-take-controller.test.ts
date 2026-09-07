import { describe, expect, it } from "vitest";
import {
  createRfqLifecycleRecord,
  transitionRfqLifecycle,
} from "../rfq-lifecycle";
import { buildSignedV3TakeActions } from "./v3-take-controller";

const NOW = 1_900_000_000;

function reviewing() {
  return createRfqLifecycleRecord({
    mode: "v3",
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "reviewing",
    now: NOW,
    requestDigest: `0x${"11".repeat(32)}`,
    terms: {
      pairId: "STRK_USDC",
      sellSymbol: "STRK",
      sellAddress: "0x1",
      sellDecimals: 18,
      sellAmount: "250",
      buySymbol: "USDC",
      buyAddress: "0x2",
      buyDecimals: 6,
      minBuyAmount: "400",
      buyAmount: "500",
      rfqExpiresAt: NOW + 60,
    },
    settlement: {
      version: "Localnet V3",
      escrowAddress: "0x5",
      dealId: "0x77",
      deadline: NOW + 60,
    },
    bucket: { min: "100", max: "250" },
    takerCommitment:
      "0x746db56abc4d9fab4832ee42e92e96bbbf8cf4c9fd063b8515bda90d1e8aa5d",
    takerSigningKey: "0x66",
    fills: [
      {
        makerId: "maker-a",
        lockId: "0x41",
        amountA: "100",
        amountB: "200",
        lockExpiresAt: NOW + 60,
      },
      {
        makerId: "maker-b",
        lockId: "0x42",
        amountA: "150",
        amountB: "300",
        lockExpiresAt: NOW + 60,
      },
    ],
  });
}

describe("RFQ v3 signed Take actions", () => {
  it("rejects a new public Take even for a valid persisted earlier review", () => {
    const record = reviewing();
    expect(() => buildSignedV3TakeActions(record, "0xabc", "0x99", "0x1"))
      .toThrow(/Confidential settlement is required/);
  });

  it("cannot sign after the RFQ becomes terminal", () => {
    const terminal = transitionRfqLifecycle(
      reviewing(),
      "expired",
      NOW + 1,
      { reason: "lock-expired" },
    );
    expect(terminal).not.toHaveProperty("takerSigningKey");
    expect(() =>
      buildSignedV3TakeActions(terminal, "0xabc", "0x99", "0x1"),
    ).toThrow(
      /bindings are unavailable/i,
    );
    expect(() =>
      buildSignedV3TakeActions(
        { ...terminal, takerSigningKey: "0x66" },
        "0xabc",
        "0x99",
        "0x1",
      ),
    ).toThrow(/bindings are unavailable/i);
  });
});
