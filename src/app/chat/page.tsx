"use client";

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveStarknetSession } from "@/app/active-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  helperForNetwork,
  paymentLinkRecords,
  paymentLinkToLocal,
  storedSentToLocal,
} from "@/app/inbox/mailbox-model";
import {
  restoreRfqLifecycle,
  type RfqLifecycleRecord,
} from "@/app/rfq/rfq-lifecycle";
import { createIndexedDbRfqStorage } from "@/app/rfq/rfq-storage";
import { shortenFelt } from "@/components/mail/correspondent";
import type { LocalMailMessage } from "@/components/mail/Thread";
import {
  ADDRESS_BOOK_CHANGED_EVENT,
  loadAddressBook,
  type AddressBookEntry,
} from "@/lib/address-book";
import { loadAliases, type AliasRecord } from "@/lib/aliases";
import { emptyEscrowState, loadEscrowState, type EscrowState } from "@/lib/escrow";
import { deriveKeypair, type MailKeypair } from "@/lib/mail";
import { loadReadMessageIds, saveReadMessageIds } from "@/lib/mail-read-state";
import {
  conversationFieldsFromPayload,
  parseConversationId,
} from "@/lib/mail-thread";
import {
  inspectMailVault,
  unwrapMailSeed,
  type MailVaultRecord,
} from "@/lib/mail-vault";
import { emptyOtcState, expireStoredDeals, type OtcState } from "@/lib/otc";
import { loadSentMail } from "@/lib/sent-mail";
import * as constants from "@/utils/constants";
import ChatComposer, {
  type ChatComposerStatus,
  type ChatKeyState,
} from "./ChatComposer";
import ChatContextPanel from "./ChatContextPanel";
import ChatConversationRail from "./ChatConversationRail";
import ChatTimeline, { chatEntryDomId } from "./ChatTimeline";
import {
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
import styles from "./chat.module.css";

type ChatRecords = Readonly<{
  sent: readonly LocalMailMessage[];
  paymentLinks: readonly LocalMailMessage[];
  otc: OtcState;
  escrow: EscrowState;
  aliases: readonly AliasRecord[];
  addressBook: readonly AddressBookEntry[];
  rfqRecords: readonly RfqLifecycleRecord[];
}>;

const EMPTY_RECORDS: ChatRecords = Object.freeze({
  sent: [],
  paymentLinks: [],
  otc: emptyOtcState(),
  escrow: emptyEscrowState(),
  aliases: [],
  addressBook: [],
  rfqRecords: [],
});

type VaultState =
  | { kind: "missing" }
  | {
      kind: "locked";
      record: Extract<MailVaultRecord, { kind: "passphrase" }>;
      busy: boolean;
      error?: string;
    }
  | { kind: "ready"; seed: Uint8Array; keypair: MailKeypair };

function wipeVault(vault: VaultState): void {
  if (vault.kind !== "ready") return;
  vault.seed.fill(0);
  vault.keypair.privateKey.fill(0);
}

/**
 * Everything Chat reads is the mailbox's own device-local state, loaded with
 * the same functions Mailbox uses so the two surfaces can never disagree
 * about a record. Nothing is fetched from the chain here.
 */
function loadSynchronousRecords(
  chainId: string,
  address: string,
): Pick<ChatRecords, "sent" | "paymentLinks" | "otc" | "escrow" | "aliases"> {
  const otc = expireStoredDeals(window.localStorage, chainId, address);
  return {
    sent: loadSentMail(window.localStorage, chainId, address).map(
      storedSentToLocal,
    ),
    paymentLinks: paymentLinkRecords(otc).map((payment) =>
      paymentLinkToLocal(
        payment.request,
        payment.updatedAt,
        payment.linkAuthenticity,
      ),
    ),
    otc,
    escrow: loadEscrowState(window.localStorage, chainId, address),
    aliases: loadAliases(window.localStorage, address),
  };
}

/** The conversation tag Mailbox threads this counterparty under, if any. */
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

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function ChatPage() {
  const session = useActiveStarknetSession();
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const helperAddress = helperForNetwork(providerIndex);
  const networkName = constants.Strk20Networks[providerIndex] ?? "this network";
  const scope = address && chainId ? `${chainId}:${address}` : "";
  const gate: "wallet" | null = scope ? null : "wallet";
  const handoffsEnabled =
    session.rail === "ready" && session.compatible && Boolean(scope);

  const [records, setRecords] = useState<ChatRecords>(EMPTY_RECORDS);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const scopeRef = useRef("");

  useEffect(() => {
    if (!scope || !address || !chainId) {
      scopeRef.current = "";
      setRecords(EMPTY_RECORDS);
      setReadIds(new Set());
      return;
    }
    const sameScope = scopeRef.current === scope;
    scopeRef.current = scope;
    let cancelled = false;
    try {
      const loaded = loadSynchronousRecords(chainId, address);
      setRecords((current) => ({
        ...loaded,
        addressBook: sameScope ? current.addressBook : [],
        rfqRecords: sameScope ? current.rfqRecords : [],
      }));
    } catch {
      setRecords(EMPTY_RECORDS);
    }
    setReadIds(loadReadMessageIds(window.localStorage, chainId, address));
    void loadAddressBook(window.localStorage, address)
      .then((entries) => {
        if (!cancelled) {
          setRecords((current) => ({ ...current, addressBook: entries }));
        }
      })
      .catch(() => {
        // A book that will not open is reported on the Counterparties page.
        if (!cancelled) setRecords((current) => ({ ...current, addressBook: [] }));
      });
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
        setRecords((current) => ({ ...current, rfqRecords: restored }));
      })
      .catch(() => {
        // Without IndexedDB the workspace section simply stays empty here.
      });
    return () => {
      cancelled = true;
    };
  }, [address, chainId, scope, version]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener(ADDRESS_BOOK_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ADDRESS_BOOK_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  /* The mailbox key stays exactly where Mailbox keeps it: a plaintext vault
     opens silently, a passphrase vault asks once per tab, and the seed is
     zeroed whenever the account changes or the page goes away. */
  const [vault, setVault] = useState<VaultState>({ kind: "missing" });
  const vaultRef = useRef<VaultState>(vault);
  vaultRef.current = vault;
  useEffect(() => {
    if (!address || !chainId) {
      setVault({ kind: "missing" });
      return;
    }
    let next: VaultState = { kind: "missing" };
    try {
      const inspected = inspectMailVault(window.localStorage, chainId, address);
      if (inspected.kind === "plaintext") {
        next = {
          kind: "ready",
          seed: inspected.seed,
          keypair: deriveKeypair(inspected.seed),
        };
      } else if (inspected.kind === "passphrase") {
        next = { kind: "locked", record: inspected.record, busy: false };
      }
    } catch {
      next = { kind: "missing" };
    }
    setVault(next);
    return () => {
      wipeVault(vaultRef.current);
      wipeVault(next);
    };
  }, [address, chainId]);

  async function unlockVault(passphrase: string) {
    const current = vaultRef.current;
    if (current.kind !== "locked" || current.busy) return;
    setVault({ ...current, busy: true, error: undefined });
    try {
      const seed = await unwrapMailSeed(current.record, passphrase);
      setVault({ kind: "ready", seed, keypair: deriveKeypair(seed) });
    } catch (error: unknown) {
      setVault({
        kind: "locked",
        record: current.record,
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "That passphrase does not open this mailbox vault.",
      });
    }
  }

  const model = useMemo(
    () =>
      buildChatModel({
        selfAddress: address,
        sent: records.sent,
        paymentLinks: records.paymentLinks,
        otc: records.otc,
        escrow: records.escrow,
        addressBook: records.addressBook,
        aliases: records.aliases,
        readIds,
      }),
    [address, records, readIds],
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

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const activatedRef = useRef<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ChatComposerStatus>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setSelectedAddress(null);
    activatedRef.current = null;
    setEntryId(null);
    setHighlightId(null);
    setDrafts({});
    setStatus(null);
    setSending(false);
    setMobileDetailOpen(false);
    setContextOpen(false);
    setSearch("");
    setNeedsActionOnly(false);
  }, [scope]);

  useEffect(() => {
    if (
      selectedAddress &&
      visible.some((conversation) => conversation.contact.address === selectedAddress)
    ) {
      return;
    }
    setSelectedAddress(visible[0]?.contact.address ?? null);
  }, [selectedAddress, visible]);

  const conversation =
    model.conversations.find(
      (candidate) => candidate.contact.address === selectedAddress,
    ) ?? null;
  const context = useMemo(
    () =>
      conversation ? buildContactContext(conversation, records.rfqRecords) : null,
    [conversation, records.rfqRecords],
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
     first row being selected on load is not. Same rule as Mailbox. */
  useEffect(() => {
    if (!conversation || !address || !chainId) return;
    if (activatedRef.current !== conversation.contact.address) return;
    const pending = unreadItemIds(conversation).filter((id) => !readIds.has(id));
    if (!pending.length) return;
    const next = new Set(readIds);
    for (const id of pending) next.add(id);
    setReadIds(next);
    saveReadMessageIds(window.localStorage, chainId, address, next);
  }, [address, chainId, conversation, readIds]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const conversationAddress = conversation?.contact.address ?? null;
  const conversationLength = conversation?.items.length ?? 0;
  useEffect(() => {
    if (highlightId) return;
    const frame = window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationAddress, conversationLength, highlightId]);

  useEffect(() => {
    if (!highlightId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(chatEntryDomId(highlightId))?.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
    const timer = window.setTimeout(() => setHighlightId(null), 1_800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightId]);

  const selectConversation = useCallback((next: string) => {
    activatedRef.current = next;
    setSelectedAddress(next);
    setEntryId(null);
    setHighlightId(null);
    setStatus(null);
    setMobileDetailOpen(true);
    setContextOpen(false);
  }, []);

  function locate(itemId: string) {
    setContextOpen(false);
    setMobileDetailOpen(true);
    setHighlightId(itemId);
  }

  const keyState: ChatKeyState =
    vault.kind === "ready"
      ? { kind: "ready" }
      : vault.kind === "locked"
        ? { kind: "locked", busy: vault.busy, error: vault.error }
        : { kind: "missing" };
  const blocker = chatSendBlocker({
    helperAddress,
    networkName,
    connected: isConnected,
    hasWalletAccount: Boolean(walletAccount),
    senderAddress: address,
    isStrk20Capable,
    keyReady: vault.kind === "ready",
  });
  const draft = conversation ? (drafts[conversation.contact.address] ?? "") : "";
  const budget = useMemo(
    () => previewChatLetterBudget(draft, vault.kind === "ready"),
    [draft, vault.kind],
  );

  async function send() {
    if (
      !conversation ||
      sending ||
      blocker ||
      vault.kind !== "ready" ||
      !helperAddress ||
      !walletAccount ||
      !selectedWallet ||
      !address ||
      !chainId
    ) {
      return;
    }
    const target = conversation.contact.address;
    const body = draft;
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
          mailSeed: vault.seed,
          keypair: vault.keypair,
        },
        storage: window.localStorage,
        onPhase: (_phase, detail) =>
          setStatus((current) => ({
            kind: "sending",
            message: detail,
            startedAt: current?.startedAt ?? Date.now(),
          })),
      });
      setDrafts((current) => ({ ...current, [target]: "" }));
      setStatus({
        kind: "ok",
        message: result.localCopySaved
          ? `Sealed and confirmed in ${shortenFelt(result.transactionHash)}. The Sent copy is saved in this browser profile (not encrypted at rest).`
          : `Confirmed in ${result.transactionHash}, but the local Sent copy could not be saved: ${result.localCopyError ?? "browser storage failed"}. It will not appear here after this tab closes.`,
      });
      if (result.localCopySaved) {
        refresh();
        setHighlightId(`sent:${result.sent.documentId}`);
      }
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

  const name = conversation ? contactDisplayName(conversation.contact) : null;

  return (
    <div className={styles.page}>
      <main
        aria-label="APP20 Chat"
        className={`${styles.workspace}${mobileDetailOpen ? ` ${styles.detailOpen}` : ""}${
          contextOpen ? ` ${styles.contextOpen}` : ""
        }`}
      >
        <ChatConversationRail
          conversations={visible}
          totalCount={model.conversations.length}
          selectedAddress={selectedAddress}
          search={search}
          onSearchChange={setSearch}
          needsActionOnly={needsActionOnly}
          onNeedsActionChange={setNeedsActionOnly}
          needsActionCount={needsActionCount}
          gate={gate}
          unattributedSent={model.unattributedSent}
          onSelect={selectConversation}
        />

        <section className={styles.conversation} aria-label="Conversation">
          <header className={styles.conversationHead}>
            <button
              type="button"
              className={`${styles.headButton} ${styles.backButton}`}
              aria-label="Back to conversations"
              onClick={() => setMobileDetailOpen(false)}
            >
              ← Chats
            </button>
            <div>
              <p className={styles.kicker}>
                {conversation
                  ? "DEVICE-LOCAL RECORDS · NOT SETTLEMENT AUTHORITY"
                  : "APP20 / CHAT / ENCRYPTED CORRESPONDENCE"}
              </p>
              <strong>
                {name ? (
                  <bdi>{name}</bdi>
                ) : (
                  "Private correspondence, one counterparty at a time"
                )}
              </strong>
              {conversation ? (
                <small>
                  {conversation.items.length} record
                  {conversation.items.length === 1 ? "" : "s"} on this device ·{" "}
                  {shortenFelt(conversation.contact.address)}
                </small>
              ) : null}
            </div>
            {conversation ? (
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
            {gate ? (
              <section
                className={styles.welcome}
                aria-labelledby="chat-welcome-title"
              >
                <p className={styles.kicker}>APP20 / CHAT</p>
                <h2 id="chat-welcome-title">One counterparty, every record.</h2>
                <p>
                  Chat reads the letters, offers, invoices and escrows this
                  device already holds and groups them by counterparty. It is
                  keyed to a wallet: connect one to open it.
                </p>
                <div className={styles.connectAction}>
                  <SelectWallet />
                </div>
              </section>
            ) : conversation ? (
              <ChatTimeline
                conversation={conversation}
                aliases={records.aliases}
                highlightId={highlightId}
              />
            ) : (
              <section
                className={styles.welcome}
                aria-labelledby="chat-empty-title"
              >
                <p className={styles.kicker}>APP20 / CHAT</p>
                <h2 id="chat-empty-title">No counterparties on this device.</h2>
                <p>
                  Save a wallet under Counterparties or send a letter from
                  Mailbox; each one becomes a conversation here. Records a
                  counterparty sends you appear after Mailbox checks for mail.
                </p>
                <div className={styles.welcomeLinks}>
                  <Link to="/contacts">Counterparties</Link>
                  <Link to="/mail/inbox">Mailbox</Link>
                  <Link to="/rfq">RFQ workspace</Link>
                </div>
              </section>
            )}
          </div>

          {conversation && name ? (
            <ChatComposer
              contactName={name}
              value={draft}
              onChange={(value) =>
                setDrafts((current) => ({
                  ...current,
                  [conversation.contact.address]: value,
                }))
              }
              blocker={blocker}
              keyState={keyState}
              onUnlock={(passphrase) => void unlockVault(passphrase)}
              sending={sending}
              status={status}
              budget={budget}
              onSend={() => void send()}
            />
          ) : null}
        </section>

        {conversation && context ? (
          <ChatContextPanel
            conversation={conversation}
            context={context}
            selectedEntry={selectedEntry}
            onSelectEntry={setEntryId}
            onLocate={locate}
            selfAddress={address}
            chainId={chainId}
            handoffsEnabled={handoffsEnabled}
            aliases={records.aliases}
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
              Wallet identity, open RFQs, pending payments and escrows for the
              selected counterparty appear here.
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
