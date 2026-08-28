import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIPT_DISCLOSURE_EXCLUSIONS,
  RECEIPT_DISCLOSURE_WARNING,
  buildReceiptDisclosure,
  canonicalReceiptDisclosure,
  digestReceiptDisclosure,
  verifyReceiptDisclosureAgainstReceipt,
  type ReceiptDisclosureField,
} from "./receipt-disclosure";
import {
  SETTLEMENT_RECEIPT_DOMAIN,
  type LocalSettlementReceipt,
} from "./settlement-receipt";

function receipt(): LocalSettlementReceipt {
  return {
    version: 1,
    domain: SETTLEMENT_RECEIPT_DOMAIN,
    chainId: "starknet:APP20_LOCALNET",
    escrowAddress: "0xe5c",
    dealId: "0xd001",
    claimTicketId: "0x71c",
    intentDigest: `0x${"11".repeat(32)}`,
    commitmentDigest: `0x${"44".repeat(32)}`,
    directoryDigest: `0x${"55".repeat(32)}`,
    rfqDigest: `0x${"66".repeat(32)}`,
    settlementContextDigest: `0x${"77".repeat(32)}`,
    winningQuoteDigest: `0x${"22".repeat(32)}`,
    makerKeyId: "maker-a/p256/v1",
    directoryEpoch: 7,
    reservationId: `0x${"33".repeat(32)}`,
    reservationFence: 9n,
    registryRevision: "localnet-registry:4",
    inputAsset: "0x053c",
    inputAmountBaseUnits: 100_000_001n,
    outputAsset: "0x0471",
    outputAmountBaseUnits: 49_850_000_000_000_000n,
    outcome: "settled",
    evidenceKind: "local",
    lifecycle: [
      { stage: "fund", transactionHash: "0xf1", observedAt: 1 },
      { stage: "fill", transactionHash: "0xf2", observedAt: 2 },
      { stage: "claim", transactionHash: "0xf3", observedAt: 3 },
    ],
  };
}

describe("receipt selective disclosure", () => {
  it("includes only user-selected allowlisted fields and the irrevocability warning", async () => {
    const disclosure = await buildReceiptDisclosure(receipt(), [
      "outcome",
      "chainId",
      "outputAmountBaseUnits",
    ]);
    expect(disclosure.disclosedFields).toEqual({
      chainId: "starknet:APP20_LOCALNET",
      outcome: "settled",
      outputAmountBaseUnits: "49850000000000000",
    });
    expect(disclosure.warning).toBe(RECEIPT_DISCLOSURE_WARNING);
    expect(Object.keys(disclosure)).not.toContain("proof");
    expect(Object.keys(disclosure)).not.toContain("revealKey");
  });

  it("is deterministic regardless of selection order and duplicates", async () => {
    const first = await buildReceiptDisclosure(receipt(), [
      "outcome",
      "chainId",
      "dealId",
    ]);
    const second = await buildReceiptDisclosure(receipt(), [
      "dealId",
      "chainId",
      "outcome",
      "chainId",
    ]);
    expect(canonicalReceiptDisclosure(first)).toBe(
      canonicalReceiptDisclosure(second),
    );
    await expect(digestReceiptDisclosure(first)).resolves.toBe(
      await digestReceiptDisclosure(second),
    );
  });

  it("canonicalizes nested disclosed objects independent of key insertion order", async () => {
    const disclosure = await buildReceiptDisclosure(receipt(), ["lifecycle"]);
    const lifecycle = disclosure.disclosedFields.lifecycle as Array<{
      observedAt: number;
      stage: string;
      transactionHash: string;
    }>;
    const reordered = {
      ...disclosure,
      disclosedFields: {
        lifecycle: lifecycle.map((item) => ({
          transactionHash: item.transactionHash,
          stage: item.stage,
          observedAt: item.observedAt,
        })),
      },
    };
    expect(canonicalReceiptDisclosure(reordered)).toBe(
      canonicalReceiptDisclosure(disclosure),
    );
  });

  it("rejects empty, non-allowlisted, and absent optional selections", async () => {
    await expect(buildReceiptDisclosure(receipt(), [])).rejects.toThrow(
      /at least one/i,
    );
    await expect(
      buildReceiptDisclosure(receipt(), [
        "viewingKey" as ReceiptDisclosureField,
      ]),
    ).rejects.toThrow(/not discloseable/i);
    await expect(
      buildReceiptDisclosure(receipt(), ["escrowClassHash"]),
    ).rejects.toThrow(/not present/i);
  });

  it("verifies selected values against the referenced full receipt", async () => {
    const disclosure = await buildReceiptDisclosure(receipt(), [
      "outcome",
      "outputAmountBaseUnits",
    ]);
    await expect(
      verifyReceiptDisclosureAgainstReceipt(disclosure, receipt()),
    ).resolves.toBe(true);
    await expect(
      verifyReceiptDisclosureAgainstReceipt(
        {
          ...disclosure,
          disclosedFields: {
            ...disclosure.disclosedFields,
            outcome: "refunded",
          },
        },
        receipt(),
      ),
    ).resolves.toBe(false);
    await expect(
      verifyReceiptDisclosureAgainstReceipt(disclosure, {
        ...receipt(),
        outputAmountBaseUnits: receipt().outputAmountBaseUnits + 1n,
      }),
    ).resolves.toBe(false);
  });

  it("retains prototype-named keys during canonicalization instead of colliding", async () => {
    const disclosure = await buildReceiptDisclosure(receipt(), ["lifecycle"]);
    const hostileLifecycle = JSON.parse(
      '[{"__proto__":{"polluted":true}}]',
    ) as never;
    const hostile = {
      ...disclosure,
      disclosedFields: { lifecycle: hostileLifecycle },
    };
    expect(canonicalReceiptDisclosure(hostile)).toContain('"__proto__"');
    await expect(
      verifyReceiptDisclosureAgainstReceipt(hostile, receipt()),
    ).resolves.toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("defines the sensitive structural defaults as excluded", async () => {
    expect(DEFAULT_RECEIPT_DISCLOSURE_EXCLUSIONS).toEqual([
      "losing quotes",
      "invited-maker set",
      "correspondence/mail",
      "local note IDs",
      "viewing keys",
      "relay metadata",
    ]);
    const disclosure = await buildReceiptDisclosure(receipt(), ["lifecycle"]);
    const encoded = JSON.stringify(disclosure);
    for (const excluded of [
      "losingQuotes",
      "invitedMakers",
      "mail",
      "localNoteIds",
      "viewingKeys",
      "relayMetadata",
    ]) {
      expect(encoded).not.toContain(excluded);
    }
  });
});
