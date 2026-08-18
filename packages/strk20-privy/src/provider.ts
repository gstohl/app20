import { PaymasterRpc, RpcProvider } from "starknet";
import { ConfigError } from "./errors.js";
import type { Strk20Config } from "./types.js";

export function createRpcProvider(
  config: Pick<Strk20Config, "rpcUrl">,
): RpcProvider {
  return new RpcProvider({ nodeUrl: config.rpcUrl });
}

export function createPaymaster(
  config: Strk20Config,
): PaymasterRpc | undefined {
  if (
    !config.paymasterUrl &&
    !config.paymasterApiKey &&
    !config.paymasterMode
  ) {
    return undefined;
  }
  const nodeUrl = config.paymasterUrl;
  if (!nodeUrl) return undefined;
  const headers = config.paymasterApiKey
    ? { "x-paymaster-api-key": config.paymasterApiKey }
    : undefined;
  return new PaymasterRpc(headers ? { nodeUrl, headers } : { nodeUrl });
}

export async function paymasterDetails(config: Strk20Config): Promise<{
  paymaster: PaymasterRpc;
  isSponsored: boolean;
  gasToken?: string;
}> {
  const paymaster = createPaymaster(config);
  if (!paymaster) {
    throw new ConfigError("Paymaster is not configured.");
  }
  const available = await paymaster.isAvailable();
  if (!available) {
    throw new ConfigError(
      `Paymaster at ${config.paymasterUrl} is not available.`,
    );
  }
  const isSponsored = (config.paymasterMode ?? "sponsored") === "sponsored";
  if (isSponsored && !config.paymasterApiKey) {
    throw new ConfigError("PAYMASTER_API_KEY is required for sponsored mode.");
  }
  let gasToken: string | undefined;
  if (!isSponsored) {
    const supported = await paymaster.getSupportedTokens();
    gasToken = supported[0]?.token_address;
    if (!gasToken) {
      throw new ConfigError("Paymaster returned no supported gas tokens.");
    }
  }
  return { paymaster, isSponsored, gasToken };
}
