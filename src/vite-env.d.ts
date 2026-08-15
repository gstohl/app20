/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E_WALLET: boolean;
  readonly VITE_PROVIDER_URL?: string;
  readonly VITE_MAIL_HELPER_SEPOLIA?: string;
  readonly VITE_MAIL_HELPER_MAINNET?: string;
  readonly VITE_MAIL_HELPER_LOCALNET?: string;
  readonly VITE_LOCALNET_RPC_URL: string;
  readonly VITE_LOCALNET_WALLET_URL: string;
  readonly VITE_LOCALNET_POOL_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
