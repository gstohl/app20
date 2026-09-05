import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import { MAIL_SCAN_MAX_MESSAGES } from "@/lib/mail-scan";
import {
  backupBlobDigest,
  createBackupPointer,
  sealBackupBlob,
} from "@/lib/backup-blob";
import { createBackupSnapshot } from "@/lib/backup-snapshot";
import { computeCidV1Raw } from "@/lib/blob-store";
import { addrSTRK } from "@/utils/constants";
import type { LocalMailMessage } from "@/components/mail/message";
import type { EncryptedMailRecord } from "@/lib/mail";
import {
  escrowForNetwork,
  helperForNetwork,
  mailMessageDateTime,
  mergeDisplayAliases,
  mergeMailMessages,
  newestBackupMessages,
  loadBackupSnapshotWithFallback,
  parseBlockTimestamp,
  paymentLinkToLocal,
  sortMailMessages,
} from "./mailbox-model";

const BACKUP_NOW = 2_000_000_000_000;
const BACKUP_SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const BACKUP_CONTEXT = {
  owner: "0xa11ce",
  chainId: "SN_SEPOLIA",
  helperAddress: "0x1234",
  mailboxFingerprint: "ab".repeat(32),
};
const BACKUP_AUTH = {
  mailboxSeed: BACKUP_SEED,
  context: BACKUP_CONTEXT,
  now: BACKUP_NOW,
};

const emptyRecord: EncryptedMailRecord = {
  ephemeralPub: ["0x1", "0x2"],
  viewTag: 3,
  nonce: ["0x4", "0x5"],
  ciphertextFelts: ["0x6"],
};

function textMessage(
  id: string,
  extras: Partial<LocalMailMessage> = {},
): LocalMailMessage {
  return {
    id,
    index: extras.index ?? id,
    plaintext: extras.plaintext ?? "hello",
    envelope: decodeEnvelope(encodeEnvelope("text", { body: "hello" })),
    record: emptyRecord,
    transactionHash: extras.transactionHash ?? `0x${id}`,
    direction: extras.direction ?? "incoming",
    ...extras,
  };
}

function backupPointerMessage(
  id: string,
  kind: "contacts" | "rfq-resume",
  seq: number,
  localCreatedAt: number,
): LocalMailMessage {
  return textMessage(id, {
    localCreatedAt,
    envelope: decodeEnvelope(
      encodeEnvelope(
        "backup_pointer",
        createBackupPointer({
          ...BACKUP_CONTEXT,
          mailboxSeed: BACKUP_SEED,
          kind,
          seq,
          cid: computeCidV1Raw(Uint8Array.of(seq & 0xff, 2, 3)),
          bucketBytes: 4_096,
          blobDigest: "00".repeat(32),
        }),
      ),
    ),
  });
}

function backupSnapshotMessage(
  id: string,
  kind: "contacts" | "rfq-resume",
  seq: number,
  localCreatedAt: number,
  payload: unknown = kind === "contacts"
    ? { entries: [] }
    : {
        schema: "app20/rfq-history-backup/v2",
        chainId: BACKUP_CONTEXT.chainId,
        account: BACKUP_CONTEXT.owner,
        records: [],
        tombstones: [],
        count: 0,
        tombstoneCount: 0,
      },
): LocalMailMessage {
  return textMessage(id, {
    localCreatedAt,
    envelope: decodeEnvelope(
      encodeEnvelope(
        "backup_snapshot",
        createBackupSnapshot({
          ...BACKUP_CONTEXT,
          mailboxSeed: BACKUP_SEED,
          kind,
          seq,
          now: BACKUP_NOW,
          payload,
        }),
      ),
    ),
  });
}

function invoiceMessage(
  requestId: string,
  transport?: "payment_link",
): LocalMailMessage {
  const request = {
    requestId,
    token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
    amount: "1",
    requester: "0xa11ce",
    expiresAt: 2_000_000_000,
  };
  if (transport === "payment_link") {
    return paymentLinkToLocal(request, 1_700_000_000);
  }
  return {
    id: `chain:${requestId}`,
    index: "9",
    plaintext: "",
    envelope: decodeEnvelope(encodeEnvelope("payment_request", request)),
    record: emptyRecord,
    transactionHash: "0xabc",
    direction: "incoming",
    blockNumber: 12,
    eventIndex: 1,
  };
}

describe("localnet-final mailbox contract routing", () => {
  it.each([0, 2])(
    "keeps Mail unavailable on live provider index %i",
    (providerIndex) => {
      expect(helperForNetwork(providerIndex)).toBeNull();
    },
  );

  it.each([0, 2])(
    "keeps legacy escrow unavailable on live provider index %i",
    (providerIndex) => {
      expect(escrowForNetwork(providerIndex)).toBeNull();
    },
  );
});

describe("mailbox list model", () => {
  it("sorts without mutating the input array", () => {
    const older = textMessage("older", { localCreatedAt: 1_000 });
    const newer = textMessage("newer", { localCreatedAt: 2_000 });
    const input = [older, newer];
    const sorted = sortMailMessages(input);

    expect(input.map((message) => message.id)).toEqual(["older", "newer"]);
    expect(sorted.map((message) => message.id)).toEqual(["newer", "older"]);
    expect(sorted).not.toBe(input);
  });

  it("prefers sealed invoice mail over a payment-link projection of the same request", () => {
    const requestId = `0x${"22".repeat(32)}`;
    const merged = mergeMailMessages(
      [invoiceMessage(requestId, "payment_link")],
      [invoiceMessage(requestId)],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.transport).toBeUndefined();
    expect(merged[0]?.id).toBe(`chain:${requestId}`);
  });

  it("caps merged mail at the scan message budget", () => {
    const current = Array.from({ length: MAIL_SCAN_MAX_MESSAGES }, (_, index) =>
      textMessage(`keep-${index}`, { localCreatedAt: index }),
    );
    const incoming = [textMessage("overflow", { localCreatedAt: 10_000_000 })];
    const merged = mergeMailMessages(current, incoming);

    expect(merged).toHaveLength(MAIL_SCAN_MAX_MESSAGES);
    expect(merged[0]?.id).toBe("overflow");
  });

  it("keeps the newest three authenticated sequences per backup kind", () => {
    const newestContacts = backupPointerMessage("contacts-4", "contacts", 4, 2);
    const candidates = newestBackupMessages(
      [
        backupPointerMessage("contacts-1", "contacts", 1, 5),
        backupPointerMessage("contacts-2", "contacts", 2, 4),
        backupSnapshotMessage("contacts-3", "contacts", 3, 3),
        newestContacts,
        backupPointerMessage("rfq-1", "rfq-resume", 1, 1),
        textMessage("letter", { localCreatedAt: 6 }),
      ],
      BACKUP_AUTH,
    );
    expect(candidates.map((message) => message.id)).toEqual([
      "contacts-4",
      "contacts-3",
      "contacts-2",
      "rfq-1",
    ]);
    expect(newestContacts.envelope.type).toBe("backup_pointer");
  });

  it("ignores tampered high-sequence pointers and inline snapshots before ranking", () => {
    const authentic = backupSnapshotMessage("authentic", "contacts", 7, 1);
    const pointer = backupPointerMessage("pointer", "contacts", 8, 2);
    const snapshot = backupSnapshotMessage("snapshot", "contacts", 9, 3);
    const tamperedPointer = {
      ...pointer,
      id: "tampered-pointer",
      envelope: decodeEnvelope(
        encodeEnvelope("backup_pointer", {
          ...(pointer.envelope.payload as Record<string, unknown>),
          seq: 0xffff_ffff,
        }),
      ),
    };
    const tamperedSnapshot = {
      ...snapshot,
      id: "tampered-snapshot",
      envelope: decodeEnvelope(
        encodeEnvelope("backup_snapshot", {
          ...(snapshot.envelope.payload as Record<string, unknown>),
          seq: 0xffff_fffe,
        }),
      ),
    };

    expect(
      newestBackupMessages(
        [tamperedPointer, tamperedSnapshot, authentic],
        BACKUP_AUTH,
      ).map((message) => message.id),
    ).toEqual(["authentic"]);
  });

  it("fails closed on authenticated same-sequence equivocation before ranking", async () => {
    const first = backupSnapshotMessage("rfq-a", "rfq-resume", 12, 1, {
      payload: "a",
    });
    const conflicting = backupSnapshotMessage("rfq-b", "rfq-resume", 12, 2, {
      payload: "b",
    });

    expect(() =>
      newestBackupMessages([first, conflicting], BACKUP_AUTH),
    ).toThrow(/conflicting authenticated backup candidates/i);
    await expect(
      loadBackupSnapshotWithFallback([first, conflicting], {
        ...BACKUP_AUTH,
        kind: "rfq-resume",
        loadBlob: async () => new Uint8Array(),
      }),
    ).rejects.toThrow(/conflicting authenticated backup candidates/i);
  });

  it("opens an authenticated pointer and verifies its nested snapshot", async () => {
    const snapshot = createBackupSnapshot({
      ...BACKUP_CONTEXT,
      mailboxSeed: BACKUP_SEED,
      kind: "contacts",
      seq: 12,
      now: BACKUP_NOW,
      payload: { entries: [] },
    });
    const inline = encodeEnvelope("backup_snapshot", snapshot);
    const blob = await sealBackupBlob({
      mailboxSeed: BACKUP_SEED,
      owner: BACKUP_CONTEXT.owner,
      chainId: BACKUP_CONTEXT.chainId,
      kind: "contacts",
      seq: 12,
      bytes: inline,
    });
    const cid = computeCidV1Raw(blob);
    const pointer = textMessage("pointer", {
      envelope: decodeEnvelope(
        encodeEnvelope(
          "backup_pointer",
          createBackupPointer({
            ...BACKUP_CONTEXT,
            mailboxSeed: BACKUP_SEED,
            kind: "contacts",
            seq: 12,
            cid,
            bucketBytes: blob.length,
            blobDigest: backupBlobDigest(blob),
          }),
        ),
      ),
    });

    const loaded = await loadBackupSnapshotWithFallback([pointer], {
      ...BACKUP_AUTH,
      kind: "contacts",
      loadBlob: async (requestedCid) => {
        expect(requestedCid).toBe(cid);
        return blob;
      },
    });

    expect(loaded.message.id).toBe("pointer");
    expect(loaded.snapshot).toEqual(snapshot);
    expect(loaded.failures).toEqual([]);
  });

  it("does zero blob fetches for a flood of forged pointers", async () => {
    const authentic = backupSnapshotMessage("authentic", "contacts", 1, 1);
    const forged = Array.from({ length: 100 }, (_, index) =>
      textMessage(`forged-${index}`, {
        localCreatedAt: index + 2,
        envelope: decodeEnvelope(
          encodeEnvelope("backup_pointer", {
            kind: "contacts",
            seq: 0xffff_ffff - index,
            cid: computeCidV1Raw(Uint8Array.of(index, 2, 3)),
            bucketBytes: 4_096,
            blobDigest: "00".repeat(32),
            mac: "00".repeat(32),
          }),
        ),
      }),
    );
    let fetches = 0;
    const loaded = await loadBackupSnapshotWithFallback(
      [...forged, authentic],
      {
        ...BACKUP_AUTH,
        kind: "contacts",
        loadBlob: async () => {
          fetches += 1;
          throw new Error("must not fetch");
        },
      },
    );

    expect(loaded.snapshot.seq).toBe(1);
    expect(loaded.failures).toEqual([]);
    expect(fetches).toBe(0);
  });

  it("falls back after unavailable and corrupt authenticated pointers", async () => {
    const unavailable = backupPointerMessage("unavailable", "contacts", 4, 4);
    const corrupt = backupPointerMessage("corrupt", "contacts", 3, 3);
    const fallback = backupSnapshotMessage("fallback", "contacts", 2, 2);
    let fetches = 0;
    const loaded = await loadBackupSnapshotWithFallback(
      [fallback, corrupt, unavailable],
      {
        ...BACKUP_AUTH,
        kind: "contacts",
        loadBlob: async () => {
          fetches += 1;
          if (fetches === 1) throw new Error("blob unavailable");
          return new Uint8Array(4_096);
        },
      },
    );

    expect(fetches).toBe(2);
    expect(loaded.message.id).toBe("fallback");
    expect(loaded.snapshot.seq).toBe(2);
    expect(loaded.failures).toHaveLength(2);
    expect(loaded.failures[0]).toEqual({
      messageId: "unavailable",
      seq: 4,
      reason: "blob unavailable",
    });
    expect(loaded.failures[1]).toMatchObject({
      messageId: "corrupt",
      seq: 3,
    });
    expect(loaded.failures[1]?.reason).toMatch(/does not match/i);
  });

  it("never rolls RFQ history back when the newest authenticated pointer is unavailable", async () => {
    const unavailable = backupPointerMessage(
      "rfq-unavailable",
      "rfq-resume",
      4,
      4,
    );
    const older = backupSnapshotMessage("rfq-older", "rfq-resume", 3, 3);
    let fetches = 0;

    await expect(
      loadBackupSnapshotWithFallback([older, unavailable], {
        ...BACKUP_AUTH,
        kind: "rfq-resume",
        loadBlob: async () => {
          fetches += 1;
          throw new Error("blob unavailable");
        },
      }),
    ).rejects.toThrow(/rollback fallback is disabled/i);
    expect(fetches).toBe(1);
  });

  it("never fetches more than three authenticated candidates per kind", async () => {
    const candidates = [4, 3, 2, 1].map((seq) =>
      backupPointerMessage(`pointer-${seq}`, "contacts", seq, seq),
    );
    let fetches = 0;
    await expect(
      loadBackupSnapshotWithFallback(candidates, {
        ...BACKUP_AUTH,
        kind: "contacts",
        loadBlob: async () => {
          fetches += 1;
          throw new Error("unavailable");
        },
      }),
    ).rejects.toThrow(/3 authenticated backup candidates/i);
    expect(fetches).toBe(3);
  });

  it("exposes an ISO timestamp for accessible list times", () => {
    const message = textMessage("dated", {
      localCreatedAt: Date.UTC(2026, 0, 2),
    });
    expect(mailMessageDateTime(message)).toBe("2026-01-02T00:00:00.000Z");
  });

  it("merges aliases without throwing on an unparseable address", () => {
    const merged = mergeDisplayAliases(
      [{ address: "0x1", label: "Book", addedAt: 1 }],
      [
        { address: "0x1", label: "Duplicate", addedAt: 2 },
        { address: "not-a-felt", label: "Broken", addedAt: 3 },
      ],
    );
    expect(merged.map((entry) => entry.label)).toEqual(["Book", "Broken"]);
  });

  it("merges 512 messages well under a 50ms local budget", () => {
    const current = Array.from({ length: 256 }, (_, index) =>
      textMessage(`a-${index}`, { localCreatedAt: index }),
    );
    const incoming = Array.from({ length: 256 }, (_, index) =>
      textMessage(`b-${index}`, { localCreatedAt: index + 1_000 }),
    );
    const started = performance.now();
    const merged = mergeMailMessages(current, incoming);
    const elapsed = performance.now() - started;
    expect(merged).toHaveLength(512);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("parseBlockTimestamp", () => {
  it.each([
    ["decimal string", "1700000000", 1_700_000_000],
    ["hex string", "0x656", 1_622],
    ["safe integer", 42, 42],
    ["bigint", 99n, 99],
  ] as const)("accepts a %s timestamp", (_label, value, expected) => {
    expect(parseBlockTimestamp(value)).toBe(expected);
  });

  it.each([1.5, -1, "0xzz", "hello", Number.MAX_SAFE_INTEGER + 1])(
    "rejects %s",
    (value) => {
      expect(parseBlockTimestamp(value)).toBeUndefined();
    },
  );
});
