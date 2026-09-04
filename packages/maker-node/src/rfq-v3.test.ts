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
  LOCK_RECONCILIATION_BACKOFF_CAP_SECONDS,
  LOCK_RECONCILIATION_MAX_FAILURES,
  MakerTranscriptConflictError,
  MakerWalletOperationError,
  QUARANTINED_LOCK_CAPACITY_GRACE_SECONDS,
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
  randomFelt?: () => string;
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
  const receipts = new Map<
    string,
    "PENDING" | "SUCCEEDED" | "REVERTED"
  >();
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
    async getTransactionReceipt(transactionHash) {
      return {
        transactionHash,
        status: receipts.get(transactionHash) ?? "PENDING",
      };
    },
    async settleProceeds(request) {
      proceedsCalls += 1;
      proceedsStateAtCall = store.listLocks()[0]?.state;
      const current = locks.get(request.lockId)!;
      locks.set(
        request.lockId,
        Object.freeze({
          ...current,
          proceedsSettled: true,
          status: current.collateralReleased ? "closed" : "open",
        }),
      );
      receipts.set("0xa1", "SUCCEEDED");
      return { transactionHash: "0xa1" };
    },
    async releaseCollateral(request) {
      releaseCalls += 1;
      releaseStateAtCall = store.listLocks()[0]?.state;
      const current = locks.get(request.lockId)!;
      locks.set(
        request.lockId,
        Object.freeze({
          ...current,
          collateralReleased: true,
          status: current.proceedsSettled ? "closed" : "open",
        }),
      );
      receipts.set("0xa2", "SUCCEEDED");
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
      randomFelt: options.randomFelt ?? (() => LOCK_ID),
      randomNonce: () => NONCE,
    },
  };
  const node = new DurableMakerNode(store, config);
  return {
    node,
    locks,
    receipts,
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

  it("deletes a known-reverted lock attempt and retains an unknown outcome for reconciliation", async () => {
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
        reason: "On-chain lock outcome is pending RPC reconciliation.",
      },
    });
    expect(unknown.node.listLocks()[0]).toMatchObject({
      state: "reconcile-pending",
      priorState: "locking",
      reconciliationFailures: 1,
      reason: "rpc-unavailable",
    });
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

  it("retains and retries the prior effective state when restart get_lock fails once", async () => {
    const path = paths();
    const firstStore = openStore(path.wal);
    const first = fixture(firstStore, path.transcripts);
    await quoted(first);
    const chain = first.locks.get(LOCK_ID)!;
    first.locks.set(
      LOCK_ID,
      Object.freeze({ ...chain, earnedA: BUCKET_MIN, remainingB: 50_000n }),
    );
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    let reads = 0;
    const recovered = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        getLock: async () => {
          reads += 1;
          if (reads === 1) throw new Error("RPC unavailable");
          return first.locks.get(LOCK_ID)!;
        },
      },
    });
    await recovered.node.recoverAfterRestart(NOW + 2);
    expect(recovered.node.listLocks()[0]).toMatchObject({
      state: "reconcile-pending",
      priorState: "open",
      reconciliationFailures: 1,
      nextReconciliationAt: NOW + 3,
    });

    await recovered.node.settleExpiredLocks(NOW + 3);
    expect(recovered.node.listLocks()[0]).toMatchObject({
      state: "taken",
      takenA: BUCKET_MIN.toString(),
      takenB: "50000",
    });
    expect(reads).toBe(2);
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
    expect(context.proceedsStateAtCall()).toBe("settlement-unknown");
    expect(context.releaseStateAtCall()).toBe("settlement-unknown");
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
      state: "settlement-unknown",
      priorState: "expired",
      proceedsTxHash: "0xa1",
      settlementAttempt: {
        action: "proceeds",
        attempt: 1,
        transactionHash: "0xa1",
      },
    });
    await context.node.settleExpiredLocks(NOW + 91);
    expect(context.proceedsCalls()).toBe(1);
    expect(context.releaseCalls()).toBe(1);
    expect(context.node.listLocks()[0]!.state).toBe("settled");
  });

  it("durably reconciles a timed-out submitted proceeds settlement from its successful receipt", async () => {
    const path = paths();
    const store = openStore(path.wal);
    let submissions = 0;
    const context = fixture(store, path.transcripts, {
      wallet: {
        settleProceeds: async () => {
          submissions += 1;
          throw new MakerWalletOperationError("unknown", "timeout", {
            transactionHash: "0xa1",
          });
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
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "settlement-unknown",
      proceedsTxHash: "0xa1",
      reconciliationFailures: 1,
      settlementAttempt: {
        action: "proceeds",
        transactionHash: "0xa1",
      },
    });
    context.receipts.set("0xa1", "SUCCEEDED");
    context.locks.set(
      LOCK_ID,
      Object.freeze({
        ...context.locks.get(LOCK_ID)!,
        proceedsSettled: true,
      }),
    );
    await store.close();
    stores.splice(stores.indexOf(store), 1);
    const recovered = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        getLock: async () => context.locks.get(LOCK_ID)!,
        getTransactionReceipt: async (transactionHash) => ({
          transactionHash,
          status: context.receipts.get(transactionHash) ?? "PENDING",
        }),
        settleProceeds: async () => {
          submissions += 1;
          throw new Error("must not resubmit an unknown settlement");
        },
        releaseCollateral: async (request) => {
          expect(request.expectedPayout).toBe(0n);
          context.locks.set(
            request.lockId,
            Object.freeze({
              ...context.locks.get(request.lockId)!,
              collateralReleased: true,
              status: "closed",
            }),
          );
          context.receipts.set("0xa2", "SUCCEEDED");
          return { transactionHash: "0xa2" };
        },
      },
    });
    await recovered.node.settleExpiredLocks(NOW + 91);
    expect(recovered.node.listLocks()[0]!.state).toBe("settled");
    expect(submissions).toBe(1);
  });

  it("makes a reverted unknown settlement retryable without resubmitting it", async () => {
    const path = paths();
    let submissions = 0;
    const context = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        settleProceeds: async () => {
          submissions += 1;
          throw new MakerWalletOperationError("unknown", "timeout", {
            transactionHash: "0xa1",
          });
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
    context.receipts.set("0xa1", "REVERTED");

    await context.node.settleExpiredLocks(NOW + 91);
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "expired",
      proceedsTxHash: "0xa1",
    });
    expect(context.node.listLocks()[0]).not.toHaveProperty("settlementAttempt");
    expect(submissions).toBe(1);
  });

  it("keeps a known revert retryable when its post-revert lock refresh fails", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      getLockFailureAt: 2,
      wallet: {
        settleProceeds: async () => {
          throw new MakerWalletOperationError("reverted", "known revert");
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
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "reconcile-pending",
      priorState: "expired",
      reconciliationFailures: 1,
      reason: "rpc-unavailable",
    });
    expect(context.node.listLocks()[0]).not.toHaveProperty("settlementAttempt");
  });

  it("defers authoritative Take reconciliation when get_lock is unavailable", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        getLock: async () => {
          throw new Error("RPC unavailable");
        },
      },
    });
    const result = await quoted(context);
    const record = context.node.listLocks()[0]!;
    const target = {
      lifecycle: "v3" as const,
      rfqDigest: result.quote.rfqDigest,
      rfqFelt: result.quote.rfqFelt,
      lockId: result.quote.lockId,
      quoteDigest: record.quoteDigest!,
      tokenA: result.quote.sellToken,
      tokenB: result.quote.buyToken,
      takenA: BUCKET_MIN,
      takenB: 50_000n,
      transactionHash: "0xabc",
      authorityRevision: 1,
      idempotencyKey: "take:fixture",
    };
    await expect(
      context.node.reconcileAuthoritativeTerminal(
        {
          target,
          attemptId: target.idempotencyKey,
          authorityDigest: RFQ_ID,
          authorityRevision: target.authorityRevision,
          outcome: "settled",
          settlementTransactionHash: target.transactionHash,
        },
        NOW + 2,
      ),
    ).rejects.toThrow(/deferred.*chain reads are unavailable/i);
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "reconcile-pending",
      priorState: "open",
      reason: "rpc-unavailable",
    });
  });

  it("quarantines authenticated contradictions and journals reviewed resolution", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts);
    await quoted(context);
    const original = context.locks.get(LOCK_ID)!;
    context.locks.set(
      LOCK_ID,
      Object.freeze({ ...original, rfqId: "0xdead" }),
    );

    await context.node.recoverAfterRestart(NOW + 2);
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "quarantined",
      priorState: "open",
      reason: "authenticated-contradiction",
      quarantinedAt: NOW + 2,
    });
    const resolved = await context.node.resolveLock(
      {
        lockId: LOCK_ID,
        expectedState: "quarantined",
        reason: "two-person review confirmed the original WAL binding",
      },
      NOW + 3,
    );
    expect(resolved).toMatchObject({
      state: "reconcile-pending",
      priorState: "open",
      reconciliationFailures: 0,
      nextReconciliationAt: NOW + 3,
      reason: "operator-reviewed-resolution",
      operatorResolution: {
        expectedState: "quarantined",
        reason: "two-person review confirmed the original WAL binding",
        resolvedAt: NOW + 3,
      },
    });
    expect(JSON.parse(readFileSync(path.wal, "utf8").trim().split("\n").at(-1)!)
      .payload.locks[0].operatorResolution.reason).toMatch(/two-person review/i);

    context.locks.set(LOCK_ID, original);
    await context.node.settleExpiredLocks(NOW + 3);
    expect(context.node.listLocks()[0]!.state).toBe("open");
  });

  it("quarantines a succeeded receipt that contradicts unchanged lock flags", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        settleProceeds: async () => {
          throw new MakerWalletOperationError("unknown", "timeout", {
            transactionHash: "0xa1",
          });
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
    context.receipts.set("0xa1", "SUCCEEDED");

    await context.node.settleExpiredLocks(NOW + 91);
    expect(context.node.listLocks()[0]).toMatchObject({
      state: "quarantined",
      reason: "authenticated-contradiction",
    });
  });

  it("uses capped exponential reconciliation backoff and quarantines after twenty failures", async () => {
    const path = paths();
    const context = fixture(openStore(path.wal), path.transcripts, {
      wallet: {
        getLock: async () => {
          throw new Error("RPC unavailable");
        },
      },
    });
    await quoted(context);
    await context.node.recoverAfterRestart(NOW + 2);
    let attemptedAt = NOW + 2;
    while (context.node.listLocks()[0]!.state !== "quarantined") {
      const record = context.node.listLocks()[0]!;
      expect(record.reconciliationFailures).toBeLessThan(
        LOCK_RECONCILIATION_MAX_FAILURES,
      );
      const next = record.nextReconciliationAt!;
      expect(next - attemptedAt).toBe(
        Math.min(
          LOCK_RECONCILIATION_BACKOFF_CAP_SECONDS,
          2 ** (record.reconciliationFailures! - 1),
        ),
      );
      attemptedAt = next;
      await context.node.settleExpiredLocks(next);
    }
    const quarantined = context.node.listLocks()[0]!;
    expect(quarantined).toMatchObject({
      state: "quarantined",
      reconciliationFailures: LOCK_RECONCILIATION_MAX_FAILURES,
      reason: "reconciliation-exhausted",
    });
    expect(attemptedAt - (NOW + 2)).toBeGreaterThan(
      LOCK_RECONCILIATION_BACKOFF_CAP_SECONDS,
    );
  });

  it("reserves uncertain maxB and releases quarantined capacity after the 24-hour grace", async () => {
    const pendingPath = paths();
    const pending = fixture(
      openStore(pendingPath.wal),
      pendingPath.transcripts,
      {
        balance: 100_000n,
        wallet: {
          getLock: async () => {
            throw new Error("RPC unavailable");
          },
        },
      },
    );
    await quoted(pending);
    await pending.node.recoverAfterRestart(NOW + 2);
    await expect(
      pending.node.quoteV3(
        rfq({ rfqId: `0x${"33".repeat(32)}`, rfqFelt: "0x56" }),
        NOW + 3,
      ),
    ).resolves.toMatchObject({ refused: { code: "insufficient-inventory" } });

    const unknownPath = paths();
    const unknown = fixture(openStore(unknownPath.wal), unknownPath.transcripts, {
      balance: 100_000n,
      wallet: {
        settleProceeds: async () => {
          throw new MakerWalletOperationError("unknown", "timeout", {
            transactionHash: "0xa1",
          });
        },
      },
    });
    await quoted(unknown);
    unknown.locks.set(
      LOCK_ID,
      Object.freeze({
        ...unknown.locks.get(LOCK_ID)!,
        earnedA: BUCKET_MIN,
        remainingB: 0n,
      }),
    );
    await unknown.node.settleExpiredLocks(NOW + 90);
    await expect(
      unknown.node.quoteV3(
        rfq({
          rfqId: `0x${"44".repeat(32)}`,
          rfqFelt: "0x57",
          createdAt: NOW + 90,
          responseDeadline: NOW + 120,
          expiresAt: NOW + 180,
          lockExpiresAt: NOW + 180,
        }),
        NOW + 91,
      ),
    ).resolves.toMatchObject({ refused: { code: "insufficient-inventory" } });

    const quarantinePath = paths();
    let nextLockId = 0x76;
    const quarantined = fixture(
      openStore(quarantinePath.wal),
      quarantinePath.transcripts,
      {
        balance: 100_000n,
        randomFelt: () => `0x${(++nextLockId).toString(16)}`,
      },
    );
    await quoted(quarantined);
    const original = quarantined.locks.get(LOCK_ID)!;
    quarantined.locks.set(
      LOCK_ID,
      Object.freeze({ ...original, rfqId: "0xdead" }),
    );
    await quarantined.node.recoverAfterRestart(NOW + 2);
    const capacityReleaseAt =
      NOW + 90 + QUARANTINED_LOCK_CAPACITY_GRACE_SECONDS;
    const laterRfq = (at: number, idByte: string) =>
      rfq({
        rfqId: `0x${idByte.repeat(64)}`,
        rfqFelt: `0x${idByte}`,
        createdAt: at,
        responseDeadline: at + 30,
        expiresAt: at + 90,
        lockExpiresAt: at + 90,
      });
    await expect(
      quarantined.node.quoteV3(laterRfq(capacityReleaseAt - 1, "4"), capacityReleaseAt - 1),
    ).resolves.toMatchObject({ refused: { code: "insufficient-inventory" } });
    await expect(
      quarantined.node.quoteV3(laterRfq(capacityReleaseAt, "5"), capacityReleaseAt),
    ).resolves.toHaveProperty("quote");
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
