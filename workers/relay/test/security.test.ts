import test from "node:test";
import assert from "node:assert/strict";
import { abortScope } from "../src/abort.ts";
import { issueOhttpSession, spaSecurityHeaders } from "../src/index.ts";
import type { RelayEnv } from "../src/types.ts";

const baseEnv = {
  ENVIRONMENT: "production",
  OHTTP_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
} as RelayEnv;

test("session cookie is opaque, pseudonymous, short-lived, and strictly scoped", async () => {
  const identifier = "did:privy:wallet-plaintext-identifier-canary";
  const cookie = await issueOhttpSession(
    identifier,
    baseEnv,
    1_700_000_000_000,
  );
  assert.equal(cookie.includes(identifier), false);
  assert.match(cookie, /^app20_ohttp_session=[A-Za-z0-9_.%-]+;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/ohttp/);
  assert.match(cookie, /Max-Age=1800/);
});

test("production session secret must be at least 32 UTF-8 bytes", async () => {
  await assert.rejects(() =>
    issueOhttpSession("authenticated", {
      ...baseEnv,
      OHTTP_SESSION_SECRET: "too-short",
    }),
  );
});

test("abort scope enforces timeout and parent disconnect", async () => {
  const parent = new AbortController();
  const timeout = abortScope(parent.signal, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timeout.signal.aborted, true);
  timeout.close();

  const disconnected = abortScope(parent.signal, 10_000);
  parent.abort();
  assert.equal(disconnected.signal.aborted, true);
  disconnected.close();
});

test("SPA headers keep CSP byte-identical when optional IPFS origins are unset", () => {
  const config = {
    privyFrameOrigins: ["https://auth-frame.example.invalid"],
    privyConnectOrigins: ["https://auth-connect.example.invalid"],
  };
  const unset = spaSecurityHeaders(config).get("content-security-policy");
  const empty = spaSecurityHeaders({ ...config, ipfsOrigins: "" }).get(
    "content-security-policy",
  );
  assert.equal(empty, unset);
});

test("SPA headers append only validated HTTPS IPFS origins", () => {
  const config = {
    privyFrameOrigins: [],
    privyConnectOrigins: [],
  };
  const csp = spaSecurityHeaders({
    ...config,
    ipfsOrigins:
      "https://ipfs-rpc.example.invalid, https://ipfs-gateway.example.invalid",
  }).get("content-security-policy");
  assert.match(
    csp ?? "",
    /connect-src[^;]*https:\/\/ipfs-rpc\.example\.invalid/,
  );
  assert.match(
    csp ?? "",
    /connect-src[^;]*https:\/\/ipfs-gateway\.example\.invalid/,
  );
  for (const ipfsOrigins of [
    "http://ipfs.example.invalid",
    "https://*.example.invalid",
    "https://user@ipfs.example.invalid",
    "https://ipfs.example.invalid/path",
  ]) {
    assert.throws(() => spaSecurityHeaders({ ...config, ipfsOrigins }));
  }
});

test("SPA headers deny framing/sniffing/referrers and use reviewed Privy origins", () => {
  const headers = spaSecurityHeaders({
    privyFrameOrigins: ["https://auth-frame.example.invalid"],
    privyConnectOrigins: ["https://auth-connect.example.invalid"],
  });
  assert.equal(headers.get("referrer-policy"), "no-referrer");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(
    headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.match(
    headers.get("content-security-policy") ?? "",
    /https:\/\/auth-frame\.example\.invalid/,
  );
  assert.throws(() =>
    spaSecurityHeaders({
      privyFrameOrigins: ["https://*.example.invalid"],
      privyConnectOrigins: [],
    }),
  );
});
