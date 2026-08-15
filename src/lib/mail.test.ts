import { describe, expect, it } from "vitest";
import { encodeEnvelope } from "./envelope";
import {
  MAX_CT_FELTS,
  MAX_MULTI_RECIPIENTS,
  MULTI_RECIPIENT_SLOT_BYTES,
  MULTI_RECIPIENT_VERSION,
  MULTI_RECIPIENT_VIEW_TAG,
  decryptMail,
  deriveKeypair,
  deriveKeypairFromSource,
  encryptMail,
  encryptMailForRecipients,
  packBytesToFelts,
  projectEncryptedMailSize,
  publicKeyFromFelts,
  publicKeyToFelts,
  scanAndDecrypt,
  unpackFeltsToBytes,
  type EncryptedMailRecord,
} from "./mail";

const MULTI_HEADER_BYTES = 5;
const MULTI_SLOT_TAG_BYTES = 16;

function seed(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function mutateCiphertext(
  record: EncryptedMailRecord,
  mutate: (bytes: Uint8Array) => void,
): EncryptedMailRecord {
  const bytes = unpackFeltsToBytes(record.ciphertextFelts);
  mutate(bytes);
  return { ...record, ciphertextFelts: packBytesToFelts(bytes) };
}

function xorFelt(felt: string): string {
  return `0x${(BigInt(felt) ^ 1n).toString(16)}`;
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
      unpackFeltsToBytes(new Array(MAX_CT_FELTS + 1).fill("0x0")),
    ).toThrow(/140 felts/i);
    expect(() =>
      unpackFeltsToBytes([`0x${(31 * MAX_CT_FELTS).toString(16)}`]),
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
    const record = await encryptMail(
      recipient.publicKey,
      "hello from quietline",
    );

    const messages = await scanAndDecrypt(recipient.privateKey, [record]);
    expect(messages).toHaveLength(1);
    expect(messages[0].index).toBe(0);
    expect(messages[0].plaintext).toBe("hello from quietline");
    expect(messages[0].envelope).toMatchObject({
      version: 0,
      type: "text",
      payload: { body: "hello from quietline" },
    });
  });

  it("decodes a locked legacy single-recipient record", async () => {
    const privateKey = bytesFromHex(
      "79814066f2e5266469807eaebd6c4a1ba2f2c452259afc2fd3398424c810008f",
    );
    const record: EncryptedMailRecord = {
      ephemeralPub: [
        "0xa095fa7b546caeb769c043147c9eb692",
        "0x9f6391f37ce0ea1516111e00fb461530",
      ],
      viewTag: 21,
      nonce: ["0x10203040506", "0x708090a0b0c"],
      ciphertextFelts: [
        "0x34",
        "0x2aecabeecb6ffe30bfa3f96fd065eaafc55220ad873c65d770bd1ce6bb1784",
        "0xfd9ee0e1905b2ae4f9c4f76ebbe1d1017ae5539164",
      ],
    };

    expect(
      new TextDecoder().decode(await decryptMail(privateKey, record)),
    ).toBe("legacy fixture: hello from quietline");
    await expect(scanAndDecrypt(privateKey, [record])).resolves.toMatchObject([
      { plaintext: "legacy fixture: hello from quietline" },
    ]);
  });

  it("rejects a wrong key", async () => {
    const recipient = deriveKeypair(seed(21));
    const stranger = deriveKeypair(seed(22));
    const record = await encryptMail(recipient.publicKey, "recipient only");

    await expect(decryptMail(stranger.privateKey, record)).rejects.toThrow();
    await expect(
      scanAndDecrypt(stranger.privateKey, [record]),
    ).resolves.toEqual([]);
  });

  it("keeps authenticated binary payloads that are not valid UTF-8", async () => {
    const recipient = deriveKeypair(seed(23));
    const binary = new Uint8Array([0xff, 0xfe, 0x80, 0x00, 0xc0]);
    const record = await encryptMail(recipient.publicKey, binary);

    const messages = await scanAndDecrypt(recipient.privateKey, [record]);
    expect(messages).toHaveLength(1);
    expect(messages[0].plaintextBytes).toEqual(binary);
    expect(messages[0].plaintext).toBe("");
    expect(messages[0].envelope.type).toBe("unsupported");
  });

  it("decrypts binary v1 envelopes without treating the whole blob as text", async () => {
    const recipient = deriveKeypair(seed(24));
    const envelope = encodeEnvelope("offer", {
      dealId: `0x${"ab".repeat(32)}`,
    });
    const record = await encryptMail(recipient.publicKey, envelope);

    const [message] = await scanAndDecrypt(recipient.privateKey, [record]);
    expect(message.plaintextBytes).toEqual(envelope);
    expect(message.plaintext).toBe("");
    expect(message.envelope).toMatchObject({
      version: 1,
      type: "offer",
      payload: { dealId: `0x${"ab".repeat(32)}` },
    });
  });

  it("surfaces unknown v1 types instead of throwing during a scan", async () => {
    const recipient = deriveKeypair(seed(25));
    const bytes = new Uint8Array([0x01, 0xfe, 0xff]);
    const record = await encryptMail(recipient.publicKey, bytes);

    await expect(
      scanAndDecrypt(recipient.privateKey, [record]),
    ).resolves.toMatchObject([
      {
        plaintext: "",
        envelope: {
          type: "unsupported",
          payload: { body: "unsupported message", reason: "unknown_type" },
        },
      },
    ]);
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

describe("multi-recipient encrypted mail", () => {
  it.each([1, 2, 8])(
    "roundtrips identical plaintext to %i recipient(s)",
    async (recipientCount) => {
      const recipients = Array.from({ length: recipientCount }, (_, index) =>
        deriveKeypair(seed(60 + index)),
      );
      const plaintext = `one record for ${recipientCount} recipient(s)`;
      const record = await encryptMailForRecipients(
        recipients.map((recipient) => recipient.publicKey),
        plaintext,
      );
      const wireBytes = unpackFeltsToBytes(record.ciphertextFelts);

      if (recipientCount === 1) {
        // The one-recipient API remains the exact legacy ciphertext shape.
        expect(wireBytes).toHaveLength(
          new TextEncoder().encode(plaintext).length + 16,
        );
      } else {
        expect(record.viewTag).toBe(MULTI_RECIPIENT_VIEW_TAG);
        expect(wireBytes.slice(0, MULTI_HEADER_BYTES)).toEqual(
          new Uint8Array([
            0x51,
            0x4c,
            0x4d,
            MULTI_RECIPIENT_VERSION,
            recipientCount,
          ]),
        );
      }

      const messages = await Promise.all(
        recipients.map((recipient) =>
          scanAndDecrypt(recipient.privateKey, [record]),
        ),
      );
      expect(messages.map(([message]) => message.plaintext)).toEqual(
        new Array(recipientCount).fill(plaintext),
      );
    },
  );

  it("preserves an authenticated binary body for every recipient", async () => {
    const recipients = [deriveKeypair(seed(70)), deriveKeypair(seed(71))];
    const binary = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0x00, 0xfe]);
    const record = await encryptMailForRecipients(
      recipients.map((recipient) => recipient.publicKey),
      binary,
    );

    for (const recipient of recipients) {
      await expect(decryptMail(recipient.privateKey, record)).resolves.toEqual(
        binary,
      );
      const [message] = await scanAndDecrypt(recipient.privateKey, [record]);
      expect(message.plaintextBytes).toEqual(binary);
      expect(message.envelope.type).toBe("unsupported");
    }
  });

  it("yields nothing to a non-recipient", async () => {
    const recipients = [deriveKeypair(seed(72)), deriveKeypair(seed(73))];
    const stranger = deriveKeypair(seed(74));
    const record = await encryptMailForRecipients(
      recipients.map((recipient) => recipient.publicKey),
      "not for the stranger",
    );

    await expect(decryptMail(stranger.privateKey, record)).rejects.toThrow();
    await expect(
      scanAndDecrypt(stranger.privateKey, [record]),
    ).resolves.toEqual([]);
  });

  it("isolates a corrupted recipient slot", async () => {
    const recipients = Array.from({ length: 3 }, (_, index) =>
      deriveKeypair(seed(75 + index)),
    );
    const record = await encryptMailForRecipients(
      recipients.map((recipient) => recipient.publicKey),
      "slot isolation",
    );
    const corrupted = mutateCiphertext(record, (bytes) => {
      bytes[MULTI_HEADER_BYTES + MULTI_SLOT_TAG_BYTES] ^= 1;
    });

    const results = await Promise.all(
      recipients.map((recipient) =>
        scanAndDecrypt(recipient.privateKey, [corrupted]),
      ),
    );
    expect(results.map((messages) => messages.length).sort()).toEqual([
      0, 1, 1,
    ]);
    expect(results.flat().map((message) => message.plaintext)).toEqual([
      "slot isolation",
      "slot isolation",
    ]);
  });

  it("rejects a spliced slot without harming other slots", async () => {
    const recipients = Array.from({ length: 3 }, (_, index) =>
      deriveKeypair(seed(78 + index)),
    );
    const publicKeys = recipients.map((recipient) => recipient.publicKey);
    const source = await encryptMailForRecipients(publicKeys, "source");
    const destination = await encryptMailForRecipients(
      publicKeys,
      "destination",
    );
    const sourceBytes = unpackFeltsToBytes(source.ciphertextFelts);
    const spliced = mutateCiphertext(destination, (bytes) => {
      const wrappedDekOffset = MULTI_HEADER_BYTES + MULTI_SLOT_TAG_BYTES;
      bytes.set(
        sourceBytes.subarray(
          wrappedDekOffset,
          MULTI_HEADER_BYTES + MULTI_RECIPIENT_SLOT_BYTES,
        ),
        wrappedDekOffset,
      );
    });

    const results = await Promise.all(
      recipients.map((recipient) =>
        scanAndDecrypt(recipient.privateKey, [spliced]),
      ),
    );
    expect(results.map((messages) => messages.length).sort()).toEqual([
      0, 1, 1,
    ]);
    expect(results.flat().map((message) => message.plaintext)).toEqual([
      "destination",
      "destination",
    ]);
  });

  it("rejects authenticated-context and body tampering", async () => {
    const recipients = Array.from({ length: 3 }, (_, index) =>
      deriveKeypair(seed(81 + index)),
    );
    const record = await encryptMailForRecipients(
      recipients.map((recipient) => recipient.publicKey),
      "all context is bound",
    );
    const bodyNonceOffset = MULTI_HEADER_BYTES + 3 * MULTI_RECIPIENT_SLOT_BYTES;
    const variants: EncryptedMailRecord[] = [
      {
        ...record,
        ephemeralPub: [xorFelt(record.ephemeralPub[0]), record.ephemeralPub[1]],
      },
      { ...record, nonce: [record.nonce[0], xorFelt(record.nonce[1])] },
      { ...record, viewTag: MULTI_RECIPIENT_VIEW_TAG - 1 },
      mutateCiphertext(record, (bytes) => {
        bytes[3] ^= 1;
      }),
      mutateCiphertext(record, (bytes) => {
        bytes[4] = 2;
      }),
      mutateCiphertext(record, (bytes) => {
        bytes[bodyNonceOffset] ^= 1;
      }),
      mutateCiphertext(record, (bytes) => {
        bytes[bytes.length - 1] ^= 1;
      }),
    ];

    for (const variant of variants) {
      for (const recipient of recipients) {
        await expect(
          decryptMail(recipient.privateKey, variant),
        ).rejects.toThrow();
      }
    }
  });

  it("uses fresh record and body nonces for each message", async () => {
    const recipients = [deriveKeypair(seed(84)), deriveKeypair(seed(85))];
    const publicKeys = recipients.map((recipient) => recipient.publicKey);
    const first = await encryptMailForRecipients(publicKeys, "same plaintext");
    const second = await encryptMailForRecipients(publicKeys, "same plaintext");
    const bodyNonceOffset =
      MULTI_HEADER_BYTES + recipients.length * MULTI_RECIPIENT_SLOT_BYTES;
    const firstBytes = unpackFeltsToBytes(first.ciphertextFelts);
    const secondBytes = unpackFeltsToBytes(second.ciphertextFelts);

    expect(first.ephemeralPub).not.toEqual(second.ephemeralPub);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(firstBytes.slice(bodyNonceOffset, bodyNonceOffset + 12)).not.toEqual(
      secondBytes.slice(bodyNonceOffset, bodyNonceOffset + 12),
    );
    expect(first.ciphertextFelts).not.toEqual(second.ciphertextFelts);
  });

  it("projects the exact single- and multi-recipient ciphertext budget", () => {
    expect(projectEncryptedMailSize(4_293, 1)).toMatchObject({
      ciphertextFelts: 140,
      maxPlaintextBytes: 4_293,
      fits: true,
    });
    expect(projectEncryptedMailSize(4_294, 1)).toMatchObject({
      ciphertextFelts: 141,
      fits: false,
    });
    expect(projectEncryptedMailSize(52, 66)).toMatchObject({
      ciphertextFelts: 140,
      maxPlaintextBytes: 52,
      fits: true,
    });
    expect(projectEncryptedMailSize(53, 66)).toMatchObject({
      ciphertextFelts: 141,
      fits: false,
    });
  });

  it("enforces the 66-recipient limit derived from 140 packed felts", async () => {
    expect(MAX_MULTI_RECIPIENTS).toBe(66);
    const recipients = Array.from(
      { length: MAX_MULTI_RECIPIENTS + 1 },
      (_, index) => deriveKeypair(seed(100 + index)).publicKey,
    );

    await expect(
      encryptMailForRecipients(recipients, new Uint8Array()),
    ).rejects.toThrow(/at most 66 recipients.*140-felt/i);
    await expect(
      encryptMailForRecipients(
        recipients.slice(0, MAX_MULTI_RECIPIENTS),
        new Uint8Array(53),
      ),
    ).rejects.toThrow(/exceeds the 140-felt/i);

    const boundaryRecord = await encryptMailForRecipients(
      recipients.slice(0, MAX_MULTI_RECIPIENTS),
      new Uint8Array(52),
    );
    expect(boundaryRecord.ciphertextFelts).toHaveLength(MAX_CT_FELTS);
  });
});
