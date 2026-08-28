import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import {
  dispatchLocalnetMakerFill,
  requestLocalnetMaker,
} from "./localnet-maker-http.mjs";

const servers = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function respond(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const validFill = Object.freeze({
  reservationId: `0x${"11".repeat(32)}`,
  intentDigest: `0x${"22".repeat(32)}`,
  fence: "7",
  quoteDigest: `0x${"33".repeat(32)}`,
  dealId: "0x77",
  sellToken: "0x1",
  sellAmount: "100",
  buyToken: "0x2",
  buyAmount: "200",
  deadline: 1_900_000_600,
  ticketAddress: "0xabc",
});

async function makerHttpFixture() {
  let walletCalls = 0;
  let binding;
  const wallet = {
    async fill(request) {
      walletCalls += 1;
      binding = request;
      return { transactionHash: "0xf11" };
    },
  };
  let completed;
  const maker = {
    async fill(request) {
      const canonical = JSON.stringify(request, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      if (completed) {
        if (completed.canonical !== canonical)
          throw new Error(
            "Selected reservation does not authorize mutated settlement terms.",
          );
        return completed.result;
      }
      const result = await wallet.fill(request);
      completed = { canonical, result };
      return result;
    },
  };
  const server = createServer(async (request, response) => {
    try {
      const result = await dispatchLocalnetMakerFill(
        maker,
        await readJson(request),
        1_900_000_001,
      );
      respond(response, 200, { result });
    } catch (error) {
      respond(response, 400, { error: error.message });
    }
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    client: {
      endpoint: `http://127.0.0.1:${address.port}`,
      authToken: "test-only",
      solverId: "maker-http",
    },
    walletCalls: () => walletCalls,
    binding: () => binding,
  };
}

test("production fill dispatch preserves exact deadline and ticket and is exactly once", async () => {
  const fixture = await makerHttpFixture();
  await assert.doesNotReject(
    requestLocalnetMaker(fixture.client, "/v1/fill", validFill),
  );
  await assert.doesNotReject(
    requestLocalnetMaker(fixture.client, "/v1/fill", validFill),
  );
  assert.equal(fixture.walletCalls(), 1);
  assert.equal(fixture.binding().deadline, validFill.deadline);
  assert.equal(fixture.binding().ticketAddress, validFill.ticketAddress);
});

test("production fill dispatch rejects mutated deadline and ticket without another wallet call", async () => {
  for (const mutation of [
    { deadline: validFill.deadline + 1 },
    { ticketAddress: "0xabd" },
  ]) {
    const fixture = await makerHttpFixture();
    await requestLocalnetMaker(fixture.client, "/v1/fill", validFill);
    await assert.rejects(
      requestLocalnetMaker(fixture.client, "/v1/fill", {
        ...validFill,
        ...mutation,
      }),
      /mutated settlement terms/i,
    );
    assert.equal(fixture.walletCalls(), 1);
  }
});

test("production fill parser rejects noncanonical deadline and ticket before wallet dispatch", async () => {
  for (const mutation of [
    { deadline: String(validFill.deadline) },
    { ticketAddress: "0x0abc" },
  ]) {
    const fixture = await makerHttpFixture();
    await assert.rejects(
      requestLocalnetMaker(fixture.client, "/v1/fill", {
        ...validFill,
        ...mutation,
      }),
      /deadline|ticketAddress/i,
    );
    assert.equal(fixture.walletCalls(), 0);
  }
});

test("maker requests time out when a peer accepts but never responds", async () => {
  const server = createServer((_request, _response) => undefined);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const started = Date.now();
  await assert.rejects(
    requestLocalnetMaker(
      {
        endpoint: `http://127.0.0.1:${address.port}`,
        authToken: "test-only",
        solverId: "maker-timeout",
      },
      "/v1/release",
      { reservationId: `0x${"11".repeat(32)}` },
      50,
    ),
    /timeout|abort/i,
  );
  assert.ok(Date.now() - started < 2_000);
});
