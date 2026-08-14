const UNICODE_FORMAT_OR_SURROGATE = /[\p{Cf}\p{Cs}]/gu;
const UNICODE_CONTROL = /\p{Cc}/gu;

/** Remove bidi/format controls and neutralize remaining Unicode controls. */
export function sanitizeUntrustedText(value: string): string {
  return value
    .replace(UNICODE_FORMAT_OR_SURROGATE, "")
    .replace(UNICODE_CONTROL, " ");
}
