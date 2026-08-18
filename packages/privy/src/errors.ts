export class Strk20Error extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigError extends Strk20Error {}
export class PrivyError extends Strk20Error {}
export class AccountNotDeployedError extends Strk20Error {}
export class PrivacySdkMissingError extends Strk20Error {}
export class UnsubmittableProofError extends Strk20Error {}
export class PrivacyTransactionRevertedError extends Strk20Error {}
export class SequencingError extends Strk20Error {}
export class InsufficientBalanceError extends Strk20Error {}
