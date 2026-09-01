export const ENVELOPE_VERSION = 1 as const;
export const UNSUPPORTED_MESSAGE = "unsupported message" as const;
/** Single-recipient AES-GCM plaintext ceiling implied by 140 packed felts. */
export const MAX_COMPOSITE_ENVELOPE_BYTES = 4_293;

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
  | "escrow_timeout"
  | "composite"
  | "contact_snapshot"
  | "backup_snapshot"
  | "backup_pointer";

type CompositeWirePayload = {
  documentId: string;
  body: string;
  attachments: Array<{
    type: "payment" | "offer" | "payment_request" | "escrow_fund";
    payload: Record<string, unknown>;
  }>;
  conversationId?: string;
  inReplyTo?: string;
  senderAuth?: Record<string, unknown>;
};

type MailEnvelopeV1 =
  | {
      version: 1;
      type: "composite";
      payload: CompositeWirePayload;
    }
  | {
      version: 1;
      type: Exclude<EnvelopeType, "composite">;
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
  composite: 0x0b,
  contact_snapshot: 0x0c,
  backup_snapshot: 0x0d,
  backup_pointer: 0x0e,
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

function parseCompositeWirePayload(
  value: unknown,
): CompositeWirePayload | null {
  if (
    !isJsonObject(value) ||
    typeof value.documentId !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.documentId) ||
    typeof value.body !== "string" ||
    value.body.length > 4_096 ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 4
  ) {
    return null;
  }
  const attachments: CompositeWirePayload["attachments"] = [];
  const seen = new Set<string>();
  for (const attachment of value.attachments) {
    if (
      !isJsonObject(attachment) ||
      !["payment", "offer", "payment_request", "escrow_fund"].includes(
        String(attachment.type),
      ) ||
      seen.has(String(attachment.type)) ||
      !isJsonObject(attachment.payload)
    ) {
      return null;
    }
    const type =
      attachment.type as CompositeWirePayload["attachments"][number]["type"];
    seen.add(type);
    attachments.push({ type, payload: attachment.payload });
  }
  if (!value.body.trim() && attachments.length === 0) return null;
  const extra: Pick<
    CompositeWirePayload,
    "conversationId" | "inReplyTo" | "senderAuth"
  > = {};
  if (typeof value.conversationId === "string") {
    extra.conversationId = value.conversationId;
  }
  if (typeof value.inReplyTo === "string") extra.inReplyTo = value.inReplyTo;
  if (isJsonObject(value.senderAuth)) {
    extra.senderAuth = value.senderAuth;
  }
  return {
    documentId: value.documentId,
    body: value.body,
    attachments,
    ...extra,
  };
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

function serializeEnvelopePayload(
  type: EnvelopeType,
  payload: unknown,
): { typeByte: number; payloadBytes: Uint8Array } {
  const typeByte = ENVELOPE_TYPE_BYTES[type];
  if (typeByte === undefined) {
    throw new Error(`Unsupported envelope type: ${String(type)}.`);
  }
  if (!isJsonObject(payload)) {
    throw new Error("Envelope payload must be a JSON object.");
  }
  const normalizedPayload =
    type === "composite" ? parseCompositeWirePayload(payload) : payload;
  if (!normalizedPayload) {
    throw new Error("Composite envelope payload is invalid.");
  }
  assertJsonSafe(normalizedPayload);
  return {
    typeByte,
    payloadBytes: textEncoder.encode(JSON.stringify(normalizedPayload)),
  };
}

/** Exact typed plaintext size before encryption, including the v1 header. */
export function envelopeByteLength(
  type: EnvelopeType,
  payload: unknown,
): number {
  return 2 + serializeEnvelopePayload(type, payload).payloadBytes.length;
}

/** Encodes a v1 envelope as version byte, type byte, then a UTF-8 JSON object. */
export function encodeEnvelope(
  type: EnvelopeType,
  payload: unknown,
): Uint8Array {
  const { typeByte, payloadBytes } = serializeEnvelopePayload(type, payload);
  if (
    type === "composite" &&
    2 + payloadBytes.length > MAX_COMPOSITE_ENVELOPE_BYTES
  ) {
    throw new Error(
      "Composite document exceeds the 140-felt ciphertext cap; remove text or attachments.",
    );
  }
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
    const payload: unknown = JSON.parse(
      fatalTextDecoder.decode(bytes.subarray(2)),
    );
    if (!isJsonObject(payload)) {
      return unsupported(bytes, "invalid_payload", ENVELOPE_VERSION, typeByte);
    }
    if (type === "composite") {
      const composite = parseCompositeWirePayload(payload);
      if (!composite) {
        return unsupported(
          bytes,
          "invalid_payload",
          ENVELOPE_VERSION,
          typeByte,
        );
      }
      return {
        version: ENVELOPE_VERSION,
        type: "composite",
        payload: composite,
        bytes,
      };
    }
    return { version: ENVELOPE_VERSION, type, payload, bytes };
  } catch {
    return unsupported(bytes, "invalid_payload", ENVELOPE_VERSION, typeByte);
  }
}
