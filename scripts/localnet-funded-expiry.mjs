/** Production-used, idempotent funded-expiry orchestration seam. */
export async function runLocalnetFundedExpiry({
  target,
  deadline,
  bind,
  release,
  readTime,
  advanceTime,
  observeExpired,
  terminalize,
}) {
  if (!Number.isSafeInteger(deadline) || deadline <= 0)
    throw new Error("Canonical expiry deadline is invalid.");
  const expiredAt = deadline + 1;
  await bind(target);
  const released = await release(target);
  if (!released?.released)
    throw new Error("The selected maker reservation could not be released.");
  if ((await readTime()) < expiredAt) await advanceTime(expiredAt);
  const observed = await observeExpired(target);
  if (observed.status !== 1 || observed.deadline >= expiredAt)
    throw new Error(
      "The exact funded settlement expiry was not authoritatively observed.",
    );
  await terminalize(target);
  return Object.freeze({ expiredAt });
}
