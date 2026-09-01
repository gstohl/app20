import { describe, expect, it } from "vitest";
import {
  PRIVATE_RFQ_DOMAIN,
  RFQ_TRANSPORT_AAD_DOMAIN,
  assertEncryptedRfqEnvelope,
  canonicalPrivateRfq,
  canonicalRfqTransportAad,
  digestPrivateRfq,
  type MakerKeyWindow,
  type PrivateRfqV1,
} from "./protocol";
import {
  RFQ_HPKE_INFO,
  RFQ_PADDING_BUCKETS,
  createRfqHpkeSuite,
  decodeBase64url,
  encodeBase64url,
  importRfqTransportPublicKey,
  sealRfqEnvelope,
  padRfqPlaintext,
  unpadRfqPlaintext,
} from "./hpke";
import { createRfqEnvelopeOpener } from "./hpke-open";

const NOW = 1_900_000_000;
const D = `0x${"ab".repeat(32)}`;
const E = `0x${"cd".repeat(32)}`;

async function keys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    pair,
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: publicKey.x!,
      y: publicKey.y!,
    } as const,
  };
}
function rfq(): PrivateRfqV1 {
  return {
    version: 1,
    domain: PRIVATE_RFQ_DOMAIN,
    rfqId: D,
    intentDigest: E,
    chainId: "starknet:SN_SEPOLIA",
    registryRevision: "r1",
    directoryEpoch: 3,
    settlementHelper: "0x123",
    sellToken: "0x1",
    sellAmountBaseUnits: 12n,
    buyToken: "0x2",
    minBuyAmountBaseUnits: 10n,
    createdAt: NOW,
    responseDeadline: NOW + 300,
    expiresAt: NOW + 600,
  };
}

async function fixture() {
  const generated = await keys();
  const transportKey: MakerKeyWindow = {
    keyId: "maker-a/hpke/1",
    publicKey: generated.publicJwk,
    validFrom: NOW - 1,
    validUntil: NOW + 1_000,
  };
  const value = rfq();
  const envelope = await sealRfqEnvelope({
    rfq: value,
    transportKey,
    aad: {
      version: 1,
      domain: RFQ_TRANSPORT_AAD_DOMAIN,
      envelopeId: E,
      rfqDigest: await digestPrivateRfq(value),
      directoryDigest: D,
      directoryEpoch: 3,
      recipientMakerId: "maker-a",
      createdAt: NOW,
      expiresAt: NOW + 300,
      replayNonce: E,
    },
  });
  return { generated, transportKey, envelope, value };
}

describe("RFC 9180 RFQ HPKE", () => {
  it("round-trips matching Base-mode P-256 context with bucket padding", async () => {
    const { generated, transportKey, envelope, value } = await fixture();
    expect(envelope.ciphertextBytes).toBe(512);
    await expect(
      createRfqEnvelopeOpener(() => generated.pair.privateKey).open(
        envelope,
        transportKey,
      ),
    ).resolves.toEqual(value);
  });

  it("fails closed for wrong key, AAD mutation, tamper, truncation, and malformed point", async () => {
    const { generated, transportKey, envelope } = await fixture();
    const wrong = await keys();
    await expect(
      createRfqEnvelopeOpener(() => wrong.pair.privateKey).open(
        envelope,
        transportKey,
      ),
    ).rejects.toThrow(/authentication or decryption/);
    const opener = createRfqEnvelopeOpener(() => generated.pair.privateKey);
    await expect(
      opener.open(
        { ...envelope, aad: { ...envelope.aad, recipientMakerId: "maker-b" } },
        transportKey,
      ),
    ).rejects.toThrow(/authentication or decryption/);
    const tamperedBytes = decodeBase64url(envelope.ciphertext);
    tamperedBytes[Math.floor(tamperedBytes.length / 2)]! ^= 1;
    await expect(
      opener.open(
        { ...envelope, ciphertext: encodeBase64url(tamperedBytes) },
        transportKey,
      ),
    ).rejects.toThrow(/authentication or decryption/);
    await expect(
      opener.open(
        { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) },
        transportKey,
      ),
    ).rejects.toThrow(/authentication or decryption/);
    await expect(
      opener.open(
        { ...envelope, encapsulatedKey: "A".repeat(87) },
        transportKey,
      ),
    ).rejects.toThrow(/authentication or decryption/);
  });

  it("rejects non-canonical base64url and wrong HPKE info/suite", async () => {
    expect(decodeBase64url("AA")).toEqual(new Uint8Array([0]));
    expect(() => decodeBase64url("AB")).toThrow(/canonical unpadded base64url/);
    const { generated, envelope } = await fixture();
    await expect(
      assertEncryptedRfqEnvelope({
        ...envelope,
        suite: "HPKE-wrong-suite" as never,
      }),
    ).rejects.toThrow(/reviewed v1 HPKE suite/);
    await expect(
      createRfqHpkeSuite().open(
        {
          recipientKey: generated.pair.privateKey,
          enc: decodeBase64url(envelope.encapsulatedKey),
          info: new TextEncoder().encode(`${RFQ_HPKE_INFO}/wrong`),
        },
        decodeBase64url(envelope.ciphertext),
        new TextEncoder().encode(canonicalRfqTransportAad(envelope.aad)),
      ),
    ).rejects.toThrow();
  });

  it("enforces padding boundaries and zero padding", () => {
    expect(padRfqPlaintext("x".repeat(494), 512)).toHaveLength(496);
    expect(() => padRfqPlaintext("x".repeat(495), 512)).toThrow(/does not fit/);
    const frame = padRfqPlaintext("ok", 512);
    expect(unpadRfqPlaintext(frame)).toBe("ok");
    frame[frame.length - 1] = 1;
    expect(() => unpadRfqPlaintext(frame)).toThrow(/padding/);
  });

  it("uses the same reviewed padding buckets as RFQ transport AAD", () => {
    const aad = {
      version: 1 as const,
      domain: RFQ_TRANSPORT_AAD_DOMAIN,
      envelopeId: E,
      rfqDigest: D,
      directoryDigest: D,
      directoryEpoch: 3,
      recipientMakerId: "maker-a",
      transportKeyId: "maker-a/hpke/1",
      createdAt: NOW,
      expiresAt: NOW + 300,
      replayNonce: E,
      paddingBucketBytes: 512,
    };
    for (const paddingBucketBytes of RFQ_PADDING_BUCKETS) {
      expect(() =>
        canonicalRfqTransportAad({ ...aad, paddingBucketBytes }),
      ).not.toThrow();
    }
    expect(() =>
      canonicalRfqTransportAad({ ...aad, paddingBucketBytes: 256 }),
    ).toThrow(/reviewed padding bucket/);
  });

  it("rejects AEAD-valid plaintext that is not canonical PrivateRfq JSON", async () => {
    const { generated, transportKey, envelope, value } = await fixture();
    const mutated = `${canonicalPrivateRfq(value).slice(0, -1)},"extra":true}`;
    const sealed = await createRfqHpkeSuite().seal(
      {
        recipientPublicKey: await importRfqTransportPublicKey(
          transportKey.publicKey,
        ),
        info: new TextEncoder().encode(RFQ_HPKE_INFO),
      },
      padRfqPlaintext(mutated, envelope.aad.paddingBucketBytes),
      new TextEncoder().encode(canonicalRfqTransportAad(envelope.aad)),
    );
    const opener = createRfqEnvelopeOpener(() => generated.pair.privateKey);
    await expect(
      opener.open(
        {
          ...envelope,
          encapsulatedKey: encodeBase64url(new Uint8Array(sealed.enc)),
          ciphertext: encodeBase64url(new Uint8Array(sealed.ct)),
          ciphertextBytes: new Uint8Array(sealed.ct).length,
        },
        transportKey,
      ),
    ).rejects.toThrow(/authentication or decryption/);
  });
});
