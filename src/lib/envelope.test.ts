import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import {
  parseCompositePayload,
  type CompositePayload,
} from "./composite";
import {
  ENVELOPE_TYPE_BYTES,
  ENVELOPE_VERSION,
  MAX_COMPOSITE_ENVELOPE_BYTES,
  UNSUPPORTED_MESSAGE,
  decodeEnvelope,
  encodeEnvelope,
  envelopeByteLength,
  type EnvelopeType,
} from "./envelope";

const encoder = new TextEncoder();
const documentId = `0x${"11".repeat(32)}`;
const strk = { symbol: "STRK", address: addrSTRK, decimals: 18 };
const usdc = { symbol: "USDC", address: "0x53c", decimals: 6 };

function compositePayload(): CompositePayload {
  return {
    documentId,
    body: "Body and every attachment travel as one document.",
    attachments: [
      {
        type: "payment",
        payload: {
          dealId: `0x${"12".repeat(32)}`,
          transfer: { token: strk, amount: "1", to: "0xb0b" },
        },
      },
      {
        type: "offer",
        payload: {
          dealId: `0x${"13".repeat(32)}`,
          give: { token: strk, amount: "2" },
          want: { token: usdc, amount: "3" },
          offerer: "0xa11ce",
          expiresAt: 2_000_000_000,
        },
      },
      {
        type: "payment_request",
        payload: {
          requestId: `0x${"14".repeat(32)}`,
          token: strk,
          amount: "4",
          requester: "0xa11ce",
          expiresAt: 2_000_000_000,
        },
      },
      {
        type: "escrow_fund",
        payload: {
          dealId: "0x15",
          escrowAddress: "0xe5c",
          maker: "0xa11ce",
          legA: { token: strk, amount: "5" },
          legB: { token: usdc, amount: "6" },
          deadline: 2_000_000_000,
          claimPubkey: "0x123",
        },
      },
    ],
  };
}

describe("mail envelope v1", () => {
  it.each(
    Object.entries(ENVELOPE_TYPE_BYTES) as [EnvelopeType, number][],
  )("encodes and decodes %s with its locked type byte", (type, byte) => {
    const payload = type === "composite" ? compositePayload() : { value: type };
    const encoded = encodeEnvelope(type, payload);

    expect(envelopeByteLength(type, payload)).toBe(encoded.length);
    expect(encoded[0]).toBe(ENVELOPE_VERSION);
    expect(encoded[1]).toBe(byte);
    expect(decodeEnvelope(encoded)).toMatchObject({
      version: 1,
      type,
      payload,
    });
  });

  it("round-trips body plus payment, offer, invoice, and escrow as one document", () => {
    const payload = compositePayload();
    const encoded = encodeEnvelope("composite", payload);
    expect(encoded.slice(0, 2)).toEqual(new Uint8Array([0x01, 0x0b]));
    expect(decodeEnvelope(encoded)).toMatchObject({
      version: 1,
      type: "composite",
      payload,
    });
  });

  it("rejects invalid or over-cap composites rather than truncating them", () => {
    expect(() =>
      encodeEnvelope("composite", {
        ...compositePayload(),
        attachments: [
          compositePayload().attachments[0],
          compositePayload().attachments[0],
        ],
      }),
    ).toThrow(/invalid/i);

    expect(() =>
      encodeEnvelope("composite", {
        ...compositePayload(),
        body: "x".repeat(4_096),
      }),
    ).toThrow(/140-felt ciphertext cap/i);
    expect(MAX_COMPOSITE_ENVELOPE_BYTES).toBe(4_293);
    expect(
      parseCompositePayload({
        documentId,
        body: "",
        attachments: [{ type: "payment", payload: { amount: "not valid" } }],
      }),
    ).toBeNull();
  });

  it("preserves legacy raw UTF-8 as a synthesized text envelope", () => {
    const bytes = encoder.encode("hello from quietline");
    const decoded = decodeEnvelope(bytes);

    expect(decoded).toMatchObject({
      version: 0,
      type: "text",
      payload: { body: "hello from quietline" },
    });
    expect(decoded.bytes).toEqual(bytes);
  });

  it("keeps the v1 discriminator out of the legacy text body", () => {
    const encoded = encodeEnvelope("text", { body: "x" });
    expect(encoded.slice(0, 2)).toEqual(new Uint8Array([0x01, 0x01]));

    const decoded = decodeEnvelope(encoded);
    expect(decoded).toMatchObject({
      version: 1,
      type: "text",
      payload: { body: "x" },
    });
  });

  it("surfaces an unknown type without throwing and preserves its bytes", () => {
    const bytes = new Uint8Array([0x01, 0x7f, 0xff, 0x00]);
    const decoded = decodeEnvelope(bytes);

    expect(decoded).toMatchObject({
      version: 1,
      type: "unsupported",
      payload: {
        body: UNSUPPORTED_MESSAGE,
        reason: "unknown_type",
        typeByte: 0x7f,
      },
    });
    expect(decoded.bytes).toEqual(bytes);
  });

  it("retains malformed authenticated payloads as unsupported mail", () => {
    expect(decodeEnvelope(new Uint8Array([0xff]))).toMatchObject({
      version: 0,
      type: "unsupported",
      payload: { reason: "invalid_legacy_utf8" },
    });
    expect(
      decodeEnvelope(new Uint8Array([0x01, 0x01, 0x7b])),
    ).toMatchObject({
      version: 1,
      type: "unsupported",
      payload: { reason: "invalid_payload" },
    });
  });

  it("rejects values that JSON.stringify would silently change", () => {
    expect(() => encodeEnvelope("text", undefined)).toThrow(/object/i);
    expect(() => encodeEnvelope("text", { body: undefined })).toThrow(/JSON/i);
    expect(() => encodeEnvelope("text", { amount: 1n })).toThrow(/JSON/i);
    expect(() => encodeEnvelope("text", { amount: Number.NaN })).toThrow(
      /non-finite/i,
    );

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => encodeEnvelope("text", circular)).toThrow(/circular/i);
  });
});
