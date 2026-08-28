import {
  Aes256Gcm,
  CipherSuite,
  DhkemP256HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import {
  RFQ_HPKE_SUITE,
  RFQ_TRANSPORT_DOMAIN,
  canonicalPrivateRfq,
  canonicalRfqTransportAad,
  digestRfqTransportAad,
  type EncryptedRfqEnvelopeV1,
  type MakerKeyWindow,
  type P256PublicJwk,
  type PrivateRfqV1,
  type RfqTransportAadV1,
} from "#protocol";

export const RFQ_HPKE_INFO = "app20/rfq-transport-envelope/v1" as const;
export const RFQ_PADDING_BUCKETS = Object.freeze([512, 1_024, 2_048, 4_096, 8_192, 16_384, 32_768, 65_536] as const);
export const RFQ_HPKE_AEAD_TAG_BYTES = 16;
export const RFQ_FRAME_LENGTH_BYTES = 2;
const encoder = new TextEncoder();

export function createRfqHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

export function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("HPKE input is malformed.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try { binary = atob(padded); } catch { throw new Error("HPKE input is malformed."); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64url(bytes) !== value) throw new Error("HPKE input must use canonical unpadded base64url.");
  return bytes;
}

export async function importRfqTransportPublicKey(jwk: P256PublicJwk): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  } catch {
    throw new Error("HPKE recipient public key is invalid.");
  }
}

export function padRfqPlaintext(canonical: string, bucketBytes: number): Uint8Array {
  if (!RFQ_PADDING_BUCKETS.includes(bucketBytes as (typeof RFQ_PADDING_BUCKETS)[number])) throw new Error("HPKE padding bucket is not reviewed.");
  const payload = encoder.encode(canonical);
  const plaintextBytes = bucketBytes - RFQ_HPKE_AEAD_TAG_BYTES;
  if (payload.length > plaintextBytes - RFQ_FRAME_LENGTH_BYTES || payload.length > 0xffff) throw new Error("RFQ does not fit a reviewed HPKE padding bucket.");
  const frame = new Uint8Array(plaintextBytes);
  new DataView(frame.buffer).setUint16(0, payload.length, false);
  frame.set(payload, RFQ_FRAME_LENGTH_BYTES);
  return frame;
}

export function unpadRfqPlaintext(frame: Uint8Array): string {
  if (frame.length < RFQ_FRAME_LENGTH_BYTES) throw new Error("HPKE plaintext framing is invalid.");
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(0, false);
  if (length > frame.length - RFQ_FRAME_LENGTH_BYTES) throw new Error("HPKE plaintext framing is invalid.");
  for (const byte of frame.subarray(RFQ_FRAME_LENGTH_BYTES + length)) if (byte !== 0) throw new Error("HPKE plaintext padding is invalid.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(RFQ_FRAME_LENGTH_BYTES, RFQ_FRAME_LENGTH_BYTES + length)); }
  catch { throw new Error("HPKE plaintext encoding is invalid."); }
}

function smallestBucket(payloadBytes: number): number {
  const bucket = RFQ_PADDING_BUCKETS.find((candidate) => payloadBytes <= candidate - RFQ_HPKE_AEAD_TAG_BYTES - RFQ_FRAME_LENGTH_BYTES);
  if (!bucket) throw new Error("RFQ exceeds the maximum reviewed HPKE padding bucket.");
  return bucket;
}

export type RfqEnvelopeSealInput = Readonly<{
  rfq: PrivateRfqV1;
  transportKey: MakerKeyWindow;
  aad: Omit<RfqTransportAadV1, "paddingBucketBytes" | "transportKeyId"> & Partial<Pick<RfqTransportAadV1, "paddingBucketBytes">>;
}>;

/** Browser-safe Base-mode one-shot seal. One call creates exactly one sender context. */
export async function sealRfqEnvelope(input: RfqEnvelopeSealInput): Promise<EncryptedRfqEnvelopeV1> {
  const canonical = canonicalPrivateRfq(input.rfq);
  const payloadBytes = encoder.encode(canonical).length;
  const paddingBucketBytes = input.aad.paddingBucketBytes ?? smallestBucket(payloadBytes);
  const aad: RfqTransportAadV1 = { ...input.aad, transportKeyId: input.transportKey.keyId, paddingBucketBytes };
  const aadBytes = encoder.encode(canonicalRfqTransportAad(aad));
  const recipientPublicKey = await importRfqTransportPublicKey(input.transportKey.publicKey);
  let sealed: { ct: ArrayBuffer; enc: ArrayBuffer };
  try {
    sealed = await createRfqHpkeSuite().seal(
      { recipientPublicKey, info: encoder.encode(RFQ_HPKE_INFO) },
      padRfqPlaintext(canonical, paddingBucketBytes),
      aadBytes,
    );
  } catch {
    throw new Error("RFQ HPKE sealing failed.");
  }
  const ct = new Uint8Array(sealed.ct);
  const enc = new Uint8Array(sealed.enc);
  if (ct.length !== paddingBucketBytes || enc.length !== 65 || enc[0] !== 4) throw new Error("RFQ HPKE output did not match the reviewed suite.");
  return Object.freeze({
    version: 1,
    domain: RFQ_TRANSPORT_DOMAIN,
    suite: RFQ_HPKE_SUITE,
    aad: Object.freeze(aad),
    aadDigest: await digestRfqTransportAad(aad),
    encapsulatedKey: encodeBase64url(enc),
    ciphertext: encodeBase64url(ct),
    ciphertextBytes: ct.length,
  });
}

export function createRfqEnvelopeSealer() {
  return { seal: sealRfqEnvelope };
}
