import { createHash } from "node:crypto";

export const LOCALNET_CHAIN_AUTHORITY_SERVER_SENTINEL =
  "APP20_LOCALNET_CHAIN_AUTHORITY_SERVER_ONLY_83F0A2";

export const LOCALNET_ESCROW_EVENT_ABI =
  '{"contract":"App20Escrow","version":3,"events":{"DealFunded":{"keys":["deal_id"],"data":["leg_a_token","leg_a_amount","leg_b_token","leg_b_terms","deadline","ticket"]},"DealFilled":{"keys":["deal_id"],"data":["leg_a_token","leg_a_amount","leg_b_token","leg_b_amount"]},"DealClaimed":{"keys":["deal_id"],"data":["token","amount"]},"DealTimedOut":{"keys":["deal_id"],"data":["token","amount"]},"LockCreated":{"keys":["lock_id","rfq_id"],"data":["token_a","token_b","expiry","max_b","points_len","p0_a","p0_b","p1_a","p1_b","p2_a","p2_b","p3_a","p3_b","ticket"]},"LockTaken":{"keys":["lock_id","deal_id"],"data":["amount_a","amount_b","remaining_b"]},"DealTaken":{"keys":["deal_id"],"data":["token_a","total_a","token_b","total_b","fill_count","fills_digest"]},"LockProceedsSettled":{"keys":["lock_id"],"data":["token","amount"]},"LockCollateralReleased":{"keys":["lock_id"],"data":["token","amount"]}}}';
export const LOCALNET_ESCROW_EVENT_ABI_DIGEST =
  "sha256:eb1d9580a85958f3c6fd874b0a9129a687b0cf83a05c7ed5fb352842b58fe3e2";

export const LOCALNET_ESCROW_EVENT_SELECTORS = Object.freeze({
  fund: "0x255d69d3dc5c105a69d867c4d0dc0abd9569404397c49dede157ca0f8132a57",
  fill: "0x14108ccc7ecf46ef85a80d945d48b9d873295ae22d1e2574feca9d0448b20e0",
  claim: "0x8caa1e16be58a9b97b3e20ac5a6383d8c2ec97531cfeec671d85f518ada2c7",
  timeout: "0x1496b02830660069423344eb3411a32595fec93e2095b09e01729c01674e5f1",
  lockCreated:
    "0x2eb2baf9c1aa040e1e1a6e886bb1ec6726367209ae2bab9f51302cb642e8d00",
  lockTaken:
    "0x1cedc16c603117460e56bf3a339b49f3655faef1d523ba671124759a1eb8a05",
  take: "0x3afcb721ad37fcd3319f83cba6d6bdd2ddeb2b9c5fd000f66c2365d3e93d8a4",
  lockProceedsSettled:
    "0x20630ecd661b42566f2330ca75193aec424c538a04106808b2095fea6129ccb",
  lockCollateralReleased:
    "0x2b8e57ff56479407a156ab502b821ef69133406a4c2a210b78c03247086b655",
});

const STAGE_BY_SELECTOR = new Map(
  Object.entries(LOCALNET_ESCROW_EVENT_SELECTORS).map(([stage, selector]) => [
    selector,
    stage,
  ]),
);
const KEY_COUNT = Object.freeze({
  fund: 2,
  fill: 2,
  claim: 2,
  timeout: 2,
  lockCreated: 3,
  lockTaken: 3,
  take: 2,
  lockProceedsSettled: 2,
  lockCollateralReleased: 2,
});

function canonicalFelt(value, label, allowZero = false) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    throw new Error(`${label} must be a lowercase hexadecimal felt.`);
  const parsed = BigInt(value);
  if (parsed >= 1n << 252n || (!allowZero && parsed === 0n))
    throw new Error(`${label} is outside the accepted felt range.`);
  const canonical = `0x${parsed.toString(16)}`;
  if (value !== canonical) throw new Error(`${label} must be canonical.`);
  return canonical;
}

function u128(value, label, allowZero = false) {
  const parsed = BigInt(canonicalFelt(value, label, allowZero));
  if (parsed >= 1n << 128n || (!allowZero && parsed === 0n))
    throw new Error(`${label} must be ${allowZero ? "a" : "a positive"} u128.`);
  return parsed.toString();
}

function positiveU64(value, label) {
  const parsed = BigInt(canonicalFelt(value, label));
  if (parsed >= 1n << 64n) throw new Error(`${label} must be a positive u64.`);
  return Number(parsed);
}

function boundedU8(value, label, minimum, maximum) {
  const parsed = BigInt(canonicalFelt(value, label, minimum === 0));
  if (parsed < BigInt(minimum) || parsed > BigInt(maximum))
    throw new Error(`${label} is outside its accepted u8 range.`);
  return Number(parsed);
}

export function assertLocalnetEscrowArtifactIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Localnet escrow artifact identity is required.");
  if (value.abiDigest !== LOCALNET_ESCROW_EVENT_ABI_DIGEST)
    throw new Error(
      "Localnet escrow ABI digest is not the pinned fixture digest.",
    );
  const calculated = `sha256:${createHash("sha256").update(LOCALNET_ESCROW_EVENT_ABI).digest("hex")}`;
  if (calculated !== LOCALNET_ESCROW_EVENT_ABI_DIGEST)
    throw new Error(
      "Pinned localnet escrow ABI bytes do not match their digest.",
    );
  const runtimeEpoch = String(value.runtimeEpoch ?? "");
  if (!/^[0-9a-f]{32}$/.test(runtimeEpoch))
    throw new Error("Localnet artifact runtime epoch is invalid.");
  const chainId = canonicalFelt(value.chainId, "localnet artifact chainId");
  const escrowAddress = canonicalFelt(
    value.escrowAddress,
    "localnet artifact escrowAddress",
  );
  const escrowClassHash = canonicalFelt(
    value.escrowClassHash,
    "localnet artifact escrowClassHash",
  );
  return Object.freeze({
    runtimeEpoch,
    chainId,
    escrowAddress,
    escrowClassHash,
    abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  });
}

function exactEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("A Starknet event object is required.");
  const fromAddress = canonicalFelt(value.fromAddress, "event source");
  if (!Array.isArray(value.keys) || !Array.isArray(value.data))
    throw new Error("Event keys and data must be arrays.");
  const keys = value.keys.map((item, index) =>
    canonicalFelt(item, `event key ${index}`),
  );
  const data = value.data.map((item, index) =>
    canonicalFelt(item, `event data ${index}`, true),
  );
  const stage = STAGE_BY_SELECTOR.get(keys[0]);
  if (!stage)
    throw new Error("Event selector is not in the pinned localnet ABI.");
  if (keys.length !== KEY_COUNT[stage])
    throw new Error(`Pinned ${stage} event key length is invalid.`);
  return { fromAddress, stage, keys, data };
}

function scheduleFromData(data, pointsLen) {
  const schedule = [];
  for (let index = 0; index < 4; index += 1) {
    const active = index < pointsLen;
    const a = u128(data[5 + index * 2], `lock p${index}_a`, !active);
    const b = u128(data[6 + index * 2], `lock p${index}_b`, !active);
    if (active) schedule.push(Object.freeze({ a, b }));
  }
  for (let index = 1; index < schedule.length; index += 1) {
    if (
      BigInt(schedule[index].a) <= BigInt(schedule[index - 1].a) ||
      BigInt(schedule[index].b) < BigInt(schedule[index - 1].b)
    )
      throw new Error("LockCreated schedule is invalid.");
  }
  return Object.freeze(schedule);
}

/** Fixed generated-style decoder pinned to the freshly built local escrow v3 ABI. */
export function decodeLocalnetEscrowEvent(value, artifact) {
  const identity = assertLocalnetEscrowArtifactIdentity(artifact);
  const event = exactEvent(value);
  if (event.fromAddress !== identity.escrowAddress)
    throw new Error("Settlement event was emitted by another contract.");
  const { stage, keys, data } = event;
  if (stage === "fund") {
    if (data.length !== 6)
      throw new Error("DealFunded data length is invalid.");
    return Object.freeze({
      stage,
      status: 1,
      dealId: keys[1],
      sellToken: canonicalFelt(data[0], "fund sell token"),
      sellAmount: u128(data[1], "fund sell amount"),
      buyToken: canonicalFelt(data[2], "fund buy token"),
      buyAmount: u128(data[3], "fund buy amount"),
      deadline: positiveU64(data[4], "fund deadline"),
      ticketAddress: canonicalFelt(data[5], "fund ticket"),
    });
  }
  if (stage === "fill") {
    if (data.length !== 4)
      throw new Error("DealFilled data length is invalid.");
    return Object.freeze({
      stage,
      status: 2,
      dealId: keys[1],
      sellToken: canonicalFelt(data[0], "fill sell token"),
      sellAmount: u128(data[1], "fill sell amount"),
      buyToken: canonicalFelt(data[2], "fill buy token"),
      buyAmount: u128(data[3], "fill buy amount"),
    });
  }
  if (stage === "claim" || stage === "timeout") {
    if (data.length !== 2)
      throw new Error(
        stage === "claim"
          ? "DealClaimed data length is invalid."
          : "DealTimedOut data length is invalid.",
      );
    return Object.freeze({
      stage,
      status: stage === "claim" ? 3 : 4,
      outcome: stage === "claim" ? "settled" : "refunded",
      dealId: keys[1],
      token: canonicalFelt(data[0], `${stage} token`),
      amount: u128(data[1], `${stage} amount`),
    });
  }
  if (stage === "lockCreated") {
    if (data.length !== 14)
      throw new Error("LockCreated data length is invalid.");
    const pointsLen = boundedU8(data[4], "lock points_len", 1, 4);
    return Object.freeze({
      stage,
      lockId: keys[1],
      rfqId: keys[2],
      tokenA: canonicalFelt(data[0], "lock token A"),
      tokenB: canonicalFelt(data[1], "lock token B"),
      expiry: positiveU64(data[2], "lock expiry"),
      maxB: u128(data[3], "lock max B"),
      pointsLen,
      schedule: scheduleFromData(data, pointsLen),
      ticket: canonicalFelt(data[13], "lock ticket"),
    });
  }
  if (stage === "lockTaken") {
    if (data.length !== 3) throw new Error("LockTaken data length is invalid.");
    return Object.freeze({
      stage,
      lockId: keys[1],
      dealId: keys[2],
      amountA: u128(data[0], "lock taken amount A"),
      amountB: u128(data[1], "lock taken amount B"),
      remainingB: u128(data[2], "lock remaining B", true),
    });
  }
  if (stage === "take") {
    if (data.length !== 6) throw new Error("DealTaken data length is invalid.");
    return Object.freeze({
      stage,
      outcome: "settled",
      dealId: keys[1],
      tokenA: canonicalFelt(data[0], "take token A"),
      totalA: u128(data[1], "take total A"),
      tokenB: canonicalFelt(data[2], "take token B"),
      totalB: u128(data[3], "take total B"),
      fillCount: boundedU8(data[4], "take fill count", 1, 4),
      fillsDigest: canonicalFelt(data[5], "take fills digest", true),
    });
  }
  if (data.length !== 2) {
    throw new Error(
      stage === "lockProceedsSettled"
        ? "LockProceedsSettled data length is invalid."
        : "LockCollateralReleased data length is invalid.",
    );
  }
  return Object.freeze({
    stage,
    lockId: keys[1],
    token: canonicalFelt(data[0], `${stage} token`),
    amount: u128(data[1], `${stage} amount`),
  });
}
