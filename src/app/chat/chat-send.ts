import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { validateAndParseAddress } from "starknet";
import type { ProviderInterface, WalletAccountV6 } from "starknet";
import { feltEquals } from "@/lib/addresses";
import { MAX_COMPOSITE_BODY_CHARS } from "@/lib/composite";
import { encodeEnvelope, envelopeByteLength } from "@/lib/envelope";
import {
  deriveKeypair,
  encryptMailForRecipients,
  projectEncryptedMailSize,
  publicKeyFromFelts,
  type MailKeypair,
} from "@/lib/mail";
import { createMailSenderAuth, type MailSenderAuth } from "@/lib/mail-auth";
import { randomConversationId } from "@/lib/mail-thread";
import type { SentEnvelope } from "@/components/mail/Compose";
import {
  APP20_HELPER_FUNDING_BASE_UNITS,
  assertPrivateStrk20BatchBalance,
  computeActionId,
  strk20ErrorMessage,
  submitMail,
  transactionHashFromError,
  transactionStateFromError,
  waitForStrk20Transaction,
} from "@/lib/strk20";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import { addrSTRK } from "@/utils/constants";

/**
 * The chat composer sends exactly what the document composer sends for a body-only
 * document: one encrypted `text` envelope to one registered mailbox, funded by
 * the same fixed helper deposit, through the same wallet policy. Every step
 * below is the Compose step it mirrors; Chat never gets a looser path.
 */

export const CHAT_LETTER_MAX_CHARS = MAX_COMPOSITE_BODY_CHARS;

const ZERO_ID = `0x${"0".repeat(64)}`;

/** Length-stable stand-in used only for the live ciphertext budget. */
const PREVIEW_SENDER_AUTH: MailSenderAuth = {
  version: 1,
  mailboxPublicKey: "0".repeat(64),
  authPublicKey: "0".repeat(64),
  signature: "0".repeat(128),
};

export type ChatSendReadiness = Readonly<{
  helperAddress: string | null;
  networkName: string;
  connected: boolean;
  hasWalletAccount: boolean;
  senderAddress: string;
  isStrk20Capable: boolean;
  keyReady: boolean;
}>;

export type ChatSendBlocker = Readonly<{
  kind: "network" | "wallet" | "capability" | "key";
  message: string;
}>;

/** The same reasons, in the same order, that disable Send in the document composer. */
export function chatSendBlocker(
  readiness: ChatSendReadiness,
): ChatSendBlocker | null {
  if (!readiness.helperAddress) {
    return {
      kind: "network",
      message: `Chat is unavailable on ${readiness.networkName} in this deployment. Switch network or try again later.`,
    };
  }
  if (
    !readiness.connected ||
    !readiness.hasWalletAccount ||
    !readiness.senderAddress
  ) {
    return {
      kind: "wallet",
      message: "Connect a privacy-enabled wallet before sending messages.",
    };
  }
  if (!readiness.isStrk20Capable) {
    return {
      kind: "capability",
      message:
        "This wallet does not expose the dapp-facing STRK20 Wallet API Chat requires. See the wallet capability diagnostic.",
    };
  }
  if (!readiness.keyReady) {
    return {
      kind: "key",
      message: "Load this device's chat key before sending.",
    };
  }
  return null;
}

export type ChatLetter = Readonly<{
  type: "text";
  payload: Readonly<Record<string, unknown>>;
  documentId: string;
  conversationId: string;
}>;

export function buildChatLetter(input: {
  body: string;
  documentId?: string;
  conversationId?: string;
  inReplyTo?: string;
  mailSeed?: Uint8Array | null;
  keypair?: MailKeypair | null;
}): ChatLetter {
  const { body } = input;
  if (!body.trim()) throw new Error("Write a message before sending.");
  if (body.length > CHAT_LETTER_MAX_CHARS) {
    throw new Error(
      `Messages stay under ${CHAT_LETTER_MAX_CHARS + 1} characters.`,
    );
  }
  const documentId = input.documentId ?? randomConversationId();
  const conversationId = input.conversationId ?? randomConversationId();
  const inReplyTo = input.inReplyTo ?? "";
  let senderAuth: MailSenderAuth | undefined;
  if (input.mailSeed) {
    const keypair = input.keypair ?? deriveKeypair(input.mailSeed);
    senderAuth = createMailSenderAuth(input.mailSeed, keypair.publicKey, {
      documentId,
      conversationId,
      inReplyTo,
      body,
    });
  }
  return {
    type: "text",
    documentId,
    conversationId,
    payload: {
      body,
      documentId,
      conversationId,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(senderAuth ? { senderAuth } : {}),
    },
  };
}

export type ChatLetterBudget = Readonly<{
  plaintextBytes: number;
  maxPlaintextBytes: number;
  ciphertextFelts: number;
  maxCiphertextFelts: number;
  fits: boolean;
}>;

export function chatLetterBudget(letter: ChatLetter): ChatLetterBudget {
  const plaintextBytes = envelopeByteLength(letter.type, letter.payload);
  const size = projectEncryptedMailSize(plaintextBytes, 1);
  return {
    plaintextBytes,
    maxPlaintextBytes: size.maxPlaintextBytes,
    ciphertextFelts: size.ciphertextFelts,
    maxCiphertextFelts: size.maxCiphertextFelts,
    fits: size.fits,
  };
}

/** Budget for a body as it is typed, without signing on every keystroke. */
export function previewChatLetterBudget(
  body: string,
  signed: boolean,
  inReplyTo = "",
): ChatLetterBudget {
  return chatLetterBudget({
    type: "text",
    documentId: ZERO_ID,
    conversationId: ZERO_ID,
    payload: {
      body,
      documentId: ZERO_ID,
      conversationId: ZERO_ID,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(signed ? { senderAuth: PREVIEW_SENDER_AUTH } : {}),
    },
  });
}

export type ChatSendPhase =
  | "checking"
  | "lookup"
  | "encrypting"
  | "proving"
  | "submitted";

export type ChatSendContext = Readonly<{
  providerIndex: number;
  provider: ProviderInterface;
  helperAddress: string;
  walletAccount: WalletAccountV6;
  selectedWallet: WalletWithStarknetFeatures;
  senderAddress: string;
  chainId: string;
  /** Null for a mailbox opened without its recovery seed: the letter is then unsigned. */
  mailSeed: Uint8Array | null;
  keypair: MailKeypair;
}>;

export type ChatSendInput = Readonly<{
  recipient: string;
  body: string;
  conversationId?: string;
  inReplyTo?: string;
  context: ChatSendContext;
  onPhase?: (phase: ChatSendPhase, detail: string) => void;
}>;

/** The confirmed letter in the shape the mailbox desk records as its Sent copy. */
export type ChatSendResult = Readonly<{
  envelope: SentEnvelope;
  transactionHash: string;
}>;

export type PendingChatLetter = Omit<SentEnvelope, "deliveryState">;

export class ChatSendError extends Error {
  constructor(
    message: string,
    readonly submittedTransactionHash?: string,
    readonly outcome: "retryable" | "unknown" = "retryable",
    readonly pendingLetter?: PendingChatLetter,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ChatSendError";
  }
}

export function chatSendFailure(error: unknown, pendingLetter?: PendingChatLetter): ChatSendError {
  const detail = strk20ErrorMessage(error);
  const hash = transactionHashFromError(error) ?? pendingLetter?.transactionHash;
  const state = transactionStateFromError(error);
  if (state === "unknown" || (hash && state !== "reverted")) {
    return new ChatSendError(
      hash
        ? "Delivery isn’t confirmed yet. Your draft is kept here. Check delivery before sending again."
        : "The wallet didn’t return a transaction ID. Your draft is kept here. Check your wallet activity before sending again.",
      hash, "unknown", pendingLetter, detail,
    );
  }
  return new ChatSendError(
    detail === "The wallet request was declined."
      ? "Wallet request declined. Your draft is kept here; retry when you’re ready."
      : "The message wasn’t sent. Your draft is kept here; review the details and retry.",
    hash, "retryable", undefined, detail,
  );
}

/** Reconcile the original transaction. This never calls the wallet or submits mail. */
export async function checkChatDelivery(
  provider: ProviderInterface,
  pending: PendingChatLetter,
): Promise<ChatSendResult> {
  await waitForStrk20Transaction(provider, pending.transactionHash, 10_000);
  return {
    transactionHash: pending.transactionHash,
    envelope: { ...pending, deliveryState: "confirmed" },
  };
}

export async function sendChatLetter(
  input: ChatSendInput,
): Promise<ChatSendResult> {
  const { context } = input;
  let recipient: string;
  try {
    recipient = validateAndParseAddress(input.recipient);
  } catch {
    throw new ChatSendError("The counterparty address is not a valid Starknet address.");
  }
  if (feltEquals(recipient, context.senderAddress)) {
    throw new ChatSendError(
      "This is your own chat. Self-addressed backups are posted from the chat tools.",
    );
  }
  let letter: ChatLetter;
  try {
    letter = buildChatLetter({
      body: input.body,
      conversationId: input.conversationId,
      inReplyTo: input.inReplyTo,
      mailSeed: context.mailSeed,
      keypair: context.keypair,
    });
  } catch (error: unknown) {
    throw new ChatSendError(
      error instanceof Error ? error.message : "The message could not be built.",
    );
  }
  const budget = chatLetterBudget(letter);
  if (!budget.fits) {
    const excess = budget.plaintextBytes - budget.maxPlaintextBytes;
    throw new ChatSendError(
      `This message would use ${budget.ciphertextFelts} / ${budget.maxCiphertextFelts} ciphertext felts. Remove at least ${excess} encoded byte${excess === 1 ? "" : "s"}. Nothing was submitted.`,
    );
  }
  const encoded = encodeEnvelope(letter.type, letter.payload);
  const policy = () =>
    assertWalletOperationPolicy(
      context.selectedWallet,
      context.providerIndex as 0 | 2 | 3,
      "mail",
    );

  let submittedHash: string | undefined;
  let pendingLetter: PendingChatLetter | undefined;
  try {
    policy();
    input.onPhase?.("checking", "Checking private STRK for chat service funding…");
    await assertPrivateStrk20BatchBalance(context.walletAccount, addrSTRK, [
      APP20_HELPER_FUNDING_BASE_UNITS,
    ]);

    input.onPhase?.("lookup", "Looking up the counterparty's registered chat key…");
    const registered = await context.provider.callContract({
      contractAddress: context.helperAddress,
      entrypoint: "get_pubkey",
      calldata: [recipient],
    });
    if (
      registered.length !== 2 ||
      (BigInt(registered[0]) === 0n && BigInt(registered[1]) === 0n)
    ) {
      throw new Error("The counterparty has not registered a chat public key.");
    }
    const recipientKey = publicKeyFromFelts(registered);

    input.onPhase?.("encrypting", "Sealing the message on this device…");
    const record = await encryptMailForRecipients([recipientKey], encoded);

    input.onPhase?.("proving", "Waiting for the wallet to prove and submit…");
    const result = await submitMail(
      {
        account: context.walletAccount,
        provider: context.provider,
        helperAddress: context.helperAddress,
        recoveryAddress: context.senderAddress,
        tokenAddress: addrSTRK,
        record,
        actionId: computeActionId("composite-document", letter.documentId),
        helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
        policy,
      },
      {
        onSubmitted: (transactionHash) => {
          submittedHash = transactionHash;
          pendingLetter = {
            documentId: letter.documentId, draftId: letter.documentId,
            type: "text", payload: letter.payload, plaintext: input.body,
            record, transactionHash, transactionHashes: [transactionHash],
            recipientCount: 1, recipients: [recipient],
          };
          input.onPhase?.(
            "submitted",
            `Transaction ${transactionHash} submitted; waiting for confirmation…`,
          );
        },
      },
    );

    const envelope: SentEnvelope = {
      documentId: letter.documentId,
      draftId: letter.documentId,
      type: "text",
      payload: letter.payload,
      plaintext: input.body,
      record,
      transactionHash: result.transactionHash,
      transactionHashes: [result.transactionHash],
      recipientCount: 1,
      recipients: [recipient],
      deliveryState: "confirmed",
    };
    return { envelope, transactionHash: result.transactionHash };
  } catch (error: unknown) {
    if (error instanceof ChatSendError) throw error;
    const failure = chatSendFailure(error, pendingLetter);
    // A callback may fail after submission; retain its hash even if the original
    // exception did not carry one.
    if (submittedHash && !failure.submittedTransactionHash) {
      throw new ChatSendError(failure.message, submittedHash, "unknown", pendingLetter, failure.detail);
    }
    throw failure;
  }
}
