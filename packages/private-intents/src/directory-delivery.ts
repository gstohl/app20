import {
  MAKER_DIRECTORY_DOMAIN,
  canonicalMakerDirectoryEpoch,
  digestMakerDirectoryEpoch,
  verifyMakerDirectoryEpoch,
  type DirectoryAuthorityKey,
  type MakerDirectoryEpochBodyV1,
  type SignedMakerDirectoryEpochV1,
  type VerifiedMakerDirectoryEpochV1,
} from "#protocol";
import type { StarknetPool } from "#index";

export type DirectoryTrustRoot = Readonly<{
  expectedChainId: StarknetPool;
  expectedRegistryRevision: string;
  authorityKeys: readonly DirectoryAuthorityKey[];
  minimumEpoch?: number;
  /** Manifest-pinned predecessor checkpoint allows fresh clients to join after rotation. */
  trustedCheckpoint?: Readonly<{ epoch: number; digest: string }>;
  lastAccepted?: Readonly<{ epoch: number; digest: string }>;
}>;

export type AcceptedPublishedDirectory = Readonly<{
  verified: VerifiedMakerDirectoryEpochV1;
  nextRoot: DirectoryTrustRoot;
}>;
export type PersistedDirectoryHighWater = Readonly<{
  epoch: number;
  digest: string;
  /** The manifest checkpoint this persisted lineage was bootstrapped from. */
  checkpointEpoch?: number;
  checkpointDigest?: string;
}>;
export interface DirectoryHighWaterStore {
  load(): Promise<PersistedDirectoryHighWater | null>;
  compareAndSet(expected: PersistedDirectoryHighWater | null, next: PersistedDirectoryHighWater): Promise<boolean>;
}

/** Accepts delivery bytes only against caller-pinned governance; it never fetches maker URLs. */
export async function acceptPublishedDirectoryEpoch(
  signed: SignedMakerDirectoryEpochV1,
  root: DirectoryTrustRoot,
  now: number,
  verify: (canonical: string, signature: string, publicKey: DirectoryAuthorityKey["publicKey"]) => Promise<boolean>,
): Promise<AcceptedPublishedDirectory> {
  const minimum = root.minimumEpoch ?? 0;
  if (signed.epoch < minimum) throw new Error("Published directory epoch is below the pinned minimum.");
  if (signed.registryRevision !== root.expectedRegistryRevision) throw new Error("Published directory registry revision is not pinned.");
  const highWater = root.lastAccepted ?? root.trustedCheckpoint;
  if (root.lastAccepted && signed.epoch <= root.lastAccepted.epoch) throw new Error("Published directory rollback or duplicate epoch refused.");
  if (!highWater && signed.epoch !== 0) throw new Error("Directory trust requires signed genesis or a manifest-pinned checkpoint.");
  if (highWater && signed.epoch !== highWater.epoch + 1) throw new Error("Published directory must directly extend the pinned high-water epoch.");
  const expectedPreviousEpochDigest = highWater?.digest ?? null;
  const result = await verifyMakerDirectoryEpoch(signed, {
    now,
    expectedChainId: root.expectedChainId,
    expectedEpoch: signed.epoch,
    expectedPreviousEpochDigest,
    authorityKeys: root.authorityKeys,
    verify,
  });
  if (!result.ok) throw new Error(result.reason);
  if (result.verified.status !== "active") throw new Error("Published directory epoch is not active.");
  return Object.freeze({
    verified: result.verified,
    nextRoot: Object.freeze({
      ...root,
      lastAccepted: Object.freeze({ epoch: signed.epoch, digest: result.verified.digest }),
    }),
  });
}

export async function acceptAndPersistPublishedDirectoryEpoch(
  signed: SignedMakerDirectoryEpochV1,
  root: Omit<DirectoryTrustRoot, "lastAccepted">,
  store: DirectoryHighWaterStore,
  now: number,
  verify: Parameters<typeof acceptPublishedDirectoryEpoch>[3],
): Promise<AcceptedPublishedDirectory> {
  const current = await store.load();
  const checkpoint = root.trustedCheckpoint;
  if (current && checkpoint) {
    if (current.epoch < checkpoint.epoch) throw new Error("Persisted directory high-water is below the manifest checkpoint.");
    if (current.epoch === checkpoint.epoch && current.digest.toLowerCase() !== checkpoint.digest.toLowerCase()) throw new Error("Persisted directory high-water conflicts with the manifest checkpoint digest.");
    if (current.epoch > checkpoint.epoch && (current.checkpointEpoch !== checkpoint.epoch || current.checkpointDigest?.toLowerCase() !== checkpoint.digest.toLowerCase())) throw new Error("Persisted directory high-water does not prove the manifest checkpoint lineage.");
  }
  const accepted = await acceptPublishedDirectoryEpoch(signed, { ...root, ...(current ? { lastAccepted: current } : {}) }, now, verify);
  const acceptedHighWater = accepted.nextRoot.lastAccepted!;
  const next: PersistedDirectoryHighWater = Object.freeze({
    ...acceptedHighWater,
    ...(checkpoint ? { checkpointEpoch: checkpoint.epoch, checkpointDigest: checkpoint.digest.toLowerCase() } : {}),
  });
  if (!(await store.compareAndSet(current, next))) throw new Error("Directory high-water CAS conflict; RFQ publication refused.");
  return accepted;
}

export async function publishSignedDirectoryEpoch(
  body: MakerDirectoryEpochBodyV1,
  sign: (canonical: string, authorityKeyId: string) => Promise<string>,
): Promise<SignedMakerDirectoryEpochV1> {
  if (body.domain !== MAKER_DIRECTORY_DOMAIN || body.version !== 1) throw new Error("Only maker directory epoch v1 can be published.");
  const canonical = canonicalMakerDirectoryEpoch(body);
  // Force canonical validation and make publication digest reproducible for operators.
  await digestMakerDirectoryEpoch(body);
  return Object.freeze({ ...body, signature: await sign(canonical, body.authorityKeyId) });
}
