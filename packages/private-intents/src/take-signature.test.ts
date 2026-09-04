import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TAKE_DOMAIN,
  createTakerAuthorizationKey,
  fillsDigest,
  signTake,
  takeIdentityCommitment,
  takeMessageHash,
  takerPublicKeyFor,
  verifyTakeSignature,
} from "./take-signature.ts";

type VectorFelt = Readonly<{ hex: string; decimal: string }>;

type TakeSignatureVector = Readonly<{
  name: string;
  privateKey: VectorFelt;
  publicKey: VectorFelt;
  fills: readonly Readonly<{
    lockId: VectorFelt;
    amountA: VectorFelt;
  }>[];
  fillsDigest: VectorFelt;
  messageInputs: readonly Readonly<{
    name:
      | "domain"
      | "chainId"
      | "escrowAddress"
      | "identityCommitment"
      | "rfqId"
      | "tokenA"
      | "tokenB"
      | "fillsDigest";
    value: VectorFelt;
  }>[];
  message: VectorFelt;
  signature: Readonly<{ r: VectorFelt; s: VectorFelt }>;
}>;

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/take-signature-vectors.json", import.meta.url),
    "utf8",
  ),
) as Readonly<{ vectors: readonly TakeSignatureVector[] }>;

function vectorFills(vector: TakeSignatureVector) {
  return vector.fills.map((fill) => ({
    lockId: fill.lockId.hex,
    amountA: BigInt(fill.amountA.hex),
  }));
}

function vectorInput(
  vector: TakeSignatureVector,
  name: TakeSignatureVector["messageInputs"][number]["name"],
): string {
  const input = vector.messageInputs.find((candidate) => candidate.name === name);
  if (!input) throw new Error(`Signature vector is missing ${name}.`);
  return input.value.hex;
}

describe("RFQ v3 Take signatures", () => {
  it("encodes the Cairo short-string domain as one felt", () => {
    expect(TAKE_DOMAIN).toBe("0x61707032302d74616b652d7634");
  });

  for (const vector of fixture.vectors) {
    it(`matches the shared Cairo vector ${vector.name}`, () => {
      const fills = vectorFills(vector);
      expect(takerPublicKeyFor(vector.privateKey.hex)).toBe(vector.publicKey.hex);
      expect(fillsDigest(fills)).toBe(vector.fillsDigest.hex);
      const message = takeMessageHash({
        chainId: vectorInput(vector, "chainId"),
        escrowAddress: vectorInput(vector, "escrowAddress"),
        identityCommitment: vectorInput(vector, "identityCommitment"),
        rfqFelt: vectorInput(vector, "rfqId"),
        tokenA: vectorInput(vector, "tokenA"),
        tokenB: vectorInput(vector, "tokenB"),
        fills,
      });
      expect(message).toBe(vector.message.hex);
      expect(signTake(vector.privateKey.hex, message)).toEqual({
        r: vector.signature.r.hex,
        s: vector.signature.s.hex,
      });
      expect(
        verifyTakeSignature(
          vector.publicKey.hex,
          message,
          vector.signature.r.hex,
          vector.signature.s.hex,
        ),
      ).toBe(true);
    });
  }

  it("creates independent Stark keypairs and verifies their signatures", () => {
    const first = createTakerAuthorizationKey();
    const second = createTakerAuthorizationKey();
    expect(first.signingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.publicKey).toBe(takerPublicKeyFor(first.signingKey));
    expect(second.signingKey).not.toBe(first.signingKey);
    const message = takeMessageHash({
      chainId: "0x534e5f5345504f4c4941",
      escrowAddress: "0x5",
      identityCommitment: "0x99",
      rfqFelt: "0x77",
      tokenA: "0x1",
      tokenB: "0x2",
      fills: [{ lockId: "0x41", amountA: 100n }],
    });
    const signature = signTake(first.signingKey, message);
    expect(
      verifyTakeSignature(first.publicKey, message, signature.r, signature.s),
    ).toBe(true);
    expect(
      verifyTakeSignature(second.publicKey, message, signature.r, signature.s),
    ).toBe(false);
  });

  it("uses a different public identity commitment for every RFQ", () => {
    const identityKey = "0x4567";
    expect(takeIdentityCommitment(identityKey, "0x77")).not.toBe(
      takeIdentityCommitment(identityKey, "0x78"),
    );
    expect(takeIdentityCommitment(identityKey, "0x77")).toBe(
      takeIdentityCommitment(identityKey, "0x077"),
    );
  });

  it("binds the chain, authenticated identity, escrow, RFQ, token order, and fills", () => {
    const fills = [
      { lockId: "0x41", amountA: 100n },
      { lockId: "0x42", amountA: 150n },
    ];
    const base = {
      chainId: "0x534e5f5345504f4c4941",
      escrowAddress: "0x5",
      identityCommitment: "0x99",
      rfqFelt: "0x77",
      tokenA: "0x1",
      tokenB: "0x2",
      fills,
    };
    const message = takeMessageHash(base);
    expect(takeMessageHash({ ...base, chainId: "0x1" })).not.toBe(message);
    expect(
      takeMessageHash({ ...base, identityCommitment: "0x98" }),
    ).not.toBe(message);
    expect(takeMessageHash({ ...base, escrowAddress: "0x6" })).not.toBe(
      message,
    );
    expect(takeMessageHash({ ...base, rfqFelt: "0x78" })).not.toBe(message);
    expect(
      takeMessageHash({ ...base, tokenA: "0x2", tokenB: "0x1" }),
    ).not.toBe(message);
    expect(takeMessageHash({ ...base, fills: [...fills].reverse() })).not.toBe(
      message,
    );
    expect(
      takeMessageHash({
        ...base,
        fills: [{ ...fills[0]!, amountA: 99n }, fills[1]!],
      }),
    ).not.toBe(message);
  });

  it("rejects malformed or duplicate fill transcripts and bad signatures", () => {
    expect(() => fillsDigest([])).toThrow(/between one and four/i);
    expect(() =>
      fillsDigest([
        { lockId: "0x41", amountA: 1n },
        { lockId: "0x041", amountA: 2n },
      ]),
    ).toThrow(/differ/i);
    expect(() => fillsDigest([{ lockId: "0x41", amountA: 1n << 128n }])).toThrow(
      /u128/i,
    );
    const vector = fixture.vectors[0]!;
    expect(
      verifyTakeSignature(
        vector.publicKey.hex,
        vector.message.hex,
        vector.signature.r.hex,
        `0x${(BigInt(vector.signature.s.hex) + 1n).toString(16)}`,
      ),
    ).toBe(false);
  });
});
