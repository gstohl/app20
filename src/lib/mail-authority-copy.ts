export const MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE =
  "Anyone with this recovery phrase can read your Mail correspondence and create payment requests that display as verified from you. APP20 currently cannot revoke this Mail key if the phrase is compromised.";

export const MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE =
  "A valid Mail signature proves only that the exact displayed message was signed by the displayed Mail key. It does not prove who signed it or that they control the named wallet. APP20 currently cannot revoke a compromised Mail key, so anyone with the recovery phrase can create requests that pass this check. Confirm the person and wallet through a trusted channel before paying.";
