const EPOCH = /^[0-9a-f]{32}$/;
let configuredEpoch: string | undefined;

export function setLocalnetRuntimeEpoch(value: string): void {
  if (!EPOCH.test(value))
    throw new Error("The localnet runtime epoch is invalid.");
  if (configuredEpoch && configuredEpoch !== value)
    throw new Error("The localnet runtime epoch changed without a page reload.");
  configuredEpoch = value;
}

export function localnetRuntimeEpoch(): string {
  return configuredEpoch ?? "localnet-runtime-uninitialized";
}
