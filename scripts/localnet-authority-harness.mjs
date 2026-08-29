import { join } from "node:path";
import {
  LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  LOCALNET_ESCROW_EVENT_SELECTORS,
} from "./localnet-chain-decoder.mjs";
import { createLocalnetChainAuthority } from "./localnet-chain-authority.mjs";
import { createLocalnetMakerReconciler } from "./localnet-maker-reconciler.mjs";
import { createLocalnetReservationCoordinator } from "./localnet-reservation-coordinator.mjs";

export const UNSIGNED_LOCALNET_AUTHORITY_HARNESS_SCHEMA =
  "app20/unsigned-localnet-authority-harness/v1";

const RUNTIME_EPOCH = "0123456789abcdef0123456789abcdef";
const CHAIN_ID = "0x51554945544c494e455f4c4f43414c";
const ESCROW = "0x1234";
const CLASS_HASH = "0x5678";
const STRK = "0x111";
const USDC = "0x222";
function felt(number) {
  return `0x${BigInt(number).toString(16)}`;
}
function digest(byte) {
  return `0x${byte.repeat(64)}`;
}
function event(stage, query) {
  const keys = [LOCALNET_ESCROW_EVENT_SELECTORS[stage], query.dealId];
  if (stage === "fund")
    return {
      fromAddress: ESCROW,
      keys,
      data: [
        query.sellToken,
        felt(query.sellAmount),
        query.buyToken,
        felt(query.buyAmount),
        felt(query.deadline),
        query.ticketAddress,
      ],
    };
  if (stage === "fill")
    return {
      fromAddress: ESCROW,
      keys,
      data: [
        query.sellToken,
        felt(query.sellAmount),
        query.buyToken,
        felt(query.buyAmount),
      ],
    };
  if (stage === "claim")
    return {
      fromAddress: ESCROW,
      keys,
      data: [query.buyToken, felt(query.buyAmount)],
    };
  return {
    fromAddress: ESCROW,
    keys,
    data: [query.sellToken, felt(query.sellAmount)],
  };
}
function query(seed, outcome, sellToken, sellAmount, buyToken, buyAmount) {
  const base = 100 + seed * 10;
  const stages =
    outcome === "settled" ? ["fund", "fill", "claim"] : ["fund", "timeout"];
  return Object.freeze({
    runtimeEpoch: RUNTIME_EPOCH,
    chainId: CHAIN_ID,
    account: felt(0xa00 + seed),
    rfqId: felt(0xb00 + seed),
    dealId: felt(0xb00 + seed),
    intentDigest: digest(String((seed % 9) + 1)),
    commitmentDigest: digest(String(((seed + 1) % 9) + 1)),
    reservationId: digest(String(((seed + 2) % 9) + 1)),
    reservationFence: String(seed + 1),
    quoteDigest: digest(String(((seed + 3) % 9) + 1)),
    makerId: `maker-${seed % 2 ? "b" : "a"}`,
    sellToken,
    sellAmount: String(sellAmount),
    buyToken,
    buyAmount: String(buyAmount),
    deadline: 2_000_000_000 + seed,
    ticketAddress: felt(0xc00 + seed),
    outcome,
    transactions: Object.freeze(
      Object.fromEntries(
        stages.map((stage, index) => [stage, felt(0xd00 + base + index)]),
      ),
    ),
  });
}
function observation(exact, mode, readerIndex) {
  if (mode.value === "outage" && readerIndex === 1)
    throw new Error("deterministic reader outage");
  const stages =
    exact.outcome === "settled"
      ? ["fund", "fill", "claim"]
      : ["fund", "timeout"];
  const lifecycle = stages.map((stage, index) => {
    const blockNumber = 100 + index;
    const changed = mode.value === "reorg" && stage === stages.at(-1);
    const disagree =
      mode.value === "disagreement" &&
      readerIndex === 1 &&
      stage === stages.at(-1);
    const blockHash = felt(
      0xe00 + blockNumber + (changed ? 100 : 0) + (disagree ? 200 : 0),
    );
    return Object.freeze({
      stage,
      transactionHash: exact.transactions[stage],
      blockNumber,
      blockHash,
      transactionIndex: 0,
      eventIndex: 0,
      event: event(stage, exact),
      block: Object.freeze({
        number: blockNumber,
        hash: blockHash,
        transactions: Object.freeze([exact.transactions[stage]]),
      }),
    });
  });
  return Object.freeze({
    runtimeEpoch: RUNTIME_EPOCH,
    chainId: CHAIN_ID,
    artifact: Object.freeze({
      runtimeEpoch: RUNTIME_EPOCH,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      escrowClassHash: CLASS_HASH,
      abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
    }),
    observedAt: 1_900_000_000,
    head: Object.freeze({
      number: 120,
      hash: felt(
        0xf00 + (mode.value === "disagreement" && readerIndex === 1 ? 1 : 0),
      ),
    }),
    finalizedHead: 120,
    lifecycle: Object.freeze(lifecycle),
  });
}
function coordinator(exact) {
  return Object.freeze({
    state: exact.outcome,
    intentDigest: exact.intentDigest,
    rfqId: exact.rfqId,
    account: exact.account,
    chainId: exact.chainId,
    selection: Object.freeze({
      reservationId: exact.reservationId,
      makerId: exact.makerId,
      fence: exact.reservationFence,
      quoteDigest: exact.quoteDigest,
    }),
  });
}
function reservation(exact) {
  return Object.freeze({
    makerId: exact.makerId,
    intentDigest: exact.intentDigest,
    reservationId: exact.reservationId,
    fence: exact.reservationFence,
    quoteDigest: exact.quoteDigest,
    sellToken: exact.sellToken,
    sellAmount: exact.sellAmount,
    buyToken: exact.buyToken,
    buyAmount: exact.buyAmount,
    deadline: exact.deadline,
    ticketAddress: exact.ticketAddress,
    state: exact.outcome === "settled" ? "consumed" : "selected",
    ...(exact.outcome === "settled"
      ? { settlementTransactionHash: exact.transactions.fill }
      : {}),
  });
}

/** Deterministic, unsigned, no-RPC acceptance harness for local policy only. */
export async function runUnsignedLocalnetAuthorityHarness(directory) {
  const mode = { value: "agreement" };
  const artifact = {
    runtimeEpoch: RUNTIME_EPOCH,
    chainId: CHAIN_ID,
    escrowAddress: ESCROW,
    escrowClassHash: CLASS_HASH,
    abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  };
  const readers = [0, 1].map((index) =>
    Object.freeze({
      id: `fixture-view-${index + 1}`,
      independence: "same-devnet-fixture",
      observe: async (exact) => observation(exact, mode, index),
    }),
  );
  const authorityPath = join(directory, "authority.json");
  const authority = createLocalnetChainAuthority({
    path: authorityPath,
    artifact,
    readers,
    now: () => 1_900_000_000,
    maxAgeSeconds: 30,
    finalityDepth: 2,
  });
  const releaseEffects = new Set();
  const reconcilerPath = join(directory, "reconciliation.json");
  const reconciler = createLocalnetMakerReconciler({
    path: reconcilerPath,
    runtimeEpoch: RUNTIME_EPOCH,
    now: () => 1_900_000_000,
    quarantineAuthority: async () => undefined,
    releaseTerminal: async ({ attemptId }) => {
      releaseEffects.add(attemptId);
    },
  });
  const settled = query(1, "settled", STRK, 10n ** 18n, USDC, 2n * 10n ** 6n);
  const settledProjection = await authority.verify({
    query: settled,
    market: "strk-usdc",
  });
  const settledRecon = await reconciler.reconcile({
    query: settled,
    coordinator: coordinator(settled),
    reservation: reservation(settled),
    authorityEvidence: authority.reconciliationEvidence(settled),
  });
  const refunded = query(2, "refunded", USDC, 2n * 10n ** 6n, STRK, 10n ** 18n);
  const refundedProjection = await authority.verify({
    query: refunded,
    market: "usdc-strk",
  });
  const refundedRecon = await reconciler.reconcile({
    query: refunded,
    coordinator: coordinator(refunded),
    reservation: reservation(refunded),
    authorityEvidence: authority.reconciliationEvidence(refunded),
  });
  const restarted = createLocalnetChainAuthority({
    path: authorityPath,
    artifact,
    readers,
    now: () => 1_900_000_001,
    maxAgeSeconds: 30,
    finalityDepth: 2,
  });
  const restartProjection = restarted.snapshot(settled);
  mode.value = "outage";
  const outage = await restarted.verify({
    query: query(3, "settled", STRK, 2n * 10n ** 18n, USDC, 4n * 10n ** 6n),
    market: "strk-usdc",
  });
  mode.value = "disagreement";
  const disagreement = await restarted.verify({
    query: query(4, "refunded", USDC, 4n * 10n ** 6n, STRK, 2n * 10n ** 18n),
    market: "usdc-strk",
  });
  mode.value = "agreement";
  const reorgTarget = query(
    5,
    "settled",
    STRK,
    3n * 10n ** 18n,
    USDC,
    6n * 10n ** 6n,
  );
  await restarted.verify({ query: reorgTarget, market: "strk-usdc" });
  mode.value = "reorg";
  const reorg = await restarted.verify({
    query: reorgTarget,
    market: "strk-usdc",
  });

  // Exercise the same durable coordinator path used by /private-intents/quotes:
  // both invited makers refuse, fanout closes, and the request becomes a
  // terminal tombstone without creating a reservation or settlement effect.
  const refusalCoordinator = createLocalnetReservationCoordinator(
    join(directory, "refusal-coordinator.json"),
  );
  const refusalIntentDigest = digest("8");
  await refusalCoordinator.beginRequest({
    intentDigest: refusalIntentDigest,
    rfqId: felt(0xb99),
    account: felt(0xa99),
    chainId: CHAIN_ID,
    createdAt: 1_900_000_000,
    expiresAt: 1_900_000_030,
    market: "strk-usdc",
    makerIds: ["maker-a", "maker-b"],
  });
  await refusalCoordinator.markFanoutRefused(refusalIntentDigest, "maker-a");
  await refusalCoordinator.markFanoutRefused(refusalIntentDigest, "maker-b");
  const refusedRequest =
    await refusalCoordinator.completeRequestFanout(refusalIntentDigest);
  const refusalReservations = refusalCoordinator
    .list()
    .filter((record) => record.intentDigest === refusalIntentDigest);

  return Object.freeze({
    schema: UNSIGNED_LOCALNET_AUTHORITY_HARNESS_SCHEMA,
    unsigned: true,
    publicNetworkUsed: false,
    directions: Object.freeze(["STRK→USDC", "USDC→STRK"]),
    settled: settledProjection.status,
    claimReconciliation: settledRecon.status,
    refunded: refundedProjection.status,
    timeoutReconciliation: refundedRecon.status,
    restart: restartProjection?.status,
    outage: outage.status,
    disagreement: disagreement.status,
    reorg: reorg.status,
    refusal: refusedRequest.state,
    refusalFanoutComplete: refusedRequest.fanoutComplete,
    refusalReservations: refusalReservations.length,
    refusalSettlementEffects: 0,
    publicFallbackEffects: 0,
    releaseEffects: releaseEffects.size,
    operatorRows: restarted.listOperatorSummaries().length,
  });
}
