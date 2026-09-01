import {
  canonicalSettlementReceipt,
  digestSettlementReceipt,
  type SettlementReceipt,
} from "./settlement-receipt";

export const RECEIPT_DISCLOSURE_DOMAIN =
  "app20/settlement-receipt-disclosure/v1";

export const RECEIPT_DISCLOSURE_WARNING =
  "A copied disclosure cannot be revoked. Share only the fields you selected.";

export const DEFAULT_RECEIPT_DISCLOSURE_EXCLUSIONS = [
  "losing quotes",
  "invited-maker set",
  "correspondence/mail",
  "local note IDs",
  "viewing keys",
  "relay metadata",
] as const;

export const RECEIPT_DISCLOSURE_FIELDS = [
  "chainId",
  "escrowAddress",
  "escrowClassHash",
  "dealId",
  "claimTicketId",
  "intentDigest",
  "winningQuoteDigest",
  "makerKeyId",
  "directoryEpoch",
  "reservationId",
  "registryRevision",
  "inputAsset",
  "inputAmountBaseUnits",
  "outputAsset",
  "outputAmountBaseUnits",
  "outcome",
  "evidenceKind",
  "requiredFinality",
  "lifecycle",
] as const;

export type ReceiptDisclosureField = (typeof RECEIPT_DISCLOSURE_FIELDS)[number];

export type ReceiptDisclosureValue =
  | string
  | number
  | boolean
  | null
  | readonly ReceiptDisclosureValue[]
  | Readonly<{ [key: string]: ReceiptDisclosureValue }>;

export type ReceiptDisclosurePackage = Readonly<{
  version: 1;
  domain: typeof RECEIPT_DISCLOSURE_DOMAIN;
  receiptDigest: string;
  disclosedFields: Readonly<
    Partial<Record<ReceiptDisclosureField, ReceiptDisclosureValue>>
  >;
  warning: typeof RECEIPT_DISCLOSURE_WARNING;
}>;

const ALLOWED_FIELDS = new Set<string>(RECEIPT_DISCLOSURE_FIELDS);

function canonicalReceiptObject(
  receipt: SettlementReceipt,
): Partial<Record<ReceiptDisclosureField, ReceiptDisclosureValue>> {
  try {
    return JSON.parse(canonicalSettlementReceipt(receipt)) as Partial<
      Record<ReceiptDisclosureField, ReceiptDisclosureValue>
    >;
  } catch (error) {
    throw new Error("Canonical settlement receipt could not be decoded.", {
      cause: error,
    });
  }
}

function selectedFields(
  fields: readonly ReceiptDisclosureField[],
): ReceiptDisclosureField[] {
  if (fields.length === 0) {
    throw new Error("Select at least one receipt field to disclose.");
  }
  const selected = [...new Set(fields)];
  for (const field of selected) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new Error(`Receipt field ${String(field)} is not discloseable.`);
    }
  }
  return selected.sort((left, right) => left.localeCompare(right));
}

/**
 * Builds a deterministic disclosure package. This is not a proof and has no
 * reveal key; it is simply a selected document bound to the receipt digest.
 */
export async function buildReceiptDisclosure(
  receipt: SettlementReceipt,
  fields: readonly ReceiptDisclosureField[],
): Promise<ReceiptDisclosurePackage> {
  const canonical = canonicalReceiptObject(receipt);
  const disclosedFields = Object.create(null) as Partial<
    Record<ReceiptDisclosureField, ReceiptDisclosureValue>
  >;
  for (const field of selectedFields(fields)) {
    const value = canonical[field];
    if (value === undefined) {
      throw new Error(`Receipt field ${field} is not present on this receipt.`);
    }
    disclosedFields[field] = value;
  }
  return {
    version: 1,
    domain: RECEIPT_DISCLOSURE_DOMAIN,
    receiptDigest: await digestSettlementReceipt(receipt),
    disclosedFields,
    warning: RECEIPT_DISCLOSURE_WARNING,
  };
}

function canonicalJsonValue(
  value: ReceiptDisclosureValue,
): ReceiptDisclosureValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Disclosure numbers must be safe integers.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Disclosure objects must be plain JSON maps.");
    }
    const record = value as Readonly<Record<string, ReceiptDisclosureValue>>;
    const canonical = Object.create(null) as Record<
      string,
      ReceiptDisclosureValue
    >;
    for (const key of Object.keys(record).sort((left, right) =>
      left.localeCompare(right),
    )) {
      canonical[key] = canonicalJsonValue(record[key]);
    }
    return canonical;
  }
  throw new Error("Disclosure values must be JSON-compatible.");
}

export function canonicalReceiptDisclosure(
  disclosure: ReceiptDisclosurePackage,
): string {
  if (
    disclosure.version !== 1 ||
    disclosure.domain !== RECEIPT_DISCLOSURE_DOMAIN
  ) {
    throw new Error("Only receipt disclosure v1 is supported.");
  }
  if (!/^0x[0-9a-f]{64}$/.test(disclosure.receiptDigest)) {
    throw new Error("receiptDigest must be a SHA-256 hex digest.");
  }
  if (disclosure.warning !== RECEIPT_DISCLOSURE_WARNING) {
    throw new Error("The copied-disclosure warning is required.");
  }
  const keys = Object.keys(disclosure.disclosedFields);
  if (keys.length === 0 || keys.some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new Error(
      "The disclosure contains no fields or a non-allowlisted field.",
    );
  }
  const disclosedFields = Object.create(null) as Partial<
    Record<ReceiptDisclosureField, ReceiptDisclosureValue>
  >;
  for (const key of [...keys].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const field = key as ReceiptDisclosureField;
    const value = disclosure.disclosedFields[field];
    if (value === undefined) {
      throw new Error(`Receipt field ${field} has no disclosure value.`);
    }
    disclosedFields[field] = canonicalJsonValue(value);
  }
  return JSON.stringify({
    disclosedFields,
    domain: disclosure.domain,
    receiptDigest: disclosure.receiptDigest,
    version: disclosure.version,
    warning: disclosure.warning,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyReceiptDisclosureAgainstReceipt(
  disclosure: ReceiptDisclosurePackage,
  receipt: SettlementReceipt,
): Promise<boolean> {
  try {
    const fields = Object.keys(
      disclosure.disclosedFields,
    ) as ReceiptDisclosureField[];
    const expected = await buildReceiptDisclosure(receipt, fields);
    return (
      disclosure.receiptDigest === expected.receiptDigest &&
      canonicalReceiptDisclosure(disclosure) ===
        canonicalReceiptDisclosure(expected)
    );
  } catch {
    return false;
  }
}

export async function digestReceiptDisclosure(
  disclosure: ReceiptDisclosurePackage,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalReceiptDisclosure(disclosure)),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}
