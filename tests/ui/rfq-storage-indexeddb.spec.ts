import { expect, test } from "@playwright/test";

test("real IndexedDB preserves hidden RFQ tombstones across tabs and reopen", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
    const lifecycleModule = await dynamicImport(
      "/src/app/rfq/rfq-lifecycle.ts",
    );
    const databaseName = "app20-rfq-resume";
    const epoch = "indexeddb-tombstone-browser";

    const deleteDatabase = () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error("Could not reset test database."));
        request.onblocked = () =>
          reject(new Error("Test database is blocked."));
      });
    await deleteDatabase();

    const tabA = storageModule.createIndexedDbRfqStorage(epoch);
    const tabB = storageModule.createIndexedDbRfqStorage(epoch);
    let walletCalls = 0;
    let serverCalls = 0;
    const persistBeforeSink = async (
      storage: ReturnType<typeof storageModule.createIndexedDbRfqStorage>,
      row: unknown,
      sink: "wallet" | "server",
    ) => {
      await storage.save(row);
      if (sink === "wallet") walletCalls += 1;
      else serverCalls += 1;
    };
    const mustRejectForgotten = async (operation: Promise<void>) => {
      try {
        await operation;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/forgotten RFQ ID/i.test(message)) return;
        throw error;
      }
      throw new Error("A forgotten RFQ lifecycle successor was accepted.");
    };
    const paddedAccount = `0x${"0".repeat(61)}abc`;
    const sepoliaFelt = "0x534e5f5345504f4c4941";
    const record = (rfqId: string, state: string, now: number) =>
      lifecycleModule.createRfqLifecycleRecord({
        chainId: "SN_SEPOLIA",
        account: paddedAccount,
        rfqId,
        state,
        now,
      });
    const putRaw = (key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction("lifecycle", "readwrite");
          transaction.objectStore("lifecycle").put(value, key);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });

    const claimable = record("idb-forgotten-claim", "claimable", 100);
    await tabA.save(claimable);
    const settled = lifecycleModule.reviseRfqLifecycle(claimable, {
      state: "settled",
      updatedAt: 101,
    });
    const staleClaim = lifecycleModule.reviseRfqLifecycle(claimable, {
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
    const legacyClaimKey = `app20/rfq-lifecycle/v1|${epoch}|${sepoliaFelt}|0xabc|idb-forgotten-claim`;
    const legacyClaim = {
      ...settled,
      schemaRevision: "app20/rfq-lifecycle/v1",
    };
    await putRaw(legacyClaimKey, legacyClaim);
    await tabA.remove(settled);
    await mustRejectForgotten(persistBeforeSink(tabB, staleClaim, "wallet"));
    await tabA.remove(settled);

    const refundable = record("idb-forgotten-refund", "refundable", 200);
    await tabA.save(refundable);
    const refunded = lifecycleModule.reviseRfqLifecycle(refundable, {
      state: "refunded",
      updatedAt: 201,
    });
    const staleRefund = lifecycleModule.reviseRfqLifecycle(refundable, {
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
    await mustRejectForgotten(persistBeforeSink(tabB, staleRefund, "wallet"));

    const reviewing = record("idb-forgotten-cancel", "reviewing", 300);
    await tabA.save(reviewing);
    const cancelled = lifecycleModule.reviseRfqLifecycle(reviewing, {
      state: "cancelled",
      updatedAt: 301,
    });
    const staleCancel = lifecycleModule.reviseRfqLifecycle(reviewing, {
      state: "cancel-pending",
      updatedAt: 9_003,
    });
    await tabA.save(cancelled);
    await tabA.remove(cancelled);
    await mustRejectForgotten(persistBeforeSink(tabB, staleCancel, "server"));

    const clearOne = record("idb-forgotten-clear-one", "cancelled", 400);
    const clearTwo = record("idb-forgotten-clear-two", "refused", 401);
    await tabA.save(clearOne);
    await tabA.save(clearTwo);
    await tabA.clearAll(sepoliaFelt, "0xabc", [clearOne, clearTwo]);
    const visibleAfterClear = await tabA.list(
      "starknet:SN_SEPOLIA",
      paddedAccount,
    );
    const loadedAfterClear = await tabA.load(clearOne);
    await mustRejectForgotten(
      persistBeforeSink(
        tabB,
        lifecycleModule.reviseRfqLifecycle(clearOne, {
          state: "cancel-pending",
          updatedAt: 9_004,
        }),
        "server",
      ),
    );

    const reopened = storageModule.createIndexedDbRfqStorage(epoch);
    await putRaw(legacyClaimKey, legacyClaim);
    const oldV1Visible = await reopened.list(sepoliaFelt, paddedAccount);
    await mustRejectForgotten(
      persistBeforeSink(reopened, staleClaim, "wallet"),
    );
    await reopened.clearAll("SN_SEPOLIA", "0xabc", [
      settled,
      refunded,
      cancelled,
      clearOne,
      clearTwo,
    ]);

    const rawRows = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open(databaseName, 2);
      open.onerror = () =>
        reject(open.error ?? new Error("Could not reopen test database."));
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("lifecycle");
        const request = transaction.objectStore("lifecycle").getAll();
        request.onerror = () =>
          reject(request.error ?? new Error("Could not inspect tombstones."));
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => db.close();
      };
    });

    return {
      walletCalls,
      serverCalls,
      visibleAfterClear,
      loadedAfterClear,
      rawRows,
      oldV1Visible,
    };
  });

  expect(result.walletCalls).toBe(0);
  expect(result.serverCalls).toBe(0);
  expect(result.visibleAfterClear).toEqual([]);
  expect(result.loadedAfterClear).toBeUndefined();
  expect(result.oldV1Visible).toEqual([]);
  expect(result.rawRows).toHaveLength(5);
  for (const raw of result.rawRows) {
    expect(Object.keys(raw as object).sort()).toEqual([
      "recordDigest",
      "storageKey",
      "storageRevision",
      "tombstoneSchema",
    ]);
    expect(raw).toMatchObject({
      tombstoneSchema: "app20/rfq-lifecycle-tombstone/v1",
      recordDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(raw).not.toHaveProperty("settlement");
    expect(raw).not.toHaveProperty("terms");
    expect(raw).not.toHaveProperty("attempts");
  }
});

test("real IndexedDB canonicalizes every historical local-chain alias fail closed", async ({
  page,
}) => {
  // Use a stable same-origin document; the application itself may redirect
  // while its gated wallet bootstrap is absent in this focused IDB test.
  await page.route("**/__rfq_idb_test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__rfq_idb_test");
  const result = await page.evaluate(async () => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
    const lifecycleModule = await dynamicImport(
      "/src/app/rfq/rfq-lifecycle.ts",
    );
    const databaseName = "app20-rfq-resume";
    const epoch = "indexeddb-alias-migration";
    const actual = "0x51554945544c494e455f4c4f43414c";
    const historical = "0x41505032305f4c4f43414c4e4554";
    const padded = `0x${"0".repeat(61)}abc`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const storage = storageModule.createIndexedDbRfqStorage(epoch);
    await storage.list(actual, "0xabc");
    const putRaw = (key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("lifecycle", "readwrite");
          tx.objectStore("lifecycle").put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    const rawEntries = () =>
      new Promise<Array<[string, unknown]>>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("lifecycle");
          const store = tx.objectStore("lifecycle");
          const keys = store.getAllKeys();
          const values = store.getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(
              keys.result.map((key, index) => [String(key), values.result[index]]),
            );
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    const record = lifecycleModule.createRfqLifecycleRecord({
      chainId: actual,
      account: "0xabc",
      rfqId: "0x801",
      state: "cancelled",
      now: 100,
    });
    const forgotten = { ...record, rfqId: "0x802" };
    const aliasKey = `app20/rfq-lifecycle/v2|${epoch}|starknet:${historical}|${padded}|${record.rfqId}`;
    const tombstoneKey = `app20/rfq-lifecycle/v2|${epoch}|APP20_LOCALNET|${padded}|${forgotten.rfqId}`;
    await putRaw(aliasKey, {
      ...record,
      chainId: `starknet:${historical}`,
      account: padded,
    });
    await putRaw(tombstoneKey, {
      tombstoneSchema: "app20/rfq-lifecycle-tombstone/v1",
      storageKey: tombstoneKey,
      storageRevision: 9,
      recordDigest: `sha256:${"cd".repeat(32)}`,
    });
    const visible = await storage.list("starknet:APP20_LOCALNET", padded);
    const migrated = await rawEntries();

    // Simulate an old tab rewriting the pre-migration physical namespace.
    await putRaw(
      `app20/rfq-lifecycle/v2|${epoch}|QUIETLINE_LOCAL|${padded}|${forgotten.rfqId}`,
      { ...forgotten, chainId: "QUIETLINE_LOCAL", account: padded },
    );
    const loadedForgotten = await storage.load(forgotten);
    let staleSaveRejected = false;
    try {
      await storage.save(forgotten);
    } catch (error: unknown) {
      staleSaveRejected = /forgotten RFQ ID/i.test(String(error));
    }
    const finalEntries = await rawEntries();
    return {
      visible,
      migratedKeys: migrated.map(([key]) => key),
      finalEntries,
      loadedForgotten,
      staleSaveRejected,
    };
  });

  expect(result.visible).toEqual([
    expect.objectContaining({
      rfqId: "0x801",
      chainId: "0x51554945544c494e455f4c4f43414c",
      account: "0xabc",
    }),
  ]);
  expect(result.loadedForgotten).toBeUndefined();
  expect(result.staleSaveRejected).toBe(true);
  for (const key of result.migratedKeys.concat(
    result.finalEntries.map(([key]) => key),
  )) {
    expect(key).not.toContain("APP20_LOCALNET");
    expect(key).not.toContain("QUIETLINE_LOCAL");
    expect(key).not.toContain("starknet:");
    expect(key).not.toContain("0x41505032305f4c4f43414c4e4554");
  }
});


test("real IndexedDB tombstones mismatched immutable targets and numeric RFQ aliases", async ({
  page,
}) => {
  await page.route("**/__rfq_idb_scope_test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__rfq_idb_scope_test");
  const result = await page.evaluate(async () => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
    const lifecycleModule = await dynamicImport(
      "/src/app/rfq/rfq-lifecycle.ts",
    );
    const databaseName = "app20-rfq-resume";
    const epoch = "indexeddb-target-and-id-alias";
    const chainId = "0x51554945544c494e455f4c4f43414c";
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const storage = storageModule.createIndexedDbRfqStorage(epoch);
    await storage.list(chainId, "0xabc");
    const putRaw = (key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("lifecycle", "readwrite");
          tx.objectStore("lifecycle").put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    const rawEntries = () =>
      new Promise<Array<[string, unknown]>>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("lifecycle");
          const store = tx.objectStore("lifecycle");
          const keys = store.getAllKeys();
          const values = store.getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(keys.result.map((key, index) => [String(key), values.result[index]]));
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    const exact = (rfqId: string) =>
      lifecycleModule.createRfqLifecycleRecord({
        chainId,
        account: "0xabc",
        rfqId,
        state: "reviewing",
        now: 100,
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
          rfqExpiresAt: 500,
        },
        selectedQuote: {
          version: "Quote V1",
          solverId: "maker-a",
          solverKey: "key-a",
          nonce: "nonce",
          reservationId: "reservation",
          spreadBps: 1,
          pricingProvenance: "fixture",
          quotedAt: 100,
          quoteExpiresAt: 300,
          reservationExpiresAt: 400,
          buyAmount: "200",
          intentDigest: `digest-${rfqId}`,
          signature: "signature",
          quoteDigest: "quote",
          reservationFence: "1",
        },
        settlement: {
          version: "Localnet V2",
          escrowAddress: "0x30",
          dealId: rfqId,
          deadline: 500,
        },
      });
    for (const [rfqId, patch] of [
      ["0x901", { chainId: "SN_MAIN" }],
      ["0x902", { account: "0xdef" }],
    ] as const) {
      const base = exact(rfqId);
      const target = {
        ...lifecycleModule.fundingTicketAttemptTargetFromLifecycle(base),
        ...patch,
      };
      const row = {
        ...base,
        attempts: {
          funding: {
            attemptId: "attempt",
            state: "preparing",
            createdAt: 101,
            updatedAt: 101,
            target,
          },
        },
      };
      await putRaw(
        `app20/rfq-lifecycle/v2|${epoch}|APP20_LOCALNET|0xabc|${rfqId}`,
        row,
      );
    }
    const terminal = lifecycleModule.createRfqLifecycleRecord({
      chainId,
      account: "0xabc",
      rfqId: "0x1",
      state: "cancelled",
      now: 200,
    });
    await storage.save(terminal);
    await storage.remove(terminal);
    await putRaw(
      `app20/rfq-lifecycle/v2|${epoch}|QUIETLINE_LOCAL|0x0abc|0X01`,
      { ...terminal, chainId: "QUIETLINE_LOCAL", account: "0x0abc", rfqId: "0X01" },
    );

    const visible = await storage.list(chainId, "0xabc");
    const loadedAlias = await storage.load({ ...terminal, rfqId: "1" });
    let staleRejected = false;
    try {
      await storage.save({ ...terminal, rfqId: "0x01" });
    } catch (error: unknown) {
      staleRejected = /forgotten RFQ ID/i.test(String(error));
    }
    return { visible, loadedAlias, staleRejected, entries: await rawEntries() };
  });

  expect(result.visible).toEqual([]);
  expect(result.loadedAlias).toBeUndefined();
  expect(result.staleRejected).toBe(true);
  expect(result.entries).toHaveLength(3);
  for (const [, row] of result.entries)
    expect(row).toMatchObject({
      tombstoneSchema: "app20/rfq-lifecycle-tombstone/v1",
    });
});

test("real IndexedDB CAS persists an exact absent-to-canonical funding ticket transition", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
    const lifecycleModule = await dynamicImport(
      "/src/app/rfq/rfq-lifecycle.ts",
    );
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("app20-rfq-resume");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB reset was blocked."));
    });
    const storage = storageModule.createIndexedDbRfqStorage(
      "indexeddb-absent-ticket-cas",
    );
    const now = 2_000_000_000;
    const reviewing = lifecycleModule.createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "0x705",
      state: "reviewing",
      now,
      requestDigest: "digest-0x705",
      terms: {
        pairId: "SELL_BUY",
        sellSymbol: "SELL",
        sellAddress: "0x10",
        sellDecimals: 18,
        sellAmount: "100",
        buySymbol: "BUY",
        buyAddress: "0x20",
        buyDecimals: 6,
        minBuyAmount: "190",
        buyAmount: "200",
        rfqExpiresAt: now + 1_000,
      },
      selectedQuote: {
        version: "Quote V1",
        solverId: "maker-a",
        solverKey: "maker-key",
        nonce: "nonce-0x705",
        reservationId: "reservation-0x705",
        spreadBps: 1,
        pricingProvenance: "fixture",
        quotedAt: now,
        quoteExpiresAt: now + 500,
        reservationExpiresAt: now + 600,
        buyAmount: "200",
        intentDigest: "digest-0x705",
        signature: "signature",
        quoteDigest: "quote-0x705",
        reservationFence: "1",
      },
      settlement: {
        version: "Localnet V2",
        escrowAddress: "0x30",
        dealId: "0x705",
        deadline: now + 1_000,
      },
    });
    const target = {
      operation: "funding-ticket",
      chainId: reviewing.chainId,
      account: reviewing.account,
      rfqId: reviewing.rfqId,
      requestDigest: reviewing.requestDigest,
      dealId: reviewing.settlement.dealId,
      solverId: reviewing.selectedQuote.solverId,
      reservationId: reviewing.selectedQuote.reservationId,
      reservationFence: reviewing.selectedQuote.reservationFence,
      quoteDigest: reviewing.selectedQuote.quoteDigest,
      sellToken: reviewing.terms.sellAddress,
      sellAmount: reviewing.terms.sellAmount,
      buyToken: reviewing.terms.buyAddress,
      buyAmount: reviewing.selectedQuote.buyAmount,
      deadline: reviewing.settlement.deadline,
    };
    const preparing = lifecycleModule.beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "funding-attempt",
      now + 1,
      target,
    );
    await storage.save(preparing);
    const accepted = await storage.authorize(preparing);
    const immediatelyAuthorized = await storage.authorize(accepted);
    const canonicalTicket = "0x40";
    const ticketBearing = lifecycleModule.reviseRfqLifecycle(
      immediatelyAuthorized,
      {
        settlement: {
          ...immediatelyAuthorized.settlement,
          ticketAddress: canonicalTicket,
        },
        updatedAt: now + 2,
      },
    );
    await storage.save(ticketBearing);
    const reopened = lifecycleModule.restoreRfqLifecycle(
      await storage.load(ticketBearing),
      {
        chainId: ticketBearing.chainId,
        account: ticketBearing.account,
        now: now + 3,
      },
    );
    return {
      predecessorTicket: preparing.settlement.ticketAddress ?? null,
      returnedTicket: canonicalTicket,
      reopenedTicket: reopened.settlement.ticketAddress,
      attemptId: reopened.attempts.funding.attemptId,
    };
  });
  expect(result).toEqual({
    predecessorTicket: null,
    returnedTicket: "0x40",
    reopenedTicket: "0x40",
    attemptId: "funding-attempt",
  });
});
