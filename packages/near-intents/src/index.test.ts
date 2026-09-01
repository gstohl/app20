import type { CrossChainIntentV1 } from "@app20/domain";
import { describe, expect, it, vi } from "vitest";
import {
  DryOnlyNearIntentsClient,
  ONE_CLICK_HAS_TESTNET,
  assertDryQuoteRequest,
  assertDryQuoteSatisfiesIntent,
  mapCrossChainIntentToDryQuote,
  type DryQuoteRequest,
  type OneClickQuoteVerifier,
  type OneClickTransport,
  type QuoteVerificationEvidence,
  type StrictDryQuoteResponse,
} from "./index";

function request(overrides: Partial<DryQuoteRequest> = {}): DryQuoteRequest {
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: "nep141:starknet.omft.near",
    depositType: "ORIGIN_CHAIN",
    destinationAsset: "nep141:wrap.near",
    amount: "1000000000000000000",
    refundTo: "0x123",
    refundType: "ORIGIN_CHAIN",
    recipient: "alice.near",
    recipientType: "DESTINATION_CHAIN",
    deadline: "2030-01-01T00:10:00.000Z",
    confidentiality: "public",
    ...overrides,
  };
}

function response(
  quoteRequest: Readonly<DryQuoteRequest> = request(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    correlationId: "correlation-fixture",
    timestamp: "2030-01-01T00:00:01.000Z",
    signature: "signature-fixture",
    quoteRequest,
    quote: {
      amountIn: quoteRequest.amount,
      amountInFormatted: "1",
      amountInUsd: "1.00",
      minAmountIn: quoteRequest.amount,
      amountOut: "1000000",
      amountOutFormatted: "1",
      amountOutUsd: "1.00",
      minAmountOut: "990000",
      timeEstimate: 30,
    },
    ...overrides,
  };
}

const verification: QuoteVerificationEvidence = {
  verified: true,
  algorithm: "Ed25519",
  keyId: "near-1click-production-key-v1",
  signedPayloadDigest:
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

function client(
  rawResponse: unknown,
  quoteVerification: unknown = verification,
) {
  const requestQuote = vi.fn(
    async (_request: Readonly<DryQuoteRequest>, _signal?: AbortSignal) =>
      rawResponse,
  );
  const transport: OneClickTransport = {
    listTokens: async () => [],
    requestQuote,
  };
  const verify = vi.fn(
    async () => quoteVerification as QuoteVerificationEvidence | null,
  );
  const verifier: OneClickQuoteVerifier = { verify };
  return {
    client: new DryOnlyNearIntentsClient(transport, verifier),
    requestQuote,
    verify,
  };
}

function intent(
  overrides: Partial<CrossChainIntentV1> = {},
): CrossChainIntentV1 {
  return {
    version: 1,
    intentId: "intent-0123456789abcdef0123456789abcdef",
    revision: 0,
    kind: "cross-chain",
    sourceAccount: {
      id: "starknet:mainnet:0x123",
      chainId: "starknet:SN_MAIN",
      address: "0x123",
      signer: "ready",
      custody: "user",
      capabilities: ["strk20"],
      policyMode: "advisory",
    },
    destinationAccount: { chainId: "near:mainnet", address: "alice.near" },
    refundAccount: { chainId: "starknet:SN_MAIN", address: "0x123" },
    sourceAsset: {
      chainId: "starknet:SN_MAIN",
      assetId: "nep141:starknet.omft.near",
      decimals: 18,
    },
    destinationAsset: {
      chainId: "near:mainnet",
      assetId: "nep141:wrap.near",
      decimals: 24,
    },
    amount: "1000000000000000000",
    minimumOutput: "990000",
    maximumFee: "1000",
    slippageBps: 100,
    deadline: "2030-01-01T00:10:00.000Z",
    providerId: "near-intents:1click",
    swapMode: "exact-input",
    fundingMode: "origin-chain",
    deliveryMode: "destination-chain",
    refundMode: "origin-chain",
    privacyMode: "public",
    disclosedTo: [
      "intents-provider",
      "solver",
      "source-chain",
      "destination-chain",
    ],
    createdAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:05:00.000Z",
    ...overrides,
  };
}

describe("APP20 dry-only NEAR Intents connector", () => {
  it("records that no Intents testnet exists", () => {
    expect(ONE_CLICK_HAS_TESTNET).toBe(false);
  });

  it("maps one canonical intent exactly to the pinned 1Click dry request", () => {
    expect(mapCrossChainIntentToDryQuote(intent())).toEqual(request());
  });

  it("accepts a strict response with structured provenance only after preflight", async () => {
    const fixture = response();
    const setup = client(fixture);
    const order: string[] = [];
    setup.requestQuote.mockImplementationOnce(async () => {
      order.push("transport");
      return fixture;
    });
    const preflight = vi.fn(async () => {
      order.push("preflight:start");
      await Promise.resolve();
      order.push("preflight:end");
    });
    await expect(setup.client.quote(request(), preflight)).resolves.toEqual({
      verified: true,
      request: request(),
      response: fixture,
      verification,
    });
    expect(order).toEqual(["preflight:start", "preflight:end", "transport"]);
    expect(preflight).toHaveBeenCalledWith(request());
    expect(setup.requestQuote).toHaveBeenCalledWith(request(), undefined);
    expect(setup.verify).toHaveBeenCalledWith(request(), fixture);
  });

  it("does not contact the provider when policy preflight denies", async () => {
    const setup = client(response());
    await expect(
      setup.client.quote(request(), async () => {
        throw new Error("policy denied");
      }),
    ).rejects.toThrow(/policy denied/i);
    expect(setup.requestQuote).not.toHaveBeenCalled();
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("validates and snapshots the request before asynchronous preflight", async () => {
    const candidate = request();
    let transported: Readonly<DryQuoteRequest> | undefined;
    const transport: OneClickTransport = {
      listTokens: async () => [],
      requestQuote: vi.fn(async (reviewed) => {
        transported = reviewed;
        return response(reviewed);
      }),
    };
    const verifier: OneClickQuoteVerifier = {
      verify: async () => verification,
    };
    const connector = new DryOnlyNearIntentsClient(transport, verifier);
    await connector.quote(candidate, async (reviewed) => {
      expect(Object.isFrozen(reviewed)).toBe(true);
      candidate.recipient = "mallory.near";
      await Promise.resolve();
    });
    expect(transported?.recipient).toBe("alice.near");
  });

  it.each([
    { depositAddress: "0xfunding" },
    { deposit_address: "0xfunding" },
    { memo: "funding memo" },
    { funding: { address: "0xfunding" } },
  ])(
    "rejects every unrecognized top-level funding-shaped field",
    async (field) => {
      const setup = client(response(request(), field));
      await expect(
        setup.client.quote(request(), async () => undefined),
      ).rejects.toThrow(/unrecognized field/i);
      expect(setup.verify).not.toHaveBeenCalled();
    },
  );

  it.each([
    "depositAddress",
    "depositMemo",
    "chainDepositAddresses",
    "timeWhenInactive",
    "funding",
  ])("rejects forbidden nested quote field %s", async (field) => {
    const fixture = response();
    (fixture.quote as Record<string, unknown>)[field] = {
      deposit_address: "0xfunding",
    };
    const setup = client(fixture);
    await expect(
      setup.client.quote(request(), async () => undefined),
    ).rejects.toThrow(/unrecognized field/i);
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("rejects funding-shaped fields nested in the echoed request", async () => {
    const echoed = {
      ...request(),
      funding: { deposit_address: "0xfunding" },
    } as DryQuoteRequest;
    const setup = client(response(echoed));
    await expect(
      setup.client.quote(request(), async () => undefined),
    ).rejects.toThrow(/unrecognized field/i);
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("rejects unknown outbound request fields before preflight or transport", async () => {
    const hostile = {
      ...request(),
      deposit_address: "0xfunding",
    } as DryQuoteRequest;
    const setup = client(response());
    const preflight = vi.fn(async () => undefined);
    await expect(setup.client.quote(hostile, preflight)).rejects.toThrow(
      /unrecognized field/i,
    );
    expect(preflight).not.toHaveBeenCalled();
    expect(setup.requestQuote).not.toHaveBeenCalled();
  });

  it("rejects a response that does not exactly echo the reviewed request", async () => {
    const fixture = response({ ...request(), recipient: "mallory.near" });
    const setup = client(fixture);
    await expect(
      setup.client.quote(request(), async () => undefined),
    ).rejects.toThrow(/does not match/i);
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("requires complete structured quote-verification provenance", async () => {
    await expect(
      client(response(), null).client.quote(request(), async () => undefined),
    ).rejects.toThrow(/signature verification failed/i);
    await expect(
      client(response(), true).client.quote(request(), async () => undefined),
    ).rejects.toThrow(/must be an object/i);
    await expect(
      client(response(), { verified: true }).client.quote(
        request(),
        async () => undefined,
      ),
    ).rejects.toThrow(/missing required field/i);
    await expect(
      client(response(), {
        ...verification,
        keyId: "",
      }).client.quote(request(), async () => undefined),
    ).rejects.toThrow(/keyId.*malformed/i);
  });

  it("binds minimum output and explicit fee ceiling back to the intent", () => {
    const fixture = response() as unknown as StrictDryQuoteResponse;
    expect(() =>
      assertDryQuoteSatisfiesIntent(intent(), fixture),
    ).not.toThrow();
    expect(() =>
      assertDryQuoteSatisfiesIntent(
        intent({ minimumOutput: "1000001" }),
        fixture,
      ),
    ).toThrow(/minimum output/i);
    fixture.quote.withdrawFee = "1001";
    expect(() => assertDryQuoteSatisfiesIntent(intent(), fixture)).toThrow(
      /fee ceiling/i,
    );
  });

  it("rejects hostile request enums, amounts, timestamps, and optional fields", () => {
    expect(() =>
      assertDryQuoteRequest(request({ swapType: "ANY_INPUT" })),
    ).toThrow(/ANY_INPUT/i);
    expect(() => assertDryQuoteRequest(request({ amount: "01" }))).toThrow(
      /canonical/i,
    );
    expect(() =>
      assertDryQuoteRequest(request({ amount: `1${"0".repeat(78)}` })),
    ).toThrow(/canonical/i);
    expect(() =>
      assertDryQuoteRequest(request({ slippageTolerance: 10_001 })),
    ).toThrow(/basis points/i);
    expect(() =>
      assertDryQuoteRequest(request({ deadline: "2030-02-30T00:00:00.000Z" })),
    ).toThrow(/real canonical/i);
    expect(() =>
      assertDryQuoteRequest(
        request({ depositMode: "EVIL" as DryQuoteRequest["depositMode"] }),
      ),
    ).toThrow(/depositMode/i);
  });

  it("rejects overlong quote base-unit integers before verification", async () => {
    const fixture = response();
    (fixture.quote as Record<string, unknown>).amountOut = `1${"0".repeat(78)}`;
    const setup = client(fixture);
    await expect(
      setup.client.quote(request(), async () => undefined),
    ).rejects.toThrow(/canonical base-unit integer/i);
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("rejects malformed response timestamps before verification", async () => {
    const setup = client(
      response(request(), { timestamp: "2030-02-30T00:00:00.000Z" }),
    );
    await expect(
      setup.client.quote(request(), async () => undefined),
    ).rejects.toThrow(/real canonical/i);
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("validates token catalog rows before exposing them", async () => {
    const transport: OneClickTransport = {
      listTokens: async () => [
        { assetId: "asset", symbol: "TOK", decimals: -1 },
      ],
      requestQuote: async () => ({}),
    };
    const verifier: OneClickQuoteVerifier = {
      verify: async () => verification,
    };
    await expect(
      new DryOnlyNearIntentsClient(transport, verifier).listTokens(),
    ).rejects.toThrow(/decimals/i);
  });

  it("copies only reviewed token fields and rejects unbounded catalogs", async () => {
    const verifier: OneClickQuoteVerifier = {
      verify: async () => verification,
    };
    const allowlisted = new DryOnlyNearIntentsClient(
      {
        listTokens: async () => [
          {
            assetId: "asset",
            symbol: "TOK",
            decimals: 18,
            blockchain: "near",
            price: 1.5,
            fundingAddress: "0xfunding",
          } as never,
        ],
        requestQuote: async () => ({}),
      },
      verifier,
    );
    await expect(allowlisted.listTokens()).resolves.toEqual([
      {
        assetId: "asset",
        symbol: "TOK",
        decimals: 18,
        blockchain: "near",
        price: 1.5,
      },
    ]);
    await expect(
      new DryOnlyNearIntentsClient(
        {
          listTokens: async () => [
            {
              assetId: "asset",
              symbol: "TOK",
              decimals: 18,
              price: Number.POSITIVE_INFINITY,
            },
          ],
          requestQuote: async () => ({}),
        },
        verifier,
      ).listTokens(),
    ).rejects.toThrow(/price/i);
    await expect(
      new DryOnlyNearIntentsClient(
        {
          listTokens: async () =>
            Array.from({ length: 4097 }, (_, index) => ({
              assetId: `asset-${index}`,
              symbol: "TOK",
              decimals: 18,
            })),
          requestQuote: async () => ({}),
        },
        verifier,
      ).listTokens(),
    ).rejects.toThrow(/too many values/i);
  });

  it("exposes no live submission or funding method", () => {
    const connector = client(response()).client as unknown as Record<
      string,
      unknown
    >;
    expect(connector.mode).toBe("dry-only");
    expect("submit" in connector).toBe(false);
    expect("fund" in connector).toBe(false);
    expect("deposit" in connector).toBe(false);
    expect("transport" in connector).toBe(false);
    expect("verifier" in connector).toBe(false);
  });
});
