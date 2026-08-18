import { ec } from "starknet";
import { describe, expect, it, vi } from "vitest";
import { PrivySigner } from "../src/signer.js";

const PRIVATE_KEY = "0x123456789";
const fullPublicKey = ec.starkCurve.getPublicKey(PRIVATE_KEY);
const PUBLIC_KEY = `0x${Buffer.from(fullPublicKey)
  .subarray(1, 33)
  .toString("hex")}`;

function signatureFor(hash: string): string {
  return `0x${ec.starkCurve.sign(hash, PRIVATE_KEY).toCompactHex()}`;
}

describe("PrivySigner refreshable authorization", () => {
  it("resolves a user JWT for every signing attempt", async () => {
    const rawSign = vi.fn(
      async (_walletId: string, input: { params: { hash: string } }) =>
        signatureFor(input.params.hash),
    );
    const userJwtProvider = vi.fn(async ({ forceRefresh }) =>
      forceRefresh ? "fresh" : "current",
    );
    const signer = new PrivySigner({
      privy: { wallets: () => ({ rawSign }) } as never,
      walletId: "wallet-1",
      publicKey: PUBLIC_KEY,
      authorization: { userJwtProvider },
    });

    await signer.signRaw("0x123");

    expect(userJwtProvider).toHaveBeenCalledWith({ forceRefresh: false });
    expect(rawSign).toHaveBeenCalledWith(
      "wallet-1",
      expect.objectContaining({
        authorization_context: { user_jwts: ["current"] },
      }),
    );
  });

  it("refreshes once when Privy rejects an expired JWT", async () => {
    const rawSign = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("invalid auth token"), { status: 401 }),
      )
      .mockImplementationOnce(
        async (_walletId: string, input: { params: { hash: string } }) =>
          signatureFor(input.params.hash),
      );
    const userJwtProvider = vi.fn(async ({ forceRefresh }) =>
      forceRefresh ? "fresh" : "expired",
    );
    const signer = new PrivySigner({
      privy: { wallets: () => ({ rawSign }) } as never,
      walletId: "wallet-1",
      publicKey: PUBLIC_KEY,
      authorization: { userJwtProvider },
    });

    await expect(signer.signRaw("0x123")).resolves.toHaveLength(2);
    expect(userJwtProvider).toHaveBeenNthCalledWith(1, { forceRefresh: false });
    expect(userJwtProvider).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(rawSign).toHaveBeenNthCalledWith(
      2,
      "wallet-1",
      expect.objectContaining({
        authorization_context: { user_jwts: ["fresh"] },
      }),
    );
  });
});
