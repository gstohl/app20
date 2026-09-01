import { describe, expect, it, vi } from "vitest";
import type {
  BuiltPrivacyResult,
  PrivacyAccountAdapter,
  PrivacyIntent,
  SubmittedPrivacyResult,
} from "./types.js";
import {
  PolicyBoundPrivacyAdapter,
  PrivacyCapabilityError,
} from "./policy-adapter.js";
import { NetworkPolicyError } from "./network-policy.js";

function adapter(
  overrides: Partial<PrivacyAccountAdapter> = {},
): PrivacyAccountAdapter {
  return {
    identity: {
      adapter: "privy",
      network: "sepolia",
      address: "0x123",
    },
    capabilities: {
      publicRead: true,
      privateRead: true,
      register: true,
      shield: true,
      privateTransfer: true,
      unshield: true,
      mail: true,
    },
    submissionMode: "live",
    publicBalances: vi.fn(async () => []),
    privateBalances: vi.fn(async () => []),
    build: vi.fn(
      async (intent: PrivacyIntent): Promise<BuiltPrivacyResult> => ({
        submitted: false,
        operation: intent.type,
        review: {},
      }),
    ),
    submit: vi.fn(
      async (intent: PrivacyIntent): Promise<SubmittedPrivacyResult> => ({
        submitted: true,
        operation: intent.type,
        transactionHash: "0xabc",
      }),
    ),
    ...overrides,
  };
}

const shield: PrivacyIntent = { type: "shield", token: "0x1", amount: 1n };

describe("PolicyBoundPrivacyAdapter", () => {
  it("rejects a Mainnet Privy adapter during construction", () => {
    const delegate = adapter({
      identity: {
        adapter: "privy",
        network: "mainnet",
        address: "0x123",
      },
    });

    expect(() => new PolicyBoundPrivacyAdapter(delegate)).toThrow(
      NetworkPolicyError,
    );
    expect(delegate.publicBalances).not.toHaveBeenCalled();
    expect(delegate.privateBalances).not.toHaveBeenCalled();
    expect(delegate.build).not.toHaveBeenCalled();
    expect(delegate.submit).not.toHaveBeenCalled();
  });

  it("permits Sepolia Privy builds and submissions", async () => {
    const delegate = adapter();
    const guarded = new PolicyBoundPrivacyAdapter(delegate);

    await expect(guarded.build(shield)).resolves.toMatchObject({
      submitted: false,
    });
    await expect(guarded.submit(shield)).resolves.toMatchObject({
      submitted: true,
      transactionHash: "0xabc",
    });
    expect(delegate.build).toHaveBeenCalledOnce();
    expect(delegate.submit).toHaveBeenCalledOnce();
  });

  it("blocks build-only submission before calling the delegate", async () => {
    const delegate = adapter({ submissionMode: "build-only" });
    const guarded = new PolicyBoundPrivacyAdapter(delegate);

    await expect(guarded.build(shield)).resolves.toMatchObject({
      submitted: false,
    });
    await expect(guarded.submit(shield)).rejects.toThrow(NetworkPolicyError);
    expect(delegate.build).toHaveBeenCalledOnce();
    expect(delegate.submit).not.toHaveBeenCalled();
  });

  it("checks capabilities before invoking an adapter", async () => {
    const base = adapter();
    const delegate = adapter({
      capabilities: { ...base.capabilities, shield: false },
    });
    const guarded = new PolicyBoundPrivacyAdapter(delegate);

    await expect(guarded.submit(shield)).rejects.toThrow(
      PrivacyCapabilityError,
    );
    expect(delegate.submit).not.toHaveBeenCalled();
  });

  it("snapshots identity and capabilities so later mutation cannot widen authority", async () => {
    const identity: {
      adapter: "privy" | "ready";
      network: "sepolia" | "mainnet";
      address: string;
    } = {
      adapter: "privy",
      network: "sepolia",
      address: "0x123",
    };
    const capabilities = {
      publicRead: true,
      privateRead: true,
      register: true,
      shield: false,
      privateTransfer: true,
      unshield: true,
      mail: true,
    };
    const delegate = adapter({ identity, capabilities });
    const guarded = new PolicyBoundPrivacyAdapter(delegate);

    identity.adapter = "ready";
    identity.network = "mainnet";
    capabilities.shield = true;

    expect(guarded.identity).toEqual({
      adapter: "privy",
      network: "sepolia",
      address: "0x123",
    });
    await expect(guarded.submit(shield)).rejects.toThrow(
      PrivacyCapabilityError,
    );
    expect(delegate.submit).not.toHaveBeenCalled();
  });
});
