import type { ValueOperationState } from "./otc";

export function pendingValueLabel(
  state: ValueOperationState | undefined,
  noun: string,
): string | null {
  switch (state) {
    case "reserved": return `Preparing ${noun.toLowerCase()}`;
    case "submitted": return `${noun} submitted · awaiting confirmation`;
    case "unknown": return `${noun} outcome unknown · verify before retrying`;
    case "awaiting-note-maturity": return noun === "Payment" ? "Paying · awaiting note maturity" : "Transfer pending · awaiting note maturity";
    default: return null;
  }
}

