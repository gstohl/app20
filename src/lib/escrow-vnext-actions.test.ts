import { describe, expect, it } from "vitest";
import {
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
  buildVnextClaimActions,
  buildVnextFillActions,
  buildVnextFundActions,
  buildVnextTimeoutActions,
  canonicalVnextOperation,
  type VnextClaimOperationPayload,
  type VnextFillOperationPayload,
  type VnextFundOperationPayload,
  type VnextTimeoutOperationPayload,
} from "./escrow-vnext-actions";

const ZERO_LOW_LIMB = `0x${"11".repeat(16)}${"00".repeat(16)}`;
const ZERO_HIGH_LIMB = `0x${"00".repeat(16)}${"11".repeat(16)}`;
const ZERO_DIGEST = `0x${"00".repeat(32)}`;

const base = {
  escrowAddress: "0xe5c",
  recoveryAddress: "0xa11ce",
  dealId: "0xd001",
};

// Each fixture is intentionally inserted in reverse canonical order. This makes
// caller-order-preserving implementations fail the canonical order assertions.
const fundPayload: VnextFundOperationPayload = {
  commitmentDigest:
    "0x7777777777777777777777777777777777777777777777777777777777777777",
  claimTicketIdentity: "0xc1a1",
  dealId: base.dealId,
  deadline: 1_900_000_000,
  buyAmountBaseUnits: 700n,
  buyToken: "0xbbb",
  sellAmountBaseUnits: 500n,
  sellToken: "0xaaa",
  reservationFence: 1n,
  reservationId:
    "0x6666666666666666666666666666666666666666666666666666666666666666",
  winningQuoteDigest:
    "0x5555555555555555555555555555555555555555555555555555555555555555",
  settlementContextDigest:
    "0x4444444444444444444444444444444444444444444444444444444444444444",
  rfqDigest:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  intentDigest:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  takerSettlementAccount: "0xb0b",
  makerSettlementAccount: "0xa11ce",
  makerId: "maker-1",
  quoteKeyId: "quote-1",
  transportKeyId: "transport-1",
  directoryEpoch: 1,
  directoryDigest:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  registryRevision: "r1",
  poolAddress: "0x9001",
  claimTicketClassHash: "0xc1a55",
  escrowClassHash: "0xec1",
  escrowAddress: base.escrowAddress,
  chainId: "starknet:LOCALNET",
};

const fillPayload: VnextFillOperationPayload = {
  buyAmount: 700n,
  buyToken: "0xbbb",
  winningQuoteDigest:
    "0x5555555555555555555555555555555555555555555555555555555555555555",
  reservationFence: 1n,
  reservationId:
    "0x6666666666666666666666666666666666666666666666666666666666666666",
  commitmentDigest:
    "0x7777777777777777777777777777777777777777777777777777777777777777",
};

const claimPayload: VnextClaimOperationPayload = {
  claimIdentity: "0xc1a1",
  commitmentDigest:
    "0x7777777777777777777777777777777777777777777777777777777777777777",
};

const timeoutPayload: VnextTimeoutOperationPayload = {
  claimIdentity: "0xc1a2",
  commitmentDigest:
    "0x8888888888888888888888888888888888888888888888888888888888888888",
};

const builders = [
  () => buildVnextFundActions({ ...base, payload: fundPayload }),
  () =>
    buildVnextFillActions({
      ...base,
      payload: fillPayload,
      sellToken: fundPayload.sellToken,
    }),
  () =>
    buildVnextClaimActions({
      ...base,
      payload: claimPayload,
      buyToken: fundPayload.buyToken,
    }),
  () =>
    buildVnextTimeoutActions({
      ...base,
      payload: timeoutPayload,
      sellToken: fundPayload.sellToken,
    }),
];

function expectReleaseDenied(build: () => unknown): void {
  expect(build).toThrow(/ABI\/selectors are not configured/);
}

describe("Escrow VNext Wallet API action builders", () => {
  it("canonicalizes shuffled inputs to independent literal operations and field order", () => {
    const operations = [
      canonicalVnextOperation({ payload: fundPayload, kind: "Fund" }),
      canonicalVnextOperation({ payload: fillPayload, kind: "Fill" }),
      canonicalVnextOperation({ payload: claimPayload, kind: "Claim" }),
      canonicalVnextOperation({ payload: timeoutPayload, kind: "Timeout" }),
    ];
    const expectedOperations = [
      {
        kind: "Fund",
        payload: {
          chainId: "starknet:LOCALNET",
          escrowAddress: "0xe5c",
          escrowClassHash: "0xec1",
          claimTicketClassHash: "0xc1a55",
          poolAddress: "0x9001",
          registryRevision: "r1",
          directoryDigest:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          directoryEpoch: 1,
          transportKeyId: "transport-1",
          quoteKeyId: "quote-1",
          makerId: "maker-1",
          makerSettlementAccount: "0xa11ce",
          takerSettlementAccount: "0xb0b",
          intentDigest:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          rfqDigest:
            "0x3333333333333333333333333333333333333333333333333333333333333333",
          settlementContextDigest:
            "0x4444444444444444444444444444444444444444444444444444444444444444",
          winningQuoteDigest:
            "0x5555555555555555555555555555555555555555555555555555555555555555",
          reservationId:
            "0x6666666666666666666666666666666666666666666666666666666666666666",
          reservationFence: 1n,
          sellToken: "0xaaa",
          sellAmountBaseUnits: 500n,
          buyToken: "0xbbb",
          buyAmountBaseUnits: 700n,
          deadline: 1_900_000_000,
          dealId: "0xd001",
          claimTicketIdentity: "0xc1a1",
          commitmentDigest:
            "0x7777777777777777777777777777777777777777777777777777777777777777",
        },
      },
      {
        kind: "Fill",
        payload: {
          commitmentDigest:
            "0x7777777777777777777777777777777777777777777777777777777777777777",
          reservationId:
            "0x6666666666666666666666666666666666666666666666666666666666666666",
          reservationFence: 1n,
          winningQuoteDigest:
            "0x5555555555555555555555555555555555555555555555555555555555555555",
          buyToken: "0xbbb",
          buyAmount: 700n,
        },
      },
      {
        kind: "Claim",
        payload: {
          commitmentDigest:
            "0x7777777777777777777777777777777777777777777777777777777777777777",
          claimIdentity: "0xc1a1",
        },
      },
      {
        kind: "Timeout",
        payload: {
          commitmentDigest:
            "0x8888888888888888888888888888888888888888888888888888888888888888",
          claimIdentity: "0xc1a2",
        },
      },
    ];
    const exactPayloadOrders = [
      [
        "chainId",
        "escrowAddress",
        "escrowClassHash",
        "claimTicketClassHash",
        "poolAddress",
        "registryRevision",
        "directoryDigest",
        "directoryEpoch",
        "transportKeyId",
        "quoteKeyId",
        "makerId",
        "makerSettlementAccount",
        "takerSettlementAccount",
        "intentDigest",
        "rfqDigest",
        "settlementContextDigest",
        "winningQuoteDigest",
        "reservationId",
        "reservationFence",
        "sellToken",
        "sellAmountBaseUnits",
        "buyToken",
        "buyAmountBaseUnits",
        "deadline",
        "dealId",
        "claimTicketIdentity",
        "commitmentDigest",
      ],
      [
        "commitmentDigest",
        "reservationId",
        "reservationFence",
        "winningQuoteDigest",
        "buyToken",
        "buyAmount",
      ],
      ["commitmentDigest", "claimIdentity"],
      ["commitmentDigest", "claimIdentity"],
    ];

    [fundPayload, fillPayload, claimPayload, timeoutPayload].forEach(
      (payload, index) => {
        expect(Object.keys(payload)).toEqual(
          [...exactPayloadOrders[index]].reverse(),
        );
      },
    );
    expect(operations).toEqual(expectedOperations);
    operations.forEach((operation, index) => {
      expect(Object.keys(operation)).toEqual(["kind", "payload"]);
      expect(Object.keys(operation.payload)).toEqual(exactPayloadOrders[index]);
      expect(Object.keys(operation.payload)).toEqual(
        Object.keys(expectedOperations[index].payload),
      );
      expect(Object.isFrozen(operation)).toBe(true);
      expect(Object.isFrozen(operation.payload)).toBe(true);
    });
    for (const build of builders) expectReleaseDenied(build);
  });

  it("rejects omission of every contract-required operation field before release readiness", () => {
    const cases = [
      {
        payload: fundPayload,
        build: (payload: unknown) =>
          buildVnextFundActions({
            ...base,
            payload: payload as VnextFundOperationPayload,
          }),
      },
      {
        payload: fillPayload,
        build: (payload: unknown) =>
          buildVnextFillActions({
            ...base,
            payload: payload as VnextFillOperationPayload,
            sellToken: fundPayload.sellToken,
          }),
      },
      {
        payload: claimPayload,
        build: (payload: unknown) =>
          buildVnextClaimActions({
            ...base,
            payload: payload as VnextClaimOperationPayload,
            buyToken: fundPayload.buyToken,
          }),
      },
      {
        payload: timeoutPayload,
        build: (payload: unknown) =>
          buildVnextTimeoutActions({
            ...base,
            payload: payload as VnextTimeoutOperationPayload,
            sellToken: fundPayload.sellToken,
          }),
      },
    ];

    for (const testCase of cases) {
      for (const key of Object.keys(testCase.payload)) {
        const mutated = { ...testCase.payload } as Record<string, unknown>;
        delete mutated[key];
        expect(() => testCase.build(mutated), key).toThrow();
        try {
          testCase.build(mutated);
        } catch (error) {
          expect((error as Error).message, key).not.toMatch(
            /ABI\/selectors are not configured/,
          );
        }
      }
    }
  });

  it("accepts whole-zero Digest256 values for every operation", () => {
    expectReleaseDenied(() =>
      buildVnextFundActions({
        ...base,
        payload: {
          ...fundPayload,
          directoryDigest: ZERO_DIGEST,
          directoryEpoch: 0,
          intentDigest: ZERO_DIGEST,
          rfqDigest: ZERO_DIGEST,
          settlementContextDigest: ZERO_DIGEST,
          winningQuoteDigest: ZERO_DIGEST,
          reservationId: ZERO_HIGH_LIMB,
          reservationFence: 1n << 128n,
          sellAmountBaseUnits: 1n,
          buyAmountBaseUnits: 1n << 128n,
          commitmentDigest: ZERO_DIGEST,
        },
      }),
    );
    expectReleaseDenied(() =>
      buildVnextFillActions({
        ...base,
        sellToken: fundPayload.sellToken,
        payload: {
          ...fillPayload,
          commitmentDigest: ZERO_DIGEST,
          reservationId: ZERO_LOW_LIMB,
          reservationFence: 1n << 128n,
          winningQuoteDigest: ZERO_DIGEST,
          buyAmount: 1n,
        },
      }),
    );
    expectReleaseDenied(() =>
      buildVnextClaimActions({
        ...base,
        buyToken: fundPayload.buyToken,
        payload: { ...claimPayload, commitmentDigest: ZERO_DIGEST },
      }),
    );
    expectReleaseDenied(() =>
      buildVnextTimeoutActions({
        ...base,
        sellToken: fundPayload.sellToken,
        payload: { ...timeoutPayload, commitmentDigest: ZERO_DIGEST },
      }),
    );
  });

  it("retains nonzero identity/address/token/reservation ID and positive amount/fence rules", () => {
    for (const key of [
      "escrowAddress",
      "escrowClassHash",
      "claimTicketClassHash",
      "poolAddress",
      "makerSettlementAccount",
      "takerSettlementAccount",
      "sellToken",
      "buyToken",
      "dealId",
      "claimTicketIdentity",
    ] as const) {
      expect(
        () =>
          buildVnextFundActions({
            ...base,
            ...(key === "escrowAddress" || key === "dealId"
              ? { [key]: "0x0" }
              : {}),
            payload: { ...fundPayload, [key]: "0x0" },
          }),
        key,
      ).toThrow(/must not be zero/);
    }
    expect(() =>
      buildVnextFundActions({
        ...base,
        payload: { ...fundPayload, reservationId: ZERO_DIGEST },
      }),
    ).toThrow(/reservationId must not be zero/);
    expect(() =>
      buildVnextFillActions({
        ...base,
        sellToken: fundPayload.sellToken,
        payload: { ...fillPayload, reservationId: ZERO_DIGEST },
      }),
    ).toThrow(/reservationId must not be zero/);
    for (const key of [
      "reservationFence",
      "sellAmountBaseUnits",
      "buyAmountBaseUnits",
    ] as const) {
      expect(() =>
        buildVnextFundActions({
          ...base,
          payload: { ...fundPayload, [key]: 0n },
        }),
      ).toThrow(/positive u256/);
    }
    expect(() =>
      buildVnextClaimActions({
        ...base,
        buyToken: fundPayload.buyToken,
        payload: { ...claimPayload, claimIdentity: "0x0" },
      }),
    ).toThrow(/must not be zero/);
  });

  it("rejects number, string, NaN, infinity, and missing amount/fence casts", () => {
    const invalidRuntimeValues: unknown[] = [
      1,
      "1",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
    ];
    for (const value of invalidRuntimeValues) {
      for (const key of [
        "reservationFence",
        "sellAmountBaseUnits",
        "buyAmountBaseUnits",
      ] as const) {
        expect(() =>
          buildVnextFundActions({
            ...base,
            payload: { ...fundPayload, [key]: value },
          } as unknown as Parameters<typeof buildVnextFundActions>[0]),
        ).toThrow(/positive u256/);
      }
      for (const key of ["reservationFence", "buyAmount"] as const) {
        expect(() =>
          buildVnextFillActions({
            ...base,
            sellToken: fundPayload.sellToken,
            payload: { ...fillPayload, [key]: value },
          } as unknown as Parameters<typeof buildVnextFillActions>[0]),
        ).toThrow(/positive u256/);
      }
    }
  });

  it("rejects outer Fund target/deal mutations that disagree with the commitment", () => {
    expect(() =>
      buildVnextFundActions({
        ...base,
        escrowAddress: "0xe5d",
        payload: fundPayload,
      }),
    ).toThrow(/escrowAddress must match/);
    expect(() =>
      buildVnextFundActions({
        ...base,
        dealId: "0xd002",
        payload: fundPayload,
      }),
    ).toThrow(/dealId must match/);
  });

  it("does not accept fabricated ABI selectors or encoded calldata overrides", () => {
    const forged = {
      ...base,
      payload: claimPayload,
      buyToken: fundPayload.buyToken,
      abi: { entrypoints: { privacyInvoke: { selector: "0x123" } } },
      encodedOperation: { kind: "Claim", calldata: ["0xf00d"] },
    } as unknown as Parameters<typeof buildVnextClaimActions>[0];
    expectReleaseDenied(() => buildVnextClaimActions(forged));
  });

  it("rejects invalid transport fields and Wallet amounts before release readiness", () => {
    expect(() =>
      buildVnextClaimActions({
        ...base,
        escrowAddress: "0x0",
        payload: claimPayload,
        buyToken: fundPayload.buyToken,
      }),
    ).toThrow(/Escrow VNext address must not be zero/);
    expect(() =>
      buildVnextFillActions({
        ...base,
        sellToken: fundPayload.sellToken,
        payload: { ...fillPayload, buyAmount: 1n << 251n },
      }),
    ).toThrow(/positive Wallet API FELT/);
    expectReleaseDenied(() =>
      buildVnextFillActions({
        ...base,
        sellToken: fundPayload.sellToken,
        payload: { ...fillPayload, buyAmount: (1n << 251n) - 1n },
      }),
    );
  });

  it("locks the Wallet API placeholders to the required raw literals", () => {
    expect(POOL_ADDRESS_PLACEHOLDER).toBe("${poolAddress}");
    expect(OPEN_NOTE_ID_PLACEHOLDER).toBe("${openNoteIds[0]}");
  });
});
