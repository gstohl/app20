import { describe, expect, it } from "vitest";
import {
  importQuotePublicKey,
  signCanonicalQuote,
  verifyCanonicalQuote,
} from "./index.ts";
import {
  MAKER_MID_DOMAIN,
  aggregateMids,
  canonicalMakerMid,
  decodeMakerMid,
  encodeMakerMid,
  verifyMakerMid,
  type MakerIndicativeMidV1,
  type UnsignedMakerIndicativeMidV1,
} from "./mids.ts";

const NOW = 1_900_000_000;
const SIGNATURE = `0x${"00".repeat(31)}01${"00".repeat(31)}01`;

function unsigned(
  overrides: Partial<UnsignedMakerIndicativeMidV1> = {},
): UnsignedMakerIndicativeMidV1 {
  return {
    version: 1,
    domain: MAKER_MID_DOMAIN,
    makerId: "maker-a",
    quoteKeyId: "maker-a/quote/p256/v1",
    marketId: "STRK_USDC",
    midE18: 2_000_000_000_000_000_000n,
    observedAt: NOW - 5,
    validUntil: NOW + 30,
    ...overrides,
  };
}

function mid(
  midE18 = 2_000_000_000_000_000_000n,
  makerId = "maker-a",
): MakerIndicativeMidV1 {
  return { ...unsigned({ midE18, makerId }), signature: SIGNATURE };
}

async function signedFixture() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const value = unsigned();
  const signed: MakerIndicativeMidV1 = {
    ...value,
    signature: await signCanonicalQuote(
      canonicalMakerMid(value),
      keys.privateKey,
    ),
  };
  return {
    signed,
    jwk: await crypto.subtle.exportKey("jwk", keys.publicKey),
  };
}

describe("maker indicative mids", () => {
  it("canonicalizes sorted keys with decimal bigint encoding", () => {
    const canonical = canonicalMakerMid(unsigned());
    expect(Object.keys(JSON.parse(canonical))).toEqual(
      [...Object.keys(JSON.parse(canonical))].sort(),
    );
    expect(canonical).toContain('"midE18":"2000000000000000000"');
    expect(() => canonicalMakerMid(unsigned({ makerId: " " }))).toThrow(
      /makerId is required/,
    );
  });

  it("round-trips a closed wire payload", () => {
    const wire = encodeMakerMid(mid());
    expect(wire.midE18).toBe("2000000000000000000");
    expect(decodeMakerMid(wire)).toEqual(mid());
    expect(() => decodeMakerMid({ ...wire, midE18: "020" })).toThrow(
      /canonical decimal/,
    );
    expect(() => decodeMakerMid({ ...wire, extra: true })).toThrow(
      /unsupported/,
    );
    const { makerId: _missing, ...incomplete } = wire;
    expect(() => decodeMakerMid(incomplete)).toThrow(/makerId is required/);
  });

  it("verifies a fresh signature against the key at observation and verification", async () => {
    const { signed, jwk } = await signedFixture();
    const calls: unknown[][] = [];
    await expect(
      verifyMakerMid(signed, NOW, {
        resolveKey: async (...args) => {
          calls.push(args);
          return jwk;
        },
        importPublicKey: importQuotePublicKey,
        verify: verifyCanonicalQuote,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      [signed.makerId, signed.quoteKeyId, signed.observedAt],
      [signed.makerId, signed.quoteKeyId, NOW],
    ]);
  });

  it("rejects stale, future, rotated-key, and forged mids", async () => {
    const { signed, jwk } = await signedFixture();
    const verify = {
      resolveKey: async () => jwk,
      importPublicKey: importQuotePublicKey,
      verify: verifyCanonicalQuote,
    };
    await expect(
      verifyMakerMid({ ...signed, validUntil: NOW }, NOW, verify),
    ).rejects.toThrow(/active window/);
    await expect(
      verifyMakerMid(
        {
          ...signed,
          observedAt: NOW + 31,
          validUntil: NOW + 40,
        },
        NOW,
        verify,
      ),
    ).rejects.toThrow(/active window/);
    let resolution = 0;
    await expect(
      verifyMakerMid(signed, NOW, {
        ...verify,
        resolveKey: async () => ({
          ...jwk,
          x: `${jwk.x}${resolution++}`,
        }),
      }),
    ).rejects.toThrow(/key changed/);
    await expect(
      verifyMakerMid({ ...signed, signature: SIGNATURE }, NOW, verify),
    ).rejects.toThrow(/signature verification failed/);
  });

  it("aggregates odd and even medians with full-range dispersion", () => {
    expect(aggregateMids([])).toEqual({
      medianE18: 0n,
      dispersionBps: 0,
      count: 0,
    });
    expect(aggregateMids([mid(2_000n)])).toEqual({
      medianE18: 2_000n,
      dispersionBps: 0,
      count: 1,
    });
    expect(
      aggregateMids([
        mid(2_100n, "maker-c"),
        mid(1_900n, "maker-a"),
        mid(2_000n, "maker-b"),
      ]),
    ).toEqual({ medianE18: 2_000n, dispersionBps: 1_000, count: 3 });
    expect(
      aggregateMids([mid(1_900n, "maker-a"), mid(2_001n, "maker-b")]),
    ).toEqual({ medianE18: 1_950n, dispersionBps: 517, count: 2 });
  });
});
