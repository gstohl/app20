"use client";

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hash, validateAndParseAddress } from "starknet";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import Compose, { type SentEnvelope } from "@/components/mail/Compose";
import Onboard from "@/components/mail/Onboard";
import Thread, {
  type LocalMailMessage,
  type ThreadActionState,
} from "@/components/mail/Thread";
import { loadAliases, type AliasRecord } from "@/lib/aliases";
import { encodeEnvelope } from "@/lib/envelope";
import type { EncryptedMailRecord, MailKeypair } from "@/lib/mail";
import {
  encryptMail,
  publicKeyFromFelts,
  scanAndDecrypt,
} from "@/lib/mail";
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
  recordPaymentTransfer,
  releaseOtcAccept,
  releasePayment,
  type AcceptPayload,
  type OfferPayload,
  type OtcState,
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  strk20ErrorMessage,
  submitMail,
  submitMemoTransfer,
  submitOtcAccept,
} from "@/lib/strk20";
import * as constants from "@/utils/constants";
import styles from "@/components/mail/mail.module.css";

type MailEvent = {
  keys: string[];
  data: string[];
  transaction_hash: string;
  block_number?: number;
  event_index?: number;
};

type ParsedMailEvent = {
  record: EncryptedMailRecord;
  index: string;
  transactionHash: string;
  blockNumber?: number;
  eventIndex?: number;
};

function helperForNetwork(providerIndex: number): string | null {
  const configured =
    providerIndex === 0
      ? constants.mailHelperMainnet
      : providerIndex === 2
        ? constants.mailHelperSepolia
        : null;
  if (!isConfiguredMailHelper(configured)) return null;

  try {
    return validateAndParseAddress(configured);
  } catch {
    return null;
  }
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

function parseMailEvent(event: MailEvent): ParsedMailEvent | null {
  try {
    if (event.keys.length < 2 || event.data.length < 6) return null;
    const ciphertextLength = Number(BigInt(event.data[5]));
    const viewTag = Number(BigInt(event.data[2]));
    if (
      !Number.isSafeInteger(ciphertextLength) ||
      ciphertextLength < 0 ||
      event.data.length !== 6 + ciphertextLength ||
      !Number.isInteger(viewTag) ||
      viewTag < 0 ||
      viewTag > 255
    ) {
      return null;
    }

    return {
      index: BigInt(event.keys[1]).toString(),
      transactionHash: event.transaction_hash,
      blockNumber: event.block_number,
      eventIndex: event.event_index,
      record: {
        ephemeralPub: [event.data[0], event.data[1]],
        viewTag,
        nonce: [event.data[3], event.data[4]],
        ciphertextFelts: event.data.slice(6),
      },
    };
  } catch {
    return null;
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
  const [keypair, setKeypair] = useState<MailKeypair | null>(null);
  const [messages, setMessages] = useState<LocalMailMessage[]>([]);
  const [aliases, setAliases] = useState<AliasRecord[]>([]);
  const [otcState, setOtcState] = useState<OtcState>(emptyOtcState());
  const [actionStates, setActionStates] = useState<
    Record<string, ThreadActionState>
  >({});
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  const helperAddress = helperForNetwork(providerIndex);
  const networkName = constants.Strk20Networks[providerIndex] ?? "this network";

  useEffect(() => {
    setKeypair(null);
    setMessages([]);
    setScanMessage("");
    setActionStates({});
    if (address && chainId) {
      setAliases(loadAliases(window.localStorage, address));
      setOtcState(
        expireStoredDeals(window.localStorage, chainId, address),
      );
    } else {
      setAliases([]);
      setOtcState(emptyOtcState());
    }
  }, [address, chainId, providerIndex]);

  function setActionState(key: string, state: ThreadActionState) {
    setActionStates((current) => ({ ...current, [key]: state }));
  }

  function refreshOtcState() {
    if (!address || !chainId) return;
    setOtcState(expireStoredDeals(window.localStorage, chainId, address));
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
              {
                type: "accept",
                payload: accept,
                txHash: message.transactionHash,
              },
            );
          } else if (state.payments[accept.dealId]) {
            recordPaymentTransfer(
              window.localStorage,
              chainId,
              address,
              accept,
              message.transactionHash,
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
              { type: "receipt", payload: receipt },
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
        }
      } catch {
        // A malformed or out-of-order payload cannot poison the local inbox.
      }
    }
    refreshOtcState();
  }

  async function scanInbox() {
    if (!keypair) {
      setScanMessage("Load this device's mail key before scanning.");
      return;
    }
    if (!helperAddress) {
      setScanMessage(`No QuietlineMail helper is configured on ${networkName}.`);
      return;
    }

    setScanning(true);
    setScanMessage("Downloading public MessagePosted events…");

    try {
      const provider = constants.myFrontendProviders[providerIndex];
      const selector = hash.getSelectorFromName("MessagePosted");
      const events: MailEvent[] = [];
      const seenTokens = new Set<string>();
      let continuationToken: string | undefined;

      do {
        const chunk = await provider.getEvents({
          address: helperAddress,
          from_block: { block_number: 0 },
          to_block: "latest",
          keys: [[selector]],
          chunk_size: 100,
          ...(continuationToken
            ? { continuation_token: continuationToken }
            : {}),
        });
        events.push(...(chunk.events as MailEvent[]));
        continuationToken = chunk.continuation_token;
        if (continuationToken) {
          if (seenTokens.has(continuationToken)) {
            throw new Error("The RPC repeated an event continuation token.");
          }
          seenTokens.add(continuationToken);
        }
      } while (continuationToken);

      const parsed = events
        .map(parseMailEvent)
        .filter((event): event is ParsedMailEvent => event !== null);
      const decrypted = await scanAndDecrypt(
        keypair.privateKey,
        parsed.map((event) => event.record),
      );
      // Fetch every public event block so timestamp lookups do not reveal
      // which records matched this device's private key.
      const eventBlockNumbers = [
        ...new Set(
          parsed
            .map((event) => event.blockNumber)
            .filter(
              (blockNumber): blockNumber is number =>
                blockNumber !== undefined,
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
            // Optional timestamp evidence must not prevent local decryption.
            return null;
          }
        }),
      );
      const timestampsByBlock = new Map(
        timestampEntries.filter(
          (entry): entry is readonly [number, number] => entry !== null,
        ),
      );
      const localMessages = decrypted
        .map((message) => {
          const event = parsed[message.index];
          return {
            id: `${event.transactionHash}:${event.eventIndex ?? message.index}`,
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
        })
        .sort((left, right) => {
          const blockDifference =
            (right.blockNumber ?? -1) - (left.blockNumber ?? -1);
          if (blockDifference) return blockDifference;
          return (right.eventIndex ?? -1) - (left.eventIndex ?? -1);
        });

      setMessages(localMessages);
      mergeLocalDealState(localMessages);
      setScanMessage(
        `Decrypted ${localMessages.length} of ${parsed.length} valid ciphertext event${
          parsed.length === 1 ? "" : "s"
        } locally.`,
      );
    } catch (error: unknown) {
      setScanMessage(
        error instanceof Error ? error.message : "Mailbox scan failed.",
      );
    } finally {
      setScanning(false);
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
        }
        refreshOtcState();
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
      if (!deal?.accept || !deal.acceptTxHash || deal.status !== "accepted") {
        throw new Error("No confirmed accept transfer is waiting for a receipt.");
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
            onKeyReady={setKeypair}
          />
          <Compose
            helperAddress={helperAddress}
            keyReady={Boolean(keypair)}
            networkName={networkName}
            onSent={handleSent}
            onAliasesChange={setAliases}
          />
        </div>

        <Thread
          messages={messages}
          canScan={Boolean(keypair && helperAddress)}
          scanning={scanning}
          scanMessage={scanMessage}
          selfAddress={address}
          aliases={aliases}
          otcState={otcState}
          actionStates={actionStates}
          onScan={() => void scanInbox()}
          onAccept={(offer, index) => void handleAccept(offer, index)}
          onDecline={(offer) => void handleDecline(offer)}
          onPostReceipt={(offer) => void handlePostReceipt(offer)}
          onPay={(request) => void handlePay(request)}
        />
      </main>

      <footer className={styles.footer}>
        <Link to="/">← Wallet actions</Link>
        <span>Quietline stores ciphertext on-chain, never plaintext.</span>
      </footer>
    </div>
  );
}
