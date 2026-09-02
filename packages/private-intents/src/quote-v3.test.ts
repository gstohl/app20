import { describe, expect, it } from "vitest";
import {
  importQuotePublicKey,
  signCanonicalQuote,
  verifyCanonicalQuote,
} from "./index.ts";
import {
  QUOTE_V3_DOMAIN,
  canonicalSolverQuoteV3,
  decodeSolverQuoteV3,
  digestSolverQuoteV3,
  encodeSolverQuoteV3,
  verifySolverQuoteV3,
  type SolverQuoteV3,
  type SolverQuoteV3LockOnChain,
  type UnsignedSolverQuoteV3,
} from "./quote-v3.ts";
import {
  PRIVATE_RFQ_V2_DOMAIN,
  digestPrivateRfqV2,
  takerCommitmentFor,
  type PrivateRfqV2,
} from "./rfq-v2.ts";

const NOW = 1_900_000_000;
const D = `0x${"11".repeat(32)}`;
const D2 = `0x${"22".repeat(32)}`;
const LOW_S_SIGNATURE = `0x${"00".repeat(31)}01${"00".repeat(31)}01`;
const SCHEDULE = [
  { a: 100n, b: 200n },
  { a: 1_000n, b: 2_010n },
] as const;

function rfq(overrides: Partial<PrivateRfqV2> = {}): PrivateRfqV2 {
  return {
    version: 2,
    domain: PRIVATE_RFQ_V2_DOMAIN,
    rfqId: D,
    rfqFelt: "0x123",
    takerCommitment: takerCommitmentFor("0x456"),
    chainId: "starknet:APP20_LOCALNET",
    registryRevision: "r5",
    directoryEpoch: 2,
    settlementHelper: "0x100",
    sellToken: "0x200",
    buyToken: "0x300",
    sellBucketMinBaseUnits: 100n,
    sellBucketMaxBaseUnits: 1_000n,
    createdAt: NOW - 10,
    responseDeadline: NOW + 30,
    expiresAt: NOW + 90,
    lockExpiresAt: NOW + 90,
    ...overrides,
  };
}

async function unsigned(
  overrides: Partial<UnsignedSolverQuoteV3> = {},
): Promise<UnsignedSolverQuoteV3> {
  const request = rfq();
  return {
    domain: QUOTE_V3_DOMAIN,
    version: 3,
    solverId: "maker-a",
    quoteKeyId: "maker-a/quote/p256/v3",
    nonce: D,
    pool: request.chainId,
    helper: request.settlementHelper,
    escrowAddress: request.settlementHelper,
    rfqDigest: await digestPrivateRfqV2(request),
    rfqFelt: request.rfqFelt,
    sellToken: request.sellToken,
    buyToken: request.buyToken,
    schedule: SCHEDULE,
    lockId: "0x400",
    lockTicket: "0x500",
    lockTransactionHash: "0x600",
    lockExpiresAt: request.lockExpiresAt,
    spreadBps: 20,
    pricingProvenance: "maker-mid:v1",
    quotedAt: NOW - 5,
    quoteExpiresAt: NOW + 40,
    ...overrides,
  };
}

async function quote(
  overrides: Partial<UnsignedSolverQuoteV3> = {},
): Promise<SolverQuoteV3> {
  return { ...(await unsigned(overrides)), signature: LOW_S_SIGNATURE };
}

function lock(
  overrides: Partial<SolverQuoteV3LockOnChain> = {},
): SolverQuoteV3LockOnChain {
  const request = rfq();
  return {
    rfqId: request.rfqFelt,
    takerCommitment: request.takerCommitment,
    tokenA: request.sellToken,
    tokenB: request.buyToken,
    expiry: request.lockExpiresAt,
    schedule: SCHEDULE,
    remainingB: 2_010n,
    status: "open",
    ...overrides,
  };
}

async function signedFixture() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const value = await unsigned();
  const signed: SolverQuoteV3 = {
    ...value,
    signature: await signCanonicalQuote(
      canonicalSolverQuoteV3(value),
      keys.privateKey,
    ),
  };
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return { signed, jwk };
}

function verification(
  jwk: JsonWebKey,
  overrides: {
    rfq?: PrivateRfqV2;
    lockOnChain?: SolverQuoteV3LockOnChain;
    verify?: typeof verifyCanonicalQuote;
  } = {},
) {
  return {
    rfq: overrides.rfq ?? rfq(),
    lockOnChain: overrides.lockOnChain ?? lock(),
    resolveKey: async () => jwk,
    importPublicKey: importQuotePublicKey,
    verify: overrides.verify ?? verifyCanonicalQuote,
  };
}

describe("solver quote v3", () => {
  it("canonically binds every lock and schedule field with sorted JSON keys", async () => {
    const value = await unsigned();
    const canonical = canonicalSolverQuoteV3(value);
    expect(Object.keys(JSON.parse(canonical))).toEqual(
      [...Object.keys(JSON.parse(canonical))].sort(),
    );
    expect(canonical).toContain('"schedule":[{"a":"100","b":"200"}');
    expect(canonicalSolverQuoteV3({ ...value, lockId: "0x401" })).not.toBe(
      canonical,
    );
    expect(
      canonicalSolverQuoteV3({ ...value, schedule: [{ a: 100n, b: 201n }] }),
    ).not.toBe(canonical);
  });

  it("digests only canonical unsigned JSON, not the signature", async () => {
    const first = await quote();
    const second = {
      ...first,
      signature: `0x${"00".repeat(31)}02${"00".repeat(31)}01`,
    };
    await expect(digestSolverQuoteV3(first)).resolves.toBe(
      await digestSolverQuoteV3(second),
    );
  });

  it("rejects malformed signed fields before verification", async () => {
    const value = await unsigned();
    expect(() =>
      canonicalSolverQuoteV3({ ...value, domain: "wrong" as never }),
    ).toThrow(/quote v3/);
    expect(() =>
      canonicalSolverQuoteV3({ ...value, nonce: `0x${"AA".repeat(32)}` }),
    ).toThrow(/lowercase/);
    expect(() =>
      canonicalSolverQuoteV3({ ...value, buyToken: value.sellToken }),
    ).toThrow(/must differ/);
    expect(() =>
      canonicalSolverQuoteV3({ ...value, spreadBps: 10_000 }),
    ).toThrow(/\[0, 10000\)/);
    expect(() =>
      canonicalSolverQuoteV3({ ...value, quoteExpiresAt: value.quotedAt }),
    ).toThrow(/after quoting/);
    expect(() => canonicalSolverQuoteV3({ ...value, schedule: [] })).toThrow(
      /BAD_SCHEDULE/,
    );
  });

  it("round-trips a closed decimal schedule wire shape", async () => {
    const wire = encodeSolverQuoteV3(await quote());
    expect(wire.schedule).toEqual([
      { a: "100", b: "200" },
      { a: "1000", b: "2010" },
    ]);
    expect(decodeSolverQuoteV3(wire)).toEqual(await quote());
    expect(Object.isFrozen(decodeSolverQuoteV3(wire).schedule)).toBe(true);
    expect(() =>
      decodeSolverQuoteV3({
        ...wire,
        schedule: [{ a: "0100", b: "200" }],
      }),
    ).toThrow(/canonical decimal/);
    expect(() =>
      decodeSolverQuoteV3({
        ...wire,
        schedule: [{ a: "100", b: "200", exactSize: "secret" }],
      }),
    ).toThrow(/unsupported/);
    expect(() => decodeSolverQuoteV3({ ...wire, floor: "secret" })).toThrow(
      /unsupported/,
    );
    const { lockId: _missing, ...incomplete } = wire;
    expect(() => decodeSolverQuoteV3(incomplete)).toThrow(/lockId is required/);
  });

  it("verifies a real P-256 signature and resolves its historical key context", async () => {
    const { signed, jwk } = await signedFixture();
    const calls: unknown[][] = [];
    await expect(
      verifySolverQuoteV3(signed, NOW, {
        ...verification(jwk),
        resolveKey: async (...args) => {
          calls.push(args);
          return jwk;
        },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      [signed.solverId, signed.quoteKeyId, signed.quotedAt],
      [signed.solverId, signed.quoteKeyId, NOW],
    ]);
  });

  it.each([
    ["pool", { pool: "starknet:SN_SEPOLIA" as const }],
    ["helper", { helper: "0x101" }],
    ["escrow", { escrowAddress: "0x101" }],
    ["rfq digest", { rfqDigest: D2 }],
    ["rfq felt", { rfqFelt: "0x124" }],
    ["sell token", { sellToken: "0x201" }],
    ["buy token", { buyToken: "0x301" }],
    ["lock expiry", { lockExpiresAt: NOW + 89 }],
    ["bucket lower bound", { schedule: [{ a: 99n, b: 200n }, SCHEDULE[1]] }],
    [
      "bucket upper bound",
      { schedule: [SCHEDULE[0], { a: 1_001n, b: 2_010n }] },
    ],
  ])("rejects an RFQ mismatch in %s", async (_name, mutation) => {
    const { jwk } = await signedFixture();
    await expect(
      verifySolverQuoteV3(await quote(mutation), NOW, verification(jwk)),
    ).rejects.toThrow(/authenticated RFQ context/);
  });

  it.each([
    ["status", { status: "closed" as "open" }],
    ["rfq id", { rfqId: "0x124" }],
    ["commitment", { takerCommitment: "0x125" }],
    ["token A", { tokenA: "0x201" }],
    ["token B", { tokenB: "0x301" }],
    ["expiry", { expiry: NOW + 89 }],
    ["schedule", { schedule: [{ a: 100n, b: 201n }, SCHEDULE[1]] }],
    ["remaining collateral", { remainingB: 2_009n }],
  ])("rejects an on-chain lock mismatch in %s", async (_name, mutation) => {
    const { jwk } = await signedFixture();
    await expect(
      verifySolverQuoteV3(
        await quote(),
        NOW,
        verification(jwk, { lockOnChain: lock(mutation) }),
      ),
    ).rejects.toThrow(/open on-chain lock/);
  });

  it("rejects future, expired, and out-of-RFQ quote windows", async () => {
    const { jwk } = await signedFixture();
    await expect(
      verifySolverQuoteV3(
        await quote({ quotedAt: NOW + 31, quoteExpiresAt: NOW + 40 }),
        NOW,
        verification(jwk),
      ),
    ).rejects.toThrow(/active RFQ or lock window/);
    await expect(
      verifySolverQuoteV3(
        await quote({ quoteExpiresAt: NOW }),
        NOW,
        verification(jwk),
      ),
    ).rejects.toThrow(/active RFQ or lock window/);
    await expect(
      verifySolverQuoteV3(
        await quote({ quotedAt: NOW - 41, quoteExpiresAt: NOW + 10 }),
        NOW,
        verification(jwk),
      ),
    ).rejects.toThrow(/active RFQ or lock window/);
    await expect(
      verifySolverQuoteV3(
        await quote({ quotedAt: NOW + 61, quoteExpiresAt: NOW + 70 }),
        NOW + 40,
        verification(jwk),
      ),
    ).rejects.toThrow(/active RFQ or lock window/);
    await expect(
      verifySolverQuoteV3(await quote(), NOW + 90, verification(jwk)),
    ).rejects.toThrow(/active RFQ or lock window/);
  });

  it("rejects a non-canonical signature and impossible remainingB", async () => {
    const { signed, jwk } = await signedFixture();
    await expect(
      verifySolverQuoteV3(
        {
          ...signed,
          signature: `0x${"00".repeat(31)}01${"ff".repeat(32)}`,
        },
        NOW,
        verification(jwk),
      ),
    ).rejects.toThrow(/low-S/);
    await expect(
      verifySolverQuoteV3(
        signed,
        NOW,
        verification(jwk, {
          lockOnChain: lock({ remainingB: 1n << 128n }),
        }),
      ),
    ).rejects.toThrow(/open on-chain lock/);
  });

  it("rejects a rotated key and forged signature after all context checks", async () => {
    const { signed, jwk } = await signedFixture();
    let resolution = 0;
    await expect(
      verifySolverQuoteV3(signed, NOW, {
        ...verification(jwk),
        resolveKey: async () => ({
          ...jwk,
          x: `${jwk.x}${resolution++}`,
        }),
      }),
    ).rejects.toThrow(/key changed/);
    await expect(
      verifySolverQuoteV3(
        { ...signed, signature: LOW_S_SIGNATURE },
        NOW,
        verification(jwk),
      ),
    ).rejects.toThrow(/signature verification failed/);
    await expect(
      verifySolverQuoteV3(
        signed,
        NOW,
        verification(jwk, { verify: async () => false }),
      ),
    ).rejects.toThrow(/signature verification failed/);
  });
});
