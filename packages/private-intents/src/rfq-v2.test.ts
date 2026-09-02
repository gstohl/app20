import { poseidonHashMany } from "@scure/starknet";
import { hash } from "starknet";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_RFQ_V2_DOMAIN,
  assertPrivateRfqV2,
  canonicalPrivateRfqV2,
  createTakerSecret,
  decodePrivateRfqV2,
  digestPrivateRfqV2,
  encodePrivateRfqV2,
  takerCommitmentFor,
  type PrivateRfqV2,
} from "./rfq-v2.ts";

const NOW = 1_900_000_000;
const DIGEST = `0x${"11".repeat(32)}`;

function rfq(overrides: Partial<PrivateRfqV2> = {}): PrivateRfqV2 {
  return {
    version: 2,
    domain: PRIVATE_RFQ_V2_DOMAIN,
    rfqId: DIGEST,
    rfqFelt: "0x123",
    takerCommitment: takerCommitmentFor("0x456"),
    chainId: "starknet:APP20_LOCALNET",
    registryRevision: "localnet-registry:5",
    directoryEpoch: 4,
    settlementHelper: "0x100",
    sellToken: "0x200",
    buyToken: "0x300",
    sellBucketMinBaseUnits: 500_000_000_000_000_000n,
    sellBucketMaxBaseUnits: 1_000_000_000_000_000_000n,
    createdAt: NOW,
    responseDeadline: NOW + 30,
    expiresAt: NOW + 90,
    lockExpiresAt: NOW + 90,
    ...overrides,
  };
}

describe("private RFQ v2", () => {
  it("canonicalizes sorted keys, felt aliases, and decimal bucket amounts", async () => {
    const canonical = canonicalPrivateRfqV2(rfq());
    expect(Object.keys(JSON.parse(canonical))).toEqual(
      [...Object.keys(JSON.parse(canonical))].sort(),
    );
    expect(canonical).toContain(
      '"sellBucketMinBaseUnits":"500000000000000000"',
    );
    expect(
      canonicalPrivateRfqV2(
        rfq({ sellToken: "0x000200", settlementHelper: "256" }),
      ),
    ).toBe(canonical);
    await expect(digestPrivateRfqV2(rfq())).resolves.toMatch(
      /^0x[0-9a-f]{64}$/,
    );
    await expect(
      digestPrivateRfqV2(rfq({ rfqFelt: "0x124" })),
    ).resolves.not.toBe(await digestPrivateRfqV2(rfq()));
  });

  it("keeps the floor and exact size out of the canonical payload", () => {
    const canonical = canonicalPrivateRfqV2(rfq());
    expect(canonical).not.toContain("floor");
    expect(canonical).not.toContain("sellAmount");
    expect(canonical).not.toContain("minBuy");
  });

  it("enforces bucket, token, and timestamp invariants", () => {
    expect(() => assertPrivateRfqV2(rfq())).not.toThrow();
    expect(() => assertPrivateRfqV2(rfq({ buyToken: "0x200" }))).toThrow(
      /must differ/,
    );
    expect(() =>
      assertPrivateRfqV2(
        rfq({
          sellBucketMinBaseUnits: 2n,
          sellBucketMaxBaseUnits: 1n,
        }),
      ),
    ).toThrow(/maximum/);
    expect(() => assertPrivateRfqV2(rfq({ lockExpiresAt: NOW + 89 }))).toThrow(
      /must equal/,
    );
    expect(() => assertPrivateRfqV2(rfq({ responseDeadline: NOW }))).toThrow(
      /ordered/,
    );
  });

  it("round-trips a closed wire shape with canonical decimal bigints", () => {
    const wire = encodePrivateRfqV2(rfq());
    expect(wire.sellBucketMinBaseUnits).toBe("500000000000000000");
    expect(decodePrivateRfqV2(wire)).toEqual(rfq());
    expect(() =>
      decodePrivateRfqV2({ ...wire, sellBucketMinBaseUnits: "050" }),
    ).toThrow(/canonical decimal/);
    expect(() => decodePrivateRfqV2({ ...wire, floor: "secret" })).toThrow(
      /unsupported/,
    );
    const { rfqId: _missing, ...incomplete } = wire;
    expect(() => decodePrivateRfqV2(incomplete)).toThrow(/rfqId is required/);
  });

  it("creates unpredictable canonical secrets with at least 128 bits", () => {
    const first = createTakerSecret();
    const second = createTakerSecret();
    expect(first).toMatch(/^0x[0-9a-f]+$/);
    expect(BigInt(first)).toBeGreaterThanOrEqual(1n << 128n);
    expect(BigInt(first)).toBeLessThan(1n << 251n);
    expect(second).not.toBe(first);
  });

  it("matches Cairo poseidon_hash_span for a one-element span", () => {
    const expected =
      "0x579e8877c7755365d5ec1ec7d3a94a457eff5d1f40482bbe9729c064cdead2";
    const scure = `0x${poseidonHashMany([1n]).toString(16)}`;
    const starknet = hash.computePoseidonHashOnElements(["0x1"]);
    expect(scure).toBe(expected);
    expect(starknet).toBe(expected);
    expect(takerCommitmentFor("0x1")).toBe(expected);
    expect(takerCommitmentFor("1")).toBe(expected);
  });
});
