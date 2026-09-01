import { describe, expect, it } from "vitest";
import {
  MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE,
  MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE,
} from "./mail-authority-copy";

describe("Mail key authority disclosures", () => {
  it("states both powers conferred by the recovery phrase", () => {
    expect(MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE).toMatch(
      /read your Mail correspondence/i,
    );
    expect(MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE).toMatch(
      /create payment requests that display as verified from you/i,
    );
    expect(MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE).toMatch(
      /cannot revoke.*if the phrase is compromised/i,
    );
  });

  it("limits what a verified Mail signature proves", () => {
    expect(MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE).toMatch(
      /exact displayed message.*displayed Mail key/i,
    );
    expect(MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE).toMatch(
      /does not prove who signed it/i,
    );
    expect(MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE).toMatch(
      /they control the named wallet/i,
    );
    expect(MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE).toMatch(
      /cannot revoke a compromised Mail key/i,
    );
  });
});
