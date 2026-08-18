import { IndexerDiscoveryProvider } from "@starkware-libs/starknet-privacy-sdk";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1_000 * (attempt + 1)),
        );
      }
    }
  }
  throw lastError;
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (!response.ok || payload.error || payload.result === undefined) {
    throw new Error(`${method} failed with HTTP ${response.status}.`);
  }
  return payload.result;
}

const rpcUrl = required("RPC_URL");
const proverUrl = required("STRK20_PROVING_URL");
const discoveryUrl = required("STRK20_DISCOVERY_URL");
const poolAddress = required("STRK20_POOL_ADDRESS");

const [chainIdHex, poolClassHash, proverSpec] = await Promise.all([
  withRetry(() => rpc<string>(rpcUrl, "starknet_chainId", {})),
  withRetry(() =>
    rpc<string>(rpcUrl, "starknet_getClassHashAt", {
      block_id: "latest",
      contract_address: poolAddress,
    }),
  ),
  withRetry(() => rpc<string>(proverUrl, "starknet_specVersion", [])),
]);
const chainId = Buffer.from(chainIdHex.slice(2), "hex").toString("utf8");
if (chainId !== "SN_SEPOLIA") {
  throw new Error(`Expected SN_SEPOLIA, received ${chainId || "unknown"}.`);
}
if (!/^0x[0-9a-f]+$/i.test(poolClassHash)) {
  throw new Error(
    "The privacy pool is not deployed at the configured address.",
  );
}

const discovery = new IndexerDiscoveryProvider(
  discoveryUrl,
  BigInt(poolAddress),
);
const discoveryHealth = await withRetry(() => discovery.getHealth());
if (discoveryHealth.status !== "OK") {
  throw new Error("Discovery service is not healthy.");
}

process.stdout.write(
  `${JSON.stringify(
    {
      chainId,
      poolDeployed: true,
      proverSpec,
      discoveryStatus: discoveryHealth.status,
      discoveryHasChainHead: Boolean(discoveryHealth.chain_head),
    },
    null,
    2,
  )}\n`,
);
