import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import {
  computeLocalnetRawCidV1,
  createLocalnetIpfsServer,
} from "./localnet-ipfs.mjs";

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
  const ipfs = createLocalnetIpfsServer({ port, ...options });
  await ipfs.listen();
  running.push(ipfs.server);
  return `http://127.0.0.1:${port}`;
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
  const origin = await fixture();
  const bytes = Buffer.from([0, 1, 2, 13, 10, 255, 128, 0]);
  const response = await add(origin, bytes);
  assert.equal(response.status, 200);
  const added = await response.json();
  assert.equal(added.Hash, computeLocalnetRawCidV1(bytes));
  assert.equal(added.Size, String(bytes.length));

  const fetched = await fetch(`${origin}/ipfs/${added.Hash}?format=raw`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get("content-type"), "application/vnd.ipld.raw");
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), bytes);

  const head = await fetch(`${origin}/ipfs/${added.Hash}`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("unknown, non-raw, malformed, and oversized requests fail closed", async () => {
  const origin = await fixture({ maxBytes: 8 });
  assert.equal(
    (await fetch(`${origin}/ipfs/bafkreiunknown?format=raw`)).status,
    404,
  );

  const added = await add(origin, Buffer.from("small"));
  const cid = (await added.json()).Hash;
  assert.equal((await fetch(`${origin}/ipfs/${cid}`)).status, 400);
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
      headers: { "content-type": "application/octet-stream" },
      body: "not multipart",
    },
  );
  assert.equal(malformed.status, 400);
  assert.throws(
    () => createLocalnetIpfsServer({ host: "0.0.0.0", port: 5054 }),
    /127\.0\.0\.1/,
  );
});
