import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorkflowsPage, { verifyLocalDemoReceipt } from "./page";

function pageMarkup(): string {
  return renderToStaticMarkup(createElement(WorkflowsPage));
}

function pageText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("APP20 advisory workflow policy demo", () => {
  it("shows preflight before final policy and labels enforcement advisory", () => {
    const text = pageText(pageMarkup());
    const preflight = text.indexOf("PHASE 01 · PREFLIGHT");
    const final = text.indexOf("PHASE 02 · FINAL");

    expect(preflight).toBeGreaterThan(-1);
    expect(final).toBeGreaterThan(preflight);
    expect(text).toContain("Two-phase authorization model");
    expect(text).toContain("SHIPPED ENFORCEMENT LEVEL ADVISORY");
    expect(text).toContain(
      "Advisory: the signer can bypass this policy through another submission path.",
    );
  });

  it("exercises the policy client with an unsigned fixture and fails closed", async () => {
    await expect(verifyLocalDemoReceipt()).resolves.toEqual({
      state: "blocked",
      reason: "Policy receipt signature verification failed.",
    });

    const text = pageText(pageMarkup());
    expect(text).toContain("UNSIGNED / INVALID");
    expect(text).toContain("VERIFICATION FAILED CLOSED");
    expect(text).toContain("Policy receipt signature verification failed.");
    expect(text).toContain("replay state is not consumed");
  });

  it("has no workflow execution control or value-authorization claim", () => {
    const markup = pageMarkup();
    const text = pageText(markup);

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('role="button"');
    expect(text).toContain("CANNOT RUN");
    expect(text).toContain(
      "No Run control, no vendor TEE, no value authorization",
    );
    expect(text).toContain("no wallet signature, and no submission path");
    expect(text).toContain(
      "It does not grant APP20, a TEE, or a receipt signer authority over funds.",
    );
  });

  it("shows the complete disclosure legend", () => {
    const text = pageText(pageMarkup());

    for (const label of [
      "LOCAL ONLY",
      "SENT TO ENCLAVE",
      "ATTESTATION REQUIRED",
      "PUBLIC ON-CHAIN",
    ]) {
      expect(text).toContain(label);
    }
  });
});
