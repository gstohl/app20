import { canonicalizeStarknetAddress } from "./addresses";
import { parseConversationId } from "./mail-thread";

export const MAIL_ASSIGNMENT_STORAGE_PREFIX = "app20/assignments/v1";

export type MailAssignment = {
  messageId: string;
  address?: string;
  conversationId?: string;
  assignedAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function key(chainId: string, address: string): string {
  return `${MAIL_ASSIGNMENT_STORAGE_PREFIX}/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAssignment(value: unknown): MailAssignment | null {
  if (
    !isObject(value) ||
    typeof value.messageId !== "string" ||
    !Number.isSafeInteger(value.assignedAt)
  ) {
    return null;
  }
  const assignedAt = value.assignedAt as number;
  let address: string | undefined;
  if (typeof value.address === "string") {
    try {
      address = canonicalizeStarknetAddress(value.address);
    } catch {
      return null;
    }
  }
  const conversationId = parseConversationId(value.conversationId);
  if (!address && !conversationId) return null;
  return {
    messageId: value.messageId,
    ...(address ? { address } : {}),
    ...(conversationId ? { conversationId } : {}),
    assignedAt,
  };
}

export function loadMailAssignments(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  address: string,
): Record<string, MailAssignment> {
  try {
    const raw = storage.getItem(key(chainId, address));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!isObject(parsed)) return {};
    const assignments: Record<string, MailAssignment> = {};
    for (const value of Object.values(parsed)) {
      const assignment = parseAssignment(value);
      if (assignment) assignments[assignment.messageId] = assignment;
    }
    return assignments;
  } catch {
    return {};
  }
}

function persist(
  storage: StorageLike,
  chainId: string,
  ownerAddress: string,
  assignments: Record<string, MailAssignment>,
): Record<string, MailAssignment> {
  storage.setItem(key(chainId, ownerAddress), JSON.stringify(assignments));
  return assignments;
}

export function saveMailAssignment(
  storage: StorageLike,
  chainId: string,
  ownerAddress: string,
  messageId: string,
  update: { address?: string; conversationId?: string },
  at = Date.now(),
): Record<string, MailAssignment> {
  const assignments = loadMailAssignments(storage, chainId, ownerAddress);
  const current = assignments[messageId];
  const next: MailAssignment = {
    messageId,
    assignedAt: at,
    address: update.address
      ? canonicalizeStarknetAddress(update.address)
      : current?.address,
    conversationId: update.conversationId
      ? parseConversationId(update.conversationId)
      : current?.conversationId,
  };
  if (!next.address && !next.conversationId) {
    throw new Error("Assignment needs an address or a conversation id.");
  }
  assignments[messageId] = next;
  return persist(storage, chainId, ownerAddress, assignments);
}

export function clearMailAssignment(
  storage: StorageLike,
  chainId: string,
  ownerAddress: string,
  messageId: string,
): Record<string, MailAssignment> {
  const assignments = loadMailAssignments(storage, chainId, ownerAddress);
  delete assignments[messageId];
  return persist(storage, chainId, ownerAddress, assignments);
}
