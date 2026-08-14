import { describe, expect, it } from "vitest";
import {
  MAX_CT_FELTS,
  decryptMail,
  deriveKeypair,
  deriveKeypairFromSource,
  encryptMail,
  packBytesToFelts,
  publicKeyFromFelts,
  publicKeyToFelts,
  scanAndDecrypt,
  unpackFeltsToBytes,
} from "./mail";

function seed(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function fuzzBytes(length: number, state: { value: number }): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    let value = state.value | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    state.value = value >>> 0;
    bytes[index] = state.value & 0xff;
  }
  return bytes;
}

describe("felt packing", () => {
  it("roundtrips boundary cases including zero bytes", () => {
    for (const length of [0, 1, 2, 30, 31, 32, 61, 62, 63, 255]) {
      const bytes = new Uint8Array(length);
      if (length > 2) bytes[length - 2] = 0xff;
      expect(unpackFeltsToBytes(packBytesToFelts(bytes))).toEqual(bytes);
    }
  });

  it("fuzz-roundtrips arbitrary byte arrays", () => {
    const state = { value: 0x71c0ffee };
    for (let run = 0; run < 300; run += 1) {
      const length = state.value % 4097;
      const bytes = fuzzBytes(length, state);
      expect(unpackFeltsToBytes(packBytesToFelts(bytes))).toEqual(bytes);
    }
  });

  it("rejects malformed lengths and overflowing chunks", () => {
    expect(() => unpackFeltsToBytes([])).toThrow(/byte length/i);
    expect(() => unpackFeltsToBytes(["0x20", "0x1"])).toThrow(/count/i);
    expect(() => unpackFeltsToBytes(["0x1", "0x100"])).toThrow(/fit/i);
    expect(() =>
      unpackFeltsToBytes(new Array(MAX_CT_FELTS + 1).fill("0x0"))
    ).toThrow(/140 felts/i);
    expect(() =>
      unpackFeltsToBytes([`0x${(31 * MAX_CT_FELTS).toString(16)}`])
    ).toThrow(/payload limit/i);
  });

  it("roundtrips public-key felt limbs with leading zeroes", () => {
    const key = new Uint8Array(32);
    key[1] = 7;
    key[31] = 9;
    expect(publicKeyFromFelts(publicKeyToFelts(key))).toEqual(key);
  });
});

describe("mail key derivation", () => {
  it("is deterministic and supports an injected seed source", async () => {
    const direct = deriveKeypair(seed(3));
    const injected = await deriveKeypairFromSource(async () => seed(3));
    expect(injected).toEqual(direct);
    expect(deriveKeypair(seed(4)).publicKey).not.toEqual(direct.publicKey);
  });
});

describe("encrypted mail", () => {
  it("encrypts and decrypts a recipient roundtrip", async () => {
    const recipient = deriveKeypair(seed(11));
    const record = await encryptMail(recipient.publicKey, "hello from quietline");

    const messages = await scanAndDecrypt(recipient.privateKey, [record]);
    expect(messages).toHaveLength(1);
    expect(messages[0].index).toBe(0);
    expect(messages[0].plaintext).toBe("hello from quietline");
  });

  it("rejects a wrong key", async () => {
    const recipient = deriveKeypair(seed(21));
    const stranger = deriveKeypair(seed(22));
    const record = await encryptMail(recipient.publicKey, "recipient only");

    await expect(decryptMail(stranger.privateKey, record)).rejects.toThrow();
    await expect(scanAndDecrypt(stranger.privateKey, [record])).resolves.toEqual(
      [],
    );
  });

  it("keeps authenticated binary payloads that are not valid UTF-8", async () => {
    const recipient = deriveKeypair(seed(23));
    const binary = new Uint8Array([0xff, 0xfe, 0x80, 0x00, 0xc0]);
    const record = await encryptMail(recipient.publicKey, binary);

    const messages = await scanAndDecrypt(recipient.privateKey, [record]);
    expect(messages).toHaveLength(1);
    expect(messages[0].plaintextBytes).toEqual(binary);
    expect(messages[0].plaintext).toBe("");
  });

  it("filters a non-matching view tag before trial decryption", async () => {
    const recipient = deriveKeypair(seed(31));
    const record = await encryptMail(recipient.publicKey, "tagged");
    const filtered = {
      ...record,
      viewTag: (record.viewTag + 1) % 256,
      ciphertextFelts: ["0x1000"],
    };

    await expect(
      scanAndDecrypt(recipient.privateKey, [filtered, record]),
    ).resolves.toMatchObject([{ index: 1, plaintext: "tagged" }]);
  });

  it("binds the ephemeral public key and nonce as AES-GCM AAD", async () => {
    const recipient = deriveKeypair(seed(41));
    const record = await encryptMail(recipient.publicKey, "aad-bound");
    const changedNonce = [...record.nonce] as [string, string];
    changedNonce[1] = `0x${(BigInt(changedNonce[1]) ^ 1n).toString(16)}`;

    await expect(
      decryptMail(recipient.privateKey, { ...record, nonce: changedNonce }),
    ).rejects.toThrow();
  });

  it.each([
    ["empty", ""],
    ["2KB", "q".repeat(2 * 1024)],
  ])("roundtrips an %s body", async (_label, body) => {
    const recipient = deriveKeypair(seed(body.length ? 52 : 51));
    const record = await encryptMail(recipient.publicKey, body);
    const [message] = await scanAndDecrypt(recipient.privateKey, [record]);

    expect(message.plaintext).toBe(body);
    expect(message.plaintextBytes).toHaveLength(body.length);
  });
});
