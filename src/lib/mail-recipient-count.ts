import {
  MAX_MULTI_RECIPIENTS,
  MULTI_RECIPIENT_SLOT_BYTES,
  MULTI_RECIPIENT_VERSION,
  MULTI_RECIPIENT_VIEW_TAG,
  unpackFeltsToBytes,
  type EncryptedMailRecord,
} from "./mail";

const MULTI_RECIPIENT_MARKER = [0x51, 0x4c, 0x4d] as const;
const MULTI_RECIPIENT_COUNT_OFFSET = 4;

/**
 * Returns the recipient count disclosed by the ciphertext format. Legacy
 * records are one-recipient records. A malformed reserved-tag record falls
 * back to one so untrusted event data never manufactures a plausible group.
 */
export function publicRecipientCount(record: EncryptedMailRecord): number {
  if (record.viewTag !== MULTI_RECIPIENT_VIEW_TAG) return 1;

  try {
    const bytes = unpackFeltsToBytes(record.ciphertextFelts);
    const hasMarker = MULTI_RECIPIENT_MARKER.every(
      (byte, index) => bytes[index] === byte,
    );
    const count = bytes[MULTI_RECIPIENT_COUNT_OFFSET];
    const minimumWireBytes =
      5 + count * MULTI_RECIPIENT_SLOT_BYTES + 12 + 16;
    if (
      hasMarker &&
      bytes[3] === MULTI_RECIPIENT_VERSION &&
      count >= 2 &&
      count <= MAX_MULTI_RECIPIENTS &&
      bytes.length >= minimumWireBytes
    ) {
      return count;
    }
  } catch {
    // Public event data is untrusted; use the legacy-safe disclosure below.
  }

  return 1;
}
