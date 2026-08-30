import { canonicalizeStarknetAddress, feltEquals } from "./addresses";
import { findAliasByAddress, type AliasRecord } from "./aliases";

export function canonicalizeKnownAddress(value: string): string | null {
  try {
    return canonicalizeStarknetAddress(value);
  } catch {
    return null;
  }
}

export function uniqueCanonicalAddresses(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const value of values) {
    const address = canonicalizeKnownAddress(value);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    addresses.push(address);
  }
  return addresses;
}

export function formatDeviceSentRecipients(
  recipients: readonly string[],
  aliases: readonly AliasRecord[],
): { primary: string; detail: string; fullAddress?: string } {
  if (recipients.length === 0) {
    return {
      primary: "Private recipient",
      detail: "Device-local Sent copy · recipient was not stored",
    };
  }
  const [first, ...rest] = recipients;
  const alias = findAliasByAddress(aliases, first)?.label;
  const head = alias ? `${alias} · ${first}` : first;
  return {
    primary: rest.length ? `${head} + ${rest.length} more` : head,
    detail:
      "Device-local Sent copy · addresses stored on this profile, not on-chain",
    fullAddress: first,
  };
}

export function claimedFinancialAddress(
  message: {
    envelope: { type: string; payload?: unknown };
    direction?: "incoming" | "outgoing";
  },
  selfAddress: string,
): string | null {
  const payload =
    message.envelope.type === "unsupported"
      ? null
      : (message.envelope as { payload?: unknown }).payload;
  let claimed: string | undefined;
  switch (message.envelope.type) {
    case "offer":
      claimed = (payload as { offerer?: string } | null)?.offerer;
      break;
    case "payment_request":
      claimed = (payload as { requester?: string } | null)?.requester;
      break;
    case "escrow_fund":
      claimed = (payload as { maker?: string } | null)?.maker;
      break;
    case "composite": {
      const attachments =
        (
          payload as {
            attachments?: Array<{ type: string; payload?: unknown }>;
          }
        )?.attachments ?? [];
      for (const attachment of attachments) {
        if (attachment.type === "offer") {
          claimed = (attachment.payload as { offerer?: string } | undefined)
            ?.offerer;
        } else if (attachment.type === "payment_request") {
          claimed = (attachment.payload as { requester?: string } | undefined)
            ?.requester;
        } else if (attachment.type === "escrow_fund") {
          claimed = (attachment.payload as { maker?: string } | undefined)
            ?.maker;
        }
        if (claimed) break;
      }
      break;
    }
    default:
      claimed = undefined;
  }
  if (!claimed) return null;
  const address = canonicalizeKnownAddress(claimed);
  if (!address) return null;
  if (selfAddress && feltEquals(address, selfAddress)) return null;
  return address;
}

export function replyAddressForMessage(
  message: {
    direction?: "incoming" | "outgoing";
    recipients?: readonly string[];
    envelope: { type: string; payload?: unknown };
  },
  selfAddress: string,
): string | null {
  if (message.direction === "outgoing") return null;
  return claimedFinancialAddress(message, selfAddress);
}

export function replyAddressForConversation(
  messages: readonly {
    direction?: "incoming" | "outgoing";
    recipients?: readonly string[];
    assignedAddress?: string;
    envelope: { type: string; payload?: unknown };
  }[],
  selfAddress: string,
): string | null {
  const candidates: string[] = [];
  for (const message of messages) {
    if (message.direction === "outgoing") {
      candidates.push(...(message.recipients ?? []));
      continue;
    }
    const assigned = message.assignedAddress
      ? canonicalizeKnownAddress(message.assignedAddress)
      : null;
    const claimed = replyAddressForMessage(message, selfAddress);
    if (assigned) candidates.push(assigned);
    if (claimed) candidates.push(claimed);
  }
  const counterparties = uniqueCanonicalAddresses(candidates).filter(
    (candidate) => !selfAddress || !feltEquals(candidate, selfAddress),
  );
  return counterparties.length === 1 ? counterparties[0] : null;
}

export function describeMailScanCursor(cursor: {
  newestScannedBlock: number | null;
  oldestScannedBlock: number | null;
  pending?: { continuationToken: string };
}): string {
  if (cursor.pending) {
    return "A previous check paused at a page budget. Resume to continue from the saved token.";
  }
  if (
    cursor.newestScannedBlock === null &&
    cursor.oldestScannedBlock === null
  ) {
    return "No inbox check has completed on this device for this mailbox yet.";
  }
  return `Last completed range: blocks ${cursor.oldestScannedBlock ?? "—"}–${cursor.newestScannedBlock ?? "—"}.`;
}
