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
import { saveSentMail, type StoredSentMail } from "@/lib/sent-mail";
import {
  APP20_HELPER_FUNDING_BASE_UNITS,
  assertPrivateStrk20BatchBalance,
  computeActionId,
  strk20ErrorMessage,
  submitMail,
  transactionHashFromError,
} from "@/lib/strk20";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import { addrSTRK } from "@/utils/constants";

/**
 * The chat composer sends exactly what Mailbox's Compose sends for a body-only
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

/** The same reasons, in the same order, that disable Send in Mailbox. */
export function chatSendBlocker(
  readiness: ChatSendReadiness,
): ChatSendBlocker | null {
  if (!readiness.helperAddress) {
    return {
      kind: "network",
      message: `Mail is unavailable on ${readiness.networkName} in this deployment. Switch network or try again later.`,
    };
  }
  if (
    !readiness.connected ||
    !readiness.hasWalletAccount ||
    !readiness.senderAddress
  ) {
    return {
      kind: "wallet",
      message: "Connect a privacy-enabled wallet before sending mail.",
    };
  }
  if (!readiness.isStrk20Capable) {
    return {
      kind: "capability",
      message:
        "This wallet does not expose the dapp-facing STRK20 Wallet API Mail requires. See the wallet capability diagnostic.",
    };
  }
  if (!readiness.keyReady) {
    return {
      kind: "key",
      message: "Load this device's mail key before sending.",
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
      `Letters stay under ${CHAT_LETTER_MAX_CHARS + 1} characters.`,
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
  mailSeed: Uint8Array;
  keypair: MailKeypair;
}>;

export type ChatSendInput = Readonly<{
  recipient: string;
  body: string;
  conversationId?: string;
  inReplyTo?: string;
  context: ChatSendContext;
  storage: Pick<Storage, "getItem" | "setItem">;
  onPhase?: (phase: ChatSendPhase, detail: string) => void;
  now?: () => number;
}>;

export type ChatSendResult = Readonly<{
  sent: StoredSentMail;
  transactionHash: string;
  /** False when the chain confirmed the letter but browser storage refused the copy. */
  localCopySaved: boolean;
  localCopyError?: string;
}>;

export class ChatSendError extends Error {
  readonly submittedTransactionHash: string | undefined;

  constructor(message: string, submittedTransactionHash?: string) {
    super(message);
    this.name = "ChatSendError";
    this.submittedTransactionHash = submittedTransactionHash;
  }
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
      "This is your own mailbox. Self-addressed backups are posted from Mailbox.",
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
      error instanceof Error ? error.message : "The letter could not be built.",
    );
  }
  const budget = chatLetterBudget(letter);
  if (!budget.fits) {
    const excess = budget.plaintextBytes - budget.maxPlaintextBytes;
    throw new ChatSendError(
      `This letter would use ${budget.ciphertextFelts} / ${budget.maxCiphertextFelts} ciphertext felts. Remove at least ${excess} encoded byte${excess === 1 ? "" : "s"}. Nothing was submitted.`,
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
  try {
    policy();
    input.onPhase?.("checking", "Checking private STRK for mail-helper funding…");
    await assertPrivateStrk20BatchBalance(context.walletAccount, addrSTRK, [
      APP20_HELPER_FUNDING_BASE_UNITS,
    ]);

    input.onPhase?.("lookup", "Looking up the counterparty's registered mail key…");
    const registered = await context.provider.callContract({
      contractAddress: context.helperAddress,
      entrypoint: "get_pubkey",
      calldata: [recipient],
    });
    if (
      registered.length !== 2 ||
      (BigInt(registered[0]) === 0n && BigInt(registered[1]) === 0n)
    ) {
      throw new Error("The counterparty has not registered a mail public key.");
    }
    const recipientKey = publicKeyFromFelts(registered);

    input.onPhase?.("encrypting", "Sealing the letter on this device…");
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
          input.onPhase?.(
            "submitted",
            `Transaction ${transactionHash} submitted; waiting for confirmation…`,
          );
        },
      },
    );

    const sent: StoredSentMail = {
      version: 1,
      documentId: letter.documentId,
      type: "text",
      payload: letter.payload,
      plaintext: input.body,
      record,
      transactionHash: result.transactionHash,
      transactionHashes: [result.transactionHash],
      recipientCount: 1,
      recipients: [recipient],
      deliveryState: "confirmed",
      createdAt: (input.now ?? Date.now)(),
    };
    try {
      saveSentMail(input.storage, context.chainId, context.senderAddress, sent);
    } catch (error: unknown) {
      return {
        sent,
        transactionHash: result.transactionHash,
        localCopySaved: false,
        localCopyError:
          error instanceof Error ? error.message : "Browser storage failed.",
      };
    }
    return { sent, transactionHash: result.transactionHash, localCopySaved: true };
  } catch (error: unknown) {
    if (error instanceof ChatSendError) throw error;
    const base = strk20ErrorMessage(error);
    const hash = transactionHashFromError(error) ?? submittedHash;
    throw new ChatSendError(
      hash
        ? `${base} Transaction ${hash} was submitted but confirmation was not observed. Its stable action id prevents a duplicate letter; check that transaction before retrying.`
        : base,
      hash,
    );
  }
}
