import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  acquireLocalnetRuntimeLock,
  initializeLocalnetRuntime,
  releaseLocalnetRuntimeLock,
  rotateLocalnetDeploymentEpoch,
} from "./localnet-runtime-state.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function root() {
  const value = mkdtempSync(join(tmpdir(), "app20-runtime-epoch-"));
  roots.push(value);
  return value;
}

test("normal initialization preserves the epoch-scoped coordinator and maker WALs", () => {
  const runtime = root();
  const first = initializeLocalnetRuntime(runtime);
  mkdirSync(join(first.makerRuntimeDir, "maker-a"), { recursive: true });
  writeFileSync(first.coordinatorJournal, "coordinator-preseed\n");
  const wal = join(first.makerRuntimeDir, "maker-a", "reservations.wal");
  writeFileSync(wal, "maker-preseed\n");

  const restarted = initializeLocalnetRuntime(runtime);
  assert.equal(restarted.epoch, first.epoch);
  assert.equal(restarted.coordinatorJournal, first.coordinatorJournal);
  assert.equal(
    readFileSync(restarted.coordinatorJournal, "utf8"),
    "coordinator-preseed\n",
  );
  assert.equal(readFileSync(wal, "utf8"), "maker-preseed\n");
});

test("a fresh chain deployment rotates authority while archiving prior coordinator and maker state", () => {
  const runtime = root();
  const first = initializeLocalnetRuntime(runtime);
  mkdirSync(join(first.makerRuntimeDir, "maker-a"), { recursive: true });
  writeFileSync(first.coordinatorJournal, "coordinator-old-chain\n");
  const wal = join(first.makerRuntimeDir, "maker-a", "reservations.wal");
  writeFileSync(wal, "maker-old-chain\n");

  const second = rotateLocalnetDeploymentEpoch(runtime);
  assert.notEqual(second.epoch, first.epoch);
  assert.equal(second.priorEpoch, first.epoch);
  assert.equal(
    readFileSync(first.coordinatorJournal, "utf8"),
    "coordinator-old-chain\n",
  );
  assert.equal(readFileSync(wal, "utf8"), "maker-old-chain\n");
  assert.equal(initializeLocalnetRuntime(runtime).epoch, second.epoch);
  assert.notEqual(second.coordinatorJournal, first.coordinatorJournal);
});

test("destructive reset is explicit, separately confirmed, and fail-closed", () => {
  const runtime = root();
  const first = initializeLocalnetRuntime(runtime);
  assert.throws(
    () => initializeLocalnetRuntime(runtime, { destructiveReset: true }),
    /confirmation token/i,
  );
  writeFileSync(join(runtime, "state.json"), "{}\n");
  assert.throws(
    () =>
      initializeLocalnetRuntime(runtime, {
        destructiveReset: true,
        confirmation: "DELETE-LOCALNET-RUNTIME",
      }),
    /runtime state exists/i,
  );
  rmSync(join(runtime, "state.json"));
  const reset = initializeLocalnetRuntime(runtime, {
    destructiveReset: true,
    confirmation: "DELETE-LOCALNET-RUNTIME",
  });
  assert.notEqual(reset.epoch, first.epoch);
});

test("runtime lock contention never deletes or releases another owner", () => {
  const lockPath = join(root(), "start.lock");
  const owner = acquireLocalnetRuntimeLock(lockPath);
  assert.equal(statSync(lockPath).mode & 0o777, 0o600);
  assert.throws(
    () => acquireLocalnetRuntimeLock(lockPath),
    /could not acquire/i,
  );
  assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, owner.token);

  assert.throws(
    () =>
      releaseLocalnetRuntimeLock(lockPath, {
        ...owner,
        token: "0".repeat(64),
      }),
    /owned elsewhere/i,
  );
  assert.equal(existsSync(lockPath), true);
  assert.equal(releaseLocalnetRuntimeLock(lockPath, owner), true);
  assert.equal(existsSync(lockPath), false);
  assert.equal(releaseLocalnetRuntimeLock(lockPath, owner), false);

  writeFileSync(lockPath, "partial-lock");
  assert.throws(
    () => acquireLocalnetRuntimeLock(lockPath),
    /could not acquire/i,
  );
  assert.equal(readFileSync(lockPath, "utf8"), "partial-lock");
});
