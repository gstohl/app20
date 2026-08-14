"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  loadAliases,
  resolveAliasInput,
  saveAlias,
  type AliasRecord,
} from "@/lib/aliases";
import { encodeEnvelope, type EnvelopeType } from "@/lib/envelope";
import { encryptMail, publicKeyFromFelts } from "@/lib/mail";
import {
  createDealId,
  createRequestId,
  parseDecimalToBaseUnits,
  type OfferPayload,
  type PaymentRequestPayload,
} from "@/lib/otc";
import { strk20ErrorMessage, submitMail } from "@/lib/strk20";
import { addrSTRK, myFrontendProviders } from "@/utils/constants";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { validateAndParseAddress } from "starknet";
import styles from "./mail.module.css";

export type SentEnvelope = {
  type: EnvelopeType;
  payload: unknown;
};

type ComposeProps = {
  helperAddress: string | null;
  keyReady: boolean;
  networkName: string;
  onSent: (message: SentEnvelope) => void;
  onAliasesChange?: (aliases: AliasRecord[]) => void;
};

type SendState = {
  kind: "idle" | "pending" | "ok" | "error";
  message?: string;
  transactionHash?: string;
};

type ComposeMode = "letter" | "deal";
type DealKind = "offer" | "request";

function expiryFromHours(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") return 0;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8_760) {
    throw new Error("Expiry must be 0–8760 hours.");
  }
  return Math.floor(Date.now() / 1_000 + hours * 3_600);
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
  const [dealKind, setDealKind] = useState<DealKind>("offer");
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
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

  const sendDisabled = Boolean(disabledReason) || sendState.kind === "pending";

  function resolvedRecipient(): string {
    return validateAndParseAddress(resolveAliasInput(aliases, recipient));
  }

  function saveCurrentAlias() {
    if (!senderAddress) {
      setAliasNotice("Connect a wallet before saving a local alias.");
      return;
    }
    try {
      const address = resolvedRecipient();
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

  function buildPayload(): SentEnvelope {
    if (mode === "letter") {
      if (!body.trim()) throw new Error("Write a message before sending.");
      return { type: "text", payload: { body } };
    }

    const expiresAt = expiryFromHours(expiryHours);
    if (dealKind === "offer") {
      const decimals = Number(wantDecimals);
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
      if (!payload.want.token.symbol) throw new Error("Want-token symbol is required.");
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

    setSendState({ kind: "pending", message: "Looking up the recipient key…" });

    try {
      const recipientAddress = resolvedRecipient();
      const provider = myFrontendProviders[providerIndex];
      const registeredKey = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [recipientAddress],
      });
      if (
        registeredKey.length !== 2 ||
        (BigInt(registeredKey[0]) === 0n && BigInt(registeredKey[1]) === 0n)
      ) {
        throw new Error(
          "The recipient has not registered a Quietline mail public key.",
        );
      }

      const message = buildPayload();
      setSendState({ kind: "pending", message: "Encrypting locally…" });
      const record = await encryptMail(
        publicKeyFromFelts(registeredKey),
        encodeEnvelope(message.type, message.payload),
      );
      const { transactionHash } = await submitMail(
        {
          account: walletAccount,
          provider,
          helperAddress,
          recoveryAddress: senderAddress,
          tokenAddress: addrSTRK,
          record,
        },
        {
          onSubmitted: (hash) => {
            setSendState({
              kind: "pending",
              message: "Private action submitted. Waiting for confirmation…",
              transactionHash: hash,
            });
          },
        },
      );

      setSendState({
        kind: "ok",
        message:
          message.type === "offer"
            ? "Encrypted OTC offer confirmed. No asset moved."
            : message.type === "payment_request"
              ? "Encrypted payment request confirmed. No asset moved."
              : "Encrypted letter confirmed.",
        transactionHash,
      });
      if (message.type === "text") setBody("");
      if (message.type === "offer") setDealNote("");
      if (message.type === "payment_request") setRequestMemo("");
      onSent(message);
    } catch (error: unknown) {
      setSendState({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  return (
    <section className={styles.card} aria-labelledby="compose-title">
      <div className={styles.cardNumber}>02</div>
      <div>
        <p className={styles.kicker}>PRIVATE DELIVERY</p>
        <h2 id="compose-title" className={styles.cardTitle}>
          Compose
        </h2>
      </div>

      <div className={styles.composeToggle} aria-label="Compose type">
        <button
          type="button"
          aria-pressed={mode === "letter"}
          onClick={() => setMode("letter")}
        >
          Letter
        </button>
        <button
          type="button"
          aria-pressed={mode === "deal"}
          onClick={() => setMode("deal")}
        >
          Deal
        </button>
      </div>

      <div className={styles.disclosureGrid}>
        <p>
          <strong>Private</strong>
          Envelope contents, recipient link, and STRK transfer details.
        </p>
        <p>
          <strong>Public</strong>
          Ciphertext, helper use, pool transaction timing, and public key registration.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Recipient address or local alias</span>
          <input
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="0x… or Alice"
            autoComplete="off"
            list="quietline-local-aliases"
            required
          />
          <datalist id="quietline-local-aliases">
            {aliases.map((record) => (
              <option key={record.address} value={record.label}>
                {record.address}
              </option>
            ))}
          </datalist>
          <small>Aliases stay in localStorage and are never put in a message.</small>
        </label>

        <div className={styles.aliasEditor}>
          <input
            value={aliasLabel}
            onChange={(event) => setAliasLabel(event.target.value)}
            placeholder="Local name for this address"
            aria-label="Local alias label"
          />
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={saveCurrentAlias}
            disabled={!recipient.trim() || !aliasLabel.trim()}
          >
            Save locally
          </button>
        </div>
        {aliasNotice ? <p className={styles.finePrint}>{aliasNotice}</p> : null}

        {mode === "letter" ? (
          <label className={styles.field}>
            <span>Letter</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write a private note"
              rows={6}
              maxLength={4096}
              required
            />
            <small>{body.length} / 4096 characters; typed envelope v1</small>
          </label>
        ) : (
          <>
            <div className={styles.dealKindToggle} aria-label="Deal action">
              <button
                type="button"
                aria-pressed={dealKind === "offer"}
                onClick={() => setDealKind("offer")}
              >
                Make offer
              </button>
              <button
                type="button"
                aria-pressed={dealKind === "request"}
                onClick={() => setDealKind("request")}
              >
                Request payment
              </button>
            </div>

            {dealKind === "offer" ? (
              <div className={styles.dealFields}>
                <p className={styles.termsPreview}>
                  You offer to buy one STRK amount from the recipient for one
                  quoted token amount.
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
                <label className={styles.field}>
                  <span>Quoted token decimals</span>
                  <input
                    value={wantDecimals}
                    onChange={(event) => setWantDecimals(event.target.value)}
                    inputMode="numeric"
                    placeholder="6"
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Quoted token amount</span>
                  <input
                    value={wantAmount}
                    onChange={(event) => setWantAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="2.50"
                    required
                  />
                </label>
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
                  You request one STRK payment from the recipient in a later
                  private transfer.
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
            </p>
          </>
        )}

        {disabledReason ? <p className={styles.notice}>{disabledReason}</p> : null}
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={sendDisabled}
        >
          {sendState.kind === "pending"
            ? "Sending through Ready…"
            : mode === "letter"
              ? "Encrypt & send letter"
              : dealKind === "offer"
                ? "Encrypt & send offer"
                : "Encrypt & request payment"}
        </button>
      </form>

      {sendState.message ? (
        <div
          className={`${styles.status} ${
            sendState.kind === "error" ? styles.statusError : ""
          }`}
          role="status"
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
