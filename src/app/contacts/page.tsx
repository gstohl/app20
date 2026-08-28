"use client";

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useActiveStarknetSession } from "@/app/active-session";
import { storeDeskHandoff } from "@/lib/desk-handoff";
import {
  ADDRESS_BOOK_CHANGED_EVENT,
  loadAddressBook,
  removeAddressBookEntry,
  saveAddressBookEntry,
  type AddressBookEntry,
} from "@/lib/address-book";
import styles from "@/app/rfq/rfq.module.css";

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function AddressBookPanel({
  selfAddress,
  chainId,
  handoffsEnabled,
}: {
  selfAddress: string;
  chainId: string;
  handoffsEnabled: boolean;
}) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = selfAddress.trim();

  useEffect(() => {
    let cancelled = false;
    function reload() {
      if (!scope) {
        setEntries([]);
        setError(null);
        return;
      }
      loadAddressBook(window.localStorage, scope)
        .then((loaded) => {
          if (!cancelled) {
            setEntries(loaded);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setEntries([]);
            setError(
              cause instanceof Error
                ? cause.message
                : "The address book could not be opened.",
            );
          }
        });
    }
    reload();
    window.addEventListener(ADDRESS_BOOK_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(ADDRESS_BOOK_CHANGED_EVENT, reload);
    };
  }, [scope]);

  async function addEntry() {
    if (!scope) return;
    setBusy(true);
    setStatus(null);
    try {
      const next = await saveAddressBookEntry(window.localStorage, scope, {
        label: labelDraft,
        address: addressDraft,
      });
      setEntries(next);
      setLabelDraft("");
      setAddressDraft("");
      setError(null);
      setStatus(
        "Saved under this device's AES-GCM key. Use Mailbox for an encrypted on-chain recovery snapshot.",
      );
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Saving the entry failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(label: string) {
    if (!scope) return;
    setBusy(true);
    try {
      const next = await removeAddressBookEntry(
        window.localStorage,
        scope,
        label,
      );
      setEntries(next);
      setStatus(null);
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Removing the entry failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${styles.panel} ${styles.bookPanel}`}
      aria-labelledby="rfq-book-title"
    >
      <header className={styles.panelHeading}>
        <span>COUNTERPARTIES</span>
        <strong id="rfq-book-title">
          Device-encrypted directory · RFQ and Mail actions
        </strong>
      </header>
      <div className={styles.bookBody}>
        <div className={styles.bookAdd}>
          <label className={styles.bookField}>
            <span>LABEL</span>
            <input
              aria-label="New address book label"
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              placeholder="Desk name"
              maxLength={40}
              disabled={!scope || busy}
            />
          </label>
          <label className={styles.bookField}>
            <span>STARKNET ADDRESS</span>
            <input
              aria-label="New address book address"
              value={addressDraft}
              onChange={(event) => setAddressDraft(event.target.value)}
              placeholder="0x…"
              spellCheck={false}
              disabled={!scope || busy}
            />
          </label>
          <button
            type="button"
            onClick={() => void addEntry()}
            disabled={
              !scope || busy || !labelDraft.trim() || !addressDraft.trim()
            }
          >
            Add
          </button>
        </div>
        {error ? (
          <p className={styles.bookError} role="alert">
            {error}
          </p>
        ) : null}
        {status && !error ? (
          <p className={styles.bookStatus}>{status}</p>
        ) : null}
        {scope ? (
          entries.length ? (
            <ul className={styles.bookList}>
              {entries.map((entry) => (
                <li key={entry.label}>
                  <b>{entry.label}</b>
                  <code title={entry.address}>
                    {shortAddress(entry.address)}
                  </code>
                  <div className={styles.bookActions}>
                    {handoffsEnabled ? (
                      <>
                        <Link
                          to="/rfq"
                          hash="desk"
                          onClick={() => {
                            storeDeskHandoff(
                              window.sessionStorage,
                              "rfq",
                              entry.address,
                              { account: selfAddress, chainId },
                            );
                          }}
                        >
                          New RFQ
                        </Link>
                        <Link
                          to="/mail/inbox"
                          onClick={() => {
                            storeDeskHandoff(
                              window.sessionStorage,
                              "mail",
                              entry.address,
                              { account: selfAddress, chainId },
                            );
                          }}
                        >
                          Encrypted Mail
                        </Link>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="RFQ and Mail handoffs require the active Ready account and network"
                      >
                        Handoffs unavailable
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(entry.label)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.bookEmptyBlock}>
              <strong>No saved counterparties yet</strong>
              <p className={styles.bookEmpty}>
                Add a label and address above. Entries stay AES-GCM encrypted
                under a device-local key until you explicitly post an encrypted
                recovery snapshot from Mailbox.
              </p>
            </div>
          )
        ) : (
          <div className={styles.bookEmptyBlock}>
            <strong>Wallet required</strong>
            <p className={styles.bookEmpty}>
              Connect a wallet to open this account's encrypted book.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function ContactsPage() {
  const session = useActiveStarknetSession();
  const address = session.account ?? "";
  const chain = session.chainId ?? "";
  const handoffsEnabled =
    session.rail === "ready" && session.compatible && Boolean(address && chain);
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadCopy}>
          <p className={styles.eyebrow}>APP20 / COUNTERPARTIES</p>
          <h1>Counterparties on file. Nothing leaves this device.</h1>
          <span>
            Label the wallets you trade with, then jump straight into an RFQ or
            encrypted Mail. The book is AES-GCM encrypted and never posted
            anywhere unless you snapshot it from Mailbox yourself.
          </span>
        </div>
      </header>
      <AddressBookPanel
        selfAddress={address}
        chainId={chain}
        handoffsEnabled={handoffsEnabled}
      />
      <p className={styles.disclosure}>
        Local contacts are AES-GCM encrypted under app20/address-book/v1. Code
        running in this browser profile can still read an unlocked book. For
        cross-device recovery, Mailbox can post a self-addressed encrypted
        snapshot: connect the same wallet and restore the mailbox recovery
        phrase. Wallet possession alone cannot decrypt it. On-chain ciphertext,
        size, timing, and helper activity remain public and cannot be deleted.
      </p>
    </main>
  );
}
