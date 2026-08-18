import { NETWORK_DEFAULTS, NOTE_MATURITY_BLOCKS } from "./constants.js";
import type {
  PrivacyCoordinator,
  PrivacySequencingState,
} from "./coordination.js";
import {
  ConfigError,
  PrivacySdkMissingError,
  PrivacyTransactionRevertedError,
  SequencingError,
  UnsubmittableProofError,
} from "./errors.js";
import type { Strk20Discovery } from "./discovery.js";
import type { Strk20Prover } from "./prover.js";
import { loadPrivacySdk, type PrivacySdkModule } from "./sdk.js";
import { defaultToken, ensureAllowance } from "./tokens.js";
import type {
  PrivacyExecuteResult,
  ShieldedBalance,
  ShieldedNote,
  SubmitCallAndProof,
  SubmittedPrivacyExecuteResult,
} from "./types.js";
import type { Account, RpcProvider } from "starknet";

export { loadPrivacySdk } from "./sdk.js";
export type {
  PrivacyCoordinator,
  PrivacyCoordinationLease,
  PrivacySequencingState,
} from "./coordination.js";

type PrivateTransfers = {
  user: unknown;
  build: (options?: Record<string, unknown>) => PrivacyBuilder;
  discoverNotes: (params?: Record<string, unknown>) => Promise<{
    notes: Map<bigint, Array<Record<string, unknown>>>;
  }>;
  discoverChannels: (...args: unknown[]) => Promise<unknown>;
  discoverRequirement?: (
    recipient: unknown,
    token: unknown,
  ) => Promise<unknown>;
  invalidateProofNonceCache?: () => void;
};

type PrivacyBuilder = {
  register: () => PrivacyBuilder;
  setup: (recipient: unknown) => PrivacyBuilder;
  surplusTo: (recipient: unknown, withdraw?: boolean) => PrivacyBuilder;
  with: (
    token: unknown,
    ops: (tokenBuilder: TokenBuilder) => void,
  ) => PrivacyBuilder;
  invoke: (
    callBuilder: (args: Record<string, unknown>) => unknown,
  ) => PrivacyBuilder;
  execute: (options?: Record<string, unknown>) => Promise<{
    callAndProof: SubmitCallAndProof;
    warnings?: unknown[];
  }>;
};

type TokenBuilder = {
  deposit: (input: { amount: bigint; recipient?: string }) => TokenBuilder;
  transfer: (input: {
    recipient: string;
    amount: bigint | symbol;
  }) => TokenBuilder;
  withdraw: (input: { amount: bigint; recipient?: string }) => TokenBuilder;
  surplusTo: (recipient: unknown, withdraw?: boolean) => TokenBuilder;
  done: () => PrivacyBuilder;
  execute: (options?: Record<string, unknown>) => Promise<{
    callAndProof: SubmitCallAndProof;
    warnings?: unknown[];
  }>;
};

interface SequenceAccess {
  readonly lastPrivateTxBlock?: number;
  setLastPrivateTxBlock(blockNumber: number): Promise<void>;
}

export const DEFAULT_MATURITY_WAIT_TIMEOUT_MS = 15 * 60_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function provingBlockId(
  provider: RpcProvider,
  maturity = NOTE_MATURITY_BLOCKS,
): Promise<number> {
  const latest = await provider.getBlockNumber();
  if (latest <= maturity) {
    throw new SequencingError(
      `Need more than ${maturity} blocks before proving (latest=${latest}).`,
    );
  }
  return latest - maturity;
}

export async function waitForMaturity(
  provider: RpcProvider,
  fromBlock: number,
  maturity = NOTE_MATURITY_BLOCKS,
  pollMs = 8_000,
  timeoutMs = DEFAULT_MATURITY_WAIT_TIMEOUT_MS,
): Promise<void> {
  if (timeoutMs <= 0) {
    throw new SequencingError("Maturity wait timeout must be positive.");
  }
  const deadline = Date.now() + timeoutMs;
  let latest = await provider.getBlockNumber();
  while (fromBlock >= latest - maturity) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SequencingError(
        `Timed out waiting for block ${fromBlock} to mature (latest=${latest}, maturity=${maturity}).`,
      );
    }
    await sleep(Math.min(Math.max(1, pollMs), remaining));
    latest = await provider.getBlockNumber();
  }
}

function requirePool(poolAddress?: string): string {
  if (!poolAddress) {
    throw new ConfigError(
      "STRK20_POOL_ADDRESS is required. Sepolia default is set; mainnet must be supplied.",
    );
  }
  return poolAddress;
}

/** Read the public STRK protocol fee charged by the privacy pool per execution. */
export async function readPoolFeeAmount(
  provider: RpcProvider,
  poolAddress: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: poolAddress,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  const encoded = result[0];
  if (encoded === undefined) {
    throw new ConfigError("Privacy pool returned no protocol fee amount.");
  }
  return BigInt(encoded);
}

/** Combine the pool's STRK fee and public deposits into ERC-20 allowances. */
export function poolAllowanceRequirements(
  feeToken: string,
  feeAmount: bigint,
  publicInputs: Array<{ token: string; amount: bigint }>,
): Array<{ token: string; amount: bigint }> {
  const requirements = new Map<string, { token: string; amount: bigint }>();
  const add = (token: string, amount: bigint) => {
    if (amount <= 0n) return;
    const key = BigInt(token).toString(16);
    const current = requirements.get(key);
    if (current) current.amount += amount;
    else requirements.set(key, { token, amount });
  };
  add(feeToken, feeAmount);
  for (const input of publicInputs) add(input.token, input.amount);
  return [...requirements.values()];
}

export interface PrivacyInvokeTransfer {
  token: string;
  recipient: string;
  amount: bigint;
}

export interface PrivacyInvokeInput {
  /** Private token amount withdrawn to the external helper before invocation. */
  funding: { token: string; recipient: string; amount: bigint };
  /** Token and recipient for the OPEN recovery note filled by the helper. */
  recovery: { token: string; recipient?: string };
  transfers?: PrivacyInvokeTransfer[];
  calldata: (args: Record<string, unknown>) => unknown;
}

export interface PrivacyClientOptions {
  account: Account;
  provider: RpcProvider;
  network: keyof typeof NETWORK_DEFAULTS;
  poolAddress?: string;
  prover?: Strk20Prover;
  discovery?: Strk20Discovery;
  privacySdk?: PrivacySdkModule;
  sequencing?: PrivacySequencingState;
  coordinator?: PrivacyCoordinator;
  coordinationKey?: string;
  viewingKeyProvider: { getViewingKey: () => Promise<bigint> };
  tip?: bigint;
  maturityPollMs?: number;
  maturityTimeoutMs?: number;
}

export class PrivacyClient {
  private transfers?: PrivateTransfers;
  private readyPromise?: Promise<PrivateTransfers>;
  private sdkModule?: PrivacySdkModule;
  private readonly sequencing: PrivacySequencingState;

  constructor(private readonly options: PrivacyClientOptions) {
    this.sequencing = options.sequencing ?? {};
  }

  get address(): string {
    return this.options.account.address;
  }

  get token(): string {
    return defaultToken(this.options.network);
  }

  get poolAddress(): string {
    return requirePool(this.options.poolAddress);
  }

  private proverSource(): Strk20Prover {
    if (this.options.prover) return this.options.prover;
    throw new ConfigError("Configure a prover for private flows.");
  }

  private discoverySource(): Strk20Discovery {
    if (this.options.discovery) return this.options.discovery;
    throw new ConfigError("Configure discovery for private flows.");
  }

  async ready(): Promise<PrivateTransfers> {
    if (this.transfers) return this.transfers;
    if (this.readyPromise) return this.readyPromise;
    const pending = (async () => {
      const prover = this.proverSource();
      const discovery = this.discoverySource();
      const sdk = this.options.privacySdk ?? (await loadPrivacySdk());
      const context = {
        provider: this.options.provider,
        network: this.options.network,
        chainId: NETWORK_DEFAULTS[this.options.network].chainId,
        nodeUrl: this.options.provider.channel.nodeUrl,
        poolAddress: this.poolAddress,
      };
      const [provingProvider, discoveryProvider] = await Promise.all([
        prover.resolve(context),
        discovery.resolve({
          provider: this.options.provider,
          poolAddress: this.poolAddress,
        }),
      ]);
      this.sdkModule = sdk;
      this.transfers = sdk.createPrivateTransfers({
        account: this.options.account,
        viewingKeyProvider: this.options.viewingKeyProvider,
        provingProvider,
        discoveryProvider,
        poolContractAddress: this.poolAddress,
      }) as PrivateTransfers;
      return this.transfers;
    })();
    this.readyPromise = pending;
    try {
      return await pending;
    } catch (error) {
      if (this.readyPromise === pending) this.readyPromise = undefined;
      throw error;
    }
  }

  private async runSequenced<T>(
    operation: (sequence: SequenceAccess) => Promise<T>,
  ): Promise<T> {
    const previous = this.sequencing.queue ?? Promise.resolve();
    const ready = previous.catch(() => undefined);
    let releaseLocal!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const tail = ready.then(() => gate);
    this.sequencing.queue = tail;
    await ready;

    let releaseDistributed: (() => Promise<void> | void) | undefined;
    try {
      const lease = this.options.coordinator
        ? await this.options.coordinator.acquire(
            this.options.coordinationKey ??
              `${this.options.network}:${this.address.toLowerCase()}`,
          )
        : undefined;
      releaseDistributed = lease ? () => lease.release() : undefined;
      const sequence: SequenceAccess = lease
        ? {
            lastPrivateTxBlock: lease.lastPrivateTxBlock,
            setLastPrivateTxBlock: async (blockNumber) => {
              this.sequencing.lastPrivateTxBlock = blockNumber;
              await lease.setLastPrivateTxBlock(blockNumber);
            },
          }
        : {
            lastPrivateTxBlock: this.sequencing.lastPrivateTxBlock,
            setLastPrivateTxBlock: async (blockNumber) => {
              this.sequencing.lastPrivateTxBlock = blockNumber;
            },
          };
      return await operation(sequence);
    } finally {
      try {
        await releaseDistributed?.();
      } finally {
        releaseLocal();
        if (this.sequencing.queue === tail) {
          this.sequencing.queue = undefined;
        }
      }
    }
  }

  private async waitForPreviousSubmission(
    prover: Strk20Prover,
    sequence: SequenceAccess,
  ): Promise<void> {
    if (prover.submittable && sequence.lastPrivateTxBlock !== undefined) {
      await waitForMaturity(
        this.options.provider,
        sequence.lastPrivateTxBlock,
        NOTE_MATURITY_BLOCKS,
        this.options.maturityPollMs ?? 8_000,
        this.options.maturityTimeoutMs ?? DEFAULT_MATURITY_WAIT_TIMEOUT_MS,
      );
    }
  }

  private async submitBuilt(
    callAndProof: SubmitCallAndProof,
    sequence: SequenceAccess,
  ): Promise<SubmittedPrivacyExecuteResult> {
    const prover = this.proverSource();
    if (!prover.submittable) {
      throw new UnsubmittableProofError(
        `${prover.kind} proofs are build-only and cannot be submitted to Starknet.`,
      );
    }
    const proofFacts = callAndProof.proof.proofFacts ?? [];
    const proofData = callAndProof.proof.data;
    if (!proofData || proofFacts.length === 0) {
      throw new UnsubmittableProofError(
        "A submittable private transaction requires both proof data and proof facts.",
      );
    }
    const proofDetails = { proofFacts, proof: proofData };
    const tx = await this.options.account.execute(callAndProof.call, {
      tip: this.options.tip ?? 0n,
      skipValidate: false,
      ...proofDetails,
    });
    const receipt = await this.options.provider.waitForTransaction(
      tx.transaction_hash,
    );
    const receiptDetails = receipt as {
      execution_status?: string;
      revert_reason?: string;
    };
    if (receiptDetails.execution_status === "REVERTED") {
      throw new PrivacyTransactionRevertedError(
        `Private transaction ${tx.transaction_hash} reverted${
          receiptDetails.revert_reason
            ? `: ${receiptDetails.revert_reason}`
            : "."
        }`,
      );
    }
    const blockNumber = Number(
      (receipt as { block_number?: number }).block_number ??
        (await this.options.provider.getBlockNumber()),
    );
    await sequence.setLastPrivateTxBlock(blockNumber);
    this.transfers?.invalidateProofNonceCache?.();
    return {
      submitted: true,
      proverKind: prover.kind,
      transactionHash: tx.transaction_hash,
      address: this.address,
      warnings: [],
    };
  }

  async submit(
    callAndProof: SubmitCallAndProof,
  ): Promise<SubmittedPrivacyExecuteResult> {
    return this.runSequenced(async (sequence) => {
      const prover = this.proverSource();
      await this.waitForPreviousSubmission(prover, sequence);
      return this.submitBuilt(callAndProof, sequence);
    });
  }

  async invalidateProofNonceCache(): Promise<void> {
    const transfers = await this.ready();
    transfers.invalidateProofNonceCache?.();
  }

  private async ensurePoolAllowances(
    publicInputs: Array<{ token: string; amount: bigint }>,
  ): Promise<void> {
    const prover = this.proverSource();
    if (!prover.submittable) return;

    const requirements = poolAllowanceRequirements(
      this.token,
      await readPoolFeeAmount(this.options.provider, this.poolAddress),
      publicInputs,
    );

    let approved = false;
    for (const { token, amount } of requirements) {
      const approvalHash = await ensureAllowance(
        this.options.account,
        token,
        this.poolAddress,
        amount,
        this.options.tip ?? 0n,
      );
      approved ||= approvalHash !== undefined;
    }
    if (!approved) return;

    const approveBlock = await this.options.provider.getBlockNumber();
    await waitForMaturity(
      this.options.provider,
      approveBlock,
      NOTE_MATURITY_BLOCKS,
      this.options.maturityPollMs ?? 8_000,
      this.options.maturityTimeoutMs ?? DEFAULT_MATURITY_WAIT_TIMEOUT_MS,
    );
  }

  private async executeBuilder(
    build: (
      transfers: PrivateTransfers,
      provingBlockId: number,
    ) => Promise<{
      callAndProof: SubmitCallAndProof;
      warnings?: unknown[];
    }>,
    publicInputs: Array<{ token: string; amount: bigint }> = [],
  ): Promise<PrivacyExecuteResult> {
    return this.runSequenced(async (sequence) => {
      const prover = this.proverSource();
      await this.waitForPreviousSubmission(prover, sequence);
      await this.ensurePoolAllowances(publicInputs);
      const transfers = await this.ready();
      const block = await provingBlockId(this.options.provider);
      let result: {
        callAndProof: SubmitCallAndProof;
        warnings?: unknown[];
      };
      try {
        result = await build(transfers, block);
      } catch (error) {
        transfers.invalidateProofNonceCache?.();
        throw error;
      }
      const warnings = result.warnings ?? [];
      if (!prover.submittable) {
        return {
          submitted: false,
          proverKind: prover.kind,
          address: this.address,
          callAndProof: result.callAndProof,
          warnings,
        };
      }
      const submitted = await this.submitBuilt(result.callAndProof, sequence);
      return { ...submitted, warnings };
    });
  }

  async register(): Promise<PrivacyExecuteResult> {
    return this.executeBuilder(async (transfers, block) =>
      transfers.build().register().execute({ provingBlockId: block }),
    );
  }

  async shield(input: {
    token?: string;
    amount: bigint;
  }): Promise<PrivacyExecuteResult> {
    const token = input.token ?? this.token;
    return this.executeBuilder(
      async (transfers, block) =>
        transfers
          .build({ autoRegister: true, autoSetup: true })
          .with(token, (t) => {
            t.deposit({ amount: input.amount });
          })
          .surplusTo(this.address)
          .execute({ provingBlockId: block }),
      [{ token, amount: input.amount }],
    );
  }

  async transfer(input: {
    token?: string;
    recipient: string;
    amount: bigint;
  }): Promise<PrivacyExecuteResult> {
    const token = input.token ?? this.token;
    return this.executeBuilder(async (transfers, block) =>
      transfers
        .build({
          autoRegister: true,
          autoSetup: true,
          autoSelectNotes: "naive",
          autoDiscover: { notes: "refresh", channels: "refresh" },
        })
        .with(token, (t) => {
          t.transfer({ recipient: input.recipient, amount: input.amount });
        })
        .surplusTo(this.address)
        .execute({ provingBlockId: block }),
    );
  }

  async unshield(input: {
    token?: string;
    amount: bigint;
    recipient?: string;
  }): Promise<PrivacyExecuteResult> {
    const token = input.token ?? this.token;
    const recipient = input.recipient ?? this.address;
    return this.executeBuilder(async (transfers, block) =>
      transfers
        .build({
          autoSelectNotes: "naive",
          autoDiscover: { notes: "refresh", channels: "refresh" },
        })
        .with(token, (t) => {
          t.withdraw({ amount: input.amount, recipient });
        })
        .surplusTo(this.address)
        .execute({ provingBlockId: block }),
    );
  }

  async setup(
    recipient: string,
    token?: string,
  ): Promise<PrivacyExecuteResult> {
    const resolved = token ?? this.token;
    return this.executeBuilder(async (transfers, block) =>
      transfers
        .build()
        .setup(recipient)
        .with(resolved, (t) => {
          t.surplusTo(this.address);
        })
        .execute({ provingBlockId: block }),
    );
  }

  async invoke(input: {
    tokenIn: string;
    amountIn: bigint;
    tokenOut: string;
    executor: string;
    calldata: (args: Record<string, unknown>) => unknown;
  }): Promise<PrivacyExecuteResult> {
    return this.invokeExternal({
      funding: {
        token: input.tokenIn,
        recipient: input.executor,
        amount: input.amountIn,
      },
      recovery: { token: input.tokenOut },
      calldata: input.calldata,
    });
  }

  async invokeExternal(
    input: PrivacyInvokeInput,
  ): Promise<PrivacyExecuteResult> {
    if (input.funding.amount <= 0n) {
      throw new Error("External invoke funding must be greater than zero.");
    }
    for (const transfer of input.transfers ?? []) {
      if (transfer.amount <= 0n) {
        throw new Error("External invoke transfer amounts must be greater than zero.");
      }
    }

    type Group = {
      token: string;
      transfers: PrivacyInvokeTransfer[];
      fundings: Array<{ recipient: string; amount: bigint }>;
      openRecipients: string[];
    };
    const groups = new Map<string, Group>();
    const groupFor = (token: string): Group => {
      const key = BigInt(token).toString(16);
      const existing = groups.get(key);
      if (existing) return existing;
      const created: Group = {
        token,
        transfers: [],
        fundings: [],
        openRecipients: [],
      };
      groups.set(key, created);
      return created;
    };

    for (const transfer of input.transfers ?? []) {
      groupFor(transfer.token).transfers.push(transfer);
    }
    groupFor(input.funding.token).fundings.push({
      recipient: input.funding.recipient,
      amount: input.funding.amount,
    });
    groupFor(input.recovery.token).openRecipients.push(
      input.recovery.recipient ?? this.address,
    );

    return this.executeBuilder(async (transfers, block) => {
      const Open = this.sdkModule?.Open;
      if (!Open) {
        throw new PrivacySdkMissingError(
          "Installed privacy SDK does not export Open; cannot create an open note.",
        );
      }
      const builder = transfers.build({
        autoSetup: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      });
      for (const group of groups.values()) {
        builder.with(group.token, (tokenBuilder) => {
          for (const transfer of group.transfers) {
            tokenBuilder.transfer({
              recipient: transfer.recipient,
              amount: transfer.amount,
            });
          }
          for (const funding of group.fundings) {
            tokenBuilder.withdraw(funding);
          }
          for (const recipient of group.openRecipients) {
            tokenBuilder.transfer({ recipient, amount: Open });
          }
          tokenBuilder.surplusTo(this.address, false);
        });
      }
      return builder
        .invoke(input.calldata)
        .execute({ provingBlockId: block });
    });
  }

  async balances(tokens?: string[]): Promise<ShieldedBalance[]> {
    const transfers = await this.ready();
    const latest = await this.options.provider.getBlockNumber();
    const discovered = await transfers.discoverNotes({
      tokens: tokens?.map((token) => BigInt(token)),
      blockIdentifier: "pre_confirmed",
    });
    const result: ShieldedBalance[] = [];
    for (const [token, notes] of discovered.notes.entries()) {
      const mapped: ShieldedNote[] = notes.map((note) => {
        const created =
          typeof note.created === "number" ? note.created : undefined;
        return {
          id: String(note.id ?? ""),
          token: `0x${token.toString(16)}`,
          amount: BigInt(String(note.amount ?? 0)),
          sender: String(note.sender ?? ""),
          created,
          mature:
            created === undefined
              ? true
              : latest - created >= NOTE_MATURITY_BLOCKS,
          open: Boolean(note.open),
        };
      });
      result.push({
        token: `0x${token.toString(16)}`,
        amount: mapped.reduce((sum, note) => sum + note.amount, 0n),
        notes: mapped,
      });
    }
    return result;
  }

  async requirement(recipient: string, token?: string): Promise<unknown> {
    const transfers = await this.ready();
    if (!transfers.discoverRequirement) {
      throw new ConfigError(
        "Installed privacy SDK does not expose discoverRequirement.",
      );
    }
    return transfers.discoverRequirement(recipient, token ?? this.token);
  }
}
