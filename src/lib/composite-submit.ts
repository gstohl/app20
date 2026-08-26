import type { CompositePayload } from "./composite";
import { computeActionId } from "./strk20";

export type CompositeSubmissionStep =
  | {
      kind: "fund_escrow";
      label: "funding escrow";
      /** Deal id is rejected by App20Escrow if Fund is replayed. */
      idempotencyKey: string;
    }
  | {
      kind: "send_document";
      label: "sending document";
      /** Non-zero helper action id rejects a replay of this document. */
      idempotencyKey: string;
    };

/**
 * The mail helper and escrow helper each consume the pool's single external
 * invoke phase. Metadata attachments and one STRK transfer can share the mail
 * transaction; an escrow Fund must be confirmed in its own transaction first.
 */
export function planCompositeSubmission(
  payload: CompositePayload,
): CompositeSubmissionStep[] {
  const escrow = payload.attachments.find(
    (attachment) => attachment.type === "escrow_fund",
  );
  const steps: CompositeSubmissionStep[] = [];
  if (escrow?.type === "escrow_fund") {
    steps.push({
      kind: "fund_escrow",
      label: "funding escrow",
      idempotencyKey: escrow.payload.dealId,
    });
  }
  steps.push({
    kind: "send_document",
    label: "sending document",
    idempotencyKey: computeActionId("composite-document", payload.documentId),
  });
  return steps;
}

export function submissionStepLabel(
  step: CompositeSubmissionStep,
  index: number,
  total: number,
): string {
  return `Step ${index + 1} of ${total} — ${step.label}`;
}
