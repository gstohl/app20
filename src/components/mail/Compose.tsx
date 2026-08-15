"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { validateAndParseAddress } from "starknet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  loadAliases,
  resolveAliasInput,
  saveAlias,
  type AliasRecord,
} from "@/lib/aliases";
import { encodeEnvelope, type EnvelopeType } from "@/lib/envelope";
import {
  encryptMailForRecipients,
  MAX_MULTI_RECIPIENTS,
  publicKeyFromFelts,
  type EncryptedMailRecord,
} from "@/lib/mail";
import { parseOptionalStrkAmount } from "@/lib/mail-actions";
import {
  createDealId,
  createRequestId,
  parseDecimalToBaseUnits,
  type OfferPayload,
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  strk20ErrorMessage,
  submitMail,
  submitMemoTransfer,
} from "@/lib/strk20";
import { addrSTRK, myFrontendProviders } from "@/utils/constants";
import { ProvingProgress } from "./OperationProgress";
import styles from "./mail.module.css";

export type SentEnvelope = {
  type: EnvelopeType;
  payload: unknown;
  record: EncryptedMailRecord;
  transactionHash: string;
  recipientCount: number;
};

type ComposeProps = {
  helperAddress: string | null;
  keyReady: boolean;
  networkName: string;
  onSent: (message: SentEnvelope) => void;
  onAliasesChange?: (aliases: AliasRecord[]) => void;
};

type SendState = {
  kind: "idle" | "lookup" | "encrypting" | "proving" | "ok" | "error";
  message?: string;
  transactionHash?: string;
  startedAt?: number;
};

type ComposeMode = "letter" | "deal" | "invoice";

function expiryFromHours(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") return 0;
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

export default function Compose({
  helperAddress,
  keyReady,
  networkName,
  onSent,
  onAliasesChange,
}: ComposeProps) {
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const senderAddress = useStoreWallet((state) => state.address);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const [mode, setMode] = useState<ComposeMode>("letter");
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [attachPayment, setAttachPayment] = useState(false);
  const [attachmentAmount, setAttachmentAmount] = useState("");
  const [giveStrk, setGiveStrk] = useState("0.01");
  const [wantAmount, setWantAmount] = useState("");
  const [wantSymbol, setWantSymbol] = useState("USDC");
  const [wantAddress, setWantAddress] = useState("");
  const [wantDecimals, setWantDecimals] = useState("6");
  const [dealNote, setDealNote] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestMemo, setRequestMemo] = useState("");
  const [expiryHours, setExpiryHours] = useState("24");
  const [aliases, setAliases] = useState<AliasRecord[]>([]);
  const [aliasLabel, setAliasLabel] = useState("");
  const [aliasNotice, setAliasNotice] = useState("");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });

  useEffect(() => {
    if (!senderAddress) {
      setAliases([]);
      return;
    }
    setAliases(loadAliases(window.localStorage, senderAddress));
  }, [senderAddress]);

  const recipientEntries = useMemo(
    () => splitRecipientEntries(recipient),
    [recipient],
  );

  let disabledReason = "";
  if (!helperAddress) {
    disabledReason = `No QuietlineMail helper is configured on ${networkName}. Sending is disabled.`;
  } else if (!isConnected || !walletAccount || !senderAddress) {
    disabledReason = "Connect Ready before sending mail.";
  } else if (!isStrk20Capable) {
    disabledReason = "This wallet does not declare STRK20 Wallet API 0.10 support.";
  } else if (!keyReady) {
    disabledReason = "Load this device's mail key before sending.";
  }

  const sendPending = ["lookup", "encrypting", "proving"].includes(
    sendState.kind,
  );
  const sendDisabled = Boolean(disabledReason) || sendPending;

  function resolvedRecipients(): string[] {
    if (!recipientEntries.length) throw new Error("Add at least one recipient.");
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

  function saveCurrentAlias() {
    if (!senderAddress) {
      setAliasNotice("Connect a wallet before saving a local alias.");
      return;
    }
    try {
      if (recipientEntries.length !== 1) {
        throw new Error("Choose exactly one recipient when saving an alias.");
      }
      const [address] = resolvedRecipients();
      const next = saveAlias(
        window.localStorage,
        senderAddress,
        address,
        aliasLabel,
      );
      setAliases(next);
      setAliasLabel("");
      setAliasNotice("Alias saved only in this browser profile.");
      onAliasesChange?.(next);
    } catch (error: unknown) {
      setAliasNotice(
        error instanceof Error ? error.message : "Could not save that alias.",
      );
    }
  }

  function appendAlias(alias: AliasRecord) {
    const separator = recipient.trim() ? "\n" : "";
    setRecipient((current) => `${current.trimEnd()}${separator}${alias.label}`);
  }

  function buildPayload(): { type: EnvelopeType; payload: unknown } {
    if (mode === "letter") {
      if (!body.trim()) throw new Error("Write a message before sending.");
      return { type: "text", payload: { body } };
    }

    const expiresAt = expiryFromHours(expiryHours);
    if (mode === "deal") {
      const decimals = Number(wantDecimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
        throw new Error("Quoted token decimals must be an integer from 0 to 255.");
      }
      const payload: OfferPayload = {
        dealId: createDealId(),
        give: {
          token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
          amount: parseDecimalToBaseUnits(giveStrk, 18),
        },
        want: {
          token: {
            symbol: wantSymbol.trim(),
            address: validateAndParseAddress(wantAddress.trim()),
            decimals,
          },
          amount: parseDecimalToBaseUnits(wantAmount, decimals),
        },
        offerer: validateAndParseAddress(senderAddress),
        expiresAt,
        ...(dealNote.trim() ? { note: dealNote.trim() } : {}),
      };
      if (!payload.want.token.symbol) {
        throw new Error("Want-token symbol is required.");
      }
      return { type: "offer", payload };
    }

    const payload: PaymentRequestPayload = {
      requestId: createRequestId(),
      token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
      amount: parseDecimalToBaseUnits(requestAmount, 18),
      requester: validateAndParseAddress(senderAddress),
      expiresAt,
      ...(requestMemo.trim() ? { memo: requestMemo.trim() } : {}),
    };
    return { type: "payment_request", payload };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!helperAddress) {
      setSendState({
        kind: "error",
        message: `No QuietlineMail helper is configured on ${networkName}.`,
      });
      return;
    }
    if (!walletAccount || !senderAddress || !isStrk20Capable || !keyReady) {
      setSendState({
        kind: "error",
        message: disabledReason || "Mail sending is not ready.",
      });
      return;
    }

    try {
      const recipientAddresses = resolvedRecipients();
      if (mode !== "letter" && recipientAddresses.length !== 1) {
        throw new Error(
          "Deals and invoices are bilateral in v1. Address exactly one counterparty.",
        );
      }
      if (attachPayment && recipientAddresses.length !== 1) {
        throw new Error(
          "An attached STRK payment has one private transfer destination. Send group letters without an attachment.",
        );
      }
      const paymentAmount = attachPayment
        ? parseOptionalStrkAmount(attachmentAmount)
        : undefined;
      if (attachPayment && paymentAmount === undefined) {
        throw new Error("Enter the STRK amount to attach.");
      }
      const message = buildPayload();
      const provider = myFrontendProviders[providerIndex];

      setSendState({
        kind: "lookup",
        message: `Looking up ${recipientAddresses.length} recipient mail key${
          recipientAddresses.length === 1 ? "" : "s"
        }…`,
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
              `Recipient ${index + 1} has not registered a Quietline mail public key.`,
            );
          }
          return publicKeyFromFelts(registeredKey);
        }),
      );

      setSendState({
        kind: "encrypting",
        message: `Sealing one shared letter for ${registeredKeys.length} recipient${
          registeredKeys.length === 1 ? "" : "s"
        } on this device…`,
      });
      const record = await encryptMailForRecipients(
        registeredKeys,
        encodeEnvelope(message.type, message.payload),
      );
      const startedAt = Date.now();
      setSendState({
        kind: "proving",
        message: "Ready is preparing the private mail action…",
        startedAt,
      });

      const options = {
        onSubmitted: (hash: string) => {
          setSendState({
            kind: "proving" as const,
            message: "Private action submitted. Waiting for confirmation…",
            transactionHash: hash,
            startedAt,
          });
        },
      };
      const { transactionHash } =
        paymentAmount === undefined
          ? await submitMail(
              {
                account: walletAccount,
                provider,
                helperAddress,
                recoveryAddress: senderAddress,
                tokenAddress: addrSTRK,
                record,
              },
              options,
            )
          : await submitMemoTransfer(
              {
                account: walletAccount,
                provider,
                helperAddress,
                recoveryAddress: senderAddress,
                tokenAddress: addrSTRK,
                recipient: recipientAddresses[0],
                amount: paymentAmount,
                record,
              },
              options,
            );

      setSendState({
        kind: "ok",
        message:
          message.type === "offer"
            ? "Encrypted deal confirmed. No asset moved."
            : message.type === "payment_request"
              ? "Encrypted invoice confirmed. No asset moved."
              : paymentAmount === undefined
                ? `Encrypted letter confirmed for ${recipientAddresses.length} recipient${
                    recipientAddresses.length === 1 ? "" : "s"
                  }.`
                : "Encrypted letter and private STRK payment confirmed in one action.",
        transactionHash,
      });
      if (message.type === "text") setBody("");
      if (message.type === "offer") setDealNote("");
      if (message.type === "payment_request") setRequestMemo("");
      if (paymentAmount !== undefined) setAttachmentAmount("");
      onSent({
        ...message,
        record,
        transactionHash,
        recipientCount: recipientAddresses.length,
      });
    } catch (error: unknown) {
      setSendState({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  return (
    <section className={styles.composerSheet} aria-labelledby="compose-title">
      <div className={styles.composerHeading}>
        <div>
          <p className={styles.kicker}>PRIVATE DELIVERY</p>
          <h2 id="compose-title">Compose a document</h2>
        </div>
        <span className={styles.sheetClip} aria-hidden="true">CLIP / 02</span>
      </div>

      <label className={styles.modePicker}>
        <span>Document</span>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as ComposeMode)}
        >
          <option value="letter">Letter</option>
          <option value="deal">Deal</option>
          <option value="invoice">Invoice</option>
        </select>
        <small>
          One composer, three typed envelopes. Deals and invoices remain
          one-sided v1 documents, not escrow contracts.
        </small>
      </label>

      <div className={styles.disclosureGrid}>
        <p>
          <strong>Device-private / sealed</strong>
          Body, recipient identities, local aliases, and attached transfer
          details.
        </p>
        <p>
          <strong>Public</strong>
          Recipient count, ciphertext size, helper and pool activity, and
          timing. Shield and unshield legs are public.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>
            Recipient address or local alias
            <em className={styles.fieldBadge}>COUNT PUBLIC</em>
          </span>
          <textarea
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={
              mode === "letter"
                ? "One address or alias per line"
                : "One counterparty address or alias"
            }
            autoComplete="off"
            rows={mode === "letter" ? 3 : 2}
            required
          />
          <small>
            {recipientEntries.length || 0} / {MAX_MULTI_RECIPIENTS} recipients.
            Count is public; identities are not in MessagePosted. Group delivery
            is available for letters; deals and invoices are bilateral.
          </small>
        </label>

        {aliases.length ? (
          <div className={styles.aliasChips} aria-label="Device-private aliases">
            <span>ADD LOCAL:</span>
            {aliases.map((alias) => (
              <button
                key={alias.address}
                type="button"
                onClick={() => appendAlias(alias)}
              >
                <bdi>{alias.label}</bdi>
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.aliasEditor}>
          <input
            value={aliasLabel}
            onChange={(event) => setAliasLabel(event.target.value)}
            placeholder="Local name for one entered address"
            aria-label="Local alias label"
          />
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={saveCurrentAlias}
            disabled={recipientEntries.length !== 1 || !aliasLabel.trim()}
          >
            Save on device
          </button>
        </div>
        {aliasNotice ? <p className={styles.finePrint}>{aliasNotice}</p> : null}

        {mode === "letter" ? (
          <>
            <label className={styles.field}>
              <span>Letter</span>
              <textarea
                className={styles.letterInput}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write a private letter"
                rows={7}
                maxLength={4096}
                required
              />
              <small>{body.length} / 4096 characters; typed envelope v1</small>
            </label>

            <div className={styles.paymentAttachment}>
              <label className={styles.attachmentToggle}>
                <input
                  type="checkbox"
                  checked={attachPayment}
                  onChange={(event) => setAttachPayment(event.target.checked)}
                />
                <span>
                  <strong>Attach shielded STRK</strong>
                  <small>Part of composing, not a separate Send tab</small>
                </span>
              </label>
              {attachPayment ? (
                <label className={styles.field}>
                  <span>STRK amount</span>
                  <input
                    value={attachmentAmount}
                    onChange={(event) => setAttachmentAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.01"
                    required
                  />
                  <small>
                    One private in-pool transfer to one recipient in the same
                    atomic wallet batch. Timing and pool activity stay public.
                  </small>
                </label>
              ) : null}
            </div>
          </>
        ) : mode === "deal" ? (
          <div className={styles.dealFields}>
            <p className={styles.termsPreview}>
              Offer to buy one STRK amount from this counterparty for one quoted
              token amount.
            </p>
            <label className={styles.field}>
              <span>STRK to buy</span>
              <input
                value={giveStrk}
                onChange={(event) => setGiveStrk(event.target.value)}
                inputMode="decimal"
                placeholder="0.01"
                required
              />
            </label>
            <label className={styles.field}>
              <span>Quoted token symbol</span>
              <input
                value={wantSymbol}
                onChange={(event) => setWantSymbol(event.target.value)}
                placeholder="USDC"
                maxLength={32}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Quoted token address</span>
              <input
                value={wantAddress}
                onChange={(event) => setWantAddress(event.target.value)}
                placeholder="0x…"
                required
              />
            </label>
            <div className={styles.amountPair}>
              <label className={styles.field}>
                <span>Token decimals</span>
                <input
                  value={wantDecimals}
                  onChange={(event) => setWantDecimals(event.target.value)}
                  inputMode="numeric"
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Quoted amount</span>
                <input
                  value={wantAmount}
                  onChange={(event) => setWantAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="2.50"
                  required
                />
              </label>
            </div>
            <label className={styles.field}>
              <span>Note (optional)</span>
              <input
                value={dealNote}
                onChange={(event) => setDealNote(event.target.value)}
                maxLength={512}
              />
            </label>
          </div>
        ) : (
          <div className={styles.dealFields}>
            <p className={styles.termsPreview}>
              Request one later private STRK payment from this counterparty.
            </p>
            <label className={styles.field}>
              <span>STRK requested</span>
              <input
                value={requestAmount}
                onChange={(event) => setRequestAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.01"
                required
              />
            </label>
            <label className={styles.field}>
              <span>Invoice memo (optional)</span>
              <input
                value={requestMemo}
                onChange={(event) => setRequestMemo(event.target.value)}
                maxLength={512}
              />
            </label>
          </div>
        )}

        {mode === "letter" ? null : (
          <>
            <label className={styles.field}>
              <span>Expiry in hours (0 = none)</span>
              <input
                value={expiryHours}
                onChange={(event) => setExpiryHours(event.target.value)}
                inputMode="decimal"
                placeholder="24"
                required
              />
            </label>
            <p className={styles.dealDisclosure}>
              Sending terms moves no asset. An accept or pay action can move
              only STRK, one way; any quoted non-STRK leg remains a promise.
              No escrow or atomic settlement is claimed.
            </p>
          </>
        )}

        {disabledReason ? <p className={styles.notice}>{disabledReason}</p> : null}
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={sendDisabled}
        >
          {sendPending
            ? "Preparing sealed delivery…"
            : mode === "letter"
              ? attachPayment
                ? "Encrypt letter & attach payment"
                : "Encrypt & send letter"
              : mode === "deal"
                ? "Encrypt & send deal"
                : "Encrypt & send invoice"}
        </button>
      </form>

      <ProvingProgress
        active={sendState.kind === "proving"}
        startedAt={sendState.startedAt}
      />
      {sendState.message && sendState.kind !== "proving" ? (
        <div
          className={`${styles.status} ${
            sendState.kind === "error" ? styles.statusError : ""
          }`}
          role={sendState.kind === "error" ? "alert" : "status"}
        >
          {sendState.message}
          {sendState.transactionHash ? (
            <span className={styles.mono}>
              {sendState.transactionHash.slice(0, 10)}…
              {sendState.transactionHash.slice(-6)}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
