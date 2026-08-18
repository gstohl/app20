export const APP20_POLICY_RECEIPT_DOMAIN = "app20/policy-receipt/v1" as const;

export type PolicyEnforcementLevel =
  | "advisory"
  | "backend-gated"
  | "cryptographic";

export type PolicyReceiptV1 = {
  version: 1;
  domain: typeof APP20_POLICY_RECEIPT_DOMAIN;
  workflowId: string;
  workflowEpoch: number;
  intentDigest: string;
  revision: number;
  executionDigest: string;
  quoteDigest: string | null;
  policyVersion: string;
  attestationVendor: string;
  attestationChallenge: string;
  attestationEvidenceDigest: string;
  enclaveMeasurement: string;
  attestedEphemeralKey: string;
  decision: "allow" | "deny";
  constraintDigest: string;
  nonce: string;
  monotonicCounter: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};

export type AttestationEvidence = {
  vendor: string;
  measurement: string;
  ephemeralKey: string;
  challenge: string;
  issuedAt: string;
  expiresAt: string;
  debug: boolean;
  securityStatus: "up-to-date" | "out-of-date" | "revoked" | "unknown";
  evidenceDigest: string;
  rawEvidence: unknown;
};

export type ExpectedPolicyBinding = {
  workflowId: string;
  workflowEpoch: number;
  intentDigest: string;
  revision: number;
  executionDigest: string;
  quoteDigest: string | null;
  policyVersion: string;
  constraintDigest: string;
  nonce: string;
  challenge: string;
  attestationVendor: string;
  approvedMeasurements: ReadonlySet<string>;
};

export interface PolicyReceiptSignatureVerifier {
  verify(
    receipt: Readonly<PolicyReceiptV1>,
    canonicalPayload: Uint8Array,
  ): Promise<boolean>;
}

export interface AttestationVerifier {
  verify(evidence: Readonly<AttestationEvidence>): Promise<boolean>;
}

export type PolicyReplayResult = "accepted" | "replay" | "rollback";

export interface PolicyReplayGuard {
  /**
   * Atomically checks and durably consumes the nonce/signature while enforcing
   * a non-decreasing workflow epoch and strictly increasing counter for the
   * workflow/key scope. "accepted" may be returned only after that atomic
   * commit; a check followed by a separate write does not satisfy this contract.
   */
  consume(
    input: Readonly<{
      workflowId: string;
      workflowEpoch: number;
      attestedEphemeralKey: string;
      nonce: string;
      monotonicCounter: string;
      receiptSignature: string;
    }>,
  ): Promise<PolicyReplayResult>;
}

export type VerifiedPolicyApproval = Readonly<{
  verified: true;
  receipt: Readonly<PolicyReceiptV1>;
  evidence: Readonly<AttestationEvidence>;
}>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function strictKeys(
  value: UnknownRecord,
  label: string,
  keys: readonly string[],
): void {
  const unknownKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unknownKey !== undefined) {
    throw new Error(`${label} contains an unrecognized field (${unknownKey}).`);
  }
  const missingKey = keys.find((key) => !Object.hasOwn(value, key));
  if (missingKey !== undefined) {
    throw new Error(`${label} is missing required field ${missingKey}.`);
  }
}

function assertOpaqueValue(
  label: string,
  value: unknown,
  maximumLength = 4096,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\s]/u.test(value)
  ) {
    throw new Error(`${label} is malformed.`);
  }
}

function assertSafeNonNegativeInteger(
  label: string,
  value: unknown,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function parseTimestamp(label: string, value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new Error(`${label} must be a canonical RFC 3339 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  const normalizedInput = value.replace(".000Z", "Z");
  const normalizedParsed = Number.isFinite(parsed)
    ? new Date(parsed).toISOString().replace(".000Z", "Z")
    : "";
  if (normalizedParsed !== normalizedInput) {
    throw new Error(
      `${label} must be a real canonical RFC 3339 UTC timestamp.`,
    );
  }
  return parsed;
}

function assertCanonicalCounter(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new Error(
      "Policy receipt monotonicCounter must be a bounded canonical integer.",
    );
  }
}

const RECEIPT_FIELDS = [
  "version",
  "domain",
  "workflowId",
  "workflowEpoch",
  "intentDigest",
  "revision",
  "executionDigest",
  "quoteDigest",
  "policyVersion",
  "attestationVendor",
  "attestationChallenge",
  "attestationEvidenceDigest",
  "enclaveMeasurement",
  "attestedEphemeralKey",
  "decision",
  "constraintDigest",
  "nonce",
  "monotonicCounter",
  "issuedAt",
  "expiresAt",
  "signature",
] as const;

const EVIDENCE_FIELDS = [
  "vendor",
  "measurement",
  "ephemeralKey",
  "challenge",
  "issuedAt",
  "expiresAt",
  "debug",
  "securityStatus",
  "evidenceDigest",
  "rawEvidence",
] as const;

function assertPolicyReceipt(value: unknown): asserts value is PolicyReceiptV1 {
  const receipt = record(value, "PolicyReceiptV1");
  strictKeys(receipt, "PolicyReceiptV1", RECEIPT_FIELDS);
  if (receipt.version !== 1 || receipt.domain !== APP20_POLICY_RECEIPT_DOMAIN) {
    throw new Error("Unsupported APP20 policy receipt version or domain.");
  }
  assertSafeNonNegativeInteger(
    "Policy receipt workflowEpoch",
    receipt.workflowEpoch,
  );
  assertSafeNonNegativeInteger("Policy receipt revision", receipt.revision);
  for (const [label, field, maximumLength] of [
    ["workflowId", receipt.workflowId, 256],
    ["intentDigest", receipt.intentDigest, 1024],
    ["executionDigest", receipt.executionDigest, 1024],
    ["policyVersion", receipt.policyVersion, 256],
    ["attestationVendor", receipt.attestationVendor, 256],
    ["attestationChallenge", receipt.attestationChallenge, 1024],
    ["attestationEvidenceDigest", receipt.attestationEvidenceDigest, 1024],
    ["enclaveMeasurement", receipt.enclaveMeasurement, 2048],
    ["attestedEphemeralKey", receipt.attestedEphemeralKey, 4096],
    ["constraintDigest", receipt.constraintDigest, 1024],
    ["nonce", receipt.nonce, 1024],
    ["signature", receipt.signature, 8192],
  ] as const) {
    assertOpaqueValue(`Policy receipt ${label}`, field, maximumLength);
  }
  if (receipt.quoteDigest !== null) {
    assertOpaqueValue("Policy receipt quoteDigest", receipt.quoteDigest, 1024);
  }
  if (receipt.decision !== "allow" && receipt.decision !== "deny") {
    throw new Error("Policy receipt decision is not supported.");
  }
  assertCanonicalCounter(receipt.monotonicCounter);
  const issuedAt = parseTimestamp("receipt.issuedAt", receipt.issuedAt);
  const expiresAt = parseTimestamp("receipt.expiresAt", receipt.expiresAt);
  if (expiresAt <= issuedAt) {
    throw new Error("Policy receipt validity window is invalid.");
  }
}

function assertAttestationEvidence(
  value: unknown,
): asserts value is AttestationEvidence {
  const evidence = record(value, "AttestationEvidence");
  strictKeys(evidence, "AttestationEvidence", EVIDENCE_FIELDS);
  for (const [label, field, maximumLength] of [
    ["vendor", evidence.vendor, 256],
    ["measurement", evidence.measurement, 2048],
    ["ephemeralKey", evidence.ephemeralKey, 4096],
    ["challenge", evidence.challenge, 1024],
    ["evidenceDigest", evidence.evidenceDigest, 1024],
  ] as const) {
    assertOpaqueValue(`Attestation evidence ${label}`, field, maximumLength);
  }
  if (typeof evidence.debug !== "boolean") {
    throw new Error("Attestation evidence debug must be a boolean.");
  }
  if (
    typeof evidence.securityStatus !== "string" ||
    !["up-to-date", "out-of-date", "revoked", "unknown"].includes(
      evidence.securityStatus,
    )
  ) {
    throw new Error("Attestation evidence securityStatus is not supported.");
  }
  const issuedAt = parseTimestamp("evidence.issuedAt", evidence.issuedAt);
  const expiresAt = parseTimestamp("evidence.expiresAt", evidence.expiresAt);
  if (expiresAt <= issuedAt) {
    throw new Error("Attestation evidence validity window is invalid.");
  }
}

function snapshotReceipt(receipt: PolicyReceiptV1): Readonly<PolicyReceiptV1> {
  return Object.freeze({
    version: receipt.version,
    domain: receipt.domain,
    workflowId: receipt.workflowId,
    workflowEpoch: receipt.workflowEpoch,
    intentDigest: receipt.intentDigest,
    revision: receipt.revision,
    executionDigest: receipt.executionDigest,
    quoteDigest: receipt.quoteDigest,
    policyVersion: receipt.policyVersion,
    attestationVendor: receipt.attestationVendor,
    attestationChallenge: receipt.attestationChallenge,
    attestationEvidenceDigest: receipt.attestationEvidenceDigest,
    enclaveMeasurement: receipt.enclaveMeasurement,
    attestedEphemeralKey: receipt.attestedEphemeralKey,
    decision: receipt.decision,
    constraintDigest: receipt.constraintDigest,
    nonce: receipt.nonce,
    monotonicCounter: receipt.monotonicCounter,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    signature: receipt.signature,
  });
}

function snapshotEvidence(
  evidence: AttestationEvidence,
): Readonly<AttestationEvidence> {
  return Object.freeze({
    vendor: evidence.vendor,
    measurement: evidence.measurement,
    ephemeralKey: evidence.ephemeralKey,
    challenge: evidence.challenge,
    issuedAt: evidence.issuedAt,
    expiresAt: evidence.expiresAt,
    debug: evidence.debug,
    securityStatus: evidence.securityStatus,
    evidenceDigest: evidence.evidenceDigest,
    rawEvidence: evidence.rawEvidence,
  });
}

function assertEqual(
  label: string,
  actual: string | number | null,
  expected: string | number | null,
): void {
  if (actual !== expected) {
    throw new Error(
      `Policy receipt ${label} does not match the reviewed action.`,
    );
  }
}

/** The signature is deliberately excluded from these domain-separated bytes. */
export function canonicalizePolicyReceipt(receipt: PolicyReceiptV1): string {
  assertPolicyReceipt(receipt);
  return JSON.stringify({
    domain: receipt.domain,
    version: receipt.version,
    workflowId: receipt.workflowId,
    workflowEpoch: receipt.workflowEpoch,
    intentDigest: receipt.intentDigest,
    revision: receipt.revision,
    executionDigest: receipt.executionDigest,
    quoteDigest: receipt.quoteDigest,
    policyVersion: receipt.policyVersion,
    attestationVendor: receipt.attestationVendor,
    attestationChallenge: receipt.attestationChallenge,
    attestationEvidenceDigest: receipt.attestationEvidenceDigest,
    enclaveMeasurement: receipt.enclaveMeasurement,
    attestedEphemeralKey: receipt.attestedEphemeralKey,
    decision: receipt.decision,
    constraintDigest: receipt.constraintDigest,
    nonce: receipt.nonce,
    monotonicCounter: receipt.monotonicCounter,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  });
}

export function policyReceiptSignedBytes(receipt: PolicyReceiptV1): Uint8Array {
  return new TextEncoder().encode(canonicalizePolicyReceipt(receipt));
}

const EXPECTED_BINDING_FIELDS = [
  "workflowId",
  "workflowEpoch",
  "intentDigest",
  "revision",
  "executionDigest",
  "quoteDigest",
  "policyVersion",
  "constraintDigest",
  "nonce",
  "challenge",
  "attestationVendor",
  "approvedMeasurements",
] as const;

function assertExpectedBinding(expected: ExpectedPolicyBinding): void {
  strictKeys(
    record(expected, "ExpectedPolicyBinding"),
    "ExpectedPolicyBinding",
    EXPECTED_BINDING_FIELDS,
  );
  assertSafeNonNegativeInteger(
    "Expected workflowEpoch",
    expected.workflowEpoch,
  );
  assertSafeNonNegativeInteger("Expected revision", expected.revision);
  for (const [label, field, maximumLength] of [
    ["workflowId", expected.workflowId, 256],
    ["intentDigest", expected.intentDigest, 1024],
    ["executionDigest", expected.executionDigest, 1024],
    ["policyVersion", expected.policyVersion, 256],
    ["constraintDigest", expected.constraintDigest, 1024],
    ["nonce", expected.nonce, 1024],
    ["challenge", expected.challenge, 1024],
    ["attestationVendor", expected.attestationVendor, 256],
  ] as const) {
    assertOpaqueValue(`Expected policy ${label}`, field, maximumLength);
  }
  if (expected.quoteDigest !== null) {
    assertOpaqueValue(
      "Expected policy quoteDigest",
      expected.quoteDigest,
      1024,
    );
  }
  if (
    expected.approvedMeasurements === null ||
    typeof expected.approvedMeasurements !== "object" ||
    typeof expected.approvedMeasurements.has !== "function"
  ) {
    throw new Error(
      "Expected policy approvedMeasurements must be a read-only set.",
    );
  }
}

export async function verifyPolicyApproval(input: {
  receipt: PolicyReceiptV1;
  evidence: AttestationEvidence;
  expected: ExpectedPolicyBinding;
  signatureVerifier: PolicyReceiptSignatureVerifier;
  attestationVerifier: AttestationVerifier;
  replayGuard: PolicyReplayGuard;
  now?: number;
  maximumClockSkewMs?: number;
}): Promise<VerifiedPolicyApproval> {
  const now = input.now ?? Date.now();
  const maximumClockSkewMs = input.maximumClockSkewMs ?? 30_000;
  if (!Number.isFinite(now)) throw new Error("now must be a finite timestamp.");
  if (!Number.isFinite(maximumClockSkewMs) || maximumClockSkewMs < 0) {
    throw new Error("maximumClockSkewMs must be a non-negative finite number.");
  }
  if (
    input.signatureVerifier === null ||
    typeof input.signatureVerifier !== "object" ||
    typeof input.signatureVerifier.verify !== "function"
  ) {
    throw new Error(
      "An injected policy receipt signature verifier is required.",
    );
  }
  if (
    input.attestationVerifier === null ||
    typeof input.attestationVerifier !== "object" ||
    typeof input.attestationVerifier.verify !== "function"
  ) {
    throw new Error("An injected remote attestation verifier is required.");
  }
  if (
    input.replayGuard === null ||
    typeof input.replayGuard !== "object" ||
    typeof input.replayGuard.consume !== "function"
  ) {
    throw new Error("An injected atomic policy replay guard is required.");
  }

  assertPolicyReceipt(input.receipt);
  assertAttestationEvidence(input.evidence);
  assertExpectedBinding(input.expected);
  const receipt = snapshotReceipt(input.receipt);
  const evidence = snapshotEvidence(input.evidence);
  const expected = input.expected;

  if (receipt.decision !== "allow") {
    throw new Error("APP20 policy denied this action.");
  }
  assertEqual("workflowId", receipt.workflowId, expected.workflowId);
  assertEqual("workflowEpoch", receipt.workflowEpoch, expected.workflowEpoch);
  assertEqual("intentDigest", receipt.intentDigest, expected.intentDigest);
  assertEqual("revision", receipt.revision, expected.revision);
  assertEqual(
    "executionDigest",
    receipt.executionDigest,
    expected.executionDigest,
  );
  assertEqual("quoteDigest", receipt.quoteDigest, expected.quoteDigest);
  assertEqual("policyVersion", receipt.policyVersion, expected.policyVersion);
  assertEqual(
    "constraintDigest",
    receipt.constraintDigest,
    expected.constraintDigest,
  );
  assertEqual("nonce", receipt.nonce, expected.nonce);
  assertEqual(
    "attestation vendor",
    receipt.attestationVendor,
    expected.attestationVendor,
  );
  assertEqual(
    "attestation vendor evidence",
    evidence.vendor,
    expected.attestationVendor,
  );
  assertEqual(
    "attestation challenge",
    receipt.attestationChallenge,
    expected.challenge,
  );
  assertEqual(
    "attestation evidence digest",
    receipt.attestationEvidenceDigest,
    evidence.evidenceDigest,
  );
  assertEqual("measurement", receipt.enclaveMeasurement, evidence.measurement);
  assertEqual(
    "ephemeral key",
    receipt.attestedEphemeralKey,
    evidence.ephemeralKey,
  );
  assertEqual(
    "attestation challenge evidence",
    evidence.challenge,
    expected.challenge,
  );

  if (!expected.approvedMeasurements.has(receipt.enclaveMeasurement)) {
    throw new Error(
      "The enclave measurement is not approved for this APP20 policy.",
    );
  }
  if (evidence.debug) {
    throw new Error("Debug enclave evidence is not accepted.");
  }
  if (evidence.securityStatus !== "up-to-date") {
    throw new Error(
      `Enclave security status is ${evidence.securityStatus}; execution is disabled.`,
    );
  }

  const receiptIssuedAt = parseTimestamp("receipt.issuedAt", receipt.issuedAt);
  const receiptExpiresAt = parseTimestamp(
    "receipt.expiresAt",
    receipt.expiresAt,
  );
  const evidenceIssuedAt = parseTimestamp(
    "evidence.issuedAt",
    evidence.issuedAt,
  );
  const evidenceExpiresAt = parseTimestamp(
    "evidence.expiresAt",
    evidence.expiresAt,
  );
  if (
    receiptIssuedAt > now + maximumClockSkewMs ||
    evidenceIssuedAt > now + maximumClockSkewMs
  ) {
    throw new Error("Policy or attestation evidence is from the future.");
  }
  if (receiptExpiresAt <= now || evidenceExpiresAt <= now) {
    throw new Error("Policy or attestation evidence has expired.");
  }
  if (
    receiptIssuedAt < evidenceIssuedAt ||
    receiptExpiresAt > evidenceExpiresAt
  ) {
    throw new Error(
      "Policy receipt validity must remain inside the attestation window.",
    );
  }

  if ((await input.attestationVerifier.verify(evidence)) !== true) {
    throw new Error("Remote attestation verification failed.");
  }
  const canonicalPayload = policyReceiptSignedBytes(receipt);
  if (
    (await input.signatureVerifier.verify(receipt, canonicalPayload)) !== true
  ) {
    throw new Error("Policy receipt signature verification failed.");
  }

  const replayResult = await input.replayGuard.consume(
    Object.freeze({
      workflowId: receipt.workflowId,
      workflowEpoch: receipt.workflowEpoch,
      attestedEphemeralKey: receipt.attestedEphemeralKey,
      nonce: receipt.nonce,
      monotonicCounter: receipt.monotonicCounter,
      receiptSignature: receipt.signature,
    }),
  );
  if (replayResult === "replay") {
    throw new Error(
      "Policy receipt nonce or signature has already been consumed.",
    );
  }
  if (replayResult === "rollback") {
    throw new Error(
      "Policy receipt monotonic counter or workflow epoch rolled back.",
    );
  }
  if (replayResult !== "accepted") {
    throw new Error(
      "The atomic policy replay guard returned an invalid result.",
    );
  }

  return Object.freeze({
    verified: true,
    receipt,
    evidence,
  });
}

export function enforcementDisclosure(level: PolicyEnforcementLevel): string {
  switch (level) {
    case "advisory":
      return "Advisory: the signer can bypass this policy through another submission path.";
    case "backend-gated":
      return "Backend-gated: APP20 infrastructure requires approval, but alternate infrastructure may bypass it.";
    case "cryptographic":
      return "Cryptographic: the account or signer quorum requires this policy approval.";
    default:
      throw new Error("Unknown policy enforcement level.");
  }
}
