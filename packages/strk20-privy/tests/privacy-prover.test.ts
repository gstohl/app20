import { describe, expect, it, vi } from "vitest";
import { Strk20Session } from "../src/client.js";
import {
  poolAllowanceRequirements,
  PrivacyClient,
  readPoolFeeAmount,
} from "../src/privacy.js";
import { customDiscovery } from "../src/discovery.js";
import { customProver, mockProver } from "../src/prover.js";
import {
  PrivacyTransactionRevertedError,
  UnsubmittableProofError,
} from "../src/errors.js";
import type { PrivacySdkModule } from "../src/sdk.js";
import type { SubmitCallAndProof } from "../src/types.js";

function fakeSdk(
  callAndProof: SubmitCallAndProof,
  options: {
    onExecute?: () => Promise<void>;
    invalidateProofNonceCache?: () => void;
  } = {},
): PrivacySdkModule {
  return {
    createPrivateTransfers: () => {
      const tokenBuilder: Record<string, unknown> = {};
      for (const method of ["deposit", "transfer", "withdraw", "surplusTo"]) {
        tokenBuilder[method] = () => tokenBuilder;
      }

      const builder: Record<string, unknown> = {};
      for (const method of ["register", "setup", "surplusTo", "invoke"]) {
        builder[method] = () => builder;
      }
      builder.with = (
        _token: unknown,
        operations: (token: Record<string, unknown>) => void,
      ) => {
        operations(tokenBuilder);
        return builder;
      };
      builder.execute = async () => {
        await options.onExecute?.();
        return {
          callAndProof,
          warnings: ["test-warning"],
        };
      };

      return {
        build: () => builder,
        discoverNotes: async () => ({ notes: new Map() }),
        discoverChannels: async () => ({}),
        discoverRequirement: async () => 0,
        invalidateProofNonceCache: options.invalidateProofNonceCache,
      };
    },
  };
}

function fakeProvider(receipt: Record<string, unknown> = { block_number: 43 }) {
  return {
    channel: { nodeUrl: "https://rpc.example" },
    callContract: vi.fn(async () => ["0x0"]),
    getBlockNumber: vi.fn(async () => 42),
    waitForTransaction: vi.fn(async () => receipt),
  };
}

function fakeAccount() {
  return {
    address: "0xabc",
    execute: vi.fn(async () => ({ transaction_hash: "0xtx" })),
  };
}

function provingProvider(data?: string) {
  return {
    getDefaultDetails: vi.fn(async () => ({})),
    prove: vi.fn(async () => ({
      data,
      output: ["0xclass", "0xaction"],
      proofFacts: ["0xfact"],
    })),
  };
}

const discovery = customDiscovery({
  discoverNotes: async () => ({}),
  discoverChannels: async () => ({}),
  discoverRequirement: async () => 0,
});

function callAndProof(data?: string): SubmitCallAndProof {
  return {
    call: {
      contractAddress: "0x123",
      entrypoint: "apply_actions",
      calldata: ["0xaction"],
    },
    proof: {
      data,
      output: ["0xclass", "0xaction"],
      proofFacts: ["0xfact"],
    },
  };
}

describe("PrivacyClient prover safety", () => {
  it("reads the pool's public STRK protocol fee", async () => {
    const provider = fakeProvider();
    provider.callContract.mockResolvedValueOnce(["0x1bc16d674ec80000"]);

    await expect(readPoolFeeAmount(provider as never, "0x123")).resolves.toBe(
      2n * 10n ** 18n,
    );
    expect(provider.callContract).toHaveBeenCalledWith({
      contractAddress: "0x123",
      entrypoint: "get_fee_amount",
      calldata: [],
    });
  });

  it("combines the STRK pool fee with a STRK shield deposit", () => {
    expect(
      poolAllowanceRequirements("0x04718", 2n, [
        { token: "0x4718", amount: 10n },
      ]),
    ).toEqual([{ token: "0x04718", amount: 12n }]);
  });

  it("returns a build-only result and never submits a mock proof", async () => {
    const account = fakeAccount();
    const built = callAndProof();
    const client = new PrivacyClient({
      account: account as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider(), { submittable: false }),
      discovery,
      privacySdk: fakeSdk(built),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    const result = await client.register();

    expect(result).toMatchObject({
      submitted: false,
      proverKind: "custom",
      address: "0xabc",
      warnings: ["test-warning"],
      callAndProof: built,
    });
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("does not approve tokens while building a mock shield", async () => {
    const account = fakeAccount();
    const client = new PrivacyClient({
      account: account as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider(), { submittable: false }),
      discovery,
      privacySdk: fakeSdk(callAndProof()),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await expect(client.shield({ amount: 10n })).resolves.toMatchObject({
      submitted: false,
    });
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("refuses direct submission through a non-submittable prover", async () => {
    const client = new PrivacyClient({
      account: fakeAccount() as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider(), { submittable: false }),
      discovery,
      privacySdk: fakeSdk(callAndProof()),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await expect(client.submit(callAndProof())).rejects.toBeInstanceOf(
      UnsubmittableProofError,
    );
  });

  it("submits proof data and facts from a trusted service", async () => {
    const account = fakeAccount();
    const invalidateProofNonceCache = vi.fn();
    const client = new PrivacyClient({
      account: account as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider("proof-data"), {
        submittable: true,
      }),
      discovery,
      privacySdk: fakeSdk(callAndProof("proof-data"), {
        invalidateProofNonceCache,
      }),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    const result = await client.register();

    expect(result).toMatchObject({
      submitted: true,
      transactionHash: "0xtx",
      proverKind: "custom",
    });
    expect(account.execute).toHaveBeenCalledWith(
      expect.objectContaining({ entrypoint: "apply_actions" }),
      expect.objectContaining({
        proof: "proof-data",
        proofFacts: ["0xfact"],
        skipValidate: false,
      }),
    );
    expect(invalidateProofNonceCache).toHaveBeenCalledOnce();
  });

  it("persists sequencing state through a distributed coordinator lease", async () => {
    const setLastPrivateTxBlock = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({
      lastPrivateTxBlock: 20,
      setLastPrivateTxBlock,
      release,
    }));
    const client = new PrivacyClient({
      account: fakeAccount() as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider("proof-data"), {
        submittable: true,
      }),
      discovery,
      privacySdk: fakeSdk(callAndProof("proof-data")),
      coordinator: { acquire },
      coordinationKey: "sepolia:0xabc",
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await client.register();
    expect(acquire).toHaveBeenCalledWith("sepolia:0xabc");
    expect(setLastPrivateTxBlock).toHaveBeenCalledWith(43);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not report a reverted receipt as submitted", async () => {
    const client = new PrivacyClient({
      account: fakeAccount() as never,
      provider: fakeProvider({
        block_number: 43,
        execution_status: "REVERTED",
        revert_reason: "invalid nullifier",
      }) as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider("proof-data"), {
        submittable: true,
      }),
      discovery,
      privacySdk: fakeSdk(callAndProof("proof-data")),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await expect(client.register()).rejects.toBeInstanceOf(
      PrivacyTransactionRevertedError,
    );
  });

  it("deduplicates concurrent privacy SDK initialization", async () => {
    const baseSdk = fakeSdk(callAndProof());
    const createPrivateTransfers = vi.fn(baseSdk.createPrivateTransfers);
    const client = new PrivacyClient({
      account: fakeAccount() as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider(), { submittable: false }),
      discovery,
      privacySdk: { ...baseSdk, createPrivateTransfers },
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await Promise.all([client.ready(), client.ready(), client.balances()]);
    expect(createPrivateTransfers).toHaveBeenCalledOnce();
  });

  it("serializes concurrent private builds for one account", async () => {
    let active = 0;
    let maxActive = 0;
    const client = new PrivacyClient({
      account: fakeAccount() as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider(), { submittable: false }),
      discovery,
      privacySdk: fakeSdk(callAndProof(), {
        onExecute: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        },
      }),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await Promise.all([client.register(), client.register()]);
    expect(maxActive).toBe(1);
  });

  it("does not let a bare session URL escalate a mock client", async () => {
    const account = fakeAccount();
    const parent = {
      config: {
        prover: mockProver(),
        poolAddress: "0x123",
        provingUrl: undefined,
        discoveryUrl: undefined,
        tip: 0n,
      },
      network: "sepolia" as const,
      provider: fakeProvider(),
      privacySequencingFor: () => ({}),
    };
    const session = new Strk20Session(
      parent as never,
      { address: "0xabc", publicKey: "0x1" } as never,
      account as never,
      false,
      { provingUrl: "https://mock-over-http.example" },
    );

    await expect(
      session.privacy().submit(callAndProof("mock")),
    ).rejects.toBeInstanceOf(UnsubmittableProofError);
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("rejects proof data without facts before account execution", async () => {
    const account = fakeAccount();
    const incomplete = callAndProof("proof-data");
    incomplete.proof.proofFacts = [];
    const client = new PrivacyClient({
      account: account as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider("proof-data"), {
        submittable: true,
      }),
      discovery,
      privacySdk: fakeSdk(incomplete),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await expect(client.register()).rejects.toBeInstanceOf(
      UnsubmittableProofError,
    );
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("rejects facts without proof data before account execution", async () => {
    const account = fakeAccount();
    const client = new PrivacyClient({
      account: account as never,
      provider: fakeProvider() as never,
      network: "sepolia",
      poolAddress: "0x123",
      prover: customProver(provingProvider(), { submittable: true }),
      discovery,
      privacySdk: fakeSdk(callAndProof()),
      viewingKeyProvider: { getViewingKey: async () => 1n },
    });

    await expect(client.register()).rejects.toBeInstanceOf(
      UnsubmittableProofError,
    );
    expect(account.execute).not.toHaveBeenCalled();
  });
});
