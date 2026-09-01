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
const LOCK_SCHEMA = "app20/localnet-runtime-lock/v1";
const EPOCH = /^[0-9a-f]{32}$/;
const LOCK_TOKEN = /^[0-9a-f]{64}$/;

function persist(path, value) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let renamed = false;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    chmodSync(temporary, 0o600);
    const file = openSync(temporary, "r");
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, path);
    renamed = true;
    const directory = openSync(dirname(path), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (!renamed) rmSync(temporary, { force: true });
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

function readRuntimeLock(path) {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    value?.schema !== LOCK_SCHEMA ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !LOCK_TOKEN.test(value.token) ||
    typeof value.startedAt !== "string" ||
    !value.startedAt
  ) {
    throw new Error(
      "Localnet runtime lock is invalid; refusing to guess ownership.",
    );
  }
  return Object.freeze({
    schema: LOCK_SCHEMA,
    pid: value.pid,
    token: value.token,
    startedAt: value.startedAt,
  });
}

/** Acquire an atomic, process-lifetime lock without deleting another owner. */
export function acquireLocalnetRuntimeLock(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const owner = Object.freeze({
    schema: LOCK_SCHEMA,
    pid: process.pid,
    token: randomBytes(32).toString("hex"),
    startedAt: new Date().toISOString(),
  });
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(path, "wx", 0o600);
    created = true;
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const directory = openSync(dirname(path), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    return owner;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try {
        const current = readRuntimeLock(path);
        if (current?.pid === owner.pid && current.token === owner.token) {
          rmSync(path, { force: true });
        }
      } catch {
        // A partial or substituted lock remains fail-closed for explicit cleanup.
      }
    }
    throw new Error("Could not acquire the localnet runtime lock.", {
      cause: error,
    });
  }
}

/** Release only the exact token returned by acquireLocalnetRuntimeLock(). */
export function releaseLocalnetRuntimeLock(path, owner) {
  const current = readRuntimeLock(path);
  if (!current) return false;
  if (!owner || current.pid !== owner.pid || current.token !== owner.token) {
    throw new Error(
      "Refusing to release a localnet runtime lock owned elsewhere.",
    );
  }
  rmSync(path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
  return true;
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
