import { mainnetOnly, rpcRelayUrl } from '@/utils/constants';
import { MAINNET_DEPLOYMENT } from './mainnet-deployment';

export const MAINNET_MAKER_CONFIG = {
  ...MAINNET_DEPLOYMENT,
  rpcUrl: globalThis.location?.protocol === 'https:' ? rpcRelayUrl('mainnet') : MAINNET_DEPLOYMENT.rpcUrl,
};
export const defaultMakerConfig = mainnetOnly ? JSON.stringify(MAINNET_MAKER_CONFIG) : undefined;
