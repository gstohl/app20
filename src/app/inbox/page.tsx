"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { hash, validateAndParseAddress } from "starknet";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useLocalnetTools } from "@/app/localnetToolsContext";
import Compose, { type SentEnvelope } from "@/components/mail/Compose";
import ConversationList from "@/components/mail/ConversationList";
import Onboard from "@/components/mail/Onboard";
import PrivacyWalletMenu from "@/components/mail/PrivacyWalletMenu";
import Thread, {
  type LocalMailMessage,
  type ThreadActionState,
} from "@/components/mail/Thread";
import { loadAliases, type AliasRecord } from "@/lib/aliases";
import { feltEquals } from "@/lib/addresses";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import {
  claimEscrowOperation,
  confirmEscrowOperation,
  deriveEscrowClaimKey,
  emptyEscrowState,
  loadEscrowState,
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
import {
  acceptPayloadForOffer,
  claimOtcAccept,
  claimPayment,
  confirmOtcAccept,
  confirmPayment,
  emptyOtcState,
  expireStoredDeals,
  loadOtcState,
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
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  strk20ErrorMessage,
  submitActions,
  submitMail,
  submitMemoTransfer,
  submitOtcAccept,
} from "@/lib/strk20";
import * as constants from "@/utils/constants";
import styles from "@/components/mail/mail.module.css";

type ScanWorkerResponse =
  | { ok: true; decrypted: DecryptedMail[] }
  | { ok: false; message: string };

type ActiveScanWorker = {
  worker: Worker;
  reject: (error: Error) => void;
};

type ScanKind = "idle" | "scanning" | "ok" | "error";

type LocalnetEscrowSigner = {
  private_key: string;
  operation: "claim" | "timeout";
  open_note_index: number;
};

type LocalnetDynamicEscrowInvoke = WALLET_API.STRK20_INVOKE_ACTION & {
  quietline_escrow_signer: LocalnetEscrowSigner;
};

function secretKeyHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function helperForNetwork(providerIndex: number): string | null {
  const configured =
    providerIndex === 0
      ? constants.mailHelperMainnet
      : providerIndex === 2
        ? constants.mailHelperSepolia
        : providerIndex === constants.LOCALNET_PROVIDER_INDEX &&
            constants.localnetWalletEnabled
          ? constants.mailHelperLocalnet
          : null;
  if (!isConfiguredMailHelper(configured)) return null;

  try {
    return validateAndParseAddress(configured);
  } catch {
    return null;
  }
}

function escrowForNetwork(providerIndex: number): string | null {
  const configured =
    providerIndex === 0
      ? constants.escrowHelperMainnet
      : providerIndex === 2
        ? constants.escrowHelperSepolia
        : providerIndex === constants.LOCALNET_PROVIDER_INDEX &&
            constants.localnetWalletEnabled
          ? constants.escrowHelperLocalnet
          : null;
  if (!isConfiguredMailHelper(configured)) return null;
  try {
    return validateAndParseAddress(configured);
  } catch {
    return null;
  }
}

function loadPersistedMailSeed(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  address: string,
): Uint8Array | null {
  const value = storage.getItem(`quietline/mailseed/v1/${chainId}/${address}`);
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function mailKeyFingerprint(keypair: MailKeypair | null): string {
  if (!keypair) return "";
  return Array.from(keypair.publicKey, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function sortMailMessages(messages: LocalMailMessage[]): LocalMailMessage[] {
  return messages.sort((left, right) => {
    const leftTime =
      left.localCreatedAt ??
      (left.blockTimestamp === undefined ? undefined : left.blockTimestamp * 1_000);
    const rightTime =
      right.localCreatedAt ??
      (right.blockTimestamp === undefined ? undefined : right.blockTimestamp * 1_000);
    if (leftTime !== undefined || rightTime !== undefined) {
      const timeDifference = (rightTime ?? -1) - (leftTime ?? -1);
      if (timeDifference) return timeDifference;
    }
    const blockDifference =
      (right.blockNumber ?? -1) - (left.blockNumber ?? -1);
    if (blockDifference) return blockDifference;
    return (right.eventIndex ?? -1) - (left.eventIndex ?? -1);
  });
}

function mergeMailMessages(
  current: LocalMailMessage[],
  incoming: LocalMailMessage[],
): LocalMailMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return sortMailMessages([...byId.values()]).slice(
    0,
    MAIL_SCAN_MAX_MESSAGES,
  );
}

function parseBlockTimestamp(value: unknown): number | undefined {
  try {
    let timestamp: bigint;
    if (typeof value === "bigint") {
      timestamp = value;
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
      timestamp = BigInt(value);
    } else if (
      typeof value === "string" &&
      /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)
    ) {
      timestamp = BigInt(value);
    } else {
      return undefined;
    }

    if (timestamp < 0n || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(timestamp);
  } catch {
    return undefined;
  }
}

export default function InboxPage() {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const renderLocalnetTools = useLocalnetTools();
  const [keypair, setKeypair] = useState<MailKeypair | null>(null);
  const [mailSeed, setMailSeed] = useState<Uint8Array | null>(null);
  const [messages, setMessages] = useState<LocalMailMessage[]>([]);
  const [aliases, setAliases] = useState<AliasRecord[]>([]);
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
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const helperAddress = helperForNetwork(providerIndex);
  const escrowAddress = escrowForNetwork(providerIndex);
  const escrowEnabled = providerIndex !== 0 && escrowAddress !== null;
  const networkName = constants.Strk20Networks[providerIndex] ?? "this network";
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
  scanIdentityRef.current = scanIdentity;

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
    setScanMessage("");
    setActionStates({});
    if (address && chainId) {
      setAliases(loadAliases(window.localStorage, address));
      setOtcState(
        expireStoredDeals(window.localStorage, chainId, address),
      );
      setEscrowState(loadEscrowState(window.localStorage, chainId, address));
    } else {
      setAliases([]);
      setOtcState(emptyOtcState());
      setEscrowState(emptyEscrowState());
    }
    return () => {
      scanGenerationRef.current += 1;
      cancelActiveScanWorker();
    };
  }, [address, chainId, providerIndex]);

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
    if (!helperAddress) throw new Error("No mail helper is configured.");
    if (!walletAccount || !address || !chainId || !isStrk20Capable) {
      throw new Error("Connect a STRK20-capable Ready wallet first.");
    }
    return {
      helperAddress,
      walletAccount,
      provider: constants.myFrontendProviders[providerIndex],
      address,
      chainId,
    };
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
      throw new Error(
        "The response recipient has not registered a Quietline mail key.",
      );
    }
    return publicKeyFromFelts(registered);
  }

  function mergeLocalDealState(localMessages: LocalMailMessage[]) {
    if (!address || !chainId) return;

    for (const message of [...localMessages].reverse()) {
      try {
        const { envelope } = message;
        if (envelope.type === "offer") {
          const offer = parseOfferPayload(envelope.payload);
          if (offer) {
            recordDealEvent(
              window.localStorage,
              chainId,
              address,
              { type: "offer", payload: offer },
            );
          }
        } else if (envelope.type === "accept") {
          const accept = parseAcceptPayload(envelope.payload);
          if (!accept) continue;
          const state = loadOtcState(window.localStorage, chainId, address);
          if (state.deals[accept.dealId]) {
            recordDealEvent(
              window.localStorage,
              chainId,
              address,
              { type: "accept_claim", payload: accept },
            );
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
            recordDealEvent(
              window.localStorage,
              chainId,
              address,
              { type: "decline", payload: decline },
            );
          }
        } else if (envelope.type === "receipt") {
          const receipt = parseReceiptPayload(envelope.payload);
          if (receipt) {
            recordDealEvent(
              window.localStorage,
              chainId,
              address,
              { type: "receipt_claim", payload: receipt },
            );
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
            recordEscrowFund(
              window.localStorage,
              chainId,
              address,
              fund,
            );
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

  function handleKeyReady(nextKeypair: MailKeypair) {
    scanGenerationRef.current += 1;
    cancelActiveScanWorker();
    recentLoadedRef.current = false;
    setScanning(false);
    setMessages([]);
    setScanMessage("");
    setKeypair(nextKeypair);
    setMailSeed(
      address && chainId
        ? loadPersistedMailSeed(window.localStorage, chainId, address)
        : null,
    );
  }

  async function scanInbox(requested: "newer" | "older" = "newer") {
    if (!keypair) {
      setScanMessage("Load this device's mail key before scanning.");
      return;
    }
    if (!helperAddress) {
      setScanMessage(
        `No QuietlineMail helper is configured on ${networkName}.`,
      );
      return;
    }
    if (!address || !chainId || !keyFingerprint) {
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

      const decrypted = await decryptMailRecords(
        privateKey,
        parsed.map((event) => event.record),
      );
      if (!isCurrentScan()) return;

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
        setScanMessage(
          error instanceof Error ? error.message : "Mailbox scan failed.",
        );
      }
    } finally {
      if (isCurrentScan()) setScanning(false);
    }
  }

  function handleSent(message: SentEnvelope) {
    if (address && chainId) {
      try {
        if (message.type === "offer") {
          const offer = parseOfferPayload(message.payload);
          if (offer) {
            recordDealEvent(
              window.localStorage,
              chainId,
              address,
              { type: "offer", payload: offer },
            );
          }
        } else if (message.type === "payment_request") {
          const request = parsePaymentRequestPayload(message.payload);
          if (request) {
            recordPaymentRequest(
              window.localStorage,
              chainId,
              address,
              request,
            );
          }
        } else if (message.type === "escrow_fund") {
          const fund = parseEscrowFundPayload(message.payload);
          if (fund) {
            recordEscrowFund(
              window.localStorage,
              chainId,
              address,
              fund,
            );
          }
        }
        refreshOtcState();
        refreshEscrowState();
        void refreshEscrowChainDeals();
      } catch {
        // The confirmed ciphertext remains valid even if localStorage is full.
      }
    }
    void scanInbox();
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
    const record = await encryptMail(
      key,
      encodeEnvelope("receipt", receipt),
    );
    await submitMail({
      account: context.walletAccount,
      provider: context.provider,
      helperAddress: context.helperAddress,
      recoveryAddress: context.address,
      tokenAddress: constants.addrSTRK,
      record,
    });
    recordDealEvent(
      window.localStorage,
      context.chainId,
      context.address,
      { type: "receipt", payload: receipt },
    );
    refreshOtcState();
  }

  async function handleAccept(offer: OfferPayload, offerIndex?: number) {
    const actionKey = `deal:${offer.dealId}`;
    let claimed = false;
    let walletSubmitted = false;
    try {
      const context = requireActionContext();
      const accept = acceptPayloadForOffer(offer, offerIndex);
      claimOtcAccept(
        window.localStorage,
        context.chainId,
        context.address,
        accept,
      );
      claimed = true;
      refreshOtcState();
      setActionState(actionKey, {
        pending: true,
        message: "Preparing one private STRK transfer and accept memo…",
      });

      const recipientKey = await lookupMailKey(
        context.helperAddress,
        offer.offerer,
      );
      const record = await encryptMail(
        recipientKey,
        encodeEnvelope("accept", accept),
      );
      let submittedHash = "";
      const result = await submitOtcAccept(
        {
          account: context.walletAccount,
          provider: context.provider,
          helperAddress: context.helperAddress,
          recoveryAddress: context.address,
          tokenAddress: constants.addrSTRK,
          offer,
          record,
        },
        {
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            walletSubmitted = true;
            confirmOtcAccept(
              window.localStorage,
              context.chainId,
              context.address,
              offer.dealId,
              transactionHash,
            );
            refreshOtcState();
            setActionState(actionKey, {
              pending: true,
              message: "STRK transfer submitted; waiting before posting receipt…",
            });
          },
        },
      );
      const acceptHash = submittedHash || result.transactionHash;
      if (!submittedHash) {
        confirmOtcAccept(
          window.localStorage,
          context.chainId,
          context.address,
          offer.dealId,
          acceptHash,
        );
      }

      setActionState(actionKey, {
        pending: true,
        message: "STRK transfer confirmed. Posting the separate receipt…",
      });
      await postReceipt(offer, accept, acceptHash, recipientKey);
      setActionState(actionKey, {
        pending: false,
        message: "Accept transfer and one-sided receipt confirmed.",
      });
      void scanInbox();
    } catch (error: unknown) {
      if (claimed && !walletSubmitted && address && chainId) {
        releaseOtcAccept(
          window.localStorage,
          chainId,
          address,
          offer.dealId,
        );
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
      const record = await encryptMail(
        key,
        encodeEnvelope("decline", decline),
      );
      await submitMail({
        account: context.walletAccount,
        provider: context.provider,
        helperAddress: context.helperAddress,
        recoveryAddress: context.address,
        tokenAddress: constants.addrSTRK,
        record,
      });
      recordDealEvent(
        window.localStorage,
        context.chainId,
        context.address,
        { type: "decline", payload: decline },
      );
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
        throw new Error("No locally verified accept transfer is waiting for a receipt.");
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
    let walletSubmitted = false;
    try {
      const context = requireActionContext();
      claimPayment(
        window.localStorage,
        context.chainId,
        context.address,
        request.requestId,
      );
      claimed = true;
      refreshOtcState();
      setActionState(actionKey, {
        pending: true,
        message: "Preparing one private STRK payment and payment memo…",
      });
      const transfer = {
        token: request.token,
        amount: request.amount,
        to: request.requester,
      };
      const paymentMemo: AcceptPayload = {
        dealId: request.requestId,
        transfer,
      };
      const key = await lookupMailKey(context.helperAddress, request.requester);
      const record = await encryptMail(
        key,
        encodeEnvelope("accept", paymentMemo),
      );
      let submittedHash = "";
      const result = await submitMemoTransfer(
        {
          account: context.walletAccount,
          provider: context.provider,
          helperAddress: context.helperAddress,
          recoveryAddress: context.address,
          tokenAddress: constants.addrSTRK,
          recipient: request.requester,
          amount: request.amount,
          record,
        },
        {
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            walletSubmitted = true;
            const receipt = receiptForTransfer(
              request.requestId,
              transfer,
              transactionHash,
            );
            confirmPayment(
              window.localStorage,
              context.chainId,
              context.address,
              request.requestId,
              transactionHash,
              receipt,
            );
            refreshOtcState();
          },
        },
      );
      const transactionHash = submittedHash || result.transactionHash;
      if (!submittedHash) {
        confirmPayment(
          window.localStorage,
          context.chainId,
          context.address,
          request.requestId,
          transactionHash,
          receiptForTransfer(request.requestId, transfer, transactionHash),
        );
      }
      setActionState(actionKey, {
        pending: false,
        message: "Private STRK payment and encrypted memo confirmed.",
      });
      void scanInbox();
    } catch (error: unknown) {
      if (claimed && !walletSubmitted && address && chainId) {
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
    let walletSubmitted = false;
    try {
      const context = requireActionContext();
      if (!escrowAddress || !escrowEnabled) {
        throw new Error(
          networkName === "MAINNET"
            ? "Escrow stays off the mainnet scoring path until reviewed."
            : "No reviewed QuietlineEscrow deployment is configured.",
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
          onSubmitted: (transactionHash) => {
            walletSubmitted = true;
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
              startedAt,
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
      if (reserved && !walletSubmitted && address && chainId) {
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
    let walletSubmitted = false;
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
        throw new Error("Load the localnet mailbox seed and escrow deployment.");
      }
      if (!feltEquals(fund.escrowAddress, escrowAddress)) {
        throw new Error("This deal names a different escrow deployment.");
      }
      if (!feltEquals(fund.maker, context.address)) {
        throw new Error("Only this deal's maker mailbox can derive the claim key.");
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
          onSubmitted: (transactionHash) => {
            walletSubmitted = true;
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
              startedAt,
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
      if (reserved && !walletSubmitted && address && chainId) {
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

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Link className={styles.brand} to="/" aria-label="Quietline home">
          <span className={styles.brandMark}>Q</span>
          <span>Quietline</span>
        </Link>
        <div className={styles.navRight}>
          <span className={styles.network}>{networkName}</span>
          <SelectWallet variant="nav" />
        </div>
      </nav>

      <main className={styles.shell}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>QUIETLINE / INBOX</p>
          <h1>Private words, public ciphertext.</h1>
          <p>
            The chain records encrypted payloads and timing. Your device-bound
            mail key stays in this browser profile, and plaintext appears only
            after local decryption.
          </p>
        </header>

        <div className={styles.privacyStrip}>
          <span>
            <strong>Hidden:</strong> message body and recipient link
          </span>
          <span>
            <strong>Visible:</strong> helper activity, ciphertext, and timing
          </span>
        </div>

        <div className={styles.setupGrid}>
          <Onboard
            key={`${providerIndex}:${address}`}
            helperAddress={helperAddress}
            onKeyReady={handleKeyReady}
          />
          <Compose
            helperAddress={helperAddress}
            escrowAddress={escrowAddress}
            escrowEnabled={escrowEnabled}
            mailSeed={mailSeed}
            keyReady={Boolean(keypair)}
            networkName={networkName}
            onSent={handleSent}
            onAliasesChange={setAliases}
          />
        </div>

        <Thread
          messages={messages}
          selfAddress={address}
          aliases={aliases}
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
        />
      </main>

      <footer className={styles.footer}>
        <Link to="/">← Wallet actions</Link>
        <span>Quietline stores ciphertext on-chain, never plaintext.</span>
      </footer>
    </div>
  );
}
