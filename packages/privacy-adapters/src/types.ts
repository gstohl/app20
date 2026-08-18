import type {
  PrivacyAdapterKind,
  PrivacyNetwork,
  PrivacyOperation,
  PrivacySubmissionMode,
} from "./network-policy.js";

export interface PrivacyAccountIdentity {
  adapter: PrivacyAdapterKind;
  network: PrivacyNetwork;
  address: string;
  publicKey?: string;
  label?: string;
}

export interface PrivacyCapabilities {
  publicRead: boolean;
  privateRead: boolean;
  register: boolean;
  shield: boolean;
  privateTransfer: boolean;
  unshield: boolean;
  mail: boolean;
}

export interface PublicAssetBalance {
  token: string;
  amount: bigint;
}

export interface PrivateNoteSummary {
  id: string;
  token: string;
  amount: bigint;
  sender?: string;
  createdAtBlock?: number;
  mature: boolean;
}

export interface PrivateAssetBalance {
  token: string;
  amount: bigint;
  notes?: readonly PrivateNoteSummary[];
}

export interface BuiltPrivacyResult {
  submitted: false;
  operation: PrivacyOperation;
  review: unknown;
}

export interface SubmittedPrivacyResult {
  submitted: true;
  operation: PrivacyOperation;
  transactionHash: string;
}

export type PrivacyResult = BuiltPrivacyResult | SubmittedPrivacyResult;

export interface EncryptedMailPayload {
  ephemeralPublicKey: readonly [string, string];
  viewTag: string;
  nonce: readonly [string, string];
  ciphertext: readonly string[];
  actionId: string;
}

export type PrivacyIntent =
  | { type: "register" }
  | { type: "shield"; token: string; amount: bigint }
  | {
      type: "private-transfer";
      token: string;
      recipient: string;
      amount: bigint;
    }
  | {
      type: "unshield";
      token: string;
      recipient: string;
      amount: bigint;
    }
  | {
      type: "mail";
      helperAddress: string;
      token: string;
      recoveryAddress: string;
      /** Explicit reviewed helper funding; no compiler may invent a default. */
      helperFundingAmount: bigint;
      payload: EncryptedMailPayload;
    }
  | {
      type: "mail-with-transfer";
      helperAddress: string;
      token: string;
      recoveryAddress: string;
      helperFundingAmount: bigint;
      recipient: string;
      amount: bigint;
      payload: EncryptedMailPayload;
    };

export interface PrivacyAccountAdapter {
  readonly identity: PrivacyAccountIdentity;
  readonly capabilities: PrivacyCapabilities;
  readonly submissionMode: PrivacySubmissionMode;
  publicBalances(tokens?: readonly string[]): Promise<readonly PublicAssetBalance[]>;
  privateBalances(tokens?: readonly string[]): Promise<readonly PrivateAssetBalance[]>;
  build(intent: PrivacyIntent): Promise<BuiltPrivacyResult>;
  submit(intent: PrivacyIntent): Promise<SubmittedPrivacyResult>;
}

export function operationForIntent(intent: PrivacyIntent): PrivacyOperation {
  return intent.type;
}
