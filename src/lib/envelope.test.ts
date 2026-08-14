import { describe, expect, it } from "vitest";
import {
  ENVELOPE_TYPE_BYTES,
  ENVELOPE_VERSION,
  UNSUPPORTED_MESSAGE,
  decodeEnvelope,
  encodeEnvelope,
  type EnvelopeType,
} from "./envelope";

const encoder = new TextEncoder();

describe("mail envelope v1", () => {
  it.each(
    Object.entries(ENVELOPE_TYPE_BYTES) as [EnvelopeType, number][],
  )("encodes and decodes %s with its locked type byte", (type, byte) => {
    const payload = { value: type };
    const encoded = encodeEnvelope(type, payload);

    expect(encoded[0]).toBe(ENVELOPE_VERSION);
    expect(encoded[1]).toBe(byte);
    expect(decodeEnvelope(encoded)).toMatchObject({
      version: 1,
      type,
      payload,
    });
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
