"use client";

import { rejectOneSidedChatSwap, rejectPublicSettlement } from "@app20/domain";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hash, validateAndParseAddress } from "starknet";
import { startChatRefresh } from "./chat-refresh";
import { clearChatSession, rememberChatSession, restoreChatSession } from "./chat-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { loadReadMessageIds, saveReadMessageIds } from "@/lib/mail-read-state";
import type { SentEnvelope } from "@/components/chat/Compose";
import type {
  LocalMailMessage,
  ThreadActionState,
} from "@/components/chat/message";
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
import { conversationKeyForMessage } from "@/lib/mail-thread";
import { evaluateSenderProof, type SenderProof } from "@/lib/sender-proof";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import * as constants from "@/utils/constants";

import {
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
  parseBlockTimestamp,
} from "./mailbox-model";

export type MailboxFocusRequest =
  | { kind: "message"; id: string }
  | { kind: "recipient"; address: string };

/**
 * The mailbox desk: every piece of state and every handler the Mailbox page
 * carried, without its folders, panes and sidebar. Chat mounts this once and
 * renders the same records one counterparty at a time; the value actions,
 * scans, backups and device safety below are the Mailbox implementations,
 * moved rather than rewritten.
 */
export function useMailboxDesk() {
  const navigate = useNavigate();
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const address = useStoreWallet((state) => state.address);
  const isConnected = useStoreWallet((state) => state.isConnected);
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
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const scanBusyRef = useRef<string | null>(null);
  const keyScopeRef = useRef<string | null>(null);
  const [scanKind, setScanKind] = useState<ScanKind>("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [scanProgress, setScanProgress] = useState({
    pages: 0,
    events: 0,
    maxPages: MAIL_SCAN_MAX_PAGES,
  });
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(
    () => new Set(),
  );

  /* Read state belongs to this device and this account: it is loaded when the
     account is known and written back as records are opened, so a reload no
     longer marks a whole mailbox unread. */
  useEffect(() => {
    setReadMessageIds(
      chainId && address
        ? loadReadMessageIds(window.localStorage, chainId, address)
        : new Set(),
    );
  }, [address, chainId]);

  const [drafts, setDrafts] = useState<CompositeDraft[]>([]);
  const [pendingPayment, setPendingPayment] =
    useState<DecodedPaymentLink | null>(null);
  /* Where Chat should look next: an imported payment request, or the
     counterparty a Counterparties or RFQ handoff named. */
  const [focusRequest, setFocusRequest] = useState<MailboxFocusRequest | null>(
    null,
  );
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
    setFocusRequest({ kind: "recipient", address: recipient });
  }, [address, chainId]);

  function cancelActiveScanWorker() {
    const active = scanWorkerRef.current;
    if (!active) return;
    scanWorkerRef.current = null;
    active.reject(new Error("Chat scan cancelled."));
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
          reject(new Error("The background chat scanner failed."));
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
    scanBusyRef.current = null;
    keyScopeRef.current = null;
    setLastCheckedAt(null);
    setScanning(false);
    const restored = isConnected && address && chainId && helperAddress
      ? restoreChatSession(`${providerIndex}:${chainId}:${address}`) : null;
    setKeypair(restored?.keypair ?? null);
    setMailSeed(restored?.seed ?? null);
    keyScopeRef.current = restored?.scope ?? null;
    setMessages([]);
    setDrafts([]);
    setScanKind("idle");
    setScanMessage("");
    setScanProgress({ pages: 0, events: 0, maxPages: MAIL_SCAN_MAX_PAGES });
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
  }, [address, chainId, providerIndex, isConnected]);

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
      setFocusRequest({ kind: "message", id: message.id });
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
      setFocusRequest({ kind: "message", id: message.id });
      setActionState(actionKey, {
        pending: false,
        message:
          imported.linkAuthenticity?.kind === "verified"
            ? "Verified Chat-signed link imported for local review. No payment was submitted."
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

  /* Every record this device may show: authenticated backups only, and a
     device-local name carried to every record in its conversation, including
     ones decrypted later. */
  const annotatedMessages = useMemo(() => {
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
    const assignedByConversation = new Map<string, string>();
    for (const message of visibleMessages) {
      const assigned = assignments[message.id]?.address;
      if (!assigned) continue;
      const conversation = conversationKeyForMessage({
        ...message,
        localConversationId: assignments[message.id]?.conversationId,
      });
      if (!assignedByConversation.has(conversation)) {
        assignedByConversation.set(conversation, assigned);
      }
    }
    return visibleMessages.map((message) => {
      const localConversationId = assignments[message.id]?.conversationId;
      const conversation = conversationKeyForMessage({
        ...message,
        localConversationId,
      });
      return {
        ...message,
        assignedAddress:
          assignments[message.id]?.address ??
          assignedByConversation.get(conversation),
        localConversationId,
      };
    });
  }, [address, assignments, chainId, helperAddress, keyFingerprint, mailSeed, messages]);

  /* Read state is written when Chat opens a conversation; a reload no longer
     marks a whole mailbox unread. */
  const markMessagesRead = useCallback(
    (ids: readonly string[]) => {
      setReadMessageIds((current) => {
        const pending = ids.filter((id) => !current.has(id));
        if (!pending.length) return current;
        const next = new Set(current);
        for (const id of pending) next.add(id);
        if (chainId && address) {
          saveReadMessageIds(window.localStorage, chainId, address, next);
        }
        return next;
      });
    },
    [address, chainId],
  );

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
    if (!helperAddress) throw new Error("Chat is unavailable on this network.");
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
      throw new Error("The response recipient has not registered a chat key.");
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
    keyScopeRef.current = `${providerIndex}:${chainId}:${address}`;
    scanGenerationRef.current += 1;
    escrowRefreshRef.current += 1;
    cancelActiveScanWorker();
    recentLoadedRef.current = false;
    scanBusyRef.current = null;
    setLastCheckedAt(null);
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
    const seed = nextSeed ??
        (address && chainId
          ? loadPersistedMailSeed(window.localStorage, chainId, address)
          : null);
    setMailSeed(seed);
    if (seed) rememberChatSession({ scope: `${providerIndex}:${chainId}:${address}`, keypair: nextKeypair, seed });
    // A counterparty can advance an escrow while this mailbox is inactive.
    // Refresh contract state when its device key is loaded so maker actions
    // (notably Claim after Fill) do not remain stuck on a stale local snapshot.
    void refreshEscrowChainDeals();
  }

  async function scanInbox(requested: "newer" | "older" = "newer") {
    if (scanBusyRef.current === scanIdentity) return;
    if (!keypair) {
      setScanKind("error");
      setScanMessage("Unlock Chat to check your messages.");
      return;
    }
    if (!helperAddress) {
      setScanKind("error");
      setScanMessage(`No chat service is configured on ${networkName}.`);
      return;
    }
    if (!address || !chainId || !keyFingerprint) {
      setScanKind("error");
      setScanMessage("Connect your wallet to check messages.");
      return;
    }

    scanBusyRef.current = scanIdentity;
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
        ? "Loading earlier messages…"
        : "Checking for new messages…",
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
        setLastCheckedAt(Date.now());
        setScanMessage(
          requested === "older"
            ? "You’ve reached the start of your message history."
            : "You’re up to date.",
        );
        return;
      }

      setScanMessage(
        requested === "older" ? "Looking for earlier messages…" : "Checking for new messages…",
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
          throw new Error("The RPC exceeded the bounded messages event page size.");
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
        "Opening your encrypted messages on this device…",
      );
      const decrypted = await decryptMailRecords(
        privateKey,
        parsed.map((event) => event.record),
      );
      if (!isCurrentScan()) return;
      setScanMessage("Updating conversations…");

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
      setLastCheckedAt(Date.now());
      const knownIds = new Set(messages.map(message => message.id));
      const added = localMessages.filter(message => !knownIds.has(message.id)).length;
      setScanMessage(
        `${added ? `${added} ${requested === "older" ? "earlier" : "new"} message${added === 1 ? "" : "s"}.` : "You’re up to date."}${
          continuationToken
            ? " More messages will load on the next check."
            : ""
        }`,
      );
    } catch (error: unknown) {
      if (isCurrentScan()) {
        setScanKind("error");
        setScanMessage(
          error instanceof Error ? error.message : "Couldn’t check messages. We’ll try again automatically.",
        );
      }
    } finally {
      if (isCurrentScan()) {
        scanBusyRef.current = null;
        setScanning(false);
      }
    }
  }

  const refreshChatRef = useRef(scanInbox);
  refreshChatRef.current = scanInbox;
  useEffect(() => {
    if (!keyFingerprint || !helperAddress || !address || !chainId) return;
    const identity = scanIdentity;
    return startChatRefresh({
      refresh: () => refreshChatRef.current("newer"),
      canRefresh: () => scanIdentityRef.current === identity && scanBusyRef.current !== identity &&
        useStoreWallet.getState().isConnected &&
        keyScopeRef.current === `${providerIndex}:${chainId}:${address}` &&
        document.visibilityState === "visible" && navigator.onLine !== false,
      visibility: document,
      connectivity: window,
    });
  }, [scanIdentity, keyFingerprint, helperAddress, providerIndex, address, chainId]);

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
          "Unlock the chat and save its recovery phrase before backing up.",
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
            "The verified backup pointer exceeds one Chat message.",
          );
        }
        external = true;
      }
      await authorizeValueAction(
        context,
        `Back up ${kind === "contacts" ? "contacts" : "RFQ history"} to encrypted Chat`,
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
        message: `Backup plaintext never left this browser. Wallet plus chat recovery phrase are required to decrypt it. ${MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}`,
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
          "Connect the matching wallet and unlock its chat recovery phrase first.",
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
        message: `Authenticated backup sequence ${snapshot.seq} (${usedSource}) restored.${fallbackWarning} Chat and IPFS supplied encrypted evidence only; neither proves settlement.`,
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
          "Connect the matching wallet and unlock its chat recovery phrase first.",
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
          ? "A newer authenticated contact snapshot is loaded in this chat."
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
          "Authenticated contact snapshot restored. Chat supplied encrypted evidence only; it did not trigger a trade or prove settlement.",
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
            "Message delivered. Sent copy saved in this browser profile (not encrypted at rest).",
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
      rejectOneSidedChatSwap();
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
          message: `Payment complete; receipt not confirmed. Use “Post receipt” to retry only the receipt. ${strk20ErrorMessage(receiptError)}`,
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
    let transferVerified = false;
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
      transferVerified = true;
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
        message: transferVerified
          ? `Payment complete; receipt not confirmed. You can retry only the receipt. ${strk20ErrorMessage(error)}`
          : strk20ErrorMessage(error),
      });
    }
  }

  function handlePayPrivatelyWithStrk(request: PaymentRequestPayload) {
    const actionKey = `payment:${request.requestId}`;
    try {
      rejectPublicSettlement();
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
          returnTo: "/chat",
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
          "Checking the shielded payment balance and network fees…",
        startedAt: Date.now(),
      });
      await authorizeValueAction(
        context,
        "Invoice private payment",
        payableRequest.amount,
        [payableRequest.amount],
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
      if (claimed && outcome && (hash || outcome === "unknown") && address && chainId) {
        try {
          markPaymentOutcome(
            window.localStorage,
            chainId,
            address,
            request.requestId,
            hash || undefined,
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
      rejectPublicSettlement();
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
      if (confirmDelete) setStorageNotice({
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
    clearChatSession();
    keyScopeRef.current = null;
    scanGenerationRef.current += 1;
    scanIdentityRef.current = "";
    scanBusyRef.current = null;
    cancelActiveScanWorker();
    setScanning(false);
    setLastCheckedAt(null);
    mailSeed?.fill(0);
    keypair?.privateKey.fill(0);
    setMailSeed(null);
    setKeypair(null);
    setStorageNotice({
      kind: "ok",
      message:
        "Chat locked in this tab. A passphrase-wrapped vault stays on this device; a plaintext seed is still in this profile until you forget the device.",
    });
  }

  function forgetThisDevice() {
    if (
      !window.confirm(
        `Forget this device and clear every chat key, draft, Sent copy, alias, payment/OTC record, escrow record, and scan cursor from this browser profile? On-chain ciphertext remains public. You will need the offline backup to read this chat again. ${MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}`,
      )
    ) {
      return;
    }
    try {
      const removed = clearLocalMailboxStorage(window.localStorage);
      clearChatSession();
      keyScopeRef.current = null;
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
      setPendingPayment(null);
      setStorageNotice({
        kind: "ok",
        message: `Forgot this device: removed ${removed.length} local chat record${removed.length === 1 ? "" : "s"}. Disconnecting alone does not do this. Restore the offline backup to reopen encrypted messages. That backup can also recreate the Chat signing key used for payment requests, and APP20 currently cannot revoke it if compromised.`,
      });
    } catch (error: unknown) {
      setStorageNotice({
        kind: "error",
        message: `Chat could not clear every local chat record. Do not leave this shared profile unattended. ${
          error instanceof Error ? error.message : "Browser storage failed."
        }`,
      });
    }
  }

  /**
   * A device-private draft for one counterparty. Compose takes it from here;
   * a draft closed untouched is removed again by Chat.
   */
  function createDraft(
    input: { recipient?: string; conversationId?: string; inReplyTo?: string } = {},
  ): CompositeDraft | null {
    if (!address || !chainId) {
      setStorageNotice({
        kind: "error",
        message:
          "Chat is keyed to a wallet: connect one so the draft is saved under the correct chat.",
        action: "connect-wallet",
      });
      return null;
    }
    const existingBlank = input.recipient
      ? undefined
      : drafts.find(isBlankDraft);
    const draft: CompositeDraft = existingBlank ?? {
      ...createBlankDraft(),
      recipient: input.recipient ?? "",
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    };
    if (!existingBlank) persistDraft(draft);
    return draft;
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
          "Named on this device. Every record in this conversation now shows that name, which is a local label and not a proof.",
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
      "This message has no usable auth signature, so the assignment stays a local label.";
    if (proof.kind === "unbound_signature") {
      proofMessage =
        "The Chat auth signature is valid, but the claim is not bound to this chat or wallet address.";
    } else if (proof.kind === "invalid_signature") {
      proofMessage = "The claimed Chat auth signature is invalid.";
    }
    setStorageNotice({ kind: "error", message: proofMessage });
  }

  /* What is actually blocking this mailbox, answered once for every pane. */
  const mailboxGate: "wallet" | "key" | null =
    !isConnected || !address || !chainId ? "wallet" : keypair ? null : "key";

  const clearFocusRequest = useCallback(() => setFocusRequest(null), []);

  return {
    address,
    chainId,
    providerIndex,
    helperAddress,
    escrowAddress,
    escrowEnabled,
    networkName,
    keypair,
    mailSeed,
    keyFingerprint,
    mailboxGate,
    messages: annotatedMessages,
    aliases,
    displayAliases,
    bookEntries,
    otcState,
    escrowState,
    actionStates,
    assignments,
    proofs,
    invoiceMaturityHeadBlock,
    drafts,
    readMessageIds,
    markMessagesRead,
    scanning,
    lastCheckedAt,
    scanKind,
    scanMessage,
    scanProgress,
    scanCursorDescription,
    scanInbox,
    handleKeyReady,
    lockMailboxSession,
    forgetThisDevice,
    handleSent,
    persistDraft,
    removeDraft,
    createDraft,
    handleAccept,
    handleDecline,
    handlePostReceipt,
    handlePay,
    handlePayPrivatelyWithStrk,
    handleEscrowFill,
    handleLocalnetEscrowPayout,
    handleContactBackup,
    handleRfqHistoryBackup,
    rfqAutoBackupEnabled,
    updateRfqAutoBackup,
    restoreContactBackup,
    restoreAuthenticatedBackup,
    assignMessageAddress,
    proveAssignedAddress,
    storageNotice,
    setStorageNotice,
    focusRequest,
    clearFocusRequest,
    pendingPayment,
  };
}

export type MailboxDesk = ReturnType<typeof useMailboxDesk>;
