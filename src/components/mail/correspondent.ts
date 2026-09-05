import { feltEquals } from "@/lib/addresses";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
import { parseCompositePayload } from "@/lib/composite";
import { parseOfferPayload, parsePaymentRequestPayload } from "@/lib/otc";
import { parseEscrowFundPayload } from "@/lib/escrow";
import { formatDeviceSentRecipients } from "@/lib/mail-correspondents";
import type { LocalMailMessage } from "./message";

export type ConversationCorrespondent = {
  primary: string;
  detail?: string;
  fullAddress?: string;
};

/**
 * How a record names its counterparty. Shared by the list rail and the thread
 * head so one message cannot be "Sealed sender" in one pane and something else
 * in the other.
 */
export function conversationCorrespondent(
  message: LocalMailMessage,
  aliases: AliasRecord[],
  selfAddress: string,
): ConversationCorrespondent {
  const payload =
    message.envelope.type === "unsupported" ? null : message.envelope.payload;
  const address = (() => {
    switch (message.envelope.type) {
      case "offer":
        return parseOfferPayload(payload)?.offerer;
      case "payment_request":
        return parsePaymentRequestPayload(payload)?.requester;
      case "escrow_fund":
        return parseEscrowFundPayload(payload)?.maker;
      case "composite": {
        const composite = parseCompositePayload(payload);
        for (const attachment of composite?.attachments ?? []) {
          if (attachment.type === "offer") return attachment.payload.offerer;
          if (attachment.type === "payment_request") {
            return attachment.payload.requester;
          }
          if (attachment.type === "escrow_fund")
            return attachment.payload.maker;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  })();

  if (address && (!selfAddress || !feltEquals(address, selfAddress))) {
    const alias = findAliasByAddress(aliases, address)?.label;
    return {
      primary: `Claimed address: ${address}`,
      detail: alias
        ? `Unauthenticated payload claim · local alias “${alias}”`
        : "Unauthenticated payload claim · verify out-of-band",
      fullAddress: address,
    };
  }
  if (
    message.direction === "outgoing" &&
    (message.recipients?.length ?? 0) > 0
  ) {
    return formatDeviceSentRecipients(message.recipients ?? [], aliases);
  }
  if (
    message.envelope.type === "contact_snapshot" ||
    message.envelope.type === "backup_snapshot" ||
    message.envelope.type === "backup_pointer"
  ) {
    return {
      primary: "This mailbox",
      detail: "Encrypted self-backup · verify before restore",
    };
  }
  if (message.direction === "outgoing") {
    return {
      primary: "Private recipient",
      detail: "Device-local Sent copy · recipient was not stored",
    };
  }
  /* A sealed record whose sender you named once on this device is shown by
     that name everywhere, with the caveat attached: naming is a local label,
     never authentication. Without a name it stays sealed, and one name covers
     one fact — "Sealed sender" and "Sealed counterparty" differed only by
     envelope type, which says nothing about who sent a record. */
  if (message.assignedAddress) {
    const alias = findAliasByAddress(aliases, message.assignedAddress)?.label;
    return {
      primary: alias ?? message.assignedAddress,
      detail: "Named on this device · not authenticated",
      fullAddress: message.assignedAddress,
    };
  }
  return { primary: "Sealed sender" };
}

/**
 * A felt shortened for a row or a heading: at full length it wraps to two or
 * three lines and says nothing at a glance that the first and last bytes do
 * not. The full value stays available on hover and in the record itself.
 */
export function shortenFelt(value: string): string {
  const felt = value.trim();
  if (felt.length <= 18) return felt;
  return `${felt.slice(0, 10)}…${felt.slice(-6)}`;
}

/**
 * The same identity, shortened for a heading.
 */
export function correspondentHeadline(
  correspondent: ConversationCorrespondent,
): string {
  const { fullAddress } = correspondent;
  if (!fullAddress || fullAddress.length <= 18) return correspondent.primary;
  return correspondent.primary.replace(fullAddress, shortenFelt(fullAddress));
}
