import type { DecodedMail } from "@/lib/envelope";
import type { EncryptedMailRecord } from "@/lib/mail";
import type { PaymentLinkAuthenticity } from "@/lib/payment-link";

export type LocalMailMessage = {
  id: string;
  index: string;
  plaintext: string;
  envelope: DecodedMail;
  record: EncryptedMailRecord;
  transactionHash: string;
  transactionHashes?: string[];
  deliveryState?: "confirmed" | "partially_confirmed";
  documentId?: string;
  blockNumber?: number;
  blockTimestamp?: number;
  eventIndex?: number;
  direction?: "incoming" | "outgoing";
  /** Request imported from /pay; it has no MessagePosted evidence. */
  transport?: "payment_link";
  /** Authenticity verified from the original payment-link fragment. */
  linkAuthenticity?: PaymentLinkAuthenticity;
  recipientCount?: number;
  /** Device-local Sent recipients. Never inferred from sealed incoming mail. */
  recipients?: string[];
  /** Set for locally sent mail so it sorts before the chain confirms a timestamp. */
  localCreatedAt?: number;
  localConversationId?: string;
  assignedAddress?: string;
  /** Thread-only merge of the local Sent projection and its decrypted event. */
  threadProvenance?: "device_sent_and_on_chain";
};

export type ThreadActionState = {
  pending: boolean;
  message?: string;
  startedAt?: number;
};
