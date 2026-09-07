// Shared pinned deployment for browser and Node clients. No browser dependencies.
export const MAINNET_DEPLOYMENT = {
  rpcUrl: 'https://api.cartridge.gg/x/starknet/mainnet',
  chainId: '0x534e5f4d41494e',
  address: '0x9df86f7e74cf096c3788a5bf2c51945de50a13602a4383b93bbd64f39fe051',
  classHash: '0x20abd2d11d44bdf3fbe34e775d84c76ff72c8eea47398614be0a0cd1ed94a81',
  fromBlock: 14474272,
  sellToken: { address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', symbol: 'STRK', decimals: 18 },
  buyToken: { address: '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb', symbol: 'USDC', decimals: 6 },
  settlement: {
    address: '0x1bc94493f67039bd0138101eb7a9be600496e9c63d26e331799881f9041d642',
    classHash: '0x254bbd706cfd89a774d0e88c46c6223d7bb22d555eeca87367bf8742b3c4846',
    pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    poolClassHash: '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d',
  },
};
