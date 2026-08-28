import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { devStarknetRelay } from "./scripts/dev-starknet-relay.mjs";

const LOCALNET_WALLET_PATH = "/__app20_localnet_wallet";
const LOCALNET_RPC_PATH = "/__app20_localnet_rpc";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const localnetBuildInputs = [
    "VITE_E2E_WALLET",
    "VITE_LOCALNET_WALLET_URL",
    "VITE_LOCALNET_RPC_URL",
    "VITE_LOCALNET_POOL_ADDRESS",
    "VITE_LOCALNET_USDC_TOKEN_ADDRESS",
    "VITE_ESCROW_HELPER_LOCALNET",
    "APP20_LOCALNET_BACKEND_TARGET",
    "APP20_LOCALNET_RPC_TARGET",
    "APP20_LOCALNET_CONTROL_TOKEN",
  ].filter((name) => Boolean(process.env[name] ?? env[name]));
  if (command === "build" && localnetBuildInputs.length > 0) {
    throw new Error(
      `Production builds reject localnet-only configuration: ${localnetBuildInputs.join(", ")}. Use the development server for the localnet wallet/RFQ rail.`,
    );
  }
  const e2eWalletEnabled =
    command === "serve" &&
    (process.env.VITE_E2E_WALLET ?? env.VITE_E2E_WALLET) === "true";
  const walletTarget =
    process.env.APP20_LOCALNET_BACKEND_TARGET ??
    env.APP20_LOCALNET_BACKEND_TARGET;
  const rpcTarget =
    process.env.APP20_LOCALNET_RPC_TARGET ?? env.APP20_LOCALNET_RPC_TARGET;
  const localnetControlToken = process.env.APP20_LOCALNET_CONTROL_TOKEN;
  const proxy: Record<string, ProxyOptions> = {};

  // Local Privy rail: run `npx wrangler dev --port 8787` with .dev.vars and
  // set APP20_WORKER_DEV_TARGET=http://127.0.0.1:8787 so the Worker-only
  // bootstrap/OHTTP routes exist in dev. Secrets stay in .dev.vars.
  const workerDevTarget =
    process.env.APP20_WORKER_DEV_TARGET ?? env.APP20_WORKER_DEV_TARGET;
  if (workerDevTarget) {
    proxy["/api/privacy"] = { target: workerDevTarget, changeOrigin: false };
    proxy["/api/ohttp"] = { target: workerDevTarget, changeOrigin: false };
  }

  if (e2eWalletEnabled && walletTarget && rpcTarget) {
    if (!localnetControlToken || Buffer.byteLength(localnetControlToken) < 32) {
      throw new Error(
        "The localnet wallet proxy requires a per-run control token.",
      );
    }
    proxy[LOCALNET_WALLET_PATH] = {
      target: walletTarget,
      changeOrigin: false,
      rewrite: (path) => path.replace(LOCALNET_WALLET_PATH, ""),
      configure: (server) => {
        server.on("proxyReq", (proxyRequest) => {
          proxyRequest.setHeader(
            "x-app20-localnet-control",
            localnetControlToken,
          );
        });
      },
    };
    proxy[LOCALNET_RPC_PATH] = {
      target: rpcTarget,
      changeOrigin: false,
      rewrite: (path) => path.replace(LOCALNET_RPC_PATH, "/"),
    };
  }

  return {
    plugins: [react(), devStarknetRelay()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Match StarkWare's bridge pattern: this is an actual build-time boolean,
    // not a runtime env lookup. With the default false value Rollup removes the
    // gated dynamic import and emits no localnet-wallet chunk.
    define: {
      "import.meta.env.VITE_E2E_WALLET": JSON.stringify(e2eWalletEnabled),
    },
    server: {
      proxy,
    },
  };
});
