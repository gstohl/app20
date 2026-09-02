import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import {
  LOCALNET_IPFS_HOST,
  LOCALNET_IPFS_PORT,
  computeLocalnetRawCidV1,
  createLocalnetIpfsServer,
} from "./localnet-ipfs.mjs";

const CONTROL_TOKEN = "localnet-ipfs-test-control-token-000000000001";
const APP_ORIGIN = "http://127.0.0.1:5183";
const AUTH_HEADERS = Object.freeze({
  origin: APP_ORIGIN,
  "sec-fetch-site": "same-origin",
  "x-app20-localnet-control": CONTROL_TOKEN,
});

test("exports the loopback-only app composition defaults", () => {
  assert.equal(LOCALNET_IPFS_HOST, "127.0.0.1");
  assert.equal(LOCALNET_IPFS_PORT, 5054);
});

const running = [];
afterEach(async () => {
  for (const server of running.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture(options = {}) {
  const port = await unusedPort();
  const ipfs = createLocalnetIpfsServer({
    port,
    controlToken: CONTROL_TOKEN,
    expectedOrigin: APP_ORIGIN,
    ...options,
  });
  await ipfs.listen();
  running.push(ipfs.server);
  return Object.freeze({ origin: `http://127.0.0.1:${port}`, ipfs });
}

function multipart(bytes, boundary = "app20-test-boundary") {
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function add(
  origin,
  bytes,
  query = "cid-version=1&raw-leaves=true&hash=sha2-256&pin=true",
) {
  const part = multipart(bytes);
  return fetch(`${origin}/api/v0/add?${query}`, {
    method: "POST",
    headers: {
      ...AUTH_HEADERS,
      "content-type": `multipart/form-data; boundary=${part.boundary}`,
    },
    body: part.body,
  });
}

test("computes the exact CIDv1 base32 raw sha2-256 identity", () => {
  assert.equal(
    computeLocalnetRawCidV1(new TextEncoder().encode("hello")),
    "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
  );
  assert.throws(() => computeLocalnetRawCidV1("hello"), /must be bytes/i);
});

test("multipart add preserves exact bytes and GET/HEAD serve raw blocks", async () => {
  const { origin } = await fixture();
  const bytes = Buffer.from([0, 1, 2, 13, 10, 255, 128, 0]);
  const response = await add(origin, bytes);
  assert.equal(response.status, 200);
  const added = await response.json();
  assert.equal(added.Hash, computeLocalnetRawCidV1(bytes));
  assert.equal(added.Size, String(bytes.length));

  const fetched = await fetch(`${origin}/ipfs/${added.Hash}?format=raw`, {
    headers: AUTH_HEADERS,
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get("content-type"), "application/vnd.ipld.raw");
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), bytes);

  const head = await fetch(`${origin}/ipfs/${added.Hash}?format=raw`, {
    method: "HEAD",
    headers: AUTH_HEADERS,
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("requires the proxy-injected token and same-origin writes", async () => {
  const { origin } = await fixture();
  assert.equal(
    (await fetch(`${origin}/ipfs/bafkreiunknown?format=raw`)).status,
    403,
  );

  const part = multipart(Buffer.from("ciphertext"));
  const response = await fetch(
    `${origin}/api/v0/add?cid-version=1&raw-leaves=true&hash=sha2-256`,
    {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        origin: "http://127.0.0.1:9999",
        "content-type": `multipart/form-data; boundary=${part.boundary}`,
      },
      body: part.body,
    },
  );
  assert.equal(response.status, 403);
  assert.throws(
    () => createLocalnetIpfsServer({ expectedOrigin: APP_ORIGIN }),
    /control token/i,
  );
});

test("evicts least-recently-used blobs and expires retained ciphertext", async () => {
  let currentTime = 10;
  const { origin, ipfs } = await fixture({
    maxBytes: 8,
    maxTotalBytes: 8,
    maxObjects: 2,
    blobTtlMs: 100,
    now: () => currentTime,
  });
  const first = await (await add(origin, Buffer.from("aaa"))).json();
  currentTime = 20;
  const second = await (await add(origin, Buffer.from("bbb"))).json();
  currentTime = 30;
  assert.equal(
    (
      await fetch(`${origin}/ipfs/${first.Hash}?format=raw`, {
        headers: AUTH_HEADERS,
      })
    ).status,
    200,
  );
  currentTime = 40;
  const third = await (await add(origin, Buffer.from("ccc"))).json();
  assert.equal(
    (
      await fetch(`${origin}/ipfs/${second.Hash}?format=raw`, {
        headers: AUTH_HEADERS,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${origin}/ipfs/${first.Hash}?format=raw`, {
        headers: AUTH_HEADERS,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${origin}/ipfs/${third.Hash}?format=raw`, {
        headers: AUTH_HEADERS,
      })
    ).status,
    200,
  );
  assert.deepEqual(ipfs.stats(), {
    objects: 2,
    totalBytes: 6,
    activeUploads: 0,
  });

  currentTime = 141;
  assert.equal(
    (
      await fetch(`${origin}/ipfs/${first.Hash}?format=raw`, {
        headers: AUTH_HEADERS,
      })
    ).status,
    404,
  );
  assert.equal(ipfs.stats().objects, 0);
});

test("rate-limits writes until the bounded window advances", async () => {
  let currentTime = 1_000;
  const { origin } = await fixture({
    maxUploadsPerWindow: 2,
    uploadWindowMs: 100,
    now: () => currentTime,
  });
  assert.equal((await add(origin, Buffer.from("a"))).status, 200);
  assert.equal((await add(origin, Buffer.from("b"))).status, 200);
  const limited = await add(origin, Buffer.from("c"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "1");
  currentTime = 1_101;
  assert.equal((await add(origin, Buffer.from("c"))).status, 200);
});

test("unknown, non-raw, malformed, and oversized requests fail closed", async () => {
  const { origin } = await fixture({ maxBytes: 8 });
  assert.equal(
    (
      await fetch(`${origin}/ipfs/bafkreiunknown?format=raw`, {
        headers: AUTH_HEADERS,
      })
    ).status,
    404,
  );

  const added = await add(origin, Buffer.from("small"));
  const cid = (await added.json()).Hash;
  assert.equal(
    (await fetch(`${origin}/ipfs/${cid}`, { headers: AUTH_HEADERS })).status,
    400,
  );
  assert.equal(
    (
      await add(
        origin,
        Buffer.from("small"),
        "cid-version=0&raw-leaves=true&hash=sha2-256",
      )
    ).status,
    400,
  );
  assert.equal((await add(origin, Buffer.alloc(9, 1))).status, 413);

  const malformed = await fetch(
    `${origin}/api/v0/add?cid-version=1&raw-leaves=true&hash=sha2-256`,
    {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "content-type": "application/octet-stream",
      },
      body: "not multipart",
    },
  );
  assert.equal(malformed.status, 400);
  assert.throws(
    () =>
      createLocalnetIpfsServer({
        host: "0.0.0.0",
        port: 5054,
        controlToken: CONTROL_TOKEN,
        expectedOrigin: APP_ORIGIN,
      }),
    /127\.0\.0\.1/,
  );
});
