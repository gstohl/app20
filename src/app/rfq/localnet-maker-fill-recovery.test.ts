import { describe, expect, it, vi } from "vitest";
import {
  makerFillAttemptTarget,
  retryPersistedMakerFill,
} from "./localnet-maker-fill-recovery";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  finalizeRfqLifecycleForStorage,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import {
  assertRfqStorageReplacement,
  createRfqLifecycleStorage,
  planRfqAliasMigration,
  replaceRfqWithTombstone,
  type RfqStorageBackend,
} from "./rfq-storage";
import type { LocalnetIntentTerms } from "./localnet-private-intents";

const NOW = 1_900_000_000;
const DIGEST = `0x${"11".repeat(32)}`;

function fixture() {
  const terms: LocalnetIntentTerms = Object.freeze({
    account: "0xabc",
    chainId: "0x1",
    rfqId: "0x77",
    dealId: "0x77",
    intentDigest: DIGEST,
    solverId: "maker-a",
    reservationId: `0x${"22".repeat(32)}`,
    reservationFence: "7",
    quoteDigest: `0x${"33".repeat(32)}`,
    sellToken: "0x1",
    sellAmount: 100n,
    buyToken: "0x2",
    buyAmount: 200n,
    deadline: NOW + 600,
    ticketAddress: "0xabc",
  });
  const funded = createRfqLifecycleRecord({
    chainId: terms.chainId,
    account: terms.account,
    rfqId: terms.rfqId,
    state: "funded",
    now: NOW,
    requestDigest: DIGEST,
    terms: {
      pairId: "STRK_USDC",
      sellSymbol: "STRK",
      sellAddress: terms.sellToken,
      sellDecimals: 18,
      sellAmount: terms.sellAmount.toString(),
      buySymbol: "USDC",
      buyAddress: terms.buyToken,
      buyDecimals: 6,
      minBuyAmount: "190",
      rfqExpiresAt: terms.deadline,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: terms.solverId,
      solverKey: "key-a",
      nonce: "nonce-a",
      reservationId: terms.reservationId,
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW - 10,
      quoteExpiresAt: NOW + 30,
      reservationExpiresAt: NOW + 60,
      buyAmount: terms.buyAmount.toString(),
      intentDigest: DIGEST,
      signature: "signature-a",
      reservationFence: terms.reservationFence,
      quoteDigest: terms.quoteDigest,
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: terms.dealId,
      ticketAddress: terms.ticketAddress,
      deadline: terms.deadline,
    },
  });
  return {
    terms,
    funded,
    record: beginRfqPhaseAttempt(
      funded,
      "fill",
      "fill-exact",
      NOW + 1,
      makerFillAttemptTarget(terms),
    ),
  };
}

describe("user-triggered exact maker-fill retry", () => {
  it("rejects a stale two-tab retry at the production authorization seam before the maker", async () => {
    const { funded, record } = fixture();
    const rows = new Map<string, unknown>();
    const backend: RfqStorageBackend = {
      async migrateAliases(scope) {
        const plan = planRfqAliasMigration([...rows], scope);
        for (const key of plan.deleteKeys) rows.delete(key);
        for (const [key, value] of plan.putEntries) rows.set(key, value);
      },
      async compareAndPut(key, value) {
        assertRfqStorageReplacement(rows.get(key), value);
        rows.set(key, structuredClone(finalizeRfqLifecycleForStorage(value)));
      },
      async compareAndDelete(key, legacyKey, expected) {
        rows.set(key, replaceRfqWithTombstone(rows.get(key), key, expected));
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
    const winner = createRfqLifecycleStorage(backend);
    const stale = createRfqLifecycleStorage(backend);
    await winner.save(funded);
    const settled = reviseRfqLifecycle(funded, {
      state: "settled",
      updatedAt: NOW + 2,
    });
    await winner.save(settled);
    await winner.remove(settled);
    const submitExact = vi.fn();
    await expect(
      retryPersistedMakerFill(record, {
        authorize: (candidate: RfqLifecycleRecord) => stale.authorize(candidate),
        beforeSubmit: vi.fn(),
        submitExact,
        persist: vi.fn(),
        now: () => NOW + 3,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(submitExact).not.toHaveBeenCalled();
  });

  it("reuses the same immutable attempt when the first request never reached the maker", async () => {
    const { record, terms } = fixture();
    const submitExact = vi
      .fn()
      .mockRejectedValueOnce(new Error("request never reached maker"))
      .mockResolvedValueOnce("0xfill");
    const persist = vi.fn();
    const dependencies = {
      authorize: vi.fn(async (candidate) => candidate),
      beforeSubmit: vi.fn(),
      submitExact,
      persist,
      now: () => NOW + 2,
    };
    await expect(
      retryPersistedMakerFill(record, dependencies),
    ).rejects.toThrow(/never reached/i);
    expect(persist).not.toHaveBeenCalled();

    const submitted = await retryPersistedMakerFill(record, dependencies);
    expect(submitExact.mock.calls).toEqual([
      [terms, "fill-exact"],
      [terms, "fill-exact"],
    ]);
    expect(submitted.attempts.fill).toMatchObject({
      attemptId: "fill-exact",
      state: "submitted-unknown",
      transactionHash: "0xfill",
    });
  });

  it("recovers a committed response loss without another maker effect", async () => {
    const { record } = fixture();
    let effects = 0;
    let committed = false;
    const submitExact = vi.fn(async () => {
      if (!committed) {
        committed = true;
        effects += 1;
        throw new Error("response lost after commit");
      }
      return "0xfirst-hash";
    });
    await expect(
      retryPersistedMakerFill(record, {
        authorize: vi.fn(async (candidate) => candidate),
        beforeSubmit: vi.fn(),
        submitExact,
        persist: vi.fn(),
        now: () => NOW + 2,
      }),
    ).rejects.toThrow(/response lost/i);
    const submitted = await retryPersistedMakerFill(record, {
      authorize: vi.fn(async (candidate) => candidate),
      beforeSubmit: vi.fn(),
      submitExact,
      persist: vi.fn(),
      now: () => NOW + 3,
    });
    expect(effects).toBe(1);
    expect(submitted.attempts.fill?.transactionHash).toBe("0xfirst-hash");
  });

  it("checks context immediately before the production maker endpoint", async () => {
    const { record } = fixture();
    const submitExact = vi.fn();
    await expect(
      retryPersistedMakerFill(record, {
        authorize: vi.fn(async (candidate) => candidate),
        beforeSubmit: () => {
          throw new Error("account/provider incident changed context");
        },
        submitExact,
        persist: vi.fn(),
        now: () => NOW + 2,
      }),
    ).rejects.toThrow(/incident changed context/i);
    expect(submitExact).not.toHaveBeenCalled();
  });
});
