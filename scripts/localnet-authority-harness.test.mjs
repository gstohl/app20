import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  UNSIGNED_LOCALNET_AUTHORITY_HARNESS_SCHEMA,
  runUnsignedLocalnetAuthorityHarness,
} from "./localnet-authority-harness.mjs";

test("unsigned harness covers both directions, terminal outcomes, restart, failures, reorg, refusal, and reconciliation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "app20-authority-harness-"));
  try {
    const result = await runUnsignedLocalnetAuthorityHarness(directory);
    assert.equal(result.schema, UNSIGNED_LOCALNET_AUTHORITY_HARNESS_SCHEMA);
    assert.equal(result.unsigned, true);
    assert.equal(result.publicNetworkUsed, false);
    assert.deepEqual(result.directions, ["STRK→USDC", "USDC→STRK"]);
    assert.equal(result.settled, "authoritative");
    assert.equal(result.claimReconciliation, "released-terminal");
    assert.equal(result.refunded, "authoritative");
    assert.equal(result.timeoutReconciliation, "released-terminal");
    assert.equal(result.restart, "authoritative");
    assert.equal(result.outage, "disagreement");
    assert.equal(result.disagreement, "disagreement");
    assert.equal(result.reorg, "reorged");
    assert.equal(result.refusal, "released");
    assert.equal(result.refusalFanoutComplete, true);
    assert.equal(result.refusalReservations, 0);
    assert.equal(result.refusalSettlementEffects, 0);
    assert.equal(result.publicFallbackEffects, 0);
    assert.equal(result.releaseEffects, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
