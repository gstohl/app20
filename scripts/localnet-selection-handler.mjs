export async function selectQuoteThroughCoordinator({
  coordinator,
  intentDigest,
  reservationId,
  makerId,
  makerSelect,
  publishConfirmed = () => undefined,
  release,
  now,
}) {
  const identity = { intentDigest, reservationId, makerId };
  await coordinator.beginSelection(identity);
  const authorization = await makerSelect({ reservationId, intentDigest });
  if (!authorization || authorization.selected !== true)
    throw new Error(
      "Maker did not acknowledge the exact durable pending selection.",
    );
  const confirmed = await coordinator.confirmSelection({
    ...identity,
    fence: authorization.fence,
    quoteDigest: authorization.quoteDigest,
  });
  await publishConfirmed(confirmed);
  const unresolved = await coordinator.releaseLosers(
    intentDigest,
    release,
    now,
  );
  return Object.freeze({ confirmed, unresolved });
}
