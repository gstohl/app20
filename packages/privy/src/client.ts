import type { Account, Call, RpcProvider } from "starknet";
import {
  NETWORK_DEFAULTS,
  READY_ACCOUNT_CLASS_HASH_V0_5_0,
} from "./constants.js";
import { loadConfig, type LoadConfigInput } from "./config.js";
import {
  inMemoryPrivacySequencing,
  type PrivacySequencingState,
} from "./coordination.js";
import { serviceDiscovery } from "./discovery.js";
import { AccountNotDeployedError } from "./errors.js";
import { serviceProver } from "./prover.js";
import {
  createPaymaster,
  createRpcProvider,
  paymasterDetails,
} from "./provider.js";
import { createPrivyClient } from "./privy.js";
import { PrivacyClient } from "./privacy.js";
import {
  buildReadyConstructor,
  computeReadyAddress,
  createReadyAccountWithSigner,
} from "./ready.js";
import { PrivySigner } from "./signer.js";
import { defaultToken, readBalance, transferCall } from "./tokens.js";
import type {
  AuthorizationOptions,
  CreateWalletInput,
  DeployedAccount,
  ExecuteResult,
  PublicBalances,
  StarknetWalletInfo,
  Strk20Config,
} from "./types.js";
import {
  deriveViewingKeyFromAccount,
  deriveViewingKeyFromPassphrase,
  memoizedViewingKeyProvider,
} from "./viewing-key.js";
import {
  createStarknetWallet,
  getStarknetWallet,
  listStarknetWallets,
} from "./wallets.js";

export type Strk20PrivyOptions = LoadConfigInput;

export interface SessionOptions
  extends Pick<
    LoadConfigInput,
    | "poolAddress"
    | "provingUrl"
    | "discoveryUrl"
    | "prover"
    | "discovery"
    | "privacySdk"
    | "privacyCoordinator"
    | "tip"
    | "maturityPollMs"
    | "maturityTimeoutMs"
  > {
  authorization?: AuthorizationOptions;
  viewingKey?: bigint | (() => Promise<bigint>);
  viewingPassphrase?: string;
}

export class Strk20Privy {
  readonly config: Strk20Config;
  readonly privy;
  readonly provider: RpcProvider;

  constructor(input: Strk20PrivyOptions = {}) {
    this.config = loadConfig(input);
    this.privy = createPrivyClient(this.config);
    this.provider = createRpcProvider(this.config);
  }

  get network() {
    return this.config.network;
  }

  get strk(): string {
    return defaultToken(this.config.network);
  }

  authorization(extra: AuthorizationOptions = {}): AuthorizationOptions {
    return {
      authorizationPrivateKey:
        extra.authorizationPrivateKey ?? this.config.authorizationPrivateKey,
      userJwts: extra.userJwts,
      userJwtProvider: extra.userJwtProvider,
    };
  }

  privacySequencingFor(address: string): PrivacySequencingState {
    return inMemoryPrivacySequencing(
      `${this.network}:${address.toLowerCase()}`,
    );
  }

  async createWallet(
    input: CreateWalletInput = {},
  ): Promise<StarknetWalletInfo> {
    return createStarknetWallet(this.privy, this.config.readyClassHash, input);
  }

  async getWallet(walletId: string): Promise<StarknetWalletInfo> {
    return getStarknetWallet(this.privy, walletId, this.config.readyClassHash);
  }

  async listWallets(userId?: string): Promise<StarknetWalletInfo[]> {
    return listStarknetWallets(this.privy, this.config.readyClassHash, userId);
  }

  accountFor(
    wallet: StarknetWalletInfo,
    authorization: AuthorizationOptions = {},
  ): Account {
    const signer = new PrivySigner({
      privy: this.privy,
      walletId: wallet.walletId,
      publicKey: wallet.publicKey,
      authorization: this.authorization(authorization),
      fallbackAuthorizationKey: this.config.authorizationPrivateKey,
    });
    return createReadyAccountWithSigner({
      provider: this.provider,
      address: wallet.address,
      signer,
      paymaster: createPaymaster(this.config),
    });
  }

  async isDeployed(address: string): Promise<boolean> {
    try {
      const nonce = await this.provider.getNonceForAddress(address);
      return (
        BigInt(nonce) >= 0n &&
        (await this.provider.getClassHashAt(address)) !== "0x0"
      );
    } catch {
      return false;
    }
  }

  async deployAccount(
    wallet: StarknetWalletInfo,
    authorization: AuthorizationOptions = {},
  ): Promise<DeployedAccount> {
    const account = this.accountFor(wallet, authorization);
    const deployed = await this.isDeployed(wallet.address);
    if (deployed) {
      return {
        wallet,
        account,
        address: wallet.address,
        deployed: true,
        classHash: this.config.readyClassHash,
      };
    }

    const constructorCalldata = buildReadyConstructor(wallet.publicKey);
    const paymaster = createPaymaster(this.config);
    let deploymentTransactionHash: string;
    if (paymaster && this.config.paymasterMode) {
      const { isSponsored, gasToken } = await paymasterDetails(this.config);
      const deploymentData = {
        class_hash: this.config.readyClassHash,
        salt: wallet.publicKey,
        calldata: constructorCalldata,
        address: wallet.address,
        version: 1 as const,
      };
      if (isSponsored) {
        const transaction = await account.executePaymasterTransaction([], {
          feeMode: { mode: "sponsored" },
          deploymentData,
        });
        deploymentTransactionHash = transaction.transaction_hash;
      } else {
        if (!gasToken) {
          throw new AccountNotDeployedError(
            "Paymaster default mode requires a gas token.",
          );
        }
        const transaction = await account.executePaymasterTransaction([], {
          feeMode: { mode: "default", gasToken },
          deploymentData,
        });
        deploymentTransactionHash = transaction.transaction_hash;
      }
    } else {
      const transaction = await account.deployAccount(
        {
          classHash: this.config.readyClassHash,
          contractAddress: wallet.address,
          constructorCalldata,
          addressSalt: wallet.publicKey,
        },
        { tip: this.config.tip ?? 0n, skipValidate: false },
      );
      deploymentTransactionHash = transaction.transaction_hash;
    }
    await this.provider.waitForTransaction(deploymentTransactionHash);

    return {
      wallet,
      account,
      address: wallet.address,
      deployed: true,
      classHash: this.config.readyClassHash,
    };
  }

  async session(
    walletOrId: string | StarknetWalletInfo,
    options: SessionOptions = {},
  ): Promise<Strk20Session> {
    const wallet =
      typeof walletOrId === "string"
        ? await this.getWallet(walletOrId)
        : walletOrId;
    const authorization = this.authorization(options.authorization ?? {});
    const account = this.accountFor(wallet, authorization);
    const deployed = await this.isDeployed(wallet.address);
    return new Strk20Session(this, wallet, account, deployed, {
      ...options,
      authorization,
    });
  }
}

export class Strk20Session {
  private privacyClient?: PrivacyClient;

  constructor(
    readonly client: Strk20Privy,
    readonly wallet: StarknetWalletInfo,
    readonly account: Account,
    private deployed: boolean,
    private readonly options: SessionOptions,
  ) {}

  get address(): string {
    return this.wallet.address;
  }

  get publicKey(): string {
    return this.wallet.publicKey;
  }

  explorerUrl(): string {
    return NETWORK_DEFAULTS[this.client.network].explorerAddress(this.address);
  }

  async ensureDeployed(): Promise<void> {
    if (this.deployed) return;
    const result = await this.client.deployAccount(
      this.wallet,
      this.options.authorization,
    );
    this.deployed = result.deployed;
  }

  async execute(calls: Call | Call[]): Promise<ExecuteResult> {
    await this.ensureDeployed();
    const tx = await this.account.execute(calls, {
      tip: this.client.config.tip ?? 0n,
      skipValidate: false,
    });
    await this.client.provider.waitForTransaction(tx.transaction_hash);
    return { transactionHash: tx.transaction_hash, address: this.address };
  }

  async publicTransfer(input: {
    token?: string;
    recipient: string;
    amount: bigint;
  }): Promise<ExecuteResult> {
    return this.execute(
      transferCall(
        input.token ?? this.client.strk,
        input.recipient,
        input.amount,
      ),
    );
  }

  async publicBalances(tokens?: string[]): Promise<PublicBalances> {
    const list = tokens?.length ? tokens : [this.client.strk];
    const balances = await Promise.all(
      list.map(async (token) => ({
        token,
        balance: await readBalance(this.client.provider, token, this.address),
      })),
    );
    return { address: this.address, tokens: balances };
  }

  async isDeployed(): Promise<boolean> {
    this.deployed = await this.client.isDeployed(this.address);
    return this.deployed;
  }

  private viewingKeyProvider() {
    if (typeof this.options.viewingKey === "bigint") {
      const value = this.options.viewingKey;
      return memoizedViewingKeyProvider(async () => value);
    }
    if (typeof this.options.viewingKey === "function") {
      return memoizedViewingKeyProvider(this.options.viewingKey);
    }
    if (this.options.viewingPassphrase) {
      const passphrase = this.options.viewingPassphrase;
      return memoizedViewingKeyProvider(async () =>
        deriveViewingKeyFromPassphrase(passphrase, this.address),
      );
    }
    return memoizedViewingKeyProvider(async () =>
      deriveViewingKeyFromAccount(
        this.account,
        NETWORK_DEFAULTS[this.client.network].chainId,
      ),
    );
  }

  privacy(): PrivacyClient {
    if (this.privacyClient) return this.privacyClient;
    const configuredProver =
      this.options.prover ??
      (this.options.provingUrl
        ? serviceProver({
            url: this.options.provingUrl,
            // A bare session URL may not escalate a mock-configured client.
            submittable: this.client.config.prover?.submittable !== false,
          })
        : this.client.config.prover);
    if (!this.deployed && configuredProver?.submittable !== false) {
      throw new AccountNotDeployedError(
        `Account ${this.address} is not deployed. Fund it with STRK and call deployAccount().`,
      );
    }
    const configuredDiscovery =
      this.options.discovery ??
      (this.options.discoveryUrl
        ? serviceDiscovery(this.options.discoveryUrl)
        : this.client.config.discovery);
    this.privacyClient = new PrivacyClient({
      account: this.account,
      provider: this.client.provider,
      network: this.client.network,
      poolAddress: this.options.poolAddress ?? this.client.config.poolAddress,
      prover: configuredProver,
      discovery: configuredDiscovery,
      privacySdk: this.options.privacySdk ?? this.client.config.privacySdk,
      sequencing: this.client.privacySequencingFor(this.address),
      coordinator:
        this.options.privacyCoordinator ??
        this.client.config.privacyCoordinator,
      coordinationKey: `${this.client.network}:${this.address.toLowerCase()}`,
      viewingKeyProvider: this.viewingKeyProvider(),
      tip: this.options.tip ?? this.client.config.tip,
      maturityPollMs:
        this.options.maturityPollMs ?? this.client.config.maturityPollMs,
      maturityTimeoutMs:
        this.options.maturityTimeoutMs ?? this.client.config.maturityTimeoutMs,
    });
    return this.privacyClient;
  }

  register() {
    return this.privacy().register();
  }

  shield(input: { token?: string; amount: bigint }) {
    return this.privacy().shield(input);
  }

  transfer(input: { token?: string; recipient: string; amount: bigint }) {
    return this.privacy().transfer(input);
  }

  unshield(input: { token?: string; amount: bigint; recipient?: string }) {
    return this.privacy().unshield(input);
  }

  balances(tokens?: string[]) {
    return this.privacy().balances(tokens);
  }

  requirement(recipient: string, token?: string) {
    return this.privacy().requirement(recipient, token);
  }
}

export function computeAddress(publicKey: string, classHash?: string): string {
  return computeReadyAddress(
    publicKey,
    classHash ?? READY_ACCOUNT_CLASS_HASH_V0_5_0,
  );
}
