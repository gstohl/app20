import { type Account, RpcProvider, type Call } from "starknet";
import { BrowserPrivySigner, type BrowserRawSign } from "./browser-signer.js";
import {
  NETWORK_DEFAULTS,
  READY_ACCOUNT_CLASS_HASH_V0_5_0,
  type StarknetNetwork,
} from "./constants.js";
import {
  inMemoryPrivacySequencing,
  type PrivacySequencingState,
} from "./coordination.js";
import type { Strk20Discovery } from "./discovery.js";
import { AccountNotDeployedError, ConfigError } from "./errors.js";
import { PrivacyClient } from "./privacy.js";
import type { Strk20Prover } from "./prover.js";
import {
  buildReadyConstructor,
  computeReadyAddress,
  createReadyAccountWithSigner,
} from "./ready.js";
import type { PrivacySdkModule } from "./sdk.js";
import { defaultToken, readBalance, transferCall } from "./tokens.js";
import type {
  ExecuteResult,
  PrivacyExecuteResult,
  PublicBalances,
  ShieldedBalance,
} from "./types.js";
import {
  deriveViewingKeyFromAccount,
  deriveViewingKeyFromPassphrase,
  memoizedViewingKeyProvider,
} from "./viewing-key.js";

export { BrowserPrivySigner } from "./browser-signer.js";
export type {
  BrowserRawSign,
  BrowserRawSignResult,
} from "./browser-signer.js";
export { serviceDiscovery } from "./discovery.js";
export type { ServiceDiscoveryOptions } from "./discovery.js";
export { serviceProver } from "./prover.js";
export type { ServiceProverOptions } from "./prover.js";
export type {
  OhttpTransportOption,
  OhttpTransportOptions,
} from "./ohttp.js";
export {
  NETWORK_DEFAULTS,
  READY_ACCOUNT_CLASS_HASH_V0_5_0,
  STRK20_POOL_SEPOLIA,
  STRK_MAINNET,
  STRK_SEPOLIA,
} from "./constants.js";

export interface BrowserWalletInfo {
  /** Privy Wallet API ID. Metadata only; raw signing uses `privyAddress`. */
  walletId?: string;
  publicKey: string;
  /** Address returned by Privy and passed to `useSignRawHash`. */
  privyAddress: string;
  /** Ready account address; computed locally when omitted. */
  address?: string;
}

export interface BrowserStrk20ClientOptions {
  network?: StarknetNetwork;
  /** Browser-safe RPC URL, such as a same-origin restricted relay. */
  rpcUrl: string;
  poolAddress?: string;
  readyClassHash?: string;
  prover?: Strk20Prover;
  discovery?: Strk20Discovery;
  privacySdk?: PrivacySdkModule;
  tip?: bigint;
  maturityPollMs?: number;
  maturityTimeoutMs?: number;
}

export interface BrowserSessionOptions {
  viewingKey?: bigint | (() => Promise<bigint>);
  viewingPassphrase?: string;
  prover?: Strk20Prover;
  discovery?: Strk20Discovery;
  privacySdk?: PrivacySdkModule;
  tip?: bigint;
  maturityPollMs?: number;
  maturityTimeoutMs?: number;
}

export interface ResolvedBrowserWalletInfo extends BrowserWalletInfo {
  address: string;
}

/** Browser-only client. It has no dependency on `@privy-io/node` or app secrets. */
export class BrowserStrk20Client {
  readonly network: StarknetNetwork;
  readonly provider: RpcProvider;
  readonly poolAddress?: string;
  readonly readyClassHash: string;
  readonly prover?: Strk20Prover;
  readonly discovery?: Strk20Discovery;
  readonly privacySdk?: PrivacySdkModule;
  readonly tip: bigint;
  readonly maturityPollMs?: number;
  readonly maturityTimeoutMs?: number;

  constructor(options: BrowserStrk20ClientOptions) {
    if (!options.rpcUrl.trim()) {
      throw new ConfigError("A non-empty browser RPC URL is required.");
    }
    this.network = options.network ?? "sepolia";
    this.provider = new RpcProvider({ nodeUrl: options.rpcUrl });
    this.poolAddress =
      options.poolAddress ?? NETWORK_DEFAULTS[this.network].poolAddress;
    this.readyClassHash =
      options.readyClassHash ?? READY_ACCOUNT_CLASS_HASH_V0_5_0;
    this.prover = options.prover;
    this.discovery = options.discovery;
    this.privacySdk = options.privacySdk;
    this.tip = options.tip ?? 0n;
    this.maturityPollMs = options.maturityPollMs;
    this.maturityTimeoutMs = options.maturityTimeoutMs;
  }

  get strk(): string {
    return defaultToken(this.network);
  }

  resolveWallet(wallet: BrowserWalletInfo): ResolvedBrowserWalletInfo {
    if (!wallet.publicKey.trim() || !wallet.privyAddress.trim()) {
      throw new ConfigError(
        "Browser wallet requires a Privy address and Starknet public key.",
      );
    }
    const computed = computeReadyAddress(wallet.publicKey, this.readyClassHash);
    if (wallet.address && BigInt(wallet.address) !== BigInt(computed)) {
      throw new ConfigError(
        "Browser wallet address does not match the configured Ready account class.",
      );
    }
    return { ...wallet, address: computed };
  }

  accountFor(wallet: BrowserWalletInfo, rawSign: BrowserRawSign): Account {
    const resolved = this.resolveWallet(wallet);
    return createReadyAccountWithSigner({
      provider: this.provider,
      address: resolved.address,
      signer: new BrowserPrivySigner(resolved.publicKey, rawSign),
    });
  }

  async isDeployed(address: string): Promise<boolean> {
    try {
      return (await this.provider.getClassHashAt(address)) !== "0x0";
    } catch {
      return false;
    }
  }

  async session(
    wallet: BrowserWalletInfo,
    rawSign: BrowserRawSign,
    options: BrowserSessionOptions = {},
  ): Promise<BrowserStrk20Session> {
    const resolved = this.resolveWallet(wallet);
    const account = this.accountFor(resolved, rawSign);
    return new BrowserStrk20Session(
      this,
      resolved,
      account,
      await this.isDeployed(resolved.address),
      options,
    );
  }

  sequencingFor(address: string): PrivacySequencingState {
    return inMemoryPrivacySequencing(
      `browser:${this.network}:${address.toLowerCase()}`,
    );
  }
}

export class BrowserStrk20Session {
  private privacyClient?: PrivacyClient;

  constructor(
    readonly client: BrowserStrk20Client,
    readonly wallet: ResolvedBrowserWalletInfo,
    readonly account: Account,
    private deployed: boolean,
    private readonly options: BrowserSessionOptions,
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

  async isDeployed(): Promise<boolean> {
    this.deployed = await this.client.isDeployed(this.address);
    return this.deployed;
  }

  async ensureDeployed(): Promise<void> {
    if (await this.isDeployed()) return;
    const transaction = await this.account.deployAccount(
      {
        classHash: this.client.readyClassHash,
        contractAddress: this.address,
        constructorCalldata: buildReadyConstructor(this.publicKey),
        addressSalt: this.publicKey,
      },
      { tip: this.options.tip ?? this.client.tip, skipValidate: false },
    );
    await this.client.provider.waitForTransaction(transaction.transaction_hash);
    this.deployed = true;
  }

  async execute(calls: Call | Call[]): Promise<ExecuteResult> {
    await this.ensureDeployed();
    const transaction = await this.account.execute(calls, {
      tip: this.options.tip ?? this.client.tip,
      skipValidate: false,
    });
    await this.client.provider.waitForTransaction(transaction.transaction_hash);
    return {
      transactionHash: transaction.transaction_hash,
      address: this.address,
    };
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
    const selected = tokens?.length ? tokens : [this.client.strk];
    return {
      address: this.address,
      tokens: await Promise.all(
        selected.map(async (token) => ({
          token,
          balance: await readBalance(this.client.provider, token, this.address),
        })),
      ),
    };
  }

  private viewingKeyProvider() {
    if (typeof this.options.viewingKey === "bigint") {
      const viewingKey = this.options.viewingKey;
      return memoizedViewingKeyProvider(async () => viewingKey);
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
    const prover = this.options.prover ?? this.client.prover;
    const discovery = this.options.discovery ?? this.client.discovery;
    if (!this.deployed && prover?.submittable !== false) {
      throw new AccountNotDeployedError(
        `Account ${this.address} is not deployed. Fund it with STRK and deploy it first.`,
      );
    }
    this.privacyClient = new PrivacyClient({
      account: this.account,
      provider: this.client.provider,
      network: this.client.network,
      poolAddress: this.client.poolAddress,
      prover,
      discovery,
      privacySdk: this.options.privacySdk ?? this.client.privacySdk,
      sequencing: this.client.sequencingFor(this.address),
      viewingKeyProvider: this.viewingKeyProvider(),
      tip: this.options.tip ?? this.client.tip,
      maturityPollMs: this.options.maturityPollMs ?? this.client.maturityPollMs,
      maturityTimeoutMs:
        this.options.maturityTimeoutMs ?? this.client.maturityTimeoutMs,
    });
    return this.privacyClient;
  }

  register(): Promise<PrivacyExecuteResult> {
    return this.privacy().register();
  }

  shield(input: {
    token?: string;
    amount: bigint;
  }): Promise<PrivacyExecuteResult> {
    return this.privacy().shield(input);
  }

  transfer(input: {
    token?: string;
    recipient: string;
    amount: bigint;
  }): Promise<PrivacyExecuteResult> {
    return this.privacy().transfer(input);
  }

  unshield(input: {
    token?: string;
    amount: bigint;
    recipient?: string;
  }): Promise<PrivacyExecuteResult> {
    return this.privacy().unshield(input);
  }

  balances(tokens?: string[]): Promise<ShieldedBalance[]> {
    return this.privacy().balances(tokens);
  }

  requirement(recipient: string, token?: string): Promise<unknown> {
    return this.privacy().requirement(recipient, token);
  }
}

export function computeBrowserAccountAddress(
  publicKey: string,
  classHash = READY_ACCOUNT_CLASS_HASH_V0_5_0,
): string {
  return computeReadyAddress(publicKey, classHash);
}
