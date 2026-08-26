export interface SpaSecurityConfig {
  privyFrameOrigins: readonly string[];
  privyConnectOrigins: readonly string[];
}

function reviewedOrigins(values: readonly string[]): string[] {
  return values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new Error(
        "SPA security origins must be valid reviewed HTTPS origins.",
        { cause: error },
      );
    }
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || value.includes("*")) {
      throw new Error("SPA security origins must be reviewed HTTPS origins without wildcards.");
    }
    return url.origin;
  });
}

export function spaSecurityHeaders(config: SpaSecurityConfig): Headers {
  const frames = reviewedOrigins(config.privyFrameOrigins);
  const connections = reviewedOrigins(config.privyConnectOrigins);
  const headers = new Headers();
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      `frame-src 'self' ${frames.join(" ")}`.trim(),
      `connect-src 'self' ${connections.join(" ")}`.trim(),
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
    ].join("; "),
  );
  return headers;
}
