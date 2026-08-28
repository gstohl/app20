import { describe, expect, it } from "vitest";
import { acceptAndPersistPublishedDirectoryEpoch, acceptPublishedDirectoryEpoch, type PersistedDirectoryHighWater } from "./directory-delivery";
import { MAKER_DIRECTORY_DOMAIN, type DirectoryAuthorityKey, type SignedMakerDirectoryEpochV1 } from "./protocol";

const NOW = 1_900_000_000;
const JWK = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) } as const;
const authority: DirectoryAuthorityKey = { keyId: "authority", publicKey: JWK, validFrom: NOW - 10, validUntil: NOW + 1_000 };
function epoch(overrides: Partial<SignedMakerDirectoryEpochV1> = {}): SignedMakerDirectoryEpochV1 {
  return { version: 1, domain: MAKER_DIRECTORY_DOMAIN, chainId: "starknet:SN_SEPOLIA", epoch: 0, previousEpochDigest: null, registryRevision: "r1", issuedAt: NOW, validFrom: NOW, validUntil: NOW + 100, authorityKeyId: "authority", makers: [{ makerId: "maker", settlementAccount: "0x1", settlementKeyCommitment: `0x${"11".repeat(32)}`, transportEndpoint: "https://relay.invalid/rfq", quoteKeys: [{ keyId: "q", publicKey: JWK, validFrom: NOW, validUntil: NOW + 100 }], transportKeys: [{ keyId: "t", publicKey: JWK, validFrom: NOW, validUntil: NOW + 100 }] }], signature: `0x${"12".repeat(64)}`, ...overrides };
}

describe("governed directory delivery", () => {
  it("accepts only signed genesis under pinned roots and refuses rollback/duplicate", async () => {
    const root = { expectedChainId: "starknet:SN_SEPOLIA" as const, expectedRegistryRevision: "r1", authorityKeys: [authority] };
    const accepted = await acceptPublishedDirectoryEpoch(epoch(), root, NOW, async () => true);
    await expect(acceptPublishedDirectoryEpoch(epoch(), accepted.nextRoot, NOW, async () => true)).rejects.toThrow(/rollback or duplicate/);
    await expect(acceptPublishedDirectoryEpoch({ ...epoch(), chainId: "starknet:SN_MAIN" }, root, NOW, async () => true)).rejects.toThrow(/chain/);
    await expect(acceptPublishedDirectoryEpoch({ ...epoch(), registryRevision: "mutated" }, root, NOW, async () => true)).rejects.toThrow(/registry revision/);
  });
  it("bootstraps a rotated epoch from a manifest checkpoint and CAS-persists high-water", async () => {
    const checkpoint = { epoch: 4, digest: `0x${"44".repeat(32)}` };
    const rotated = epoch({ epoch: 5, previousEpochDigest: checkpoint.digest });
    let state: PersistedDirectoryHighWater | null = null;
    const store = { load: async () => state, compareAndSet: async (expected: PersistedDirectoryHighWater | null, next: PersistedDirectoryHighWater) => { if (state !== expected) return false; state = next; return true; } };
    const root = { expectedChainId: "starknet:SN_SEPOLIA" as const, expectedRegistryRevision: "r1", authorityKeys: [authority], minimumEpoch: 5, trustedCheckpoint: checkpoint };
    const accepted = await acceptAndPersistPublishedDirectoryEpoch(rotated, root, store, NOW, async () => true);
    expect(state).toEqual({ epoch: 5, digest: accepted.verified.digest, checkpointEpoch: 4, checkpointDigest: checkpoint.digest });
    await expect(acceptAndPersistPublishedDirectoryEpoch(rotated, root, store, NOW, async () => true)).rejects.toThrow(/rollback/);

    state = { epoch: 2, digest: `0x${"22".repeat(32)}` };
    await expect(acceptAndPersistPublishedDirectoryEpoch(rotated, root, store, NOW, async () => true)).rejects.toThrow(/below the manifest checkpoint/);
    state = { epoch: 4, digest: `0x${"55".repeat(32)}` };
    await expect(acceptAndPersistPublishedDirectoryEpoch(rotated, root, store, NOW, async () => true)).rejects.toThrow(/checkpoint digest/);
    state = { epoch: 5, digest: accepted.verified.digest };
    await expect(acceptAndPersistPublishedDirectoryEpoch(epoch({ epoch: 6, previousEpochDigest: accepted.verified.digest }), root, store, NOW, async () => true)).rejects.toThrow(/does not prove.*lineage/);
  });
});
