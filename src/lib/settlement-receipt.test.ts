import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_RECEIPT_DOMAIN,
  assertSettlementReceipt,
  canonicalSettlementReceipt,
  digestSettlementReceipt,
  settlementReceiptAuthority,
  verifyChainSettlementReceipt,
  type ChainSettlementReceipt,
  type LocalSettlementReceipt,
} from "./settlement-receipt";

function chainReceipt(): ChainSettlementReceipt {
  return {
    version: 1,
    domain: SETTLEMENT_RECEIPT_DOMAIN,
    chainId: "starknet:APP20_LOCALNET",
    escrowAddress: "0x0e5c",
    escrowClassHash: "0xc1a55",
    dealId: "0xd001",
    claimTicketId: "0x71c",
    intentDigest: `0x${"11".repeat(32)}`,
    winningQuoteDigest: `0x${"22".repeat(32)}`,
    makerKeyId: "maker-a/p256/v1",
    directoryEpoch: 7,
    reservationId: `0x${"33".repeat(32)}`,
    registryRevision: "localnet-registry:4",
    inputAsset: "0x053c",
    inputAmountBaseUnits: 100_000_001n,
    outputAsset: "0x0471",
    outputAmountBaseUnits: 49_850_000_000_000_000n,
    outcome: "settled",
    evidenceKind: "chain",
    requiredFinality: "confirmed",
    lifecycle: [
      {
        stage: "fund",
        transactionHash: "0xf001",
        event: { blockNumber: 10, transactionIndex: 0, eventIndex: 2 },
        finality: "confirmed",
      },
      {
        stage: "fill",
        transactionHash: "0xf002",
        event: { blockNumber: 11, transactionIndex: 1, eventIndex: 0 },
        finality: "finalized",
      },
      {
        stage: "claim",
        transactionHash: "0xf003",
        event: { blockNumber: 12, transactionIndex: 0, eventIndex: 3 },
        finality: "confirmed",
      },
    ],
  };
}

function localReceipt(): LocalSettlementReceipt {
  const chain = chainReceipt();
  return {
    ...chain,
    evidenceKind: "local",
    lifecycle: chain.lifecycle.map(({ stage, transactionHash }, index) => ({
      stage,
      transactionHash,
      observedAt: 1_800_000_000 + index,
    })),
  };
}

describe("canonical settlement receipt", () => {
  it("binds exact base-unit quantities and is deterministic across object key order", async () => {
    const receipt = chainReceipt();
    const reordered = {
      lifecycle: receipt.lifecycle,
      requiredFinality: receipt.requiredFinality,
      evidenceKind: receipt.evidenceKind,
      outcome: receipt.outcome,
      outputAmountBaseUnits: receipt.outputAmountBaseUnits,
      outputAsset: receipt.outputAsset,
      inputAmountBaseUnits: receipt.inputAmountBaseUnits,
      inputAsset: receipt.inputAsset,
      registryRevision: receipt.registryRevision,
      reservationId: receipt.reservationId,
      directoryEpoch: receipt.directoryEpoch,
      makerKeyId: receipt.makerKeyId,
      winningQuoteDigest: receipt.winningQuoteDigest,
      intentDigest: receipt.intentDigest,
      claimTicketId: receipt.claimTicketId,
      dealId: receipt.dealId,
      escrowClassHash: receipt.escrowClassHash,
      escrowAddress: receipt.escrowAddress,
      chainId: receipt.chainId,
      domain: receipt.domain,
      version: receipt.version,
    } satisfies ChainSettlementReceipt;

    expect(canonicalSettlementReceipt(reordered)).toBe(
      canonicalSettlementReceipt(receipt),
    );
    expect(canonicalSettlementReceipt(receipt)).toContain(
      '"inputAmountBaseUnits":"100000001"',
    );
    await expect(digestSettlementReceipt(reordered)).resolves.toBe(
      await digestSettlementReceipt(receipt),
    );
    expect(
      canonicalSettlementReceipt({
        ...receipt,
        escrowAddress: "0x000e5c",
        dealId: "0x00d001",
        inputAsset: "0x00053c",
      }),
    ).toBe(canonicalSettlementReceipt(receipt));
  });

  it.each([
    [
      "deal",
      (receipt: ChainSettlementReceipt) => ({ ...receipt, dealId: "0xd002" }),
    ],
    [
      "amount",
      (receipt: ChainSettlementReceipt) => ({
        ...receipt,
        outputAmountBaseUnits: receipt.outputAmountBaseUnits + 1n,
      }),
    ],
    [
      "event coordinate",
      (receipt: ChainSettlementReceipt) => ({
        ...receipt,
        lifecycle: receipt.lifecycle.map((item, index) =>
          index === 1
            ? { ...item, event: { ...item.event, eventIndex: 9 } }
            : item,
        ),
      }),
    ],
    [
      "transaction hash",
      (receipt: ChainSettlementReceipt) => ({
        ...receipt,
        lifecycle: receipt.lifecycle.map((item, index) =>
          index === 0 ? { ...item, transactionHash: "0xfeed" } : item,
        ),
      }),
    ],
  ])("changes the digest after a %s mutation", async (_label, mutate) => {
    const receipt = chainReceipt();
    await expect(
      digestSettlementReceipt(mutate(receipt) as ChainSettlementReceipt),
    ).resolves.not.toBe(await digestSettlementReceipt(receipt));
  });

  it("rejects forged ordering, duplicate coordinates, and missing lifecycle evidence", () => {
    const receipt = chainReceipt();
    expect(() =>
      assertSettlementReceipt({
        ...receipt,
        lifecycle: [
          receipt.lifecycle[1]!,
          receipt.lifecycle[0]!,
          receipt.lifecycle[2]!,
        ],
      }),
    ).toThrow(/ordered fund → fill → claim/i);
    expect(() =>
      assertSettlementReceipt({
        ...receipt,
        lifecycle: receipt.lifecycle.map((item, index) =>
          index === 1
            ? { ...item, event: { ...receipt.lifecycle[0]!.event } }
            : item,
        ),
      }),
    ).toThrow(/coordinates must be unique/i);
    expect(() =>
      assertSettlementReceipt({
        ...receipt,
        lifecycle: receipt.lifecycle.map((item, index) =>
          index === 1
            ? { ...item, event: { ...item.event, blockNumber: 9 } }
            : item,
        ),
      }),
    ).toThrow(/strictly increasing/i);
    expect(() =>
      assertSettlementReceipt({
        ...receipt,
        lifecycle: receipt.lifecycle.slice(0, 2),
      }),
    ).toThrow(/requires fund → fill → claim/i);
  });

  it("rejects malformed bindings and quantities outside u256", () => {
    expect(() =>
      assertSettlementReceipt({
        ...chainReceipt(),
        intentDigest: "0x1234",
      }),
    ).toThrow(/32-byte hex digest/i);
    expect(() =>
      assertSettlementReceipt({
        ...chainReceipt(),
        inputAmountBaseUnits: 1n << 256n,
      }),
    ).toThrow(/positive u256/i);
    expect(() =>
      assertSettlementReceipt({
        ...chainReceipt(),
        escrowAddress: "0x0",
      }),
    ).toThrow(/must not be zero/i);
  });

  it("requires fund then timeout evidence for refunds", () => {
    const receipt: ChainSettlementReceipt = {
      ...chainReceipt(),
      outcome: "refunded",
      outputAsset: chainReceipt().inputAsset,
      outputAmountBaseUnits: chainReceipt().inputAmountBaseUnits,
      lifecycle: [
        chainReceipt().lifecycle[0]!,
        {
          stage: "timeout",
          transactionHash: "0xf004",
          event: { blockNumber: 22, transactionIndex: 0, eventIndex: 1 },
          finality: "confirmed",
        },
      ],
    };
    expect(() => assertSettlementReceipt(receipt)).not.toThrow();
    expect(() =>
      assertSettlementReceipt({
        ...receipt,
        outputAmountBaseUnits: receipt.outputAmountBaseUnits - 1n,
      }),
    ).toThrow(/exact input asset and amount/i);
  });
});

describe("settlement receipt authority", () => {
  it("keeps local evidence non-authoritative", () => {
    expect(settlementReceiptAuthority(localReceipt())).toEqual({
      authoritative: false,
      reason: "Local lifecycle evidence is non-authoritative.",
    });
  });

  it("requires configured-chain verification after every event reaches finality", async () => {
    expect(settlementReceiptAuthority(chainReceipt())).toMatchObject({
      authoritative: false,
      reason: expect.stringMatching(/not authoritative.*trusted integration/i),
    });
    const verified = await verifyChainSettlementReceipt(chainReceipt(), {
      verifiedAt: 2_000_000_000,
      verificationReference: "localnet-rpc-quorum:10-12",
      verifyAgainstConfiguredChain: async () => true,
    });
    expect(settlementReceiptAuthority(verified)).toMatchObject({
      authoritative: true,
      reason: expect.stringMatching(/Configured-chain verification succeeded/i),
    });
    const pending: ChainSettlementReceipt = {
      ...chainReceipt(),
      lifecycle: chainReceipt().lifecycle.map((item, index) =>
        index === 2 ? { ...item, finality: "accepted" } : item,
      ),
    };
    expect(settlementReceiptAuthority(pending)).toMatchObject({
      authoritative: false,
      reason: expect.stringMatching(/claim.*confirmed/i),
    });
    expect(
      settlementReceiptAuthority({
        ...chainReceipt(),
        requiredFinality: "finalized",
      }).authoritative,
    ).toBe(false);
    await expect(
      verifyChainSettlementReceipt(chainReceipt(), {
        verifiedAt: 2_000_000_000,
        verificationReference: "untrusted",
        verifyAgainstConfiguredChain: async () => false,
      }),
    ).rejects.toThrow(/verification failed/i);
  });
});
