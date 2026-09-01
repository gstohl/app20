import { describe, expect, it } from "vitest";
import {
  assertRfqQuoteScopeMatches,
  RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE,
  rfqQuoteScopeMatches,
} from "./rfq-quote-scope";

const started = Object.freeze({
  account: "0xa11ce",
  chainId: "starknet:APP20_LOCALNET",
  providerIndex: 3,
});

describe("RFQ quote request scope", () => {
  it("accepts only the exact account, chain, and provider captured at request start", () => {
    expect(rfqQuoteScopeMatches(started, started)).toBe(true);
    expect(rfqQuoteScopeMatches(started, { ...started, account: "0xb0b" })).toBe(
      false,
    );
    expect(
      rfqQuoteScopeMatches(started, {
        ...started,
        chainId: "starknet:SN_SEPOLIA",
      }),
    ).toBe(false);
    expect(
      rfqQuoteScopeMatches(started, { ...started, providerIndex: 2 }),
    ).toBe(false);
    expect(
      rfqQuoteScopeMatches(started, {
        account: undefined,
        chainId: undefined,
        providerIndex: 3,
      }),
    ).toBe(false);
  });

  it("fails with non-sensitive discard guidance after invalidation", () => {
    expect(() =>
      assertRfqQuoteScopeMatches(started, {
        ...started,
        account: "0xb0b",
      }),
    ).toThrow(RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE);
    expect(RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE).not.toMatch(
      /amount|maker id|reservation id|rfq id/i,
    );
  });
});
