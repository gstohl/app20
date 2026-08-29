import { createHash } from "node:crypto";

export const LOCALNET_CHAIN_AUTHORITY_SERVER_SENTINEL =
  "APP20_LOCALNET_CHAIN_AUTHORITY_SERVER_ONLY_83F0A2";

export const LOCALNET_ESCROW_EVENT_ABI =
  '{"contract":"App20Escrow","version":1,"events":{"DealFunded":{"keys":["deal_id"],"data":["leg_a_token","leg_a_amount","leg_b_token","leg_b_terms","deadline","ticket"]},"DealFilled":{"keys":["deal_id"],"data":["leg_a_token","leg_a_amount","leg_b_token","leg_b_amount"]},"DealClaimed":{"keys":["deal_id"],"data":["token","amount"]},"DealTimedOut":{"keys":["deal_id"],"data":["token","amount"]}}}';
export const LOCALNET_ESCROW_EVENT_ABI_DIGEST =
  "sha256:348f1586e617deac28e3dc05773f9b4ab09fcac2c48e8e03bd3d640e735d3935";

export const LOCALNET_ESCROW_EVENT_SELECTORS = Object.freeze({
  fund: "0x255d69d3dc5c105a69d867c4d0dc0abd9569404397c49dede157ca0f8132a57",
  fill: "0x14108ccc7ecf46ef85a80d945d48b9d873295ae22d1e2574feca9d0448b20e0",
  claim: "0x8caa1e16be58a9b97b3e20ac5a6383d8c2ec97531cfeec671d85f518ada2c7",
  timeout: "0x1496b02830660069423344eb3411a32595fec93e2095b09e01729c01674e5f1",
});

const STAGE_BY_SELECTOR = new Map(
  Object.entries(LOCALNET_ESCROW_EVENT_SELECTORS).map(([stage, selector]) => [
    selector,
    stage,
  ]),
);

function canonicalFelt(value, label, allowZero = false) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    throw new Error(`${label} must be a lowercase hexadecimal felt.`);
  const parsed = BigInt(value);
  if (parsed >= 1n << 252n || (!allowZero && parsed === 0n))
    throw new Error(`${label} is outside the accepted felt range.`);
  const canonical = `0x${parsed.toString(16)}`;
  if (value !== canonical)
    throw new Error(`${label} must be canonical.`);
  return canonical;
}

function positiveU128(value, label) {
  const parsed = BigInt(canonicalFelt(value, label));
  if (parsed <= 0n || parsed >= 1n << 128n)
    throw new Error(`${label} must be a positive u128.`);
  return parsed.toString();
}

function positiveU64(value, label) {
  const parsed = BigInt(canonicalFelt(value, label));
  if (parsed <= 0n || parsed >= 1n << 64n)
    throw new Error(`${label} must be a positive u64.`);
  return Number(parsed);
}

export function assertLocalnetEscrowArtifactIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Localnet escrow artifact identity is required.");
  if (value.abiDigest !== LOCALNET_ESCROW_EVENT_ABI_DIGEST)
    throw new Error("Localnet escrow ABI digest is not the pinned fixture digest.");
  const calculated = `sha256:${createHash("sha256").update(LOCALNET_ESCROW_EVENT_ABI).digest("hex")}`;
  if (calculated !== LOCALNET_ESCROW_EVENT_ABI_DIGEST)
    throw new Error("Pinned localnet escrow ABI bytes do not match their digest.");
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
  if (keys.length !== 2)
    throw new Error("Localnet escrow events require exactly selector and deal-id keys.");
  const stage = STAGE_BY_SELECTOR.get(keys[0]);
  if (!stage) throw new Error("Event selector is not in the pinned localnet ABI.");
  return { fromAddress, stage, dealId: canonicalFelt(keys[1], "event dealId"), data };
}

/** Fixed generated-style decoder for the local legacy fixture only. */
export function decodeLocalnetEscrowEvent(value, artifact) {
  const identity = assertLocalnetEscrowArtifactIdentity(artifact);
  const event = exactEvent(value);
  if (event.fromAddress !== identity.escrowAddress)
    throw new Error("Settlement event was emitted by another contract.");
  const data = event.data;
  if (event.stage === "fund") {
    if (data.length !== 6) throw new Error("DealFunded data length is invalid.");
    return Object.freeze({
      stage: "fund",
      status: 1,
      dealId: event.dealId,
      sellToken: canonicalFelt(data[0], "fund sell token"),
      sellAmount: positiveU128(data[1], "fund sell amount"),
      buyToken: canonicalFelt(data[2], "fund buy token"),
      buyAmount: positiveU128(data[3], "fund buy amount"),
      deadline: positiveU64(data[4], "fund deadline"),
      ticketAddress: canonicalFelt(data[5], "fund ticket"),
    });
  }
  if (event.stage === "fill") {
    if (data.length !== 4) throw new Error("DealFilled data length is invalid.");
    return Object.freeze({
      stage: "fill",
      status: 2,
      dealId: event.dealId,
      sellToken: canonicalFelt(data[0], "fill sell token"),
      sellAmount: positiveU128(data[1], "fill sell amount"),
      buyToken: canonicalFelt(data[2], "fill buy token"),
      buyAmount: positiveU128(data[3], "fill buy amount"),
    });
  }
  if (data.length !== 2)
    throw new Error(
      event.stage === "claim"
        ? "DealClaimed data length is invalid."
        : "DealTimedOut data length is invalid.",
    );
  return Object.freeze({
    stage: event.stage,
    status: event.stage === "claim" ? 3 : 4,
    outcome: event.stage === "claim" ? "settled" : "refunded",
    dealId: event.dealId,
    token: canonicalFelt(data[0], `${event.stage} token`),
    amount: positiveU128(data[1], `${event.stage} amount`),
  });
}
