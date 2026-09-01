import test from "node:test";
import assert from "node:assert/strict";
import { createRelayHandler, issueOhttpSession } from "../src/index.ts";
import { RelayHttpError } from "../src/errors.ts";
import type {
  AtomicGate,
  GateAcquireRequest,
  GateLease,
  RelayEnv,
} from "../src/types.ts";

const SECRET_CANARY = "SESSION_SECRET_CANARY_DO_NOT_EXPOSE_0123456789";
const PLAINTEXT_CANARY = "OPAQUE_PLAINTEXT_CANARY_DO_NOT_PARSE";
const UPSTREAM_CANARY = "https://opaque-upstream-canary.invalid/relay";

class SharedGate implements AtomicGate {
  active = 0;
  acquisitions = 0;
  readonly max: number;

  constructor(max = 100) {
    this.max = max;
  }
  async acquire(_input: GateAcquireRequest): Promise<GateLease> {
    if (this.active >= this.max)
      throw new RelayHttpError(429, "Relay quota exceeded.");
    this.active += 1;
    this.acquisitions += 1;
    let released = false;
    return {
      release: async () => {
        if (!released) {
          released = true;
          this.active -= 1;
        }
      },
    };
  }
}

function env(overrides: Partial<RelayEnv> = {}): RelayEnv {
  return {
    ENVIRONMENT: "production",
    PROVER_UPSTREAM_URL: UPSTREAM_CANARY,
    DISCOVERY_UPSTREAM_URL: "https://discovery-upstream-canary.invalid/relay",
    STARKNET_SEPOLIA_RPC_URL: "https://sepolia-rpc-canary.invalid/rpc",
    STARKNET_MAINNET_RPC_URL: "https://mainnet-rpc-canary.invalid/rpc",
    PROVER_UPSTREAM_AUTHORIZATION:
      "Bearer AUTHORIZATION_CANARY_NOT_CLIENT_VISIBLE",
    OHTTP_SESSION_SECRET: SECRET_CANARY,
    PRIVY_APP_ID: "test-app-id",
    PRIVY_APP_SECRET: "TEST_ONLY_PRIVY_SECRET_DO_NOT_DEPLOY_0123456789",
    SEPOLIA_POOL_ADDRESS: "0x123",
    SEPOLIA_STRK_TOKEN_ADDRESS: "0x456",
    READY_ACCOUNT_CLASS_HASH: "0x789",
    RELAY_GATE: {} as RelayEnv["RELAY_GATE"],
    ...overrides,
  };
}

async function ohttpRequest(
  cookie: string,
  init: RequestInit = {},
): Promise<Request> {
  const headers = new Headers({
    origin: "https://app.invalid",
    "content-type": "message/ohttp-req",
    cookie,
    "x-client-secret-canary": "CLIENT_HEADER_CANARY",
  });
  for (const [name, value] of new Headers(init.headers))
    headers.set(name, value);
  const method = init.method ?? "POST";
  return new Request("https://app.invalid/api/ohttp/prover", {
    ...init,
    method,
    headers,
    body:
      method === "GET" || method === "HEAD" || init.body === null
        ? null
        : (init.body ?? new TextEncoder().encode(PLAINTEXT_CANARY)),
  });
}

async function sessionCookie(environment = env()): Promise<string> {
  return (
    await issueOhttpSession(
      "privy-did-wallet-identity-canary",
      environment,
      1_700_000_000_000,
    )
  ).split(";", 1)[0];
}

const NOW = () => 1_700_000_001_000;

test("forwards and returns opaque OHTTP bytes unchanged with stripped client headers", async () => {
  const cookie = await sessionCookie();
  const gate = new SharedGate();
  const responseBytes = Uint8Array.from([0, 255, 13, 10, 42]);
  let forwarded: Uint8Array | undefined;
  const handler = createRelayHandler({
    now: NOW,
    gate,
    fetch: async (input, init) => {
      assert.equal(String(input), UPSTREAM_CANARY);
      assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      assert.deepEqual([...headers.keys()].sort(), [
        "accept",
        "authorization",
        "content-type",
      ]);
      assert.equal(
        headers.get("authorization"),
        "Bearer AUTHORIZATION_CANARY_NOT_CLIENT_VISIBLE",
      );
      forwarded = new Uint8Array(init?.body as ArrayBuffer);
      return new Response(responseBytes, {
        headers: { "content-type": "message/ohttp-res" },
      });
    },
  });
  const response = await handler(await ohttpRequest(cookie), env());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(forwarded, new TextEncoder().encode(PLAINTEXT_CANARY));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), responseBytes);
  assert.equal(gate.active, 0);
});

test("generic redirect failure exposes no plaintext, secret, URL, auth, or upstream detail canaries", async () => {
  const cookie = await sessionCookie();
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => {
    logs.push(values.join(" "));
  };
  try {
    const handler = createRelayHandler({
      now: NOW,
      gate: new SharedGate(),
      fetch: async (_input, init) => {
        assert.equal(init?.redirect, "error");
        throw new TypeError(
          `${PLAINTEXT_CANARY} ${SECRET_CANARY} ${UPSTREAM_CANARY}`,
        );
      },
    });
    const response = await handler(await ohttpRequest(cookie), env());
    const output = await response.text();
    assert.equal(response.status, 502);
    for (const canary of [
      PLAINTEXT_CANARY,
      SECRET_CANARY,
      UPSTREAM_CANARY,
      "AUTHORIZATION_CANARY",
    ]) {
      assert.equal(output.includes(canary), false);
      assert.equal(logs.join(" ").includes(canary), false);
    }
  } finally {
    console.error = originalError;
  }
});

test("rejects declared and streamed oversized OHTTP bodies", async () => {
  const cookie = await sessionCookie();
  const handler = createRelayHandler({
    now: NOW,
    gate: new SharedGate(),
    fetch: async () => {
      throw new Error("must not fetch");
    },
  });
  const declared = await handler(
    await ohttpRequest(cookie, {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    }),
    env(),
  );
  assert.equal(declared.status, 413);

  const chunk = new Uint8Array(1024 * 1024 + 1);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const streamedRequest = new Request("https://app.invalid/api/ohttp/prover", {
    method: "POST",
    headers: {
      origin: "https://app.invalid",
      "content-type": "message/ohttp-req",
      cookie,
    },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const streamed = await handler(streamedRequest, env());
  assert.equal(streamed.status, 413);
});

test("rejects wrong origin, content type, and method", async () => {
  const cookie = await sessionCookie();
  const handler = createRelayHandler({
    now: NOW,
    gate: new SharedGate(),
    fetch: async () => {
      throw new Error("must not fetch");
    },
  });
  assert.equal(
    (
      await handler(
        await ohttpRequest(cookie, {
          headers: { origin: "https://evil.invalid" },
        }),
        env(),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handler(
        await ohttpRequest(cookie, {
          headers: { "content-type": "application/json" },
        }),
        env(),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await handler(
        await ohttpRequest(cookie, { method: "PUT", body: undefined }),
        env(),
      )
    ).status,
    405,
  );
});

test("fails closed without Origin except for explicit loopback development", async () => {
  const cookie = await sessionCookie();
  const gate = new SharedGate();
  const handler = createRelayHandler({
    now: NOW,
    gate,
    fetch: async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "message/ohttp-res" },
      }),
  });
  const production = await handler(
    new Request("https://app.invalid/api/ohttp/prover", {
      method: "POST",
      headers: { "content-type": "message/ohttp-req", cookie },
      body: "x",
    }),
    env(),
  );
  assert.equal(production.status, 403);
  const devEnv = env({
    ENVIRONMENT: "development",
    ALLOW_LOCAL_DEVELOPMENT: "true",
    ALLOW_LOOPBACK_HTTP: "true",
    PROVER_UPSTREAM_URL: "http://127.0.0.1:8788/relay",
  });
  const devCookie = await sessionCookie(devEnv);
  const development = await handler(
    new Request("http://127.0.0.1:8787/api/ohttp/prover", {
      method: "POST",
      headers: { "content-type": "message/ohttp-req", cookie: devCookie },
      body: "x",
    }),
    devEnv,
  );
  assert.equal(development.status, 200);
});

test("two logical relay instances share one concurrency gate and always release", async () => {
  const cookie = await sessionCookie();
  const gate = new SharedGate(1);
  let unblock!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const fetcher = async () => {
    entered();
    await blocked;
    return new Response(new Uint8Array([9]), {
      headers: { "content-type": "message/ohttp-res" },
    });
  };
  const firstInstance = createRelayHandler({ now: NOW, gate, fetch: fetcher });
  const secondInstance = createRelayHandler({ now: NOW, gate, fetch: fetcher });
  const first = firstInstance(await ohttpRequest(cookie), env());
  await enteredPromise;
  const second = await secondInstance(await ohttpRequest(cookie), env());
  assert.equal(second.status, 429);
  unblock();
  assert.equal((await first).status, 200);
  assert.equal(gate.active, 0);
});

test("issues a Sepolia-only Privy bootstrap without exposing identity or upstream origins", async () => {
  const accessToken = "PRIVY_ACCESS_TOKEN_CANARY_NOT_FOR_OUTPUT";
  let receivedToken = "";
  const handler = createRelayHandler({
    gate: new SharedGate(),
    privyDirectory: {
      authenticateAndList: async (token) => {
        receivedToken = token;
        return {
          subject: "did:privy:identity-canary",
          wallets: [
            {
              walletId: "wallet-metadata-id",
              publicKey: "0x123",
              privyAddress: "0x456",
              createdAt: 1,
              authorization: {
                kind: "user-only",
                threshold: 1,
                userSignerCount: 1,
                appSignerCount: 0,
                browserSignable: true,
                appCanSignAlone: false,
              },
            },
          ],
        };
      },
    },
  });
  const response = await handler(
    new Request("https://app.invalid/api/privacy/bootstrap", {
      method: "POST",
      headers: {
        origin: "https://app.invalid",
        authorization: `Bearer ${accessToken}`,
      },
    }),
    env({ PRIVY_SUBMISSION_MODE: "live" }),
  );
  const text = await response.text();
  const output = JSON.parse(text) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(receivedToken, accessToken);
  assert.equal(output.network, "sepolia");
  assert.equal(output.submissionMode, "live");
  assert.equal(text.includes(accessToken), false);
  assert.equal(text.includes("did:privy:identity-canary"), false);
  assert.equal(text.includes(UPSTREAM_CANARY), false);
  assert.match(text, /https:\/\/prover\.ohttp\.invalid/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.equal(
    (response.headers.get("set-cookie") ?? "").includes("identity-canary"),
    false,
  );
});

test("bootstrap authentication errors are generic and never issue a relay session", async () => {
  const handler = createRelayHandler({
    gate: new SharedGate(),
    privyDirectory: {
      authenticateAndList: async () => {
        throw new Error(`${SECRET_CANARY} ${UPSTREAM_CANARY}`);
      },
    },
  });
  const response = await handler(
    new Request("https://app.invalid/api/privacy/bootstrap", {
      method: "POST",
      headers: {
        origin: "https://app.invalid",
        authorization: "Bearer invalid-token-canary",
      },
    }),
    env(),
  );
  const output = await response.text();

  assert.equal(response.status, 401);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(output.includes(SECRET_CANARY), false);
  assert.equal(output.includes(UPSTREAM_CANARY), false);
});

test("privacy logout expires only the scoped OHTTP session cookie", async () => {
  const handler = createRelayHandler({ gate: new SharedGate() });
  const response = await handler(
    new Request("https://app.invalid/api/privacy/logout", {
      method: "POST",
      headers: { origin: "https://app.invalid" },
    }),
    env(),
  );
  assert.equal(response.status, 204);
  assert.match(
    response.headers.get("set-cookie") ?? "",
    /^app20_ohttp_session=;.*Path=\/api\/ohttp; Max-Age=0$/,
  );

  const crossOrigin = await handler(
    new Request("https://app.invalid/api/privacy/logout", {
      method: "POST",
      headers: { origin: "https://evil.invalid" },
    }),
    env(),
  );
  assert.equal(crossOrigin.status, 403);
});

test("serves SPA assets with strict security headers and keeps unknown APIs closed", async () => {
  let assetRequests = 0;
  const environment = env({
    PRIVY_FRAME_ORIGINS: "https://auth.privy.io",
    PRIVY_CONNECT_ORIGINS: "https://auth.privy.io,https://api.privy.io",
    IPFS_ORIGINS: "https://ipfs.example.invalid",
    ASSETS: {
      fetch: async () => {
        assetRequests += 1;
        return new Response("<html>APP20</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  });
  const handler = createRelayHandler({ gate: new SharedGate() });

  const asset = await handler(
    new Request("https://app.invalid/rfq"),
    environment,
  );
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "<html>APP20</html>");
  assert.match(
    asset.headers.get("content-security-policy") ?? "",
    /script-src 'self'/,
  );
  assert.match(
    asset.headers.get("content-security-policy") ?? "",
    /frame-src 'self' https:\/\/auth\.privy\.io/,
  );
  assert.match(
    asset.headers.get("content-security-policy") ?? "",
    /connect-src[^;]*https:\/\/ipfs\.example\.invalid/,
  );
  assert.equal(asset.headers.get("x-frame-options"), "DENY");

  const unknownApi = await handler(
    new Request("https://app.invalid/api/not-a-route"),
    environment,
  );
  assert.equal(unknownApi.status, 404);
  assert.equal(assetRequests, 1);
});

test("RPC rejects unsupported methods and forwards allowed JSON bytes unchanged", async () => {
  const gate = new SharedGate();
  let forwarded = "";
  const handler = createRelayHandler({
    gate,
    fetch: async (_input, init) => {
      forwarded = new TextDecoder().decode(init?.body as ArrayBuffer);
      assert.deepEqual([...new Headers(init?.headers).keys()].sort(), [
        "accept",
        "content-type",
      ]);
      return new Response('{"jsonrpc":"2.0","result":"0x1","id":1}', {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const rpc = (body: string) =>
    new Request("https://app.invalid/api/starknet/sepolia", {
      method: "POST",
      headers: {
        origin: "https://app.invalid",
        "content-type": "application/json",
        "x-secret": SECRET_CANARY,
      },
      body,
    });
  const unsupported = await handler(
    rpc('{"jsonrpc":"2.0","method":"eth_sendRawTransaction","id":1}'),
    env(),
  );
  assert.equal(unsupported.status, 400);
  assert.equal(
    (await unsupported.text()).includes("eth_sendRawTransaction"),
    false,
  );
  const allowedBody =
    '{"jsonrpc":"2.0","method":"starknet_chainId","params":[],"id":"OPAQUE_RPC_CANARY"}';
  const allowed = await handler(rpc(allowedBody), env());
  assert.equal(allowed.status, 200);
  assert.equal(forwarded, allowedBody);
  assert.equal(gate.active, 0);
});
