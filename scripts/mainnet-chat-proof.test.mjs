import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { hash } from 'starknet';
import { chatProofRun } from './mainnet-chat-proof.mjs';

test('the original message keeps its existing replay ID and journal', () => {
  const original = chatProofRun();
  assert.equal(original.directory, resolve(homedir(), '.config/app20/mainnet-chat-proof'));
  assert.equal(BigInt(original.actionId), hash.starknetKeccak('app20/chat/mainnet-release/message/v1'));
});

test('follow-ups have distinct identities and journals, stable across retries', () => {
  const first = chatProofRun('fixed-followup-2026-09-08');
  assert.deepEqual(first, chatProofRun('fixed-followup-2026-09-08'));
  assert.equal(first.directory, resolve(chatProofRun().directory, 'runs/fixed-followup-2026-09-08'));
  for (const other of [chatProofRun(), chatProofRun('another-message')]) {
    assert.notEqual(first.actionId, other.actionId);
    assert.notEqual(first.directory, other.directory);
  }
  for (const bad of ['', '..', '../original', '/tmp/other', 'runs/child', 'UPPER', 'x'.repeat(65)]) {
    assert.throws(() => chatProofRun(bad), /run ID/);
  }
});
