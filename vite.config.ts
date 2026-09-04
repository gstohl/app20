import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv, type ProxyOptions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { devStarknetRelay } from "./scripts/dev-starknet-relay.mjs";
import { checkBundleDirectory } from "./scripts/check-bundle-budget.mjs";

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
    "VITE_MAIL_HELPER_LOCALNET",
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
  let buildOutputDirectory: string | undefined;

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
    proxy["/__app20_localnet_ipfs"] = {
      target: "http://127.0.0.1:5054",
      changeOrigin: false,
      rewrite: (path) => path.replace(/^\/__app20_localnet_ipfs/, ""),
      configure: (server) => {
        server.on("proxyReq", (proxyRequest) => {
          proxyRequest.setHeader(
            "x-app20-localnet-control",
            localnetControlToken,
          );
        });
      },
    };
  }

  return {
    // Nested agent worktrees are separate checkouts, not tests for this build.
    test: {
      include: configDefaults.include.map((pattern) => `src/${pattern}`),
    },
    plugins: [
      react(),
      devStarknetRelay(),
      {
        name: "app20-bundle-budget",
        apply: "build",
        configResolved(config) {
          buildOutputDirectory = resolve(config.root, config.build.outDir);
        },
        async closeBundle() {
          if (!buildOutputDirectory) {
            throw new Error("Vite build output directory was not resolved.");
          }
          await checkBundleDirectory(buildOutputDirectory);
        },
      },
    ],
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
    build: {
      // Vite reports decimal kB. The artifact check applies the tighter,
      // recorded byte budget for every emitted JavaScript chunk.
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          entryFileNames: "assets/app-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          manualChunks(id) {
            const moduleId = id.replaceAll("\\", "/");
            if (
              moduleId.includes("/node_modules/react/") ||
              moduleId.includes("/node_modules/react-dom/") ||
              moduleId.includes("/node_modules/scheduler/")
            ) {
              return "vendor-react";
            }
            if (moduleId.includes("/node_modules/@tanstack/")) {
              return "vendor-tanstack";
            }
            // Wallet discovery is intentionally not assigned a manual chunk.
            // Its explicit connect-intent dynamic import must control the full
            // transitive virtual-wallet/module-federation graph; forcing that
            // graph into a manual chunk makes Rollup preserve eager side-effect
            // ordering from the application entry.
            if (moduleId.includes("/node_modules/@hpke/")) {
              return "vendor-hpke";
            }
            if (
              moduleId.includes("/node_modules/starknet/") ||
              moduleId.includes(
                "/node_modules/@starknet-io/get-starknet-wallet-standard/",
              ) ||
              moduleId.includes("/node_modules/@starknet-io/types-js/") ||
              moduleId.includes("/node_modules/@noble/") ||
              moduleId.includes("/node_modules/@scure/")
            ) {
              return "vendor-starknet";
            }
            return undefined;
          },
        },
      },
    },
  };
});
