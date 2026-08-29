import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  LOCALNET_ESCROW_EVENT_SELECTORS,
  assertLocalnetEscrowArtifactIdentity,
  decodeLocalnetEscrowEvent,
} from "./localnet-chain-decoder.mjs";

const artifact = Object.freeze({
  runtimeEpoch: "0123456789abcdef0123456789abcdef",
  chainId: "0x123",
  escrowAddress: "0x456",
  escrowClassHash: "0x789",
  abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
});
const base = Object.freeze({
  fromAddress: artifact.escrowAddress,
  keys: [LOCALNET_ESCROW_EVENT_SELECTORS.fund, "0xabc"],
  data: ["0x11", "0x64", "0x22", "0xc8", "0x6553f100", "0x33"],
});

test("fixed localnet decoder binds exact artifact, selector, lengths, terms, and u128 order", () => {
  assert.deepEqual(decodeLocalnetEscrowEvent(base, artifact), {
    stage: "fund",
    status: 1,
    dealId: "0xabc",
    sellToken: "0x11",
    sellAmount: "100",
    buyToken: "0x22",
    buyAmount: "200",
    deadline: 1_700_000_000,
    ticketAddress: "0x33",
  });
  const fill = decodeLocalnetEscrowEvent({
    fromAddress: artifact.escrowAddress,
    keys: [LOCALNET_ESCROW_EVENT_SELECTORS.fill, "0xabc"],
    data: ["0x11", "0x64", "0x22", "0xc8"],
  }, artifact);
  assert.equal(fill.buyAmount, "200");
  assert.equal(decodeLocalnetEscrowEvent({
    fromAddress: artifact.escrowAddress,
    keys: [LOCALNET_ESCROW_EVENT_SELECTORS.claim, "0xabc"],
    data: ["0x22", "0xc8"],
  }, artifact).outcome, "settled");
  assert.equal(decodeLocalnetEscrowEvent({
    fromAddress: artifact.escrowAddress,
    keys: [LOCALNET_ESCROW_EVENT_SELECTORS.timeout, "0xabc"],
    data: ["0x11", "0x64"],
  }, artifact).outcome, "refunded");
});

test("decoder mutations fail closed without callback registration", () => {
  const mutations = [
    { ...base, fromAddress: "0x999" },
    { ...base, keys: ["0x1", "0xabc"] },
    { ...base, keys: [LOCALNET_ESCROW_EVENT_SELECTORS.fund] },
    { ...base, keys: [...base.keys, "0x1"] },
    { ...base, data: base.data.slice(0, -1) },
    { ...base, data: [...base.data, "0x1"] },
    { ...base, data: ["0x11", "0x0", ...base.data.slice(2)] },
    { ...base, data: ["0x011", ...base.data.slice(1)] },
  ];
  for (const mutation of mutations)
    assert.throws(() => decodeLocalnetEscrowEvent(mutation, artifact));
  assert.throws(() => assertLocalnetEscrowArtifactIdentity({ ...artifact, abiDigest: "sha256:" + "0".repeat(64) }));
  assert.throws(() => decodeLocalnetEscrowEvent(base, { ...artifact, escrowClassHash: "0x0" }));
});
