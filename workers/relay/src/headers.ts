export interface SpaSecurityConfig {
  privyFrameOrigins: readonly string[];
  privyConnectOrigins: readonly string[];
}

// Reviewed in code rather than runtime configuration: the opt-in public price
// chart is the only third-party origin the browser may reach, and widening this
// list is a security decision, not a deployment setting.
const PUBLIC_MARKET_DATA_ORIGINS = ["https://api.coingecko.com"] as const;

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
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      value.includes("*")
    ) {
      throw new Error(
        "SPA security origins must be reviewed HTTPS origins without wildcards.",
      );
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
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      `frame-src 'self' ${frames.join(" ")}`.trim(),
      `connect-src 'self' ${[...connections, ...PUBLIC_MARKET_DATA_ORIGINS].join(" ")}`.trim(),
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
    ].join("; "),
  );
  return headers;
}
