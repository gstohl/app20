/** Production /solve composition. Status 2/3 is an exact committed-fill retry. */
export async function runLocalnetSolve({
  target,
  observed,
  validateObservation,
  bind,
  submitExact,
  reconcileCommitted,
}) {
  if (![1, 2, 3].includes(observed?.status))
    throw new Error(
      "The private intent is neither awaiting fill nor an exact committed fill retry.",
    );
  validateObservation(target, observed, observed.status);
  await bind(target);
  // submitExact is the maker's durable idempotent endpoint. At status 2/3 it
  // returns the result already bound to this immutable attempt without a new
  // wallet/maker effect.
  const filled = await submitExact(target);
  await reconcileCommitted(target, observed.status);
  return filled;
}
