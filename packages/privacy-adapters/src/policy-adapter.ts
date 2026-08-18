import {
  assertNetworkPolicy,
  assertSubmittableNetworkPolicy,
} from "./network-policy.js";
import {
  operationForIntent,
  type BuiltPrivacyResult,
  type PrivacyAccountAdapter,
  type PrivacyCapabilities,
  type PrivacyIntent,
  type PrivateAssetBalance,
  type PublicAssetBalance,
  type SubmittedPrivacyResult,
} from "./types.js";

export class PrivacyCapabilityError extends Error {
  constructor(operation: string) {
    super(`The selected privacy adapter does not support ${operation}.`);
    this.name = "PrivacyCapabilityError";
  }
}

function capabilityForIntent(
  intent: PrivacyIntent,
): keyof PrivacyCapabilities {
  switch (intent.type) {
    case "register":
      return "register";
    case "shield":
      return "shield";
    case "private-transfer":
      return "privateTransfer";
    case "unshield":
      return "unshield";
    case "mail":
    case "mail-with-transfer":
      return "mail";
  }
}

/**
 * Mandatory policy boundary shared by UI adapters. Mainnet rejection happens
 * before the wrapped adapter can sign, discover, prove, or submit anything.
 */
export class PolicyBoundPrivacyAdapter implements PrivacyAccountAdapter {
  readonly identity;
  readonly capabilities;
  readonly submissionMode;

  constructor(private readonly delegate: PrivacyAccountAdapter) {
    this.identity = delegate.identity;
    this.capabilities = delegate.capabilities;
    this.submissionMode = delegate.submissionMode;
    assertNetworkPolicy({
      network: this.identity.network,
      adapter: this.identity.adapter,
      operation: "connect",
      submissionMode: this.submissionMode,
    });
  }

  publicBalances(
    tokens?: readonly string[],
  ): Promise<readonly PublicAssetBalance[]> {
    if (!this.capabilities.publicRead) {
      throw new PrivacyCapabilityError("public balance reads");
    }
    assertNetworkPolicy({
      network: this.identity.network,
      adapter: this.identity.adapter,
      operation: "public-read",
      submissionMode: this.submissionMode,
    });
    return this.delegate.publicBalances(tokens);
  }

  privateBalances(
    tokens?: readonly string[],
  ): Promise<readonly PrivateAssetBalance[]> {
    if (!this.capabilities.privateRead) {
      throw new PrivacyCapabilityError("private balance reads");
    }
    assertNetworkPolicy({
      network: this.identity.network,
      adapter: this.identity.adapter,
      operation: "private-read",
      submissionMode: this.submissionMode,
    });
    return this.delegate.privateBalances(tokens);
  }

  async build(intent: PrivacyIntent): Promise<BuiltPrivacyResult> {
    this.assertCapability(intent);
    assertNetworkPolicy(this.policyInput(intent));
    return this.delegate.build(intent);
  }

  async submit(intent: PrivacyIntent): Promise<SubmittedPrivacyResult> {
    this.assertCapability(intent);
    assertSubmittableNetworkPolicy(this.policyInput(intent));
    return this.delegate.submit(intent);
  }

  private assertCapability(intent: PrivacyIntent): void {
    const capability = capabilityForIntent(intent);
    if (!this.capabilities[capability]) {
      throw new PrivacyCapabilityError(intent.type);
    }
  }

  private policyInput(intent: PrivacyIntent) {
    return {
      network: this.identity.network,
      adapter: this.identity.adapter,
      operation: operationForIntent(intent),
      submissionMode: this.submissionMode,
    } as const;
  }
}
