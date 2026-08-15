import {
  parseEscrowFundPayload,
  type EscrowFundPayload,
} from "./escrow";
import {
  parseAcceptPayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  type AcceptPayload,
  type OfferPayload,
  type PaymentRequestPayload,
} from "./otc";
import { sanitizeUntrustedText } from "./text";

export const MAX_COMPOSITE_BODY_CHARS = 4_096;
export const MAX_COMPOSITE_ATTACHMENTS = 4;

export type CompositeAttachment =
  | { type: "payment"; payload: AcceptPayload }
  | { type: "offer"; payload: OfferPayload }
  | { type: "payment_request"; payload: PaymentRequestPayload }
  | { type: "escrow_fund"; payload: EscrowFundPayload };

export type CompositePayload = {
  /** Stable random id used to derive the mail helper action id on retries. */
  documentId: string;
  body: string;
  attachments: CompositeAttachment[];
};

const DOCUMENT_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAttachment(value: unknown): CompositeAttachment | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "payment": {
      const payload = parseAcceptPayload(value.payload);
      return payload ? { type: "payment", payload } : null;
    }
    case "offer": {
      const payload = parseOfferPayload(value.payload);
      return payload ? { type: "offer", payload } : null;
    }
    case "payment_request": {
      const payload = parsePaymentRequestPayload(value.payload);
      return payload ? { type: "payment_request", payload } : null;
    }
    case "escrow_fund": {
      const payload = parseEscrowFundPayload(value.payload);
      return payload ? { type: "escrow_fund", payload } : null;
    }
    default:
      return null;
  }
}

/**
 * Validates and normalizes a composite payload with the parsers already used
 * for each standalone envelope. A document can carry at most one attachment
 * of each kind; this keeps value-moving intent unambiguous on retry.
 */
export function parseCompositePayload(value: unknown): CompositePayload | null {
  if (
    !isObject(value) ||
    typeof value.documentId !== "string" ||
    !DOCUMENT_ID_PATTERN.test(value.documentId) ||
    typeof value.body !== "string" ||
    value.body.length > MAX_COMPOSITE_BODY_CHARS ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > MAX_COMPOSITE_ATTACHMENTS
  ) {
    return null;
  }

  const body = sanitizeUntrustedText(value.body);
  const attachments: CompositeAttachment[] = [];
  const seen = new Set<CompositeAttachment["type"]>();
  for (const candidate of value.attachments) {
    const attachment = parseAttachment(candidate);
    if (!attachment || seen.has(attachment.type)) return null;
    seen.add(attachment.type);
    attachments.push(attachment);
  }
  if (!body.trim() && attachments.length === 0) return null;
  return { documentId: value.documentId, body, attachments };
}

export function compositeAttachment(
  payload: CompositePayload,
  type: CompositeAttachment["type"],
): CompositeAttachment | undefined {
  return payload.attachments.find((attachment) => attachment.type === type);
}
