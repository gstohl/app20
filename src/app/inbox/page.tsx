"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { hash, validateAndParseAddress } from "starknet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useLocalnetTools } from "@/app/localnetToolsContext";
import Compose, { type SentEnvelope } from "@/components/mail/Compose";
import ConversationList, {
  mailboxMatchesFilter,
  type MailboxFilter,
} from "@/components/mail/ConversationList";
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
} from "@/lib/address-book";
import { loadAliases, type AliasRecord } from "@/lib/aliases";
import { feltEquals } from "@/lib/addresses";
import { parseCompositePayload } from "@/lib/composite";
import {
  createBlankDraft,
  deleteDraft,
  loadDrafts,
  saveDraft,
  type CompositeDraft,
} from "@/lib/drafts";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import {
  claimEscrowOperation,
  confirmEscrowOperation,
  deriveEscrowClaimKey,
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
  ESCROW_OPERATION_VARIANT,
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
  buildEscrowFillActions,
} from "@/lib/escrow-actions";
import type {
  DecryptedMail,
  EncryptedMailRecord,
  MailKeypair,
} from "@/lib/mail";
import { encryptMail, publicKeyFromFelts } from "@/lib/mail";
import {
  MAIL_SCAN_CHUNK_SIZE,
  MAIL_SCAN_MAX_MESSAGES,
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
import { isConfiguredMailHelper } from "@/lib/mail-actions";
import { describeMailScanCursor } from "@/lib/mail-correspondents";
import { authorizeStrk20ValueAction } from "@/lib/mainnet-safety";
import { clearLocalMailboxStorage } from "@/lib/local-mailbox-storage";
import { inspectMailVault } from "@/lib/mail-vault";
import { paymentLinkChainIdsEqual } from "@/lib/payment-link";
import { importPendingPaymentIntoMailbox } from "@/lib/payment-link-handoff";
import {
  loadPendingPayment,
  PENDING_PAYMENT_STORAGE_KEY,
} from "@/lib/pending-payment";
import {
  acceptPayloadForOffer,
  claimOtcAccept,
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
  parseDeclinePayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
  receiptForTransfer,
  recordDealEvent,
  recordPaymentRequest,
  recordUnverifiedPaymentClaim,
  releaseOtcAccept,
  releasePayment,
  type AcceptPayload,
  type OfferPayload,
  type OtcState,
  type PaymentRecord,
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  computeActionId,
  QUIETLINE_HELPER_FUNDING_BASE_UNITS,
  strk20ErrorMessage,
  submitActions,
  transactionHashFromError,
  transactionStateFromError,
  submitMail,
  submitMemoTransfer,
  submitOtcAccept,
} from "@/lib/strk20";
import {
  loadSentMail,
  saveSentMail,
  type StoredSentMail,
} from "@/lib/sent-mail";
import {
  loadMailAssignments,
  saveMailAssignment,
  type MailAssignment,
} from "@/lib/mail-assignments";
import { conversationKeyForMessage } from "@/lib/mail-thread";
import { evaluateSenderProof, type SenderProof } from "@/lib/sender-proof";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import * as constants from "@/utils/constants";
import styles from "@/components/mail/mail.module.css";

import {
  TYPE_FILTERS,
  MAIL_FOLDERS,
  type MailFolder,
  type ScanKind,
  type ScanWorkerResponse,
  type ActiveScanWorker,
  type LocalnetDynamicEscrowInvoke,
  secretKeyHex,
  helperForNetwork,
  escrowForNetwork,
  loadPersistedMailSeed,
  mailKeyFingerprint,
  mergeMailMessages,
  sortMailMessages,
  storedSentToLocal,
  paymentLinkToLocal,
  paymentLinkRecords,
  draftMatchesFilter,
  parseBlockTimestamp,
} from "./mailbox-model";

export default function InboxPage() {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const renderLocalnetTools = useLocalnetTools();
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

  const displayAliases = useMemo(() => {
    const seen = new Set(
      bookEntries.map((entry) => BigInt(entry.address).toString(16)),
    );
    return [
      ...bookEntries,
      ...aliases.filter(
        (alias) => !seen.has(BigInt(alias.address).toString(16)),
      ),
    ];
  }, [aliases, bookEntries]);
  const [otcState, setOtcState] = useState<OtcState>(emptyOtcState());
  const [escrowState, setEscrowState] = useState<EscrowState>(
    emptyEscrowState(),
  );
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
  const [pendingPaymentRequest, setPendingPaymentRequest] =
    useState<PaymentRequestPayload | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSidebarMode, setMobileSidebarMode] = useState(false);
  const [storageNotice, setStorageNotice] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);
  const [assignments, setAssignments] = useState<
    Record<string, MailAssignment>
  >({});
  const [proofs, setProofs] = useState<Record<string, SenderProof>>({});

  const helperAddress = helperForNetwork(providerIndex);
  const escrowAddress = escrowForNetwork(providerIndex);
  const escrowEnabled = providerIndex !== 0 && escrowAddress !== null;
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
  const readingPaneRef = useRef<HTMLElement | null>(null);
  const readingScrollRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement | null>(null);
  const sidebarWasOpenRef = useRef(false);
  const activatedMessageIdRef = useRef<string | null>(null);
  scanIdentityRef.current = scanIdentity;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
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
    active.worker.terminate();
    active.reject(new Error("Mail scan cancelled."));
  }

  function decryptMailRecords(
    privateKey: Uint8Array,
    records: EncryptedMailRecord[],
  ): Promise<DecryptedMail[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("../../workers/mail-scan.worker.ts", import.meta.url),
        { type: "module" },
      );
      const active: ActiveScanWorker = { worker, reject };
      scanWorkerRef.current = active;

      function finish() {
        worker.terminate();
        if (scanWorkerRef.current === active) scanWorkerRef.current = null;
      }

      worker.onmessage = (event: MessageEvent<ScanWorkerResponse>) => {
        finish();
        if (event.data.ok) resolve(event.data.decrypted);
        else reject(new Error(event.data.message));
      };
      worker.onerror = () => {
        finish();
        reject(new Error("The background mailbox scanner failed."));
      };
      worker.postMessage({ privateKey, records });
    });
  }

  useEffect(() => {
    scanGenerationRef.current += 1;
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
              paymentLinkToLocal(payment.request, payment.updatedAt),
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
      cancelActiveScanWorker();
    };
  }, [address, chainId, providerIndex]);

  useEffect(() => {
    try {
      const request = loadPendingPayment(window.sessionStorage);
      if (!request) return;
      const message = paymentLinkToLocal(request);
      setPendingPaymentRequest(request);
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
    if (!pendingPaymentRequest || !address || !chainId) return;
    const actionKey = `payment:${pendingPaymentRequest.requestId}`;
    try {
      const imported = importPendingPaymentIntoMailbox(
        window.sessionStorage,
        window.localStorage,
        chainId,
        address,
      );
      if (!imported) {
        setPendingPaymentRequest(null);
        return;
      }
      setOtcState(expireStoredDeals(window.localStorage, chainId, address));
      const message = paymentLinkToLocal(imported.request, imported.updatedAt);
      setMessages((current) => mergeMailMessages(current, [message]));
      setPendingPaymentRequest(null);
      setMailFolder("inbox");
      setMailboxFilter("invoices");
      setSelectedMessageId(message.id);
      setActionState(actionKey, {
        pending: false,
        message:
          "Unsigned link imported for local review. No payment was submitted.",
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
  }, [address, chainId, pendingPaymentRequest]);

  useEffect(() => {
    if (mailFolder === "drafts") {
      const visibleDrafts = drafts.filter((draft) =>
        draftMatchesFilter(draft, mailboxFilter),
      );
      if (
        selectedDraftId &&
        visibleDrafts.some((draft) => draft.id === selectedDraftId)
      ) {
        return;
      }
      setSelectedDraftId(visibleDrafts[0]?.id ?? null);
      return;
    }
    const inFolder = messages.filter((message) =>
      mailFolder === "sent"
        ? message.direction === "outgoing"
        : message.direction !== "outgoing",
    );
    const visibleMessages = inFolder.filter((message) =>
      mailboxMatchesFilter(message, mailboxFilter),
    );
    if (
      selectedMessageId &&
      visibleMessages.some((message) => message.id === selectedMessageId)
    ) {
      return;
    }
    const firstMessage = visibleMessages[0];
    setSelectedMessageId(firstMessage?.id ?? null);
  }, [
    drafts,
    mailFolder,
    mailboxFilter,
    messages,
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
        if (!feltEquals(record.fund.escrowAddress, escrowAddress)) return;
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
      }),
    );
    if (address === scopeAddress && chainId === scopeChainId) {
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
  ) {
    const poolAddress = constants.strk20PoolForProviderIndex(providerIndex);
    if (!poolAddress) {
      throw new Error("The STRK20 pool is not configured for this network.");
    }
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
          const decline = parseDeclinePayload(envelope.payload);
          if (decline) {
            recordDealEvent(window.localStorage, chainId, address, {
              type: "decline",
              payload: decline,
            });
          }
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
                paymentLinkToLocal(payment.request, payment.updatedAt),
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
      helperFundingAmount: QUIETLINE_HELPER_FUNDING_BASE_UNITS,
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
        message: "Reading the live pool fee and public STRK balance…",
        startedAt: Date.now(),
      });
      await authorizeValueAction(
        context,
        "Accept OTC private transfer",
        offer.give.amount,
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
          helperFundingAmount: QUIETLINE_HELPER_FUNDING_BASE_UNITS,
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
        helperFundingAmount: QUIETLINE_HELPER_FUNDING_BASE_UNITS,
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
      const reservedPayment = claimPayment(
        window.localStorage,
        context.chainId,
        context.address,
        request,
      );
      const payableRequest = reservedPayment.request;
      const attemptId = reservedPayment.paymentOperation?.attemptId;
      if (!attemptId) {
        throw new Error(
          "The payer-owned payment attempt id was not persisted.",
        );
      }
      claimed = true;
      refreshOtcState();
      setActionState(actionKey, {
        pending: true,
        message: "Reading the live pool fee and public STRK balance…",
        startedAt: Date.now(),
      });
      await authorizeValueAction(
        context,
        "Invoice private payment",
        payableRequest.amount,
      );
      setActionState(actionKey, {
        pending: true,
        message: "Preparing one private STRK payment and payment memo…",
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
          tokenAddress: constants.addrSTRK,
          recipient: payableRequest.requester,
          amount: payableRequest.amount,
          record,
          helperFundingAmount: QUIETLINE_HELPER_FUNDING_BASE_UNITS,
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
              message: `Private STRK payment submitted (${transactionHash}); confirmation pending.`,
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
        message: "Private STRK payment and encrypted memo confirmed.",
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
          "Fill confirmed: leg A was released to the taker; leg B awaits the maker's signed claim.",
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
    let dynamicInvoke: LocalnetDynamicEscrowInvoke | undefined;
    let claimPrivateKey: Uint8Array | undefined;
    try {
      if (
        providerIndex !== constants.LOCALNET_PROVIDER_INDEX ||
        !constants.localnetWalletEnabled
      ) {
        throw new Error(
          "Destination-bound escrow payouts are unavailable through this wallet.",
        );
      }
      const context = requireActionContext();
      if (!escrowAddress || !mailSeed) {
        throw new Error(
          "Load the localnet mailbox seed and escrow deployment.",
        );
      }
      if (!feltEquals(fund.escrowAddress, escrowAddress)) {
        throw new Error("This deal names a different escrow deployment.");
      }
      if (!feltEquals(fund.maker, context.address)) {
        throw new Error(
          "Only this deal's maker mailbox can derive the claim key.",
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
      const claimKey = deriveEscrowClaimKey(mailSeed, fund.dealId);
      claimPrivateKey = claimKey.privateKey;
      if (!feltEquals(claimKey.claimPubkey, fund.claimPubkey)) {
        throw new Error(
          "This restored mailbox seed does not match the deal's on-chain claim key.",
        );
      }
      const payoutToken =
        operation === "claim"
          ? fund.legB.token.address
          : fund.legA.token.address;
      dynamicInvoke = {
        type: "invoke",
        contract: escrowAddress,
        calldata: [
          operation === "claim"
            ? ESCROW_OPERATION_VARIANT.Claim
            : ESCROW_OPERATION_VARIANT.Timeout,
          "${quietlineEscrowSigR}",
          "${quietlineEscrowSigS}",
          fund.dealId,
          POOL_ADDRESS_PLACEHOLDER,
          OPEN_NOTE_ID_PLACEHOLDER,
        ],
        quietline_escrow_signer: {
          private_key: secretKeyHex(claimKey.privateKey),
          operation,
          open_note_index: 0,
        },
      };
      const actions = [
        {
          type: "transfer" as const,
          token: payoutToken,
          amount: "OPEN" as const,
          recipient: context.address,
        },
        dynamicInvoke,
      ] as WALLET_API.STRK20_ACTION[];
      const startedAt = Date.now();
      setActionState(actionKey, {
        pending: true,
        message:
          "Localnet compiler is assembling the payout note before signing it…",
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
                "Destination-bound payout submitted; waiting for localnet confirmation…",
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
    } finally {
      // The scalar is localnet-only, never persisted, and erased from mutable
      // buffers immediately after the compiler request completes.
      claimPrivateKey?.fill(0);
      if (dynamicInvoke) {
        dynamicInvoke.quietline_escrow_signer.private_key = "0x0";
      }
    }
  }

  const inboxMessages = messages.filter(
    (message) => message.direction !== "outgoing",
  );
  const sentMessages = messages.filter(
    (message) => message.direction === "outgoing",
  );
  const folderCounts: Record<MailFolder, number> = {
    inbox: inboxMessages.length,
    sent: sentMessages.length,
    drafts: drafts.length,
  };
  const folderMessages = mailFolder === "sent" ? sentMessages : inboxMessages;
  const typeCounts: Record<MailboxFilter, number> = {
    all: mailFolder === "drafts" ? drafts.length : folderMessages.length,
    letters: 0,
    deals: 0,
    invoices: 0,
    escrow: 0,
  };
  for (const filter of TYPE_FILTERS.slice(1)) {
    typeCounts[filter.id] =
      mailFolder === "drafts"
        ? drafts.filter((draft) => draftMatchesFilter(draft, filter.id)).length
        : folderMessages.filter((message) =>
            mailboxMatchesFilter(message, filter.id),
          ).length;
  }
  const filteredMessages = folderMessages.filter((message) =>
    mailboxMatchesFilter(message, mailboxFilter),
  );
  const filteredDrafts = drafts.filter((draft) =>
    draftMatchesFilter(draft, mailboxFilter),
  );
  const annotatedMessages = filteredMessages.map((message) => ({
    ...message,
    assignedAddress: assignments[message.id]?.address,
    localConversationId: assignments[message.id]?.conversationId,
  }));
  const selectedMessage = annotatedMessages.find(
    (message) => message.id === selectedMessageId,
  );
  const selectedConversationId = selectedMessage
    ? conversationKeyForMessage(selectedMessage)
    : null;
  const conversationMessages = selectedConversationId
    ? annotatedMessages
        .filter(
          (message) =>
            conversationKeyForMessage(message) === selectedConversationId,
        )
        .slice()
        .reverse()
    : [];
  const activeDraft = drafts.find((draft) => draft.id === selectedDraftId);
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
      setStorageNotice({
        kind: "ok",
        message: "Draft saved in this browser profile (not encrypted at rest).",
      });
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
        "Forget this device and clear every mailbox key, draft, Sent copy, alias, payment/OTC record, escrow record, and scan cursor from this browser profile? On-chain ciphertext remains public. You will need the offline backup to read this mailbox again.",
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
      setPendingPaymentRequest(null);
      setComposerOpen(false);
      setMobileDetailOpen(false);
      setMailFolder("inbox");
      setMailboxFilter("all");
      setStorageNotice({
        kind: "ok",
        message: `Forgot this device: removed ${removed.length} local mailbox record${removed.length === 1 ? "" : "s"}. Disconnecting alone does not do this. Restore the offline backup to reopen encrypted mail.`,
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

  function selectMessage(messageId: string) {
    activatedMessageIdRef.current = messageId;
    setSelectedMessageId(messageId);
    setMessageActivation((current) => current + 1);
    setComposerOpen(false);
    setMobileDetailOpen(true);
  }

  function selectDraft(draftId: string) {
    setSelectedDraftId(draftId);
    setComposerOpen(true);
    setMobileDetailOpen(true);
    setSidebarOpen(false);
  }

  function openComposer() {
    if (!address || !chainId) {
      setStorageNotice({
        kind: "error",
        message:
          "Connect a wallet before creating a draft so it is saved under the correct mailbox.",
      });
      setSidebarOpen(true);
      return;
    }
    const draft = createBlankDraft();
    persistDraft(draft);
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
          "Connect a wallet before creating a draft so it is saved under the correct mailbox.",
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

  async function proveAssignedAddress(
    messageId: string,
    assignedAddress: string,
  ) {
    if (!helperAddress) {
      setStorageNotice({
        kind: "error",
        message: "Directory proof needs the mail helper on this network.",
      });
      return;
    }
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    try {
      const directoryKey = await lookupMailKey(helperAddress, assignedAddress);
      const proof = evaluateSenderProof({
        type: message.envelope.type,
        payload:
          message.envelope.type === "unsupported"
            ? null
            : message.envelope.payload,
        assignedAddress,
        directoryAddress: assignedAddress,
        directoryMailboxKey: directoryKey,
      });
      setProofs((current) => ({ ...current, [messageId]: proof }));
      setStorageNotice({
        kind: proof.kind === "directory_bound" ? "ok" : "error",
        message:
          proof.kind === "directory_bound"
            ? `Directory match: this letter's mailbox key is registered to ${assignedAddress}.`
            : proof.kind === "mailbox_signed"
              ? "The letter is signed by a mailbox key, but that key is not the one registered to this address."
              : proof.kind === "invalid_signature"
                ? "The claimed mailbox signature is invalid."
                : "This letter has no mailbox signature, so the assignment stays a local label.",
      });
    } catch (error: unknown) {
      setStorageNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Directory lookup failed.",
      });
    }
  }

  function closeDetail() {
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

  function focusMailboxKeySetup() {
    setSidebarOpen(false);
    setMobileDetailOpen(true);
    window.requestAnimationFrame(() => {
      const setup = document.getElementById("mailbox-key-setup");
      setup?.scrollIntoView({ block: "start" });
      setup
        ?.querySelector<HTMLButtonElement>("button:not([disabled])")
        ?.focus();
    });
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
        <span className={styles.mobileModuleTitle}>APP20 Mail</span>
        <button
          className={styles.mobileCompose}
          type="button"
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
          <header className={styles.sidebarBrandRow}>
            <span className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true">
                20
              </span>
              <span>APP20 Mail</span>
            </span>
            <button
              ref={sidebarCloseRef}
              className={styles.sidebarClose}
              type="button"
              aria-label="Close mailbox sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          </header>
          <p className={styles.sidebarTagline}>
            ENCRYPTED CORRESPONDENCE / LOCAL KEYS
          </p>

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


          <div className={styles.networkRow}>
            <span
              className={`${styles.networkDot} ${
                helperAddress && walletAccount && isStrk20Capable
                  ? styles.networkDotLive
                  : ""
              }`}
              aria-hidden="true"
            />
            <span>{networkName}</span>
            <small>
              {helperAddress ? "MAIL RAIL READY" : "NO MAIL HELPER"}
            </small>
          </div>


          {renderLocalnetTools ? (
            <div className={styles.localnetSlot}>{renderLocalnetTools()}</div>
          ) : null}

          <section className={styles.sidebarScan} aria-labelledby="scan-title">
            <div className={styles.scanHeading}>
              <div>
                <span className={styles.sidebarLabel}>INBOX CHECK</span>
                <strong id="scan-title">Check for mail</strong>
              </div>
              <span className={styles.sealGlyph} aria-hidden="true">
                ✉
              </span>
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
            {keypair &&
            !scanMessage &&
            address &&
            chainId &&
            helperAddress &&
            keyFingerprint ? (
              <p className={styles.scanMessage}>
                {describeMailScanCursor(
                  loadMailScanCursor(
                    window.localStorage,
                    mailScanCursorKey(
                      chainId,
                      address,
                      helperAddress,
                      keyFingerprint,
                    ),
                  ),
                )}
              </p>
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

          <section
            className={styles.forgetDevice}
            aria-labelledby="forget-device-title"
          >
            <span className={styles.sidebarLabel}>SHARED-MACHINE SAFETY</span>
            <strong id="forget-device-title">You choose device risk</strong>
            <p>
              Disconnecting is not logout. Drafts, Sent copies, and aliases stay
              in this profile. The mailbox seed is clear by default, or
              passphrase-wrapped if you chose that. Lock this tab to drop the
              unlocked key from memory.
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
              Forget this device / clear local mailbox
            </button>
          </section>

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
                    : "APP20 MAIL / ENCRYPTED CORRESPONDENCE"}
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
              <p
                className={`${styles.storageNotice} ${
                  storageNotice.kind === "error"
                    ? styles.storageNoticeError
                    : ""
                }`}
                role={storageNotice.kind === "error" ? "alert" : "status"}
              >
                {storageNotice.message}
              </p>
            ) : null}
            {!keypair && (composerOpen || selectedMessage) ? (
              <Onboard
                key={`${providerIndex}:${address}`}
                helperAddress={helperAddress}
                onKeyReady={handleKeyReady}
              />
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
                  <p className={styles.eyebrow}>
                    APP20 MAIL / ENCRYPTED CORRESPONDENCE
                  </p>
                  <h1 id="mail-welcome-title">
                    A private desk for messages and value.
                  </h1>
                  <p className={styles.welcomeCopy}>
                    Compose encrypted letters, attach private STRK payment
                    context, and keep readable mail on this device. The mail
                    helper records ciphertext and delivery metadata on Starknet;
                    your mailbox key decrypts locally.
                  </p>
                  <div className={styles.privacySummary}>
                    <div>
                      <strong>LOCAL OR IN-POOL</strong>
                      <span>
                        Plaintext and mailbox keys stay on this device. In-pool
                        amounts and direct addresses stay out of MessagePosted.
                      </span>
                    </div>
                    <div>
                      <strong>PUBLIC ON STARKNET</strong>
                      <span>
                        Pool and helper activity, timing, ciphertext size,
                        recipient count, and every shield or unshield.
                      </span>
                    </div>
                  </div>
                  <p className={styles.honestyNote}>
                    APP20 Mail reduces exposed correspondence data; it does not
                    hide that the pool or mail helper was used. Timing can still
                    correlate activity.
                  </p>
                  <ol className={styles.readinessList}>
                    <li>
                      <strong>1. Wallet session</strong>
                      <span>
                        {address
                          ? `Connected on ${networkName}.`
                          : "Connect a privacy-enabled wallet on Mainnet or Sepolia."}
                      </span>
                    </li>
                    <li>
                      <strong>2. Mailbox access</strong>
                      <span>
                        {keypair
                          ? "Your device mailbox key is unlocked."
                          : helperAddress
                            ? "Register or restore your mailbox key. Registration is one public transaction."
                            : "Mailbox registration waits on the mail helper. Vault actions remain available."}
                      </span>
                    </li>
                    <li>
                      <strong>3. Value stays in Vault</strong>
                      <span>
                        Shield, private transfer, and unshield live on the Vault
                        desk. Mail can attach payment context; it does not
                        replace the wallet.
                      </span>
                    </li>
                    <li>
                      <strong>4. Correspondence</strong>
                      <span>
                        Sync incoming ciphertext or compose a message. Readable
                        Sent copies remain on this device.
                      </span>
                    </li>
                  </ol>
                  <button
                    className={styles.welcomeCompose}
                    type="button"
                    onClick={openComposer}
                  >
                    Compose encrypted mail
                  </button>
                </div>
                {keypair ? null : (
                  <Onboard
                    key={`${providerIndex}:${address}`}
                    helperAddress={helperAddress}
                    onKeyReady={handleKeyReady}
                  />
                )}
              </section>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
