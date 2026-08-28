/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E_WALLET: boolean;
  readonly VITE_PRIVY_APP_ID?: string;
  readonly VITE_PRIVY_CLIENT_ID?: string;
  readonly VITE_PROVER_OHTTP_KEY_CONFIG?: string;
  readonly VITE_DISCOVERY_OHTTP_KEY_CONFIG?: string;
  readonly VITE_MAIL_HELPER_LOCALNET?: string;
  readonly VITE_ESCROW_HELPER_LOCALNET?: string;
  readonly VITE_LOCALNET_RPC_URL: string;
  readonly VITE_LOCALNET_WALLET_URL: string;
  readonly VITE_LOCALNET_POOL_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
