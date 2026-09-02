import { takerPublicKeyFor } from "@app20/private-intents";
import { describe, expect, it } from "vitest";
import { createV3Request, v3RequestMaturityGate } from "./rfq-v3-request";

const NOW = 1_900_000_000;

describe("RFQ v3 request construction", () => {
  it("keeps the exact size and local floor out of the wire RFQ", () => {
    const created = createV3Request({
      exactSellAmount: 5n * 10n ** 17n,
      floor: 990_000n,
      tokens: {
        sell: { symbol: "STRK", address: "0x1" },
        buy: { address: "0x2" },
      },
      rfqId: `0x${"11".repeat(32)}`,
      rfqFelt: "0x77",
      chainId: "starknet:APP20_LOCALNET",
      registryRevision: "registry-v1",
      directoryEpoch: 0,
      settlementHelper: "0x5",
      createdAt: NOW,
    });
    expect(created.bucket).toEqual({
      min: 250_000_000_000_000_000n,
      max: 500_000_000_000_000_000n,
    });
    expect(created.localFloor).toBe(990_000n);
    expect(created.takerSigningKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(created.takerCommitment).toBe(
      takerPublicKeyFor(created.takerSigningKey),
    );
    expect(created.takerCommitment).toBe(created.rfq.takerCommitment);
    expect(created.rfq).toMatchObject({
      createdAt: NOW,
      responseDeadline: NOW + 30,
      expiresAt: NOW + 90,
      lockExpiresAt: NOW + 90,
    });
    const wire = JSON.stringify(created.rfq, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(wire).not.toContain("990000");
    expect(wire).not.toContain(created.takerSigningKey);
    expect(wire).not.toMatch(/floor|exactSell|signingKey/i);
  });

  it("keeps public networks immutable-off", () => {
    expect(() =>
      createV3Request({
        exactSellAmount: 10n ** 18n,
        floor: 1n,
        tokens: {
          sellSymbol: "STRK",
          sellToken: "0x1",
          buyToken: "0x2",
        },
        rfqId: `0x${"11".repeat(32)}`,
        rfqFelt: "0x77",
        chainId: "starknet:SN_MAIN",
        registryRevision: "registry-v1",
        directoryEpoch: 0,
        settlementHelper: "0x5",
        createdAt: NOW,
      }),
    ).toThrow(/disabled outside/i);
  });

  it("gates requesting on the newest observed deposit only", () => {
    const older = {
      kind: "shield" as const,
      blockNumber: 90,
      transactionHash: "0x1",
      token: "0x2",
      amountBaseUnits: 1n,
    };
    const latest = { ...older, blockNumber: 98, transactionHash: "0x2" };
    expect(
      v3RequestMaturityGate({
        headBlock: 100,
        maturityBlocks: 10,
        mature: [older],
        pending: [
          {
            deposit: latest,
            matureAtBlock: 108,
            blocksRemaining: 8,
          },
        ],
        allMatureAtBlock: 108,
      }),
    ).toEqual({ ready: false, matureAtBlock: 108, blocksRemaining: 8 });
    expect(
      v3RequestMaturityGate(
        {
          headBlock: 100,
          maturityBlocks: 10,
          mature: [],
          pending: [
            {
              deposit: latest,
              matureAtBlock: 108,
              blocksRemaining: 8,
            },
          ],
          allMatureAtBlock: 108,
        },
        "0x1",
      ),
    ).toEqual({ ready: true });
    expect(
      v3RequestMaturityGate({
        headBlock: 110,
        maturityBlocks: 10,
        mature: [older, latest],
        pending: [],
        allMatureAtBlock: null,
      }),
    ).toEqual({ ready: true });
  });
});
