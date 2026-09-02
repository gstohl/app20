import { hash } from "starknet";
import { describe, expect, it } from "vitest";
import { NOTE_MATURITY_BLOCKS as PRIVY_NOTE_MATURITY_BLOCKS } from "@app20/privy";
import {
  NOTE_MATURITY_BLOCKS,
  POOL_DEPOSIT_SCAN_CHUNK_SIZE,
  describeNoteMaturity,
  noteMaturityStatus,
  parsePoolDepositEvent,
  poolDepositEventSelectors,
  readAccountDeposits,
  type PoolEventsProvider,
} from "./note-maturity";

const ALICE = "0x00a11ce";
const BOB = "0xb0b";
const STRK =
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL = "0x7001";
const DEPOSIT = hash.getSelectorFromName("Deposit");
const OPEN_NOTE = hash.getSelectorFromName("OpenNoteDeposited");

function shieldEvent(block: number, account = ALICE, amount = "0x5") {
  return {
    from_address: POOL,
    keys: [DEPOSIT, account, STRK],
    data: [amount],
    block_number: block,
    transaction_hash: `0x${block.toString(16)}aa`,
  };
}

function openNoteEvent(block: number, account = ALICE) {
  return {
    from_address: POOL,
    keys: [OPEN_NOTE, account, STRK, "0x77"],
    data: ["0x7"],
    block_number: block,
    transaction_hash: `0x${block.toString(16)}bb`,
  };
}

describe("note maturity", () => {
  it("mirrors the Privy SDK maturity constant", () => {
    expect(NOTE_MATURITY_BLOCKS).toBe(PRIVY_NOTE_MATURITY_BLOCKS);
  });

  it("parses shield and OPEN-note deposits keyed by the account only", () => {
    const selectors = poolDepositEventSelectors();
    expect(
      parsePoolDepositEvent(shieldEvent(12), "0xa11ce", selectors),
    ).toEqual({
      kind: "shield",
      blockNumber: 12,
      transactionHash: "0xcaa",
      token: STRK,
      amountBaseUnits: 5n,
    });
    expect(parsePoolDepositEvent(openNoteEvent(13), ALICE, selectors)).toEqual({
      kind: "openNote",
      blockNumber: 13,
      transactionHash: "0xdbb",
      token: STRK,
      amountBaseUnits: 7n,
      noteId: "0x77",
    });
    expect(
      parsePoolDepositEvent(shieldEvent(12, BOB), ALICE, selectors),
    ).toBeNull();
    expect(
      parsePoolDepositEvent(
        {
          ...shieldEvent(12),
          keys: [hash.getSelectorFromName("Withdrawal"), ALICE, STRK],
        },
        ALICE,
        selectors,
      ),
    ).toBeNull();
    expect(
      parsePoolDepositEvent(
        { ...shieldEvent(12), block_number: undefined },
        ALICE,
        selectors,
      ),
    ).toBeNull();
  });

  it("scans with the account as the second key and follows continuation tokens", async () => {
    const calls: unknown[] = [];
    const provider: PoolEventsProvider = {
      getBlockNumber: async () => 40,
      getEvents: async (filter) => {
        calls.push(filter);
        if (!filter.continuation_token) {
          return {
            events: [shieldEvent(30), shieldEvent(31, BOB)],
            continuation_token: "p2",
          };
        }
        return { events: [openNoteEvent(39)], continuation_token: null };
      },
    };
    const deposits = await readAccountDeposits({
      provider,
      poolAddress: POOL,
      account: ALICE,
    });
    expect(
      deposits.map((deposit) => [deposit.kind, deposit.blockNumber]),
    ).toEqual([
      ["shield", 30],
      ["openNote", 39],
    ]);
    expect(calls).toHaveLength(2);
    const first = calls[0] as {
      keys: string[][];
      chunk_size: number;
      from_block: { block_number: number };
    };
    expect(first.keys[0]).toHaveLength(2);
    expect(first.keys[1]).toEqual(["0xa11ce"]);
    expect(first.chunk_size).toBe(POOL_DEPOSIT_SCAN_CHUNK_SIZE);
    expect(first.from_block.block_number).toBe(0);
  });

  it("refuses repeated continuation tokens and oversized pages", async () => {
    const looping: PoolEventsProvider = {
      getBlockNumber: async () => 40,
      getEvents: async () => ({ events: [], continuation_token: "same" }),
    };
    await expect(
      readAccountDeposits({
        provider: looping,
        poolAddress: POOL,
        account: ALICE,
      }),
    ).rejects.toThrow(/repeated an event continuation token/);
    const oversized: PoolEventsProvider = {
      getBlockNumber: async () => 40,
      getEvents: async () => ({
        events: Array.from({ length: POOL_DEPOSIT_SCAN_CHUNK_SIZE + 1 }, () =>
          shieldEvent(1),
        ),
      }),
    };
    await expect(
      readAccountDeposits({
        provider: oversized,
        poolAddress: POOL,
        account: ALICE,
      }),
    ).rejects.toThrow(/bounded pool event page size/);
  });

  it("classifies deposits against the head block", () => {
    const selectors = poolDepositEventSelectors();
    const deposits = [shieldEvent(20), openNoteEvent(35), shieldEvent(28)]
      .map((event) => parsePoolDepositEvent(event, ALICE, selectors))
      .filter((deposit) => deposit !== null);
    const status = noteMaturityStatus(deposits, 40);
    expect(status.mature.map((deposit) => deposit.blockNumber)).toEqual([
      20, 28,
    ]);
    expect(
      status.pending.map((entry) => [
        entry.matureAtBlock,
        entry.blocksRemaining,
      ]),
    ).toEqual([[45, 5]]);
    expect(status.allMatureAtBlock).toBe(45);
    expect(describeNoteMaturity(status)).toContain(
      "next spendable at block 45 (5 blocks left)",
    );
    const settled = noteMaturityStatus(deposits, 45);
    expect(settled.pending).toHaveLength(0);
    expect(settled.allMatureAtBlock).toBeNull();
    expect(describeNoteMaturity(settled)).toContain(
      "All 3 observed deposits matured",
    );
    expect(describeNoteMaturity(noteMaturityStatus([], 45))).toContain(
      "No pool deposits observed",
    );
  });
});
