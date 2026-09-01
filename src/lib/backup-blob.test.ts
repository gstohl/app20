import { describe, expect, it } from "vitest";
import {
  BACKUP_BLOB_BUCKET_BYTES,
  backupBlobDigest,
  createBackupPointer,
  openBackupBlob,
  parseBackupPointer,
  sealBackupBlob,
} from "./backup-blob";

const SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const OWNER = "0xa11ce";
const CHAIN = "SN_SEPOLIA";

function input(bytes = new TextEncoder().encode("private backup")) {
  return {
    mailboxSeed: SEED,
    owner: OWNER,
    chainId: CHAIN,
    kind: "contacts" as const,
    seq: 17,
    bytes,
  };
}

describe("encrypted backup blobs", () => {
  it("round-trips AES-GCM plaintext in exact 4096-byte buckets", async () => {
    const plaintext = new TextEncoder().encode("private backup");
    const blob = await sealBackupBlob(input(plaintext));

    expect(blob.length).toBe(BACKUP_BLOB_BUCKET_BYTES);
    expect(blob.length % BACKUP_BLOB_BUCKET_BYTES).toBe(0);
    expect(blob.slice(0, 6)).toEqual(Uint8Array.of(1, 1, 0, 0, 0, 17));
    await expect(
      openBackupBlob({
        ...input(),
        blob,
      }),
    ).resolves.toEqual(plaintext);
  });

  it("fails closed on ciphertext, AAD, kind, and sequence tampering", async () => {
    const blob = await sealBackupBlob(input());
    const tampered = blob.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(
      openBackupBlob({ ...input(), blob: tampered }),
    ).rejects.toThrow(/authentication/i);
    await expect(
      openBackupBlob({ ...input(), owner: "0xb0b", blob }),
    ).rejects.toThrow(/authentication/i);
    await expect(openBackupBlob({ ...input(), seq: 18, blob })).rejects.toThrow(
      /header/i,
    );
    await expect(
      openBackupBlob({ ...input(), kind: "rfq-resume", blob }),
    ).rejects.toThrow(/header/i);
  });

  it("strictly validates pointer shape, bucket, and digest", async () => {
    const blob = await sealBackupBlob(input());
    const pointer = createBackupPointer({
      kind: "contacts",
      seq: 17,
      cid: `b${"a".repeat(58)}`,
      bucketBytes: blob.length,
      blobDigest: backupBlobDigest(blob),
    });
    expect(parseBackupPointer(pointer)).toEqual(pointer);
    expect(() => parseBackupPointer({ ...pointer, extra: true })).toThrow(
      /schema/i,
    );
    expect(() =>
      parseBackupPointer({ ...pointer, bucketBytes: blob.length - 1 }),
    ).toThrow(/invalid/i);
    expect(() => parseBackupPointer({ ...pointer, blobDigest: "00" })).toThrow(
      /invalid/i,
    );
    expect(() =>
      parseBackupPointer({ ...pointer, cid: `b${"a".repeat(57)}` }),
    ).toThrow(/invalid/i);
  });

  it("rejects plaintext whose sealed representation exceeds 1 MiB", async () => {
    await expect(
      sealBackupBlob(input(new Uint8Array(1_048_576))),
    ).rejects.toThrow(/1 MiB/i);
  });

  it("uses a second bucket when the complete sealed format crosses 4096 bytes", async () => {
    const blob = await sealBackupBlob(input(new Uint8Array(4_100)));
    expect(blob.length).toBe(BACKUP_BLOB_BUCKET_BYTES * 2);
    await expect(openBackupBlob({ ...input(), blob })).resolves.toEqual(
      new Uint8Array(4_100),
    );
  });
});
