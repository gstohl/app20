import { describe, expect, it, vi } from "vitest";
import {
  APP20_POLICY_RECEIPT_DOMAIN,
  canonicalizePolicyReceipt,
  enforcementDisclosure,
  policyReceiptSignedBytes,
  verifyPolicyApproval,
  type AttestationEvidence,
  type ExpectedPolicyBinding,
  type PolicyReceiptV1,
  type PolicyReplayGuard,
  type PolicyReplayResult,
} from "./index";

const NOW = Date.parse("2030-01-01T00:05:00.000Z");

function receipt(overrides: Partial<PolicyReceiptV1> = {}): PolicyReceiptV1 {
  return {
    version: 1,
    domain: APP20_POLICY_RECEIPT_DOMAIN,
    workflowId: "workflow-123",
    workflowEpoch: 7,
    intentDigest: "0xintent",
    revision: 2,
    executionDigest: "0xexecution",
    quoteDigest: "0xquote",
    policyVersion: "policy-4",
    attestationVendor: "test-vendor",
    attestationChallenge: "challenge-123",
    attestationEvidenceDigest: "0xevidence",
    enclaveMeasurement: "measurement-approved",
    attestedEphemeralKey: "ephemeral-key",
    decision: "allow",
    constraintDigest: "0xconstraints",
    nonce: "nonce-123",
    monotonicCounter: "42",
    issuedAt: "2030-01-01T00:04:00.000Z",
    expiresAt: "2030-01-01T00:06:00.000Z",
    signature: "signature",
    ...overrides,
  };
}

function evidence(
  overrides: Partial<AttestationEvidence> = {},
): AttestationEvidence {
  return {
    vendor: "test-vendor",
    measurement: "measurement-approved",
    ephemeralKey: "ephemeral-key",
    challenge: "challenge-123",
    issuedAt: "2030-01-01T00:04:00.000Z",
    expiresAt: "2030-01-01T00:06:00.000Z",
    debug: false,
    securityStatus: "up-to-date",
    evidenceDigest: "0xevidence",
    rawEvidence: {},
    ...overrides,
  };
}

function expected(
  overrides: Partial<ExpectedPolicyBinding> = {},
): ExpectedPolicyBinding {
  return {
    workflowId: "workflow-123",
    workflowEpoch: 7,
    intentDigest: "0xintent",
    revision: 2,
    executionDigest: "0xexecution",
    quoteDigest: "0xquote",
    policyVersion: "policy-4",
    constraintDigest: "0xconstraints",
    nonce: "nonce-123",
    challenge: "challenge-123",
    attestationVendor: "test-vendor",
    approvedMeasurements: new Set(["measurement-approved"]),
    ...overrides,
  };
}

function verify(
  overrides: {
    receipt?: PolicyReceiptV1;
    evidence?: AttestationEvidence;
    expected?: ExpectedPolicyBinding;
    attestationValid?: unknown;
    signatureValid?: unknown;
    replayGuard?: PolicyReplayGuard;
    replayResult?: unknown;
    now?: number;
  } = {},
) {
  const attestationVerifier = {
    verify: vi.fn(
      async (_evidence: Readonly<AttestationEvidence>) =>
        (overrides.attestationValid ?? true) as boolean,
    ),
  };
  const signatureVerifier = {
    verify: vi.fn(
      async (
        _receipt: Readonly<PolicyReceiptV1>,
        _canonicalPayload: Uint8Array,
      ) => (overrides.signatureValid ?? true) as boolean,
    ),
  };
  const replayGuard = overrides.replayGuard ?? {
    consume: vi.fn(
      async () => (overrides.replayResult ?? "accepted") as PolicyReplayResult,
    ),
  };
  return {
    promise: verifyPolicyApproval({
      receipt: overrides.receipt ?? receipt(),
      evidence: overrides.evidence ?? evidence(),
      expected: overrides.expected ?? expected(),
      attestationVerifier,
      signatureVerifier,
      replayGuard,
      now: overrides.now ?? NOW,
    }),
    attestationVerifier,
    signatureVerifier,
    replayGuard,
  };
}

describe("APP20 policy approval verification", () => {
  it("binds a valid allow receipt to reviewed execution and evidence", async () => {
    const result = verify();
    await expect(result.promise).resolves.toMatchObject({ verified: true });
    expect(result.attestationVerifier.verify).toHaveBeenCalledOnce();
    expect(result.signatureVerifier.verify).toHaveBeenCalledOnce();
    const payload = result.signatureVerifier.verify.mock.calls[0]?.[1];
    expect(new TextDecoder().decode(payload)).toBe(
      canonicalizePolicyReceipt(receipt()),
    );
    expect(payload).toEqual(policyReceiptSignedBytes(receipt()));
    const signedText = new TextDecoder().decode(payload);
    expect(signedText).not.toContain('"signature"');
    expect(signedText).toContain('"attestationChallenge":"challenge-123"');
    expect(signedText).toContain('"attestationEvidenceDigest":"0xevidence"');
  });

  it("changes signed bytes for every required security binding", () => {
    const base = canonicalizePolicyReceipt(receipt());
    const mutations: readonly PolicyReceiptV1[] = [
      receipt({ workflowId: "workflow-124" }),
      receipt({ workflowEpoch: 8 }),
      receipt({ intentDigest: "0xintent-other" }),
      receipt({ revision: 3 }),
      receipt({ executionDigest: "0xexecution-other" }),
      receipt({ quoteDigest: "0xquote-other" }),
      receipt({ policyVersion: "policy-5" }),
      receipt({ attestationVendor: "other-vendor" }),
      receipt({ attestationChallenge: "challenge-124" }),
      receipt({ attestationEvidenceDigest: "0xevidence-other" }),
      receipt({ enclaveMeasurement: "measurement-other" }),
      receipt({ attestedEphemeralKey: "ephemeral-key-other" }),
      receipt({ decision: "deny" }),
      receipt({ constraintDigest: "0xconstraints-other" }),
      receipt({ nonce: "nonce-124" }),
      receipt({ monotonicCounter: "43" }),
      receipt({ issuedAt: "2030-01-01T00:04:01.000Z" }),
      receipt({ expiresAt: "2030-01-01T00:05:59.000Z" }),
    ];
    for (const mutation of mutations) {
      expect(canonicalizePolicyReceipt(mutation)).not.toBe(base);
    }
    expect(
      canonicalizePolicyReceipt(receipt({ signature: "other-signature" })),
    ).toBe(base);
  });

  it.each([
    ["workflow", receipt({ workflowId: "workflow-other" })],
    ["workflow epoch", receipt({ workflowEpoch: 8 })],
    ["intent", receipt({ intentDigest: "0xother" })],
    ["revision", receipt({ revision: 3 })],
    ["execution", receipt({ executionDigest: "0xother" })],
    ["quote", receipt({ quoteDigest: "0xother" })],
    ["policy", receipt({ policyVersion: "policy-5" })],
    ["attestation vendor", receipt({ attestationVendor: "other-vendor" })],
    [
      "attestation challenge",
      receipt({ attestationChallenge: "other-challenge" }),
    ],
    ["attestation digest", receipt({ attestationEvidenceDigest: "0xother" })],
    ["measurement", receipt({ enclaveMeasurement: "measurement-other" })],
    ["ephemeral key", receipt({ attestedEphemeralKey: "other-key" })],
    ["constraint", receipt({ constraintDigest: "0xother" })],
    ["nonce", receipt({ nonce: "other" })],
  ])("rejects a changed %s binding", async (_label, changed) => {
    await expect(
      verify({ receipt: changed as PolicyReceiptV1 }).promise,
    ).rejects.toThrow(/does not match/i);
  });

  it("rejects deny, debug, stale, revoked, and unapproved evidence", async () => {
    await expect(
      verify({ receipt: receipt({ decision: "deny" }) }).promise,
    ).rejects.toThrow(/denied/i);
    await expect(
      verify({ evidence: evidence({ debug: true }) }).promise,
    ).rejects.toThrow(/debug/i);
    await expect(
      verify({
        receipt: receipt({ expiresAt: "2030-01-01T00:05:00.000Z" }),
      }).promise,
    ).rejects.toThrow(/expired/i);
    await expect(
      verify({ evidence: evidence({ securityStatus: "revoked" }) }).promise,
    ).rejects.toThrow(/revoked/i);
    await expect(
      verify({
        expected: expected({ approvedMeasurements: new Set(["other"]) }),
      }).promise,
    ).rejects.toThrow(/not approved/i);
  });

  it("rejects malformed and unbound receipt or evidence fields before crypto", async () => {
    const extraReceipt = {
      ...receipt(),
      enforcementLevel: "cryptographic",
    } as PolicyReceiptV1;
    const extraEvidence = {
      ...evidence(),
      hostClaim: "unbound",
    } as AttestationEvidence;
    const malformed = [
      verify({ receipt: extraReceipt }),
      verify({ evidence: extraEvidence }),
      verify({ receipt: receipt({ quoteDigest: "" }) }),
      verify({ receipt: receipt({ monotonicCounter: "01" }) }),
      verify({
        receipt: receipt({ issuedAt: "2030-02-30T00:04:00.000Z" }),
      }),
    ];
    for (const attempt of malformed) {
      await expect(attempt.promise).rejects.toThrow(
        /unrecognized|malformed|canonical|real canonical/i,
      );
      expect(attempt.attestationVerifier.verify).not.toHaveBeenCalled();
      expect(attempt.signatureVerifier.verify).not.toHaveBeenCalled();
    }
  });

  it("rejects evidence replacement even when the attested key is reused", async () => {
    await expect(
      verify({
        evidence: evidence({
          challenge: "fresh-challenge",
          evidenceDigest: "0xfresh",
        }),
        expected: expected({ challenge: "fresh-challenge" }),
      }).promise,
    ).rejects.toThrow(/evidence digest|challenge/i);
  });

  it("atomically rejects replayed nonces, counters, and workflow epochs", async () => {
    const used = new Set<string>();
    let highestEpoch = -1;
    let highestCounter = -1n;
    const replayGuard: PolicyReplayGuard = {
      consume: vi.fn(async (input) => {
        expect(Object.isFrozen(input)).toBe(true);
        if (used.has(input.nonce) || used.has(input.receiptSignature)) {
          return "replay";
        }
        const counter = BigInt(input.monotonicCounter);
        if (
          input.workflowEpoch < highestEpoch ||
          (input.workflowEpoch === highestEpoch && counter <= highestCounter)
        ) {
          return "rollback";
        }
        if (input.workflowEpoch > highestEpoch) {
          highestEpoch = input.workflowEpoch;
          highestCounter = -1n;
        }
        used.add(input.nonce);
        used.add(input.receiptSignature);
        highestCounter = counter;
        return "accepted";
      }),
    };

    await expect(verify({ replayGuard }).promise).resolves.toMatchObject({
      verified: true,
    });
    await expect(verify({ replayGuard }).promise).rejects.toThrow(/consumed/i);
    await expect(
      verify({
        replayGuard,
        receipt: receipt({
          nonce: "nonce-124",
          signature: "signature-124",
          monotonicCounter: "41",
        }),
        expected: expected({ nonce: "nonce-124" }),
      }).promise,
    ).rejects.toThrow(/rolled back/i);
    await expect(
      verify({
        replayGuard,
        receipt: receipt({
          workflowEpoch: 6,
          nonce: "nonce-125",
          signature: "signature-125",
          monotonicCounter: "100",
        }),
        expected: expected({
          workflowEpoch: 6,
          nonce: "nonce-125",
        }),
      }).promise,
    ).rejects.toThrow(/rolled back/i);
  });

  it("allows only one concurrent consumption of the same receipt", async () => {
    let consumed = false;
    const replayGuard: PolicyReplayGuard = {
      consume: vi.fn(async () => {
        if (consumed) return "replay";
        consumed = true;
        await Promise.resolve();
        return "accepted";
      }),
    };
    const results = await Promise.allSettled([
      verify({ replayGuard }).promise,
      verify({ replayGuard }).promise,
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("requires an injected atomic guard and rejects unknown guard outcomes", async () => {
    const attestationVerifier = { verify: vi.fn(async () => true) };
    const signatureVerifier = { verify: vi.fn(async () => true) };
    await expect(
      verifyPolicyApproval({
        receipt: receipt(),
        evidence: evidence(),
        expected: expected(),
        attestationVerifier,
        signatureVerifier,
        replayGuard: undefined as unknown as PolicyReplayGuard,
        now: NOW,
      }),
    ).rejects.toThrow(/atomic policy replay guard is required/i);
    expect(attestationVerifier.verify).not.toHaveBeenCalled();
    expect(signatureVerifier.verify).not.toHaveBeenCalled();
    await expect(verify({ replayResult: "unknown" }).promise).rejects.toThrow(
      /invalid result/i,
    );
  });

  it("fails closed unless attestation and signature verifiers return true", async () => {
    await expect(verify({ attestationValid: false }).promise).rejects.toThrow(
      /attestation/i,
    );
    await expect(verify({ attestationValid: 1 }).promise).rejects.toThrow(
      /attestation/i,
    );
    await expect(verify({ signatureValid: false }).promise).rejects.toThrow(
      /signature/i,
    );
    await expect(verify({ signatureValid: 1 }).promise).rejects.toThrow(
      /signature/i,
    );
  });

  it("snapshots mutable semantic fields before asynchronous verification", async () => {
    const mutableReceipt = receipt();
    const mutableEvidence = evidence();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attestationVerifier = {
      verify: vi.fn(async () => {
        await gate;
        return true;
      }),
    };
    const signatureVerifier = {
      verify: vi.fn(
        async (
          _receipt: Readonly<PolicyReceiptV1>,
          _canonicalPayload: Uint8Array,
        ) => true,
      ),
    };
    const replayGuard: PolicyReplayGuard = {
      consume: vi.fn(async () => "accepted" as const),
    };
    const pending = verifyPolicyApproval({
      receipt: mutableReceipt,
      evidence: mutableEvidence,
      expected: expected(),
      attestationVerifier,
      signatureVerifier,
      replayGuard,
      now: NOW,
    });
    mutableReceipt.executionDigest = "0xmutated-after-check";
    mutableEvidence.measurement = "mutated-after-check";
    (mutableEvidence.rawEvidence as { host?: string }).host = "mutated";
    release();
    const result = await pending;
    expect(result.receipt.executionDigest).toBe("0xexecution");
    expect(result.evidence.measurement).toBe("measurement-approved");
    expect(result.evidence.rawEvidence).toEqual({});
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(
      new TextDecoder().decode(signatureVerifier.verify.mock.calls[0]?.[1]),
    ).toContain('"executionDigest":"0xexecution"');
  });

  it("rejects rawEvidence that cannot be snapshotted", async () => {
    await expect(
      verify({
        evidence: evidence({ rawEvidence: () => undefined }),
      }).promise,
    ).rejects.toThrow(/cannot be snapshotted/i);
    await expect(
      verify({
        evidence: evidence({ rawEvidence: "x".repeat(262_145) }),
      }).promise,
    ).rejects.toThrow(/too large/i);
  });

  it("does not accept or return a caller-selected enforcement label", async () => {
    const callerLabeled = {
      ...expected(),
      enforcementLevel: "cryptographic",
    } as ExpectedPolicyBinding;
    await expect(verify({ expected: callerLabeled }).promise).rejects.toThrow(
      /unrecognized field/i,
    );
    const result = await verify().promise;
    expect(result).not.toHaveProperty("enforcementLevel");
    expect(result.receipt).not.toHaveProperty("enforcementLevel");
  });

  it("rejects non-finite verifier time", async () => {
    await expect(verify({ now: Number.NaN }).promise).rejects.toThrow(
      /finite/i,
    );
  });

  it("describes configured enforcement separately without overstating control", () => {
    expect(enforcementDisclosure("advisory")).toMatch(/can bypass/i);
    expect(enforcementDisclosure("backend-gated")).toMatch(
      /alternate infrastructure/i,
    );
    expect(enforcementDisclosure("cryptographic")).toMatch(/requires/i);
  });
});
