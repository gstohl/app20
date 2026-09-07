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
import Compose, { type SentEnvelope } from "@/components/chat/Compose";
import Onboard from "@/components/chat/Onboard";
import { shortenFelt } from "@/components/chat/correspondent";
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
import ChatMailboxTools, { ChatNewConversation } from "./ChatMailboxTools";
import type { ChatRecordActions } from "./ChatRecordCard";
import ChatTimeline, {
  chatEntryDomId,
  type ChatTimelineHandlers,
} from "./ChatTimeline";
import ChatSyncStatus from "./ChatSyncStatus";
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
  ChatSendError,
  chatSendFailure,
  checkChatDelivery,
  chatSendBlocker,
  previewChatLetterBudget,
  sendChatLetter,
  type ChatSendResult,
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
  const nearLatestRef = useRef(true);
  const scrollHistoryRef = useRef<{ key: string | null; ids: string[]; height: number }>({ key: null, ids: [], height: 0 });
  const [newMessages, setNewMessages] = useState(0);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ChatComposerStatus>(null);
  const [sending, setSending] = useState(false);
  const [sendFailures, setSendFailures] = useState<Record<string, ChatSendError>>({});
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const activeConversation = useRef(selectedKey);
  activeConversation.current = selectedKey;
  const failureKey = `${scope}:${selectedKey}`;
  const sendFailure = sendFailures[failureKey];
  const composerStatus: ChatComposerStatus = !sending && sendFailure ? {
    kind: "error", message: sendFailure.message, detail: sendFailure.detail,
    transactionHash: sendFailure.submittedTransactionHash,
    retryBlocked: sendFailure.outcome === "unknown",
  } : status;
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
    if (activatedRef.current !== conversation.contact.key || !nearLatestRef.current) return;
    const pending = unreadItemIds(conversation);
    if (pending.length) markMessagesRead(pending);
  }, [activation, conversation, markMessagesRead]);

  const selectConversation = useCallback((next: string) => {
    activatedRef.current = next;
    nearLatestRef.current = true;
    setNewMessages(0);
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
      if (!element) return;
      const items = conversation?.items ?? [];
      const previous = scrollHistoryRef.current;
      const ids = items.map((item) => item.id);
      const previousIds = new Set(previous.ids);
      const added = items.filter((item) => !previousIds.has(item.id));
      const changed = previous.key !== selectedKey;
      const outgoing = added.some((item) => item.direction === "outgoing") &&
        ids.at(-1) !== previous.ids.at(-1);
      if (changed || nearLatestRef.current || outgoing) {
        element.scrollTop = element.scrollHeight;
        nearLatestRef.current = true;
        setNewMessages(0);
      } else if (previous.ids.length && ids.at(-1) === previous.ids.at(-1) &&
        ids.indexOf(previous.ids[0]) > 0) {
        element.scrollTop += element.scrollHeight - previous.height;
      } else {
        setNewMessages((count) => count + added.filter((item) => item.direction === "incoming").length);
      }
      scrollHistoryRef.current = { key: selectedKey, ids, height: element.scrollHeight };
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composeDraft, conversation, conversationLength, highlightId, selectedKey]);

  function readLatest() {
    if (conversation && activatedRef.current === conversation.contact.key) {
      markMessagesRead(unreadItemIds(conversation));
    }
    setNewMessages(0);
  }

  useEffect(() => {
    if (!highlightId || composeDraft) return;
    /* Scroll the timeline itself: scrollIntoView would also drag every
       overflow-hidden ancestor, shifting the whole desk. */
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const element = document.getElementById(chatEntryDomId(highlightId));
      if (!container || !element) return;
      element.focus({ preventScroll: true });
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

  function startConversation(input: string): boolean {
    let recipient: string;
    try {
      recipient = validateAndParseAddress(input.trim());
    } catch {
      desk.setStorageNotice({
        kind: "error",
        message:
          "That is not a valid Starknet address. Pick a saved counterparty or paste the address itself.",
      });
      return false;
    }
    if (address && feltEquals(recipient, address)) {
      if (model.conversations.some((row) => row.contact.key === SELF_CONVERSATION_KEY)) {
        selectConversation(SELF_CONVERSATION_KEY);
        return true;
      }
      desk.setStorageNotice({
        kind: "error",
        message:
          "This is your own chat. Self-addressed backups are posted from the chat tools.",
      });
      return false;
    }
    const key = conversationKeyFor(recipient);
    if (!key) return false;
    setSearch("");
    setNeedsActionOnly(false);
    setExtraContacts((current) =>
      current.includes(key) ? current : [...current, key],
    );
    selectConversation(key);
    setComposerFocus((value) => value + 1);
    return true;
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
      sendFailure?.outcome === "unknown" ||
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
      message: "Preparing the sealed message…",
      startedAt: Date.now(),
    });
    let confirmed: ChatSendResult | undefined;
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
        onPhase: (_phase, detail) => {
          if (activeScope.current !== scope || activeConversation.current !== key) return;
          setStatus((current) => ({
            kind: "sending",
            message: detail,
            startedAt: current?.startedAt ?? Date.now(),
          }));
        },
      });
      confirmed = result;
      if (activeScope.current !== scope) return;
      setSendFailures((current) => { const next = { ...current }; delete next[failureKey]; return next; });
      desk.handleSent(result.envelope);
      setLetters((current) => ({ ...current, [key]: "" }));
      if (activeConversation.current !== key) return;
      setStatus({
        kind: "ok",
        message: `Sealed and confirmed in ${shortenFelt(result.transactionHash)}. The Sent copy is filed here on this device (not encrypted at rest).`,
      });
      setHighlightId(`sent:${result.envelope.documentId}`);
    } catch (error: unknown) {
      const failure = error instanceof ChatSendError ? error : chatSendFailure(error, confirmed?.envelope);
      setSendFailures((current) => ({ ...current, [failureKey]: failure }));
    } finally {
      if (activeScope.current === scope) setSending(false);
    }
  }

  async function checkDelivery() {
    const pending = sendFailure?.pendingLetter;
    if (!pending || sending) return;
    const key = selectedKey;
    setSending(true);
    setStatus({ kind: "sending", message: "Checking the original transaction…", retryBlocked: true });
    try {
      const result = await checkChatDelivery(constants.myFrontendProviders[providerIndex], pending);
      if (activeScope.current !== scope) return;
      desk.handleSent(result.envelope);
      setSendFailures((current) => { const next = { ...current }; delete next[failureKey]; return next; });
      if (key) setLetters((current) => current[key] === pending.plaintext ? { ...current, [key]: "" } : current);
      if (activeConversation.current === key) {
        setStatus({ kind: "ok", message: "Delivery confirmed. Your message is filed in this conversation." });
        setHighlightId(`sent:${result.envelope.documentId}`);
      }
    } catch (error: unknown) {
      setSendFailures((current) => ({ ...current, [failureKey]: chatSendFailure(error, pending) }));
    } finally {
      if (activeScope.current === scope) setSending(false);
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

  function openNewConversation() {
    const form = document.getElementById("chat-new-conversation");
    if (form instanceof HTMLDetailsElement) {
      form.open = true;
      form.scrollIntoView({ block: "nearest" });
      form.querySelector<HTMLInputElement>("input")?.focus();
    }
  }


  return (
    <div className={styles.page}>
      <main
        aria-label="APP20 Chat"
        data-empty={!conversation && !composeDraft}
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
          onNewConversation={helperAddress ? openNewConversation : undefined}
          syncStatus={!gate && helperAddress ? <ChatSyncStatus
            scanning={desk.scanning} lastCheckedAt={desk.lastCheckedAt}
            error={desk.scanKind === "error"} onRefresh={() => void desk.scanInbox("newer")} /> : null}
          newConversationForm={
            helperAddress ? <ChatNewConversation selfAddress={address} gate={gate}
              onStartConversation={startConversation}
              onNewDocument={(recipient) => openDocumentComposer(recipient)} /> : null
          }
        >
          <ChatMailboxTools
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
                  ? "DOCUMENT DRAFT · STORED LOCALLY"
                  : conversation
                    ? "ENCRYPTED CHAT"
                    : "ENCRYPTED MESSAGES"}
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
                  "Private messages"
                )}
              </strong>
              {conversation && !composeDraft ? (
                <small>
                  {conversation.items.length} message
                  {conversation.items.length === 1 ? "" : "s"} on this device ·{" "}
                  {conversation.contact.kind === "self"
                    ? "your own chat"
                    : conversation.contact.address
                      ? shortenFelt(conversation.contact.address)
                      : "reply address needed"}
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
                id="chat-context-toggle"
                aria-controls="chat-context"
                aria-expanded={contextOpen}
                onClick={() => setContextOpen((open) => !open)}
              >
                {contextOpen ? "Hide contact details" : "Contact details"}
              </button>
            ) : null}
          </header>

          <div ref={scrollRef} className={styles.timelineScroll}
            onScroll={(event) => {
              const element = event.currentTarget;
              nearLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
              if (nearLatestRef.current) readLatest();
            }}>
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
                    <strong>No chat key on this device</strong>
                    <span>
                      Write and save the draft now. Sending needs a chat
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
                  Connect your wallet to open Chat
                </h2>
                <p>
                  Send encrypted messages, offers and payment requests.
                  Each wallet has its own chat.
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
                readIds={desk.readMessageIds}
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
            ) : gate === "key" ? null : (
              <section
                className={styles.welcome}
                aria-labelledby="chat-empty-title"
              >
                <p className={styles.kicker}>APP20 / CHAT</p>
                <h2 id="chat-empty-title">Start a conversation</h2>
                <p>
                  Choose a saved contact or enter a wallet address.
                  Incoming messages appear here automatically.
                </p>
                <div className={styles.welcomeLinks}>
                  <button type="button" onClick={openNewConversation}>Start a conversation</button>
                  <Link to="/contacts">Saved counterparties</Link>
                </div>
              </section>
            )}
          </div>

          {newMessages > 0 ? (
            <button className={styles.latestMessages} type="button" onClick={() => {
              const element = scrollRef.current;
              if (element) element.scrollTop = element.scrollHeight;
              nearLatestRef.current = true;
              readLatest();
              const last = conversation?.items.at(-1);
              if (last) document.getElementById(chatEntryDomId(last.id))?.focus({ preventScroll: true });
            }}>{newMessages} new message{newMessages === 1 ? "" : "s"} · Jump to latest</button>
          ) : null}

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
                status={composerStatus}
                onCheckDelivery={sendFailure?.pendingLetter ? () => void checkDelivery() : undefined}
                budget={budget}
                onSend={() => void send()}
                onAttach={() =>
                  openDocumentComposer(conversation.contact.address ?? undefined)
                }
              />
            ) : (
              <p className={styles.composerNote}>
                {conversation.contact.kind === "self"
                  ? "Backups are posted from the chat tools; this chat does not write messages to itself."
                  : "To reply, set the sender’s wallet address above. You can paste an address or choose a saved counterparty."}
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
            onClose={() => {
              setContextOpen(false);
              document.getElementById("chat-context-toggle")?.focus();
            }}
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
