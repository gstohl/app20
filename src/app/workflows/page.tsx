import {
  APP20_POLICY_RECEIPT_DOMAIN,
  enforcementDisclosure,
  verifyPolicyApproval,
  type AttestationEvidence,
  type ExpectedPolicyBinding,
  type PolicyReceiptV1,
} from "@app20/policy-client";
import { useEffect, useState } from "react";
import styles from "./workflows.module.css";

const LOCAL_FIXTURE_NOW = Date.parse("2030-01-01T00:05:00.000Z");
const EXPECTED_SIGNATURE_FAILURE =
  "Policy receipt signature verification failed.";

const LOCAL_UNSIGNED_RECEIPT: PolicyReceiptV1 = Object.freeze({
  version: 1,
  domain: APP20_POLICY_RECEIPT_DOMAIN,
  workflowId: "local-policy-demo",
  workflowEpoch: 1,
  intentDigest: "0xlocal-intent-digest",
  revision: 1,
  executionDigest: "0xlocal-execution-digest",
  quoteDigest: null,
  policyVersion: "local-review-v1",
  attestationVendor: "unconfigured-local-fixture",
  attestationChallenge: "local-review-challenge",
  attestationEvidenceDigest: "0xlocal-evidence-digest",
  enclaveMeasurement: "local-unapproved-measurement",
  attestedEphemeralKey: "local-fixture-ephemeral-key",
  decision: "allow",
  constraintDigest: "0xlocal-constraint-digest",
  nonce: "local-review-nonce",
  monotonicCounter: "1",
  issuedAt: "2030-01-01T00:04:00.000Z",
  expiresAt: "2030-01-01T00:06:00.000Z",
  signature: "unsigned-local-fixture",
});

const LOCAL_FIXTURE_EVIDENCE: AttestationEvidence = Object.freeze({
  vendor: "unconfigured-local-fixture",
  measurement: "local-unapproved-measurement",
  ephemeralKey: "local-fixture-ephemeral-key",
  challenge: "local-review-challenge",
  issuedAt: "2030-01-01T00:03:00.000Z",
  expiresAt: "2030-01-01T00:07:00.000Z",
  debug: false,
  securityStatus: "up-to-date",
  evidenceDigest: "0xlocal-evidence-digest",
  rawEvidence: Object.freeze({ fixture: "local-only" }),
});

const LOCAL_EXPECTED_BINDING: ExpectedPolicyBinding = Object.freeze({
  workflowId: "local-policy-demo",
  workflowEpoch: 1,
  intentDigest: "0xlocal-intent-digest",
  revision: 1,
  executionDigest: "0xlocal-execution-digest",
  quoteDigest: null,
  policyVersion: "local-review-v1",
  constraintDigest: "0xlocal-constraint-digest",
  nonce: "local-review-nonce",
  challenge: "local-review-challenge",
  attestationVendor: "unconfigured-local-fixture",
  approvedMeasurements: new Set(["local-unapproved-measurement"]),
});

export type LocalReceiptCheck = Readonly<{
  state: "blocked";
  reason: string;
}>;

/**
 * Exercises the production verifier with a deliberately unsigned local
 * receipt. Every path returns blocked: even an unexpected verifier success
 * cannot enable execution in this review-only surface.
 */
export async function verifyLocalDemoReceipt(): Promise<LocalReceiptCheck> {
  try {
    await verifyPolicyApproval({
      receipt: LOCAL_UNSIGNED_RECEIPT,
      evidence: LOCAL_FIXTURE_EVIDENCE,
      expected: LOCAL_EXPECTED_BINDING,
      attestationVerifier: {
        // This local fixture tests receipt verification only. It does not
        // contact or represent a remote attestation service.
        verify: async () => true,
      },
      signatureVerifier: {
        // The fixture is intentionally unsigned and must fail closed here.
        verify: async () => false,
      },
      replayGuard: {
        // Signature verification fails before replay state can be consumed.
        consume: async () => "accepted",
      },
      now: LOCAL_FIXTURE_NOW,
    });
  } catch (error) {
    return Object.freeze({
      state: "blocked",
      reason:
        error instanceof Error
          ? error.message
          : "Local policy verification failed closed.",
    });
  }

  return Object.freeze({
    state: "blocked",
    reason:
      "Local receipt unexpectedly verified; execution remains disabled by the advisory demo boundary.",
  });
}

const INITIAL_RECEIPT_CHECK: LocalReceiptCheck = Object.freeze({
  state: "blocked",
  reason: EXPECTED_SIGNATURE_FAILURE,
});

export default function WorkflowsPage() {
  const [receiptCheck, setReceiptCheck] = useState<LocalReceiptCheck>(
    INITIAL_RECEIPT_CHECK,
  );

  useEffect(() => {
    let active = true;
    void verifyLocalDemoReceipt().then((result) => {
      if (active) setReceiptCheck(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>APP20 / POLICY WORKFLOWS</p>
          <h1>Review policy evidence before execution exists.</h1>
          <p className={styles.lede}>
            A vendor-neutral reference desk for binding a logical intent first,
            then the exact execution terms. This build contains no workflow
            engine and sends no private input.
          </p>
        </div>
        <div className={styles.releaseBadge} aria-label="Review-only status">
          <span>ENFORCEMENT</span>
          <strong>ADVISORY</strong>
          <small>CANNOT RUN</small>
        </div>
      </header>

      <section
        className={styles.boundary}
        aria-labelledby="workflow-boundary-title"
      >
        <span className={styles.boundaryMark} aria-hidden="true">
          ×
        </span>
        <div>
          <strong id="workflow-boundary-title">
            Execution boundary closed
          </strong>
          <p>
            No Run control, no vendor TEE, no value authorization, no wallet
            signature, and no submission path are present in this page.
          </p>
        </div>
        <code>REVIEW_ONLY</code>
      </section>

      <div className={styles.workspace}>
        <section
          className={styles.policyPanel}
          aria-labelledby="policy-sequence-title"
        >
          <div className={styles.panelHeader}>
            <div>
              <span>POLICY SEQUENCE</span>
              <h2 id="policy-sequence-title">Two-phase authorization model</h2>
            </div>
            <p>Order is mandatory</p>
          </div>

          <ol className={styles.phaseTrack}>
            <li className={styles.phase}>
              <div className={styles.phaseIndex}>
                <span>01</span>
                <i aria-hidden="true" />
              </div>
              <div className={styles.phaseBody}>
                <div className={styles.phaseMeta}>
                  <span>PHASE 01 · PREFLIGHT</span>
                  <em>BEFORE SIDE EFFECTS</em>
                </div>
                <h3>Review the logical intent</h3>
                <p>
                  Bind account, chain, asset, recipient, integer amount bounds,
                  fee ceiling, deadline, refund target, and each disclosure
                  recipient before quote or provider contact.
                </p>
                <ul>
                  <li>Intent digest and revision</li>
                  <li>Constraints and disclosure set</li>
                  <li>Policy version and workflow epoch</li>
                </ul>
              </div>
            </li>

            <li className={styles.phase}>
              <div className={styles.phaseIndex}>
                <span>02</span>
                <i aria-hidden="true" />
              </div>
              <div className={styles.phaseBody}>
                <div className={styles.phaseMeta}>
                  <span>PHASE 02 · FINAL</span>
                  <em>EXACT TERMS REQUIRED</em>
                </div>
                <h3>Bind the exact execution</h3>
                <p>
                  Re-evaluate the final execution digest, quote, fees,
                  attestation evidence, nonce, counter, challenge, and validity
                  window. Changed terms require a new receipt.
                </p>
                <ul>
                  <li>Execution and quote digests</li>
                  <li>Measurement and ephemeral key</li>
                  <li>Atomic replay and rollback guard</li>
                </ul>
              </div>
            </li>
          </ol>

          <div className={styles.advisoryCard}>
            <div>
              <span>SHIPPED ENFORCEMENT LEVEL</span>
              <strong>ADVISORY</strong>
            </div>
            <p>{enforcementDisclosure("advisory")}</p>
          </div>

          <footer className={styles.noExecution}>
            <span aria-hidden="true">LOCKED</span>
            <p>
              This model explains the authorization sequence. It does not grant
              APP20, a TEE, or a receipt signer authority over funds.
            </p>
          </footer>
        </section>

        <aside
          className={styles.receiptPanel}
          aria-labelledby="receipt-verification-title"
        >
          <div className={styles.panelHeader}>
            <div>
              <span>LOCAL RECEIPT LAB</span>
              <h2 id="receipt-verification-title">Fail-closed verification</h2>
            </div>
            <p className={styles.failedChip}>BLOCKED</p>
          </div>

          <div className={styles.receiptSummary}>
            <div>
              <span>Receipt source</span>
              <strong>Local fixture</strong>
            </div>
            <div>
              <span>Signature</span>
              <strong className={styles.invalidValue}>
                UNSIGNED / INVALID
              </strong>
            </div>
            <div>
              <span>TEE vendor</span>
              <strong>None configured</strong>
            </div>
            <div>
              <span>Requested decision</span>
              <strong>Allow · untrusted</strong>
            </div>
          </div>

          <div className={styles.verificationFailure} role="alert">
            <span>VERIFICATION FAILED CLOSED</span>
            <strong>{receiptCheck.reason}</strong>
            <p>
              The receipt is structurally complete but deliberately unsigned.
              The policy client rejects it; replay state is not consumed and no
              action becomes available.
            </p>
          </div>

          <div className={styles.receiptTrace}>
            <span>LOCAL CHECK TRACE</span>
            <ol>
              <li className={styles.tracePass}>
                <b>01</b> Parse strict receipt schema
              </li>
              <li className={styles.tracePass}>
                <b>02</b> Compare expected bindings
              </li>
              <li className={styles.traceFail}>
                <b>03</b> Reject invalid signature
              </li>
              <li className={styles.traceBlocked}>
                <b>04</b> Keep replay guard untouched
              </li>
            </ol>
          </div>

          <p className={styles.localOnlyNote}>
            This check runs locally against an in-repository fixture. It does
            not call an enclave, provider, signer, wallet, or chain.
          </p>
        </aside>
      </div>

      <section
        className={styles.disclosure}
        aria-labelledby="workflow-disclosure-title"
      >
        <div className={styles.disclosureIntro}>
          <span>DATA DISCLOSURE</span>
          <h2 id="workflow-disclosure-title">Know which boundary sees what.</h2>
        </div>
        <ul aria-label="Workflow disclosure legend">
          <li>
            <span className={styles.localDot} aria-hidden="true" />
            <div>
              <strong>LOCAL ONLY</strong>
              <small>
                Draft intent and private inputs stay on this device.
              </small>
            </div>
          </li>
          <li>
            <span className={styles.enclaveDot} aria-hidden="true" />
            <div>
              <strong>SENT TO ENCLAVE</strong>
              <small>
                Plaintext visible to approved measured code. None sent now.
              </small>
            </div>
          </li>
          <li>
            <span className={styles.attestationDot} aria-hidden="true" />
            <div>
              <strong>ATTESTATION REQUIRED</strong>
              <small>
                Fresh vendor evidence, measurement, key, and challenge.
              </small>
            </div>
          </li>
          <li>
            <span className={styles.publicDot} aria-hidden="true" />
            <div>
              <strong>PUBLIC ON-CHAIN</strong>
              <small>
                Submission, amounts, addresses, and timing when released.
              </small>
            </div>
          </li>
        </ul>
      </section>
    </main>
  );
}
