import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  EgressFailure,
  EgressRefusal,
  assertHttpsUrl,
  createEgressSession,
  createPinnedHttpsFetch,
  createPinnedLookup,
  isPublicAddress,
  readBoundedResponseText,
  reresolvePinnedEndpoint,
  resolvePublicEndpoint,
} from "./egress-policy.mjs";

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:4700:4700::1111";

function publicLookup(addresses = [PUBLIC_V4]) {
  return async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
}

function httpsResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("isPublicAddress denies private, link-local, and special-purpose IPv4", () => {
  const refused = [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.20",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ];
  for (const address of refused) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress(PUBLIC_V4), true);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("8.8.8.8"), true);
});

test("isPublicAddress denies loopback, ULA, link-local, mapped, and documentation IPv6", () => {
  const refused = [
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "2001:db8::1",
    "2001::1",
    "2001:2::1",
    "2001:20::1",
    "2002::1",
    "3fff::1",
  ];
  for (const address of refused) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress(PUBLIC_V6), true);
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
});

test("assertHttpsUrl refuses non-HTTPS origins and embedded credentials", () => {
  assert.equal(
    assertHttpsUrl("https://rpc.example.invalid/path").hostname,
    "rpc.example.invalid",
  );
  awaitableRefusal(
    () => assertHttpsUrl("http://rpc.example.invalid"),
    /HTTPS origin/,
  );
  awaitableRefusal(() => assertHttpsUrl("/relative"), /absolute HTTPS URL/);
  awaitableRefusal(
    () => assertHttpsUrl("https://user:pass@rpc.example.invalid"),
    /embedded credentials/,
  );
});

function awaitableRefusal(fn, pattern) {
  assert.throws(
    fn,
    (error) => error instanceof EgressRefusal && pattern.test(error.message),
  );
}

test("resolvePublicEndpoint refuses mixed public/private DNS answers before connect", async () => {
  const fetched = false;
  await assert.rejects(
    resolvePublicEndpoint(new URL("https://rpc.example.invalid"), {
      lookupImpl: publicLookup([PUBLIC_V4, "192.168.1.20"]),
    }),
    (error) =>
      error instanceof EgressRefusal &&
      /public IP addresses/.test(error.message),
  );
  assert.equal(fetched, false);
});

test("resolvePublicEndpoint refuses literal non-public addresses without lookup", async () => {
  for (const href of [
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://[2001:db8::1]",
  ]) {
    await assert.rejects(
      resolvePublicEndpoint(new URL(href), {
        lookupImpl: async () => assert.fail("must not look up a literal"),
      }),
      (error) =>
        error instanceof EgressRefusal &&
        /public IP addresses/.test(error.message),
    );
  }
});

test("pinned lookup ignores later DNS answers and returns the validated endpoint", async () => {
  const lookup = createPinnedLookup({ address: PUBLIC_V4, family: 4 });
  const single = await new Promise((resolve, reject) => {
    lookup("evil.example.invalid", {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  const all = await new Promise((resolve, reject) => {
    lookup("evil.example.invalid", { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
  assert.deepEqual(single, { address: PUBLIC_V4, family: 4 });
  assert.deepEqual(all, [{ address: PUBLIC_V4, family: 4 }]);
});

test("re-resolution refuses when the pin is missing or a private address appears", async () => {
  const url = new URL("https://rpc.example.invalid");
  const endpoint = { address: PUBLIC_V4, family: 4 };
  await assert.rejects(
    reresolvePinnedEndpoint(url, endpoint, {
      lookupImpl: publicLookup(["1.1.1.1"]),
    }),
    (error) =>
      error instanceof EgressRefusal && /re-resolution/.test(error.message),
  );
  await assert.rejects(
    reresolvePinnedEndpoint(url, endpoint, {
      lookupImpl: publicLookup([PUBLIC_V4, "127.0.0.1"]),
    }),
    (error) =>
      error instanceof EgressRefusal &&
      /public IP addresses/.test(error.message),
  );
  const same = await reresolvePinnedEndpoint(url, endpoint, {
    lookupImpl: publicLookup([PUBLIC_V4, "1.1.1.1"]),
  });
  assert.equal(same.address, PUBLIC_V4);
});

test("default HTTPS transport pins SNI and Host to the original hostname", async () => {
  const captured = [];
  const requestImpl = (url, options) => {
    captured.push({ url, options });
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const response = new Readable({
        read() {
          this.push(Buffer.from("{}"));
          this.push(null);
        },
      });
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };
      request.emit("response", response);
    };
    return request;
  };
  const fetchImpl = createPinnedHttpsFetch({ requestImpl });
  const url = new URL("https://rpc.example.invalid:8443/rpc");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { accept: "application/json" },
    lookup: createPinnedLookup({ address: PUBLIC_V4, family: 4 }),
  });
  assert.equal(response.status, 200);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].options.servername, "rpc.example.invalid");
  assert.equal(captured[0].options.headers.host, "rpc.example.invalid:8443");
  assert.equal(captured[0].options.agent, false);
  assert.equal(typeof captured[0].options.lookup, "function");
  assert.equal(typeof captured[0].options.checkServerIdentity, "function");
  const sniError = captured[0].options.checkServerIdentity(
    "evil.example.invalid",
    {},
  );
  assert.ok(sniError instanceof Error);
  assert.match(sniError.message, /SNI/);
});

test("refuses a Host header that does not match the request URL host", async () => {
  const fetchImpl = createPinnedHttpsFetch({
    requestImpl: () => assert.fail("must not connect"),
  });
  await assert.rejects(
    fetchImpl(new URL("https://rpc.example.invalid"), {
      headers: { host: "127.0.0.1" },
      lookup: createPinnedLookup({ address: PUBLIC_V4, family: 4 }),
    }),
    (error) =>
      error instanceof EgressRefusal && /Host header/.test(error.message),
  );
});

test("session refuses redirects, oversized bodies, and request deadlines", async () => {
  let redirectBodyCancelled = false;
  const redirectSession = await createEgressSession(
    "https://rpc.example.invalid",
    {
      lookupImpl: publicLookup(),
      fetchImpl: async (_url, init) => {
        assert.equal(init.redirect, "manual");
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("unbounded redirect"));
          },
          cancel() {
            redirectBodyCancelled = true;
          },
        });
        return httpsResponse(body, 307, {
          location: "https://other.example.invalid",
        });
      },
    },
  );
  try {
    await assert.rejects(
      redirectSession.request({ method: "GET" }),
      (error) =>
        error instanceof EgressFailure &&
        /redirect refused/.test(error.message),
    );
    assert.equal(redirectBodyCancelled, true);
  } finally {
    redirectSession.close();
  }

  await assert.rejects(
    (
      await createEgressSession("https://rpc.example.invalid", {
        lookupImpl: publicLookup(),
        maxResponseBytes: 32,
        fetchImpl: async () =>
          httpsResponse("x".repeat(33), 200, { "content-length": "33" }),
      })
    ).request({ method: "GET" }),
    (error) =>
      error instanceof EgressFailure &&
      /response-size limit/.test(error.message),
  );

  await assert.rejects(
    (
      await createEgressSession("https://rpc.example.invalid", {
        lookupImpl: publicLookup(),
        maxResponseBytes: 32,
        fetchImpl: async () => httpsResponse("x".repeat(33)),
      })
    ).request({ method: "GET" }),
    (error) =>
      error instanceof EgressFailure &&
      /response-size limit/.test(error.message),
  );

  await assert.rejects(
    (
      await createEgressSession("https://rpc.example.invalid", {
        lookupImpl: publicLookup(),
        timeoutMs: 20,
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      })
    ).request({ method: "GET" }),
    (error) =>
      error instanceof EgressFailure &&
      error.message === "egress request timed out",
  );
});

test("session pins the connection and discards the body if re-resolution goes private", async () => {
  let lookups = 0;
  let cancelled = false;
  const connected = [];
  const session = await createEgressSession("https://rpc.example.invalid", {
    lookupImpl: async () => {
      lookups += 1;
      return lookups === 1
        ? [{ address: PUBLIC_V4, family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    },
    fetchImpl: async (url, init) => {
      const pinned = await new Promise((resolveLookup, reject) => {
        init.lookup(url.hostname, {}, (error, address, family) => {
          if (error) reject(error);
          else resolveLookup({ address, family });
        });
      });
      connected.push(pinned);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("secret"));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    },
  });
  await assert.rejects(
    session.request({ method: "GET" }),
    (error) =>
      error instanceof EgressRefusal &&
      /public IP addresses/.test(error.message),
  );
  assert.deepEqual(connected, [{ address: PUBLIC_V4, family: 4 }]);
  assert.equal(lookups, 2);
  assert.equal(cancelled, true);
  session.close();
});

test("session re-resolution keeps the pin when DNS still includes the public address", async () => {
  let lookups = 0;
  const session = await createEgressSession("https://rpc.example.invalid", {
    lookupImpl: async () => {
      lookups += 1;
      return [{ address: PUBLIC_V4, family: 4 }];
    },
    fetchImpl: async () => httpsResponse("ok"),
  });
  const result = await session.request({ method: "GET" });
  assert.equal(result.text, "ok");
  assert.equal(result.endpoint.address, PUBLIC_V4);
  assert.ok(lookups >= 2);
  session.close();
});

test("token verifier consumes this module instead of reimplementing SSRF checks", async () => {
  const source = await readFile(
    new URL("./verify-token-identity.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "\.\/egress-policy\.mjs"/);
  assert.equal(source.includes("function isPublicAddress"), false);
  assert.equal(source.includes("function pinnedHttpsFetch"), false);
  assert.equal(source.includes("function resolvePublicEndpoint"), false);
});

test("readBoundedResponseText enforces content-length and streaming caps", async () => {
  let declaredBodyCancelled = false;
  const declaredBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("abcd"));
    },
    cancel() {
      declaredBodyCancelled = true;
    },
  });
  await assert.rejects(
    readBoundedResponseText(
      httpsResponse(declaredBody, 200, { "content-length": "4" }),
      3,
    ),
    (error) =>
      error instanceof EgressFailure &&
      /response-size limit/.test(error.message),
  );
  assert.equal(declaredBodyCancelled, true);

  let streamedBodyCancelled = false;
  const streamedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("abcd"));
    },
    cancel() {
      streamedBodyCancelled = true;
    },
  });
  await assert.rejects(
    readBoundedResponseText(httpsResponse(streamedBody), 3),
    (error) =>
      error instanceof EgressFailure &&
      /response-size limit/.test(error.message),
  );
  assert.equal(streamedBodyCancelled, true);

  const text = await readBoundedResponseText(httpsResponse("ok"), 16);
  assert.equal(text, "ok");
});
