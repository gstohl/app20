"use client";

import { useEffect, useState } from "react";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  ADDRESS_BOOK_CHANGED_EVENT,
  loadAddressBook,
  removeAddressBookEntry,
  saveAddressBookEntry,
  type AddressBookEntry,
} from "@/lib/address-book";
import styles from "@/app/vault/vault.module.css";

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function AddressBookPanel({ selfAddress }: { selfAddress: string }) {
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
      setStatus("Saved. The book is AES-GCM encrypted in this browser only.");
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
      aria-labelledby="vault-book-title"
    >
      <header className={styles.panelHeading}>
        <span>ADDRESS BOOK</span>
        <strong id="vault-book-title">
          Encrypted on this device · usable in every address field
        </strong>
      </header>
      <div className={styles.bookBody}>
        <div className={styles.bookAdd}>
          <input
            aria-label="New address book label"
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            placeholder="Label"
            maxLength={40}
            disabled={!scope || busy}
          />
          <input
            aria-label="New address book address"
            value={addressDraft}
            onChange={(event) => setAddressDraft(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            disabled={!scope || busy}
          />
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
                  <button
                    type="button"
                    onClick={() => void remove(entry.label)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.bookEmpty}>
              No saved addresses yet. Entries are stored under
              app20/address-book/v1 in this browser profile, AES-GCM encrypted
              with a device-local key, and never uploaded.
            </p>
          )
        ) : (
          <p className={styles.bookEmpty}>
            Connect a wallet to open this account's encrypted book.
          </p>
        )}
      </div>
    </section>
  );
}

export default function ContactsPage() {
  const address = useStoreWallet((state) => state.address);
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadCopy}>
          <p className={styles.eyebrow}>APP20 / CONTACTS</p>
        </div>
      </header>
      <AddressBookPanel selfAddress={address ?? ""} />
      <p className={styles.disclosure}>
        Contacts are AES-GCM encrypted with a device-local key under
        app20/address-book/v1 and never uploaded. Every address field in
        Vault, Mailbox, and Pay can read them.
      </p>
    </main>
  );
}
