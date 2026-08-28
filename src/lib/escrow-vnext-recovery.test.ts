import { describe, expect, it } from "vitest";
import {
  buildVnextRecoveryExecution,
  canonicalVnextRecoveryOperation,
  createVnextRecoveryTuple,
  validateVnextRecoveryCandidate,
  type ConfiguredVnextRecoveryAuthority,
  type VnextRecoveryBinding,
  type VnextRecoveryInput,
} from "./escrow-vnext-recovery";

const D = `0x${"11".repeat(32)}`;
const ZERO_LOW_LIMB = `0x${"11".repeat(16)}${"00".repeat(16)}`;
const ZERO_HIGH_LIMB = `0x${"00".repeat(16)}${"11".repeat(16)}`;
const ZERO_DIGEST = `0x${"00".repeat(32)}`;
const binding: VnextRecoveryBinding = {
  chainId: "starknet:LOCALNET",
  account: "0xa11ce",
  escrowAddress: "0xe5c",
  escrowClassHash: "0xec1",
  app20ClaimAddress: "0xc1a1",
  app20ClaimClassHash: "0xc1a55",
  app20ClaimIdentity: "0xc1a1",
  dealId: "0xd001",
  commitmentDigest: D,
  poolAddress: "0x9001",
  destinationAddress: "0xa11ce",
  deadline: 200,
  authorityRevision: 7,
  attemptId: "attempt-7",
};

const policy = {
  activeAccount: binding.account,
  minimumAuthorityRevision: binding.authorityRevision,
  attempt: { id: binding.attemptId, status: "not-started" as const },
  now: 250,
};

const terms = {
  sellToken: "0xaaa",
  sellAmountBaseUnits: 500n,
  buyToken: "0xbbb",
  buyAmountBaseUnits: 700n,
};

const claimInput: VnextRecoveryInput = {
  ...binding,
  ...policy,
  ...terms,
  phase: "claim",
  observation: {
    binding,
    finalized: true,
    observedAt: 240,
    stage: "Filled",
    buyToken: terms.buyToken,
    buyAmountBaseUnits: terms.buyAmountBaseUnits,
  },
};

const refundInput: VnextRecoveryInput = {
  ...binding,
  ...policy,
  ...terms,
  phase: "refund",
  observation: {
    binding,
    finalized: true,
    observedAt: 240,
    stage: "Funded",
    fillObserved: false,
    sellToken: terms.sellToken,
    sellAmountBaseUnits: terms.sellAmountBaseUnits,
  },
};

const unavailableAuthority = {} as ConfiguredVnextRecoveryAuthority;

describe("Escrow VNext phase recovery candidates", () => {
  it("validates claim and refund candidates only against a complete finalized binding", () => {
    expect(validateVnextRecoveryCandidate(claimInput)).toEqual({
      ...binding,
      phase: "claim",
      buyToken: terms.buyToken,
      buyAmountBaseUnits: terms.buyAmountBaseUnits,
    });
    expect(validateVnextRecoveryCandidate(refundInput)).toEqual({
      ...binding,
      phase: "refund",
      sellToken: terms.sellToken,
      sellAmountBaseUnits: terms.sellAmountBaseUnits,
    });

    for (const changed of [
      { dealId: "0xd002" },
      { escrowAddress: "0xe5d" },
      { commitmentDigest: `0x${"22".repeat(32)}` },
      { destinationAddress: "0xb0b" },
      { authorityRevision: 8 },
    ]) {
      expect(() =>
        validateVnextRecoveryCandidate({
          ...claimInput,
          observation: {
            ...claimInput.observation,
            binding: { ...binding, ...changed },
          },
        }),
      ).toThrow(/Finalized recovery observation does not match/);
    }
  });

  it("accepts whole-zero Digest256 commitments in both recovery phases", () => {
    for (const commitmentDigest of [
      ZERO_LOW_LIMB,
      ZERO_HIGH_LIMB,
      ZERO_DIGEST,
    ]) {
      const digestBinding = { ...binding, commitmentDigest };
      expect(
        validateVnextRecoveryCandidate({
          ...claimInput,
          ...digestBinding,
          observation: {
            ...claimInput.observation,
            binding: digestBinding,
          },
        }),
      ).toMatchObject({ commitmentDigest, phase: "claim" });
      expect(
        validateVnextRecoveryCandidate({
          ...refundInput,
          ...digestBinding,
          observation: {
            ...refundInput.observation,
            binding: digestBinding,
          },
        }),
      ).toMatchObject({ commitmentDigest, phase: "refund" });
    }
  });

  it("retains nonzero binding and asset identities", () => {
    for (const key of [
      "account",
      "escrowAddress",
      "escrowClassHash",
      "app20ClaimAddress",
      "app20ClaimClassHash",
      "app20ClaimIdentity",
      "dealId",
      "poolAddress",
      "destinationAddress",
    ] as const) {
      expect(() =>
        validateVnextRecoveryCandidate({ ...claimInput, [key]: "0x0" }),
      ).toThrow(/must not be zero/);
    }
    expect(() =>
      validateVnextRecoveryCandidate({
        ...claimInput,
        buyToken: "0x0",
        observation: { ...claimInput.observation, buyToken: "0x0" },
      }),
    ).toThrow(/buyToken must not be zero/);
    expect(() =>
      validateVnextRecoveryCandidate({
        ...refundInput,
        sellToken: "0x0",
        observation: { ...refundInput.observation, sellToken: "0x0" },
      }),
    ).toThrow(/sellToken must not be zero/);
  });

  it("emits independent literal nonzero Claim/Timeout recovery operations", () => {
    const claimOperation = canonicalVnextRecoveryOperation(
      validateVnextRecoveryCandidate(claimInput),
    );
    const timeoutOperation = canonicalVnextRecoveryOperation(
      validateVnextRecoveryCandidate(refundInput),
    );

    expect(claimOperation).toEqual({
      kind: "Claim",
      payload: {
        commitmentDigest:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        claimIdentity: "0xc1a1",
      },
    });
    expect(Object.keys(claimOperation)).toEqual(["kind", "payload"]);
    expect(Object.keys(claimOperation.payload)).toEqual([
      "commitmentDigest",
      "claimIdentity",
    ]);

    expect(timeoutOperation).toEqual({
      kind: "Timeout",
      payload: {
        commitmentDigest:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        claimIdentity: "0xc1a1",
      },
    });
    expect(Object.keys(timeoutOperation)).toEqual(["kind", "payload"]);
    expect(Object.keys(timeoutOperation.payload)).toEqual([
      "commitmentDigest",
      "claimIdentity",
    ]);
  });

  it("retains separate all-zero Claim/Timeout recovery vectors", () => {
    const zeroBinding = { ...binding, commitmentDigest: ZERO_DIGEST };
    const zeroClaimTuple = validateVnextRecoveryCandidate({
      ...claimInput,
      ...zeroBinding,
      observation: { ...claimInput.observation, binding: zeroBinding },
    });
    const zeroRefundTuple = validateVnextRecoveryCandidate({
      ...refundInput,
      ...zeroBinding,
      observation: { ...refundInput.observation, binding: zeroBinding },
    });
    expect(canonicalVnextRecoveryOperation(zeroClaimTuple).payload).toEqual({
      commitmentDigest: ZERO_DIGEST,
      claimIdentity: "0xc1a1",
    });
    expect(canonicalVnextRecoveryOperation(zeroRefundTuple).payload).toEqual({
      commitmentDigest: ZERO_DIGEST,
      claimIdentity: "0xc1a1",
    });
  });

  it("rejects number, string, NaN, infinity, and missing persisted amount casts", () => {
    const invalidRuntimeValues: unknown[] = [
      1,
      "1",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
    ];
    for (const value of invalidRuntimeValues) {
      for (const input of [claimInput, refundInput]) {
        for (const key of [
          "sellAmountBaseUnits",
          "buyAmountBaseUnits",
        ] as const) {
          expect(() =>
            validateVnextRecoveryCandidate({
              ...input,
              [key]: value,
            } as unknown as VnextRecoveryInput),
          ).toThrow(/positive u256 bigint/);
        }
      }
      expect(() =>
        validateVnextRecoveryCandidate({
          ...claimInput,
          observation: {
            ...claimInput.observation,
            buyAmountBaseUnits: value,
          },
        } as unknown as VnextRecoveryInput),
      ).toThrow(/positive u256 bigint/);
      expect(() =>
        validateVnextRecoveryCandidate({
          ...refundInput,
          observation: {
            ...refundInput.observation,
            sellAmountBaseUnits: value,
          },
        } as unknown as VnextRecoveryInput),
      ).toThrow(/positive u256 bigint/);

      const claimTuple = validateVnextRecoveryCandidate(claimInput);
      const refundTuple = validateVnextRecoveryCandidate(refundInput);
      const invalidClaimTuple = {
        ...claimTuple,
        buyAmountBaseUnits: value,
      } as unknown as typeof claimTuple;
      const invalidRefundTuple = {
        ...refundTuple,
        sellAmountBaseUnits: value,
      } as unknown as typeof refundTuple;
      expect(() => canonicalVnextRecoveryOperation(invalidClaimTuple)).toThrow(
        /positive u256 bigint/,
      );
      expect(() => canonicalVnextRecoveryOperation(invalidRefundTuple)).toThrow(
        /positive u256 bigint/,
      );
      expect(() =>
        buildVnextRecoveryExecution({
          authority: unavailableAuthority,
          tuple: invalidClaimTuple,
          current: {
            ...policy,
            observation: {
              ...claimInput.observation,
              buyAmountBaseUnits: value,
            },
          },
          mode: "ready",
        } as unknown as Parameters<typeof buildVnextRecoveryExecution>[0]),
      ).toThrow(/positive u256 bigint/);
      expect(() =>
        buildVnextRecoveryExecution({
          authority: unavailableAuthority,
          tuple: invalidRefundTuple,
          current: {
            ...policy,
            observation: {
              ...refundInput.observation,
              sellAmountBaseUnits: value,
            },
          },
          mode: "privy",
        } as unknown as Parameters<typeof buildVnextRecoveryExecution>[0]),
      ).toThrow(/positive u256 bigint/);
    }
  });

  it("rejects asset inversion, pre-deadline refunds, and unsafe observation clocks", () => {
    expect(() =>
      validateVnextRecoveryCandidate({
        ...claimInput,
        observation: { ...claimInput.observation, buyToken: terms.sellToken },
      }),
    ).toThrow(/committed buy asset/);
    expect(() =>
      validateVnextRecoveryCandidate({
        ...refundInput,
        now: 199,
        observation: { ...refundInput.observation, observedAt: 199 },
      }),
    ).toThrow(/before the commitment deadline/);
    expect(() =>
      validateVnextRecoveryCandidate({
        ...refundInput,
        observation: { ...refundInput.observation, observedAt: Number.NaN },
      }),
    ).toThrow(/observation time/);
  });

  it("rejects stale policy and every non-new attempt state", () => {
    expect(() =>
      validateVnextRecoveryCandidate({
        ...claimInput,
        minimumAuthorityRevision: 8,
      }),
    ).toThrow(/stale/);
    expect(() =>
      validateVnextRecoveryCandidate({ ...claimInput, activeAccount: "0xb0b" }),
    ).toThrow(/account changed/);
    for (const status of [
      "preparing",
      "submitted-unknown",
      "reverted",
    ] as const) {
      expect(() =>
        validateVnextRecoveryCandidate({
          ...claimInput,
          attempt: { id: binding.attemptId, status },
        }),
      ).toThrow(/already in progress or reconciled/);
    }
  });

  it("rejects private note, witness, and viewing-key material", () => {
    expect(() =>
      validateVnextRecoveryCandidate({
        ...claimInput,
        openNoteIds: ["secret"],
      } as unknown as VnextRecoveryInput),
    ).toThrow(/private material/);
    expect(() =>
      validateVnextRecoveryCandidate({
        ...claimInput,
        witness: "secret",
      } as unknown as VnextRecoveryInput),
    ).toThrow(/private material/);
    expect(() =>
      validateVnextRecoveryCandidate({
        ...claimInput,
        viewingKey: "secret",
      } as unknown as VnextRecoveryInput),
    ).toThrow(/private material/);
  });

  it("does not authorize a tuple from a caller-fabricated capability", () => {
    expect(() =>
      createVnextRecoveryTuple(unavailableAuthority, claimInput),
    ).toThrow(/Configured VNext recovery authority is unavailable/);
  });

  it("revalidates current account, authority, attempt, and complete observation before execution", () => {
    const tuple = validateVnextRecoveryCandidate(claimInput);
    const current = { ...policy, observation: claimInput.observation };

    expect(() =>
      buildVnextRecoveryExecution({
        authority: unavailableAuthority,
        tuple,
        current: { ...current, activeAccount: "0xb0b" },
        mode: "ready",
      }),
    ).toThrow(/account changed/);
    expect(() =>
      buildVnextRecoveryExecution({
        authority: unavailableAuthority,
        tuple,
        current: {
          ...current,
          observation: {
            ...claimInput.observation,
            binding: { ...binding, dealId: "0xd002" },
          },
        },
        mode: "ready",
      }),
    ).toThrow(/does not match dealId/);
    expect(() =>
      buildVnextRecoveryExecution({
        authority: unavailableAuthority,
        tuple,
        current: {
          ...current,
          attempt: { id: binding.attemptId, status: "preparing" },
        },
        mode: "privy",
      }),
    ).toThrow(/already in progress or reconciled/);
    expect(() =>
      buildVnextRecoveryExecution({
        authority: unavailableAuthority,
        tuple,
        current: {
          ...current,
          observation: { ...claimInput.observation, observedAt: 0 },
        },
        mode: "ready",
      }),
    ).toThrow(/current finalized observation and trusted clock/);
  });

  it("accepts no ABI, operation, or Privy calldata override and emits nothing", () => {
    const tuple = validateVnextRecoveryCandidate(claimInput);
    for (const mode of ["ready", "privy"] as const) {
      const forged = {
        authority: unavailableAuthority,
        tuple,
        current: { ...policy, observation: claimInput.observation },
        mode,
        abi: { selector: "0x123" },
        encodedOperation: { kind: "Claim", calldata: ["0xf00d"] },
        privyCalldata: () => ({ contractAddress: "0xdead", calldata: [] }),
      } as unknown as Parameters<typeof buildVnextRecoveryExecution>[0];
      expect(() => buildVnextRecoveryExecution(forged)).toThrow(
        /Configured VNext recovery authority is unavailable/,
      );
    }
  });
});
