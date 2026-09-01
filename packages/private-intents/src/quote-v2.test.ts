import { describe, expect, it } from "vitest";
import {
  MAKER_DIRECTORY_DOMAIN,
  QUOTE_DOMAIN,
  QUOTE_V2_DOMAIN,
  assertQuoteIsV2,
  canonicalSolverQuoteV2,
  createMemoryQuoteV2ReplayStore,
  decodeSolverQuoteV2,
  encodeSolverQuoteV2,
  selectBestSolverQuoteV2,
  verifyMakerDirectoryEpoch,
  verifySolverQuoteV2,
  type MakerDirectoryEpochBodyV1,
  type SolverQuote,
  type SolverQuoteV2,
  type UnsignedSolverQuoteV2,
  type VerifiedMakerDirectoryEpochV1,
} from "./index";

const NOW = 1_900_000_000;
const D = `0x${"11".repeat(32)}`;
const D2 = `0x${"22".repeat(32)}`;
const JWK = {
  kty: "EC",
  crv: "P-256",
  x: "A".repeat(43),
  y: "B".repeat(43),
} as const;

function directoryBody(
  overrides: Partial<MakerDirectoryEpochBodyV1> = {},
): MakerDirectoryEpochBodyV1 {
  return {
    version: 1,
    domain: MAKER_DIRECTORY_DOMAIN,
    chainId: "starknet:SN_SEPOLIA",
    epoch: 1,
    previousEpochDigest: D2,
    registryRevision: "r1",
    issuedAt: NOW - 100,
    validFrom: NOW - 100,
    validUntil: NOW + 1_000,
    authorityKeyId: "authority",
    makers: [
      {
        makerId: "maker",
        settlementAccount: "0x1",
        settlementKeyCommitment: D,
        transportEndpoint: "https://maker.invalid/rfq",
        quoteKeys: [
          {
            keyId: "q1",
            publicKey: JWK,
            validFrom: NOW - 100,
            validUntil: NOW + 1_000,
          },
        ],
        transportKeys: [
          {
            keyId: "t1",
            publicKey: JWK,
            validFrom: NOW - 100,
            validUntil: NOW + 1_000,
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function verifiedDirectory(
  bodyOverrides: Partial<MakerDirectoryEpochBodyV1> = {},
  verificationNow = NOW,
): Promise<VerifiedMakerDirectoryEpochV1> {
  const body = directoryBody(bodyOverrides);
  const result = await verifyMakerDirectoryEpoch(
    { ...body, signature: `0x${"aa".repeat(64)}` },
    {
      now: verificationNow,
      expectedChainId: body.chainId,
      authorityKeys: [
        {
          keyId: "authority",
          publicKey: JWK,
          validFrom: NOW - 1_000,
          validUntil: NOW + 2_000,
        },
      ],
      verify: async () => true,
    },
  );
  if (!result.ok) throw new Error(result.reason);
  return result.verified;
}

function quote(
  overrides: Partial<UnsignedSolverQuoteV2> = {},
): UnsignedSolverQuoteV2 {
  return {
    domain: QUOTE_V2_DOMAIN,
    pool: "starknet:SN_SEPOLIA",
    helper: "0x1",
    sellToken: "0x2",
    sellAmount: 3n,
    buyToken: "0x4",
    intentDigest: D,
    solverId: "maker",
    quoteKeyId: "q1",
    nonce: D,
    reservationId: D,
    reservationFence: 7n,
    reservationExpiresAt: NOW + 200,
    buyAmount: 5n,
    spreadBps: 1,
    pricingProvenance: "fixture",
    quotedAt: NOW - 10,
    quoteExpiresAt: NOW + 100,
    directoryDigest: D,
    directoryEpoch: 1,
    registryRevision: "r1",
    escrowAddress: "0x1",
    escrowClassHash: "0x2",
    settlementContextDigest: D,
    rfqDigest: D,
    ...overrides,
  };
}

function verification(
  directory: VerifiedMakerDirectoryEpochV1,
  canonical?: string,
) {
  return {
    directory,
    expected: {
      pool: "starknet:SN_SEPOLIA" as const,
      helper: "0x1",
      intentDigest: D,
      rfqDigest: D,
      directoryDigest: directory.digest,
      directoryEpoch: 1,
      registryRevision: "r1",
      escrowAddress: "0x1",
      escrowClassHash: "0x2",
      settlementContextDigest: D,
      sellToken: "0x2",
      sellAmount: 3n,
      buyToken: "0x4",
      minBuyAmount: 4n,
      rfqCreatedAt: NOW - 50,
      rfqResponseDeadline: NOW + 50,
      rfqExpiresAt: NOW + 500,
    },
    importPublicKey: async () => ({}) as CryptoKey,
    verify: async (value: string) =>
      canonical === undefined || value === canonical,
  };
}

function signed(unsigned: UnsignedSolverQuoteV2): SolverQuoteV2 {
  return {
    ...unsigned,
    signature: `0x${"00".repeat(31)}01${"00".repeat(31)}01`,
  };
}

describe("solver quote v2", () => {
  it("binds directory, settlement context, and the monotonic reservation fence", () => {
    const base = quote();
    const canonical = canonicalSolverQuoteV2(base);
    expect(canonicalSolverQuoteV2({ ...base, directoryEpoch: 2 })).not.toBe(
      canonical,
    );
    expect(canonicalSolverQuoteV2({ ...base, directoryDigest: D2 })).not.toBe(
      canonical,
    );
    expect(
      canonicalSolverQuoteV2({ ...base, escrowClassHash: "0x3" }),
    ).not.toBe(canonical);
    expect(canonicalSolverQuoteV2({ ...base, rfqDigest: D2 })).not.toBe(
      canonical,
    );
    expect(canonicalSolverQuoteV2({ ...base, reservationFence: 8n })).not.toBe(
      canonical,
    );
    expect(() =>
      canonicalSolverQuoteV2({ ...base, reservationFence: 0n }),
    ).toThrow(/positive u256/);
  });

  it("uses canonical decimal JSON wire amounts and fence", () => {
    const wire = encodeSolverQuoteV2(signed(quote()));
    expect(wire).toMatchObject({
      sellAmount: "3",
      buyAmount: "5",
      reservationFence: "7",
    });
    expect(decodeSolverQuoteV2(wire)).toMatchObject({
      sellAmount: 3n,
      buyAmount: 5n,
      reservationFence: 7n,
    });
    expect(() => decodeSolverQuoteV2({ ...wire, sellAmount: "03" })).toThrow(
      /canonical decimal/,
    );
    expect(() =>
      decodeSolverQuoteV2({ ...wire, reservationFence: "07" }),
    ).toThrow(/canonical decimal/);
    expect(() =>
      canonicalSolverQuoteV2({ ...quote(), spreadBps: Number.NaN }),
    ).toThrow(/safe integer/);
    expect(() =>
      canonicalSolverQuoteV2({ ...quote(), quoteExpiresAt: NOW - 10 }),
    ).toThrow(/strictly ordered/);
    expect(() =>
      decodeSolverQuoteV2({
        ...wire,
        signature: `0x${"00".repeat(31)}01${"ff".repeat(32)}`,
      }),
    ).toThrow(/low-S/);
    expect(() => decodeSolverQuoteV2({ ...wire, extra: true })).toThrow(
      /field extra is unsupported/,
    );
    expect(() => decodeSolverQuoteV2([wire])).toThrow(/must be an object/);
    const { solverId: _missing, ...incomplete } = wire;
    expect(() => decodeSolverQuoteV2(incomplete)).toThrow(
      /solverId is required/,
    );
  });

  it("rejects verification context that is not the verified directory checkpoint", async () => {
    const directory = await verifiedDirectory();
    const input = verification(directory);
    await expect(
      verifySolverQuoteV2(
        signed(quote({ directoryDigest: directory.digest })),
        NOW,
        {
          ...input,
          expected: { ...input.expected, directoryDigest: D2 },
        },
      ),
    ).rejects.toThrow(/verified maker directory checkpoint/);
  });

  it("rejects a signed quote for a different settlement helper", async () => {
    const directory = await verifiedDirectory();
    const input = verification(directory);
    await expect(
      verifySolverQuoteV2(
        signed(quote({ directoryDigest: directory.digest, helper: "0x3" })),
        NOW,
        input,
      ),
    ).rejects.toThrow(/authenticated RFQ\/settlement context/);
  });

  it("rejects historical directories and keys revoked after a backdated quote", async () => {
    const historical = await verifiedDirectory({ validUntil: NOW - 1 }, NOW);
    await expect(
      verifySolverQuoteV2(
        signed(quote({ directoryDigest: historical.digest })),
        NOW,
        verification(historical),
      ),
    ).rejects.toThrow(/active maker directory/);

    const revokedBody = directoryBody();
    const maker = revokedBody.makers[0]!;
    const revoked = await verifiedDirectory({
      makers: [
        {
          ...maker,
          quoteKeys: [{ ...maker.quoteKeys[0]!, revokedAt: NOW - 1 }],
        },
      ],
    });
    await expect(
      verifySolverQuoteV2(
        signed(quote({ directoryDigest: revoked.digest })),
        NOW,
        verification(revoked),
      ),
    ).rejects.toThrow(/not valid/);
  });

  it("rejects quote and reservation expiries beyond the RFQ or directory", async () => {
    const directory = await verifiedDirectory({ validUntil: NOW + 300 });
    const input = verification(directory);
    await expect(
      verifySolverQuoteV2(
        signed(
          quote({
            directoryDigest: directory.digest,
            quoteExpiresAt: NOW + 501,
            reservationExpiresAt: NOW + 502,
          }),
        ),
        NOW,
        input,
      ),
    ).rejects.toThrow(/outside its active RFQ/);
    await expect(
      verifySolverQuoteV2(
        signed(
          quote({
            directoryDigest: directory.digest,
            quoteExpiresAt: NOW + 200,
            reservationExpiresAt: NOW + 301,
          }),
        ),
        NOW,
        input,
      ),
    ).rejects.toThrow(/outside its active RFQ/);
  });

  it("fails signature verification when the signed fence is mutated", async () => {
    const directory = await verifiedDirectory();
    const original = signed(quote({ directoryDigest: directory.digest }));
    const canonical = canonicalSolverQuoteV2(original);
    await expect(
      verifySolverQuoteV2(original, NOW, verification(directory, canonical)),
    ).resolves.toBe("accepted");
    await expect(
      verifySolverQuoteV2(
        { ...original, reservationFence: 8n },
        NOW,
        verification(directory, canonical),
      ),
    ).rejects.toThrow(/signature verification/);
  });

  it("ranks by amount, later expiry, then maker id without arrival-order influence", async () => {
    const body = directoryBody();
    const maker = body.makers[0]!;
    const directory = await verifiedDirectory({
      makers: [
        maker,
        { ...maker, makerId: "maker-b", settlementAccount: "0x2" },
      ],
    });
    const a = signed(
      quote({
        directoryDigest: directory.digest,
        quoteExpiresAt: NOW + 60,
        reservationId: D,
      }),
    );
    const b = signed(
      quote({
        directoryDigest: directory.digest,
        solverId: "maker-b",
        quoteExpiresAt: NOW + 80,
        reservationId: D2,
      }),
    );
    await expect(
      selectBestSolverQuoteV2([a, b], NOW, verification(directory)),
    ).resolves.toBe(b);
    await expect(
      selectBestSolverQuoteV2([b, a], NOW, verification(directory)),
    ).resolves.toBe(b);
    const sameExpiryA = { ...a, quoteExpiresAt: NOW + 80 };
    await expect(
      selectBestSolverQuoteV2([b, sameExpiryA], NOW, verification(directory)),
    ).resolves.toBe(sameExpiryA);
  });

  it("has async idempotent/conflict replay keyed by maker/key/nonce", async () => {
    const store = createMemoryQuoteV2ReplayStore();
    const input = {
      makerId: "maker",
      quoteKeyId: "q",
      nonce: D,
      quoteDigest: D,
      now: NOW,
    };
    await expect(store.consume(input)).resolves.toEqual({ kind: "accepted" });
    await expect(store.consume(input)).resolves.toMatchObject({
      kind: "idempotent",
    });
    await expect(store.consume({ ...input, quoteDigest: D2 })).resolves.toEqual(
      { kind: "conflict" },
    );
  });

  it("refuses localnet quote v1 rather than migrating it", () => {
    const value = {
      ...quote(),
      domain: QUOTE_DOMAIN,
      solverKey: "old",
      signature: "0x12",
    } as unknown as SolverQuote;
    expect(() => assertQuoteIsV2(value)).toThrow(/cannot settle Escrow VNext/);
  });
});
