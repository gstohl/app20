import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAKER_MID_DOMAIN,
  PRIVATE_RFQ_V2_DOMAIN,
  createSelectionTranscript,
  evaluatePriceSchedule,
  type PrivateRfqV2,
  type SelectionTranscriptV1,
} from "@app20/private-intents";
import {
  DurableMakerNode,
  DurableMakerTranscriptJournal,
  DurableReservationStore,
  MakerTranscriptConflictError,
  MakerWalletOperationError,
  type MakerEconomicPolicyV3Input,
  type MakerNodeConfig,
  type MakerOnChainLock,
  type MakerWalletAdapter,
} from "./index";

const NOW = 2_000_000_000;
const STRK = "0x1";
const USDC = "0x2";
const ESCROW = "0x3";
const ACCOUNT = "0x4";
const LOCK_ID = "0x77";
const LOCK_TICKET = "0x88";
const LOCK_TX = "0x99";
const NONCE = `0x${"11".repeat(32)}`;
const RFQ_ID = `0x${"22".repeat(32)}`;
const SIGNATURE = `0x${"00".repeat(31)}01${"00".repeat(31)}01`;
const BUCKET_MIN = 5n * 10n ** 16n;
const BUCKET_MAX = 10n ** 17n;

const roots: string[] = [];
const stores: DurableReservationStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function paths() {
  const root = mkdtempSync(join(tmpdir(), "app20-maker-v3-"));
  roots.push(root);
  return {
    wal: join(root, "maker.wal"),
    transcripts: join(root, "transcripts.json"),
  };
}

function openStore(path: string): DurableReservationStore {
  const store = DurableReservationStore.open(path);
  stores.push(store);
  return store;
}

function rfq(overrides: Partial<PrivateRfqV2> = {}): PrivateRfqV2 {
  return {
    version: 2,
    domain: PRIVATE_RFQ_V2_DOMAIN,
    rfqId: RFQ_ID,
    rfqFelt: "0x55",
    takerCommitment: "0x66",
    chainId: "starknet:APP20_LOCALNET",
    registryRevision: "localnet-registry:5",
    directoryEpoch: 1,
    settlementHelper: ESCROW,
    sellToken: STRK,
    buyToken: USDC,
    sellBucketMinBaseUnits: BUCKET_MIN,
    sellBucketMaxBaseUnits: BUCKET_MAX,
    createdAt: NOW,
    responseDeadline: NOW + 30,
    expiresAt: NOW + 90,
    lockExpiresAt: NOW + 90,
    ...overrides,
  };
}

function scheduleFor(input: PrivateRfqV2) {
  return Object.freeze([
    Object.freeze({
      a: input.sellBucketMinBaseUnits,
      b: input.sellBucketMinBaseUnits / 10n ** 12n,
    }),
    Object.freeze({
      a: input.sellBucketMaxBaseUnits,
      b: input.sellBucketMaxBaseUnits / 10n ** 12n,
    }),
  ]);
}

type FixtureOptions = Readonly<{
  wallet?: Partial<MakerWalletAdapter>;
  balance?: bigint;
  getLockFailureAt?: number;
  clock?: () => number;
  economicEvaluate?: (input: MakerEconomicPolicyV3Input) => Readonly<{
    allowed: boolean;
    reason?: string;
    commitmentUsdcBaseUnits?: bigint;
  }>;
}>;

function fixture(
  store: DurableReservationStore,
  transcriptPath: string,
  options: FixtureOptions = {},
) {
  const locks = new Map<string, MakerOnChainLock>();
  let lockCalls = 0;
  let proceedsCalls = 0;
  let releaseCalls = 0;
  let getLockCalls = 0;
  let lockStateAtCall: string | undefined;
  let proceedsStateAtCall: string | undefined;
  let releaseStateAtCall: string | undefined;
  const economicInputs: MakerEconomicPolicyV3Input[] = [];
  const baseWallet: MakerWalletAdapter = {
    settlementAccount: ACCOUNT,
    privateBalance: async () => options.balance ?? 1_000_000n,
    fill: async () => ({ transactionHash: "0xf11" }),
    async lock(request) {
      lockCalls += 1;
      lockStateAtCall = store.listLocks()[0]?.state;
      const chain = Object.freeze({
        tokenA: request.tokenA,
        tokenB: request.tokenB,
        rfqId: request.rfqFelt,
        takerCommitment: request.takerCommitment,
        expiry: request.expiry,
        schedule: request.schedule,
        remainingB: request.schedule[request.schedule.length - 1]!.b,
        earnedA: 0n,
        ticket: LOCK_TICKET,
        proceedsSettled: false,
        collateralReleased: false,
        status: "open" as const,
      });
      locks.set(request.lockId, chain);
      return { ticket: LOCK_TICKET, transactionHash: LOCK_TX, lock: chain };
    },
    async getLock(lockId) {
      getLockCalls += 1;
      if (getLockCalls === options.getLockFailureAt) {
        throw new Error("fixture readback unavailable");
      }
      return (
        locks.get(lockId) ??
        Object.freeze({
          tokenA: "0x0",
          tokenB: "0x0",
          rfqId: "0x0",
          takerCommitment: "0x0",
          expiry: 0,
          schedule: Object.freeze([]),
          remainingB: 0n,
          earnedA: 0n,
          ticket: "0x0",
          proceedsSettled: false,
          collateralReleased: false,
          status: "empty" as const,
        })
      );
    },
    async settleProceeds(request) {
      proceedsCalls += 1;
      proceedsStateAtCall = store.listLocks()[0]?.state;
      const current = locks.get(request.lockId)!;
      locks.set(
        request.lockId,
        Object.freeze({ ...current, proceedsSettled: true }),
      );
      return { transactionHash: "0xa1" };
    },
    async releaseCollateral(request) {
      releaseCalls += 1;
      releaseStateAtCall = store.listLocks()[0]?.state;
      const current = locks.get(request.lockId)!;
      locks.set(
        request.lockId,
        Object.freeze({ ...current, collateralReleased: true }),
      );
      return { transactionHash: "0xa2" };
    },
  };
  const wallet = { ...baseWallet, ...options.wallet } as MakerWalletAdapter;
  const config: MakerNodeConfig = {
    makerId: "maker-a",
    solverKey: "maker-a/quote/p256/v1",
    pool: "starknet:APP20_LOCALNET",
    helper: ESCROW,
    spreadBps: 30,
    reservationTtlSeconds: 90,
    price: async () => ({
      grossBuyAmount: 1n,
      provenance: "legacy-fixture",
    }),
    signer: async () => SIGNATURE,
    wallet,
    v3: {
      tokenSymbol: (token) =>
        token === STRK ? "STRK" : token === USDC ? "USDC" : undefined,
      buildSchedule({ rfq: input, availableBuyInventory }) {
        const schedule = scheduleFor(input);
        return schedule[0]!.b <= availableBuyInventory
          ? {
              schedule,
              spreadBps: 30,
              pricingProvenance: "fixture:linear",
            }
          : null;
      },
      economicPolicy: {
        evaluate(input) {
          economicInputs.push(input);
          return options.economicEvaluate?.(input) ?? { allowed: true };
        },
      },
      midE18: 2n * 10n ** 18n,
      transcriptJournal: DurableMakerTranscriptJournal.open(transcriptPath),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      randomFelt: () => LOCK_ID,
      randomNonce: () => NONCE,
    },
  };
  const node = new DurableMakerNode(store, config);
  return {
    node,
    locks,
    wallet,
    economicInputs,
    lockCalls: () => lockCalls,
    proceedsCalls: () => proceedsCalls,
    releaseCalls: () => releaseCalls,
    getLockCalls: () => getLockCalls,
    lockStateAtCall: () => lockStateAtCall,
    proceedsStateAtCall: () => proceedsStateAtCall,
    releaseStateAtCall: () => releaseStateAtCall,
  };
}

async function quoted(context: ReturnType<typeof fixture>) {
  const result = await context.node.quoteV3(rfq(), NOW + 1);
  if (!("quote" in result)) throw new Error(result.refused.reason);
  return result;
}

describe("RFQ v3 lock quote pipeline", () => {
  it("durably locks before signing, evaluates policy at a_max, and replays one quote", async () => {
    const path = paths();
    const store = openStore(path.wal);
    const context = fixture(store, path.transcripts);
    const first = await quoted(context);
    expect(first.quote).toMatchObject({
      domain: "app20/private-intent-quote/v3",
      version: 3,
      solverId: "maker-a",
      lockId: LOCK_ID,
      lockTicket: LOCK_TICKET,
      lockTransactionHash: LOCK_TX,
      lockExpiresAt: NOW + 90,
      signature: SIGNATURE,
    });
    expect(context.lockCalls()).toBe(1);
    expect(context.lockStateAtCall()).toBe("locking");
    expect(context.economicInputs).toHaveLength(1);
    expect(context.economicInputs[0]).toMatchObject({
      amountA: BUCKET_MAX,
      amountB: 100_000n,
      quoteTtlSeconds: 89,
    });
    expect(context.node.listLocks()).toEqual([
      expect.objectContaining({
        lockId: LOCK_ID,
        maxB: "100000",
        state: "open",
        takenA: "0",
        takenB: "0",
        ticket: LOCK_TICKET,
        lockTxHash: LOCK_TX,
        quoteDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    ]);
    expect(JSON.stringify(context.node.listLocks())).not.toMatch(
      /nonce|signature|private/i,
    );
    const replay = await quoted(context);
    expect(replay.quote).toEqual(first.quote);
    expect(context.lockCalls()).toBe(1);
    const entries = readFileSync(path.wal, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(entries.at(-1).payload.locks).toHaveLength(1);
    expect(entries.at(-1).payload.records).toEqual([]);
  });

  it("refuses custom buckets, excess TTL, policy, and insufficient inventory without locking", async () => {
    for (const candidate of [
      rfq({ sellBucketMinBaseUnits: BUCKET_MIN + 1n }),
      rfq({ expiresAt: NOW + 91, lockExpiresAt: NOW + 91 }),
    ]) {
      const path = paths();
      const context = fixture(openStore(path.wal), path.transcripts);
      const result = await context.node.quoteV3(candidate, NOW + 1);
      expect(result).toHaveProperty("refused");
      expect(context.lockCalls()).toBe(0);
    }

    const inventoryPath = paths();
    const inventory = fixture(
      openStore(inventoryPath.wal),
      inventoryPath.transcripts,
      { balance: 1n },
    );
    await expect(inventory.node.quoteV3(rfq(), NOW + 1)).resolves.toEqual({
      refused: {
        code: "insufficient-inventory",
        reason: "Private maker inventory cannot cover the bucket minimum.",
      },
    });
    expect(inventory.lockCalls()).toBe(0);

    const policyPath = paths();
    const policy = fixture(openStore(policyPath.wal), policyPath.transcripts, {
      economicEvaluate: () => ({ allowed: false, reason: "fixture policy" }),
    });
    await expect(policy.node.quoteV3(rfq(), NOW + 1)).resolves.toEqual({
      refused: { code: "policy", reason: "fixture policy" },
    });
    expect(policy.lockCalls()).toBe(0);
  });

  it("refuses a quote when its confirmed lock expires before signing", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      clock: () => NOW + 90,
    });
    await expect(context.node.quoteV3(rfq(), NOW + 1)).resolves.toEqual({
      refused: {
        code: "expired",
        reason: "RFQ lock expired before quote signing completed.",
      },
    });
    expect(context.lockCalls()).toBe(1);
    expect(context.node.listLocks()[0]!.state).toBe("open");
    expect(context.node.listLocks()[0]).not.toHaveProperty("quoteDigest");
  });

  it("deletes a known-reverted lock attempt and quarantines an unknown outcome", async () => {
    const revertedPath = paths();
    const reverted = fixture(
      openStore(revertedPath.wal),
      revertedPath.transcripts,
      {
        wallet: {
          lock: async () => {
            throw new MakerWalletOperationError("reverted", "reverted");
          },
        },
      },
    );
    await expect(reverted.node.quoteV3(rfq(), NOW + 1)).resolves.toEqual({
      refused: {
        code: "lock-failed",
        reason: "On-chain lock transaction reverted.",
      },
    });
    expect(reverted.node.listLocks()).toEqual([]);

    const unknownPath = paths();
    const unknown = fixture(
      openStore(unknownPath.wal),
      unknownPath.transcripts,
      {
        wallet: {
          lock: async () => {
            throw new MakerWalletOperationError("unknown", "timeout");
          },
        },
      },
    );
    const result = await unknown.node.quoteV3(rfq(), NOW + 1);
    expect(result).toEqual({
      refused: {
        code: "lock-failed",
        reason: "On-chain lock outcome is unknown; collateral was quarantined.",
      },
    });
    expect(unknown.node.listLocks()[0]!.state).toBe("quarantined");
  });

  it("recovers non-terminal locks from get_lock after a real WAL restart", async () => {
    const path = paths();
    const firstStore = openStore(path.wal);
    const first = fixture(firstStore, path.transcripts);
    await quoted(first);
    const chain = first.locks.get(LOCK_ID)!;
    first.locks.set(
      LOCK_ID,
      Object.freeze({
        ...chain,
        earnedA: BUCKET_MIN,
        remainingB: chain.remainingB - 50_000n,
      }),
    );
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const recoveredStore = openStore(path.wal);
    const recovered = fixture(recoveredStore, path.transcripts, {
      wallet: {
        getLock: async () => first.locks.get(LOCK_ID)!,
      },
    });
    await recovered.node.recoverAfterRestart(NOW + 2);
    expect(recovered.node.listLocks()[0]).toMatchObject({
      state: "taken",
      takenA: BUCKET_MIN.toString(),
      takenB: "50000",
    });
  });
});

describe("RFQ v3 settlement, mids, and transcripts", () => {
  it("settles both payable sides once and persists transaction hashes", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts);
    await quoted(context);
    const chain = context.locks.get(LOCK_ID)!;
    context.locks.set(
      LOCK_ID,
      Object.freeze({
        ...chain,
        earnedA: BUCKET_MIN,
        remainingB: chain.remainingB - 50_000n,
      }),
    );

    await context.node.settleExpiredLocks(NOW + 90);
    expect(context.proceedsCalls()).toBe(1);
    expect(context.releaseCalls()).toBe(1);
    expect(context.proceedsStateAtCall()).toBe("settling");
    expect(context.releaseStateAtCall()).toBe("settling");
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "settled",
      proceedsTxHash: "0xa1",
      releaseTxHash: "0xa2",
      takenA: BUCKET_MIN.toString(),
      takenB: "50000",
    });
    await context.node.settleExpiredLocks(NOW + 91);
    expect(context.proceedsCalls()).toBe(1);
    expect(context.releaseCalls()).toBe(1);
  });

  it("recovers a known successful proceeds hash without replaying the action", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      getLockFailureAt: 2,
    });
    await quoted(context);
    const chain = context.locks.get(LOCK_ID)!;
    context.locks.set(
      LOCK_ID,
      Object.freeze({
        ...chain,
        earnedA: BUCKET_MIN,
        remainingB: chain.remainingB - 50_000n,
      }),
    );

    await context.node.settleExpiredLocks(NOW + 90);
    expect(context.proceedsCalls()).toBe(1);
    expect(context.releaseCalls()).toBe(0);
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "settling",
      proceedsTxHash: "0xa1",
    });
    await context.node.settleExpiredLocks(NOW + 91);
    expect(context.proceedsCalls()).toBe(1);
    expect(context.releaseCalls()).toBe(1);
    expect(context.node.listLocks()[0]!.state).toBe("settled");
  });

  it("quarantines an unknown settlement outcome and never retries it", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        settleProceeds: async () => {
          throw new MakerWalletOperationError("unknown", "timeout");
        },
      },
    });
    await quoted(context);
    const chain = context.locks.get(LOCK_ID)!;
    context.locks.set(
      LOCK_ID,
      Object.freeze({ ...chain, earnedA: BUCKET_MIN, remainingB: 0n }),
    );
    await context.node.settleExpiredLocks(NOW + 90);
    expect(context.node.listLocks()[0]!.state).toBe("quarantined");
    await context.node.settleExpiredLocks(NOW + 91);
    expect(context.node.listLocks()[0]!.state).toBe("quarantined");
  });

  it("signs a fresh 30-second indicative mid", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts);
    await expect(context.node.indicativeMid(NOW)).resolves.toEqual({
      version: 1,
      domain: MAKER_MID_DOMAIN,
      makerId: "maker-a",
      quoteKeyId: "maker-a/quote/p256/v1",
      marketId: "STRK_USDC",
      midE18: 2n * 10n ** 18n,
      observedAt: NOW,
      validUntil: NOW + 30,
      signature: SIGNATURE,
    });
  });

  it("verifies, atomically journals, replays, and conflict-fences transcripts", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts);
    const result = await quoted(context);
    const amountA = result.quote.schedule[0]!.a;
    const amountB = evaluatePriceSchedule(result.quote.schedule, amountA);
    const transcript = await createSelectionTranscript({
      rfqDigest: result.quote.rfqDigest,
      bucket: { min: BUCKET_MIN, max: BUCKET_MAX },
      createdAt: NOW + 2,
      selection: {
        kind: "selected",
        fills: [{ quote: result.quote, amountA, amountB }],
        totalB: amountB,
        rule: "app20/rfq-selection/v3",
      },
      quotes: [result.quote],
      refusals: [],
    });
    await expect(
      context.node.journalTranscript(transcript, NOW + 3),
    ).resolves.toEqual({ accepted: true, consistent: true });
    await expect(
      context.node.journalTranscript(transcript, NOW + 4),
    ).resolves.toEqual({ accepted: true, consistent: true });
    expect(context.node.listTranscripts()).toHaveLength(1);
    expect(statSync(path.transcripts).mode & 0o777).toBe(0o600);
    expect(DurableMakerTranscriptJournal.open(path.transcripts).list()).toEqual(
      context.node.listTranscripts(),
    );

    const conflict: SelectionTranscriptV1 = {
      ...transcript,
      digest: `0x${"ff".repeat(32)}`,
    };
    await expect(
      context.node.journalTranscript(conflict, NOW + 5),
    ).rejects.toBeInstanceOf(MakerTranscriptConflictError);
    expect(context.node.listTranscripts()).toHaveLength(1);
  });
});
