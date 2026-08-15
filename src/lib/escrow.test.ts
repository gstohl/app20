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
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const tokenA = {
  symbol: "STRK",
  address:
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
};
const tokenB = { symbol: "USDC", address: "0x53c", decimals: 6 };
const dealId = "0x1234";

function fundPayload(): EscrowFundPayload {
  const claimPubkey = deriveEscrowClaimKey(new Uint8Array(32).fill(9), dealId)
    .claimPubkey;
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
 * Any such change requires a version bump from quietline/escrow-claim/v1.
 */
const CLAIM_KEY_VECTORS = [
  {
    seed: Uint8Array.from({ length: 32 }, (_, index) => index),
    dealId: "0x1",
    attempt: 1,
    privateKey:
      "027c4ed3bd1f7c066ce761377deecaf25614169f4a62124c230779932651b917",
    claimPubkey:
      "0x6b9e0b165e7179d49cedecf238461927d2e16183dcdfa9c6b71dfc8a9623fcf",
  },
  {
    seed: new Uint8Array(32).fill(0xab),
    dealId: "0x123456789abcdef",
    attempt: 0,
    privateKey:
      "00336622cc32d6b5be8c3d98c157926e54ec33ba13ef4049a70a102527f7e3ef",
    claimPubkey:
      "0x53e27f2d11256ae9d4fc9a37bd0dfaefa620cdab76dff8aa8987a025257698f",
  },
  {
    seed: new Uint8Array(32).fill(0xff),
    dealId:
      "0x11111111111111111111111111111111111111111111111111111111111111",
    attempt: 1,
    privateKey:
      "0648ff4960a228b4fa6262bf536565e299a71429ae4287da12fef026a76a5060",
    claimPubkey:
      "0x1a121b5617b463492e39275d9edacb5e66352e4dfdc5e0044cc63c87580358e",
  },
] as const;

describe("escrow claim-key derivation", () => {
  it("locks the documented unbiased derivation with frozen vectors", () => {
    expect(ESCROW_CLAIM_KEY_LABEL).toBe("quietline/escrow-claim/v1");
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
    const originalSeed = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
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
      operations: { fund: { state: "pending" } },
    });
    expect(() =>
      claimEscrowOperation(...scope, dealId, "fund", 102),
    ).toThrow(/no second transfer/i);
    expect(
      confirmEscrowOperation(...scope, dealId, "fund", "0xabc", 103),
    ).toMatchObject({
      operations: {
        fund: { state: "confirmed", transactionHash: "0xabc" },
      },
    });
    expect(() =>
      claimEscrowOperation(...scope, dealId, "fund", 104),
    ).toThrow(/no second transfer/i);
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
    expect(releaseEscrowOperation(...scope, dealId, "fill", 103)?.operations)
      .not.toHaveProperty("fill");
    claimEscrowOperation(...scope, dealId, "fill", 104);
    confirmEscrowOperation(...scope, dealId, "fill", "0xdef", 105);
    expect(() =>
      claimEscrowOperation(...scope, dealId, "fill", 106),
    ).toThrow(/no second transfer/i);

    recordEscrowChainDeal(...scope, dealId, { ...funded, status: "filled" }, 107);
    claimEscrowOperation(...scope, dealId, "claim", 108);
    confirmEscrowOperation(...scope, dealId, "claim", "0xaaa", 109);
    expect(() =>
      claimEscrowOperation(...scope, dealId, "claim", 110),
    ).toThrow(/no second transfer/i);
    expect(loadEscrowState(...scope).deals[dealId]).toMatchObject({
      chainStatus: "filled",
      operations: {
        fill: { state: "confirmed" },
        claim: { state: "confirmed" },
      },
    });
  });
});
