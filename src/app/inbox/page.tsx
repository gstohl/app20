"use client";

import { useEffect, useState } from "react";
import { hash, validateAndParseAddress } from "starknet";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import Compose from "@/components/mail/Compose";
import Onboard from "@/components/mail/Onboard";
import Thread, { type LocalMailMessage } from "@/components/mail/Thread";
import type { EncryptedMailRecord, MailKeypair } from "@/lib/mail";
import { scanAndDecrypt } from "@/lib/mail";
import { isConfiguredMailHelper } from "@/lib/mail-actions";
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
    (state) => state.currentFrontendProviderIndex
  );
  const address = useStoreWallet((state) => state.address);
  const [keypair, setKeypair] = useState<MailKeypair | null>(null);
  const [messages, setMessages] = useState<LocalMailMessage[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  const helperAddress = helperForNetwork(providerIndex);
  const networkName = constants.Strk20Networks[providerIndex] ?? "this network";

  useEffect(() => {
    setKeypair(null);
    setMessages([]);
    setScanMessage("");
  }, [address, providerIndex]);

  async function scanInbox() {
    if (!keypair) {
      setScanMessage("Register this tab's mail key before scanning.");
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
        parsed.map((event) => event.record)
      );
      const localMessages = decrypted
        .map((message) => {
          const event = parsed[message.index];
          return {
            id: `${event.transactionHash}:${event.eventIndex ?? message.index}`,
            index: event.index,
            plaintext: message.plaintext,
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
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
      setScanMessage(
        `Decrypted ${localMessages.length} of ${parsed.length} valid ciphertext event${
          parsed.length === 1 ? "" : "s"
        } locally.`
      );
    } catch (error: unknown) {
      setScanMessage(
        error instanceof Error ? error.message : "Mailbox scan failed."
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/" aria-label="Quietline home">
          <span className={styles.brandMark}>Q</span>
          <span>Quietline</span>
        </a>
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
            The chain records encrypted payloads and timing. Your mail key stays
            in this browser tab, and plaintext appears only after local
            decryption.
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
            onSent={() => void scanInbox()}
          />
        </div>

        <Thread
          messages={messages}
          canScan={Boolean(keypair && helperAddress)}
          scanning={scanning}
          scanMessage={scanMessage}
          onScan={() => void scanInbox()}
        />
      </main>

      <footer className={styles.footer}>
        <a href="/">← Wallet actions</a>
        <span>Quietline stores ciphertext on-chain, never plaintext.</span>
      </footer>
    </div>
  );
}
