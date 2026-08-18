import {
  Account,
  CairoCustomEnum,
  CairoOption,
  CairoOptionVariant,
  CallData,
  hash,
  type AccountOptions,
  type RpcProvider,
  type SignerInterface,
} from "starknet";

export function buildReadyConstructor(publicKey: string) {
  const owner = new CairoCustomEnum({ Starknet: { pubkey: publicKey } });
  const guardian = new CairoOption(CairoOptionVariant.None);
  return CallData.compile({ owner, guardian });
}

export function computeReadyAddress(
  publicKey: string,
  classHash: string,
): string {
  return hash.calculateContractAddressFromHash(
    publicKey,
    classHash,
    buildReadyConstructor(publicKey),
    0,
  );
}

export function createReadyAccountWithSigner(input: {
  provider: RpcProvider;
  address: string;
  signer: SignerInterface;
  paymaster?: AccountOptions["paymaster"];
}): Account {
  return new Account({
    provider: input.provider,
    address: input.address,
    signer: input.signer,
    cairoVersion: "1",
    ...(input.paymaster ? { paymaster: input.paymaster } : {}),
  });
}
