"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";
import {
  ADDRESS_BOOK_CHANGED_EVENT,
  loadAddressBook,
  removeAddressBookEntry,
  resolveAddressBookInput,
  saveAddressBookEntry,
  type AddressBookEntry,
} from "@/lib/address-book";
import defaultStyles from "./AddressBookField.module.css";

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

type AddressBookFieldProps = {
  selfAddress: string;
  value: string;
  onChange: (next: string) => void;
  inputAriaLabel: string;
  label?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  rowClassName?: string;
  hintClassName?: string;
  errorClassName?: string;
  hint?: ReactNode;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
};

export default function AddressBookField({
  selfAddress,
  value,
  onChange,
  inputAriaLabel,
  label,
  placeholder = "0x… or saved label",
  disabled = false,
  className,
  rowClassName,
  hintClassName,
  errorClassName,
  hint: hintSlot,
  multiline = false,
  rows = 3,
  required = false,
  inputRef,
}: AddressBookFieldProps) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [bookError, setBookError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = selfAddress.trim();

  useEffect(() => {
    let cancelled = false;
    function reload() {
      if (!scope) {
        setEntries([]);
        setBookError(null);
        return;
      }
      loadAddressBook(window.localStorage, scope)
        .then((loaded) => {
          if (!cancelled) {
            setEntries(loaded);
            setBookError(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setEntries([]);
            setBookError(
              error instanceof Error
                ? error.message
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

  const resolved = resolveAddressBookInput(entries, value);
  const savable =
    Boolean(scope) &&
    !bookError &&
    resolved !== null &&
    resolved.entry === undefined;

  async function confirmSave() {
    if (!scope || resolved === null) return;
    setBusy(true);
    try {
      const next = await saveAddressBookEntry(window.localStorage, scope, {
        label: labelDraft,
        address: resolved.address,
      });
      setEntries(next);
      setSaving(false);
      setLabelDraft("");
      setBookError(null);
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
    } catch (error: unknown) {
      setBookError(
        error instanceof Error ? error.message : "Saving the entry failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entryLabel: string) {
    if (!scope) return;
    setBusy(true);
    try {
      const next = await removeAddressBookEntry(
        window.localStorage,
        scope,
        entryLabel,
      );
      setEntries(next);
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
    } catch (error: unknown) {
      setBookError(
        error instanceof Error ? error.message : "Removing the entry failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const fieldClassName = className ?? defaultStyles.field;
  const bookRowClassName = rowClassName ?? defaultStyles.row;
  const saveRowClassName = rowClassName ?? defaultStyles.saveRow;
  const resolvedHintClassName = hintClassName ?? defaultStyles.hint;
  const resolvedErrorClassName = errorClassName ?? defaultStyles.error;

  const hint = resolved?.entry
    ? `Book: ${resolved.entry.label} · ${shortAddress(resolved.address)}`
    : resolved
      ? `Address ${shortAddress(resolved.address)} · not in the book`
      : value.trim()
        ? "Not a valid address or saved label."
        : scope
          ? `${entries.length} saved ${entries.length === 1 ? "entry" : "entries"} · encrypted on this device`
          : "Connect a wallet to use the address book.";

  return (
    <div className={fieldClassName} data-address-book-field="">
      {label ? <span>{label}</span> : null}
      <div
        className={bookRowClassName}
        data-book-row=""
        data-book-empty={entries.length === 0 ? "" : undefined}
      >
        {entries.length === 0 ? null : (
          <select
            aria-label={`Saved addresses for ${inputAriaLabel}`}
            value=""
            onChange={(event) => {
              const entry = entries.find(
                (item) => item.label === event.target.value,
              );
              if (!entry) return;
              if (!multiline) {
                onChange(entry.address);
                return;
              }
              const lines = value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              if (!lines.includes(entry.address)) lines.push(entry.address);
              onChange(lines.join("\n"));
            }}
            disabled={disabled || !scope || entries.length === 0 || busy}
          >
            <option value="">Book…</option>
            {entries.map((entry) => (
              <option key={entry.label} value={entry.label}>
                {entry.label} · {shortAddress(entry.address)}
              </option>
            ))}
          </select>
        )}
        {multiline ? (
          <textarea
            ref={inputRef as Ref<HTMLTextAreaElement>}
            aria-label={inputAriaLabel}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            rows={rows}
            required={required}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
        ) : (
          <input
            ref={inputRef as Ref<HTMLInputElement>}
            aria-label={inputAriaLabel}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            required={required}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
        )}
        {saving ? null : resolved?.entry ? (
          <button
            type="button"
            onClick={() => void removeEntry(resolved.entry?.label ?? "")}
            disabled={disabled || busy}
            title="Remove this entry from the encrypted book"
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSaving(true)}
            disabled={disabled || busy || !savable}
            title={
              savable
                ? "Save this address in the encrypted book"
                : "Enter a valid, unsaved address first"
            }
          >
            Save
          </button>
        )}
      </div>
      {saving ? (
        <div className={saveRowClassName} data-book-save="">
          <input
            aria-label={`Address book label for ${inputAriaLabel}`}
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            placeholder="Label, e.g. Bob desk"
            autoComplete="off"
            maxLength={40}
          />
          <button
            type="button"
            onClick={() => void confirmSave()}
            disabled={busy || !labelDraft.trim()}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setSaving(false);
              setLabelDraft("");
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {bookError ? (
        <small className={resolvedErrorClassName} role="alert">
          {bookError}
        </small>
      ) : (
        <small className={resolvedHintClassName}>{hintSlot ?? hint}</small>
      )}
    </div>
  );
}
