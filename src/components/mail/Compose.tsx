"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { validateAndParseAddress } from "starknet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import AddressBookField from "@/components/address-book/AddressBookField";
import {
  loadAliases,
  resolveAliasInput,
  type AliasRecord,
} from "@/lib/aliases";
import type { CompositeAttachment, CompositePayload } from "@/lib/composite";
import {
  planCompositeSubmission,
  submissionStepLabel,
} from "@/lib/composite-submit";
import {
  createDraftAttachment,
  type CompositeDraft,
  type DraftAttachment,
  type InvoiceDraftToken,
  type TradeDraftFields,
} from "@/lib/drafts";
import {
  encodeEnvelope,
  envelopeByteLength,
  type EnvelopeType,
} from "@/lib/envelope";
import {
  claimEscrowOperation,
  confirmEscrowOperation,
  loadEscrowState,
  markEscrowOperationOutcome,
  markEscrowOperationSubmitted,
  parseEscrowFundPayload,
  recordEscrowFund,
  releaseEscrowOperation,
  type EscrowFundPayload,
} from "@/lib/escrow";
import { buildEscrowFundActions } from "@/lib/escrow-actions";
import { ensureLocalnetMailEscrowTicket } from "@/app/rfq/localnet-private-intents";
import { authorizeStrk20ValueAction } from "@/lib/mainnet-safety";
import {
  deriveKeypair,
  encryptMailForRecipients,
  MAX_MULTI_RECIPIENTS,
  projectEncryptedMailSize,
  publicKeyFromFelts,
  type EncryptedMailRecord,
} from "@/lib/mail";
import { parseOptionalStrkAmount } from "@/lib/mail-actions";
import { createMailSenderAuth, type MailSenderAuth } from "@/lib/mail-auth";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import { randomConversationId } from "@/lib/mail-thread";
import {
  formatBaseUnits,
  parseDecimalToBaseUnits,
  type AcceptPayload,
  type OfferPayload,
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  computeActionId,
  APP20_HELPER_FUNDING_BASE_UNITS,
  assertPrivateStrk20BatchBalance,
  strk20ErrorMessage,
  submitActions,
  submitMail,
  submitMemoTransfer,
  transactionHashFromError,
  transactionStateFromError,
} from "@/lib/strk20";
import {
  addrSTRK,
  LOCALNET_PROVIDER_INDEX,
  localnetUsdcToken,
  localnetWalletEnabled,
  myFrontendProviders,
  strk20PoolForProviderIndex,
} from "@/utils/constants";
import { ProvingProgress } from "./OperationProgress";
import styles from "./mail.module.css";

export type SentEnvelope = {
  documentId: string;
  draftId: string;
  type: EnvelopeType;
  payload: unknown;
  plaintext: string;
  record: EncryptedMailRecord;
  transactionHash: string;
  transactionHashes: string[];
  recipientCount: number;
  recipients: string[];
  deliveryState: "confirmed";
};

type ComposeProps = {
  draft: CompositeDraft;
  helperAddress: string | null;
  escrowAddress: string | null;
  escrowEnabled: boolean;
  mailSeed: Uint8Array | null;
  keyReady: boolean;
  networkName: string;
  onDraftChange: (draft: CompositeDraft) => void;
  onDeleteDraft: (draftId: string) => void;
  onSent: (message: SentEnvelope) => void;
};

type SendState = {
  kind: "idle" | "lookup" | "encrypting" | "proving" | "ok" | "error";
  message?: string;
  transactionHashes?: string[];
  startedAt?: number;
  step?: number;
  totalSteps?: number;
};

/** Length-stable stand-in used only for ciphertext budget preflight. */
export const COMPOSE_PREVIEW_SENDER_AUTH: MailSenderAuth = {
  version: 1,
  mailboxPublicKey: "0".repeat(64),
  authPublicKey: "0".repeat(64),
  signature: "0".repeat(128),
};

export type ComposerInvoiceToken = Readonly<{
  symbol: InvoiceDraftToken;
  address: string;
  decimals: 18 | 6;
}>;

/** Public networks stay STRK-only; the configured dev wallet adds local USDC. */
export function composerInvoiceTokenOptions(
  providerIndex: number,
  configuredLocalUsdc = localnetUsdcToken,
): readonly ComposerInvoiceToken[] {
  const options: ComposerInvoiceToken[] = [
    { symbol: "STRK", address: addrSTRK, decimals: 18 },
  ];
  if (providerIndex === LOCALNET_PROVIDER_INDEX) {
    try {
      if (BigInt(configuredLocalUsdc) > 0n) {
        options.push({
          symbol: "USDC",
          address: validateAndParseAddress(configuredLocalUsdc),
          decimals: 6,
        });
      }
    } catch {
      // Missing or malformed local configuration stays STRK-only.
    }
  }
  return Object.freeze(options.map((option) => Object.freeze(option)));
}

type ComposePreflight = {
  recipientCount: number;
  plaintextBytes: number;
  ciphertextFelts: number;
  maxCiphertextFelts: number;
  maxPlaintextBytes: number;
  maxRecipientsForCurrentDocument: number;
  fits: boolean;
  walletPrompts: number;
  transactions: number;
  valueMoves: string[];
  noValueAttachments: string[];
};

function expiryFromHours(value: string, escrow = false): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") {
    if (escrow) throw new Error("Escrow requires a future fill deadline.");
    return 0;
  }
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8_760) {
    throw new Error("Expiry must be 0–8760 hours.");
  }
  return Math.floor(Date.now() / 1_000 + hours * 3_600);
}

function splitRecipientEntries(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function attachmentLabel(type: DraftAttachment["type"]): string {
  switch (type) {
    case "payment":
      return "Private payment";
    case "offer":
      return "OTC offer";
    case "payment_request":
      return "Invoice";
    case "escrow_fund":
      return "Escrow fund";
  }
}

function AttachmentShell({
  type,
  children,
  onRemove,
}: {
  type: DraftAttachment["type"];
  children: ReactNode;
  onRemove: () => void;
}) {
  return (
    <section className={styles.compositeAttachment}>
      <header className={styles.attachmentHeading}>
        <div>
          <span className={styles.fieldBadge}>ATTACHMENT</span>
          <strong>{attachmentLabel(type)}</strong>
        </div>
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      </header>
      {children}
    </section>
  );
}

function TradeFields({
  attachment,
  escrow,
  update,
}: {
  attachment: Extract<DraftAttachment, { type: "offer" | "escrow_fund" }>;
  escrow: boolean;
  update: (fields: Partial<TradeDraftFields>) => void;
}) {
  return (
    <div className={styles.dealFields}>
      <p className={styles.termsPreview}>
        {escrow
          ? "Deposit leg A in the escrow contract; the counterparty deposits leg B before receiving it."
          : "Send bilateral quoted terms. Sending the offer moves no asset."}
      </p>
      <label className={styles.field}>
        <span>{escrow ? "Leg A STRK to deposit" : "STRK to buy"}</span>
        <input
          value={attachment.giveStrk}
          onChange={(event) => update({ giveStrk: event.target.value })}
          inputMode="decimal"
          placeholder="0.01"
          required
        />
      </label>
      <label className={styles.field}>
        <span>Quoted token symbol</span>
        <input
          value={attachment.wantSymbol}
          onChange={(event) => update({ wantSymbol: event.target.value })}
          placeholder="USDC"
          maxLength={32}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Quoted token address</span>
        <input
          value={attachment.wantAddress}
          onChange={(event) => update({ wantAddress: event.target.value })}
          placeholder="0x…"
          required
        />
      </label>
      <div className={styles.amountPair}>
        <label className={styles.field}>
          <span>Token decimals</span>
          <input
            value={attachment.wantDecimals}
            onChange={(event) => update({ wantDecimals: event.target.value })}
            inputMode="numeric"
            required
          />
        </label>
        <label className={styles.field}>
          <span>Quoted amount</span>
          <input
            value={attachment.wantAmount}
            onChange={(event) => update({ wantAmount: event.target.value })}
            inputMode="decimal"
            placeholder="2.50"
            required
          />
        </label>
      </div>
      <label className={styles.field}>
        <span>Note (optional)</span>
        <input
          value={attachment.note}
          onChange={(event) => update({ note: event.target.value })}
          maxLength={512}
        />
      </label>
      <label className={styles.field}>
        <span>
          {escrow ? "Fill deadline in hours" : "Expiry in hours (0 = none)"}
        </span>
        <input
          value={attachment.expiryHours}
          onChange={(event) => update({ expiryHours: event.target.value })}
          inputMode="decimal"
          required
        />
      </label>
      <p className={styles.dealDisclosure}>
        {escrow ? (
          <>
            Funding withdraws leg A into the contract, so escrow token amounts
            and contract activity are public. Funding and encrypted delivery are
            two transactions because the pool permits one external invoke per
            transaction. This is not a single-transaction atomic swap. Escrow
            stays off the mainnet scoring path until reviewed.
          </>
        ) : (
          <>
            Any quoted non-STRK leg remains a promise. No escrow or atomic
            settlement is claimed.
          </>
        )}
      </p>
    </div>
  );
}

export default function Compose({
  draft: initialDraft,
  helperAddress,
  escrowAddress,
  escrowEnabled,
  mailSeed,
  keyReady,
  networkName,
  onDraftChange,
  onDeleteDraft,
  onSent,
}: ComposeProps) {
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const senderAddress = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const recipientInputRef = useRef<HTMLTextAreaElement>(null);
  const [aliases, setAliases] = useState<AliasRecord[]>([]);
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });
  const submitEpochRef = useRef(0);
  const mailboxFromSeed = useMemo(
    () => (mailSeed ? deriveKeypair(mailSeed) : null),
    [mailSeed],
  );

  useEffect(() => {
    submitEpochRef.current += 1;
    draftRef.current = initialDraft;
    setDraft(initialDraft);
    setSendState({ kind: "idle" });
    const frame = requestAnimationFrame(() =>
      recipientInputRef.current?.focus(),
    );
    return () => {
      submitEpochRef.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [initialDraft.id]);

  useEffect(() => {
    if (!senderAddress) {
      setAliases([]);
      return;
    }
    setAliases(loadAliases(window.localStorage, senderAddress));
  }, [senderAddress]);

  const recipientEntries = useMemo(
    () => splitRecipientEntries(draft.recipient),
    [draft.recipient],
  );
  const hasEscrow = draft.attachments.some(
    (attachment) => attachment.type === "escrow_fund",
  );
  const hasAnyAttachment = draft.attachments.length > 0;
  const invoiceTokenOptions = composerInvoiceTokenOptions(providerIndex);

  function updateDraft(
    update:
      Partial<CompositeDraft> | ((current: CompositeDraft) => CompositeDraft),
  ) {
    const current = draftRef.current;
    const next =
      typeof update === "function"
        ? update(current)
        : { ...current, ...update };
    const saved = { ...next, updatedAt: Date.now() };
    draftRef.current = saved;
    setDraft(saved);
    onDraftChange(saved);
  }

  function updateAttachment(
    type: DraftAttachment["type"],
    update: (attachment: DraftAttachment) => DraftAttachment,
  ) {
    updateDraft((current) => ({
      ...current,
      attachments: current.attachments.map((attachment) =>
        attachment.type === type ? update(attachment) : attachment,
      ),
    }));
  }

  function addAttachment(type: DraftAttachment["type"]) {
    if (draft.attachments.some((attachment) => attachment.type === type))
      return;
    const attachment =
      type === "payment"
        ? createDraftAttachment("payment")
        : type === "offer"
          ? createDraftAttachment("offer")
          : type === "payment_request"
            ? createDraftAttachment("payment_request")
            : createDraftAttachment("escrow_fund");
    updateDraft({ attachments: [...draft.attachments, attachment] });
  }

  function removeAttachment(type: DraftAttachment["type"]) {
    updateDraft({
      attachments: draft.attachments.filter(
        (attachment) => attachment.type !== type,
      ),
    });
  }

  let disabledReason = "";
  if (!helperAddress) {
    disabledReason = `Mail is unavailable on ${networkName} in this deployment. Switch network or try again later.`;
  } else if (!isConnected || !walletAccount || !senderAddress) {
    disabledReason = "Connect a privacy-enabled wallet before sending mail.";
  } else if (!isStrk20Capable) {
    disabledReason =
      "This wallet does not expose the dapp-facing STRK20 Wallet API Mail requires. See the wallet capability diagnostic.";
  } else if (!keyReady) {
    disabledReason = "Load this device's mail key before sending.";
  } else if (hasEscrow && (!escrowEnabled || !escrowAddress)) {
    disabledReason =
      networkName === "MAINNET"
        ? "Escrow is disabled on Mainnet because it has not been independently reviewed; it stays off the mainnet scoring path until review."
        : `No reviewed escrow deployment is configured on ${networkName}.`;
  } else if (hasEscrow && (!mailSeed || !chainId)) {
    disabledReason = "Reload the mailbox seed before funding escrow.";
  }

  const sendPending = ["lookup", "encrypting", "proving"].includes(
    sendState.kind,
  );

  function resolvedRecipients(): string[] {
    if (!recipientEntries.length)
      throw new Error("Add at least one recipient.");
    if (recipientEntries.length > MAX_MULTI_RECIPIENTS) {
      throw new Error(
        `Multi-recipient mail supports at most ${MAX_MULTI_RECIPIENTS} recipients within the 140-felt ciphertext cap.`,
      );
    }
    const addresses = recipientEntries.map((entry) =>
      validateAndParseAddress(resolveAliasInput(aliases, entry)),
    );
    const fingerprints = new Set<string>();
    for (const address of addresses) {
      const fingerprint = BigInt(address).toString(16);
      if (fingerprints.has(fingerprint)) {
        throw new Error("Each recipient address must be unique.");
      }
      fingerprints.add(fingerprint);
    }
    return addresses;
  }

  function tradePayload(
    attachment: Extract<DraftAttachment, { type: "offer" | "escrow_fund" }>,
    ticketAddress?: string,
  ): OfferPayload | EscrowFundPayload {
    if (!senderAddress) {
      throw new Error("Connect the wallet that owns this request or offer.");
    }
    const decimals = Number(attachment.wantDecimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error(
        "Quoted token decimals must be an integer from 0 to 255.",
      );
    }
    const legA = {
      token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
      amount: parseDecimalToBaseUnits(attachment.giveStrk, 18),
    };
    const legB = {
      token: {
        symbol: attachment.wantSymbol.trim(),
        address: validateAndParseAddress(attachment.wantAddress.trim()),
        decimals,
      },
      amount: parseDecimalToBaseUnits(attachment.wantAmount, decimals),
    };
    if (!legB.token.symbol) throw new Error("Want-token symbol is required.");

    if (attachment.type === "escrow_fund") {
      if (!escrowAddress || !escrowEnabled || !senderAddress) {
        throw new Error(
          disabledReason || "Escrow is unavailable on this network.",
        );
      }
      const payload = parseEscrowFundPayload({
        dealId: attachment.dealId,
        escrowAddress,
        maker: validateAndParseAddress(senderAddress),
        legA,
        legB,
        deadline: expiryFromHours(attachment.expiryHours, true),
        // Preflight uses the same-width deal felt; submission replaces it with
        // the permissionlessly deployed V2 ticket address.
        ticket: ticketAddress ?? attachment.dealId,
        ...(attachment.note.trim() ? { note: attachment.note.trim() } : {}),
      });
      if (!payload) {
        throw new Error(
          "Escrow legs require different tokens and valid u128 amounts.",
        );
      }
      return payload;
    }

    return {
      dealId: attachment.dealId,
      give: legA,
      want: legB,
      offerer: validateAndParseAddress(senderAddress),
      expiresAt: expiryFromHours(attachment.expiryHours),
      ...(attachment.note.trim() ? { note: attachment.note.trim() } : {}),
    };
  }

  function buildDocument(
    recipientAddress: string,
    ticketAddress?: string,
    preview = false,
  ): {
    type: EnvelopeType;
    payload: unknown;
    composite: CompositePayload | null;
    payment: AcceptPayload | null;
    escrow: EscrowFundPayload | null;
  } {
    if (!senderAddress) {
      throw new Error("Connect the wallet that owns this document.");
    }
    const attachments: CompositeAttachment[] = [];
    let payment: AcceptPayload | null = null;
    let escrow: EscrowFundPayload | null = null;

    for (const attachment of draft.attachments) {
      if (attachment.type === "payment") {
        const amount = parseOptionalStrkAmount(attachment.amount);
        if (amount === undefined)
          throw new Error("Enter the STRK amount to attach.");
        payment = {
          dealId: attachment.paymentId,
          transfer: {
            token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
            amount: amount.toString(),
            to: recipientAddress,
          },
        };
        attachments.push({ type: "payment", payload: payment });
      } else if (attachment.type === "payment_request") {
        const token = invoiceTokenOptions.find(
          (option) => option.symbol === attachment.token,
        );
        if (!token) {
          throw new Error(
            "USDC invoices are available only on the configured localnet demo.",
          );
        }
        const payload: PaymentRequestPayload = {
          requestId: attachment.requestId,
          token,
          amount: parseDecimalToBaseUnits(attachment.amount, token.decimals),
          requester: validateAndParseAddress(senderAddress),
          expiresAt: expiryFromHours(attachment.expiryHours),
          ...(attachment.memo.trim() ? { memo: attachment.memo.trim() } : {}),
        };
        attachments.push({ type: "payment_request", payload });
      } else {
        const payload = tradePayload(attachment, ticketAddress);
        if (attachment.type === "escrow_fund") {
          escrow = payload as EscrowFundPayload;
          attachments.push({ type: "escrow_fund", payload: escrow });
        } else {
          attachments.push({ type: "offer", payload: payload as OfferPayload });
        }
      }
    }

    if (!draft.body.trim() && attachments.length === 0) {
      throw new Error("Write a message or add at least one attachment.");
    }
    const conversationId = draft.conversationId || randomConversationId();
    const inReplyTo = draft.inReplyTo || "";
    let senderAuth: MailSenderAuth | undefined;
    if (mailSeed) {
      senderAuth = preview
        ? COMPOSE_PREVIEW_SENDER_AUTH
        : createMailSenderAuth(
            mailSeed,
            (mailboxFromSeed ?? deriveKeypair(mailSeed)).publicKey,
            {
              documentId: draft.documentId,
              conversationId,
              inReplyTo,
              body: draft.body,
            },
          );
    }
    const conversationFields = {
      documentId: draft.documentId,
      conversationId,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(senderAuth ? { senderAuth } : {}),
    };
    if (attachments.length === 0) {
      return {
        type: "text",
        payload: { body: draft.body, ...conversationFields },
        composite: null,
        payment: null,
        escrow: null,
      };
    }
    const composite: CompositePayload = {
      documentId: draft.documentId,
      body: draft.body,
      attachments,
      conversationId,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(senderAuth ? { senderAuth } : {}),
    };
    return {
      type: "composite",
      payload: composite,
      composite,
      payment,
      escrow,
    };
  }

  const { preflight, preflightIssue } = useMemo(() => {
    let nextPreflight: ComposePreflight | null = null;
    let nextIssue = "";
    try {
      const recipients = resolvedRecipients();
      if (hasAnyAttachment && recipients.length !== 1) {
        throw new Error(
          "Attachments require exactly one counterparty; body-only messages may have multiple recipients.",
        );
      }
      const document = buildDocument(recipients[0], undefined, true);
      const plaintextBytes = envelopeByteLength(
        document.type,
        document.payload,
      );
      const size = projectEncryptedMailSize(plaintextBytes, recipients.length);
      let maxRecipientsForCurrentDocument = 0;
      for (let count = 1; count <= MAX_MULTI_RECIPIENTS; count += 1) {
        if (projectEncryptedMailSize(plaintextBytes, count).fits) {
          maxRecipientsForCurrentDocument = count;
        }
      }
      const valueMoves: string[] = [];
      if (document.payment) {
        valueMoves.push(
          `${formatBaseUnits(document.payment.transfer.amount, 18)} STRK (${document.payment.transfer.amount} base units) privately to ${document.payment.transfer.to} in the message transaction`,
        );
      }
      if (document.escrow) {
        valueMoves.push(
          `${formatBaseUnits(document.escrow.legA.amount, 18)} STRK (${document.escrow.legA.amount} base units) deposited into escrow ${document.escrow.escrowAddress} before the message transaction`,
        );
      }
      const noValueAttachments = document.composite
        ? document.composite.attachments
            .filter(
              (attachment) =>
                attachment.type === "offer" ||
                attachment.type === "payment_request",
            )
            .map((attachment) =>
              attachment.type === "offer"
                ? "OTC offer: terms only; sending does not settle it"
                : "Invoice: request only; sending does not pay it",
            )
        : [];
      const transactions = document.escrow ? 2 : 1;
      nextPreflight = {
        recipientCount: recipients.length,
        plaintextBytes,
        ciphertextFelts: size.ciphertextFelts,
        maxCiphertextFelts: size.maxCiphertextFelts,
        maxPlaintextBytes: size.maxPlaintextBytes,
        maxRecipientsForCurrentDocument,
        fits: size.fits,
        walletPrompts: transactions,
        transactions,
        valueMoves,
        noValueAttachments,
      };
      if (!size.fits) {
        nextIssue = `Remove at least ${plaintextBytes - size.maxPlaintextBytes} encoded byte${plaintextBytes - size.maxPlaintextBytes === 1 ? "" : "s"}; nothing can be submitted at this size.`;
      }
    } catch (error: unknown) {
      nextIssue =
        error instanceof Error
          ? error.message
          : "Complete the message fields to calculate its exact ciphertext budget.";
    }
    return { preflight: nextPreflight, preflightIssue: nextIssue };
  }, [
    aliases,
    draft,
    escrowAddress,
    escrowEnabled,
    hasAnyAttachment,
    mailSeed,
    mailboxFromSeed,
    senderAddress,
  ]);

  const sendDisabled =
    Boolean(disabledReason) || sendPending || preflight?.fits === false;
  const sendButtonLabel = sendPending
    ? "Preparing private transaction…"
    : preflight?.valueMoves.length
      ? preflight.transactions === 2
        ? `Approve ${preflight.valueMoves.length} value move${preflight.valueMoves.length === 1 ? "" : "s"} in 2 transactions`
        : `Send ${preflight.valueMoves[0].split(" (")[0]} privately + message`
      : "Send encrypted message";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitEpoch = submitEpochRef.current;
    const isCurrentSubmit = () => submitEpoch === submitEpochRef.current;
    if (
      !helperAddress ||
      !walletAccount ||
      !senderAddress ||
      !isStrk20Capable ||
      !keyReady
    ) {
      setSendState({
        kind: "error",
        message: disabledReason || "Mail sending is not ready.",
      });
      return;
    }

    let escrowReservation:
      { dealId: string; transactionHash?: string } | undefined;
    let fundConfirmedHash: string | undefined;
    let documentSubmittedHash: string | undefined;
    const transactionHashes: string[] = [];
    try {
      const recipientAddresses = resolvedRecipients();
      if (hasAnyAttachment && recipientAddresses.length !== 1) {
        throw new Error(
          "Attachments are bilateral. Address exactly one counterparty; body-only documents may have multiple recipients.",
        );
      }
      const escrowAttachment = draft.attachments.find(
        (attachment) => attachment.type === "escrow_fund",
      );
      const ticketAddress = escrowAttachment
        ? await ensureLocalnetMailEscrowTicket(escrowAttachment.dealId)
        : undefined;
      const document = buildDocument(recipientAddresses[0], ticketAddress);
      const plaintextBytes = envelopeByteLength(
        document.type,
        document.payload,
      );
      const projectedSize = projectEncryptedMailSize(
        plaintextBytes,
        recipientAddresses.length,
      );
      if (!projectedSize.fits) {
        throw new Error(
          `This message would use ${projectedSize.ciphertextFelts} / ${projectedSize.maxCiphertextFelts} ciphertext felts. Remove at least ${plaintextBytes - projectedSize.maxPlaintextBytes} encoded byte${plaintextBytes - projectedSize.maxPlaintextBytes === 1 ? "" : "s"}. Nothing was submitted.`,
        );
      }
      const encodedDocument = encodeEnvelope(document.type, document.payload);
      const provider = myFrontendProviders[providerIndex];
      const policy = () => {
        if (!selectedWallet)
          throw new Error("Wallet policy context is missing.");
        assertWalletOperationPolicy(
          selectedWallet,
          providerIndex as 0 | 2 | 3,
          "mail",
        );
      };
      policy();
      const poolAddress = strk20PoolForProviderIndex(providerIndex);
      if ((document.payment || document.escrow) && !poolAddress) {
        throw new Error("The STRK20 pool is not configured for this network.");
      }
      setSendState({
        kind: "lookup",
        message: document.payment
          ? "Checking private STRK for the payment plus mail-helper funding…"
          : "Checking private STRK for mail-helper funding…",
        step: 1,
        totalSteps: 1,
      });
      await assertPrivateStrk20BatchBalance(
        walletAccount,
        addrSTRK,
        document.payment
          ? [document.payment.transfer.amount, APP20_HELPER_FUNDING_BASE_UNITS]
          : [APP20_HELPER_FUNDING_BASE_UNITS],
      );
      if (document.payment && poolAddress) {
        setSendState({
          kind: "lookup",
          message:
            "Reading the live pool fee and public fee balance before the attached payment…",
          step: 1,
          totalSteps: 1,
        });
        await authorizeStrk20ValueAction({
          provider,
          poolAddress,
          accountAddress: senderAddress,
          network: networkName,
          action: "Attached private payment",
          amount: BigInt(document.payment.transfer.amount),
        });
      }
      const steps = document.composite
        ? planCompositeSubmission(document.composite)
        : [
            {
              kind: "send_document" as const,
              label: "sending document" as const,
              idempotencyKey: computeActionId(
                "composite-document",
                draft.documentId,
              ),
            },
          ];

      setSendState({
        kind: "lookup",
        message: `Looking up ${recipientAddresses.length} recipient mail key${recipientAddresses.length === 1 ? "" : "s"}…`,
        step: 1,
        totalSteps: steps.length,
      });
      const registeredKeys = await Promise.all(
        recipientAddresses.map(async (address, index) => {
          const registeredKey = await provider.callContract({
            contractAddress: helperAddress,
            entrypoint: "get_pubkey",
            calldata: [address],
          });
          if (
            registeredKey.length !== 2 ||
            (BigInt(registeredKey[0]) === 0n && BigInt(registeredKey[1]) === 0n)
          ) {
            throw new Error(
              `Recipient ${index + 1} has not registered a mail public key.`,
            );
          }
          return publicKeyFromFelts(registeredKey);
        }),
      );

      setSendState({
        kind: "encrypting",
        message:
          "Sealing the body and every attachment as one document on this device…",
        step: 1,
        totalSteps: steps.length,
      });
      const record = await encryptMailForRecipients(
        registeredKeys,
        encodedDocument,
      );
      const startedAt = Date.now();

      if (document.escrow) {
        if (
          providerIndex !== LOCALNET_PROVIDER_INDEX ||
          !localnetWalletEnabled
        ) {
          throw new Error(
            "Escrow funding is available only on build-gated localnet.",
          );
        }
        if (!chainId || !escrowAddress) {
          throw new Error("Connect the escrow mailbox account first.");
        }
        const stored = recordEscrowFund(
          window.localStorage,
          chainId,
          senderAddress,
          document.escrow,
        );
        const existingFund = stored.operations.fund;
        if (
          existingFund?.state === "confirmed" &&
          existingFund.transactionHash
        ) {
          fundConfirmedHash = existingFund.transactionHash;
          transactionHashes.push(existingFund.transactionHash);
        } else if (existingFund && existingFund.state !== "reverted") {
          throw new Error(
            existingFund.transactionHash
              ? `Escrow funding ${existingFund.transactionHash} was already submitted. Verify it before retrying; Mail will not issue another Fund.`
              : "Escrow funding is already reserved. Mail will not risk a second Fund; reopen after checking the prior wallet request.",
          );
        } else {
          if (!poolAddress) {
            throw new Error(
              "The STRK20 pool is not configured for this network.",
            );
          }
          await authorizeStrk20ValueAction({
            provider,
            poolAddress,
            accountAddress: senderAddress,
            network: networkName,
            action: "Escrow fund",
            amount: BigInt(document.escrow.legA.amount),
          });
          claimEscrowOperation(
            window.localStorage,
            chainId,
            senderAddress,
            document.escrow.dealId,
            "fund",
          );
          escrowReservation = {
            dealId: document.escrow.dealId,
          };
          setSendState({
            kind: "proving",
            message: submissionStepLabel(steps[0], 0, steps.length),
            startedAt,
            step: 1,
            totalSteps: steps.length,
            transactionHashes,
          });
          const fundResult = await submitActions(
            walletAccount,
            provider,
            buildEscrowFundActions({
              escrowAddress,
              recoveryAddress: senderAddress,
              ticketAddress: document.escrow.ticket!,
              dealId: document.escrow.dealId,
              token: document.escrow.legA.token.address,
              amount: document.escrow.legA.amount,
              counterToken: document.escrow.legB.token.address,
              counterAmount: document.escrow.legB.amount,
              deadline: document.escrow.deadline,
            }),
            {
              policy,
              onSubmitted: (transactionHash) => {
                escrowReservation!.transactionHash = transactionHash;
                markEscrowOperationSubmitted(
                  window.localStorage,
                  chainId,
                  senderAddress,
                  document.escrow!.dealId,
                  "fund",
                  transactionHash,
                );
                setSendState({
                  kind: "proving",
                  message: `${submissionStepLabel(steps[0], 0, steps.length)} · submitted, waiting for confirmation`,
                  startedAt: Date.now(),
                  step: 1,
                  totalSteps: steps.length,
                  transactionHashes: [transactionHash],
                });
              },
            },
          );
          confirmEscrowOperation(
            window.localStorage,
            chainId,
            senderAddress,
            document.escrow.dealId,
            "fund",
            fundResult.transactionHash,
          );
          fundConfirmedHash = fundResult.transactionHash;
          transactionHashes.push(fundResult.transactionHash);
        }
      }

      const sendStepIndex = steps.length - 1;
      setSendState({
        kind: "proving",
        message: submissionStepLabel(
          steps[sendStepIndex],
          sendStepIndex,
          steps.length,
        ),
        startedAt: Date.now(),
        step: sendStepIndex + 1,
        totalSteps: steps.length,
        transactionHashes,
      });
      const options = {
        onSubmitted: (transactionHash: string) => {
          documentSubmittedHash = transactionHash;
          setSendState({
            kind: "proving" as const,
            message: `${submissionStepLabel(steps[sendStepIndex], sendStepIndex, steps.length)} · submitted, waiting for confirmation`,
            startedAt: Date.now(),
            step: sendStepIndex + 1,
            totalSteps: steps.length,
            transactionHashes: [...transactionHashes, transactionHash],
          });
        },
      };
      const mailActionId = computeActionId(
        "composite-document",
        draft.documentId,
      );
      const mailResult = document.payment
        ? await submitMemoTransfer(
            {
              account: walletAccount,
              provider,
              helperAddress,
              recoveryAddress: senderAddress,
              tokenAddress: addrSTRK,
              recipient: recipientAddresses[0],
              amount: document.payment.transfer.amount,
              record,
              actionId: mailActionId,
              helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
              policy,
            },
            options,
          )
        : await submitMail(
            {
              account: walletAccount,
              provider,
              helperAddress,
              recoveryAddress: senderAddress,
              tokenAddress: addrSTRK,
              record,
              actionId: mailActionId,
              helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
              policy,
            },
            options,
          );
      transactionHashes.push(mailResult.transactionHash);
      onSent({
        documentId: draft.documentId,
        draftId: draft.id,
        type: document.type,
        payload: document.payload,
        plaintext: draft.body,
        record,
        transactionHash: mailResult.transactionHash,
        transactionHashes,
        recipientCount: recipientAddresses.length,
        recipients: recipientAddresses,
        deliveryState: "confirmed",
      });
      if (!isCurrentSubmit()) return;
      setSendState({
        kind: "ok",
        message:
          steps.length === 2
            ? "Escrow funding and the composite document are confirmed in two transactions."
            : document.payment
              ? "The composite document and private STRK payment are confirmed in one transaction."
              : `The document is confirmed for ${recipientAddresses.length} recipient${recipientAddresses.length === 1 ? "" : "s"}.`,
        transactionHashes,
        step: steps.length,
        totalSteps: steps.length,
      });
    } catch (error: unknown) {
      const outcome = transactionStateFromError(error);
      const escrowHash =
        transactionHashFromError(error) ?? escrowReservation?.transactionHash;
      if (
        escrowReservation &&
        escrowHash &&
        outcome &&
        chainId &&
        senderAddress
      ) {
        try {
          markEscrowOperationOutcome(
            window.localStorage,
            chainId,
            senderAddress,
            escrowReservation.dealId,
            "fund",
            escrowHash,
            outcome,
          );
        } catch {
          // A transaction hash exists, so retaining the reservation is safer
          // than risking a duplicate escrow deposit.
        }
      } else if (escrowReservation && !escrowHash && chainId && senderAddress) {
        releaseEscrowOperation(
          window.localStorage,
          chainId,
          senderAddress,
          escrowReservation.dealId,
          "fund",
        );
      }
      const base = strk20ErrorMessage(error);
      const message = documentSubmittedHash
        ? `${base} The document transaction ${documentSubmittedHash} was submitted but confirmation was not observed. Its stable action id prevents a duplicate document or payment; check that transaction before retrying.`
        : fundConfirmedHash
          ? `${base} Escrow funding ${fundConfirmedHash} is already confirmed. The document and any private payment were not submitted. Retry this unchanged draft; Mail will skip funding.`
          : escrowReservation?.transactionHash
            ? `${base} Escrow funding ${escrowReservation.transactionHash} was submitted and Mail will not fund it again while its outcome is unknown. The document was not submitted; verify funding before retrying.`
            : base;
      if (isCurrentSubmit()) {
        setSendState({
          kind: "error",
          message,
          transactionHashes: [
            ...(fundConfirmedHash ? [fundConfirmedHash] : []),
            ...(documentSubmittedHash ? [documentSubmittedHash] : []),
          ],
        });
      }
    }
  }

  return (
    <section className={styles.composerSheet} aria-labelledby="compose-title">
      <div className={styles.composerHeading}>
        <div>
          <p className={styles.kicker}>LOCAL BROWSER DRAFT</p>
          <h2 id="compose-title">New document</h2>
        </div>
        <span className={styles.sheetClip} aria-hidden="true">
          NOT ENCRYPTED AT REST
        </span>
      </div>

      <div className={styles.disclosureGrid}>
        <p>
          <strong>Stored locally</strong>
          Draft, body, recipient identities, aliases, Sent copies, and
          attachment terms stay as readable browser storage until cleared.
        </p>
        <p data-tone="public">
          <strong>Public</strong>
          Recipient count, ciphertext size, helper and pool activity, and
          timing. Shield and unshield legs are public.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <fieldset className={styles.composeFieldset} disabled={sendPending}>
          <AddressBookField
            className={styles.field}
            selfAddress={senderAddress}
            inputAriaLabel="To"
            multiline
            inputRef={recipientInputRef}
            label={
              <>
                To
                <em className={styles.fieldBadge}>COUNT PUBLIC</em>
              </>
            }
            value={draft.recipient}
            onChange={(recipient) => updateDraft({ recipient })}
            placeholder={
              hasAnyAttachment
                ? "One counterparty address or saved contact"
                : "One address per line"
            }
            rows={hasAnyAttachment ? 2 : 3}
            required
            hintClassName={styles.fieldHint}
            hint={
              <>
                {recipientEntries.length} / {MAX_MULTI_RECIPIENTS} recipients.
                Attachments are bilateral; a body-only letter can go to several.
              </>
            }
          />

          <label className={styles.field}>
            <span>Message</span>
            <textarea
              className={styles.letterInput}
              value={draft.body}
              onChange={(event) => updateDraft({ body: event.target.value })}
              placeholder="Write a private message, or leave blank when sending attachments only"
              rows={8}
              maxLength={4_096}
            />
            <small>{draft.body.length} / 4096 characters</small>
          </label>

          <section
            className={styles.attachmentTray}
            aria-labelledby="attach-title"
          >
            <header>
              <div>
                <span className={styles.sidebarLabel}>OPTIONAL</span>
                <strong id="attach-title">Add attachments</strong>
              </div>
              <span>{draft.attachments.length} / 4</span>
            </header>
            <div className={styles.attachmentButtons}>
              {(
                ["payment", "offer", "payment_request", "escrow_fund"] as const
              ).map((type) => {
                const attached = draft.attachments.some(
                  (attachment) => attachment.type === type,
                );
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={attached}
                    aria-pressed={attached}
                    onClick={() => addAttachment(type)}
                  >
                    {attached ? "✓" : "+"} {attachmentLabel(type)}
                  </button>
                );
              })}
            </div>
            <p>
              Everything you add goes into this one document. Adding an
              attachment never clears your text or the others.
            </p>
          </section>

          {draft.attachments.map((attachment) => {
            if (attachment.type === "payment") {
              return (
                <AttachmentShell
                  key={attachment.type}
                  type={attachment.type}
                  onRemove={() => removeAttachment(attachment.type)}
                >
                  <label className={styles.field}>
                    <span>Private STRK amount</span>
                    <input
                      value={attachment.amount}
                      onChange={(event) =>
                        updateAttachment("payment", (current) => ({
                          ...(current as typeof attachment),
                          amount: event.target.value,
                        }))
                      }
                      inputMode="decimal"
                      placeholder="0.01"
                      required
                    />
                    <small>
                      The private transfer and mail helper invoke share the
                      document transaction. Timing and pool activity remain
                      public.
                    </small>
                  </label>
                </AttachmentShell>
              );
            }
            if (attachment.type === "payment_request") {
              return (
                <AttachmentShell
                  key={attachment.type}
                  type={attachment.type}
                  onRemove={() => removeAttachment(attachment.type)}
                >
                  <div className={styles.dealFields}>
                    <label className={styles.field}>
                      <span>Invoice token</span>
                      <select
                        aria-label="Invoice token"
                        value={attachment.token}
                        onChange={(event) =>
                          updateAttachment("payment_request", (current) => ({
                            ...(current as typeof attachment),
                            token: event.target.value as InvoiceDraftToken,
                          }))
                        }
                      >
                        {invoiceTokenOptions.map((option) => (
                          <option key={option.symbol} value={option.symbol}>
                            {option.symbol}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>{attachment.token} requested</span>
                      <input
                        value={attachment.amount}
                        onChange={(event) =>
                          updateAttachment("payment_request", (current) => ({
                            ...(current as typeof attachment),
                            amount: event.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder="0.01"
                        required
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Invoice memo (optional)</span>
                      <input
                        value={attachment.memo}
                        onChange={(event) =>
                          updateAttachment("payment_request", (current) => ({
                            ...(current as typeof attachment),
                            memo: event.target.value,
                          }))
                        }
                        maxLength={512}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Expiry in hours (0 = none)</span>
                      <input
                        value={attachment.expiryHours}
                        onChange={(event) =>
                          updateAttachment("payment_request", (current) => ({
                            ...(current as typeof attachment),
                            expiryHours: event.target.value,
                          }))
                        }
                        inputMode="decimal"
                        required
                      />
                    </label>
                    <p className={styles.dealDisclosure}>
                      Sending a request moves no asset. A later encrypted
                      payment claim is not proof; settlement is independently
                      verified.
                    </p>
                  </div>
                </AttachmentShell>
              );
            }
            return (
              <AttachmentShell
                key={attachment.type}
                type={attachment.type}
                onRemove={() => removeAttachment(attachment.type)}
              >
                <TradeFields
                  attachment={attachment}
                  escrow={attachment.type === "escrow_fund"}
                  update={(fields) =>
                    updateAttachment(attachment.type, (current) => ({
                      ...(current as typeof attachment),
                      ...fields,
                    }))
                  }
                />
              </AttachmentShell>
            );
          })}

          <section
            className={`${styles.composePreflight} ${
              preflight && !preflight.fits ? styles.composePreflightError : ""
            }`}
            aria-labelledby="compose-preflight-title"
          >
            <h3 id="compose-preflight-title">Review before wallet approval</h3>
            {preflight ? (
              <>
                <p>
                  <strong>
                    {preflight.walletPrompts} wallet approval
                    {preflight.walletPrompts === 1 ? "" : "s"} ·{" "}
                    {preflight.transactions} transaction
                    {preflight.transactions === 1 ? "" : "s"}
                  </strong>
                </p>
                <ul>
                  {preflight.valueMoves.length ? (
                    preflight.valueMoves.map((movement) => (
                      <li key={movement}>{movement}</li>
                    ))
                  ) : (
                    <li>No user-requested payment or attachment transfer.</li>
                  )}
                  <li>
                    The atomic mail batch temporarily withdraws 7 STRK base
                    units to the public helper address and returns those units
                    to your OPEN recovery note. The helper, amount, ciphertext
                    size, and timing remain public.
                  </li>
                  {preflight.noValueAttachments.map((attachment) => (
                    <li key={attachment}>{attachment}</li>
                  ))}
                  <li>
                    Wallet/network fees are additional and must be reviewed in
                    the connected wallet.
                  </li>
                  <li>
                    The configured RPC sees each recipient's public mailbox-key
                    lookup and is trusted to return the correct key. Verify key
                    fingerprints out-of-band before moving value.
                  </li>
                </ul>
                <p className={styles.ciphertextBudget}>
                  <strong>
                    {preflight.ciphertextFelts} / {preflight.maxCiphertextFelts}{" "}
                    ciphertext felts
                  </strong>
                  {" · "}
                  {preflight.plaintextBytes} encoded bytes · current document
                  fits at most {preflight.maxRecipientsForCurrentDocument}{" "}
                  recipient
                  {preflight.maxRecipientsForCurrentDocument === 1 ? "" : "s"}.
                </p>
              </>
            ) : (
              <p>
                Complete valid recipient and attachment fields to calculate the
                exact wallet count, value movement, and 140-felt budget.
              </p>
            )}
            {preflightIssue ? (
              <p className={styles.preflightIssue}>{preflightIssue}</p>
            ) : null}
          </section>
          {disabledReason ? (
            <p className={styles.notice}>{disabledReason}</p>
          ) : null}
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={sendDisabled}
          >
            {sendButtonLabel}
          </button>
          {/* Discarding the draft is not a second way to send it: it leaves the
              primary action's block and sits at its own weight. */}
          <div className={styles.composeFooter}>
            <button
              className={styles.deleteDraftButton}
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Delete this device-private draft? It has never been uploaded and cannot be restored.",
                  )
                ) {
                  onDeleteDraft(draft.id);
                }
              }}
            >
              Delete draft…
            </button>
          </div>
        </fieldset>
      </form>

      {sendState.step && sendState.totalSteps ? (
        <p className={styles.stepProgress} aria-live="polite">
          Step {sendState.step} of {sendState.totalSteps}
        </p>
      ) : null}
      <ProvingProgress
        active={sendState.kind === "proving"}
        startedAt={sendState.startedAt}
      />
      {sendState.message ? (
        <div
          className={`${styles.status} ${
            sendState.kind === "error" ? styles.statusError : ""
          }`}
          role={sendState.kind === "error" ? "alert" : "status"}
        >
          {sendState.message}
          {sendState.transactionHashes?.map((transactionHash, index) => (
            <span className={styles.mono} key={`${index}:${transactionHash}`}>
              TX {index + 1}: {transactionHash}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
