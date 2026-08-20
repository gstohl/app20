import { describe, expect, it } from "vitest";
import {
  normalizeStarknetAddress,
  type AddressBookEntry,
} from "./address-book";
import {
  createContactSnapshot,
  verifyContactSnapshot,
  type ContactSnapshotV1,
} from "./contact-backup";

const OWNER = "0xa11ce";
const OTHER_OWNER = "0xb0b";
const HELPER = "0x1234";
const CHAIN = "0x534e5f5345504f4c4941";
const FINGERPRINT = "ab".repeat(32);
const NOW = 2_000_000_000_000;
const SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const ENTRIES: AddressBookEntry[] = [
  { label: "Treasury", address: "0x9876", updatedAt: NOW - 20 },
  { label: "APP20 desk", address: "0x4567", updatedAt: NOW - 10 },
];

function context(mailboxSeed = SEED) {
  return {
    owner: OWNER,
    chainId: CHAIN,
    helperAddress: HELPER,
    mailboxFingerprint: FINGERPRINT,
    mailboxSeed,
    now: NOW,
  };
}

function clone(snapshot: ContactSnapshotV1): ContactSnapshotV1 {
  return JSON.parse(JSON.stringify(snapshot)) as ContactSnapshotV1;
}

describe("authenticated contact snapshots", () => {
  it("canonicalizes and verifies a wallet, chain, helper, and mailbox-bound snapshot", () => {
    const snapshot = createContactSnapshot({ ...context(), entries: ENTRIES });
    const verified = verifyContactSnapshot(snapshot, context());

    expect(verified.owner).toBe(normalizeStarknetAddress(OWNER));
    expect(verified.helperAddress).toBe(normalizeStarknetAddress(HELPER));
    expect(verified.entries.map((entry) => entry.label)).toEqual([
      "APP20 desk",
      "Treasury",
    ]);
    expect(verified.snapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.mac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonicalizes Ready named, felt, and starknet-prefixed chain IDs", () => {
    const mainnet = createContactSnapshot({
      ...context(),
      chainId: "starknet:SN_MAIN",
      entries: ENTRIES,
    });
    expect(mainnet.chainId).toBe("0x534e5f4d41494e");
    expect(
      verifyContactSnapshot(mainnet, {
        ...context(),
        chainId: "0x534e5f4d41494e",
      }).chainId,
    ).toBe(mainnet.chainId);

    const sepolia = createContactSnapshot({
      ...context(),
      chainId: "SN_SEPOLIA",
      entries: ENTRIES,
    });
    expect(sepolia.chainId).toBe("0x534e5f5345504f4c4941");
    expect(
      verifyContactSnapshot(sepolia, {
        ...context(),
        chainId: "starknet:SN_SEPOLIA",
      }).chainId,
    ).toBe(sepolia.chainId);
  });

  it("rejects another wallet, network, helper, mailbox key, or recovery seed", () => {
    const snapshot = createContactSnapshot({ ...context(), entries: ENTRIES });
    expect(() =>
      verifyContactSnapshot(snapshot, { ...context(), owner: OTHER_OWNER }),
    ).toThrow(/different wallet/i);
    expect(() =>
      verifyContactSnapshot(snapshot, { ...context(), chainId: "0x1" }),
    ).toThrow(/different wallet/i);
    expect(() =>
      verifyContactSnapshot(snapshot, { ...context(), helperAddress: "0x999" }),
    ).toThrow(/different wallet/i);
    expect(() =>
      verifyContactSnapshot(snapshot, {
        ...context(),
        mailboxFingerprint: "cd".repeat(32),
      }),
    ).toThrow(/different wallet/i);
    expect(() =>
      verifyContactSnapshot(
        snapshot,
        context(Uint8Array.from({ length: 32 }, () => 9)),
      ),
    ).toThrow(/authentication failed/i);
  });

  it("rejects entry, digest, MAC, schema, duplicate, and future-time tampering", () => {
    const snapshot = createContactSnapshot({ ...context(), entries: ENTRIES });

    const entryTamper = clone(snapshot);
    entryTamper.entries[0].label = "Attacker";
    expect(() => verifyContactSnapshot(entryTamper, context())).toThrow(
      /authentication failed/i,
    );

    const digestTamper = clone(snapshot);
    digestTamper.digest = "00".repeat(32);
    expect(() => verifyContactSnapshot(digestTamper, context())).toThrow(
      /authentication failed/i,
    );

    const macTamper = clone(snapshot);
    macTamper.mac = "00".repeat(32);
    expect(() => verifyContactSnapshot(macTamper, context())).toThrow(
      /authentication failed/i,
    );

    const duplicate = clone(snapshot);
    duplicate.entries[1].label = duplicate.entries[0].label;
    expect(() => verifyContactSnapshot(duplicate, context())).toThrow(
      /duplicate labels/i,
    );

    const future = clone(snapshot);
    future.createdAt = NOW + 6 * 60 * 1_000;
    expect(() => verifyContactSnapshot(future, context())).toThrow(
      /creation time/i,
    );

    const unknown = { ...snapshot, extra: true };
    expect(() => verifyContactSnapshot(unknown, context())).toThrow(/schema/i);
  });

  it("rejects unsupported versions and malformed 32-byte seeds", () => {
    const snapshot = createContactSnapshot({ ...context(), entries: ENTRIES });
    expect(() =>
      verifyContactSnapshot({ ...snapshot, version: 2 }, context()),
    ).toThrow(/version/i);
    expect(() =>
      createContactSnapshot({
        ...context(new Uint8Array(31)),
        entries: ENTRIES,
      }),
    ).toThrow(/32-byte/i);
  });
});
