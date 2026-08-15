export const ENVELOPE_VERSION = 1 as const;
export const UNSUPPORTED_MESSAGE = "unsupported message" as const;

export type EnvelopeType =
  | "text"
  | "offer"
  | "accept"
  | "decline"
  | "receipt"
  | "payment_request"
  | "escrow_fund"
  | "escrow_fill"
  | "escrow_claim"
  | "escrow_timeout";

type MailEnvelopeV1 = {
  version: 1;
  type: EnvelopeType;
  payload: unknown;
};

type UnsupportedMail = {
  version: number;
  type: "unsupported";
  payload: {
    body: typeof UNSUPPORTED_MESSAGE;
    reason: "unknown_type" | "invalid_payload" | "invalid_legacy_utf8";
    typeByte?: number;
  };
  bytes: Uint8Array;
};

export type DecodedMail =
  | {
      version: 0;
      type: "text";
      payload: { body: string };
      bytes: Uint8Array;
    }
  | (MailEnvelopeV1 & { bytes: Uint8Array })
  | UnsupportedMail;

export const ENVELOPE_TYPE_BYTES: Readonly<Record<EnvelopeType, number>> = {
  text: 0x01,
  offer: 0x02,
  accept: 0x03,
  decline: 0x04,
  receipt: 0x05,
  payment_request: 0x06,
  escrow_fund: 0x07,
  escrow_fill: 0x08,
  escrow_claim: 0x09,
  escrow_timeout: 0x0a,
};

const TYPES_BY_BYTE = new Map<number, EnvelopeType>(
  Object.entries(ENVELOPE_TYPE_BYTES).map(([type, byte]) => [
    byte,
    type as EnvelopeType,
  ]),
);
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

function assertJsonSafe(
  value: unknown,
  ancestors = new Set<object>(),
  path = "payload",
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new Error(`${path} contains a value that JSON cannot represent.`);
  }

  if (ancestors.has(value)) {
    throw new Error(`${path} contains a circular reference.`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new Error(`${path}[${index}] is an array hole.`);
        }
        assertJsonSafe(value[index], ancestors, `${path}[${index}]`);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain JSON objects.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${path} contains a symbol key.`);
    }

    for (const [key, child] of Object.entries(value)) {
      assertJsonSafe(child, ancestors, `${path}.${key}`);
    }
  } finally {
    ancestors.delete(value);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unsupported(
  bytes: Uint8Array,
  reason: UnsupportedMail["payload"]["reason"],
  version: number,
  typeByte?: number,
): UnsupportedMail {
  return {
    version,
    type: "unsupported",
    payload: {
      body: UNSUPPORTED_MESSAGE,
      reason,
      ...(typeByte === undefined ? {} : { typeByte }),
    },
    bytes,
  };
}

/** Encodes a v1 envelope as version byte, type byte, then a UTF-8 JSON object. */
export function encodeEnvelope(
  type: EnvelopeType,
  payload: unknown,
): Uint8Array {
  const typeByte = ENVELOPE_TYPE_BYTES[type];
  if (typeByte === undefined) {
    throw new Error(`Unsupported envelope type: ${String(type)}.`);
  }
  if (!isJsonObject(payload)) {
    throw new Error("Envelope payload must be a JSON object.");
  }

  assertJsonSafe(payload);
  const json = JSON.stringify(payload);
  const payloadBytes = textEncoder.encode(json);
  const bytes = new Uint8Array(2 + payloadBytes.length);
  bytes[0] = ENVELOPE_VERSION;
  bytes[1] = typeByte;
  bytes.set(payloadBytes, 2);
  return bytes;
}

/**
 * Decodes typed v1 mail and synthesizes a text envelope for legacy raw UTF-8.
 * Authenticated but unrecognized bytes stay visible as an unsupported message.
 */
export function decodeEnvelope(input: Uint8Array): DecodedMail {
  const bytes = input.slice();

  if (bytes[0] !== ENVELOPE_VERSION || bytes.length < 2) {
    try {
      return {
        version: 0,
        type: "text",
        payload: { body: fatalTextDecoder.decode(bytes) },
        bytes,
      };
    } catch {
      return unsupported(bytes, "invalid_legacy_utf8", 0);
    }
  }

  const typeByte = bytes[1];
  const type = TYPES_BY_BYTE.get(typeByte);
  if (!type) {
    return unsupported(bytes, "unknown_type", ENVELOPE_VERSION, typeByte);
  }

  try {
    const payload: unknown = JSON.parse(fatalTextDecoder.decode(bytes.subarray(2)));
    if (!isJsonObject(payload)) {
      return unsupported(bytes, "invalid_payload", ENVELOPE_VERSION, typeByte);
    }
    return { version: ENVELOPE_VERSION, type, payload, bytes };
  } catch {
    return unsupported(bytes, "invalid_payload", ENVELOPE_VERSION, typeByte);
  }
}
