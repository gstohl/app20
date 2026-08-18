import type { AuthorizationContext, PrivyClient, Wallet } from "@privy-io/node";
import type { Account, Call, RpcProvider, Signature } from "starknet";
import type { StarknetNetwork } from "./constants.js";
import type { PrivacyCoordinator } from "./coordination.js";
import type { Strk20Discovery } from "./discovery.js";
import type { ProverKind, Strk20Prover } from "./prover.js";
import type { PrivacySdkModule } from "./sdk.js";

export type Hex = `0x${string}`;

export type PrivyOwner =
 | { userId: string }
 | { publicKey: string }
 | { ownerId: string };

export interface PrivyTokenRequest {
 forceRefresh: boolean;
}

export type UserJwtProvider = (
 request: PrivyTokenRequest,
) => Promise<string | string[]> | string | string[];

export interface AuthorizationOptions {
 /**
  * Server authorization private key (Dashboard → Wallet API). Required when
  * the wallet is owned by an authorization key rather than a user JWT.
  */
 authorizationPrivateKey?: string;
 /** Privy user access token(s). Required for user-owned wallets. */
 userJwts?: string[];
 /** Resolve fresh user JWTs for each signing attempt. */
 userJwtProvider?: UserJwtProvider;
}

export interface Strk20Config {
 network: StarknetNetwork;
 rpcUrl: string;
 privyAppId: string;
 privyAppSecret: string;
 readyClassHash: string;
 poolAddress?: string;
 /** Legacy URL fields retained for environment/config compatibility. */
 provingUrl?: string;
 discoveryUrl?: string;
 /** Resolved proving/discovery sources used by private sessions. */
 prover?: Strk20Prover;
 discovery?: Strk20Discovery;
 /** Explicit mode used when resolving URL/env configuration. */
 proverMode?: "service" | "mock";
 /** Optional SDK injection for tests or controlled runtimes. */
 privacySdk?: PrivacySdkModule;
 /** Cross-process lock + persisted last-block state for replicated servers. */
 privacyCoordinator?: PrivacyCoordinator;
 paymasterUrl?: string;
 paymasterApiKey?: string;
 paymasterMode?: "sponsored" | "default";
 authorizationPrivateKey?: string;
 /** Default tip for v3 transactions. */
 tip?: bigint;
 /** Polling and deadline controls for the ten-block maturity wait. */
 maturityPollMs?: number;
 maturityTimeoutMs?: number;
}

export interface CreateWalletInput {
 owner?: PrivyOwner;
 policyIds?: string[];
}

export interface StarknetWalletInfo {
 walletId: string;
 publicKey: string;
 /** Address Privy reports (Ready v0.5.0 assumption). */
 privyAddress: string;
 /** Address derived locally from the configured class hash. */
 address: string;
 chainType: string;
 raw: Wallet;
}

export interface DeployedAccount {
 wallet: StarknetWalletInfo;
 account: Account;
 address: string;
 deployed: boolean;
 classHash: string;
}

export interface ExecuteResult {
 transactionHash: string;
 address: string;
}

export interface PublicBalances {
 address: string;
 tokens: Array<{ token: string; balance: bigint }>;
}

export interface ShieldedNote {
 id: string;
 token: string;
 amount: bigint;
 sender: string;
 created?: number;
 mature: boolean;
 open?: boolean;
}

export interface ShieldedBalance {
 token: string;
 amount: bigint;
 notes: ShieldedNote[];
}

export interface SubmittedPrivacyExecuteResult extends ExecuteResult {
 submitted: true;
 proverKind: ProverKind;
 warnings: unknown[];
}

export interface BuiltPrivacyExecuteResult {
 submitted: false;
 proverKind: ProverKind;
 address: string;
 warnings: unknown[];
 /** Mock/build-only result. It is intentionally not sent to Starknet. */
 callAndProof: SubmitCallAndProof;
}

export type PrivacyExecuteResult =
 | SubmittedPrivacyExecuteResult
 | BuiltPrivacyExecuteResult;

export interface TokenAmount {
 token?: string;
 amount: bigint;
}

export interface TransferInput {
 token?: string;
 recipient: string;
 amount: bigint;
}

export interface WithdrawInput {
 token?: string;
 amount: bigint;
 recipient?: string;
}

export interface InvokeExternalInput {
 contractAddress: string;
 entrypoint?: string;
 calldata: unknown[];
}

export type SubmitCallAndProof = {
 call: Call;
 proof: {
  /** Undefined for call-based mocks; real proving services return proof data. */
  data?: string;
  output?: string[];
  proofFacts?: string[];
  additionalData?: unknown;
 };
};

export interface SessionDeps {
 config: Strk20Config;
 privy: PrivyClient;
 provider: RpcProvider;
}

export type {
 Account,
 AuthorizationContext,
 Call,
 PrivyClient,
 RpcProvider,
 Signature,
 Wallet,
};
