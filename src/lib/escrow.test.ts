import { describe, expect, it } from "vitest";
import { ec, num } from "starknet";
import { exportMailSeed, restoreMailSeed } from "@/components/mail/seedBackup";
import {
  ESCROW_CLAIM_KEY_LABEL,
  STARK_CURVE_SCALAR_ORDER,
  claimEscrowOperation,
  computeEscrowClaimMessage,
  confirmEscrowOperation,
  contractDealMatchesFund,
  deriveEscrowClaimKey,
  loadEscrowState,
  markEscrowOperationOutcome,
  markEscrowOperationSubmitted,
  parseEscrowContractDeal,
  parseEscrowFundPayload,
  recordEscrowChainDeal,
  recordEscrowFund,
  releaseEscrowOperation,
  signEscrowPayout,
  type EscrowFundPayload,
} from "./escrow";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const tokenA = {
  symbol: "STRK",
  address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
};
const tokenB = { symbol: "USDC", address: "0x53c", decimals: 6 };
const dealId = "0x1234";

function fundPayload(): EscrowFundPayload {
  const claimPubkey = deriveEscrowClaimKey(
    new Uint8Array(32).fill(9),
    dealId,
  ).claimPubkey;
  return {
    dealId,
    escrowAddress: "0xe5c",
    maker: "0xa11ce",
    legA: { token: tokenA, amount: "10000000000000000" },
    legB: { token: tokenB, amount: "2500000" },
    deadline: 2_000_000_000,
    claimPubkey,
    note: "Contract-backed terms",
  };
}

/**
 * FROZEN V1 VECTORS. Changing IKM/salt/info length or ordering, HKDF length,
 * the 252-bit mask, or rejection rule silently destroys existing claim access.
 * Any such change requires a version bump from app20/escrow-claim/v1.
 * These are public test-only seeds/scalars, never a persisted user claim key.
 */
const CLAIM_KEY_VECTORS = [
  {
    seed: Uint8Array.from({ length: 32 }, (_, index) => index),
    dealId: "0x1",
    attempt: 1,
    privateKey:
      "063258d10b00eff964e8b2728d8b53aa6576bd6ebec42eb1693079fa1d06f86f",
    claimPubkey:
      "0x3416b948f33c36b599c8ee887f9e1aa82544ff6513c2d162e2389ea1696f781",
  },
  {
    seed: new Uint8Array(32).fill(0xab),
    dealId: "0x123456789abcdef",
    attempt: 0,
    privateKey:
      "007ca6b29e07e6a01f1638477db2709ad06346769137906c40f55899f2b8f781",
    claimPubkey:
      "0x5fb6b2be82e153b6f826d35f3f36d13d7907863adcdea3256dacc21c0a0d493",
  },
  {
    seed: new Uint8Array(32).fill(0xff),
    dealId: "0x11111111111111111111111111111111111111111111111111111111111111",
    attempt: 3,
    privateKey:
      "06c23ff46ea7b3ad304d055925e954282360cb65e5eb7ef00d9dfdf1bb32f92d",
    claimPubkey:
      "0x209c77d515dfeadc01ff191a0e1488bcf8ee41f1af07f2a43879bd165e13705",
  },
] as const;

describe("escrow claim-key derivation", () => {
  it("locks the documented unbiased derivation with frozen vectors", () => {
    expect(ESCROW_CLAIM_KEY_LABEL).toBe("app20/escrow-claim/v1");
    for (const vector of CLAIM_KEY_VECTORS) {
      const key = deriveEscrowClaimKey(vector.seed, vector.dealId);
      expect(hex(key.privateKey)).toBe(vector.privateKey);
      expect(key.claimPubkey).toBe(vector.claimPubkey);
      expect(key.derivationAttempt).toBe(vector.attempt);
      const scalar = BigInt(`0x${hex(key.privateKey)}`);
      expect(scalar).toBeGreaterThan(0n);
      expect(scalar).toBeLessThan(STARK_CURVE_SCALAR_ORDER);
    }
  });

  it("restoring the mailbox backup restores every per-deal claim key", () => {
    const originalSeed = Uint8Array.from(
      { length: 32 },
      (_, index) => 255 - index,
    );
    const before = deriveEscrowClaimKey(originalSeed, dealId);
    const restored = restoreMailSeed(exportMailSeed(originalSeed));
    const after = deriveEscrowClaimKey(restored.seed, dealId);

    expect(after).toEqual(before);
    expect(restored.seed).toEqual(originalSeed);
  });

  it("signs the exact contract claim message with the derived public key", () => {
    const seed = new Uint8Array(32).fill(0x31);
    const escrowAddress = "0xe5c";
    const noteId = "0xcafe";
    const key = deriveEscrowClaimKey(seed, dealId);
    const message = computeEscrowClaimMessage(
      escrowAddress,
      dealId,
      "claim",
      noteId,
    );
    const signature = signEscrowPayout(
      seed,
      escrowAddress,
      dealId,
      "claim",
      noteId,
    );

    const fullPublicKey = ec.starkCurve.getPublicKey(key.privateKey);
    expect(num.toHex(ec.starkCurve.getStarkKey(key.privateKey))).toBe(
      key.claimPubkey,
    );
    expect(
      ec.starkCurve.verify(
        new ec.starkCurve.Signature(
          BigInt(signature.sigR),
          BigInt(signature.sigS),
        ),
        message,
        fullPublicKey,
      ),
    ).toBe(true);
    expect(
      ec.starkCurve.verify(
        new ec.starkCurve.Signature(
          BigInt(signature.sigR),
          BigInt(signature.sigS),
        ),
        computeEscrowClaimMessage(escrowAddress, dealId, "claim", "0xcaff"),
        fullPublicKey,
      ),
    ).toBe(false);
  });

  it("rejects malformed seed and deal inputs", () => {
    expect(() => deriveEscrowClaimKey(new Uint8Array(31), dealId)).toThrow(
      /32 bytes/i,
    );
    expect(() => deriveEscrowClaimKey(new Uint8Array(32), "0x0")).toThrow(
      /non-zero felt/i,
    );
  });
});

describe("escrow payload and contract state", () => {
  it("normalizes a Fund envelope and rejects same-token or oversized terms", () => {
    const parsed = parseEscrowFundPayload({
      ...fundPayload(),
      escrowAddress: "0x000e5c",
      maker: "0x000a11ce",
      note: "Pay\u2066 privately\u0000now",
    });
    expect(parsed).toMatchObject({
      escrowAddress: "0xe5c",
      maker: "0xa11ce",
      note: "Pay privately now",
    });
    expect(
      parseEscrowFundPayload({
        ...fundPayload(),
        legB: { token: tokenA, amount: "1" },
      }),
    ).toBeNull();
    expect(
      parseEscrowFundPayload({
        ...fundPayload(),
        legB: { token: tokenB, amount: (2n ** 128n).toString() },
      }),
    ).toBeNull();
  });

  it("parses the Cairo Deal flattening and verifies encrypted terms", () => {
    const fund = fundPayload();
    const deal = parseEscrowContractDeal([
      fund.legA.token.address,
      fund.legA.amount,
      fund.legB.token.address,
      fund.legB.amount,
      "0x0",
      num.toHex(fund.deadline),
      fund.claimPubkey,
      "0x1",
    ]);
    expect(deal.status).toBe("funded");
    expect(contractDealMatchesFund(deal, fund)).toBe(true);
    expect(contractDealMatchesFund({ ...deal, legBTerms: "1" }, fund)).toBe(
      false,
    );
  });
});

describe("escrow operation idempotency", () => {
  it("reserves Fund synchronously and never permits a second transfer", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xa11ce"] as const;
    const fund = fundPayload();
    recordEscrowFund(...scope, fund, 100);

    expect(claimEscrowOperation(...scope, dealId, "fund", 101)).toMatchObject({
      operations: { fund: { state: "reserved" } },
    });
    expect(() => claimEscrowOperation(...scope, dealId, "fund", 102)).toThrow(
      /no second transfer/i,
    );
    expect(() =>
      markEscrowOperationSubmitted(
        ...scope,
        "not-a-felt",
        "fund",
        "0xabc",
        103,
      ),
    ).toThrow(/No matching escrow operation reservation/i);
    expect(
      markEscrowOperationSubmitted(...scope, dealId, "fund", "0xabc", 103),
    ).toMatchObject({
      operations: {
        fund: { state: "submitted", transactionHash: "0xabc" },
      },
    });
    expect(releaseEscrowOperation(...scope, dealId, "fund", 104)).toMatchObject(
      {
        operations: { fund: { state: "submitted" } },
      },
    );
    expect(() => claimEscrowOperation(...scope, dealId, "fund", 105)).toThrow(
      /no second transfer/i,
    );
    expect(
      confirmEscrowOperation(...scope, dealId, "fund", "0xabc", 106),
    ).toMatchObject({
      operations: {
        fund: { state: "confirmed", transactionHash: "0xabc" },
      },
    });
  });

  it("allows release only before submission and blocks second Fill and Claim", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    const fund = fundPayload();
    recordEscrowFund(...scope, fund, 100);
    const funded = parseEscrowContractDeal([
      fund.legA.token.address,
      fund.legA.amount,
      fund.legB.token.address,
      fund.legB.amount,
      "0x0",
      num.toHex(fund.deadline),
      fund.claimPubkey,
      "0x1",
    ]);
    recordEscrowChainDeal(...scope, dealId, funded, 101);

    claimEscrowOperation(...scope, dealId, "fill", 102);
    expect(
      releaseEscrowOperation(...scope, dealId, "fill", 103)?.operations,
    ).not.toHaveProperty("fill");
    claimEscrowOperation(...scope, dealId, "fill", 104);
    markEscrowOperationSubmitted(...scope, dealId, "fill", "0xdef", 105);
    confirmEscrowOperation(...scope, dealId, "fill", "0xdef", 106);
    expect(() => claimEscrowOperation(...scope, dealId, "fill", 106)).toThrow(
      /no second transfer/i,
    );

    recordEscrowChainDeal(
      ...scope,
      dealId,
      { ...funded, status: "filled" },
      107,
    );
    claimEscrowOperation(...scope, dealId, "claim", 108);
    markEscrowOperationSubmitted(...scope, dealId, "claim", "0xaaa", 109);
    confirmEscrowOperation(...scope, dealId, "claim", "0xaaa", 110);
    expect(() => claimEscrowOperation(...scope, dealId, "claim", 110)).toThrow(
      /no second transfer/i,
    );
    expect(loadEscrowState(...scope).deals[dealId]).toMatchObject({
      chainStatus: "filled",
      operations: {
        fill: { state: "confirmed" },
        claim: { state: "confirmed" },
      },
    });
  });

  it("keeps unknown submissions blocked and permits a proven revert retry", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xa11ce"] as const;
    recordEscrowFund(...scope, fundPayload(), 100);
    claimEscrowOperation(...scope, dealId, "fund", 101);
    markEscrowOperationSubmitted(...scope, dealId, "fund", "0xabc", 102);
    expect(
      markEscrowOperationOutcome(
        ...scope,
        dealId,
        "fund",
        "0xabc",
        "unknown",
        103,
      ),
    ).toMatchObject({ operations: { fund: { state: "unknown" } } });
    expect(() => claimEscrowOperation(...scope, dealId, "fund", 104)).toThrow(
      /no second transfer/i,
    );

    const retryStorage = new MemoryStorage();
    const retryScope = [retryStorage, "SN_SEPOLIA", "0xa11ce"] as const;
    recordEscrowFund(...retryScope, fundPayload(), 100);
    claimEscrowOperation(...retryScope, dealId, "fund", 101);
    markEscrowOperationSubmitted(...retryScope, dealId, "fund", "0xdef", 102);
    expect(
      markEscrowOperationOutcome(
        ...retryScope,
        dealId,
        "fund",
        "0xdef",
        "reverted",
        103,
      ),
    ).toMatchObject({ operations: { fund: { state: "reverted" } } });
    expect(
      claimEscrowOperation(...retryScope, dealId, "fund", 104),
    ).toMatchObject({
      operations: { fund: { state: "reserved" } },
    });
  });
});
