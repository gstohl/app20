import { encodeDigest256Limbs, parseDigest256 } from "@app20/domain";
import { describe, expect, it } from "vitest";
import {
  ESCROW_VNEXT_ABI_EXPECTATION,
  assertVnextAbiReady,
  canonicalVnextSettlementContext,
  digestVnextCommitment,
  digestVnextSettlementContext,
  type VnextCommitment,
} from "./escrow-vnext";

const GOLDEN_CONTEXT_JSON =
  '{"buyToken":"0x8","chainId":"starknet:SN_SEPOLIA","claimTicketClassHash":"0x3","claimTicketIdentity":"0xa","deadline":1900000000,"dealId":"0x9","directoryDigest":"0x1111111111111111111111111111111111111111111111111111111111111111","directoryEpoch":1,"domain":"app20/escrow-vnext-settlement-context/v1","escrowAddress":"0x1","escrowClassHash":"0x2","intentDigest":"0x1111111111111111111111111111111111111111111111111111111111111111","makerId":"maker","makerSettlementAccount":"0x5","poolAddress":"0x4","quoteKeyId":"q1","registryRevision":"r1","rfqDigest":"0x1111111111111111111111111111111111111111111111111111111111111111","sellAmountBaseUnits":"2","sellToken":"0x7","takerSettlementAccount":"0x6","transportKeyId":"t1"}';
const GOLDEN_CONTEXT_DIGEST =
  "0x8fa8b01bdcf2baabd010d1a31782ce546467127f552f08e0c38cb442cc3ab17b";
const GOLDEN_COMMITMENT_DIGEST =
  "0x5a9260555142293af540e5dea09ec23f7ebbf4e386d71a7b5b36352e396583fc";

const D = `0x${"11".repeat(32)}`;
const ZERO_DIGEST = `0x${"00".repeat(32)}`;
async function commitment(): Promise<VnextCommitment> {
  const withoutDigest = {
    chainId: "starknet:SN_SEPOLIA",
    escrowAddress: "0x1",
    escrowClassHash: "0x2",
    claimTicketClassHash: "0x3",
    poolAddress: "0x4",
    registryRevision: "r1",
    directoryDigest: D,
    directoryEpoch: 1,
    transportKeyId: "t1",
    quoteKeyId: "q1",
    makerId: "maker",
    makerSettlementAccount: "0x5",
    takerSettlementAccount: "0x6",
    intentDigest: D,
    rfqDigest: D,
    winningQuoteDigest: D,
    reservationId: D,
    reservationFence: 1n,
    sellToken: "0x7",
    sellAmountBaseUnits: 2n,
    buyToken: "0x8",
    buyAmountBaseUnits: 3n,
    deadline: 1_900_000_000,
    dealId: "0x9",
    claimTicketIdentity: "0xa",
  };
  const {
    winningQuoteDigest: _winner,
    reservationId: _reservation,
    reservationFence: _fence,
    buyAmountBaseUnits: _buyAmount,
    ...context
  } = withoutDigest;
  return {
    ...withoutDigest,
    settlementContextDigest: await digestVnextSettlementContext(context),
  };
}

const POST_SELECTION = new Set<keyof VnextCommitment>([
  "winningQuoteDigest",
  "reservationId",
  "reservationFence",
  "buyAmountBaseUnits",
]);

describe("Escrow VNext app commitment", () => {
  it("binds every field and rejects every settlement-context mismatch", async () => {
    const base = await commitment();
    const expected = await digestVnextCommitment(base);
    const feltKeys = new Set<keyof VnextCommitment>([
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
    ]);
    const digestKeys = new Set<keyof VnextCommitment>([
      "directoryDigest",
      "intentDigest",
      "rfqDigest",
      "settlementContextDigest",
      "winningQuoteDigest",
      "reservationId",
    ]);
    for (const key of Object.keys(base) as (keyof VnextCommitment)[]) {
      const current = base[key];
      const changed =
        typeof current === "bigint"
          ? current + 1n
          : typeof current === "number"
            ? current + 1
            : feltKeys.has(key)
              ? "0xb"
              : digestKeys.has(key)
                ? `0x${"22".repeat(32)}`
                : `${current}x`;
      const candidate = { ...base, [key]: changed } as VnextCommitment;
      if (POST_SELECTION.has(key))
        await expect(digestVnextCommitment(candidate)).resolves.not.toBe(
          expected,
        );
      else
        await expect(digestVnextCommitment(candidate)).rejects.toThrow(
          /settlementContextDigest does not match/,
        );
    }
    await expect(
      digestVnextCommitment({ ...base, escrowAddress: "0x0" }),
    ).rejects.toThrow();
  });

  it("matches the byte-exact JSON, SHA-256, and low/high golden vectors", async () => {
    const base = await commitment();
    const {
      winningQuoteDigest: _winner,
      reservationId: _reservation,
      reservationFence: _fence,
      buyAmountBaseUnits: _buyAmount,
      settlementContextDigest: _contextDigest,
      ...context
    } = base;
    expect(canonicalVnextSettlementContext(context)).toBe(GOLDEN_CONTEXT_JSON);
    expect(await digestVnextSettlementContext(context)).toBe(
      GOLDEN_CONTEXT_DIGEST,
    );
    expect(await digestVnextCommitment(base)).toBe(GOLDEN_COMMITMENT_DIGEST);
    expect(encodeDigest256Limbs(parseDigest256(GOLDEN_CONTEXT_DIGEST))).toEqual(
      [
        "0x6467127f552f08e0c38cb442cc3ab17b",
        "0x8fa8b01bdcf2baabd010d1a31782ce54",
      ],
    );
    expect(
      encodeDigest256Limbs(parseDigest256(GOLDEN_COMMITMENT_DIGEST)),
    ).toEqual([
      "0x7ebbf4e386d71a7b5b36352e396583fc",
      "0x5a9260555142293af540e5dea09ec23f",
    ]);
    expect(encodeDigest256Limbs(parseDigest256(D))).toEqual([
      "0x11111111111111111111111111111111",
      "0x11111111111111111111111111111111",
    ]);
  });

  it("accepts exact whole-zero Digest256 fields but keeps reservation IDs nonzero", async () => {
    const base = await commitment();
    const {
      winningQuoteDigest: _winner,
      reservationId: _reservation,
      reservationFence: _fence,
      buyAmountBaseUnits: _buyAmount,
      settlementContextDigest: _contextDigest,
      ...context
    } = base;
    expect(() =>
      canonicalVnextSettlementContext({
        ...context,
        directoryDigest: ZERO_DIGEST,
        intentDigest: ZERO_DIGEST,
        rfqDigest: ZERO_DIGEST,
      }),
    ).not.toThrow();
    await expect(
      digestVnextCommitment({ ...base, winningQuoteDigest: ZERO_DIGEST }),
    ).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    await expect(
      digestVnextCommitment({ ...base, reservationId: ZERO_DIGEST }),
    ).rejects.toThrow(/reservationId must not be zero/);
  });

  it("rejects number, string, NaN, infinity, and missing amount/fence casts", async () => {
    const base = await commitment();
    const {
      winningQuoteDigest: _winner,
      reservationId: _reservation,
      reservationFence: _fence,
      buyAmountBaseUnits: _buyAmount,
      settlementContextDigest: _contextDigest,
      ...context
    } = base;
    const invalidRuntimeValues: unknown[] = [
      1,
      "1",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
    ];
    for (const value of invalidRuntimeValues) {
      expect(() =>
        canonicalVnextSettlementContext({
          ...context,
          sellAmountBaseUnits: value,
        } as unknown as typeof context),
      ).toThrow(/positive u256 bigint/);
      for (const key of ["reservationFence", "buyAmountBaseUnits"] as const) {
        await expect(
          digestVnextCommitment({
            ...base,
            [key]: value,
          } as unknown as VnextCommitment),
        ).rejects.toThrow(/positive u256 bigint/);
      }
    }
  });

  it("constructs an acyclic pre-quote context before the selected quote/fence", async () => {
    const base = await commitment();
    const first = await digestVnextCommitment(base);
    const second = await digestVnextCommitment({
      ...base,
      winningQuoteDigest: `0x${"33".repeat(32)}`,
    });
    expect(first).not.toBe(second);
  });

  it("locks the complete operation and event reconstruction schemas while selectors remain absent", () => {
    expect(ESCROW_VNEXT_ABI_EXPECTATION.entrypoints).toEqual({
      privacyInvoke: {
        selector: null,
        calldata: [
          "operation",
          "dealId",
          "poolAddressPlaceholder",
          "destinationOpenNoteId",
        ],
      },
    });
    expect(ESCROW_VNEXT_ABI_EXPECTATION.operations).toEqual({
      Fund: {
        payload: [
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
      },
      Fill: {
        payload: [
          "commitmentDigest",
          "reservationId",
          "reservationFence",
          "winningQuoteDigest",
          "buyToken",
          "buyAmount",
        ],
      },
      Claim: { payload: ["commitmentDigest", "claimIdentity"] },
      Timeout: { payload: ["commitmentDigest", "claimIdentity"] },
    });

    const staticData = [
      "abiVersion",
      "chainId",
      "escrowAddress",
      "escrowClassHash",
      "claimTicketClassHash",
      "claimTicketIdentity",
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
    ];
    const keys = ["dealId", "commitmentDigestLow", "commitmentDigestHigh"];
    expect(ESCROW_VNEXT_ABI_EXPECTATION.events).toEqual({
      Funded: { selector: null, keys, data: staticData },
      Filled: { selector: null, keys, data: staticData },
      Claimed: {
        selector: null,
        keys,
        data: [...staticData, "actualOutputToken", "actualOutputAmount"],
      },
      TimedOut: {
        selector: null,
        keys,
        data: [...staticData, "actualOutputToken", "actualOutputAmount"],
      },
    });

    const terminalCoverage = new Set([
      ...ESCROW_VNEXT_ABI_EXPECTATION.events.Claimed.keys,
      ...ESCROW_VNEXT_ABI_EXPECTATION.events.Claimed.data,
    ]);
    for (const field of [
      "chainId",
      "escrowAddress",
      "escrowClassHash",
      "dealId",
      "claimTicketIdentity",
      "commitmentDigestLow",
      "commitmentDigestHigh",
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
      "actualOutputToken",
      "actualOutputAmount",
    ])
      expect(terminalCoverage.has(field)).toBe(true);

    expect(() => assertVnextAbiReady(ESCROW_VNEXT_ABI_EXPECTATION)).toThrow(
      /localnet V2 calldata is refused/,
    );
  });
});
