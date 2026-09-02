import {
  PRIVATE_RFQ_V2_DOMAIN,
  type PrivateRfqV2,
  type SelectionTranscriptV1,
} from "@app20/private-intents";
import { describe, expect, it, vi } from "vitest";
import {
  abandonLocalnetFunding,
  abandonLocalnetTake,
  askLocalnetSolverToFill,
  buildLocalnetIntentPayoutActions,
  convergeLocalnetPrivateIntent,
  createLocalnetIntentId,
  ensureLocalnetEscrowTicket,
  expireLocalnetPrivateIntent,
  formatLocalnetTokenAmount,
  fundingTicketAttemptTarget,
  markLocalnetFundingUnknown,
  markLocalnetTakeUnknown,
  observeLocalnetFunding,
  observeLocalnetTake,
  parseLocalnetTokenAmount,
  postSelectionTranscript,
  prepareLocalnetFunding,
  prepareLocalnetTake,
  readEscrowLock,
  readEscrowTake,
  readLocalnetEscrowDeal,
  readLocalnetRfqOperationsStatus,
  readLocalnetUnresolvedDealsV3,
  releaseLocalnetRfqReservations,
  requestLocalnetSolverQuotes,
  requestQuotesV3,
  signLocalnetSolverQuote,
  convergeLocalnetTake,
  type LocalnetMarketToken,
} from "./localnet-private-intents";

const STRK = "0x4718";
const ETH = "0x455448";
const STRK_TOKEN: LocalnetMarketToken = {
  symbol: "STRK",
  address: STRK,
  decimals: 18,
};
const USDC_TOKEN: LocalnetMarketToken = {
  symbol: "USDC",
  address: "0x05dc",
  decimals: 6,
};

describe("localnet private-intent adapter", () => {
  it("parses and formats token amounts without assuming 18 decimals", () => {
    expect(parseLocalnetTokenAmount("0.1", STRK_TOKEN)).toBe(10n ** 17n);
    expect(parseLocalnetTokenAmount("0.19", USDC_TOKEN)).toBe(190_000n);
    expect(formatLocalnetTokenAmount(199_400n, USDC_TOKEN)).toBe("0.1994");
    expect(
      formatLocalnetTokenAmount(49_850_000_000_000_000n, STRK_TOKEN, 6),
    ).toBe("0.04985");
  });

  it("rejects zero, excess precision, and escrow-overflow amounts", () => {
    expect(() => parseLocalnetTokenAmount("0", USDC_TOKEN)).toThrow(
      "greater than zero",
    );
    expect(() => parseLocalnetTokenAmount("0.0000001", USDC_TOKEN)).toThrow(
      "at most 6 decimal places",
    );
    expect(() =>
      parseLocalnetTokenAmount((2n ** 128n).toString(), USDC_TOKEN),
    ).toThrow("does not fit the escrow");
  });

  it("creates a non-zero felt-sized unpredictable intent id", () => {
    const first = createLocalnetIntentId();
    const second = createLocalnetIntentId();
    expect(first).toMatch(/^0x[1-9a-f][0-9a-f]{61}$/);
    expect(`0x${BigInt(first).toString(16)}`).toBe(first);
    expect(BigInt(first)).toBeGreaterThan(0n);
    expect(BigInt(first)).toBeLessThan(2n ** 251n);
    expect(second).not.toBe(first);
  });

  it("retries deterministic zero and low-first-nibble randomness", () => {
    let call = 0;
    const random = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        const bytes = array as Uint8Array;
        bytes.fill(0xaa);
        bytes[0] = [0x00, 0x0f, 0x10][call++]!;
        return array;
      });
    expect(createLocalnetIntentId()).toBe(`0x10${"aa".repeat(30)}`);
    expect(random).toHaveBeenCalledTimes(3);
    random.mockRestore();
  });

  it("keeps every generated ID canonical and Starknet-range in a loop", () => {
    let call = 0;
    const random = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        const bytes = array as Uint8Array;
        bytes.fill(call & 0xff);
        bytes[0] = 0x10 + (call % 0xf0);
        call += 1;
        return array;
      });
    for (let index = 0; index < 512; index += 1) {
      const id = createLocalnetIntentId();
      expect(id).toMatch(/^0x[1-9a-f][0-9a-f]{61}$/);
      expect(`0x${BigInt(id).toString(16)}`).toBe(id);
      expect(BigInt(id)).toBeLessThan(2n ** 251n);
    }
    random.mockRestore();
  });

  it.each([
    ["claim", "0x2"],
    ["timeout", "0x3"],
  ] as const)("builds claim-ticket %s actions", (operation, variant) => {
    const actions = buildLocalnetIntentPayoutActions({
      operation,
      escrowAddress: "0xe5c",
      recoveryAddress: "0xa11ce",
      ticketAddress: "0x71c",
      dealId: "0xd001",
      payoutToken: ETH,
    });
    expect(actions).toEqual([
      {
        type: "withdraw",
        token: "0x71c",
        amount: "0x1",
        recipient: "0xe5c",
      },
      {
        type: "transfer",
        token: ETH,
        amount: "OPEN",
        recipient: "0xa11ce",
      },
      {
        type: "invoke",
        contract: "0xe5c",
        calldata: [variant, "0xd001", "${poolAddress}", "${openNoteIds[0]}"],
      },
    ]);
  });

  it("canonicalizes RFQ/deal aliases before every local server caller", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const path = new URL(input).pathname;
        const result = path.endsWith("/ensure-ticket")
          ? { ticketAddress: "0X0040" }
          : path.endsWith("/solve")
            ? { transaction_hash: "0xfeed" }
            : path.endsWith("/expire")
              ? { expiredAt: 123 }
              : path.endsWith("/deal")
                ? { status: 0 }
                : {};
        return new Response(JSON.stringify({ result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const terms = {
      account: "0xabc",
      chainId: "0x1",
      rfqId: "0X0077",
      dealId: "119",
      intentDigest: `0x${"aa".repeat(32)}`,
      solverId: "maker-a",
      reservationId: `0x${"bb".repeat(32)}`,
      reservationFence: "1",
      quoteDigest: `0x${"cc".repeat(32)}`,
      sellToken: "0x10",
      sellAmount: 100n,
      buyToken: "0x20",
      buyAmount: 200n,
      deadline: 123,
      ticketAddress: "0x40",
    };
    const target = fundingTicketAttemptTarget(terms);
    expect(target).toMatchObject({ rfqId: "0x77", dealId: "0x77" });
    await ensureLocalnetEscrowTicket({ target, attemptId: "attempt" });
    await prepareLocalnetFunding(terms, "attempt");
    await markLocalnetFundingUnknown(terms, "attempt");
    await abandonLocalnetFunding(terms, "attempt");
    await observeLocalnetFunding(terms, "attempt");
    await convergeLocalnetPrivateIntent(terms, "attempt", 1);
    await askLocalnetSolverToFill(terms, "attempt");
    await expireLocalnetPrivateIntent(terms);
    await readLocalnetEscrowDeal("0X0077");
    await releaseLocalnetRfqReservations({
      operation: "request-reservations",
      chainId: terms.chainId,
      account: terms.account,
      rfqId: "119",
      requestDigest: terms.intentDigest,
      releaseLeaseId: "release",
    });
    expect(bodies).toHaveLength(10);
    for (const body of bodies) {
      if (body.rfqId !== undefined) expect(body.rfqId).toBe("0x77");
      if (body.dealId !== undefined) expect(body.dealId).toBe("0x77");
    }
    vi.unstubAllGlobals();
  });

  it("parses request-scoped maker offers without exposing raw inventory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                offers: [
                  {
                    solverId: "app20-localnet-solver",
                    solverKey: "app20-localnet-solver/ecdsa-p256-v1",
                    grossBuyAmount: "100",
                    sellToken: STRK,
                    buyToken: ETH,
                    spreadBps: 30,
                    provenance: "fixture",
                    nonce: `0x${"11".repeat(32)}`,
                    reservationId: `0x${"22".repeat(32)}`,
                    reservationExpiresAt: 1_800_000_180,
                  },
                ],
                cohort: [
                  {
                    makerId: "app20-localnet-solver",
                    keyId: "app20-localnet-solver/ecdsa-p256-v1",
                    keyStatus: "valid",
                    keyValidUntil: 1_800_003_600,
                    invitationStatus: "responded",
                    capacityBand: "medium",
                    eligible: true,
                    rationale:
                      "Eligible because the exact reviewed clip was reserved.",
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      requestLocalnetSolverQuotes({
        account: "0xabc",
        chainId: "0x1",
        rfqId: "0x77",
        intentDigest: `0x${"aa".repeat(32)}`,
        createdAt: 1_800_000_000,
        expiresAt: 1_800_000_300,
        sellToken: STRK,
        sellAmount: 1_000n,
        buyToken: ETH,
        minBuyAmount: 90n,
        cohort: {
          epoch: 0,
          checkpoint: "local-fixture-checkpoint-v1",
          validUntil: 1_800_000_030,
          makers: [
            {
              makerId: "app20-localnet-solver",
              keyId: "app20-localnet-solver/ecdsa-p256-v1",
            },
          ],
          binding: "bound-cohort",
        },
      }),
    ).resolves.toMatchObject({
      offers: [
        {
          solverId: "app20-localnet-solver",
          grossBuyAmount: 100n,
          spreadBps: 30,
          reservationId: `0x${"22".repeat(32)}`,
        },
      ],
      cohort: [
        {
          makerId: "app20-localnet-solver",
          invitationStatus: "responded",
          capacityBand: "medium",
          eligible: true,
        },
      ],
    });
    vi.unstubAllGlobals();
  });

  it("reads only the strict browser-safe operations status endpoint", async () => {
    const observedAt = 1_800_000_000;
    const fetchMock = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            result: {
              schema: "app20/rfq-operations-status/v1",
              environment: "localnet",
              observedAt,
              validUntil: observedAt + 30,
              mode: "running",
              reason: "Named localnet fixture operations are running.",
              claimsAndRefundsEnabled: true,
              directory: {
                epoch: 0,
                checkpoint: "local-fixture-checkpoint-v1",
                validUntil: observedAt + 30,
              },
              cohort: {
                governed: 1,
                invited: 0,
                responded: 0,
                refused: 0,
                unavailable: 0,
              },
              makers: [
                {
                  makerId: "app20-localnet-solver",
                  keyId: "app20-localnet-solver/ecdsa-p256-v1",
                  keyStatus: "valid",
                  keyValidUntil: observedAt + 3_600,
                  invitationStatus: "not-invited",
                  capacityBand: "medium",
                  eligible: true,
                  rationale: "Eligible under named localnet fixture policy.",
                },
              ],
              mids: [],
              locks: { open: 0, expiredAwaitingSettlement: 0, settled: 0 },
              transcripts: { received: 0, consistent: 0 },
              rawInventoryExposed: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(readLocalnetRfqOperationsStatus()).resolves.toMatchObject({
      mode: "running",
      rawInventoryExposed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/rfq\/operations\/status$/),
      expect.anything(),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("/health");
    vi.unstubAllGlobals();
  });

  it("rejects a solver signature over a different canonical payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                signature: "0xab",
                canonical: "different",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      signLocalnetSolverQuote("expected", {
        domain: "app20/private-intent-quote/v1",
        pool: "starknet:APP20_LOCALNET",
        helper: "0x1",
        sellToken: STRK,
        sellAmount: 1n,
        buyToken: ETH,
        intentDigest: "0x2",
        solverId: "app20-localnet-solver",
        solverKey: "app20-localnet-solver/ecdsa-p256-v1",
        nonce: `0x${"11".repeat(32)}`,
        reservationId: `0x${"22".repeat(32)}`,
        reservationExpiresAt: 2,
        buyAmount: 1n,
        spreadBps: 30,
        pricingProvenance: "fixture",
        quotedAt: 1,
        quoteExpiresAt: 2,
      }),
    ).rejects.toThrow(/different quote payload/i);
    vi.unstubAllGlobals();
  });

  it("cancels an in-flight quote request when the caller aborts", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string, init?: RequestInit) => {
        observed = init?.signal ?? undefined;
        return new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }),
    );
    const pending = requestLocalnetSolverQuotes({
      account: "0xabc",
      chainId: "0x1",
      rfqId: "0x77",
      intentDigest: `0x${"aa".repeat(32)}`,
      createdAt: 1_800_000_000,
      expiresAt: 1_800_000_300,
      sellToken: STRK,
      sellAmount: 1_000n,
      buyToken: ETH,
      minBuyAmount: 90n,
      cohort: {
        epoch: 0,
        checkpoint: "local-fixture-checkpoint-v1",
        validUntil: 1_800_000_030,
        makers: [
          {
            makerId: "app20-localnet-solver",
            keyId: "app20-localnet-solver/ecdsa-p256-v1",
          },
        ],
        binding: "bound-cohort",
      },
      signal: controller.signal,
    });
    await Promise.resolve();
    expect(observed?.aborted).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(observed?.aborted).toBe(true);
    vi.unstubAllGlobals();
  });

  it("strictly decodes RFQ v3 quotes and refusal digests", async () => {
    const rfq: PrivateRfqV2 = {
      version: 2,
      domain: PRIVATE_RFQ_V2_DOMAIN,
      rfqId: `0x${"11".repeat(32)}`,
      rfqFelt: "0x77",
      takerCommitment: "0x55",
      chainId: "starknet:APP20_LOCALNET",
      registryRevision: "registry-v1",
      directoryEpoch: 0,
      settlementHelper: "0x5",
      sellToken: "0x1",
      buyToken: "0x2",
      sellBucketMinBaseUnits: 50n,
      sellBucketMaxBaseUnits: 100n,
      createdAt: 1_800_000_000,
      responseDeadline: 1_800_000_030,
      expiresAt: 1_800_000_090,
      lockExpiresAt: 1_800_000_090,
    };
    const cohort = {
      epoch: 0,
      checkpoint: "local-fixture-checkpoint-v1",
      validUntil: 1_800_000_030,
      makers: [
        { makerId: "maker-a", keyId: "maker-a/key" },
        { makerId: "maker-b", keyId: "maker-b/key" },
      ],
      binding: "bound-cohort",
    };
    const signature = `0x${"0".repeat(63)}1${"0".repeat(63)}1`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            result: {
              quotes: [
                {
                  domain: "app20/private-intent-quote/v3",
                  version: 3,
                  solverId: "maker-a",
                  quoteKeyId: "maker-a/key",
                  nonce: `0x${"22".repeat(32)}`,
                  pool: "starknet:APP20_LOCALNET",
                  helper: "0x5",
                  escrowAddress: "0x5",
                  rfqDigest: `0x${"33".repeat(32)}`,
                  rfqFelt: "0x77",
                  sellToken: "0x1",
                  buyToken: "0x2",
                  schedule: [{ a: "50", b: "100" }, { a: "100", b: "200" }],
                  lockId: "0x41",
                  lockTicket: "0x51",
                  lockTransactionHash: "0x61",
                  lockExpiresAt: 1_800_000_090,
                  spreadBps: 20,
                  pricingProvenance: "fixture",
                  quotedAt: 1_800_000_001,
                  quoteExpiresAt: 1_800_000_030,
                  signature,
                },
              ],
              refusals: [
                {
                  makerId: "maker-b",
                  code: "inventory",
                  reason: "No inventory in this bucket.",
                  quoteDigest: `0x${"44".repeat(32)}`,
                },
              ],
              cohort,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(
      requestQuotesV3({ account: "0xabc", chainId: "0x1", rfq, cohort }),
    ).resolves.toMatchObject({
      quotes: [
        {
          solverId: "maker-a",
          schedule: [
            { a: 50n, b: 100n },
            { a: 100n, b: 200n },
          ],
        },
      ],
      refusals: [
        {
          makerId: "maker-b",
          code: "inventory",
          reason: "No inventory in this bucket.",
        },
      ],
    });
    vi.unstubAllGlobals();
  });

  it("decodes escrow reads and journals every exact Take boundary", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(input).pathname;
        const body = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {};
        calls.push({ path, body });
        const result = path.endsWith("/escrow/lock")
          ? {
              lock: {
                status: "open",
                tokenA: "0x1",
                tokenB: "0x2",
                rfqId: "0x77",
                takerCommitment: "0x55",
                expiry: 1_800_000_090,
                schedule: [{ a: "50", b: "100" }, { a: "100", b: "200" }],
                remainingB: "200",
                earnedA: "0",
                ticket: "0x51",
                proceedsSettled: false,
                collateralReleased: false,
              },
            }
          : path.endsWith("/escrow/take")
            ? {
                take: {
                  tokenA: "0x1",
                  totalA: "100",
                  tokenB: "0x2",
                  totalB: "200",
                  fillCount: 1,
                  takenAt: 1_800_000_010,
                },
              }
            : path.endsWith("/transcript")
              ? {
                  acknowledgements: [
                    { makerId: "maker-a", accepted: true, consistent: true },
                  ],
                }
              : { ok: true };
        return new Response(JSON.stringify({ result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await expect(readEscrowLock("0x41")).resolves.toMatchObject({
      status: "open",
      schedule: [
        { a: 50n, b: 100n },
        { a: 100n, b: 200n },
      ],
      remainingB: 200n,
    });
    await expect(readEscrowTake("0x77")).resolves.toMatchObject({
      totalA: 100n,
      totalB: 200n,
      fillCount: 1,
    });
    const target = {
      account: "0xabc",
      chainId: "0x1",
      rfqId: "0x77",
      dealId: "0x77",
      expected: {
        tokenA: "0x1",
        totalA: 100n,
        tokenB: "0x2",
        totalB: 200n,
        fills: [{ lockId: "0x41", amountA: 100n, amountB: 200n }],
      },
    };
    await prepareLocalnetTake(target, "take-1");
    await markLocalnetTakeUnknown(target, "take-1");
    await abandonLocalnetTake(target, "take-1");
    await observeLocalnetTake(target, "take-1");
    await convergeLocalnetTake(target, "take-1", "taken");
    const transcript: SelectionTranscriptV1 = {
      version: 1,
      domain: "app20/rfq-selection-transcript/v1",
      rfqDigest: `0x${"11".repeat(32)}`,
      rule: "app20/rfq-selection/v3",
      bucket: { min: "50", max: "100" },
      createdAt: 1_800_000_010,
      entries: [
        {
          makerId: "maker-a",
          quoteDigest: `0x${"22".repeat(32)}`,
          outcome: "lost",
          rank: 1,
        },
      ],
      clearingUnitPriceE18: "2000000000000000000",
      digest: `0x${"33".repeat(32)}`,
    };
    await expect(
      postSelectionTranscript({
        account: "0xabc",
        chainId: "0x1",
        rfqDigest: transcript.rfqDigest,
        transcript,
      }),
    ).resolves.toEqual([
      { makerId: "maker-a", accepted: true, consistent: true },
    ]);
    const takeCalls = calls.filter(({ path }) => path.includes("/take-"));
    expect(takeCalls).toHaveLength(5);
    expect(takeCalls[0]!.body).toMatchObject({
      runtimeEpoch: expect.any(String),
      rfqId: "0x77",
      dealId: "0x77",
      expected: {
        totalA: "100",
        totalB: "200",
        fills: [{ lockId: "0x41", amountA: "100", amountB: "200" }],
      },
      attemptId: "take-1",
    });
    vi.unstubAllGlobals();
  });

  it("restores strict browser-safe unresolved v3 Take rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            result: {
              schema: "app20/localnet-unresolved-deals/v1",
              environment: "localnet",
              rawInventoryExposed: false,
              deals: [
                {
                  source: "localnet-coordinator-and-chain",
                  authority: "server-derived-resume-only",
                  lifecycle: "v3",
                  account: "0xabc",
                  chainId: "0x1",
                  market: "0x1/0x2",
                  rfqId: "0x77",
                  dealId: "0x77",
                  intentDigest: `0x${"11".repeat(32)}`,
                  createdAt: 1_800_000_000,
                  expiresAt: 1_800_000_090,
                  expected: {
                    tokenA: "0x1",
                    totalA: "100",
                    tokenB: "0x2",
                    totalB: "200",
                    fills: [
                      { lockId: "0x41", amountA: "100", amountB: "200" },
                    ],
                  },
                  transactions: { take: "0xabc" },
                  observation: { status: "taken" },
                  escrowAddress: "0x5",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(
      readLocalnetUnresolvedDealsV3({
        account: "0xabc",
        chainId: "0x1",
        sellToken: "0x1",
        buyToken: "0x2",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        lifecycle: "v3",
        expected: {
          tokenA: "0x1",
          totalA: "100",
          tokenB: "0x2",
          totalB: "200",
          fills: [{ lockId: "0x41", amountA: "100", amountB: "200" }],
        },
        transactions: { take: "0xabc" },
      }),
    ]);
    vi.unstubAllGlobals();
  });
});
