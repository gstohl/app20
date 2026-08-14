import { deriveKeypair, type MailKeypair } from "@/lib/mail";

const MAIL_SEED_BYTES = 32;
const BACKUP_GROUP_HEX_LENGTH = 8;
const BACKUP_PATTERN = /^(?:[0-9a-f]{8} ){7}[0-9a-f]{8}$/i;

export type RestoredMailSeed = {
  seed: Uint8Array;
  keypair: MailKeypair;
};

function assertMailSeed(seed: Uint8Array): void {
  if (seed.length !== MAIL_SEED_BYTES) {
    throw new Error(`Mail seed must be exactly ${MAIL_SEED_BYTES} bytes.`);
  }
}

function seedToHex(seed: Uint8Array): string {
  assertMailSeed(seed);
  return Array.from(seed, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Returns the canonical value shown in Quietline's one-time backup. */
export function exportMailSeed(seed: Uint8Array): string {
  const hex = seedToHex(seed);
  const groups: string[] = [];
  for (let offset = 0; offset < hex.length; offset += BACKUP_GROUP_HEX_LENGTH) {
    groups.push(hex.slice(offset, offset + BACKUP_GROUP_HEX_LENGTH));
  }
  return groups.join(" ");
}

/** Strictly parses the canonical eight-group hexadecimal backup and derives its keypair. */
export function restoreMailSeed(value: string): RestoredMailSeed {
  if (!BACKUP_PATTERN.test(value)) {
    throw new Error(
      "Backup must be exactly 64 hexadecimal characters in eight groups of eight, separated by single spaces.",
    );
  }

  const hex = value.replaceAll(" ", "");
  const seed = Uint8Array.from(
    hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
  assertMailSeed(seed);
  return { seed, keypair: deriveKeypair(seed) };
}
