import { describe, expect, it } from "vitest";
import { SETTLEMENT_RECEIPT_DOMAIN, settlementReceiptAuthority, verifyChainSettlementReceipt, type ChainSettlementReceipt } from "./settlement-receipt";
import { assertCanonicalBlockNumberMembership, assertDecodedReceiptBinding, assertReviewedReceiptRpcOrigins, type ConfiguredChainReceiptManifest } from "./settlement-receipt-chain";
const D = `0x${"11".repeat(32)}`;
function receipt(): ChainSettlementReceipt { return { version: 1, domain: SETTLEMENT_RECEIPT_DOMAIN, chainId: "starknet:SN_SEPOLIA", escrowAddress: "0x1", escrowClassHash: "0x2", dealId: "0x3", claimTicketId: "0x4", intentDigest: D, commitmentDigest: D, directoryDigest: D, rfqDigest: D, settlementContextDigest: D, winningQuoteDigest: D, makerKeyId: "q1", directoryEpoch: 1, reservationId: D, reservationFence: 9n, registryRevision: "r1", inputAsset: "0x5", inputAmountBaseUnits: 6n, outputAsset: "0x7", outputAmountBaseUnits: 8n, outcome: "settled", evidenceKind: "chain", requiredFinality: "finalized", lifecycle: ["fund", "fill", "claim"].map((stage, index) => ({ stage: stage as "fund" | "fill" | "claim", transactionHash: `0x${10 + index}`, event: { blockHash: `0xb${index + 1}`, eventSelector: `0xe${index + 1}`, blockNumber: index + 1, transactionIndex: 0, eventIndex: 0 }, finality: "finalized" })) }; }
function manifest(value: ChainSettlementReceipt): ConfiguredChainReceiptManifest { const origins = ["https://rpc-a.example", "https://rpc-b.example"]; return { chainId: value.chainId, escrowAddress: value.escrowAddress, escrowClassHash: value.escrowClassHash!, abiManifestDigest: D, abiBytes: "unwired", eventSelectors: { fund: "0xe1", fill: "0xe2", claim: "0xe3", timeout: "0xe4" }, requiredFinality: "finalized", rpcSpecVersion: "0.10.2", rpcQuorum: [{ label: "a", url: origins[0]! }, { label: "b", url: origins[1]! }], reviewedRpcOrigins: origins, validUntil: 1_900_000_000, decoderIdentity: { abiDigest: D, generatedModuleDigest: D } }; }

describe("configured-chain settlement receipt boundary", () => {
  it("has no public self-issuable verifier and keeps receipt authority disabled", async () => {
    const module = await import("./settlement-receipt-chain");
    expect("createConfiguredChainVerifier" in module).toBe(false);
    const value = receipt();
    await expect(verifyChainSettlementReceipt(value, { verificationReference: "forged", verifier: {} as never })).rejects.toThrow(/authority is unavailable/);
    expect(settlementReceiptAuthority(value).authoritative).toBe(false);
    const { escrowClassHash: _missing, ...withoutClass } = value;
    expect(() => settlementReceiptAuthority(withoutClass as ChainSettlementReceipt)).toThrow(/escrowClassHash/);
  });
  it("requires an exact reviewed public-hostname origin set", () => {
    const base = manifest(receipt());
    expect(assertReviewedReceiptRpcOrigins(base)).toEqual(base.reviewedRpcOrigins);
    for (const url of ["https://172.16.0.1", "https://[fd00::1]", "https://127.0.0.1", "https://rpc.local", "https://user:pass@rpc.example", "https://rpc.example/path"]) {
      expect(() => assertReviewedReceiptRpcOrigins({ ...base, rpcQuorum: [{ label: "a", url }, base.rpcQuorum[1]!] })).toThrow(/reviewed public HTTPS origin/);
    }
    expect(() => assertReviewedReceiptRpcOrigins({ ...base, reviewedRpcOrigins: [base.reviewedRpcOrigins[0]!, "https://other.example"] })).toThrow(/exactly match/);
  });
  it("proves membership using the canonical block fetched by block number", () => {
    const input = { block: { block_hash: "0xb1", block_number: 1, transactions: ["0xa"] }, expectedBlockHash: "0xb1", expectedBlockNumber: 1, transactionHash: "0xa", transactionIndex: 0 };
    expect(() => assertCanonicalBlockNumberMembership(input)).not.toThrow();
    expect(() => assertCanonicalBlockNumberMembership({ ...input, block: { ...input.block, block_hash: "0xb2" } })).toThrow(/canonical block at its block number/);
    expect(() => assertCanonicalBlockNumberMembership({ ...input, block: { ...input.block, transactions: ["0xc"] } })).toThrow(/canonical block at its block number/);
  });
  it("binds final commitment, directory, RFQ, context, and reservation fence", () => {
    const value = receipt(); expect(() => assertDecodedReceiptBinding(value, value)).not.toThrow();
    for (const key of ["commitmentDigest", "directoryDigest", "rfqDigest", "settlementContextDigest", "reservationFence"] as const) {
      const changed = key === "reservationFence" ? 10n : `0x${"22".repeat(32)}`;
      expect(() => assertDecodedReceiptBinding(value, { ...value, [key]: changed })).toThrow(new RegExp(String(key)));
    }
  });
});
