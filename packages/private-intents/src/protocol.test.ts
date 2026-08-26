import { describe, expect, it } from "vitest";
import {
  MAKER_DIRECTORY_DOMAIN,
  PRIVATE_RFQ_DOMAIN,
  RFQ_HPKE_SUITE,
  RFQ_TRANSPORT_AAD_DOMAIN,
  RFQ_TRANSPORT_DOMAIN,
  acceptEncryptedRfqEnvelope,
  assertEncryptedRfqEnvelope,
  canonicalMakerDirectoryEpoch,
  canonicalMakerReservation,
  canonicalPrivateRfq,
  createMakerReservation,
  createMemoryEnvelopeReplayStore,
  digestMakerDirectoryEpoch,
  digestMakerReservation,
  digestPrivateRfq,
  digestRfqTransportAad,
  resolveMakerQuoteKeyAt,
  transitionMakerReservation,
  verifyMakerDirectoryEpoch,
  type DirectoryAuthorityKey,
  type EncryptedRfqEnvelopeV1,
  type MakerDirectoryEntryV1,
  type MakerDirectoryEpochBodyV1,
  type P256PublicJwk,
  type PrivateRfqV1,
  type SignedMakerDirectoryEpochV1,
  type VerifiedMakerDirectoryEpochV1,
} from "./index";

const NOW = 1_800_000_000;
const USDC =
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const HELPER =
  "0x067c772d127482e87807deaa5b4f5014d48e54d12f190737b47fb37f6438c434";
const ACCOUNT =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
const DIGEST_A = `0x${"11".repeat(32)}`;
const DIGEST_B = `0x${"22".repeat(32)}`;
const DIGEST_C = `0x${"33".repeat(32)}`;
function toHex(bytes: ArrayBuffer): string {
  return `0x${[...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer((value.length - 2) / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      value.slice(2 + index * 2, 4 + index * 2),
      16,
    );
  }
  return bytes;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function p256Keys(): Promise<{
  privateKey: CryptoKey;
  publicKey: P256PublicJwk;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x: exported.x!,
      y: exported.y!,
    },
  };
}

function rfq(overrides: Partial<PrivateRfqV1> = {}): PrivateRfqV1 {
  return {
    version: 1,
    domain: PRIVATE_RFQ_DOMAIN,
    rfqId: DIGEST_A,
    intentDigest: DIGEST_B,
    chainId: "starknet:APP20_LOCALNET",
    registryRevision: "localnet-registry:4",
    directoryEpoch: 0,
    settlementHelper: HELPER,
    sellToken: USDC,
    sellAmountBaseUnits: 100_000_001n,
    buyToken: STRK,
    minBuyAmountBaseUnits: 49_000_000_000_000_000n,
    createdAt: NOW,
    responseDeadline: NOW + 60,
    expiresAt: NOW + 1_200,
    ...overrides,
  };
}

function maker(
  publicKey: P256PublicJwk,
  overrides: Partial<MakerDirectoryEntryV1> = {},
): MakerDirectoryEntryV1 {
  return {
    makerId: "maker-a",
    settlementAccount: ACCOUNT,
    settlementKeyCommitment: DIGEST_C,
    transportEndpoint: "http://127.0.0.1:4311/rfq",
    quoteKeys: [
      {
        keyId: "maker-a/quote/p256/v1",
        publicKey,
        validFrom: NOW - 300,
        validUntil: NOW + 3_600,
      },
    ],
    transportKeys: [
      {
        keyId: "maker-a/hpke/p256/v1",
        publicKey,
        validFrom: NOW - 300,
        validUntil: NOW + 3_600,
      },
    ],
    ...overrides,
  };
}

function directory(
  publicKey: P256PublicJwk,
  overrides: Partial<MakerDirectoryEpochBodyV1> = {},
): MakerDirectoryEpochBodyV1 {
  return {
    version: 1,
    domain: MAKER_DIRECTORY_DOMAIN,
    chainId: "starknet:APP20_LOCALNET",
    epoch: 0,
    previousEpochDigest: null,
    registryRevision: "localnet-registry:4",
    issuedAt: NOW - 180,
    validFrom: NOW - 120,
    validUntil: NOW + 1_800,
    authorityKeyId: "app20-directory/p256/v1",
    makers: [maker(publicKey)],
    ...overrides,
  };
}

async function signDirectory(
  body: MakerDirectoryEpochBodyV1,
  privateKey: CryptoKey,
): Promise<SignedMakerDirectoryEpochV1> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(canonicalMakerDirectoryEpoch(body)),
  );
  return { ...body, signature: toHex(signature) };
}

async function verifyP256(
  canonical: string,
  signature: string,
  publicKey: P256PublicJwk,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromHex(signature),
    new TextEncoder().encode(canonical),
  );
}

function authority(
  publicKey: P256PublicJwk,
  overrides: Partial<DirectoryAuthorityKey> = {},
): DirectoryAuthorityKey {
  return {
    keyId: "app20-directory/p256/v1",
    publicKey,
    validFrom: NOW - 3_600,
    validUntil: NOW + 3_600,
    ...overrides,
  };
}

describe("private RFQ v1", () => {
  it("canonically binds exact units, felt identities, and every execution term", async () => {
    const first = rfq();
    const equivalent = rfq({
      sellToken: `0x000${USDC.slice(2)}`,
      settlementHelper: `0x00${HELPER.slice(2)}`,
    });
    expect(canonicalPrivateRfq(equivalent)).toBe(canonicalPrivateRfq(first));
    expect(canonicalPrivateRfq(first)).toContain(
      '"sellAmountBaseUnits":"100000001"',
    );
    await expect(digestPrivateRfq(equivalent)).resolves.toBe(
      await digestPrivateRfq(first),
    );
    await expect(
      digestPrivateRfq({
        ...first,
        minBuyAmountBaseUnits: first.minBuyAmountBaseUnits + 1n,
      }),
    ).resolves.not.toBe(await digestPrivateRfq(first));
  });

  it("rejects unsafe amounts, same-token requests, and unbounded deadlines", () => {
    expect(() =>
      canonicalPrivateRfq(rfq({ sellAmountBaseUnits: 1n << 256n })),
    ).toThrow(/positive u256/i);
    expect(() => canonicalPrivateRfq(rfq({ buyToken: USDC }))).toThrow(
      /must differ/i,
    );
    expect(() =>
      canonicalPrivateRfq(rfq({ expiresAt: NOW + 24 * 60 * 60 + 1 })),
    ).toThrow(/bounded to 24 hours/i);
  });
});

describe("signed maker directory epochs", () => {
  it("sorts makers and keys deterministically and rejects private JWK material", async () => {
    const keys = await p256Keys();
    const makerB = maker(keys.publicKey, {
      makerId: "maker-b",
      settlementAccount: `0x00${ACCOUNT.slice(2)}`,
      quoteKeys: [
        { ...maker(keys.publicKey).quoteKeys[0]!, keyId: "maker-b/quote/z" },
        { ...maker(keys.publicKey).quoteKeys[0]!, keyId: "maker-b/quote/a" },
      ],
      transportKeys: [
        {
          ...maker(keys.publicKey).transportKeys[0]!,
          keyId: "maker-b/hpke/v1",
        },
      ],
    });
    const body = directory(keys.publicKey, {
      makers: [makerB, maker(keys.publicKey)],
    });
    const reordered = { ...body, makers: [...body.makers].reverse() };
    expect(canonicalMakerDirectoryEpoch(reordered)).toBe(
      canonicalMakerDirectoryEpoch(body),
    );
    await expect(digestMakerDirectoryEpoch(reordered)).resolves.toBe(
      await digestMakerDirectoryEpoch(body),
    );
    expect(() =>
      canonicalMakerDirectoryEpoch(
        directory(keys.publicKey, {
          makers: [maker({ ...keys.publicKey, d: "private" } as P256PublicJwk)],
        }),
      ),
    ).toThrow(/without private material/i);
  });

  it("verifies active and historical epochs against the key valid at signing time", async () => {
    const keys = await p256Keys();
    const body = directory(keys.publicKey, { validUntil: NOW + 100 });
    const signed = await signDirectory(body, keys.privateKey);
    const active = await verifyMakerDirectoryEpoch(signed, {
      now: NOW,
      expectedChainId: body.chainId,
      expectedEpoch: 0,
      expectedPreviousEpochDigest: null,
      authorityKeys: [authority(keys.publicKey, { revokedAt: NOW + 50 })],
      verify: verifyP256,
    });
    expect(active).toMatchObject({ ok: true, verified: { status: "active" } });

    const historical = await verifyMakerDirectoryEpoch(signed, {
      now: NOW + 200,
      expectedChainId: body.chainId,
      authorityKeys: [authority(keys.publicKey, { revokedAt: NOW + 50 })],
      verify: verifyP256,
    });
    expect(historical).toMatchObject({
      ok: true,
      verified: { status: "historical" },
    });
  });

  it("rejects tampering, predecessor mismatch, and epochs signed after revocation", async () => {
    const keys = await p256Keys();
    const body = directory(keys.publicKey);
    const signed = await signDirectory(body, keys.privateKey);
    await expect(
      verifyMakerDirectoryEpoch(
        { ...signed, registryRevision: "tampered" },
        {
          now: NOW,
          expectedChainId: body.chainId,
          authorityKeys: [authority(keys.publicKey)],
          verify: verifyP256,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/signature/i),
    });
    await expect(
      verifyMakerDirectoryEpoch(signed, {
        now: NOW,
        expectedChainId: body.chainId,
        expectedPreviousEpochDigest: DIGEST_A,
        authorityKeys: [authority(keys.publicKey)],
        verify: verifyP256,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/predecessor/i),
    });

    const signedAfterRevocationBody = directory(keys.publicKey, {
      issuedAt: NOW + 20,
      validFrom: NOW + 20,
      validUntil: NOW + 200,
    });
    const signedAfterRevocation = await signDirectory(
      signedAfterRevocationBody,
      keys.privateKey,
    );
    await expect(
      verifyMakerDirectoryEpoch(signedAfterRevocation, {
        now: NOW + 30,
        expectedChainId: body.chainId,
        authorityKeys: [authority(keys.publicKey, { revokedAt: NOW + 10 })],
        verify: verifyP256,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/valid history/i),
    });
  });

  it("resolves only quote keys valid at the historical quote time", async () => {
    const keys = await p256Keys();
    const body = directory(keys.publicKey, {
      makers: [
        maker(keys.publicKey, {
          quoteKeys: [
            {
              ...maker(keys.publicKey).quoteKeys[0]!,
              revokedAt: NOW + 10,
            },
          ],
        }),
      ],
    });
    const signed = await signDirectory(body, keys.privateKey);
    const verification = await verifyMakerDirectoryEpoch(signed, {
      now: NOW,
      expectedChainId: body.chainId,
      authorityKeys: [authority(keys.publicKey)],
      verify: verifyP256,
    });
    if (!verification.ok) throw new Error(verification.reason);
    expect(
      resolveMakerQuoteKeyAt(
        verification.verified,
        "maker-a",
        "maker-a/quote/p256/v1",
        NOW,
      ).keyId,
    ).toBe("maker-a/quote/p256/v1");
    expect(() =>
      resolveMakerQuoteKeyAt(
        verification.verified,
        "maker-a",
        "maker-a/quote/p256/v1",
        NOW + 10,
      ),
    ).toThrow(/not valid/i);
  });
});

describe("maker-specific RFQ transport envelope", () => {
  it("binds reviewed HPKE metadata, exact padding, verified directory, and replay nonce", async () => {
    const keys = await p256Keys();
    const body = directory(keys.publicKey);
    const signed = await signDirectory(body, keys.privateKey);
    const verification = await verifyMakerDirectoryEpoch(signed, {
      now: NOW,
      expectedChainId: body.chainId,
      authorityKeys: [authority(keys.publicKey)],
      verify: verifyP256,
    });
    if (!verification.ok) throw new Error(verification.reason);
    const directoryDigest = verification.verified.digest;
    expect(Object.isFrozen(verification.verified)).toBe(true);
    expect(Object.isFrozen(verification.verified.body.makers)).toBe(true);
    expect(() => {
      (verification.verified.body.makers as MakerDirectoryEntryV1[]).push(
        maker(keys.publicKey, { makerId: "evil" }),
      );
    }).toThrow();
    const decryptedRfq = rfq({ responseDeadline: NOW + 300 });
    const aad = {
      version: 1,
      domain: RFQ_TRANSPORT_AAD_DOMAIN,
      envelopeId: DIGEST_A,
      rfqDigest: await digestPrivateRfq(decryptedRfq),
      directoryDigest,
      directoryEpoch: 0,
      recipientMakerId: "maker-a",
      transportKeyId: "maker-a/hpke/p256/v1",
      createdAt: NOW,
      expiresAt: NOW + 300,
      replayNonce: DIGEST_B,
      paddingBucketBytes: 512,
    } as const;
    const envelope: EncryptedRfqEnvelopeV1 = {
      version: 1,
      domain: RFQ_TRANSPORT_DOMAIN,
      suite: RFQ_HPKE_SUITE,
      aad,
      aadDigest: await digestRfqTransportAad(aad),
      encapsulatedKey: base64url(new Uint8Array(65).fill(7)),
      ciphertext: base64url(new Uint8Array(512).fill(9)),
      ciphertextBytes: 512,
    };
    await expect(assertEncryptedRfqEnvelope(envelope)).resolves.toBeUndefined();
    const replay = createMemoryEnvelopeReplayStore();
    await expect(
      acceptEncryptedRfqEnvelope(
        envelope,
        NOW + 1,
        verification.verified,
        replay,
        {
          open: async () => {
            throw new Error("AEAD failed");
          },
        },
      ),
    ).rejects.toThrow(/HPKE authentication/i);
    await expect(
      acceptEncryptedRfqEnvelope(
        envelope,
        NOW + 1,
        verification.verified,
        replay,
        {
          open: async () => ({
            ...decryptedRfq,
            minBuyAmountBaseUnits: decryptedRfq.minBuyAmountBaseUnits + 1n,
          }),
        },
      ),
    ).rejects.toThrow(/authenticated envelope context/i);
    await expect(
      acceptEncryptedRfqEnvelope(
        envelope,
        NOW + 1,
        verification.verified,
        replay,
        { open: async () => decryptedRfq },
      ),
    ).resolves.toMatchObject({
      transportKey: { keyId: "maker-a/hpke/p256/v1" },
      rfq: { chainId: "starknet:APP20_LOCALNET" },
    });
    await expect(
      acceptEncryptedRfqEnvelope(
        envelope,
        NOW + 1,
        verification.verified,
        replay,
        { open: async () => decryptedRfq },
      ),
    ).rejects.toThrow(/replay/i);
  });

  it("rejects header mutation, wrong padding, and unverified directory digests", async () => {
    const keys = await p256Keys();
    const body = directory(keys.publicKey);
    const directoryDigest = await digestMakerDirectoryEpoch(body);
    const aad = {
      version: 1,
      domain: RFQ_TRANSPORT_AAD_DOMAIN,
      envelopeId: DIGEST_A,
      rfqDigest: DIGEST_B,
      directoryDigest,
      directoryEpoch: 0,
      recipientMakerId: "maker-a",
      transportKeyId: "maker-a/hpke/p256/v1",
      createdAt: NOW,
      expiresAt: NOW + 300,
      replayNonce: DIGEST_C,
      paddingBucketBytes: 512,
    } as const;
    const envelope: EncryptedRfqEnvelopeV1 = {
      version: 1,
      domain: RFQ_TRANSPORT_DOMAIN,
      suite: RFQ_HPKE_SUITE,
      aad,
      aadDigest: await digestRfqTransportAad(aad),
      encapsulatedKey: base64url(new Uint8Array(65).fill(1)),
      ciphertext: base64url(new Uint8Array(512).fill(2)),
      ciphertextBytes: 512,
    };
    await expect(
      assertEncryptedRfqEnvelope({
        ...envelope,
        aad: { ...aad, recipientMakerId: "maker-b" },
      }),
    ).rejects.toThrow(/AAD digest/i);
    await expect(
      assertEncryptedRfqEnvelope({
        ...envelope,
        ciphertext: base64url(new Uint8Array(511).fill(2)),
      }),
    ).rejects.toThrow(/padding bucket/i);
    const forgedDirectory = {
      body,
      digest: directoryDigest,
      status: "active",
      authorityKeyId: body.authorityKeyId,
    } as unknown as VerifiedMakerDirectoryEpochV1;
    await expect(
      acceptEncryptedRfqEnvelope(
        envelope,
        NOW + 1,
        forgedDirectory,
        createMemoryEnvelopeReplayStore(),
        { open: async () => rfq() },
      ),
    ).rejects.toThrow(/signature verification/i);
  });
});

describe("fenced reservation lifecycle", () => {
  function reservation() {
    return createMakerReservation({
      reservationId: DIGEST_A,
      makerId: "maker-a",
      intentDigest: DIGEST_B,
      rfqDigest: DIGEST_C,
      asset: STRK,
      amountBaseUnits: 50_000_000_000_000_000n,
      createdAt: NOW,
      expiresAt: NOW + 300,
      fence: 7n,
    });
  }

  it("selects and consumes only with the current fence and preserves quote binding", async () => {
    const selected = transitionMakerReservation(reservation(), {
      kind: "select",
      expectedFence: 7n,
      at: NOW + 1,
      quoteDigest: DIGEST_A,
    });
    expect(selected).toMatchObject({
      state: "selected",
      fence: 8n,
      selectedQuoteDigest: DIGEST_A,
    });
    const filling = transitionMakerReservation(selected, {
      kind: "begin-fill",
      expectedFence: 8n,
      at: NOW + 2,
      settlementAttemptId: DIGEST_B,
    });
    expect(filling).toMatchObject({
      state: "filling",
      fence: 9n,
      settlementAttemptId: DIGEST_B,
    });
    const consumed = transitionMakerReservation(filling, {
      kind: "consume",
      expectedFence: 9n,
      at: NOW + 3,
      settlementTransactionHash: "0x1234",
    });
    expect(consumed).toMatchObject({ state: "consumed", fence: 10n });
    await expect(digestMakerReservation(consumed)).resolves.not.toBe(
      await digestMakerReservation(selected),
    );
    expect(canonicalMakerReservation(consumed)).toContain(
      '"amountBaseUnits":"50000000000000000"',
    );
    expect(() =>
      transitionMakerReservation(consumed, {
        kind: "release",
        expectedFence: 10n,
        at: NOW + 4,
        reason: "late",
      }),
    ).toThrow(/terminal/i);
  });

  it("refuses stale fences and illegal expiry/consume transitions", () => {
    expect(() =>
      transitionMakerReservation(reservation(), {
        kind: "select",
        expectedFence: 6n,
        at: NOW + 1,
        quoteDigest: DIGEST_A,
      }),
    ).toThrow(/fence is stale/i);
    expect(() =>
      transitionMakerReservation(reservation(), {
        kind: "consume",
        expectedFence: 7n,
        at: NOW + 1,
        settlementTransactionHash: "0x1234",
      }),
    ).toThrow(/in-flight fill/i);
    expect(() =>
      transitionMakerReservation(reservation(), {
        kind: "expire",
        expectedFence: 7n,
        at: NOW + 299,
      }),
    ).toThrow(/elapsed/i);
    expect(
      transitionMakerReservation(reservation(), {
        kind: "expire",
        expectedFence: 7n,
        at: NOW + 300,
      }).state,
    ).toBe("expired");
  });

  it("quarantines unknown chain outcomes instead of releasing inventory", () => {
    const selected = transitionMakerReservation(reservation(), {
      kind: "select",
      expectedFence: 7n,
      at: NOW + 1,
      quoteDigest: DIGEST_A,
    });
    const quarantined = transitionMakerReservation(selected, {
      kind: "quarantine",
      expectedFence: 8n,
      at: NOW + 2,
      reason: "chain outcome unknown after RPC timeout",
    });
    expect(quarantined).toMatchObject({
      state: "quarantined",
      terminalReason: "chain outcome unknown after RPC timeout",
    });
  });

  it("rejects reservation amounts outside u256", () => {
    const current = reservation();
    expect(() =>
      createMakerReservation({
        reservationId: current.reservationId,
        makerId: current.makerId,
        intentDigest: current.intentDigest,
        rfqDigest: current.rfqDigest,
        asset: current.asset,
        amountBaseUnits: 1n << 256n,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt,
        fence: current.fence,
      }),
    ).toThrow(/positive u256/i);
  });
});
