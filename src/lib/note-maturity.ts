import { hash, num } from "starknet";

/**
 * Mirrors NOTE_MATURITY_BLOCKS in packages/privy/src/constants.ts. Deposited
 * notes become spendable in a private action only after this many blocks.
 */
export const NOTE_MATURITY_BLOCKS = 10;
export const POOL_DEPOSIT_SCAN_CHUNK_SIZE = 128;
export const POOL_DEPOSIT_SCAN_MAX_PAGES = 8;
export const POOL_DEPOSIT_SCAN_BLOCK_WINDOW = 2_048;

/** Pool events that create notes for the depositor, keyed by that account. */
export const POOL_DEPOSIT_EVENT_NAMES = Object.freeze({
  shield: "Deposit",
  openNote: "OpenNoteDeposited",
} as const);

export type PoolDepositKind = keyof typeof POOL_DEPOSIT_EVENT_NAMES;

export type PoolDepositObservation = Readonly<{
  kind: PoolDepositKind;
  blockNumber: number;
  transactionHash: string;
  token: string;
  amountBaseUnits: bigint;
  /** Present only for OPEN notes returned by a helper invoke. */
  noteId?: string;
}>;

export type PendingNoteMaturity = Readonly<{
  deposit: PoolDepositObservation;
  matureAtBlock: number;
  blocksRemaining: number;
}>;

export type NoteMaturityStatus = Readonly<{
  headBlock: number;
  maturityBlocks: number;
  mature: readonly PoolDepositObservation[];
  pending: readonly PendingNoteMaturity[];
  /** Block at which every observed deposit is spendable, or null when none is pending. */
  allMatureAtBlock: number | null;
}>;

type RpcEvent = Readonly<{
  from_address?: string;
  keys?: readonly string[];
  data?: readonly string[];
  block_number?: number;
  transaction_hash?: string;
}>;

type EventsPage = Readonly<{
  events?: readonly RpcEvent[];
  continuation_token?: string | null;
}>;

export type PoolEventsProvider = Readonly<{
  getBlockNumber(): Promise<number>;
  getEvents(filter: {
    address: string;
    from_block: { block_number: number };
    to_block: { block_number: number };
    keys: string[][];
    chunk_size: number;
    continuation_token?: string;
  }): Promise<EventsPage>;
}>;

export type ReadAccountDepositsInput = Readonly<{
  provider: PoolEventsProvider;
  poolAddress: string;
  account: string;
  /** Defaults to the last POOL_DEPOSIT_SCAN_BLOCK_WINDOW blocks. */
  fromBlock?: number;
  toBlock?: number;
}>;

function canonicalFelt(value: string): string {
  return num.toHex(BigInt(value));
}

function feltEqual(left: string | undefined, right: string): boolean {
  if (typeof left !== "string") return false;
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

export function poolDepositEventSelectors(): Readonly<
  Record<PoolDepositKind, string>
> {
  return Object.freeze({
    shield: canonicalFelt(
      hash.getSelectorFromName(POOL_DEPOSIT_EVENT_NAMES.shield),
    ),
    openNote: canonicalFelt(
      hash.getSelectorFromName(POOL_DEPOSIT_EVENT_NAMES.openNote),
    ),
  });
}

/**
 * Decodes one pool event into a deposit observation for `account`, or null when
 * the event is not a deposit created for that account.
 *
 * Deposit keys: [selector, user_addr, token]; data: [amount].
 * OpenNoteDeposited keys: [selector, depositor, token, note_id]; data: [amount].
 */
export function parsePoolDepositEvent(
  event: RpcEvent,
  account: string,
  selectors = poolDepositEventSelectors(),
): PoolDepositObservation | null {
  const keys = event.keys ?? [];
  const data = event.data ?? [];
  if (keys.length < 3 || data.length < 1) return null;
  if (!feltEqual(keys[1], account)) return null;
  if (
    typeof event.block_number !== "number" ||
    !Number.isSafeInteger(event.block_number) ||
    event.block_number < 0 ||
    typeof event.transaction_hash !== "string"
  )
    return null;
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = BigInt(data[0] ?? "");
  } catch {
    return null;
  }
  if (amountBaseUnits < 0n) return null;
  const token = keys[2];
  if (typeof token !== "string") return null;
  if (feltEqual(keys[0], selectors.shield)) {
    if (keys.length !== 3) return null;
    return Object.freeze({
      kind: "shield",
      blockNumber: event.block_number,
      transactionHash: canonicalFelt(event.transaction_hash),
      token: canonicalFelt(token),
      amountBaseUnits,
    });
  }
  if (feltEqual(keys[0], selectors.openNote)) {
    const noteId = keys[3];
    if (keys.length !== 4 || typeof noteId !== "string") return null;
    return Object.freeze({
      kind: "openNote",
      blockNumber: event.block_number,
      transactionHash: canonicalFelt(event.transaction_hash),
      token: canonicalFelt(token),
      amountBaseUnits,
      noteId: canonicalFelt(noteId),
    });
  }
  return null;
}

/**
 * Reads the pool's deposit events for one account over a bounded block range.
 * This is a chain-derived estimate of note age; it never touches a viewing key
 * or private balance and cannot see notes received through private transfers.
 */
export async function readAccountDeposits(
  input: ReadAccountDepositsInput,
): Promise<readonly PoolDepositObservation[]> {
  const head = await input.provider.getBlockNumber();
  if (!Number.isSafeInteger(head) || head < 0)
    throw new Error("The pool deposit scan received an invalid head block.");
  const toBlock = input.toBlock ?? head;
  const fromBlock =
    input.fromBlock ?? Math.max(0, toBlock - POOL_DEPOSIT_SCAN_BLOCK_WINDOW);
  if (
    !Number.isSafeInteger(fromBlock) ||
    !Number.isSafeInteger(toBlock) ||
    fromBlock < 0 ||
    toBlock < fromBlock
  )
    throw new Error("The pool deposit scan block range is invalid.");
  const selectors = poolDepositEventSelectors();
  const account = canonicalFelt(input.account);
  const observations: PoolDepositObservation[] = [];
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined;
  for (let page = 0; page < POOL_DEPOSIT_SCAN_MAX_PAGES; page += 1) {
    const chunk = await input.provider.getEvents({
      address: input.poolAddress,
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      keys: [[selectors.shield, selectors.openNote], [account]],
      chunk_size: POOL_DEPOSIT_SCAN_CHUNK_SIZE,
      ...(continuationToken ? { continuation_token: continuationToken } : {}),
    });
    const events = chunk.events ?? [];
    if (!Array.isArray(events) || events.length > POOL_DEPOSIT_SCAN_CHUNK_SIZE)
      throw new Error("The RPC exceeded the bounded pool event page size.");
    for (const event of events) {
      const observation = parsePoolDepositEvent(event, account, selectors);
      if (observation) observations.push(observation);
    }
    const next = chunk.continuation_token;
    if (typeof next !== "string" || next.length === 0) break;
    if (seenTokens.has(next))
      throw new Error("The RPC repeated an event continuation token.");
    seenTokens.add(next);
    continuationToken = next;
  }
  return Object.freeze(
    observations.sort(
      (left, right) =>
        left.blockNumber - right.blockNumber ||
        left.transactionHash.localeCompare(right.transactionHash),
    ),
  );
}

export function noteMaturityStatus(
  deposits: readonly PoolDepositObservation[],
  headBlock: number,
  maturityBlocks = NOTE_MATURITY_BLOCKS,
): NoteMaturityStatus {
  if (!Number.isSafeInteger(headBlock) || headBlock < 0)
    throw new Error("Note maturity requires a valid head block.");
  if (!Number.isSafeInteger(maturityBlocks) || maturityBlocks < 0)
    throw new Error("Note maturity requires a valid block count.");
  const mature: PoolDepositObservation[] = [];
  const pending: PendingNoteMaturity[] = [];
  for (const deposit of deposits) {
    const matureAtBlock = deposit.blockNumber + maturityBlocks;
    if (matureAtBlock <= headBlock) {
      mature.push(deposit);
    } else {
      pending.push(
        Object.freeze({
          deposit,
          matureAtBlock,
          blocksRemaining: matureAtBlock - headBlock,
        }),
      );
    }
  }
  pending.sort((left, right) => left.matureAtBlock - right.matureAtBlock);
  return Object.freeze({
    headBlock,
    maturityBlocks,
    mature: Object.freeze(mature),
    pending: Object.freeze(pending),
    allMatureAtBlock: pending.length
      ? pending[pending.length - 1]!.matureAtBlock
      : null,
  });
}

export function describeNoteMaturity(status: NoteMaturityStatus): string {
  if (!status.pending.length) {
    return status.mature.length
      ? `All ${status.mature.length} observed deposit${status.mature.length === 1 ? "" : "s"} matured (estimate from public pool events).`
      : "No pool deposits observed for this account in the scanned window.";
  }
  const soonest = status.pending[0]!;
  return `${status.pending.length} deposit${status.pending.length === 1 ? "" : "s"} still maturing · next spendable at block ${soonest.matureAtBlock} (${soonest.blocksRemaining} block${soonest.blocksRemaining === 1 ? "" : "s"} left); all spendable at block ${status.allMatureAtBlock}.`;
}
