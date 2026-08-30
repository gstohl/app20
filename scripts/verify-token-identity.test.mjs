import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  VerificationFailure,
  VerificationRefusal,
  decodeTokenText,
  main,
  verifyTokenIdentity,
} from "./verify-token-identity.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const reviewedCandidate = Object.freeze({
  chain: "sepolia",
  chainId: "0x534e5f5345504f4c4941",
  proposedAddress: "0x123",
  expectedSymbol: "USDC",
  expectedName: "USD Coin",
  expectedDecimals: 6,
  claimProvenance: Object.freeze({
    sourceUrl: "https://registry.example.invalid/token-claim",
    claim: "Human-review fixture only; no public token address is asserted.",
    accessedAt: "2026-08-30T00:00:00.000Z",
  }),
  reviewerIdentity: "reviewer@example.invalid",
  reviewDate: "2026-08-30T01:00:00.000Z",
  verified: false,
});

function byteArray(text) {
  const encoded = Buffer.from(text, "utf8");
  assert.ok(encoded.length <= 30);
  return [
    "0x0",
    `0x${encoded.toString("hex")}`,
    `0x${encoded.length.toString(16)}`,
  ];
}

test("checked-in example is explicitly non-real, unreviewed, and unverified", async () => {
  const example = JSON.parse(
    await readFile(
      new URL(
        "../docs/evidence/token-candidates/UNREVIEWED.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    example.proposedAddress,
    "<REPLACE_WITH_REVIEWED_STARKNET_TOKEN_ADDRESS>",
  );
  assert.equal(example.reviewerIdentity, null);
  assert.equal(example.reviewDate, null);
  assert.equal(example.verified, false);
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../docs/evidence/token-candidates/token-candidate.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(schema.properties.verified.const, false);
  assert.match(
    schema.description,
    /does not assert that verification occurred/,
  );
  await assert.rejects(
    verifyTokenIdentity(example, "https://rpc.example.invalid"),
    (error) =>
      error instanceof VerificationRefusal && /placeholder/.test(error.message),
  );
});

function checkedOptions(options = {}) {
  return { lookupImpl: publicLookup, ...options };
}

function successfulFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal);
    const request = JSON.parse(init.body);
    calls.push(request);
    let result;
    if (request.method === "starknet_chainId")
      result = reviewedCandidate.chainId;
    else if (request.id === 2) result = byteArray(overrides.symbol ?? "USDC");
    else if (request.id === 3) result = byteArray(overrides.name ?? "USD Coin");
    else result = [overrides.decimals ?? "0x6"];
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetchImpl, calls };
}

test("reports matching RPC fields as untrusted single-source evidence without promoting the record", async () => {
  const before = structuredClone(reviewedCandidate);
  const { fetchImpl, calls } = successfulFetch();
  const result = await verifyTokenIdentity(
    reviewedCandidate,
    "https://rpc.example.invalid/rpc/operator-only",
    checkedOptions({ fetchImpl }),
  );

  assert.equal(calls.length, 4);
  assert.deepEqual(result, {
    chain: "sepolia",
    chainId: reviewedCandidate.chainId,
    proposedAddress: "0x123",
    rpcOrigin: "https://rpc.example.invalid",
    symbol: "USDC",
    name: "USD Coin",
    decimals: "6",
    evidenceStatus: "rpc-reported-match-untrusted-single-source",
    rpcReportedMatch: true,
    candidateVerifiedFlag: false,
    recordModified: false,
  });
  assert.equal(Object.hasOwn(result, "exactMatch"), false);
  assert.deepEqual(reviewedCandidate, before);
  assert.equal(reviewedCandidate.verified, false);
});

test("reports the exact mismatched identity fields", async () => {
  const { fetchImpl } = successfulFetch({
    name: "Not USD Coin",
    decimals: "0x12",
  });
  await assert.rejects(
    verifyTokenIdentity(
      reviewedCandidate,
      "https://rpc.example.invalid",
      checkedOptions({ fetchImpl }),
    ),
    (error) => {
      assert.ok(error instanceof VerificationFailure);
      assert.equal(
        error.message,
        "RPC-reported identity mismatch: name, decimals",
      );
      return true;
    },
  );
});

test("refuses any candidate that claims verified status", async () => {
  await assert.rejects(
    verifyTokenIdentity(
      { ...reviewedCandidate, verified: true },
      "https://rpc.example.invalid",
      { fetchImpl: async () => assert.fail("must not connect") },
    ),
    (error) =>
      error instanceof VerificationRefusal &&
      /verified must remain false/.test(error.message),
  );
});

test("refuses unreviewed records and non-HTTPS RPC origins before network access", async () => {
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    throw new Error("must not fetch");
  };
  await assert.rejects(
    verifyTokenIdentity(
      { ...reviewedCandidate, reviewerIdentity: null, reviewDate: null },
      "https://rpc.example.invalid",
      { fetchImpl },
    ),
    (error) =>
      error instanceof VerificationRefusal && /unreviewed/.test(error.message),
  );
  await assert.rejects(
    verifyTokenIdentity(reviewedCandidate, "http://rpc.example.invalid", {
      fetchImpl,
    }),
    (error) =>
      error instanceof VerificationRefusal &&
      /HTTPS origin/.test(error.message),
  );
  assert.equal(fetched, false);
});

test("does not follow redirects and enforces the response-size limit", async () => {
  await assert.rejects(
    verifyTokenIdentity(
      reviewedCandidate,
      "https://rpc.example.invalid",
      checkedOptions({
        fetchImpl: async (_url, init) => {
          assert.equal(init.redirect, "manual");
          return new Response(null, {
            status: 307,
            headers: { location: "https://other.example.invalid" },
          });
        },
      }),
    ),
    (error) =>
      error instanceof VerificationFailure &&
      /redirect refused/.test(error.message),
  );

  await assert.rejects(
    verifyTokenIdentity(
      reviewedCandidate,
      "https://rpc.example.invalid",
      checkedOptions({
        maxResponseBytes: 32,
        fetchImpl: async () =>
          new Response("x".repeat(33), {
            status: 200,
            headers: { "content-length": "33" },
          }),
      }),
    ),
    (error) =>
      error instanceof VerificationFailure &&
      /response-size limit/.test(error.message),
  );
});

test("applies an aborting timeout to RPC reads", async () => {
  await assert.rejects(
    verifyTokenIdentity(
      reviewedCandidate,
      "https://rpc.example.invalid",
      checkedOptions({
        timeoutMs: 10,
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      }),
    ),
    (error) =>
      error instanceof VerificationFailure &&
      error.message === "RPC request timed out",
  );
});

test("refuses literal non-public IPv4 and IPv6 RPC addresses", async () => {
  for (const rpcUrl of [
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://169.254.169.254",
    "https://192.0.2.1",
    "https://224.0.0.1",
    "https://240.0.0.1",
    "https://[::1]",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://[ff02::1]",
    "https://[2001:db8::1]",
  ]) {
    await assert.rejects(
      verifyTokenIdentity(reviewedCandidate, rpcUrl, {
        fetchImpl: async () => assert.fail("must not connect"),
      }),
      (error) =>
        error instanceof VerificationRefusal &&
        /public IP addresses/.test(error.message),
    );
  }
});

test("refuses IPv4-mapped IPv6 RPC addresses", async () => {
  await assert.rejects(
    verifyTokenIdentity(reviewedCandidate, "https://[::ffff:7f00:1]", {
      fetchImpl: async () => assert.fail("must not connect"),
    }),
    (error) =>
      error instanceof VerificationRefusal &&
      /public IP addresses/.test(error.message),
  );
});

test("validates every DNS answer and refuses a mixed public/private set", async () => {
  let fetched = false;
  await assert.rejects(
    verifyTokenIdentity(reviewedCandidate, "https://rpc.example.invalid", {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.20", family: 4 },
      ],
      fetchImpl: async () => {
        fetched = true;
      },
    }),
    (error) =>
      error instanceof VerificationRefusal &&
      /public IP addresses/.test(error.message),
  );
  assert.equal(fetched, false);
});

test("pins the validated address so a rebinding lookup cannot change the connection", async () => {
  let dnsLookups = 0;
  const connectedAddresses = [];
  const { fetchImpl: responseFetch } = successfulFetch();
  const result = await verifyTokenIdentity(
    reviewedCandidate,
    "https://rpc.example.invalid",
    {
      lookupImpl: async () => {
        dnsLookups += 1;
        return dnsLookups === 1
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      },
      fetchImpl: async (url, init) => {
        const pinned = await new Promise((resolveLookup, reject) => {
          init.lookup(url.hostname, {}, (error, address, family) => {
            if (error) reject(error);
            else resolveLookup({ address, family });
          });
        });
        connectedAddresses.push(pinned);
        return responseFetch(url, init);
      },
    },
  );

  assert.equal(result.rpcReportedMatch, true);
  assert.equal(dnsLookups, 1);
  assert.deepEqual(connectedAddresses, [
    { address: "93.184.216.34", family: 4 },
    { address: "93.184.216.34", family: 4 },
    { address: "93.184.216.34", family: 4 },
    { address: "93.184.216.34", family: 4 },
  ]);
});

test("CLI uses a non-success status and explicit untrusted wording for an RPC-reported match", async () => {
  const directory = await mkdtemp(join(tmpdir(), "app20-token-candidate-"));
  const candidatePath = join(directory, "candidate.json");
  const messages = [];
  const originalLog = console.log;
  try {
    await writeFile(candidatePath, JSON.stringify(reviewedCandidate));
    console.log = (...values) => messages.push(values.join(" "));
    const { fetchImpl } = successfulFetch();
    const status = await main(
      [candidatePath, "--rpc-url", "https://rpc.example.invalid"],
      {},
      checkedOptions({ fetchImpl }),
    );
    assert.equal(status, 3);
    assert.match(messages[0], /UNTRUSTED SINGLE-SOURCE EVIDENCE/);
    assert.match(messages.at(-1), /not verified on-chain identity/);
  } finally {
    console.log = originalLog;
    await rm(directory, { recursive: true, force: true });
  }
});

test("decodes legacy short strings and Cairo ByteArray text", () => {
  assert.equal(decodeTokenText(["0x55534443"], "symbol"), "USDC");
  assert.equal(decodeTokenText(byteArray("USD Coin"), "name"), "USD Coin");
});
