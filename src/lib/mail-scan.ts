import { canonicalizeStarknetAddress } from "./addresses";
import { MAX_CT_FELTS, type EncryptedMailRecord } from "./mail";

export const MAIL_SCAN_CURSOR_PREFIX = "quietline/mail-scan/v1";
export const MAIL_SCAN_CHUNK_SIZE = 128;
export const MAIL_SCAN_MAX_PAGES = 4;
export const MAIL_SCAN_MAX_MESSAGES = 2_048;
export const MAIL_SCAN_BLOCK_WINDOW = 2_048;
export const MAX_CONTINUATION_TOKEN_LENGTH = 2_048;

export type MailEvent = {
  keys: string[];
  data: string[];
  transaction_hash: string;
  block_number?: number;
  event_index?: number;
};

export type ParsedMailEvent = {
  record: EncryptedMailRecord;
  index: string;
  transactionHash: string;
  blockNumber?: number;
  eventIndex?: number;
};

export type MailScanDirection = "recent" | "newer" | "older";

export type MailScanRange = {
  direction: MailScanDirection;
  fromBlock: number;
  toBlock: number;
  continuationToken?: string;
};

export type MailScanCursor = {
  version: 1;
  oldestScannedBlock: number | null;
  newestScannedBlock: number | null;
  pending?: MailScanRange & { continuationToken: string };
};

export type CursorStorage = Pick<Storage, "getItem" | "setItem">;

function isBlockNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseContinuationToken(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > MAX_CONTINUATION_TOKEN_LENGTH
  ) {
    throw new Error("The RPC returned an invalid event continuation token.");
  }
  return value;
}

export function normalizeContinuationToken(value: unknown): string | undefined {
  return parseContinuationToken(value);
}

export function emptyMailScanCursor(): MailScanCursor {
  return {
    version: 1,
    oldestScannedBlock: null,
    newestScannedBlock: null,
  };
}

export function mailScanCursorKey(
  chainId: string,
  selfAddress: string,
  helperAddress: string,
  keyFingerprint: string,
): string {
  if (!/^[0-9a-f]{64}$/i.test(keyFingerprint)) {
    throw new Error("Mail scan cursor requires a public-key fingerprint.");
  }
  return [
    MAIL_SCAN_CURSOR_PREFIX,
    encodeURIComponent(chainId),
    canonicalizeStarknetAddress(selfAddress),
    canonicalizeStarknetAddress(helperAddress),
    keyFingerprint.toLowerCase(),
  ].join("/");
}

function parsePending(value: unknown): MailScanCursor["pending"] {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error();
  }
  const pending = value as Record<string, unknown>;
  if (
    pending.direction !== "recent" &&
    pending.direction !== "newer" &&
    pending.direction !== "older"
  ) {
    throw new Error();
  }
  if (
    !isBlockNumber(pending.fromBlock) ||
    !isBlockNumber(pending.toBlock) ||
    pending.fromBlock > pending.toBlock
  ) {
    throw new Error();
  }
  const continuationToken = parseContinuationToken(pending.continuationToken);
  if (!continuationToken) throw new Error();
  return {
    direction: pending.direction,
    fromBlock: pending.fromBlock,
    toBlock: pending.toBlock,
    continuationToken,
  };
}

export function loadMailScanCursor(
  storage: CursorStorage,
  key: string,
): MailScanCursor {
  const serialized = storage.getItem(key);
  if (!serialized) return emptyMailScanCursor();
  try {
    const value: unknown = JSON.parse(serialized);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return emptyMailScanCursor();
    }
    const cursor = value as Record<string, unknown>;
    if (
      cursor.version !== 1 ||
      (cursor.oldestScannedBlock !== null &&
        !isBlockNumber(cursor.oldestScannedBlock)) ||
      (cursor.newestScannedBlock !== null &&
        !isBlockNumber(cursor.newestScannedBlock)) ||
      (typeof cursor.oldestScannedBlock === "number" &&
        typeof cursor.newestScannedBlock === "number" &&
        cursor.oldestScannedBlock > cursor.newestScannedBlock)
    ) {
      return emptyMailScanCursor();
    }
    return {
      version: 1,
      oldestScannedBlock: cursor.oldestScannedBlock as number | null,
      newestScannedBlock: cursor.newestScannedBlock as number | null,
      ...(cursor.pending === undefined
        ? {}
        : { pending: parsePending(cursor.pending) }),
    };
  } catch {
    return emptyMailScanCursor();
  }
}

export function saveMailScanCursor(
  storage: CursorStorage,
  key: string,
  cursor: MailScanCursor,
): void {
  storage.setItem(key, JSON.stringify(cursor));
}

export function planMailScan(
  cursor: MailScanCursor,
  latestBlock: number,
  requested: "newer" | "older",
  recentLoaded: boolean,
): MailScanRange | null {
  if (!isBlockNumber(latestBlock)) {
    throw new Error("The RPC returned an invalid latest block number.");
  }
  if (cursor.pending) return cursor.pending;

  if (requested === "older") {
    const toBlock = (cursor.oldestScannedBlock ?? latestBlock + 1) - 1;
    if (toBlock < 0) return null;
    return {
      direction: "older",
      fromBlock: Math.max(0, toBlock - MAIL_SCAN_BLOCK_WINDOW + 1),
      toBlock,
    };
  }

  if (!recentLoaded) {
    return {
      direction: "recent",
      fromBlock: Math.max(0, latestBlock - MAIL_SCAN_BLOCK_WINDOW + 1),
      toBlock: latestBlock,
    };
  }

  const fromBlock = (cursor.newestScannedBlock ?? latestBlock) + 1;
  if (fromBlock > latestBlock) return null;
  return { direction: "newer", fromBlock, toBlock: latestBlock };
}

export function pauseMailScan(
  cursor: MailScanCursor,
  range: MailScanRange,
  continuationToken: string,
): MailScanCursor {
  const token = parseContinuationToken(continuationToken);
  if (!token)
    throw new Error("A pending mail scan requires a continuation token.");
  return {
    ...cursor,
    pending: { ...range, continuationToken: token },
  };
}

export function completeMailScan(
  cursor: MailScanCursor,
  range: MailScanRange,
): MailScanCursor {
  return {
    version: 1,
    oldestScannedBlock:
      cursor.oldestScannedBlock === null
        ? range.fromBlock
        : Math.min(cursor.oldestScannedBlock, range.fromBlock),
    newestScannedBlock:
      cursor.newestScannedBlock === null
        ? range.toBlock
        : Math.max(cursor.newestScannedBlock, range.toBlock),
  };
}

function canonicalFelt(value: unknown): string {
  if (typeof value !== "string") throw new Error();
  return canonicalizeStarknetAddress(value);
}

/** Reject oversized or malformed RPC records before retaining ciphertext. */
export function parseMailEvent(event: MailEvent): ParsedMailEvent | null {
  try {
    if (
      !Array.isArray(event.keys) ||
      !Array.isArray(event.data) ||
      event.keys.length < 2 ||
      event.data.length < 6
    ) {
      return null;
    }
    const ciphertextLength = Number(BigInt(canonicalFelt(event.data[5])));
    const viewTag = Number(BigInt(canonicalFelt(event.data[2])));
    if (
      !Number.isSafeInteger(ciphertextLength) ||
      ciphertextLength < 0 ||
      ciphertextLength > MAX_CT_FELTS ||
      // QuietlineMail appends action_id after the counted ciphertext felts.
      event.data.length !== 7 + ciphertextLength ||
      !Number.isInteger(viewTag) ||
      viewTag < 0 ||
      viewTag > 255 ||
      (event.block_number !== undefined &&
        !isBlockNumber(event.block_number)) ||
      (event.event_index !== undefined && !isBlockNumber(event.event_index))
    ) {
      return null;
    }

    const ciphertextFelts = event.data
      .slice(6, 6 + ciphertextLength)
      .map(canonicalFelt);
    canonicalFelt(event.data[6 + ciphertextLength]);
    return {
      index: BigInt(canonicalFelt(event.keys[1])).toString(),
      transactionHash: canonicalFelt(event.transaction_hash),
      blockNumber: event.block_number,
      eventIndex: event.event_index,
      record: {
        ephemeralPub: [
          canonicalFelt(event.data[0]),
          canonicalFelt(event.data[1]),
        ],
        viewTag,
        nonce: [canonicalFelt(event.data[3]), canonicalFelt(event.data[4])],
        ciphertextFelts,
      },
    };
  } catch {
    return null;
  }
}
