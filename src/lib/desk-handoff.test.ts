import { describe, expect, it } from "vitest";
import { consumeDeskHandoff, storeDeskHandoff } from "./desk-handoff";

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const ALICE = "0xa11ce";
const CHAIN = "SN_SEPOLIA";

describe("private desk session handoff", () => {
  it("normalizes, consumes once, and keeps the address out of URLs", () => {
    const storage = makeStorage();
    storeDeskHandoff(
      storage,
      "rfq",
      "0xb0b",
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    expect(
      consumeDeskHandoff(
        storage,
        "rfq",
        { account: ALICE, chainId: CHAIN },
        2_000,
      ),
    ).toMatch(/^0x0+b0b$/);
    expect(
      consumeDeskHandoff(
        storage,
        "rfq",
        { account: ALICE, chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();
  });

  it("rejects expired, wrong-purpose, wrong-scope, malformed, and future handoffs", () => {
    const expired = makeStorage();
    storeDeskHandoff(
      expired,
      "mail",
      "0xb0b",
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    expect(
      consumeDeskHandoff(
        expired,
        "mail",
        { account: ALICE, chainId: CHAIN },
        5 * 60 * 1_000 + 1_001,
      ),
    ).toBeNull();

    const wrongPurpose = makeStorage();
    storeDeskHandoff(
      wrongPurpose,
      "rfq",
      "0xb0b",
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    expect(
      consumeDeskHandoff(
        wrongPurpose,
        "mail",
        { account: ALICE, chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();

    const wrongAccount = makeStorage();
    storeDeskHandoff(
      wrongAccount,
      "rfq",
      "0xb0b",
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    expect(
      consumeDeskHandoff(
        wrongAccount,
        "rfq",
        { account: "0xb0b", chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();

    const malformed = makeStorage();
    malformed.setItem("app20/desk-handoff/v2", "not-json");
    expect(
      consumeDeskHandoff(
        malformed,
        "rfq",
        { account: ALICE, chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();

    const future = makeStorage();
    storeDeskHandoff(
      future,
      "rfq",
      "0xb0b",
      { account: ALICE, chainId: CHAIN },
      3_000,
    );
    expect(
      consumeDeskHandoff(
        future,
        "rfq",
        { account: ALICE, chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();
  });
});

describe("invoice desk handoff", () => {
  const requestId = `0x${"ab".repeat(32)}`;
  const handoff = {
    requestId: requestId.toUpperCase().replace("0X", "0x"),
    payee: "0xb0b",
    buyToken: "0x5",
    targetBuyBaseUnits: "100000000",
    memo: "  invoice 7  ",
    returnTo: "/chat",
  };

  it("stores normalized invoice terms and consumes them once for the same scope", async () => {
    const { consumeInvoiceDeskHandoff, storeInvoiceDeskHandoff } = await import(
      "./desk-handoff"
    );
    const storage = makeStorage();
    storeInvoiceDeskHandoff(
      storage,
      handoff,
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    const consumed = consumeInvoiceDeskHandoff(
      storage,
      { account: ALICE, chainId: CHAIN },
      2_000,
    );
    expect(consumed).toEqual({
      requestId,
      payee:
        "0x0000000000000000000000000000000000000000000000000000000000000b0b",
      buyToken:
        "0x0000000000000000000000000000000000000000000000000000000000000005",
      targetBuyBaseUnits: "100000000",
      memo: "invoice 7",
      returnTo: "/chat",
    });
    expect(
      consumeInvoiceDeskHandoff(
        storage,
        { account: ALICE, chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();
  });

  it("rejects other scopes, expiry, and malformed terms", async () => {
    const { consumeInvoiceDeskHandoff, storeInvoiceDeskHandoff } = await import(
      "./desk-handoff"
    );
    const storage = makeStorage();
    storeInvoiceDeskHandoff(
      storage,
      handoff,
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    expect(
      consumeInvoiceDeskHandoff(
        storage,
        { account: "0xb0b", chainId: CHAIN },
        2_000,
      ),
    ).toBeNull();
    storeInvoiceDeskHandoff(
      storage,
      handoff,
      { account: ALICE, chainId: CHAIN },
      1_000,
    );
    expect(
      consumeInvoiceDeskHandoff(
        storage,
        { account: ALICE, chainId: CHAIN },
        1_000 + 5 * 60_000 + 1,
      ),
    ).toBeNull();
    for (const bad of [
      { ...handoff, requestId: "0x12" },
      { ...handoff, targetBuyBaseUnits: "0" },
      { ...handoff, targetBuyBaseUnits: "1.5" },
      { ...handoff, returnTo: "https://evil.invalid/" },
      { ...handoff, returnTo: "//evil.invalid/" },
      { ...handoff, payee: "not-an-address" },
      { ...handoff, memo: "x".repeat(513) },
    ]) {
      expect(() =>
        storeInvoiceDeskHandoff(
          storage,
          bad,
          { account: ALICE, chainId: CHAIN },
          1_000,
        ),
      ).toThrow();
    }
  });
});
