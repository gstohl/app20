import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const SCHEMA = "app20/localnet-runtime-epoch/v1";
const EPOCH = /^[0-9a-f]{32}$/;

function persist(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  const file = openSync(temporary, "r");
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function readEpoch(path) {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.schema !== SCHEMA || !EPOCH.test(value.epoch))
    throw new Error(
      "Localnet runtime epoch file is invalid; refusing implicit reset.",
    );
  return value;
}

function newEpoch() {
  return Object.freeze({
    schema: SCHEMA,
    epoch: randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
  });
}

export function rotateLocalnetDeploymentEpoch(runtimeDir) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const epochFile = join(runtimeDir, "deployment-epoch.json");
  const prior = readEpoch(epochFile);
  const value = newEpoch();
  persist(epochFile, value);
  const epochDir = join(runtimeDir, "epochs", value.epoch);
  mkdirSync(epochDir, { recursive: true, mode: 0o700 });
  return Object.freeze({
    epoch: value.epoch,
    priorEpoch: prior?.epoch,
    epochFile,
    epochDir,
    makerRuntimeDir: join(epochDir, "makers"),
    coordinatorJournal: join(
      epochDir,
      "makers",
      "reservation-coordinator.json",
    ),
  });
}

export function initializeLocalnetRuntime(runtimeDir, options = {}) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const epochFile = join(runtimeDir, "deployment-epoch.json");
  let value = readEpoch(epochFile);
  if (!value) {
    value = newEpoch();
    persist(epochFile, value);
  }
  if (options.destructiveReset === true) {
    if (options.confirmation !== "DELETE-LOCALNET-RUNTIME")
      throw new Error(
        "Destructive localnet reset requires the exact confirmation token.",
      );
    const stateFile = join(runtimeDir, "state.json");
    if (existsSync(stateFile))
      throw new Error(
        "Destructive localnet reset is blocked while runtime state exists; stop and inspect it first.",
      );
    rmSync(join(runtimeDir, "epochs", value.epoch), {
      recursive: true,
      force: true,
    });
    value = newEpoch();
    persist(epochFile, value);
  }
  const epochDir = join(runtimeDir, "epochs", value.epoch);
  mkdirSync(epochDir, { recursive: true, mode: 0o700 });
  return Object.freeze({
    epoch: value.epoch,
    epochFile,
    epochDir,
    makerRuntimeDir: join(epochDir, "makers"),
    coordinatorJournal: join(
      epochDir,
      "makers",
      "reservation-coordinator.json",
    ),
  });
}
