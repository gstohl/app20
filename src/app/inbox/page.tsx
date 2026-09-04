"use client";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hash, validateAndParseAddress } from "starknet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import Compose, { type SentEnvelope } from "@/components/mail/Compose";
import ConversationList from "@/components/mail/ConversationList";
import DraftList from "@/components/mail/DraftList";
import Onboard from "@/components/mail/Onboard";
import { ScanProgress } from "@/components/mail/OperationProgress";
import Thread, {
  type LocalMailMessage,
  type ThreadActionState,
} from "@/components/mail/Thread";
import {
  ADDRESS_BOOK_CHANGED_EVENT,
  loadAddressBook,
  mergeAddressBookEntries,
} from "@/lib/address-book";
import { loadAliases, type AliasRecord } from "@/lib/aliases";
import { feltEquals } from "@/lib/addresses";
import { parseCompositePayload } from "@/lib/composite";
import {
  consumeDeskHandoff,
  storeInvoiceDeskHandoff,
} from "@/lib/desk-handoff";
import {
  createBlankDraft,
  isBlankDraft,
  deleteDraft,
  loadDrafts,
  saveDraft,
  type CompositeDraft,
} from "@/lib/drafts";
import {
  decodeEnvelope,
  encodeEnvelope,
  MAX_COMPOSITE_ENVELOPE_BYTES,
} from "@/lib/envelope";
import {
  backupBlobDigest,
  createBackupPointer,
  sealBackupBlob,
  verifyBackupPointer,
} from "@/lib/backup-blob";
import {
  createIpfsBlobStore,
  createUnavailableBlobStore,
  resolveBlobStoreConfig,
  type BlobStore,
} from "@/lib/blob-store";
import {
  createBackupSnapshot,
  nextBackupSequence,
  verifyBackupSnapshot,
  type BackupKind,
} from "@/lib/backup-snapshot";
import {
  claimEscrowOperation,
  confirmEscrowOperation,
  emptyEscrowState,
  loadEscrowState,
  markEscrowOperationOutcome,
  markEscrowOperationSubmitted,
  parseEscrowClaimPayload,
  parseEscrowContractDeal,
  parseEscrowFillPayload,
  parseEscrowFundPayload,
  parseEscrowTimeoutPayload,
  recordEscrowChainDeal,
  recordEscrowFund,
  recordEscrowUpdateClaim,
  releaseEscrowOperation,
  type EscrowFundPayload,
  type EscrowState,
} from "@/lib/escrow";
import {
  buildEscrowClaimActions,
  buildEscrowFillActions,
  buildEscrowTimeoutActions,
} from "@/lib/escrow-actions";
import type {
  DecryptedMail,
  EncryptedMailRecord,
  MailKeypair,
} from "@/lib/mail";
import {
  encryptMail,
  projectEncryptedMailSize,
  publicKeyFromFelts,
} from "@/lib/mail";
import { MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE } from "@/lib/mail-authority-copy";
import {
  MAIL_SCAN_CHUNK_SIZE,
  MAIL_SCAN_MAX_PAGES,
  completeMailScan,
  loadMailScanCursor,
  mailScanCursorKey,
  normalizeContinuationToken,
  parseMailEvent,
  pauseMailScan,
  planMailScan,
  saveMailScanCursor,
  type MailEvent,
  type ParsedMailEvent,
} from "@/lib/mail-scan";
import { verifyContactSnapshot } from "@/lib/contact-backup";
import { describeMailScanCursor } from "@/lib/mail-correspondents";
import { authorizeStrk20ValueAction } from "@/lib/mainnet-safety";
import { clearLocalMailboxStorage } from "@/lib/local-mailbox-storage";
import {
  paymentLinkChainIdsEqual,
  type DecodedPaymentLink,
} from "@/lib/payment-link";
import { importPendingPaymentIntoMailbox } from "@/lib/payment-link-handoff";
import {
  loadPendingPayment,
  PENDING_PAYMENT_STORAGE_KEY,
} from "@/lib/pending-payment";
import {
  acceptPayloadForOffer,
  claimOtcAccept,
  claimMatureInvoicePayment,
  claimPayment,
  confirmOtcAccept,
  confirmPayment,
  emptyOtcState,
  expireStoredDeals,
  loadOtcState,
  markOtcAcceptOutcome,
  markOtcAcceptSubmitted,
  markPaymentOutcome,
  markPaymentSubmitted,
  parseAcceptPayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
  receiptForTransfer,
  recordDealEvent,
  recordPaymentRequest,
  recordUnverifiedPaymentClaim,
  releaseOtcAccept,
  releasePayment,
  resolvePaymentRequestTokenForChain,
  type AcceptPayload,
  type OfferPayload,
  type OtcState,
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  computeActionId,
  APP20_HELPER_FUNDING_BASE_UNITS,
  assertPrivateStrk20BatchBalance,
  strk20ErrorMessage,
  submitActions,
  transactionHashFromError,
  transactionStateFromError,
  submitMail,
  submitMemoTransfer,
  submitOtcAccept,
} from "@/lib/strk20";
import { loadSentMail, saveSentMail } from "@/lib/sent-mail";
import { createIndexedDbRfqStorage } from "@/app/rfq/rfq-storage";
import {
  consumePendingRfqHistoryAutoBackup,
  RFQ_AUTO_BACKUP_REQUESTED_EVENT,
} from "@/app/rfq/ui/rfq-auto-backup";
import {
  exportRfqHistory,
  importRfqHistory,
  isRfqHistoryAutoBackupEnabled,
  setRfqHistoryAutoBackupEnabled,
} from "@/lib/rfq-history-backup";
import {
  loadMailAssignments,
  saveMailAssignment,
  type MailAssignment,
} from "@/lib/mail-assignments";
import { assembleConversation } from "@/lib/mail-thread";
import { evaluateSenderProof, type SenderProof } from "@/lib/sender-proof";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import * as constants from "@/utils/constants";
import styles from "@/components/mail/mail.module.css";

import {
  TYPE_FILTERS,
  MAIL_FOLDERS,
  type MailFolder,
  type MailboxFilter,
  type ScanKind,
  type ScanWorkerResponse,
  type ActiveScanWorker,
  helperForNetwork,
  escrowForNetwork,
  loadPersistedMailSeed,
  mailKeyFingerprint,
  mergeMailMessages,
  mergeDisplayAliases,
  newestBackupMessages,
  loadBackupSnapshotWithFallback,
  sortMailMessages,
  storedSentToLocal,
  paymentLinkToLocal,
  paymentLinkRecords,
  draftMatchesFilter,
  mailboxMatchesFilter,
  partitionMailboxFolders,
  countMailboxFilterHits,
  countDraftFilterHits,
  parseBlockTimestamp,
} from "./mailbox-model";

export default function InboxPage() {
  const navigate = useNavigate();
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const [keypair, setKeypair] = useState<MailKeypair | null>(null);
  const [mailSeed, setMailSeed] = useState<Uint8Array | null>(null);
  const [messages, setMessages] = useState<LocalMailMessage[]>([]);
  const [aliases, setAliases] = useState<AliasRecord[]>([]);
  const [bookEntries, setBookEntries] = useState<
    { address: string; label: string; addedAt: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      if (!address) {
        setBookEntries([]);
        return;
      }
      void loadAddressBook(window.localStorage, address)
        .then((entries) => {
          if (cancelled) return;
          setBookEntries(
            entries.map((entry) => ({
              address: entry.address,
              label: entry.label,
              addedAt: entry.updatedAt,
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setBookEntries([]);
        });
    };
    reload();
    window.addEventListener(ADDRESS_BOOK_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(ADDRESS_BOOK_CHANGED_EVENT, reload);
    };
  }, [address]);

  const displayAliases = useMemo(
    () => mergeDisplayAliases(bookEntries, aliases),
    [aliases, bookEntries],
  );
  const [otcState, setOtcState] = useState<OtcState>(emptyOtcState());
  const [escrowState, setEscrowState] =
    useState<EscrowState>(emptyEscrowState());
  const [actionStates, setActionStates] = useState<
    Record<string, ThreadActionState>
  >({});
  const [scanning, setScanning] = useState(false);
  const [scanKind, setScanKind] = useState<ScanKind>("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [scanProgress, setScanProgress] = useState({
    pages: 0,
    events: 0,
    maxPages: MAIL_SCAN_MAX_PAGES,
  });
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [messageActivation, setMessageActivation] = useState(0);
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [mailFolder, setMailFolder] = useState<MailFolder>("inbox");
  const [mailboxFilter, setMailboxFilter] = useState<MailboxFilter>("all");
  const [drafts, setDrafts] = useState<CompositeDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [pendingPayment, setPendingPayment] =
    useState<DecodedPaymentLink | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSidebarMode, setMobileSidebarMode] = useState(false);
  const [storageNotice, setStorageNotice] = useState<{
    kind: "ok" | "error";
    message: string;
    /* A gate that names a missing wallet has to offer the wallet, or the
       notice is a dead end: the only connect control lives in the app header. */
    action?: "connect-wallet";
  } | null>(null);
  const [assignments, setAssignments] = useState<
    Record<string, MailAssignment>
  >({});
  const [proofs, setProofs] = useState<Record<string, SenderProof>>({});
  const [invoiceMaturityHeadBlock, setInvoiceMaturityHeadBlock] = useState<
    number | undefined
  >();
  const [rfqAutoBackupEnabled, setRfqAutoBackupEnabled] = useState(false);
  const [rfqAutoBackupSignal, setRfqAutoBackupSignal] = useState(0);

  const helperAddress = helperForNetwork(providerIndex);
  const escrowAddress = escrowForNetwork(providerIndex);
  const escrowEnabled =
    providerIndex === constants.LOCALNET_PROVIDER_INDEX &&
    constants.localnetWalletEnabled &&
    escrowAddress !== null;
  const networkName = constants.Strk20Networks[providerIndex] ?? "this network";
  const draftScopeChain = chainId ?? `network-${providerIndex}`;
  const draftScopeAddress = address || "unconnected";
  const keyFingerprint = mailKeyFingerprint(keypair);
  const scanIdentity = [
    providerIndex,
    chainId,
    address,
    helperAddress,
    keyFingerprint,
  ].join(":");
  const scanGenerationRef = useRef(0);
  const scanIdentityRef = useRef(scanIdentity);
  const recentLoadedRef = useRef(false);
  const scanWorkerRef = useRef<ActiveScanWorker | null>(null);
  const escrowRefreshRef = useRef(0);
  const readingPaneRef = useRef<HTMLElement | null>(null);
  const readingScrollRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement | null>(null);
  const sidebarWasOpenRef = useRef(false);
  const activatedMessageIdRef = useRef<string | null>(null);
  const contactHandoffRef = useRef("");
  const rfqAutoBackupPostingRef = useRef(false);
  scanIdentityRef.current = scanIdentity;

  useEffect(() => {
    const notify = () => setRfqAutoBackupSignal((value) => value + 1);
    window.addEventListener(RFQ_AUTO_BACKUP_REQUESTED_EVENT, notify);
    return () =>
      window.removeEventListener(RFQ_AUTO_BACKUP_REQUESTED_EVENT, notify);
  }, []);

  useEffect(() => {
    if (!address || !chainId) return;
    let url: URL;
    try {
      url = new URL(window.location.href);
    } catch {
      return;
    }
    const queryRecipient = url.searchParams.get("recipient");
    if (queryRecipient) {
      url.searchParams.delete("recipient");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    const recipientInput = consumeDeskHandoff(window.sessionStorage, "mail", {
      account: address,
      chainId,
    });
    if (!recipientInput) return;
    let recipient: string;
    try {
      recipient = validateAndParseAddress(recipientInput);
    } catch {
      setStorageNotice({
        kind: "error",
        message:
          "The Counterparties link contained an invalid Starknet address.",
      });
      return;
    }
    const handoffKey = `${chainId}:${address}:${recipient}`;
    if (contactHandoffRef.current === handoffKey) return;
    contactHandoffRef.current = handoffKey;
    const draft = { ...createBlankDraft(), recipient };
    setDrafts(saveDraft(window.localStorage, chainId, address, draft));
    setMailFolder("drafts");
    setMailboxFilter("all");
    setSelectedDraftId(draft.id);
    setComposerOpen(true);
    setMobileDetailOpen(true);
    setSidebarOpen(false);
  }, [address, chainId]);

  useEffect(() => {
    /* Matches the breakpoint where mail.module.css turns the sidebar into a
       drawer; if these drift, a closed drawer stays focusable off-screen. */
    const query = window.matchMedia("(max-width: 1179px)");
    const update = () => setMobileSidebarMode(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileSidebarMode) {
      sidebarWasOpenRef.current = false;
      return;
    }
    if (!sidebarOpen) {
      if (sidebarWasOpenRef.current) {
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
      sidebarWasOpenRef.current = false;
      return;
    }

    sidebarWasOpenRef.current = true;
    const frame = window.requestAnimationFrame(() =>
      sidebarCloseRef.current?.focus(),
    );
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href]",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileSidebarMode, sidebarOpen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      readingScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    composerOpen,
    keyFingerprint,
    mailFolder,
    selectedDraftId,
    selectedMessageId,
  ]);

  function cancelActiveScanWorker() {
    const active = scanWorkerRef.current;
    if (!active) return;
    scanWorkerRef.current = null;
    active.reject(new Error("Mail scan cancelled."));
  }

  function decryptMailRecords(
    privateKey: Uint8Array,
    records: EncryptedMailRecord[],
  ): Promise<DecryptedMail[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(
        new URL("../../workers/mail-scan.worker.ts", import.meta.url),
        { type: "module" },
      );

      function finish() {
        worker.terminate();
        if (scanWorkerRef.current === active) scanWorkerRef.current = null;
      }

      function settle(action: () => void) {
        if (settled) return;
        settled = true;
        finish();
        action();
      }

      const active: ActiveScanWorker = {
        worker,
        reject: (error) => settle(() => reject(error)),
      };
      scanWorkerRef.current = active;

      worker.onmessage = (event: MessageEvent<ScanWorkerResponse>) => {
        settle(() => {
          if (event.data.ok) resolve(event.data.decrypted);
          else reject(new Error(event.data.message));
        });
      };
      worker.onerror = () => {
        settle(() => {
          reject(new Error("The background mailbox scanner failed."));
        });
      };
      worker.postMessage({ privateKey, records });
    });
  }

  useEffect(() => {
    scanGenerationRef.current += 1;
    escrowRefreshRef.current += 1;
    cancelActiveScanWorker();
    recentLoadedRef.current = false;
    setScanning(false);
    setKeypair(null);
    setMailSeed(null);
    setMessages([]);
    setDrafts([]);
    setMailFolder("inbox");
    setMailboxFilter("all");
    setSelectedDraftId(null);
    setScanKind("idle");
    setScanMessage("");
    setScanProgress({ pages: 0, events: 0, maxPages: MAIL_SCAN_MAX_PAGES });
    setSelectedMessageId(null);
    activatedMessageIdRef.current = null;
    setReadMessageIds(new Set());
    setComposerOpen(false);
    setMobileDetailOpen(false);
    setSidebarOpen(false);
    setActionStates({});
    setStorageNotice(null);
    if (address && chainId) {
      setAliases(loadAliases(window.localStorage, address));
      const storedOtc = expireStoredDeals(
        window.localStorage,
        chainId,
        address,
      );
      setMessages(
        mergeMailMessages(
          [],
          [
            ...loadSentMail(window.localStorage, chainId, address).map(
              storedSentToLocal,
            ),
            ...paymentLinkRecords(storedOtc).map((payment) =>
              paymentLinkToLocal(
                payment.request,
                payment.updatedAt,
                payment.linkAuthenticity,
              ),
            ),
          ],
        ),
      );
      setDrafts(loadDrafts(window.localStorage, chainId, address));
      setAssignments(
        loadMailAssignments(window.localStorage, chainId, address),
      );
      setProofs({});
      setOtcState(storedOtc);
      setEscrowState(loadEscrowState(window.localStorage, chainId, address));
    } else {
      setAliases([]);
      setDrafts(
        loadDrafts(
          window.localStorage,
          `network-${providerIndex}`,
          "unconnected",
        ),
      );
      setOtcState(emptyOtcState());
      setEscrowState(emptyEscrowState());
      setAssignments({});
      setProofs({});
    }
    return () => {
      scanGenerationRef.current += 1;
      escrowRefreshRef.current += 1;
      cancelActiveScanWorker();
    };
  }, [address, chainId, providerIndex]);

  useEffect(() => {
    try {
      const pending = loadPendingPayment(window.sessionStorage);
      if (!pending) return;
      const message = paymentLinkToLocal(
        pending.request,
        undefined,
        pending.authenticity,
      );
      setPendingPayment(pending);
      setMessages((current) => mergeMailMessages(current, [message]));
      setMailFolder("inbox");
      setMailboxFilter("invoices");
      setSelectedMessageId(message.id);
      setComposerOpen(false);
      setMobileDetailOpen(true);
    } catch {
      // /pay already reports blocked session storage. Do not invent a request.
    }
  }, []);

  useEffect(() => {
    if (!pendingPayment || !address || !chainId) return;
    const actionKey = `payment:${pendingPayment.request.requestId}`;
    try {
      const imported = importPendingPaymentIntoMailbox(
        window.sessionStorage,
        window.localStorage,
        chainId,
        address,
      );
      if (!imported) {
        setPendingPayment(null);
        return;
      }
      setOtcState(expireStoredDeals(window.localStorage, chainId, address));
      const message = paymentLinkToLocal(
        imported.request,
        imported.updatedAt,
        imported.linkAuthenticity,
      );
      setMessages((current) => mergeMailMessages(current, [message]));
      setPendingPayment(null);
      setMailFolder("inbox");
      setMailboxFilter("invoices");
      setSelectedMessageId(message.id);
      setActionState(actionKey, {
        pending: false,
        message:
          imported.linkAuthenticity?.kind === "verified"
            ? "Verified Mail-signed link imported for local review. No payment was submitted."
            : "Unverified legacy link imported for local review. No payment was submitted.",
      });
    } catch (error: unknown) {
      setActionState(actionKey, {
        pending: false,
        message:
          error instanceof Error
            ? `${error.message} No payment was submitted.`
            : "The payment link could not be imported. No payment was submitted.",
      });
    }
  }, [address, chainId, pendingPayment]);

  useEffect(() => {
    if (!address || !chainId) {
      setRfqAutoBackupEnabled(false);
      return;
    }
    const enabled = isRfqHistoryAutoBackupEnabled(
      window.localStorage,
      chainId,
      address,
    );
    if (enabled !== rfqAutoBackupEnabled) setRfqAutoBackupEnabled(enabled);
  }, [address, chainId, rfqAutoBackupEnabled]);

  useEffect(() => {
    const awaiting = Object.values(otcState.payments).some(
      (payment) => payment.paymentOperation?.state === "awaiting-note-maturity",
    );
    if (!address || !chainId || !awaiting) {
      setInvoiceMaturityHeadBlock(undefined);
      return;
    }
    let cancelled = false;
    const provider = constants.myFrontendProviders[providerIndex];
    const refresh = async () => {
      try {
        const head = await provider.getBlockNumber();
        if (!cancelled && Number.isSafeInteger(head) && head >= 0) {
          setInvoiceMaturityHeadBlock(head);
        }
      } catch {
        if (!cancelled) setInvoiceMaturityHeadBlock(undefined);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [address, chainId, otcState, providerIndex]);

  const mailboxView = useMemo(() => {
    const authenticatedBackupIds = new Set(
      address && chainId && helperAddress && mailSeed && keyFingerprint
        ? newestBackupMessages(messages, {
            mailboxSeed: mailSeed,
            context: {
              owner: address,
              chainId,
              helperAddress,
              mailboxFingerprint: keyFingerprint,
            },
          }).map((message) => message.id)
        : [],
    );
    const visibleMessages = sortMailMessages(
      messages.filter(
        (message) =>
          (message.envelope.type !== "backup_snapshot" &&
            message.envelope.type !== "backup_pointer") ||
          authenticatedBackupIds.has(message.id),
      ),
    );
    const folders = partitionMailboxFolders(visibleMessages);
    const folderMessages = mailFolder === "sent" ? folders.sent : folders.inbox;
    const typeCounts =
      mailFolder === "drafts"
        ? countDraftFilterHits(drafts)
        : countMailboxFilterHits(folderMessages);
    const filteredMessages =
      mailboxFilter === "all"
        ? folderMessages
        : folderMessages.filter((message) =>
            mailboxMatchesFilter(message, mailboxFilter),
          );
    const filteredDrafts =
      mailboxFilter === "all"
        ? drafts
        : drafts.filter((draft) => draftMatchesFilter(draft, mailboxFilter));
    const allAnnotatedMessages = visibleMessages.map((message) => ({
      ...message,
      assignedAddress: assignments[message.id]?.address,
      localConversationId: assignments[message.id]?.conversationId,
    }));
    const visibleIds = new Set(filteredMessages.map((message) => message.id));
    const annotatedMessages = allAnnotatedMessages.filter((message) =>
      visibleIds.has(message.id),
    );
    return {
      folderCounts: {
        inbox: folders.inbox.length,
        sent: folders.sent.length,
        drafts: drafts.length,
      } satisfies Record<MailFolder, number>,
      typeCounts,
      filteredMessages,
      filteredDrafts,
      allAnnotatedMessages,
      annotatedMessages,
    };
  }, [
    address,
    assignments,
    chainId,
    drafts,
    helperAddress,
    keyFingerprint,
    mailFolder,
    mailboxFilter,
    mailSeed,
    messages,
  ]);

  useEffect(() => {
    if (mailFolder === "drafts") {
      const visibleDrafts = mailboxView.filteredDrafts;
      if (
        selectedDraftId &&
        visibleDrafts.some((draft) => draft.id === selectedDraftId)
      ) {
        return;
      }
      setSelectedDraftId(visibleDrafts[0]?.id ?? null);
      return;
    }
    const visibleMessages = mailboxView.filteredMessages;
    if (
      selectedMessageId &&
      visibleMessages.some((message) => message.id === selectedMessageId)
    ) {
      return;
    }
    setSelectedMessageId(visibleMessages[0]?.id ?? null);
  }, [
    mailFolder,
    mailboxView.filteredDrafts,
    mailboxView.filteredMessages,
    selectedDraftId,
    selectedMessageId,
  ]);

  useEffect(() => {
    const messageId = selectedMessageId;
    if (
      !messageId ||
      composerOpen ||
      activatedMessageIdRef.current !== messageId
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const pane = readingPaneRef.current;
      if (!pane || pane.getClientRects().length === 0) return;
      setReadMessageIds((current) => {
        if (current.has(messageId)) return current;
        const next = new Set(current);
        next.add(messageId);
        return next;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerOpen, messageActivation, mobileDetailOpen, selectedMessageId]);

  function setActionState(key: string, state: ThreadActionState) {
    setActionStates((current) => ({ ...current, [key]: state }));
  }

  function refreshOtcState() {
    if (!address || !chainId) return;
    setOtcState(expireStoredDeals(window.localStorage, chainId, address));
  }

  function refreshEscrowState() {
    if (!address || !chainId) return;
    setEscrowState(loadEscrowState(window.localStorage, chainId, address));
  }

  async function refreshEscrowChainDeals() {
    if (!address || !chainId || !escrowAddress) return;
    const generation = escrowRefreshRef.current;
    const scopeAddress = address;
    const scopeChainId = chainId;
    const state = loadEscrowState(
      window.localStorage,
      scopeChainId,
      scopeAddress,
    );
    const provider = constants.myFrontendProviders[providerIndex];
    await Promise.all(
      Object.values(state.deals).map(async (record) => {
        if (!feltEquals(record.fund.escrowAddress, escrowAddress)) {
          return undefined;
        }
        try {
          const result = await provider.callContract({
            contractAddress: escrowAddress,
            entrypoint: "get_deal",
            calldata: [record.dealId],
          });
          recordEscrowChainDeal(
            window.localStorage,
            scopeChainId,
            scopeAddress,
            record.dealId,
            parseEscrowContractDeal(result),
          );
        } catch {
          // A failed/mismatched read never upgrades an encrypted claim to proof.
        }
        return undefined;
      }),
    );
    if (
      generation === escrowRefreshRef.current &&
      address === scopeAddress &&
      chainId === scopeChainId
    ) {
      refreshEscrowState();
    }
  }

  function requireActionContext() {
    if (!helperAddress) throw new Error("Mail is unavailable on this network.");
    if (
      !walletAccount ||
      !selectedWallet ||
      !address ||
      !chainId ||
      !isStrk20Capable
    ) {
      throw new Error(
        "Connect a wallet that exposes the dapp-facing STRK20 API first.",
      );
    }
    const policy = () =>
      assertWalletOperationPolicy(
        selectedWallet,
        providerIndex as 0 | 2 | 3,
        "mail",
      );
    policy();
    return {
      helperAddress,
      walletAccount,
      provider: constants.myFrontendProviders[providerIndex],
      address,
      chainId,
      policy,
    };
  }

  async function authorizeValueAction(
    context: ReturnType<typeof requireActionContext>,
    action: string,
    amount: string,
    privateBatchAmounts: readonly (string | bigint)[],
    tokenAddress = constants.addrSTRK,
  ) {
    const poolAddress = constants.strk20PoolForProviderIndex(providerIndex);
    if (!poolAddress) {
      throw new Error("The STRK20 pool is not configured for this network.");
    }
    context.policy();
    await assertPrivateStrk20BatchBalance(
      context.walletAccount,
      tokenAddress,
      privateBatchAmounts,
    );
    await authorizeStrk20ValueAction({
      provider: context.provider,
      poolAddress,
      accountAddress: context.address,
      network: networkName,
      action,
      amount: BigInt(amount),
    });
  }

  async function lookupMailKey(helper: string, recipient: string) {
    const provider = constants.myFrontendProviders[providerIndex];
    const registered = await provider.callContract({
      contractAddress: helper,
      entrypoint: "get_pubkey",
      calldata: [validateAndParseAddress(recipient)],
    });
    if (
      registered.length !== 2 ||
      (BigInt(registered[0]) === 0n && BigInt(registered[1]) === 0n)
    ) {
      throw new Error("The response recipient has not registered a mail key.");
    }
    return publicKeyFromFelts(registered);
  }

  function mergeLocalDealState(localMessages: LocalMailMessage[]) {
    if (!address || !chainId) return;

    for (const message of [...localMessages].reverse()) {
      try {
        const { envelope } = message;
        if (envelope.type === "composite") {
          const composite = parseCompositePayload(envelope.payload);
          if (!composite) continue;
          for (const attachment of composite.attachments) {
            if (attachment.type === "offer") {
              recordDealEvent(window.localStorage, chainId, address, {
                type: "offer",
                payload: attachment.payload,
              });
            } else if (attachment.type === "payment_request") {
              recordPaymentRequest(
                window.localStorage,
                chainId,
                address,
                attachment.payload,
              );
            } else if (attachment.type === "escrow_fund") {
              recordEscrowFund(
                window.localStorage,
                chainId,
                address,
                attachment.payload,
              );
            }
          }
        } else if (envelope.type === "offer") {
          const offer = parseOfferPayload(envelope.payload);
          if (offer) {
            recordDealEvent(window.localStorage, chainId, address, {
              type: "offer",
              payload: offer,
            });
          }
        } else if (envelope.type === "accept") {
          const accept = parseAcceptPayload(envelope.payload);
          if (!accept) continue;
          const state = loadOtcState(window.localStorage, chainId, address);
          if (state.deals[accept.dealId]) {
            recordDealEvent(window.localStorage, chainId, address, {
              type: "accept_claim",
              payload: accept,
            });
          } else if (state.payments[accept.dealId]) {
            recordUnverifiedPaymentClaim(
              window.localStorage,
              chainId,
              address,
              accept,
            );
          }
        } else if (envelope.type === "decline") {
        } else if (envelope.type === "receipt") {
          const receipt = parseReceiptPayload(envelope.payload);
          if (receipt) {
            recordDealEvent(window.localStorage, chainId, address, {
              type: "receipt_claim",
              payload: receipt,
            });
          }
        } else if (envelope.type === "payment_request") {
          const request = parsePaymentRequestPayload(envelope.payload);
          if (request) {
            recordPaymentRequest(
              window.localStorage,
              chainId,
              address,
              request,
            );
          }
        } else if (envelope.type === "escrow_fund") {
          const fund = parseEscrowFundPayload(envelope.payload);
          if (fund) {
            recordEscrowFund(window.localStorage, chainId, address, fund);
          }
        } else if (envelope.type === "escrow_fill") {
          const update = parseEscrowFillPayload(envelope.payload);
          if (update) {
            recordEscrowUpdateClaim(
              window.localStorage,
              chainId,
              address,
              "fill",
              update,
            );
          }
        } else if (envelope.type === "escrow_claim") {
          const update = parseEscrowClaimPayload(envelope.payload);
          if (update) {
            recordEscrowUpdateClaim(
              window.localStorage,
              chainId,
              address,
              "claim",
              update,
            );
          }
        } else if (envelope.type === "escrow_timeout") {
          const update = parseEscrowTimeoutPayload(envelope.payload);
          if (update) {
            recordEscrowUpdateClaim(
              window.localStorage,
              chainId,
              address,
              "timeout",
              update,
            );
          }
        }
      } catch {
        // A malformed or out-of-order payload cannot poison the local inbox.
      }
    }
    refreshOtcState();
    refreshEscrowState();
    void refreshEscrowChainDeals();
  }

  function handleKeyReady(nextKeypair: MailKeypair, nextSeed?: Uint8Array) {
    scanGenerationRef.current += 1;
    escrowRefreshRef.current += 1;
    cancelActiveScanWorker();
    recentLoadedRef.current = false;
    setScanning(false);
    setMessages(
      address && chainId
        ? mergeMailMessages(
            [],
            [
              ...loadSentMail(window.localStorage, chainId, address).map(
                storedSentToLocal,
              ),
              ...paymentLinkRecords(
                expireStoredDeals(window.localStorage, chainId, address),
              ).map((payment) =>
                paymentLinkToLocal(
                  payment.request,
                  payment.updatedAt,
                  payment.linkAuthenticity,
                ),
              ),
            ],
          )
        : [],
    );
    setScanKind("idle");
    setScanMessage("");
    setScanProgress({ pages: 0, events: 0, maxPages: MAIL_SCAN_MAX_PAGES });
    setKeypair(nextKeypair);
    setMailSeed(
      nextSeed ??
        (address && chainId
          ? loadPersistedMailSeed(window.localStorage, chainId, address)
          : null),
    );
    // A counterparty can advance an escrow while this mailbox is inactive.
    // Refresh contract state when its device key is loaded so maker actions
    // (notably Claim after Fill) do not remain stuck on a stale local snapshot.
    void refreshEscrowChainDeals();
  }

  async function scanInbox(requested: "newer" | "older" = "newer") {
    if (!keypair) {
      setScanKind("error");
      setScanMessage("Load this device's mail key before scanning.");
      return;
    }
    if (!helperAddress) {
      setScanKind("error");
      setScanMessage(`No mail helper is configured on ${networkName}.`);
      return;
    }
    if (!address || !chainId || !keyFingerprint) {
      setScanKind("error");
      setScanMessage("Connect the mailbox account before scanning.");
      return;
    }

    const generation = ++scanGenerationRef.current;
    cancelActiveScanWorker();
    const identity = scanIdentity;
    const privateKey = keypair.privateKey;
    const isCurrentScan = () =>
      generation === scanGenerationRef.current &&
      identity === scanIdentityRef.current;

    setScanning(true);
    setScanKind("scanning");
    setScanProgress({ pages: 0, events: 0, maxPages: MAIL_SCAN_MAX_PAGES });
    setScanMessage(
      requested === "older"
        ? "Planning a bounded older-message scan…"
        : "Planning a bounded recent-message scan…",
    );

    try {
      const provider = constants.myFrontendProviders[providerIndex];
      const selector = hash.getSelectorFromName("MessagePosted");
      const latestBlock = await provider.getBlockNumber();
      if (!isCurrentScan()) return;

      const cursorKey = mailScanCursorKey(
        chainId,
        address,
        helperAddress,
        keyFingerprint,
      );
      const cursor = loadMailScanCursor(window.localStorage, cursorKey);
      const range = planMailScan(
        cursor,
        latestBlock,
        requested,
        recentLoadedRef.current,
      );
      if (!range) {
        setScanKind("ok");
        setScanMessage(
          requested === "older"
            ? "The persisted mailbox cursor has reached genesis."
            : "No newer blocks are available; the bounded recent scan is current.",
        );
        return;
      }

      setScanMessage(
        `Scanning ${range.direction} blocks ${range.fromBlock}–${range.toBlock} in bounded pages…`,
      );
      const parsed: ParsedMailEvent[] = [];
      const seenTokens = new Set<string>();
      let continuationToken = range.continuationToken;
      if (continuationToken) seenTokens.add(continuationToken);
      let pages = 0;

      while (pages < MAIL_SCAN_MAX_PAGES) {
        const chunk = await provider.getEvents({
          address: helperAddress,
          from_block: { block_number: range.fromBlock },
          to_block: { block_number: range.toBlock },
          keys: [[selector]],
          chunk_size: MAIL_SCAN_CHUNK_SIZE,
          ...(continuationToken
            ? { continuation_token: continuationToken }
            : {}),
        });
        if (!isCurrentScan()) return;
        if (
          !Array.isArray(chunk.events) ||
          chunk.events.length > MAIL_SCAN_CHUNK_SIZE
        ) {
          throw new Error("The RPC exceeded the bounded mail event page size.");
        }

        for (const rpcEvent of chunk.events) {
          const event = parseMailEvent(rpcEvent as MailEvent);
          if (event) parsed.push(event);
        }
        pages += 1;
        setScanProgress({
          pages,
          events: parsed.length,
          maxPages: MAIL_SCAN_MAX_PAGES,
        });

        const nextToken = normalizeContinuationToken(chunk.continuation_token);
        if (!nextToken) {
          continuationToken = undefined;
          break;
        }
        if (seenTokens.has(nextToken)) {
          throw new Error("The RPC repeated an event continuation token.");
        }
        seenTokens.add(nextToken);
        continuationToken = nextToken;
      }

      setScanMessage(
        `Decrypting ${parsed.length} public record${parsed.length === 1 ? "" : "s"} locally…`,
      );
      const decrypted = await decryptMailRecords(
        privateKey,
        parsed.map((event) => event.record),
      );
      if (!isCurrentScan()) return;
      setScanMessage("Loading public timestamps…");

      // Fetch every processed public event block so timestamp requests do not
      // reveal which bounded records matched this device's private key.
      const eventBlockNumbers = [
        ...new Set(
          parsed
            .map((event) => event.blockNumber)
            .filter(
              (blockNumber): blockNumber is number => blockNumber !== undefined,
            ),
        ),
      ];
      const timestampEntries = await Promise.all(
        eventBlockNumbers.map(async (blockNumber) => {
          try {
            const block = await provider.getBlockWithTxHashes(blockNumber);
            const timestamp = parseBlockTimestamp(
              (block as { timestamp?: unknown }).timestamp,
            );
            return timestamp === undefined
              ? null
              : ([blockNumber, timestamp] as const);
          } catch {
            return null;
          }
        }),
      );
      if (!isCurrentScan()) return;

      const timestampsByBlock = new Map(
        timestampEntries.filter(
          (entry): entry is readonly [number, number] => entry !== null,
        ),
      );
      const localMessages = sortMailMessages(
        decrypted.map((message) => {
          const event = parsed[message.index];
          return {
            id: `${event.transactionHash}:${event.eventIndex ?? event.index}`,
            index: event.index,
            plaintext: message.plaintext,
            envelope: message.envelope,
            record: event.record,
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
            blockTimestamp:
              event.blockNumber === undefined
                ? undefined
                : timestampsByBlock.get(event.blockNumber),
            eventIndex: event.eventIndex,
          } satisfies LocalMailMessage;
        }),
      );

      const nextCursor = continuationToken
        ? pauseMailScan(cursor, range, continuationToken)
        : completeMailScan(cursor, range);
      saveMailScanCursor(window.localStorage, cursorKey, nextCursor);
      if (!continuationToken && range.toBlock === latestBlock) {
        recentLoadedRef.current = true;
      }
      if (!isCurrentScan()) return;

      setMessages((current) => mergeMailMessages(current, localMessages));
      mergeLocalDealState(localMessages);
      setScanKind("ok");
      setScanMessage(
        `Decrypted ${localMessages.length} of ${parsed.length} valid ciphertext event${
          parsed.length === 1 ? "" : "s"
        } across ${pages} bounded page${pages === 1 ? "" : "s"}.${
          continuationToken
            ? " Page budget reached; scan again to resume the persisted continuation token."
            : " Cursor saved."
        }`,
      );
    } catch (error: unknown) {
      if (isCurrentScan()) {
        setScanKind("error");
        setScanMessage(
          error instanceof Error ? error.message : "Mailbox scan failed.",
        );
      }
    } finally {
      if (isCurrentScan()) setScanning(false);
    }
  }

  async function readLocalBackupConfig(): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const configUrl =
        import.meta.env.VITE_E2E_WALLET === true
          ? `${import.meta.env.VITE_LOCALNET_WALLET_URL}/config`
          : "/config";
      const response = await fetch(configUrl, {
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      });
      if (!response.ok || !response.body) {
        throw new Error(
          `Local configuration returned HTTP ${response.status}.`,
        );
      }
      const declaredHeader = response.headers.get("content-length");
      if (
        declaredHeader !== null &&
        (!/^(?:0|[1-9][0-9]*)$/.test(declaredHeader) ||
          Number(declaredHeader) > 64 * 1_024)
      ) {
        throw new Error("Local configuration has an invalid response length.");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        if (total > 64 * 1_024) {
          await reader.cancel();
          throw new Error("Local configuration exceeds the response limit.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Local configuration is malformed.");
      }
      const result = (parsed as Record<string, unknown>).result;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Local configuration result is malformed.");
      }
      return Object.fromEntries(Object.entries(result));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function inboxBlobStore(): Promise<BlobStore> {
    const localnet = providerIndex === constants.LOCALNET_PROVIDER_INDEX;
    try {
      const env: Record<string, unknown> = {
        VITE_IPFS_RPC_ORIGIN: import.meta.env.VITE_IPFS_RPC_ORIGIN,
        VITE_IPFS_GATEWAY_ORIGINS: import.meta.env.VITE_IPFS_GATEWAY_ORIGINS,
      };
      const resolution = resolveBlobStoreConfig({
        localnetConfig: localnet ? await readLocalBackupConfig() : undefined,
        env,
      });
      return resolution.available
        ? createIpfsBlobStore({
            rpcOrigin: resolution.rpcOrigin,
            gatewayOrigins: resolution.gatewayOrigins,
          })
        : createUnavailableBlobStore(resolution.reason);
    } catch (error: unknown) {
      return createUnavailableBlobStore(
        error instanceof Error
          ? `Backup blob storage is unavailable: ${error.message}`
          : "Backup blob storage is unavailable.",
      );
    }
  }

  async function postAuthenticatedBackup(
    kind: BackupKind,
    payload: unknown,
    itemCount: number,
  ) {
    const actionKey = `${kind}:backup`;
    try {
      const context = requireActionContext();
      if (!keypair || !mailSeed || !keyFingerprint) {
        throw new Error(
          "Unlock the mailbox and save its recovery phrase before backing up.",
        );
      }
      setActionState(actionKey, {
        pending: true,
        message: "Authenticating and sizing the versioned backup snapshot…",
        startedAt: Date.now(),
      });
      const seq = nextBackupSequence(window.localStorage, {
        owner: context.address,
        chainId: context.chainId,
        helperAddress: context.helperAddress,
        mailboxFingerprint: keyFingerprint,
        kind,
      });
      const snapshot = createBackupSnapshot({
        owner: context.address,
        chainId: context.chainId,
        helperAddress: context.helperAddress,
        mailboxFingerprint: keyFingerprint,
        mailboxSeed: mailSeed,
        kind,
        seq,
        payload,
      });
      const inline = encodeEnvelope("backup_snapshot", snapshot);
      let envelope = inline;
      let external = false;
      if (
        inline.length > MAX_COMPOSITE_ENVELOPE_BYTES ||
        !projectEncryptedMailSize(inline.length, 1).fits
      ) {
        const store = await inboxBlobStore();
        const blob = await sealBackupBlob({
          mailboxSeed: mailSeed,
          owner: context.address,
          chainId: context.chainId,
          kind,
          seq,
          bytes: inline,
        });
        const { cid } = await store.put(blob);
        envelope = encodeEnvelope(
          "backup_pointer",
          createBackupPointer({
            owner: context.address,
            chainId: context.chainId,
            helperAddress: context.helperAddress,
            mailboxFingerprint: keyFingerprint,
            mailboxSeed: mailSeed,
            kind,
            seq,
            cid,
            bucketBytes: blob.length,
            blobDigest: backupBlobDigest(blob),
          }),
        );
        if (
          envelope.length > MAX_COMPOSITE_ENVELOPE_BYTES ||
          !projectEncryptedMailSize(envelope.length, 1).fits
        ) {
          throw new Error(
            "The verified backup pointer exceeds one Mail letter.",
          );
        }
        external = true;
      }
      await authorizeValueAction(
        context,
        `Back up ${kind === "contacts" ? "contacts" : "RFQ history"} to encrypted Mail`,
        APP20_HELPER_FUNDING_BASE_UNITS.toString(),
        [APP20_HELPER_FUNDING_BASE_UNITS],
      );
      const record = await encryptMail(keypair.publicKey, envelope);
      const result = await submitMail({
        account: context.walletAccount,
        provider: context.provider,
        helperAddress: context.helperAddress,
        recoveryAddress: context.address,
        tokenAddress: constants.addrSTRK,
        helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
        policy: context.policy,
        record,
      });
      setActionState(actionKey, {
        pending: false,
        message: `${itemCount} ${kind === "contacts" ? "contact" : "RFQ record"}${itemCount === 1 ? "" : "s"} backed up ${external ? "through a CID-verified encrypted blob pointer" : "inline"} in ${result.transactionHash.slice(0, 12)}…`,
      });
      setStorageNotice({
        kind: "ok",
        message: `Backup plaintext never left this browser. Wallet plus mailbox recovery phrase are required to decrypt it. ${MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}`,
      });
    } catch (error: unknown) {
      setActionState(actionKey, {
        pending: false,
        message:
          error instanceof Error
            ? error.message
            : "The encrypted backup failed.",
      });
    }
  }

  async function handleContactBackup() {
    if (!address) return;
    try {
      const entries = await loadAddressBook(window.localStorage, address);
      await postAuthenticatedBackup("contacts", { entries }, entries.length);
    } catch (error: unknown) {
      setActionState("contacts:backup", {
        pending: false,
        message:
          error instanceof Error ? error.message : "The contact export failed.",
      });
    }
  }

  async function handleRfqHistoryBackup() {
    if (!address || !chainId) return;
    try {
      const history = await exportRfqHistory(
        createIndexedDbRfqStorage(),
        chainId,
        address,
      );
      await postAuthenticatedBackup(
        "rfq-resume",
        history,
        history.count + history.tombstoneCount,
      );
    } catch (error: unknown) {
      setActionState("rfq-resume:backup", {
        pending: false,
        message:
          error instanceof Error
            ? error.message
            : "The RFQ history export failed.",
      });
    }
  }

  useEffect(() => {
    if (
      !address ||
      !chainId ||
      !rfqAutoBackupEnabled ||
      !keypair ||
      !mailSeed ||
      !keyFingerprint ||
      !helperAddress ||
      !walletAccount ||
      !selectedWallet ||
      !isStrk20Capable ||
      rfqAutoBackupPostingRef.current
    ) {
      return;
    }
    const pending = consumePendingRfqHistoryAutoBackup(window.localStorage, {
      account: address,
      chainId,
    });
    if (!pending) return;
    rfqAutoBackupPostingRef.current = true;
    void exportRfqHistory(createIndexedDbRfqStorage(), chainId, address)
      .then((history) =>
        postAuthenticatedBackup(
          "rfq-resume",
          history,
          history.count + history.tombstoneCount,
        ),
      )
      .catch((error: unknown) => {
        setActionState("rfq-resume:backup", {
          pending: false,
          message:
            error instanceof Error
              ? error.message
              : "The automatic RFQ history export failed.",
        });
      })
      .finally(() => {
        rfqAutoBackupPostingRef.current = false;
      });
  }, [
    address,
    chainId,
    helperAddress,
    isStrk20Capable,
    keyFingerprint,
    keypair,
    mailSeed,
    rfqAutoBackupEnabled,
    rfqAutoBackupSignal,
    selectedWallet,
    walletAccount,
  ]);

  function updateRfqAutoBackup(enabled: boolean) {
    if (!address || !chainId) return;
    setRfqHistoryAutoBackupEnabled(
      window.localStorage,
      chainId,
      address,
      enabled,
    );
    setRfqAutoBackupEnabled(enabled);
    setStorageNotice({
      kind: "ok",
      message: enabled
        ? "Automatic RFQ history backup is opted in for confirmed settlements. It never submits or proves a settlement."
        : "Automatic RFQ history backup is off.",
    });
  }

  async function restoreAuthenticatedBackup(
    _payload: unknown,
    sourceMessage: LocalMailMessage,
  ) {
    const actionKey = "backup:restore";
    try {
      if (
        !address ||
        !chainId ||
        !helperAddress ||
        !keypair ||
        !mailSeed ||
        !keyFingerprint
      ) {
        throw new Error(
          "Connect the matching wallet and unlock its mailbox recovery phrase first.",
        );
      }
      const startedAt = Date.now();
      setActionState(actionKey, {
        pending: true,
        message: "Authenticating the newest backup candidates…",
        startedAt,
      });
      const backupContext = {
        owner: address,
        chainId,
        helperAddress,
        mailboxFingerprint: keyFingerprint,
      };
      let requestedKind: BackupKind;
      if (sourceMessage.envelope.type === "backup_snapshot") {
        requestedKind = verifyBackupSnapshot(sourceMessage.envelope.payload, {
          ...backupContext,
          mailboxSeed: mailSeed,
        }).kind;
      } else if (sourceMessage.envelope.type === "backup_pointer") {
        requestedKind = verifyBackupPointer(sourceMessage.envelope.payload, {
          ...backupContext,
          mailboxSeed: mailSeed,
        }).kind;
      } else {
        throw new Error("This message is not an authenticated backup.");
      }

      let storePromise: Promise<BlobStore> | undefined;
      const loaded = await loadBackupSnapshotWithFallback(messages, {
        mailboxSeed: mailSeed,
        context: backupContext,
        kind: requestedKind,
        loadBlob: async (cid) => {
          if (!storePromise) {
            setActionState(actionKey, {
              pending: true,
              message:
                "Trying CID-verified blobs from up to three authenticated backup candidates…",
              startedAt,
            });
            storePromise = inboxBlobStore();
          }
          return (await storePromise).get(cid);
        },
      });
      const snapshot = loaded.snapshot;
      const usedSource =
        loaded.message.envelope.type === "backup_pointer"
          ? "encrypted blob pointer"
          : "inline snapshot";
      const fallbackWarning = loaded.failures.length
        ? ` ${loaded.failures.length} newer authenticated backup candidate${loaded.failures.length === 1 ? " was" : "s were"} unavailable or corrupt; sequence ${snapshot.seq} was used instead.`
        : "";
      const fallbackPrompt = loaded.failures.length
        ? ` Warning: ${loaded.failures.length} newer authenticated backup candidate${loaded.failures.length === 1 ? " is" : "s are"} unavailable or corrupt; sequence ${snapshot.seq} will be used instead.`
        : "";

      if (snapshot.kind === "contacts") {
        const value = snapshot.payload;
        if (
          value === null ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).join(",") !== "entries" ||
          !("entries" in value) ||
          !Array.isArray(value.entries)
        ) {
          throw new Error("The contact backup payload is malformed.");
        }
        const entries = value.entries.map((item) => {
          if (
            item === null ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            !("label" in item) ||
            !("address" in item) ||
            !("updatedAt" in item) ||
            typeof item.label !== "string" ||
            typeof item.address !== "string" ||
            typeof item.updatedAt !== "number"
          ) {
            throw new Error("The contact backup entry is malformed.");
          }
          return {
            label: item.label,
            address: item.address,
            updatedAt: item.updatedAt,
          };
        });
        if (
          !window.confirm(
            `Merge ${entries.length} authenticated contact${entries.length === 1 ? "" : "s"} from backup sequence ${snapshot.seq}?${fallbackPrompt} Newer local labels win.`,
          )
        ) {
          throw new Error(
            "Backup restore cancelled; local data was untouched.",
          );
        }
        const restored = await mergeAddressBookEntries(
          window.localStorage,
          address,
          entries,
        );
        window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
        setActionState(actionKey, {
          pending: false,
          message: `${restored.length} contact${restored.length === 1 ? "" : "s"} restored from backup sequence ${snapshot.seq} (${usedSource}) with keep-newer merge rules.${fallbackWarning}`,
        });
      } else {
        const value = snapshot.payload;
        if (
          value === null ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !("count" in value) ||
          typeof value.count !== "number" ||
          !Number.isSafeInteger(value.count) ||
          !("tombstoneCount" in value) ||
          typeof value.tombstoneCount !== "number" ||
          !Number.isSafeInteger(value.tombstoneCount)
        ) {
          throw new Error("The RFQ history backup payload is malformed.");
        }
        if (
          !window.confirm(
            `Merge ${value.count} authenticated RFQ history record${value.count === 1 ? "" : "s"} and ${value.tombstoneCount} portable deletion marker${value.tombstoneCount === 1 ? "" : "s"} from backup sequence ${snapshot.seq}?${fallbackPrompt} Existing newer records and deletion markers win.`,
          )
        ) {
          throw new Error(
            "Backup restore cancelled; local data was untouched.",
          );
        }
        const result = await importRfqHistory(
          createIndexedDbRfqStorage(),
          snapshot,
          {
            onConflict: "keep-newer",
            mailboxSeed: mailSeed,
            snapshotContext: backupContext,
            sequenceStorage: window.localStorage,
          },
        );
        setActionState(actionKey, {
          pending: false,
          message: `${result.imported} RFQ record${result.imported === 1 ? "" : "s"} restored from backup sequence ${snapshot.seq} (${usedSource}); ${result.skipped} newer or identical local record${result.skipped === 1 ? " was" : "s were"} kept.${fallbackWarning}`,
        });
      }
      setStorageNotice({
        kind: "ok",
        message: `Authenticated backup sequence ${snapshot.seq} (${usedSource}) restored.${fallbackWarning} Mail and IPFS supplied encrypted evidence only; neither proves settlement.`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "The backup could not be restored.";
      setActionState(actionKey, {
        pending: false,
        message,
      });
      setStorageNotice({ kind: "error", message });
    }
  }

  async function restoreContactBackup(
    payload: unknown,
    sourceMessage: LocalMailMessage,
  ) {
    const actionKey = "contacts:restore";
    try {
      if (
        !address ||
        !chainId ||
        !helperAddress ||
        !keypair ||
        !mailSeed ||
        !keyFingerprint
      ) {
        throw new Error(
          "Connect the matching wallet and unlock its mailbox recovery phrase first.",
        );
      }
      setActionState(actionKey, {
        pending: true,
        message: "Verifying the contact snapshot…",
        startedAt: Date.now(),
      });
      const snapshot = verifyContactSnapshot(payload, {
        owner: address,
        chainId,
        helperAddress,
        mailboxFingerprint: keyFingerprint,
        mailboxSeed: mailSeed,
      });
      const existing = await loadAddressBook(window.localStorage, address);
      const newestLocalUpdate = existing.reduce(
        (latest, entry) => Math.max(latest, entry.updatedAt),
        0,
      );
      const verifiedLoadedSnapshots = messages.flatMap((message) => {
        if (message.envelope.type !== "contact_snapshot") return [];
        try {
          return [
            {
              message,
              snapshot: verifyContactSnapshot(message.envelope.payload, {
                owner: address,
                chainId,
                helperAddress,
                mailboxFingerprint: keyFingerprint,
                mailboxSeed: mailSeed,
              }),
            },
          ];
        } catch {
          return [];
        }
      });
      verifiedLoadedSnapshots.sort((left, right) => {
        const blockDifference =
          (right.message.blockNumber ?? -1) - (left.message.blockNumber ?? -1);
        if (blockDifference) return blockDifference;
        return (
          (right.message.eventIndex ?? -1) - (left.message.eventIndex ?? -1)
        );
      });
      const olderThanLoaded =
        verifiedLoadedSnapshots[0]?.message.id !== undefined &&
        verifiedLoadedSnapshots[0].message.id !== sourceMessage.id;
      const warnings = [
        snapshot.createdAt < newestLocalUpdate
          ? "This snapshot predates at least one local contact update."
          : "",
        olderThanLoaded
          ? "A newer authenticated contact snapshot is loaded in this mailbox."
          : "",
      ].filter(Boolean);
      const preview = snapshot.entries
        .slice(0, 10)
        .map(
          (entry) =>
            `• ${entry.label} — ${entry.address.slice(0, 10)}…${entry.address.slice(-6)}`,
        )
        .join("\n");
      const remainder = Math.max(0, snapshot.entries.length - 10);
      const confirmed = window.confirm(
        `Merge ${snapshot.entries.length} authenticated contact${snapshot.entries.length === 1 ? "" : "s"} from ${new Date(snapshot.createdAt).toISOString()}?\n\n${preview}${remainder ? `\n• …and ${remainder} more` : ""}${warnings.length ? `\n\nROLLBACK WARNING\n${warnings.join("\n")}` : ""}\n\nMerge is additive: newer local labels win. Old on-chain snapshots cannot be deleted.`,
      );
      if (!confirmed) {
        setActionState(actionKey, {
          pending: false,
          message: "Contact restore cancelled; the local book was untouched.",
        });
        return;
      }
      const restored = await mergeAddressBookEntries(
        window.localStorage,
        address,
        snapshot.entries,
      );
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
      setActionState(actionKey, {
        pending: false,
        message: `${restored.length} contact${restored.length === 1 ? "" : "s"} restored and re-encrypted with this device's local address-book key.`,
      });
      setStorageNotice({
        kind: "ok",
        message:
          "Authenticated contact snapshot restored. Mail supplied encrypted evidence only; it did not trigger a trade or prove settlement.",
      });
    } catch (error: unknown) {
      setActionState(actionKey, {
        pending: false,
        message:
          error instanceof Error
            ? error.message
            : "The contact snapshot could not be restored.",
      });
    }
  }

  function handleSent(message: SentEnvelope) {
    const createdAt = Date.now();
    const localMessage: LocalMailMessage = {
      id: `sent:${message.documentId}`,
      documentId: message.documentId,
      index: "local",
      plaintext: message.plaintext,
      envelope: decodeEnvelope(encodeEnvelope(message.type, message.payload)),
      record: message.record,
      transactionHash: message.transactionHash,
      transactionHashes: message.transactionHashes,
      deliveryState: message.deliveryState,
      direction: "outgoing",
      recipientCount: message.recipientCount,
      recipients: message.recipients,
      localCreatedAt: createdAt,
    };
    setMessages((current) => mergeMailMessages(current, [localMessage]));
    if (address && chainId) {
      try {
        saveSentMail(window.localStorage, chainId, address, {
          version: 1,
          documentId: message.documentId,
          type: message.type,
          payload: message.payload,
          plaintext: message.plaintext,
          record: message.record,
          transactionHash: message.transactionHash,
          transactionHashes: message.transactionHashes,
          recipientCount: message.recipientCount,
          recipients: message.recipients,
          deliveryState: message.deliveryState,
          createdAt,
        });
        mergeLocalDealState([localMessage]);
        refreshOtcState();
        refreshEscrowState();
        void refreshEscrowChainDeals();
        setStorageNotice({
          kind: "ok",
          message:
            "Sent copy saved in this browser profile (not encrypted at rest).",
        });
      } catch (error: unknown) {
        setStorageNotice({
          kind: "error",
          message: `The message is confirmed on-chain, but its local Sent copy could not be saved. It remains visible only until this tab closes. ${
            error instanceof Error ? error.message : "Browser storage failed."
          }`,
        });
      }
    }
  }

  async function postReceipt(
    offer: OfferPayload,
    accept: AcceptPayload,
    acceptTransactionHash: string,
    recipientKey?: Uint8Array,
  ) {
    const context = requireActionContext();
    const key =
      recipientKey ??
      (await lookupMailKey(context.helperAddress, offer.offerer));
    const receipt = receiptForTransfer(
      offer.dealId,
      accept.transfer,
      acceptTransactionHash,
    );
    const record = await encryptMail(key, encodeEnvelope("receipt", receipt));
    await submitMail({
      account: context.walletAccount,
      provider: context.provider,
      helperAddress: context.helperAddress,
      recoveryAddress: context.address,
      tokenAddress: constants.addrSTRK,
      helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
      policy: context.policy,
      record,
    });
    recordDealEvent(window.localStorage, context.chainId, context.address, {
      type: "receipt",
      payload: receipt,
    });
    refreshOtcState();
  }

  async function handleAccept(offer: OfferPayload, offerIndex?: number) {
    const actionKey = `deal:${offer.dealId}`;
    let claimed = false;
    let submittedHash = "";
    try {
      const context = requireActionContext();
      const accept = acceptPayloadForOffer(offer, offerIndex);
      const reservedAccept = claimOtcAccept(
        window.localStorage,
        context.chainId,
        context.address,
        accept,
      );
      const attemptId = reservedAccept.acceptOperation?.attemptId;
      if (!attemptId) {
        throw new Error("The payer-owned OTC attempt id was not persisted.");
      }
      claimed = true;
      refreshOtcState();
      setActionState(actionKey, {
        pending: true,
        message:
          "Checking the private batch balance, live pool fee, and public fee balance…",
        startedAt: Date.now(),
      });
      await authorizeValueAction(
        context,
        "Accept OTC private transfer",
        offer.give.amount,
        [offer.give.amount, APP20_HELPER_FUNDING_BASE_UNITS],
      );
      setActionState(actionKey, {
        pending: true,
        message: "Preparing one private STRK transfer and accept memo…",
        startedAt: Date.now(),
      });

      const recipientKey = await lookupMailKey(
        context.helperAddress,
        offer.offerer,
      );
      const record = await encryptMail(
        recipientKey,
        encodeEnvelope("accept", accept),
      );
      const result = await submitOtcAccept(
        {
          account: context.walletAccount,
          provider: context.provider,
          helperAddress: context.helperAddress,
          recoveryAddress: context.address,
          tokenAddress: constants.addrSTRK,
          offer,
          record,
          helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
          policy: context.policy,
          actionId: computeActionId("otc-accept-attempt", attemptId),
        },
        {
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            markOtcAcceptSubmitted(
              window.localStorage,
              context.chainId,
              context.address,
              offer.dealId,
              transactionHash,
            );
            refreshOtcState();
            setActionState(actionKey, {
              pending: true,
              message: `STRK transfer submitted (${transactionHash}); confirmation pending before any receipt is posted.`,
              startedAt: Date.now(),
            });
          },
        },
      );
      const acceptHash = result.transactionHash;
      confirmOtcAccept(
        window.localStorage,
        context.chainId,
        context.address,
        offer.dealId,
        acceptHash,
      );
      refreshOtcState();

      setActionState(actionKey, {
        pending: true,
        message: "STRK transfer confirmed. Posting the separate receipt…",
      });
      try {
        await postReceipt(offer, accept, acceptHash, recipientKey);
        setActionState(actionKey, {
          pending: false,
          message: "Accept transfer and one-sided receipt confirmed.",
        });
        void scanInbox();
      } catch (receiptError: unknown) {
        setActionState(actionKey, {
          pending: false,
          message: `STRK moved in confirmed transaction ${acceptHash}, but the separate receipt failed: ${strk20ErrorMessage(receiptError)} Use “Post receipt” to retry only the receipt; do not accept again.`,
        });
      }
    } catch (error: unknown) {
      const outcome = transactionStateFromError(error);
      const hash = transactionHashFromError(error) ?? submittedHash;
      if (claimed && hash && outcome && address && chainId) {
        try {
          markOtcAcceptOutcome(
            window.localStorage,
            chainId,
            address,
            offer.dealId,
            hash,
            outcome,
          );
        } catch {
          // The submitted-state write may itself have failed. Keep the
          // reservation blocked rather than risking a duplicate transfer.
        }
        refreshOtcState();
      } else if (claimed && !hash && address && chainId) {
        releaseOtcAccept(window.localStorage, chainId, address, offer.dealId);
        refreshOtcState();
      }
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  async function handleDecline(offer: OfferPayload) {
    const actionKey = `deal:${offer.dealId}`;
    try {
      const context = requireActionContext();
      const current = loadOtcState(
        window.localStorage,
        context.chainId,
        context.address,
      ).deals[offer.dealId];
      if (!current || current.status !== "offered") {
        throw new Error("This offer is no longer open.");
      }
      setActionState(actionKey, {
        pending: true,
        message: "Encrypting decline; no transfer will be sent…",
      });
      const decline = { dealId: offer.dealId };
      const key = await lookupMailKey(context.helperAddress, offer.offerer);
      const record = await encryptMail(key, encodeEnvelope("decline", decline));
      await submitMail({
        account: context.walletAccount,
        provider: context.provider,
        helperAddress: context.helperAddress,
        recoveryAddress: context.address,
        tokenAddress: constants.addrSTRK,
        helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
        policy: context.policy,
        record,
      });
      recordDealEvent(window.localStorage, context.chainId, context.address, {
        type: "decline",
        payload: decline,
      });
      refreshOtcState();
      setActionState(actionKey, {
        pending: false,
        message: "Decline confirmed. No STRK moved.",
      });
    } catch (error: unknown) {
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  async function handlePostReceipt(offer: OfferPayload) {
    const actionKey = `deal:${offer.dealId}`;
    try {
      const context = requireActionContext();
      const deal = loadOtcState(
        window.localStorage,
        context.chainId,
        context.address,
      ).deals[offer.dealId];
      if (
        !deal?.accept ||
        !deal.acceptTxHash ||
        !deal.settlementVerified ||
        deal.status !== "accepted"
      ) {
        throw new Error(
          "No locally verified accept transfer is waiting for a receipt.",
        );
      }
      setActionState(actionKey, {
        pending: true,
        message: "Posting the one-sided receipt…",
      });
      await postReceipt(offer, deal.accept, deal.acceptTxHash);
      setActionState(actionKey, {
        pending: false,
        message: "Receipt confirmed.",
      });
      void scanInbox();
    } catch (error: unknown) {
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  function handlePayPrivatelyWithStrk(request: PaymentRequestPayload) {
    const actionKey = `payment:${request.requestId}`;
    try {
      const context = requireActionContext();
      if (providerIndex !== constants.LOCALNET_PROVIDER_INDEX) {
        throw new Error("USDC invoice RFQ handoff is localnet-only.");
      }
      if (
        request.chainId &&
        !paymentLinkChainIdsEqual(request.chainId, context.chainId)
      ) {
        throw new Error(
          "This invoice is bound to another Starknet network. Switch the wallet before opening the RFQ desk.",
        );
      }
      const token = resolvePaymentRequestTokenForChain(
        request,
        context.chainId,
      );
      if (token.symbol !== "USDC") {
        throw new Error(
          "Only a registry-resolved USDC invoice uses this RFQ handoff.",
        );
      }
      storeInvoiceDeskHandoff(
        window.sessionStorage,
        {
          requestId: request.requestId,
          payee: request.requester,
          buyToken: token.address,
          targetBuyBaseUnits: request.amount,
          ...(request.memo ? { memo: request.memo } : {}),
          returnTo: "/mail/inbox",
        },
        { account: context.address, chainId: context.chainId },
      );
      setActionState(actionKey, {
        pending: false,
        message: "Opening the RFQ desk with these exact invoice terms…",
      });
      void navigate({ to: "/rfq" });
    } catch (error: unknown) {
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  async function handlePay(request: PaymentRequestPayload) {
    const actionKey = `payment:${request.requestId}`;
    let claimed = false;
    let submittedHash = "";
    try {
      const context = requireActionContext();
      if (
        request.chainId &&
        !paymentLinkChainIdsEqual(request.chainId, context.chainId)
      ) {
        throw new Error(
          "This payment link is bound to another Starknet network. Switch the wallet before paying.",
        );
      }
      const currentPayment = loadOtcState(
        window.localStorage,
        context.chainId,
        context.address,
      ).payments[request.requestId];
      const reservedPayment =
        currentPayment?.paymentOperation?.state === "awaiting-note-maturity"
          ? claimMatureInvoicePayment(
              window.localStorage,
              context.chainId,
              context.address,
              request,
              invoiceMaturityHeadBlock ?? 0,
            )
          : claimPayment(
              window.localStorage,
              context.chainId,
              context.address,
              request,
            );
      const payableRequest = reservedPayment.request;
      const payableToken = resolvePaymentRequestTokenForChain(
        payableRequest,
        context.chainId,
      );
      const paymentOperation = reservedPayment.paymentOperation;
      if (!paymentOperation || paymentOperation.state !== "reserved") {
        throw new Error(
          "The payer-owned payment reservation was not persisted.",
        );
      }
      const attemptId = paymentOperation.attemptId;
      if (!attemptId) {
        throw new Error(
          "The payer-owned payment attempt id was not persisted.",
        );
      }
      claimed = true;
      refreshOtcState();
      setActionState(actionKey, {
        pending: true,
        message:
          "Checking the private payment plus mail-helper funding, live pool fee, and public fee balance…",
        startedAt: Date.now(),
      });
      await authorizeValueAction(
        context,
        "Invoice private payment",
        payableRequest.amount,
        [payableRequest.amount, APP20_HELPER_FUNDING_BASE_UNITS],
        payableToken.address,
      );
      setActionState(actionKey, {
        pending: true,
        message: `Preparing one private ${payableToken.symbol} payment and payment memo…`,
        startedAt: Date.now(),
      });
      const transfer = {
        token: payableRequest.token,
        amount: payableRequest.amount,
        to: payableRequest.requester,
      };
      const paymentMemo: AcceptPayload = {
        dealId: payableRequest.requestId,
        transfer,
      };
      const key = await lookupMailKey(
        context.helperAddress,
        payableRequest.requester,
      );
      const record = await encryptMail(
        key,
        encodeEnvelope("accept", paymentMemo),
      );
      const result = await submitMemoTransfer(
        {
          account: context.walletAccount,
          provider: context.provider,
          helperAddress: context.helperAddress,
          recoveryAddress: context.address,
          tokenAddress: payableToken.address,
          recipient: payableRequest.requester,
          amount: payableRequest.amount,
          record,
          helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
          policy: context.policy,
          actionId: computeActionId("payment-attempt", attemptId),
        },
        {
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            markPaymentSubmitted(
              window.localStorage,
              context.chainId,
              context.address,
              payableRequest.requestId,
              transactionHash,
            );
            refreshOtcState();
            setActionState(actionKey, {
              pending: true,
              message: `Private ${payableToken.symbol} payment submitted (${transactionHash}); confirmation pending.`,
              startedAt: Date.now(),
            });
          },
        },
      );
      const transactionHash = result.transactionHash;
      confirmPayment(
        window.localStorage,
        context.chainId,
        context.address,
        payableRequest.requestId,
        transactionHash,
        receiptForTransfer(payableRequest.requestId, transfer, transactionHash),
      );
      refreshOtcState();
      setActionState(actionKey, {
        pending: false,
        message: `Private ${payableToken.symbol} payment and encrypted memo confirmed.`,
      });
      void scanInbox();
    } catch (error: unknown) {
      const outcome = transactionStateFromError(error);
      const hash = transactionHashFromError(error) ?? submittedHash;
      if (claimed && hash && outcome && address && chainId) {
        try {
          markPaymentOutcome(
            window.localStorage,
            chainId,
            address,
            request.requestId,
            hash,
            outcome,
          );
        } catch {
          // Never release a reservation once a wallet hash exists.
        }
        refreshOtcState();
      } else if (claimed && !hash && address && chainId) {
        releasePayment(
          window.localStorage,
          chainId,
          address,
          request.requestId,
        );
        refreshOtcState();
      }
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  async function handleEscrowFill(fund: EscrowFundPayload) {
    const actionKey = `escrow:${fund.dealId}`;
    let reserved = false;
    let submittedHash = "";
    try {
      if (
        providerIndex !== constants.LOCALNET_PROVIDER_INDEX ||
        !constants.localnetWalletEnabled
      ) {
        throw new Error(
          "Escrow fill is available only on build-gated localnet.",
        );
      }
      const context = requireActionContext();
      if (!escrowAddress || !escrowEnabled) {
        throw new Error(
          networkName === "MAINNET"
            ? "Escrow stays off the mainnet scoring path until reviewed."
            : "No reviewed escrow deployment is configured.",
        );
      }
      if (!feltEquals(fund.escrowAddress, escrowAddress)) {
        throw new Error("This deal names a different escrow deployment.");
      }
      if (feltEquals(fund.maker, context.address)) {
        throw new Error("The maker cannot fill their own escrow deal.");
      }

      claimEscrowOperation(
        window.localStorage,
        context.chainId,
        context.address,
        fund.dealId,
        "fill",
      );
      reserved = true;
      refreshEscrowState();
      const startedAt = Date.now();
      setActionState(actionKey, {
        pending: true,
        message:
          "Preparing leg B deposit and the taker's OPEN leg A destination…",
        startedAt,
      });

      const result = await submitActions(
        context.walletAccount,
        context.provider,
        buildEscrowFillActions({
          escrowAddress,
          recoveryAddress: context.address,
          dealId: fund.dealId,
          token: fund.legB.token.address,
          amount: fund.legB.amount,
          payoutToken: fund.legA.token.address,
        }),
        {
          policy: context.policy,
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            markEscrowOperationSubmitted(
              window.localStorage,
              context.chainId,
              context.address,
              fund.dealId,
              "fill",
              transactionHash,
            );
            refreshEscrowState();
            setActionState(actionKey, {
              pending: true,
              message:
                "Fill submitted. The contract releases leg A only after observing leg B…",
              startedAt: Date.now(),
            });
          },
        },
      );
      confirmEscrowOperation(
        window.localStorage,
        context.chainId,
        context.address,
        fund.dealId,
        "fill",
        result.transactionHash,
      );
      await refreshEscrowChainDeals();
      setActionState(actionKey, {
        pending: false,
        message:
          "Fill confirmed: leg A was released to the taker; leg B awaits the maker's claim-ticket spend.",
      });
    } catch (error: unknown) {
      const outcome = transactionStateFromError(error);
      const hash = transactionHashFromError(error) ?? submittedHash;
      if (reserved && hash && outcome && address && chainId) {
        try {
          markEscrowOperationOutcome(
            window.localStorage,
            chainId,
            address,
            fund.dealId,
            "fill",
            hash,
            outcome,
          );
        } catch {
          // A submitted hash must never release the duplicate-action guard.
        }
        refreshEscrowState();
        void refreshEscrowChainDeals();
      } else if (reserved && !hash && address && chainId) {
        releaseEscrowOperation(
          window.localStorage,
          chainId,
          address,
          fund.dealId,
          "fill",
        );
        refreshEscrowState();
      }
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  async function handleLocalnetEscrowPayout(
    fund: EscrowFundPayload,
    operation: "claim" | "timeout",
  ) {
    const actionKey = `escrow:${fund.dealId}`;
    let reserved = false;
    let submittedHash = "";
    try {
      if (
        providerIndex !== constants.LOCALNET_PROVIDER_INDEX ||
        !constants.localnetWalletEnabled
      ) {
        throw new Error(
          "Claim-ticket escrow payouts are unavailable through this wallet.",
        );
      }
      const context = requireActionContext();
      if (!escrowAddress) {
        throw new Error("Load the localnet escrow deployment.");
      }
      if (!feltEquals(fund.escrowAddress, escrowAddress)) {
        throw new Error("This deal names a different escrow deployment.");
      }
      if (!feltEquals(fund.maker, context.address)) {
        throw new Error(
          "Only the maker wallet that holds this deal's private ticket can request payout.",
        );
      }

      claimEscrowOperation(
        window.localStorage,
        context.chainId,
        context.address,
        fund.dealId,
        operation,
      );
      reserved = true;
      refreshEscrowState();
      if (!fund.ticket) {
        throw new Error(
          "Historical V1 signature deals are display-only; localnet payouts require a V2 claim ticket.",
        );
      }
      const payoutToken =
        operation === "claim"
          ? fund.legB.token.address
          : fund.legA.token.address;
      const actions = (
        operation === "claim"
          ? buildEscrowClaimActions
          : buildEscrowTimeoutActions
      )({
        escrowAddress,
        recoveryAddress: context.address,
        ticketAddress: fund.ticket,
        dealId: fund.dealId,
        payoutToken,
      });
      const startedAt = Date.now();
      setActionState(actionKey, {
        pending: true,
        message:
          "Withdrawing the private claim ticket and assembling the payout note…",
        startedAt,
      });

      const result = await submitActions(
        context.walletAccount,
        context.provider,
        actions,
        {
          policy: context.policy,
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            markEscrowOperationSubmitted(
              window.localStorage,
              context.chainId,
              context.address,
              fund.dealId,
              operation,
              transactionHash,
            );
            refreshEscrowState();
            setActionState(actionKey, {
              pending: true,
              message:
                "Claim-ticket payout submitted; waiting for localnet confirmation…",
              startedAt: Date.now(),
            });
          },
        },
      );
      confirmEscrowOperation(
        window.localStorage,
        context.chainId,
        context.address,
        fund.dealId,
        operation,
        result.transactionHash,
      );
      await refreshEscrowChainDeals();
      setActionState(actionKey, {
        pending: false,
        message:
          operation === "claim"
            ? "Localnet claim confirmed: the maker received leg B."
            : "Localnet timeout confirmed: the maker recovered leg A.",
      });
    } catch (error: unknown) {
      const outcome = transactionStateFromError(error);
      const hash = transactionHashFromError(error) ?? submittedHash;
      if (reserved && hash && outcome && address && chainId) {
        try {
          markEscrowOperationOutcome(
            window.localStorage,
            chainId,
            address,
            fund.dealId,
            operation,
            hash,
            outcome,
          );
        } catch {
          // A submitted hash must never release the duplicate-action guard.
        }
        refreshEscrowState();
        void refreshEscrowChainDeals();
      } else if (reserved && !hash && address && chainId) {
        releaseEscrowOperation(
          window.localStorage,
          chainId,
          address,
          fund.dealId,
          operation,
        );
        refreshEscrowState();
      }
      setActionState(actionKey, {
        pending: false,
        message: strk20ErrorMessage(error),
      });
    }
  }

  const {
    folderCounts,
    typeCounts,
    filteredDrafts,
    allAnnotatedMessages,
    annotatedMessages,
  } = mailboxView;
  const selectedMessage = annotatedMessages.find(
    (message) => message.id === selectedMessageId,
  );
  const conversationMessages = useMemo(
    () =>
      assembleConversation(allAnnotatedMessages, selectedMessage?.id ?? null),
    [allAnnotatedMessages, selectedMessage?.id],
  );
  const activeDraft = drafts.find((draft) => draft.id === selectedDraftId);
  const scanCursorDescription = useMemo(() => {
    if (
      !keypair ||
      scanMessage ||
      !address ||
      !chainId ||
      !helperAddress ||
      !keyFingerprint
    ) {
      return null;
    }
    return describeMailScanCursor(
      loadMailScanCursor(
        window.localStorage,
        mailScanCursorKey(chainId, address, helperAddress, keyFingerprint),
      ),
    );
  }, [
    address,
    chainId,
    helperAddress,
    keyFingerprint,
    keypair,
    scanKind,
    scanMessage,
  ]);
  const folderLabel =
    MAIL_FOLDERS.find((folder) => folder.id === mailFolder)?.label ?? "Inbox";
  const filterLabel =
    TYPE_FILTERS.find((filter) => filter.id === mailboxFilter)?.label ??
    "All types";

  function persistDraft(draft: CompositeDraft) {
    try {
      setDrafts(
        saveDraft(
          window.localStorage,
          draftScopeChain,
          draftScopeAddress,
          draft,
          draft.updatedAt,
        ),
      );
      setStorageNotice((current) =>
        current?.kind === "ok" &&
        current.message ===
          "Draft saved in this browser profile (not encrypted at rest)."
          ? current
          : {
              kind: "ok",
              message:
                "Draft saved in this browser profile (not encrypted at rest).",
            },
      );
    } catch (error: unknown) {
      setDrafts((current) =>
        [
          draft,
          ...current.filter((candidate) => candidate.id !== draft.id),
        ].sort((left, right) => right.updatedAt - left.updatedAt),
      );
      setStorageNotice({
        kind: "error",
        message: `Draft save failed. This edit exists only in memory and will be lost when the tab closes. ${
          error instanceof Error ? error.message : "Browser storage failed."
        }`,
      });
    }
  }

  function removeDraft(draftId: string, confirmDelete = true) {
    if (
      confirmDelete &&
      !window.confirm(
        "Delete this device-private draft? It has never been uploaded and cannot be restored.",
      )
    ) {
      return;
    }
    try {
      const next = deleteDraft(
        window.localStorage,
        draftScopeChain,
        draftScopeAddress,
        draftId,
      );
      setDrafts(next);
      setSelectedDraftId(next[0]?.id ?? null);
      if (selectedDraftId === draftId && !next.length) setComposerOpen(false);
      setStorageNotice({
        kind: "ok",
        message: "Local draft deleted from this browser profile.",
      });
    } catch (error: unknown) {
      setStorageNotice({
        kind: "error",
        message: `Draft deletion failed; the local copy remains. ${
          error instanceof Error ? error.message : "Browser storage failed."
        }`,
      });
    }
  }

  function lockMailboxSession() {
    mailSeed?.fill(0);
    keypair?.privateKey.fill(0);
    setMailSeed(null);
    setKeypair(null);
    setStorageNotice({
      kind: "ok",
      message:
        "Mailbox locked in this tab. A passphrase-wrapped vault stays on this device; a plaintext seed is still in this profile until you forget the device.",
    });
  }

  function forgetThisDevice() {
    if (
      !window.confirm(
        `Forget this device and clear every mailbox key, draft, Sent copy, alias, payment/OTC record, escrow record, and scan cursor from this browser profile? On-chain ciphertext remains public. You will need the offline backup to read this mailbox again. ${MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}`,
      )
    ) {
      return;
    }
    try {
      const removed = clearLocalMailboxStorage(window.localStorage);
      try {
        window.sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
      } catch {
        // The payment-link handoff is not key material; local purge succeeded.
      }
      cancelActiveScanWorker();
      scanGenerationRef.current += 1;
      mailSeed?.fill(0);
      keypair?.privateKey.fill(0);
      setMailSeed(null);
      setKeypair(null);
      setMessages([]);
      setDrafts([]);
      setAliases([]);
      setOtcState(emptyOtcState());
      setEscrowState(emptyEscrowState());
      setAssignments({});
      setProofs({});
      setActionStates({});
      setReadMessageIds(new Set());
      setSelectedMessageId(null);
      setSelectedDraftId(null);
      setPendingPayment(null);
      setComposerOpen(false);
      setMobileDetailOpen(false);
      setMailFolder("inbox");
      setMailboxFilter("all");
      setStorageNotice({
        kind: "ok",
        message: `Forgot this device: removed ${removed.length} local mailbox record${removed.length === 1 ? "" : "s"}. Disconnecting alone does not do this. Restore the offline backup to reopen encrypted mail. That backup can also recreate the Mail signing key used for payment requests, and APP20 currently cannot revoke it if compromised.`,
      });
    } catch (error: unknown) {
      setStorageNotice({
        kind: "error",
        message: `Mail could not clear every local mailbox record. Do not leave this shared profile unattended. ${
          error instanceof Error ? error.message : "Browser storage failed."
        }`,
      });
    }
  }

  const selectMessage = useCallback((messageId: string) => {
    activatedMessageIdRef.current = messageId;
    setSelectedMessageId(messageId);
    setMessageActivation((current) => current + 1);
    setComposerOpen(false);
    setMobileDetailOpen(true);
  }, []);

  const selectDraft = useCallback((draftId: string) => {
    setSelectedDraftId(draftId);
    setComposerOpen(true);
    setMobileDetailOpen(true);
    setSidebarOpen(false);
  }, []);

  function openComposer() {
    if (!address || !chainId) {
      setStorageNotice({
        kind: "error",
        message:
          "Mail is keyed to a wallet: connect one so the draft is saved under the correct mailbox.",
        action: "connect-wallet",
      });
      setSidebarOpen(true);
      return;
    }
    // Compose on an untouched draft reopens it instead of leaving another
    // identical blank row behind.
    const existingBlank = drafts.find(isBlankDraft);
    const draft = existingBlank ?? createBlankDraft();
    if (!existingBlank) persistDraft(draft);
    setMailFolder("drafts");
    setMailboxFilter("all");
    setSelectedDraftId(draft.id);
    setComposerOpen(true);
    setMobileDetailOpen(true);
    setSidebarOpen(false);
  }

  function openComposerForRecipient(input: {
    address?: string;
    conversationId: string;
    inReplyTo: string;
  }) {
    if (!address || !chainId) {
      setStorageNotice({
        kind: "error",
        message:
          "Mail is keyed to a wallet: connect one so the draft is saved under the correct mailbox.",
        action: "connect-wallet",
      });
      setSidebarOpen(true);
      return;
    }
    const draft = {
      ...createBlankDraft(),
      recipient: input.address ?? "",
      conversationId: input.conversationId,
      inReplyTo: input.inReplyTo,
    };
    persistDraft(draft);
    setMailFolder("drafts");
    setMailboxFilter("all");
    setSelectedDraftId(draft.id);
    setComposerOpen(true);
    setMobileDetailOpen(true);
    setSidebarOpen(false);
  }

  function assignMessageAddress(messageId: string, assignedAddress: string) {
    if (!address || !chainId) return;
    try {
      setAssignments(
        saveMailAssignment(window.localStorage, chainId, address, messageId, {
          address: assignedAddress,
        }),
      );
      setStorageNotice({
        kind: "ok",
        message:
          "Assigned on this device only. That is a local label, not a proof.",
      });
    } catch (error: unknown) {
      setStorageNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Assignment failed.",
      });
    }
  }

  function proveAssignedAddress(messageId: string, assignedAddress: string) {
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    const proof = evaluateSenderProof({
      type: message.envelope.type,
      payload:
        message.envelope.type === "unsupported"
          ? null
          : message.envelope.payload,
      assignedAddress,
    });
    setProofs((current) => ({ ...current, [messageId]: proof }));
    let proofMessage =
      "This letter has no usable auth signature, so the assignment stays a local label.";
    if (proof.kind === "unbound_signature") {
      proofMessage =
        "The Mail auth signature is valid, but the claim is not bound to this mailbox or wallet address.";
    } else if (proof.kind === "invalid_signature") {
      proofMessage = "The claimed Mail auth signature is invalid.";
    }
    setStorageNotice({ kind: "error", message: proofMessage });
  }

  const walletGateShown = storageNotice?.action === "connect-wallet";

  function closeDetail() {
    if (composerOpen && activeDraft && isBlankDraft(activeDraft)) {
      removeDraft(activeDraft.id, false);
    }
    setComposerOpen(false);
    setMobileDetailOpen(false);
  }

  function selectFolder(nextFolder: MailFolder) {
    setMailFolder(nextFolder);
    setSidebarOpen(false);
    setMobileDetailOpen(false);
    setComposerOpen(nextFolder === "drafts" && Boolean(filteredDrafts[0]));
    if (nextFolder === "drafts") {
      const nextDraft = drafts.find((draft) =>
        draftMatchesFilter(draft, mailboxFilter),
      );
      setSelectedDraftId(nextDraft?.id ?? null);
    }
  }

  function selectTypeFilter(nextFilter: MailboxFilter) {
    setMailboxFilter(nextFilter);
    setSidebarOpen(false);
    setMobileDetailOpen(false);
  }

  return (
    <div className={styles.page}>
      <header className={styles.mobileTopbar}>
        <button
          ref={menuButtonRef}
          className={styles.menuButton}
          type="button"
          aria-label="Open mailbox sidebar"
          aria-controls="mail-sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        {/* The app header's current tab already says MAILBOX. This row carries
            what the pane is actually showing, so the phone layout does not
            spend one of its few rows repeating the module name. */}
        <span className={styles.mobileModuleTitle}>
          {composerOpen ? "New document" : folderLabel}
          {!composerOpen && mailboxFilter !== "all" ? (
            <em className={styles.mobileFilterChip}>{filterLabel}</em>
          ) : null}
        </span>
        <button
          className={styles.mobileCompose}
          type="button"
          aria-label="Compose new message"
          onClick={openComposer}
        >
          New
        </button>
      </header>

      {sidebarOpen ? (
        <button
          className={styles.sidebarBackdrop}
          type="button"
          aria-label="Close mailbox sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <main
        aria-label="APP20 Mail"
        className={`${styles.mailWorkspace} ${
          mobileDetailOpen ? styles.detailOpen : ""
        }`}
      >
        <aside
          ref={sidebarRef}
          id="mail-sidebar"
          inert={mobileSidebarMode && !sidebarOpen ? true : undefined}
          className={`${styles.mailSidebar} ${
            sidebarOpen ? styles.sidebarOpen : ""
          }`}
          role={mobileSidebarMode && sidebarOpen ? "dialog" : undefined}
          aria-modal={mobileSidebarMode && sidebarOpen ? true : undefined}
          aria-label="Mailbox sidebar"
        >
          <div className={styles.sidebarCloseRow}>
            <button
              ref={sidebarCloseRef}
              className={styles.sidebarClose}
              type="button"
              aria-label="Close mailbox sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          </div>

          <div className={styles.sidebarCreateActions}>
            <button
              className={styles.composeButton}
              type="button"
              onClick={openComposer}
            >
              <span aria-hidden="true">＋</span>
              Compose
            </button>
          </div>

          <nav className={styles.mailboxNav} aria-label="Mail folders">
            <span className={styles.sidebarLabel}>FOLDERS</span>
            {MAIL_FOLDERS.map((folder) => (
              <button
                key={folder.id}
                type="button"
                aria-current={mailFolder === folder.id ? "page" : undefined}
                onClick={() => selectFolder(folder.id)}
              >
                <span>{folder.label}</span>
                <strong>{folderCounts[folder.id]}</strong>
              </button>
            ))}
          </nav>

          <nav
            className={styles.typeFilterNav}
            aria-label="Filter current folder"
          >
            <span className={styles.sidebarLabel}>SHOW</span>
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={mailboxFilter === filter.id}
                onClick={() => selectTypeFilter(filter.id)}
              >
                <span>{filter.label}</span>
                <strong>{typeCounts[filter.id]}</strong>
              </button>
            ))}
          </nav>

          <section className={styles.sidebarScan} aria-labelledby="scan-title">
            <div className={styles.scanHeading}>
              <strong id="scan-title">Check for mail</strong>
            </div>
            <div className={styles.scanActions}>
              <button
                type="button"
                onClick={() => void scanInbox("newer")}
                disabled={!keypair || scanning}
              >
                {scanning ? "Checking…" : "Check for new mail"}
              </button>
              <button
                type="button"
                onClick={() => void scanInbox("older")}
                disabled={!keypair || scanning}
              >
                Load older mail
              </button>
            </div>
            <ScanProgress
              scanning={scanning}
              pages={scanProgress.pages}
              maxPages={scanProgress.maxPages}
              events={scanProgress.events}
              phase={scanMessage}
            />
            {keypair ? null : (
              <p className={styles.scanMessage}>
                Set up a mailbox key before checking for mail.
              </p>
            )}
            {scanCursorDescription ? (
              <p className={styles.scanMessage}>{scanCursorDescription}</p>
            ) : null}
            {!scanning && scanMessage ? (
              <p
                className={`${styles.scanMessage} ${
                  scanKind === "error" ? styles.scanMessageError : ""
                }`}
                role={scanKind === "error" ? "alert" : "status"}
              >
                {scanMessage}
              </p>
            ) : null}
          </section>

          <details className={styles.contactBackupPanel}>
            <summary>Encrypted mailbox recovery</summary>
            <div className={styles.contactBackupBody}>
              <p>
                Post authenticated contact or RFQ-history self-mail. Oversized
                ciphertext uses a verified CID pointer. The same wallet locates
                it; the mailbox recovery phrase decrypts it. Wallet alone is not
                enough. {MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}
              </p>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={
                  !keypair ||
                  !mailSeed ||
                  !helperAddress ||
                  actionStates["contacts:backup"]?.pending ||
                  actionStates["rfq-resume:backup"]?.pending
                }
                onClick={() => void handleContactBackup()}
              >
                {actionStates["contacts:backup"]?.pending
                  ? "Backing up…"
                  : "Back up contacts to Mailbox"}
              </button>
              {actionStates["contacts:backup"]?.message ? (
                <p className={styles.scanMessage} role="status">
                  {actionStates["contacts:backup"].message}
                </p>
              ) : null}
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={
                  !keypair ||
                  !mailSeed ||
                  !helperAddress ||
                  actionStates["contacts:backup"]?.pending ||
                  actionStates["rfq-resume:backup"]?.pending
                }
                onClick={() => void handleRfqHistoryBackup()}
              >
                {actionStates["rfq-resume:backup"]?.pending
                  ? "Backing up…"
                  : "Back up RFQ history"}
              </button>
              {actionStates["rfq-resume:backup"]?.message ? (
                <p className={styles.scanMessage} role="status">
                  {actionStates["rfq-resume:backup"].message}
                </p>
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={rfqAutoBackupEnabled}
                  disabled={!address || !chainId}
                  onChange={(event) =>
                    updateRfqAutoBackup(event.target.checked)
                  }
                />{" "}
                Automatically back up RFQ history after settlement (opt in)
              </label>
            </div>
          </details>

          <details className={styles.forgetDevice}>
            <summary>Device safety</summary>
            <p>
              Disconnecting is not logout: drafts, Sent copies, and aliases stay
              in this browser profile.
            </p>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={lockMailboxSession}
            >
              Lock mailbox this session
            </button>
            <button
              className={styles.warningButton}
              type="button"
              onClick={forgetThisDevice}
            >
              Forget this device
            </button>
          </details>

          <footer className={styles.sidebarFooter}>
            <a
              href="https://github.com/gstohl/app20"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
            <span>
              Ciphertext is public on-chain. Device encryption is optional.
            </span>
          </footer>
        </aside>

        {mailFolder === "drafts" ? (
          <DraftList
            drafts={filteredDrafts}
            selectedDraftId={selectedDraftId}
            filterLabel={filterLabel}
            onSelect={selectDraft}
            onDelete={(draftId) => removeDraft(draftId)}
          />
        ) : (
          <ConversationList
            messages={annotatedMessages}
            selectedMessageId={selectedMessageId}
            readMessageIds={readMessageIds}
            aliases={displayAliases}
            selfAddress={address}
            folderLabel={folderLabel}
            filterLabel={filterLabel}
            onSelect={selectMessage}
          />
        )}

        <section
          ref={readingPaneRef}
          className={styles.readingPane}
          aria-label="Reading pane"
        >
          <header className={styles.readingToolbar}>
            <button
              className={styles.backToList}
              type="button"
              aria-label="Back to message list"
              onClick={closeDetail}
            >
              ← Messages
            </button>
            <div>
              <span className={styles.sidebarLabel}>
                {composerOpen
                  ? "LOCAL DRAFT / NOT ENCRYPTED AT REST"
                  : selectedMessage
                    ? "LOCAL PLAINTEXT / CARBON COPY"
                    : "APP20 / MAILBOX / ENCRYPTED CORRESPONDENCE"}
              </span>
              <strong>
                {composerOpen
                  ? "New document"
                  : selectedMessage
                    ? folderLabel
                    : "Private correspondence desk"}
              </strong>
            </div>
            {composerOpen ? (
              <button
                className={styles.closeCompose}
                type="button"
                onClick={closeDetail}
              >
                Close
              </button>
            ) : null}
          </header>

          <div ref={readingScrollRef} className={styles.readingScroll}>
            {storageNotice ? (
              <div
                className={`${styles.storageNotice} ${
                  storageNotice.kind === "error"
                    ? styles.storageNoticeError
                    : ""
                }`}
                role={storageNotice.kind === "error" ? "alert" : "status"}
              >
                <span>{storageNotice.message}</span>
                {storageNotice.action === "connect-wallet" ? (
                  <span className={styles.connectAction}>
                    <SelectWallet />
                  </span>
                ) : null}
              </div>
            ) : null}
            {!keypair && selectedMessage && !composerOpen ? (
              <Onboard
                key={`${providerIndex}:${address}`}
                helperAddress={helperAddress}
                onKeyReady={handleKeyReady}
              />
            ) : null}
            {!keypair && composerOpen ? (
              <p className={styles.keySetupNotice}>
                <strong>No mailbox key on this device</strong>
                <span>
                  Write and save the draft now. Sending needs a mailbox key —{" "}
                  <a href="#mailbox-key-setup">set one up below</a>.
                </span>
              </p>
            ) : null}
            {composerOpen && activeDraft ? (
              <Compose
                draft={activeDraft}
                helperAddress={helperAddress}
                escrowAddress={escrowAddress}
                escrowEnabled={escrowEnabled}
                mailSeed={mailSeed}
                keyReady={Boolean(keypair)}
                networkName={networkName}
                onDraftChange={persistDraft}
                onDeleteDraft={(draftId) => removeDraft(draftId, false)}
                onSent={(message) => {
                  handleSent(message);
                  removeDraft(message.draftId, false);
                  setMailFolder("sent");
                  setMailboxFilter("all");
                  setSelectedMessageId(`sent:${message.documentId}`);
                  setComposerOpen(false);
                }}
              />
            ) : selectedMessage ? (
              <Thread
                messages={conversationMessages}
                focusVersion={messageActivation}
                selfAddress={address}
                aliases={displayAliases}
                otcState={otcState}
                escrowState={escrowState}
                actionStates={actionStates}
                onAccept={(offer, index) => void handleAccept(offer, index)}
                onDecline={(offer) => void handleDecline(offer)}
                onPostReceipt={(offer) => void handlePostReceipt(offer)}
                onPay={(request) => void handlePay(request)}
                onPayPrivatelyWithStrk={handlePayPrivatelyWithStrk}
                invoiceMaturityHeadBlock={invoiceMaturityHeadBlock}
                onEscrowFill={(fund) => void handleEscrowFill(fund)}
                onEscrowClaim={
                  providerIndex === constants.LOCALNET_PROVIDER_INDEX
                    ? (fund) => void handleLocalnetEscrowPayout(fund, "claim")
                    : undefined
                }
                onEscrowTimeout={
                  providerIndex === constants.LOCALNET_PROVIDER_INDEX
                    ? (fund) => void handleLocalnetEscrowPayout(fund, "timeout")
                    : undefined
                }
                onRestoreContacts={(payload, message) =>
                  void restoreContactBackup(payload, message)
                }
                onRestoreBackup={(payload, message) =>
                  void restoreAuthenticatedBackup(payload, message)
                }
                contactRestorePending={
                  actionStates["contacts:restore"]?.pending
                }
                backupRestorePending={actionStates["backup:restore"]?.pending}
                onReply={openComposerForRecipient}
                onAssign={assignMessageAddress}
                onProve={(messageId, assigned) =>
                  void proveAssignedAddress(messageId, assigned)
                }
                proofs={proofs}
              />
            ) : (
              <section
                className={styles.welcomeState}
                aria-labelledby="mail-welcome-title"
              >
                <div className={styles.welcomeSheet}>
                  <p className={styles.eyebrow}>APP20 / MAILBOX</p>
                  <h1 id="mail-welcome-title">
                    Encrypted messages. Private value.
                  </h1>
                  <p className={styles.welcomeCopy}>
                    {walletGateShown
                      ? "Composing sets up your mailbox key when needed."
                      : !address || !chainId
                        ? "Mail is keyed to a wallet: connect one to read this mailbox or write a letter. Your mailbox key is set up here when it is first needed."
                        : keypair
                          ? "Check for mail or compose a letter."
                          : "Composing sets up your mailbox key when needed."}
                  </p>
                  {/* The CTA has to be the step that is actually available:
                      offering compose to a disconnected desk only produced a
                      notice pointing at a control in the app header. The gate
                      notice carries the same control, so only one of the two
                      asks for the wallet at a time. */}
                  {walletGateShown ? null : !address || !chainId ? (
                    <div
                      className={`${styles.welcomeConnect} ${styles.connectAction}`}
                    >
                      <SelectWallet />
                    </div>
                  ) : (
                    <button
                      className={styles.welcomeCompose}
                      type="button"
                      onClick={openComposer}
                    >
                      Compose encrypted mail
                    </button>
                  )}
                </div>
              </section>
            )}
            {!keypair && composerOpen ? (
              <Onboard
                key={`${providerIndex}:${address}`}
                helperAddress={helperAddress}
                onKeyReady={handleKeyReady}
              />
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
