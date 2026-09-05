"use client";

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateAndParseAddress } from "starknet";
import { useActiveStarknetSession } from "@/app/active-session";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  restoreRfqLifecycle,
  type RfqLifecycleRecord,
} from "@/app/rfq/rfq-lifecycle";
import { createIndexedDbRfqStorage } from "@/app/rfq/rfq-storage";
import Compose, { type SentEnvelope } from "@/components/mail/Compose";
import Onboard from "@/components/mail/Onboard";
import { shortenFelt } from "@/components/mail/correspondent";
import type { AddressBookEntry } from "@/lib/address-book";
import { canonicalizeStarknetAddress, feltEquals } from "@/lib/addresses";
import { isBlankDraft, type CompositeDraft } from "@/lib/drafts";
import {
  conversationFieldsFromPayload,
  parseConversationId,
} from "@/lib/mail-thread";
import * as constants from "@/utils/constants";
import ChatComposer, { type ChatComposerStatus } from "./ChatComposer";
import ChatContextPanel from "./ChatContextPanel";
import ChatConversationRail from "./ChatConversationRail";
import ChatMailboxTools from "./ChatMailboxTools";
import type { ChatRecordActions } from "./ChatRecordCard";
import ChatTimeline, {
  chatEntryDomId,
  type ChatTimelineHandlers,
} from "./ChatTimeline";
import {
  SELF_CONVERSATION_KEY,
  buildChatModel,
  buildContactContext,
  contactDisplayName,
  filterConversations,
  unreadItemIds,
  type ChatConversation,
} from "./chat-model";
import {
  chatSendBlocker,
  previewChatLetterBudget,
  sendChatLetter,
} from "./chat-send";
import { useMailboxDesk } from "./useMailboxDesk";
import styles from "./chat.module.css";

/** The conversation key an address files under, or null when it is not one. */
function conversationKeyFor(address: string | undefined): string | null {
  if (!address) return null;
  try {
    return canonicalizeStarknetAddress(address);
  } catch {
    return null;
  }
}

/** The conversation tag the mailbox threads this counterparty under, if any. */
function conversationIdFor(
  conversation: ChatConversation,
): string | undefined {
  for (let index = conversation.items.length - 1; index >= 0; index -= 1) {
    const item = conversation.items[index];
    const message = item.message;
    if (!message || message.envelope.type === "unsupported") continue;
    const fields = conversationFieldsFromPayload(
      message.envelope.type,
      message.envelope.payload,
    );
    const candidate =
      fields.conversationId ??
      fields.documentId ??
      parseConversationId(message.documentId);
    if (candidate) return candidate;
  }
  return undefined;
}

/** The first address a draft names, for filing the document composer. */
function draftRecipientKey(draft: CompositeDraft): string | null {
  const first = draft.recipient.split(/[\n,;]+/)[0]?.trim();
  return conversationKeyFor(first || undefined);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Chat is the mailbox: every encrypted record this wallet holds, read one
 * counterparty at a time, with the mailbox desk's own handlers behind every
 * card. The desk hook owns keys, scanning, deal state and value actions; this
 * page owns which conversation is open and what the person is writing.
 */
export default function ChatPage() {
  const desk = useMailboxDesk();
  const {
    address,
    chainId,
    providerIndex,
    helperAddress,
    networkName,
    keypair,
    mailSeed,
    markMessagesRead,
    clearFocusRequest,
  } = desk;
  const session = useActiveStarknetSession();
  const isConnected = useStoreWallet((state) => state.isConnected);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const scope = address && chainId ? `${chainId}:${address}` : "";
  const gate = desk.mailboxGate;
  const handoffsEnabled =
    session.rail === "ready" && session.compatible && Boolean(scope);

  /* Multi-maker requests live in the RFQ workspace; Chat only reads them so
     the context panel can show the ones a counterparty is part of. */
  const [rfqRecords, setRfqRecords] = useState<readonly RfqLifecycleRecord[]>(
    [],
  );
  const [rfqVersion, setRfqVersion] = useState(0);
  useEffect(() => {
    if (!address || !chainId) {
      setRfqRecords([]);
      return;
    }
    let cancelled = false;
    void createIndexedDbRfqStorage()
      .list(chainId, address)
      .then((rows) => {
        if (cancelled) return;
        const now = Math.floor(Date.now() / 1_000);
        const restored: RfqLifecycleRecord[] = [];
        for (const raw of rows) {
          try {
            restored.push(
              restoreRfqLifecycle(raw, { chainId, account: address, now }),
            );
          } catch {
            // An unreadable row is the RFQ workspace's to reconcile.
          }
        }
        setRfqRecords(restored);
      })
      .catch(() => {
        // Without IndexedDB the workspace section simply stays empty here.
      });
    return () => {
      cancelled = true;
    };
  }, [address, chainId, rfqVersion]);
  useEffect(() => {
    const onStorage = () => setRfqVersion((value) => value + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* Addresses opened this session that hold no record yet: a new conversation
     from the tools, or a Counterparties handoff. */
  const [extraContacts, setExtraContacts] = useState<string[]>([]);
  const addressBook = useMemo<AddressBookEntry[]>(
    () =>
      desk.bookEntries.map((entry) => ({
        label: entry.label,
        address: entry.address,
        updatedAt: entry.addedAt,
      })),
    [desk.bookEntries],
  );
  const model = useMemo(
    () =>
      buildChatModel({
        selfAddress: address,
        messages: desk.messages,
        otc: desk.otcState,
        escrow: desk.escrowState,
        addressBook,
        aliases: desk.aliases,
        readIds: desk.readMessageIds,
        extraContacts,
      }),
    [
      address,
      addressBook,
      desk.aliases,
      desk.escrowState,
      desk.messages,
      desk.otcState,
      desk.readMessageIds,
      extraContacts,
    ],
  );
  const [search, setSearch] = useState("");
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const needsActionCount = model.conversations.filter(
    (conversation) => conversation.needsAction,
  ).length;
  const visible = useMemo(
    () => filterConversations(model.conversations, { search, needsActionOnly }),
    [model.conversations, needsActionOnly, search],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /* A conversation is "activated" by an explicit choice, not by being the
     first row on load. The counter lets choosing the already-open row count
     again, so its records are marked read even when nothing else changed. */
  const activatedRef = useRef<string | null>(null);
  const [activation, setActivation] = useState(0);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ChatComposerStatus>(null);
  const [sending, setSending] = useState(false);
  /* The document composer, open on one device-private draft. */
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  /* Bumped when a handoff or a new address should land the cursor in the
     quick composer; the composer exists only once its conversation renders. */
  const [composerFocus, setComposerFocus] = useState(0);
  useEffect(() => {
    if (!composerFocus) return;
    document.getElementById("chat-composer")?.focus();
  }, [composerFocus, selectedKey]);

  useEffect(() => {
    setSelectedKey(null);
    activatedRef.current = null;
    setEntryId(null);
    setHighlightId(null);
    setLetters({});
    setStatus(null);
    setSending(false);
    setMobileDetailOpen(false);
    setContextOpen(false);
    setSearch("");
    setNeedsActionOnly(false);
    setExtraContacts([]);
    setComposeDraftId(null);
  }, [scope]);

  useEffect(() => {
    if (
      selectedKey &&
      visible.some((conversation) => conversation.contact.key === selectedKey)
    ) {
      return;
    }
    setSelectedKey(visible[0]?.contact.key ?? null);
  }, [selectedKey, visible]);

  const conversation =
    model.conversations.find(
      (candidate) => candidate.contact.key === selectedKey,
    ) ?? null;
  const context = useMemo(
    () => (conversation ? buildContactContext(conversation, rfqRecords) : null),
    [conversation, rfqRecords],
  );
  const selectedEntry = useMemo(() => {
    if (!context || !entryId) return null;
    return (
      [...context.rfqs, ...context.payments, ...context.escrows].find(
        (entry) => entry.id === entryId,
      ) ?? null
    );
  }, [context, entryId]);

  /* Opening a conversation is what marks its incoming records read; the
     first row being selected on load is not. */
  useEffect(() => {
    if (!conversation) return;
    if (activatedRef.current !== conversation.contact.key) return;
    const pending = unreadItemIds(conversation);
    if (pending.length) markMessagesRead(pending);
  }, [activation, conversation, markMessagesRead]);

  const selectConversation = useCallback((next: string) => {
    activatedRef.current = next;
    setActivation((value) => value + 1);
    setSelectedKey(next);
    setEntryId(null);
    setHighlightId(null);
    setStatus(null);
    setMobileDetailOpen(true);
    setContextOpen(false);
  }, []);

  /* Where the desk asks Chat to look: an imported payment request, or the
     counterparty a Counterparties or RFQ handoff named. */
  useEffect(() => {
    const request = desk.focusRequest;
    if (!request) return;
    if (request.kind === "recipient") {
      const key = conversationKeyFor(request.address);
      if (key && address && !feltEquals(key, address)) {
        setSearch("");
        setNeedsActionOnly(false);
        setExtraContacts((current) =>
          current.includes(key) ? current : [...current, key],
        );
        selectConversation(key);
        setComposerFocus((value) => value + 1);
      }
      clearFocusRequest();
      return;
    }
    const owner = model.conversations.find((candidate) =>
      candidate.items.some((item) => item.id === request.id),
    );
    if (!owner) return;
    setSearch("");
    setNeedsActionOnly(false);
    selectConversation(owner.contact.key);
    setHighlightId(request.id);
    clearFocusRequest();
  }, [
    address,
    clearFocusRequest,
    desk.focusRequest,
    model.conversations,
    selectConversation,
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const conversationLength = conversation?.items.length ?? 0;
  const composeDraft =
    (composeDraftId &&
      desk.drafts.find((draft) => draft.id === composeDraftId)) ||
    null;
  useEffect(() => {
    if (highlightId || composeDraft) return;
    const frame = window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composeDraft, conversationLength, highlightId, selectedKey]);

  useEffect(() => {
    if (!highlightId || composeDraft) return;
    /* Scroll the timeline itself: scrollIntoView would also drag every
       overflow-hidden ancestor, shifting the whole desk. */
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const element = document.getElementById(chatEntryDomId(highlightId));
      if (!container || !element) return;
      const containerBox = container.getBoundingClientRect();
      const elementBox = element.getBoundingClientRect();
      const top =
        container.scrollTop +
        (elementBox.top - containerBox.top) -
        (container.clientHeight - elementBox.height) / 2;
      container.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
    const timer = window.setTimeout(() => setHighlightId(null), 1_800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [composeDraft, highlightId]);

  function locate(itemId: string) {
    setContextOpen(false);
    setMobileDetailOpen(true);
    setComposeDraftId(null);
    setHighlightId(itemId);
  }

  function startConversation(input: string) {
    let recipient: string;
    try {
      recipient = validateAndParseAddress(input.trim());
    } catch {
      desk.setStorageNotice({
        kind: "error",
        message:
          "That is not a valid Starknet address. Pick a saved counterparty or paste the address itself.",
      });
      return;
    }
    if (address && feltEquals(recipient, address)) {
      if (model.conversations.some((row) => row.contact.key === SELF_CONVERSATION_KEY)) {
        selectConversation(SELF_CONVERSATION_KEY);
        return;
      }
      desk.setStorageNotice({
        kind: "error",
        message:
          "This is your own mailbox. Self-addressed backups are posted from the mailbox tools.",
      });
      return;
    }
    const key = conversationKeyFor(recipient);
    if (!key) return;
    setSearch("");
    setNeedsActionOnly(false);
    setExtraContacts((current) =>
      current.includes(key) ? current : [...current, key],
    );
    selectConversation(key);
    setComposerFocus((value) => value + 1);
  }

  /* The document composer: terms, invoices and escrow announcements go out
     as one sealed document, exactly as the mailbox has always sent them. */
  function openDocumentComposer(recipient?: string) {
    const draft = desk.createDraft({
      recipient,
      conversationId:
        recipient && conversation?.contact.address === recipient
          ? conversationIdFor(conversation)
          : undefined,
    });
    if (!draft) return;
    setComposeDraftId(draft.id);
    setEntryId(null);
    setHighlightId(null);
    setMobileDetailOpen(true);
    setContextOpen(false);
  }

  function openDraft(draft: CompositeDraft) {
    const key = draftRecipientKey(draft);
    if (key && model.conversations.some((row) => row.contact.key === key)) {
      selectConversation(key);
    }
    setComposeDraftId(draft.id);
    setMobileDetailOpen(true);
    setContextOpen(false);
  }

  function closeDocumentComposer() {
    if (composeDraft && isBlankDraft(composeDraft)) {
      desk.removeDraft(composeDraft.id, false);
    }
    setComposeDraftId(null);
  }

  function handleDocumentSent(message: SentEnvelope) {
    desk.handleSent(message);
    desk.removeDraft(message.draftId, false);
    setComposeDraftId(null);
    const recipientKeys = message.recipients
      .map((recipient) => conversationKeyFor(recipient))
      .filter((key): key is string => key !== null);
    const others = recipientKeys.filter(
      (key) => !(address && feltEquals(key, address)),
    );
    const target = others.length ? others : [SELF_CONVERSATION_KEY];
    if (!selectedKey || !target.includes(selectedKey)) {
      selectConversation(target[0]);
    }
    setHighlightId(`sent:${message.documentId}`);
  }

  const blocker = chatSendBlocker({
    helperAddress,
    networkName,
    connected: isConnected,
    hasWalletAccount: Boolean(walletAccount),
    senderAddress: address,
    isStrk20Capable,
    keyReady: Boolean(keypair),
  });
  const letter = conversation ? (letters[conversation.contact.key] ?? "") : "";
  const budget = useMemo(
    () => previewChatLetterBudget(letter, Boolean(mailSeed)),
    [letter, mailSeed],
  );

  async function send() {
    if (
      !conversation ||
      conversation.contact.kind !== "counterparty" ||
      !conversation.contact.address ||
      sending ||
      blocker ||
      !keypair ||
      !helperAddress ||
      !walletAccount ||
      !selectedWallet ||
      !address ||
      !chainId
    ) {
      return;
    }
    const target = conversation.contact.address;
    const key = conversation.contact.key;
    const body = letter;
    setSending(true);
    setStatus({
      kind: "sending",
      message: "Preparing the sealed letter…",
      startedAt: Date.now(),
    });
    try {
      const result = await sendChatLetter({
        recipient: target,
        body,
        conversationId: conversationIdFor(conversation),
        context: {
          providerIndex,
          provider: constants.myFrontendProviders[providerIndex],
          helperAddress,
          walletAccount,
          selectedWallet,
          senderAddress: address,
          chainId,
          mailSeed,
          keypair,
        },
        onPhase: (_phase, detail) =>
          setStatus((current) => ({
            kind: "sending",
            message: detail,
            startedAt: current?.startedAt ?? Date.now(),
          })),
      });
      desk.handleSent(result.envelope);
      setLetters((current) => ({ ...current, [key]: "" }));
      setStatus({
        kind: "ok",
        message: `Sealed and confirmed in ${shortenFelt(result.transactionHash)}. The Sent copy is filed here on this device (not encrypted at rest).`,
      });
      setHighlightId(`sent:${result.envelope.documentId}`);
    } catch (error: unknown) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The letter was not sent. Nothing was submitted.",
      });
    } finally {
      setSending(false);
    }
  }

  const actions: ChatRecordActions = {
    selfAddress: address,
    actionStates: desk.actionStates,
    invoiceMaturityHeadBlock: desk.invoiceMaturityHeadBlock,
    onAccept: (offer, offerIndex) => void desk.handleAccept(offer, offerIndex),
    onDecline: (offer) => void desk.handleDecline(offer),
    onPostReceipt: (offer) => void desk.handlePostReceipt(offer),
    onPay: (request) => void desk.handlePay(request),
    onPayPrivatelyWithStrk: (request) =>
      void desk.handlePayPrivatelyWithStrk(request),
    onEscrowFill: (fund) => void desk.handleEscrowFill(fund),
    onEscrowClaim: (fund) => void desk.handleLocalnetEscrowPayout(fund, "claim"),
    onEscrowTimeout: (fund) =>
      void desk.handleLocalnetEscrowPayout(fund, "timeout"),
  };
  const timelineHandlers: ChatTimelineHandlers = {
    actions,
    proofs: desk.proofs,
    onAssign: desk.assignMessageAddress,
    onProve: desk.proveAssignedAddress,
    onRestoreContacts: (payload, message) =>
      void desk.restoreContactBackup(payload, message),
    onRestoreBackup: (payload, message) =>
      void desk.restoreAuthenticatedBackup(payload, message),
    contactRestorePending: Boolean(
      desk.actionStates["contacts:restore"]?.pending,
    ),
    backupRestorePending: Boolean(desk.actionStates["backup:restore"]?.pending),
  };

  const name = conversation ? contactDisplayName(conversation.contact) : null;
  const walletGateShown = desk.storageNotice?.action === "connect-wallet";
  const composeRecipientName = composeDraft
    ? (() => {
        const key = draftRecipientKey(composeDraft);
        const row = key
          ? model.conversations.find((candidate) => candidate.contact.key === key)
          : null;
        if (row) return contactDisplayName(row.contact);
        return composeDraft.recipient.trim() ? "the named recipients" : null;
      })()
    : null;
  const detailOpen = mobileDetailOpen || Boolean(composeDraft);

  return (
    <div className={styles.page}>
      <main
        aria-label="APP20 Chat"
        className={`${styles.workspace}${detailOpen ? ` ${styles.detailOpen}` : ""}${
          contextOpen ? ` ${styles.contextOpen}` : ""
        }`}
      >
        <ChatConversationRail
          conversations={visible}
          totalCount={model.conversations.length}
          selectedKey={selectedKey}
          search={search}
          onSearchChange={setSearch}
          needsActionOnly={needsActionOnly}
          onNeedsActionChange={setNeedsActionOnly}
          needsActionCount={needsActionCount}
          gate={gate}
          unattributedSent={model.unattributedSent}
          onSelect={selectConversation}
        >
          <ChatMailboxTools
            selfAddress={address}
            gate={gate}
            keyLoaded={Boolean(keypair)}
            seedLoaded={Boolean(mailSeed)}
            helperConfigured={Boolean(helperAddress)}
            scanning={desk.scanning}
            scanKind={desk.scanKind}
            scanMessage={desk.scanMessage}
            scanProgress={desk.scanProgress}
            scanCursorDescription={desk.scanCursorDescription}
            onScan={(direction) => void desk.scanInbox(direction)}
            drafts={desk.drafts}
            onOpenDraft={openDraft}
            onDeleteDraft={(draftId) => {
              desk.removeDraft(draftId);
            }}
            onStartConversation={startConversation}
            onNewDocument={(recipient) => openDocumentComposer(recipient)}
            actionStates={desk.actionStates}
            onContactBackup={() => void desk.handleContactBackup()}
            onRfqHistoryBackup={() => void desk.handleRfqHistoryBackup()}
            rfqAutoBackupEnabled={desk.rfqAutoBackupEnabled}
            onRfqAutoBackupChange={desk.updateRfqAutoBackup}
            onLock={desk.lockMailboxSession}
            onForget={desk.forgetThisDevice}
          />
        </ChatConversationRail>

        <section className={styles.conversation} aria-label="Conversation">
          <header className={styles.conversationHead}>
            <button
              type="button"
              className={`${styles.headButton} ${styles.backButton}`}
              aria-label="Back to conversations"
              onClick={() => {
                if (composeDraft) closeDocumentComposer();
                setMobileDetailOpen(false);
              }}
            >
              ← Chats
            </button>
            <div>
              <p className={styles.kicker}>
                {composeDraft
                  ? "ENCRYPTED DOCUMENT · SEALED ON THIS DEVICE"
                  : conversation
                    ? "ENCRYPTED RECORDS · NOT SETTLEMENT AUTHORITY"
                    : "APP20 / CHAT / ENCRYPTED CORRESPONDENCE"}
              </p>
              <strong>
                {composeDraft ? (
                  composeRecipientName ? (
                    <>
                      Document to <bdi>{composeRecipientName}</bdi>
                    </>
                  ) : (
                    "New document"
                  )
                ) : name ? (
                  <bdi>{name}</bdi>
                ) : (
                  "Private correspondence, one counterparty at a time"
                )}
              </strong>
              {conversation && !composeDraft ? (
                <small>
                  {conversation.items.length} record
                  {conversation.items.length === 1 ? "" : "s"} on this device ·{" "}
                  {conversation.contact.kind === "self"
                    ? "your own mailbox"
                    : conversation.contact.address
                      ? shortenFelt(conversation.contact.address)
                      : "unnamed thread"}
                </small>
              ) : null}
            </div>
            {composeDraft ? (
              <button
                type="button"
                className={styles.headButton}
                onClick={closeDocumentComposer}
              >
                Close document
              </button>
            ) : conversation ? (
              <button
                type="button"
                className={`${styles.headButton} ${styles.contextButton}`}
                aria-controls="chat-context"
                aria-expanded={contextOpen}
                onClick={() => setContextOpen((open) => !open)}
              >
                Context
              </button>
            ) : null}
          </header>

          <div ref={scrollRef} className={styles.timelineScroll}>
            {desk.storageNotice ? (
              <div
                className={styles.notice}
                data-kind={desk.storageNotice.kind}
                role={desk.storageNotice.kind === "error" ? "alert" : "status"}
              >
                <span>{desk.storageNotice.message}</span>
                {desk.storageNotice.action === "connect-wallet" ? (
                  <span className={styles.connectAction}>
                    <SelectWallet />
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.noticeDismiss}
                  aria-label="Dismiss notice"
                  onClick={() => desk.setStorageNotice(null)}
                >
                  ×
                </button>
              </div>
            ) : null}

            {gate === "key" ? (
              <div className={styles.keySetup}>
                <Onboard
                  key={`${providerIndex}:${address}`}
                  helperAddress={helperAddress}
                  onKeyReady={desk.handleKeyReady}
                />
              </div>
            ) : null}

            {composeDraft ? (
              <section className={styles.sheet} aria-label="Document composer">
                {gate === "key" ? (
                  <p className={styles.keyNotice}>
                    <strong>No mailbox key on this device</strong>
                    <span>
                      Write and save the draft now. Sending needs a mailbox
                      key — <a href="#mailbox-key-setup">set one up above</a>.
                    </span>
                  </p>
                ) : null}
                <Compose
                  key={composeDraft.id}
                  draft={composeDraft}
                  helperAddress={helperAddress}
                  escrowAddress={desk.escrowAddress}
                  escrowEnabled={desk.escrowEnabled}
                  mailSeed={mailSeed}
                  keyReady={Boolean(keypair)}
                  networkName={networkName}
                  onDraftChange={desk.persistDraft}
                  onDeleteDraft={(draftId) => {
                    desk.removeDraft(draftId, false);
                    setComposeDraftId(null);
                  }}
                  onSent={handleDocumentSent}
                />
              </section>
            ) : gate === "wallet" ? (
              <section
                className={styles.welcome}
                aria-labelledby="chat-welcome-title"
              >
                <p className={styles.kicker}>APP20 / CHAT</p>
                <h2 id="chat-welcome-title">
                  Encrypted correspondence, one counterparty at a time.
                </h2>
                <p>
                  Letters, offers, invoices and escrow announcements are sealed
                  to a registered mailbox key and read back from the chain on
                  this device. Chat is keyed to a wallet: connect one to open
                  it.
                </p>
                {walletGateShown ? null : (
                  <div className={styles.connectAction}>
                    <SelectWallet />
                  </div>
                )}
              </section>
            ) : conversation ? (
              <ChatTimeline
                conversation={conversation}
                aliases={desk.displayAliases}
                highlightId={highlightId}
                handlers={timelineHandlers}
              />
            ) : model.conversations.length ? (
              <section
                className={styles.welcome}
                aria-labelledby="chat-filtered-title"
              >
                <p className={styles.kicker}>APP20 / CHAT</p>
                <h2 id="chat-filtered-title">No conversation matches.</h2>
                <p>
                  {model.conversations.length} conversation
                  {model.conversations.length === 1 ? "" : "s"} on this device
                  {needsActionOnly && search.trim()
                    ? " match neither the search nor the needs-action filter."
                    : needsActionOnly
                      ? " need nothing from you right now."
                      : " match nothing in that search."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setNeedsActionOnly(false);
                  }}
                >
                  Show all conversations
                </button>
              </section>
            ) : (
              <section
                className={styles.welcome}
                aria-labelledby="chat-empty-title"
              >
                <p className={styles.kicker}>APP20 / CHAT</p>
                <h2 id="chat-empty-title">No conversations on this device yet.</h2>
                <p>
                  Check for mail to read what counterparties sent this wallet,
                  write to a new address from the mailbox tools, or save a
                  wallet under Counterparties. Each becomes a conversation
                  here.
                </p>
                <div className={styles.welcomeLinks}>
                  <Link to="/contacts">Counterparties</Link>
                  <Link to="/rfq">RFQ workspace</Link>
                </div>
              </section>
            )}
          </div>

          {conversation && name && !composeDraft && gate !== "wallet" ? (
            conversation.contact.kind === "counterparty" &&
            conversation.contact.address ? (
              <ChatComposer
                contactName={name}
                value={letter}
                onChange={(value) =>
                  setLetters((current) => ({
                    ...current,
                    [conversation.contact.key]: value,
                  }))
                }
                blocker={blocker}
                sending={sending}
                status={status}
                budget={budget}
                onSend={() => void send()}
                onAttach={() =>
                  openDocumentComposer(conversation.contact.address ?? undefined)
                }
              />
            ) : (
              <p className={styles.composerNote}>
                {conversation.contact.kind === "self"
                  ? "Backups are posted from the mailbox tools; this mailbox does not write letters to itself."
                  : "A sealed thread has no address to write to. Name its sender above to file it under a counterparty."}
              </p>
            )
          ) : null}
        </section>

        {conversation && context && !composeDraft ? (
          <ChatContextPanel
            conversation={conversation}
            context={context}
            selectedEntry={selectedEntry}
            onSelectEntry={setEntryId}
            onLocate={locate}
            selfAddress={address}
            chainId={chainId}
            handoffsEnabled={handoffsEnabled}
            aliases={desk.displayAliases}
            actions={actions}
            onClose={() => setContextOpen(false)}
          />
        ) : (
          <aside className={styles.context} aria-label="Contact context" id="chat-context">
            <header className={styles.contextHead}>
              <div>
                <p className={styles.kicker}>CONTACT CONTEXT</p>
                <strong>At a glance</strong>
              </div>
              <button
                type="button"
                className={styles.contextClose}
                aria-label="Close contact context"
                onClick={() => setContextOpen(false)}
              >
                ×
              </button>
            </header>
            <p className={styles.contextPlaceholder}>
              {composeDraft
                ? "The document goes to the recipients named in it. Close it to return to the conversation."
                : "Wallet identity, open RFQs, pending payments and escrows for the selected counterparty appear here."}
            </p>
          </aside>
        )}

        <button
          type="button"
          className={styles.contextBackdrop}
          aria-label="Close contact context"
          tabIndex={contextOpen ? 0 : -1}
          onClick={() => setContextOpen(false)}
        />
      </main>
    </div>
  );
}
