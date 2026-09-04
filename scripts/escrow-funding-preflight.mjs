// Funding must be measured inside the same Starknet transaction as the pool
// transfer. A balance observed while proving is stale by the time it executes.
const ADDRESS_BOUND = (1n << 251n) - 256n;
const FUNDED_OPERATIONS = new Set([0n, 1n, 4n, 5n]);

function address(value, label) {
  let parsed;
  try {
    if (typeof value !== "string" && typeof value !== "bigint")
      throw new Error();
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid ${label} for escrow funding preflight.`);
  }
  if (parsed <= 0n || parsed >= ADDRESS_BOUND) {
    throw new Error(`Invalid ${label} for escrow funding preflight.`);
  }
  return `0x${parsed.toString(16)}`;
}

/**
 * Add public prepare_funding calls to the outer account's atomic call batch.
 * Only the configured escrow and Mail helpers are in scope.
 * The proof and the proved pool call remain unchanged. Each helper/token pair
 * may appear once: each helper consumes its snapshot after one funded input.
 */
export function withHelperFundingPreflight(
  callAndProof,
  actions,
  { escrowAddress, mailHelperAddress } = {},
) {
  const escrow =
    escrowAddress === undefined
      ? undefined
      : address(escrowAddress, "escrow address");
  const mail =
    mailHelperAddress === undefined
      ? undefined
      : address(mailHelperAddress, "mail helper address");
  if (!escrow && !mail) return callAndProof;
  const funding = new Map();
  for (const action of actions) {
    if (action.type !== "invoke" && action.type !== "compute_and_invoke")
      continue;
    const helper = address(action.contract, "helper address");
    if (helper !== escrow && helper !== mail) continue;
    const calldata =
      action.type === "invoke" ? action.calldata : action.invoke_calldata;
    if (!Array.isArray(calldata) || calldata.length === 0) {
      throw new Error(
        "Missing escrow invocation or Mail calldata for funding preflight.",
      );
    }
    let token;
    if (helper === escrow) {
      let operation;
      try {
        operation = BigInt(calldata[0]);
      } catch {
        throw new Error("Invalid escrow operation for funding preflight.");
      }
      if (!FUNDED_OPERATIONS.has(operation)) continue;
      token = address(calldata[1], "funding token");
    } else {
      token = address(calldata[0], "funding token");
      // Unfunded Mail remains message-only, and must never recover ambient dust.
      if (
        !actions.some(
          (candidate) =>
            candidate.type === "withdraw" &&
            address(candidate.recipient, "withdrawal recipient") === helper &&
            address(candidate.token, "withdrawal token") === token,
        )
      )
        continue;
    }
    const key = `${helper}:${token}`;
    if (funding.has(key)) {
      throw new Error(
        "Only one funded operation per helper/token is supported in a batch.",
      );
    }
    funding.set(key, { helper, token });
  }
  if (funding.size === 0) return callAndProof;
  const preflight = [...funding.values()].map(({ helper, token }) => ({
    contractAddress: helper,
    entrypoint: "prepare_funding",
    calldata: [token],
  }));
  return {
    ...callAndProof,
    call: [
      ...preflight,
      ...(Array.isArray(callAndProof.call)
        ? callAndProof.call
        : [callAndProof.call]),
    ],
  };
}

export function withEscrowFundingPreflight(
  callAndProof,
  actions,
  escrowAddress,
) {
  return withHelperFundingPreflight(callAndProof, actions, { escrowAddress });
}
