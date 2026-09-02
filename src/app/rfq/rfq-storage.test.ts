import { describe, expect, it, vi } from "vitest";
import { LOCALNET_CHAIN_ID } from "@/utils/constants";
import {
  HISTORICAL_APP20_LOCALNET_CHAIN_ID,
  beginRfqPhaseAttempt,
  canonicalRfqChainId,
  createRfqLifecycleRecord,
  finalizeRfqLifecycleForStorage,
  restoreRfqLifecycle,
  reviseRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import {
  RFQ_STORAGE_DISCLOSURE,
  assertRfqStorageReplacement,
  createRfqLifecycleStorage,
  isRfqStorageTombstone,
  planRfqAliasMigration,
  replaceRfqWithTombstone,
  rfqStorageKey,
  waitForIndexedDbRequests,
  waitForIndexedDbTransaction,
  type RfqStorageBackend,
  type RfqStorageTombstone,
} from "./rfq-storage";

function memoryBackend() {
  const rows = new Map<string, RfqLifecycleRecord | RfqStorageTombstone>();
  const backend: RfqStorageBackend = {
    async migrateAliases(scope) {
      const plan = planRfqAliasMigration([...rows], scope);
      for (const key of plan.deleteKeys) rows.delete(key);
      for (const [key, value] of plan.putEntries)
        rows.set(
          key,
          structuredClone(value) as RfqLifecycleRecord | RfqStorageTombstone,
        );
    },
    async compareAndPut(key, value) {
      assertRfqStorageReplacement(rows.get(key), value);
      rows.set(key, structuredClone(finalizeRfqLifecycleForStorage(value)));
    },
    async compareAndDelete(key, legacyKey, expected) {
      rows.set(
        key,
        structuredClone(replaceRfqWithTombstone(rows.get(key), key, expected)),
      );
      rows.delete(legacyKey);
    },
    async get(key) {
      return rows.get(key);
    },
    async list(prefix) {
      return [...rows]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => value);
    },
    async delete(key) {
      rows.delete(key);
    },
  };
  return { backend, rows };
}

function fundingRecord(rfqId: string, now = 100): RfqLifecycleRecord {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId,
    state: "reviewing",
    now,
    requestDigest: `digest-${rfqId}`,
    terms: {
      pairId: "PAIR",
      sellSymbol: "SELL",
      sellAddress: "0x10",
      sellDecimals: 18,
      sellAmount: "100",
      buySymbol: "BUY",
      buyAddress: "0x20",
      buyDecimals: 6,
      minBuyAmount: "190",
      buyAmount: "200",
      rfqExpiresAt: now + 100,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "key-a",
      nonce: `nonce-${rfqId}`,
      reservationId: `reservation-${rfqId}`,
      spreadBps: 1,
      pricingProvenance: "fixture",
      quotedAt: now,
      quoteExpiresAt: now + 50,
      reservationExpiresAt: now + 60,
      buyAmount: "200",
      intentDigest: `digest-${rfqId}`,
      signature: "signature",
      quoteDigest: `quote-${rfqId}`,
      reservationFence: "1",
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x30",
      dealId: rfqId,
      deadline: now + 100,
    },
  });
}

function fundingTarget(record: RfqLifecycleRecord) {
  return {
    operation: "funding-ticket" as const,
    chainId: record.chainId,
    account: record.account,
    rfqId: record.rfqId,
    requestDigest: record.requestDigest!,
    dealId: record.settlement!.dealId,
    solverId: record.selectedQuote!.solverId,
    reservationId: record.selectedQuote!.reservationId,
    reservationFence: record.selectedQuote!.reservationFence!,
    quoteDigest: record.selectedQuote!.quoteDigest!,
    sellToken: record.terms!.sellAddress,
    sellAmount: record.terms!.sellAmount,
    buyToken: record.terms!.buyAddress,
    buyAmount: record.selectedQuote!.buyAmount,
    deadline: record.settlement!.deadline,
  };
}

async function persistBeforeSink(
  storage: ReturnType<typeof createRfqLifecycleStorage>,
  record: RfqLifecycleRecord,
  sink: () => void,
): Promise<void> {
  await storage.save(record);
  sink();
}

describe("RFQ lifecycle storage", () => {
  it("keys current records by schema, chain, account, and RFQ ID", async () => {
    const row = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xABC",
      rfqId: "r1",
      now: 100,
    });
    expect(rfqStorageKey(row)).toContain("app20/rfq-lifecycle/v3|0x1|0xabc|r1");
    const storage = createRfqLifecycleStorage(memoryBackend().backend);
    await storage.save(row);
    expect(await storage.load(row)).toEqual(row);
    expect(await storage.list("0x1", "0xabc")).toEqual([row]);
  });

  it("persists a live v3 secret but strips it from a backup restore", async () => {
    const source = createRfqLifecycleRecord({
      mode: "v3",
      chainId: "0x1",
      account: "0xabc",
      rfqId: "v3-secret",
      state: "reviewing",
      now: 100,
      requestDigest: `0x${"11".repeat(32)}`,
      terms: {
        pairId: "STRK_USDC",
        sellSymbol: "STRK",
        sellAddress: "0x1",
        sellDecimals: 18,
        sellAmount: "100",
        buySymbol: "USDC",
        buyAddress: "0x2",
        buyDecimals: 6,
        minBuyAmount: "190",
        buyAmount: "200",
        rfqExpiresAt: 200,
      },
      settlement: {
        version: "Localnet V3",
        escrowAddress: "0x5",
        dealId: "v3-secret",
        deadline: 200,
      },
      bucket: { min: "50", max: "100" },
      takerCommitment:
        "0x493619825a69dfc0fca6523f2714ded59c434c62d2d480d64439b96d9767006",
      takerSecret: "0x66",
      fills: [
        {
          makerId: "maker-a",
          lockId: "0x41",
          amountA: "100",
          amountB: "200",
          lockExpiresAt: 200,
        },
      ],
    });
    const live = createRfqLifecycleStorage(memoryBackend().backend);
    await expect(live.save(source)).resolves.toBeUndefined();
    expect(await live.load(source)).toMatchObject({ takerSecret: "0x66" });

    const restored = restoreRfqLifecycle(structuredClone(source), {
      chainId: source.chainId,
      account: source.account,
      now: 101,
      fromBackup: true,
    });
    expect(restored).not.toHaveProperty("takerSecret");
    const backup = createRfqLifecycleStorage(memoryBackend().backend);
    await expect(backup.save(restored)).resolves.toBeUndefined();
    expect(await backup.load(restored)).not.toHaveProperty("takerSecret");
  });

  it("canonicalizes padded accounts and named/felt-equivalent chains at every boundary", async () => {
    const { backend, rows } = memoryBackend();
    const storage = createRfqLifecycleStorage(backend);
    const padded = `0x${"0".repeat(61)}abc`;
    const sepoliaFelt = "0x534e5f5345504f4c4941";
    const row = createRfqLifecycleRecord({
      chainId: "SN_SEPOLIA",
      account: padded,
      rfqId: "canonical-scope",
      state: "cancelled",
      now: 100,
    });
    await storage.save(row);
    expect(
      await storage.load({ ...row, chainId: sepoliaFelt, account: "0xabc" }),
    ).toEqual(row);
    expect(await storage.list("starknet:SN_SEPOLIA", padded)).toEqual([row]);
    await storage.clearAll(sepoliaFelt, "0xabc", [row]);
    expect(await storage.list("SN_SEPOLIA", padded)).toEqual([]);
    expect([...rows.keys()]).toEqual([
      `app20/rfq-lifecycle/v3|${sepoliaFelt}|0xabc|canonical-scope`,
    ]);
  });

  it("maps every supported local chain name and CAIP felt to the configured wallet felt", () => {
    for (const alias of [
      LOCALNET_CHAIN_ID,
      `starknet:${LOCALNET_CHAIN_ID}`,
      "APP20_LOCALNET",
      "starknet:APP20_LOCALNET",
      "QUIETLINE_LOCAL",
      `starknet:${HISTORICAL_APP20_LOCALNET_CHAIN_ID}`,
    ])
      expect(canonicalRfqChainId(alias)).toBe(LOCALNET_CHAIN_ID);
  });

  it("atomically migrates v1/v2/tombstone physical aliases and rejects stale alias rewrites", async () => {
    const { backend, rows } = memoryBackend();
    const epoch = "alias-migration";
    const storage = createRfqLifecycleStorage(backend, epoch);
    const padded = `0x${"0".repeat(61)}abc`;
    const visible = createRfqLifecycleRecord({
      chainId: LOCALNET_CHAIN_ID,
      account: "0xabc",
      rfqId: "0x101",
      state: "cancelled",
      now: 100,
    });
    const legacy = {
      ...visible,
      schemaRevision: "app20/rfq-lifecycle/v1",
      chainId: HISTORICAL_APP20_LOCALNET_CHAIN_ID,
      account: padded,
      rfqId: "0x102",
    } as unknown as RfqLifecycleRecord;
    const forgotten = { ...visible, rfqId: "0x103" };
    const oldV2 = (chain: string, rfqId: string) =>
      `app20/rfq-lifecycle/v2|${epoch}|${chain}|${padded}|${rfqId}`;
    const oldV1 = (chain: string, rfqId: string) =>
      `app20/rfq-lifecycle/v1|${epoch}|${chain}|${padded}|${rfqId}`;
    rows.set(oldV2(`starknet:${LOCALNET_CHAIN_ID}`, visible.rfqId), {
      ...visible,
      schemaRevision: "app20/rfq-lifecycle/v2",
      chainId: `starknet:${LOCALNET_CHAIN_ID}`,
      account: padded,
    } as unknown as RfqLifecycleRecord);
    rows.set(oldV1(HISTORICAL_APP20_LOCALNET_CHAIN_ID, legacy.rfqId), legacy);
    const oldForgottenKey = oldV2("APP20_LOCALNET", forgotten.rfqId);
    rows.set(oldForgottenKey, {
      tombstoneSchema: "app20/rfq-lifecycle-tombstone/v1",
      storageKey: oldForgottenKey,
      storageRevision: 8,
      recordDigest: `sha256:${"ab".repeat(32)}`,
    });
    rows.set(oldV2("QUIETLINE_LOCAL", forgotten.rfqId), {
      ...forgotten,
      schemaRevision: "app20/rfq-lifecycle/v2",
      chainId: "QUIETLINE_LOCAL",
      account: padded,
    } as unknown as RfqLifecycleRecord);

    expect(await storage.list("starknet:APP20_LOCALNET", padded)).toEqual([
      expect.objectContaining({
        rfqId: "0x101",
        chainId: LOCALNET_CHAIN_ID,
        account: "0xabc",
      }),
      expect.objectContaining({
        rfqId: "0x102",
        chainId: LOCALNET_CHAIN_ID,
        account: "0xabc",
      }),
    ]);
    expect(
      [...rows.keys()].every(
        (key) =>
          !key.includes("APP20_LOCALNET") &&
          !key.includes("QUIETLINE_LOCAL") &&
          !key.includes("starknet:") &&
          !key.includes(HISTORICAL_APP20_LOCALNET_CHAIN_ID) &&
          !key.includes(padded),
      ),
    ).toBe(true);

    // A stale historical client rewriting after migration is purged again and
    // cannot fork the canonical tombstone/CAS authority.
    rows.set(oldV2(HISTORICAL_APP20_LOCALNET_CHAIN_ID, forgotten.rfqId), {
      ...forgotten,
      schemaRevision: "app20/rfq-lifecycle/v2",
      chainId: HISTORICAL_APP20_LOCALNET_CHAIN_ID,
      account: padded,
    } as unknown as RfqLifecycleRecord);
    expect(await storage.load(forgotten)).toBeUndefined();
    expect(
      rows.has(oldV2(HISTORICAL_APP20_LOCALNET_CHAIN_ID, forgotten.rfqId)),
    ).toBe(false);
    await expect(storage.save(forgotten)).rejects.toThrow(/forgotten RFQ ID/i);

    await storage.removeLegacy({
      chainId: `starknet:${LOCALNET_CHAIN_ID}`,
      account: padded,
      rfqId: legacy.rfqId,
    });
    await storage.clearAll("APP20_LOCALNET", padded, [visible]);
    expect(await storage.list(LOCALNET_CHAIN_ID, "0xabc")).toEqual([]);
    await storage.removeLegacy({
      chainId: `starknet:${LOCALNET_CHAIN_ID}`,
      account: padded,
      rfqId: legacy.rfqId,
    });
    expect(await storage.list("QUIETLINE_LOCAL", "0xabc")).toEqual([]);
  });

  it("groups every numeric local RFQ spelling under one tombstone authority", async () => {
    const { backend, rows } = memoryBackend();
    const epoch = "felt-id-aliases";
    const tabA = createRfqLifecycleStorage(backend, epoch);
    const tabB = createRfqLifecycleStorage(backend, epoch);
    const terminal = createRfqLifecycleRecord({
      chainId: LOCALNET_CHAIN_ID,
      account: "0xabc",
      rfqId: "0x1",
      state: "cancelled",
      now: 100,
    });
    await tabA.save(terminal);
    await tabA.remove(terminal);
    const paddedKey = `app20/rfq-lifecycle/v2|${epoch}|QUIETLINE_LOCAL|0x0abc|0X01`;
    rows.set(paddedKey, {
      ...terminal,
      chainId: "QUIETLINE_LOCAL",
      account: "0x0abc",
      rfqId: "0X01",
    });

    expect(await tabB.load({ ...terminal, rfqId: "1" })).toBeUndefined();
    expect(rows.has(paddedKey)).toBe(false);
    expect([...rows.values()].filter(isRfqStorageTombstone)).toHaveLength(1);
    await expect(tabB.save({ ...terminal, rfqId: "0x01" })).rejects.toThrow(
      /forgotten RFQ ID/i,
    );
    await expect(tabB.authorize({ ...terminal, rfqId: "01" })).rejects.toThrow(
      /forgotten RFQ ID/i,
    );
    expect(await tabB.list(LOCALNET_CHAIN_ID, "0xabc")).toEqual([]);
  });

  it.each([
    ["chain", { chainId: "SN_MAIN" }],
    ["account", { account: "0xdef" }],
  ])(
    "tombstones a local alias whose immutable funding target contradicts its %s scope",
    async (_label, targetPatch) => {
      const { backend, rows } = memoryBackend();
      const epoch = "mismatched-target-scope";
      const storage = createRfqLifecycleStorage(backend, epoch);
      const base = fundingRecord("0x501");
      const local = {
        ...base,
        chainId: LOCALNET_CHAIN_ID,
        attempts: {
          funding: {
            attemptId: "attempt",
            state: "preparing",
            createdAt: 101,
            updatedAt: 101,
            target: {
              ...fundingTarget(base),
              chainId: LOCALNET_CHAIN_ID,
              ...targetPatch,
            },
          },
        },
      } as RfqLifecycleRecord;
      const aliasKey = `app20/rfq-lifecycle/v2|${epoch}|APP20_LOCALNET|0xabc|0x0501`;
      rows.set(aliasKey, { ...local, rfqId: "0x0501" });

      expect(await storage.list(LOCALNET_CHAIN_ID, "0xabc")).toEqual([]);
      const stored = [...rows.values()];
      expect(stored).toHaveLength(1);
      expect(isRfqStorageTombstone(stored[0])).toBe(true);
      const clean = {
        ...local,
        attempts: {
          funding: {
            ...local.attempts.funding!,
            target: {
              ...local.attempts.funding!.target!,
              chainId: LOCALNET_CHAIN_ID,
              account: "0xabc",
            },
          },
        },
      } as RfqLifecycleRecord;
      await expect(storage.save(clean)).rejects.toThrow(/forgotten RFQ ID/i);
    },
  );

  it("isolates browser records by durable runtime epoch", async () => {
    const { backend } = memoryBackend();
    const epochA = createRfqLifecycleStorage(backend, "epoch-a");
    const epochB = createRfqLifecycleStorage(backend, "epoch-b");
    const row = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "epoch-bound",
      now: 100,
    });
    await epochA.save(row);
    expect(await epochA.list("0x1", "0xabc")).toEqual([row]);
    expect(await epochB.list("0x1", "0xabc")).toEqual([]);
    expect(rfqStorageKey(row, "epoch-a")).toContain(
      "app20/rfq-lifecycle/v3|epoch-a|0x1|0xabc|epoch-bound",
    );
  });

  it("rejects a stale tab that would erase another tab's unresolved funding lease", () => {
    const base = fundingRecord("race");
    const winner = beginRfqPhaseAttempt(
      base,
      "funding",
      "attempt-a",
      101,
      fundingTarget(base),
    );
    const staleSibling = beginRfqPhaseAttempt(
      base,
      "funding",
      "attempt-b",
      101,
      fundingTarget(base),
    );
    expect(() => assertRfqStorageReplacement(winner, staleSibling)).toThrow(
      /stale lifecycle snapshot|exact predecessor/i,
    );
    expect(() => assertRfqStorageReplacement(winner, winner)).not.toThrow();

    const boundaryUnknown = updateRfqPhaseAttempt(
      winner,
      "funding",
      "wallet-boundary-unknown",
      102,
      {
        walletBoundary: "entered",
        observation: "wallet boundary entered without a hash",
      },
    );
    expect(() =>
      assertRfqStorageReplacement(boundaryUnknown, {
        ...staleSibling,
        updatedAt: 103,
      }),
    ).toThrow(/stale lifecycle snapshot|exact predecessor/i);
  });

  it("accepts a post-reload settlement whose ticket field only moved in canonical parser order", () => {
    const draft = fundingRecord("reload-settlement-order");
    const preparing = beginRfqPhaseAttempt(
      draft,
      "funding",
      "fund-reload",
      101,
      fundingTarget(draft),
    );
    const prior = finalizeRfqLifecycleForStorage(
      reviseRfqLifecycle(preparing, {
        settlement: {
          ...preparing.settlement!,
          ticketAddress: "0x44",
        },
        updatedAt: 101,
      }),
    );
    const restored = restoreRfqLifecycle(prior, {
      chainId: prior.chainId,
      account: prior.account,
      now: 102,
    });
    const successor = reviseRfqLifecycle(restored, { updatedAt: 102 });

    expect(Object.keys(prior.settlement!)).toEqual([
      "version",
      "escrowAddress",
      "dealId",
      "deadline",
      "ticketAddress",
    ]);
    expect(Object.keys(successor.settlement!)).toEqual([
      "version",
      "escrowAddress",
      "dealId",
      "ticketAddress",
      "deadline",
    ]);
    expect(successor.settlement).toEqual(prior.settlement);
    expect(() => assertRfqStorageReplacement(prior, successor)).not.toThrow();
  });

  it.each([
    ["escrow address", { escrowAddress: "0x31" }],
    ["deal ID", { dealId: "forged-deal" }],
    ["ticket address", { ticketAddress: "0x45" }],
    ["deadline", { deadline: 999 }],
  ])("still rejects a forged settlement swap of its %s", (_label, patch) => {
    const draft = fundingRecord("forged-settlement-swap");
    const preparing = beginRfqPhaseAttempt(
      draft,
      "funding",
      "fund-forgery",
      101,
      fundingTarget(draft),
    );
    const prior = finalizeRfqLifecycleForStorage(
      reviseRfqLifecycle(preparing, {
        settlement: { ...preparing.settlement!, ticketAddress: "0x44" },
        updatedAt: 101,
      }),
    );
    const forged = reviseRfqLifecycle(prior, {
      settlement: { ...prior.settlement!, ...patch },
      updatedAt: 102,
    });

    expect(() => assertRfqStorageReplacement(prior, forged)).toThrow(
      /replacement of settlement identity/i,
    );
  });

  it("atomically rejects funded A versus stale cancel B across tabs despite a newer timestamp", async () => {
    const { backend } = memoryBackend();
    const tabA = createRfqLifecycleStorage(backend);
    const tabB = createRfqLifecycleStorage(backend);
    const base = fundingRecord("funded-race");
    await tabA.save(base);
    const funded = reviseRfqLifecycle(base, {
      state: "funded",
      updatedAt: 101,
      settlement: {
        version: "Localnet V2",
        escrowAddress: "0x30",
        dealId: "funded-race",
        deadline: 200,
      },
      attempts: {
        funding: {
          attemptId: "fund-a",
          state: "confirmed",
          createdAt: 100,
          updatedAt: 101,
          transactionHash: "0xfeed",
          observation: "status 1",
          target: fundingTarget(base),
        },
      },
      transactionHash: "0xfeed",
      latestObservation: {
        source: "localnet-deal",
        dealId: "funded-race",
        escrowAddress: "0x30",
        status: 1,
        stage: "funded",
        observedAt: 101,
      },
    });
    const staleCancel = reviseRfqLifecycle(base, {
      state: "cancel-pending",
      updatedAt: 9_999,
    });
    await tabA.save(funded);
    await expect(tabB.save(staleCancel)).rejects.toThrow(/exact predecessor/i);
    expect(await tabA.load(base)).toEqual(
      finalizeRfqLifecycleForStorage(funded),
    );
  });

  it("rejects settled A versus stale claim/cancel siblings and same-attempt downgrade", async () => {
    const { backend } = memoryBackend();
    const storage = createRfqLifecycleStorage(backend);
    const base = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "terminal-race",
      state: "funded",
      now: 100,
    });
    await storage.save(base);
    const settled = reviseRfqLifecycle(base, {
      state: "settled",
      updatedAt: 102,
      attempts: {
        claim: {
          attemptId: "claim-a",
          state: "confirmed",
          createdAt: 101,
          updatedAt: 102,
          transactionHash: "0xclaim",
          observation: "status 3",
        },
      },
      latestObservation: {
        source: "localnet-deal",
        dealId: "terminal-race",
        escrowAddress: "0x3",
        status: 3,
        stage: "settled",
        observedAt: 102,
      },
    });
    const staleClaim = reviseRfqLifecycle(base, {
      state: "claimable",
      updatedAt: 200,
      attempts: {
        claim: {
          attemptId: "claim-b",
          state: "preparing",
          createdAt: 200,
          updatedAt: 200,
        },
      },
    });
    const staleCancel = reviseRfqLifecycle(base, {
      state: "cancel-pending",
      updatedAt: 201,
    });
    await storage.save(settled);
    await expect(storage.save(staleClaim)).rejects.toThrow(
      /exact predecessor/i,
    );
    await expect(storage.save(staleCancel)).rejects.toThrow(
      /exact predecessor/i,
    );

    const downgrade = reviseRfqLifecycle(settled, {
      state: "claimable",
      updatedAt: 300,
      attempts: {
        claim: {
          ...settled.attempts.claim!,
          state: "preparing",
          updatedAt: 300,
        },
      },
      latestObservation: undefined,
    });
    await expect(storage.save(downgrade)).rejects.toThrow(
      /observation|attempt|terminal/i,
    );
  });

  it("serializes concurrent siblings, survives storage recreation, and permits exact idempotent saves", async () => {
    const { backend } = memoryBackend();
    const firstProcess = createRfqLifecycleStorage(backend);
    const base = fundingRecord("restart-cas");
    await firstProcess.save(base);
    const siblingA = beginRfqPhaseAttempt(
      base,
      "funding",
      "attempt-a",
      101,
      fundingTarget(base),
    );
    const siblingB = beginRfqPhaseAttempt(
      base,
      "funding",
      "attempt-b",
      102,
      fundingTarget(base),
    );
    const results = await Promise.allSettled([
      firstProcess.save(siblingA),
      firstProcess.save(siblingB),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const restarted = createRfqLifecycleStorage(backend);
    const durable = (await restarted.load(base)) as RfqLifecycleRecord;
    expect(durable.storageRevision).toBe(1);
    expect(durable.storagePredecessorRevision).toBeUndefined();
    await expect(restarted.save(durable)).resolves.toBeUndefined();
    expect(await restarted.load(base)).toEqual(durable);
  });

  it("rejects stale terminal removal after a concurrent evidence-bearing replacement", async () => {
    const { backend } = memoryBackend();
    const staleTab = createRfqLifecycleStorage(backend);
    const winnerTab = createRfqLifecycleStorage(backend);
    const terminal = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "remove-race",
      state: "cancelled",
      now: 100,
    });
    await staleTab.save(terminal);
    const newer = reviseRfqLifecycle(terminal, {
      state: "quarantined",
      updatedAt: 101,
      reason: "new terminal evidence retained",
    });
    await winnerTab.save(newer);
    await expect(staleTab.remove(terminal)).rejects.toThrow(/stale removal/i);
    expect(await winnerTab.load(terminal)).toEqual(
      finalizeRfqLifecycleForStorage(newer),
    );
  });

  it("does not let a forged browser authority revision fence a verifier successor", () => {
    const prior = {
      ...createRfqLifecycleRecord({
        chainId: "0x1",
        account: "0xabc",
        rfqId: "authority-high-water",
        state: "cancelled",
        now: 100,
      }),
      evidenceAuthority: {
        status: "authoritative" as const,
        label: "forged",
        revision: Number.MAX_SAFE_INTEGER,
        observedAt: 100,
      },
    };
    const verifierSuccessor = reviseRfqLifecycle(prior, {
      evidenceAuthority: {
        status: "authoritative",
        label: "runtime-bound answer",
        revision: 1,
        observedAt: 101,
      },
      updatedAt: 101,
    });
    expect(() =>
      assertRfqStorageReplacement(prior, verifierSuccessor),
    ).not.toThrow();
    expect(() =>
      assertRfqStorageReplacement(
        prior,
        reviseRfqLifecycle(prior, {
          evidenceAuthority: {
            status: "local-non-authoritative",
            label: "local",
            revision: 0,
            observedAt: 101,
          },
          updatedAt: 101,
        }),
      ),
    ).toThrow(/unresolved authority evidence/i);
  });

  it("refuses direct deletion of terminal browser history with unresolved authority", async () => {
    const { backend } = memoryBackend();
    const storage = createRfqLifecycleStorage(backend);
    const terminal = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "unresolved-terminal",
      state: "cancelled",
      now: 100,
    });
    const unresolved = {
      ...terminal,
      evidenceAuthority: {
        status: "disagreement" as const,
        label: "Reader disagreement",
        revision: 4,
        observedAt: 101,
      },
    };
    await storage.save(unresolved);
    await expect(storage.remove(unresolved)).rejects.toThrow(
      /unresolved or value-bearing/i,
    );
    expect(await storage.load(unresolved)).toEqual(
      finalizeRfqLifecycleForStorage(unresolved),
    );
  });

  it("refuses sensitive fields while allowing explicitly disclosed exact terms", async () => {
    const storage = createRfqLifecycleStorage(memoryBackend().backend);
    const row = {
      ...createRfqLifecycleRecord({
        chainId: "0x1",
        account: "0xabc",
        rfqId: "r1",
        now: 100,
      }),
      rawBalance: "5",
    };
    await expect(storage.save(row as RfqLifecycleRecord)).rejects.toThrow(
      /sensitive field/i,
    );
    expect(RFQ_STORAGE_DISCLOSURE).toMatch(/Exact RFQ terms/);
    expect(RFQ_STORAGE_DISCLOSURE).toMatch(/never stored/i);
  });

  it("durably tombstones forgotten IDs across two memory instances before wallet/server sinks", async () => {
    const { backend, rows } = memoryBackend();
    const tabA = createRfqLifecycleStorage(backend, "tombstone-memory");
    const tabB = createRfqLifecycleStorage(backend, "tombstone-memory");
    const wallet = vi.fn();
    const server = vi.fn();
    const record = (
      rfqId: string,
      state: RfqLifecycleRecord["state"],
      now: number,
    ) =>
      createRfqLifecycleRecord({
        chainId: "0x1",
        account: "0xabc",
        rfqId,
        state,
        now,
      });

    const claimable = record("forgotten-claim", "claimable", 100);
    await tabA.save(claimable);
    const settled = reviseRfqLifecycle(claimable, {
      state: "settled",
      updatedAt: 101,
    });
    const staleClaim = reviseRfqLifecycle(claimable, {
      state: "claimable",
      updatedAt: 9_001,
      attempts: {
        claim: {
          attemptId: "stale-claim",
          state: "preparing",
          createdAt: 9_001,
          updatedAt: 9_001,
        },
      },
    });
    await tabA.save(settled);
    await tabA.remove(settled);
    await expect(persistBeforeSink(tabB, staleClaim, wallet)).rejects.toThrow(
      /forgotten RFQ ID/i,
    );
    await expect(tabA.remove(settled)).resolves.toBeUndefined();

    const refundable = record("forgotten-refund", "refundable", 200);
    await tabA.save(refundable);
    const refunded = reviseRfqLifecycle(refundable, {
      state: "refunded",
      updatedAt: 201,
    });
    const staleRefund = reviseRfqLifecycle(refundable, {
      state: "refundable",
      updatedAt: 9_002,
      attempts: {
        refund: {
          attemptId: "stale-refund",
          state: "preparing",
          createdAt: 9_002,
          updatedAt: 9_002,
        },
      },
    });
    await tabA.save(refunded);
    await tabA.remove(refunded);
    await expect(persistBeforeSink(tabB, staleRefund, wallet)).rejects.toThrow(
      /forgotten RFQ ID/i,
    );

    const reviewing = record("forgotten-cancel", "reviewing", 300);
    await tabA.save(reviewing);
    const cancelled = reviseRfqLifecycle(reviewing, {
      state: "cancelled",
      updatedAt: 301,
    });
    const staleCancel = reviseRfqLifecycle(reviewing, {
      state: "cancel-pending",
      updatedAt: 9_003,
    });
    await tabA.save(cancelled);
    await tabA.remove(cancelled);
    await expect(persistBeforeSink(tabB, staleCancel, server)).rejects.toThrow(
      /forgotten RFQ ID/i,
    );

    const clearOne = record("forgotten-clear-one", "cancelled", 400);
    const clearTwo = record("forgotten-clear-two", "refused", 401);
    await tabA.save(clearOne);
    await tabA.save(clearTwo);
    await tabA.clearAll("0x1", "0xabc", [clearOne, clearTwo]);
    expect(await tabA.list("0x1", "0xabc")).toEqual([]);
    expect(await tabA.load(clearOne)).toBeUndefined();
    await expect(
      persistBeforeSink(
        tabB,
        reviseRfqLifecycle(clearOne, {
          state: "cancel-pending",
          updatedAt: 9_004,
        }),
        server,
      ),
    ).rejects.toThrow(/forgotten RFQ ID/i);

    const reopened = createRfqLifecycleStorage(backend, "tombstone-memory");
    await expect(
      persistBeforeSink(reopened, staleClaim, wallet),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    await expect(
      reopened.clearAll("0x1", "0xabc", [
        settled,
        refunded,
        cancelled,
        clearOne,
        clearTwo,
      ]),
    ).resolves.toBeUndefined();

    const tombstones = [...rows.values()].filter(isRfqStorageTombstone);
    expect(tombstones).toHaveLength(5);
    for (const tombstone of tombstones) {
      expect(Object.keys(tombstone).sort()).toEqual([
        "recordDigest",
        "storageKey",
        "storageRevision",
        "tombstoneSchema",
      ]);
      expect(tombstone.recordDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(tombstone).not.toHaveProperty("settlement");
      expect(tombstone).not.toHaveProperty("terms");
      expect(tombstone).not.toHaveProperty("attempts");
    }
    expect(wallet).not.toHaveBeenCalled();
    expect(server).not.toHaveBeenCalled();
  });

  it("deletes one visible record or clears every visible v1/v2 record while retaining v2 tombstones", async () => {
    const { backend, rows } = memoryBackend();
    const storage = createRfqLifecycleStorage(backend);
    const one = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "r1",
      state: "cancelled",
      now: 100,
    });
    const two = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "r2",
      state: "cancelled",
      now: 101,
    });
    const other = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xdef",
      rfqId: "r3",
      state: "cancelled",
      now: 102,
    });
    await Promise.all([
      storage.save(one),
      storage.save(two),
      storage.save(other),
    ]);
    const legacyKey = "app20/rfq-lifecycle/v1|0x1|0xabc|r1";
    rows.set(legacyKey, one);
    await storage.remove(one);
    expect(isRfqStorageTombstone(rows.get(rfqStorageKey(one)))).toBe(true);
    expect(rows.has(legacyKey)).toBe(false);
    expect(await storage.load(one)).toBeUndefined();
    expect(await storage.list("0x1", "0xabc")).toEqual([two]);
    await storage.clearAll("0x1", "0xabc", [two]);
    expect(await storage.list("0x1", "0xabc")).toEqual([]);
    expect(await storage.list("0x1", "0xdef")).toEqual([other]);
  });

  it("makes a tombstone authoritative over partial migration and old-v1 rewrites", async () => {
    const { backend, rows } = memoryBackend();
    const storage = createRfqLifecycleStorage(backend);
    const current = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "same-id",
      state: "cancelled",
      now: 200,
    });
    const legacyKey = "app20/rfq-lifecycle/v1|0x1|0xabc|same-id";
    const legacy = {
      ...current,
      schemaRevision: "app20/rfq-lifecycle/v1",
    } as unknown as RfqLifecycleRecord;
    await storage.save(current);
    rows.set(legacyKey, legacy);
    expect(await storage.list("0x1", "0xabc")).toEqual([current]);
    expect(rows.has(legacyKey)).toBe(false);

    rows.set(legacyKey, legacy);
    await storage.remove(current);
    expect(rows.has(legacyKey)).toBe(false);
    rows.set(legacyKey, legacy);
    const deleteLegacy = backend.delete;
    backend.delete = async () => {
      throw new Error("legacy delete failed");
    };
    expect(await storage.list("0x1", "0xabc")).toEqual([]);
    expect(rows.has(legacyKey)).toBe(true);
    backend.delete = deleteLegacy;
    expect(await storage.list("0x1", "0xabc")).toEqual([]);
    expect(rows.has(legacyKey)).toBe(false);
    const reopened = createRfqLifecycleStorage(backend);
    expect(await reopened.load(current)).toBeUndefined();
    expect(await reopened.list("0x1", "0xabc")).toEqual([]);
    await expect(reopened.save(current)).rejects.toThrow(/forgotten RFQ ID/i);
    expect([...rows.values()].filter(isRfqStorageTombstone)).toHaveLength(1);
  });

  it("propagates storage failures instead of presenting an empty successful list", async () => {
    const backend = memoryBackend().backend;
    backend.list = async () => {
      throw new Error("IndexedDB unavailable");
    };
    const storage = createRfqLifecycleStorage(backend);
    await expect(storage.list("0x1", "0xabc")).rejects.toThrow(/unavailable/i);
  });

  it("does not resolve a write request until transaction commit and rejects a late abort", async () => {
    const request = {
      result: undefined,
      error: null,
    } as unknown as IDBRequest<void>;
    const transaction = { error: null } as unknown as IDBTransaction;
    let resolved = false;
    const committed = waitForIndexedDbTransaction(transaction, request).then(
      () => {
        resolved = true;
      },
    );
    request.onsuccess?.({} as Event);
    await Promise.resolve();
    expect(resolved).toBe(false);
    (transaction as unknown as { error: DOMException }).error =
      new DOMException("late quota abort", "AbortError");
    transaction.onabort?.({} as Event);
    await expect(committed).rejects.toThrow(/late quota abort/i);

    const secondRequest = {
      result: "ok",
      error: null,
    } as unknown as IDBRequest<string>;
    const secondTransaction = { error: null } as unknown as IDBTransaction;
    const second = waitForIndexedDbTransaction(
      secondTransaction,
      secondRequest,
    );
    secondRequest.onsuccess?.({} as Event);
    secondTransaction.oncomplete?.({} as Event);
    await expect(second).resolves.toBe("ok");
  });

  it("does not replace a compare failure with a later abort rejection", async () => {
    const request = {
      result: undefined,
      error: null,
    } as unknown as IDBRequest<void>;
    const transaction = { error: null } as unknown as IDBTransaction;
    const pending = waitForIndexedDbRequests(transaction, [request]);
    request.onsuccess?.({} as Event);
    await Promise.resolve();
    transaction.oncomplete?.({} as Event);
    await expect(pending).resolves.toEqual([undefined]);
  });

  it("persists hash-only v1 migration evidence as a v2 quarantine row", async () => {
    const storage = createRfqLifecycleStorage(memoryBackend().backend);
    const restored = restoreRfqLifecycle(
      {
        schemaRevision: "app20/rfq-lifecycle/v1",
        authority: "Local resume record · not settlement authority",
        chainId: "0x1",
        account: "0xabc",
        rfqId: "legacy-hash",
        state: "submission-unknown",
        updatedAt: 99,
        transactionHash: "0xfeed",
      },
      { chainId: "0x1", account: "0xabc", now: 100 },
    );
    await expect(storage.save(restored)).resolves.toBeUndefined();
    const loaded = await storage.load(restored);
    const roundTrip = restoreRfqLifecycle(loaded, {
      chainId: "0x1",
      account: "0xabc",
      now: 101,
    });
    expect(roundTrip).toMatchObject({
      state: "quarantined",
      transactionHash: "0xfeed",
      attempts: {
        funding: { state: "submitted-unknown", transactionHash: "0xfeed" },
      },
    });
  });
});
