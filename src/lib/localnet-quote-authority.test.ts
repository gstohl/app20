import { describe, expect, it, vi } from "vitest";
import {
  LOCALNET_SECONDARY_SOLVER_KEY_ID,
  LOCALNET_SOLVER_KEY_ID,
} from "@app20/private-intents";
import {
  LOCALNET_SOLVER_PUBLIC_JWK,
  LOCALNET_SOLVER_PUBLIC_JWKS,
  verifyLocalnetSolverQuote,
} from "./localnet-quote-authority";

const CANONICAL_FIXTURE = '{"buyAmount":"1"}';
const SIGNATURE_FIXTURE =
  "0x1a475e032e08c7f71ff6c2c7692d473025fd7bd35b1b4478b1b3d87caa4456ad2da3931a4b36bd3ffa327b8331916710a56c372dd565f2db9327df8c82c10eb4";
const SECONDARY_SIGNATURE_FIXTURE =
  "0xa5290939dcf47ef6141d44f3fc62fd699e5a85a2c544c664d739bc7617dd769a74a2faf7bf3afcba59d92ceb383949bfb5351bcb085eff6a8290de4b97cab7fe";

describe("localnet quote authority", () => {
  it("verifies the pinned solver fixture and rejects a forged key id", async () => {
    await expect(
      verifyLocalnetSolverQuote(
        CANONICAL_FIXTURE,
        SIGNATURE_FIXTURE,
        LOCALNET_SOLVER_KEY_ID,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyLocalnetSolverQuote(
        CANONICAL_FIXTURE,
        SECONDARY_SIGNATURE_FIXTURE,
        LOCALNET_SECONDARY_SOLVER_KEY_ID,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyLocalnetSolverQuote(
        CANONICAL_FIXTURE,
        SIGNATURE_FIXTURE,
        "forged-solver",
      ),
    ).resolves.toBe(false);
    expect(LOCALNET_SOLVER_PUBLIC_JWK.d).toBeUndefined();
    expect(
      LOCALNET_SOLVER_PUBLIC_JWKS[LOCALNET_SECONDARY_SOLVER_KEY_ID]?.d,
    ).toBeUndefined();
  });

  it("imports each solver public key once across concurrent verifiers", async () => {
    vi.resetModules();
    const { verifyLocalnetSolverQuote: verifyFresh } = await import(
      "./localnet-quote-authority"
    );
    const importKey = vi.spyOn(globalThis.crypto.subtle, "importKey");
    await Promise.all([
      verifyFresh(CANONICAL_FIXTURE, SIGNATURE_FIXTURE, LOCALNET_SOLVER_KEY_ID),
      verifyFresh(CANONICAL_FIXTURE, SIGNATURE_FIXTURE, LOCALNET_SOLVER_KEY_ID),
    ]);
    const afterWarm = importKey.mock.calls.length;
    expect(afterWarm).toBeGreaterThan(0);
    await verifyFresh(
      CANONICAL_FIXTURE,
      SIGNATURE_FIXTURE,
      LOCALNET_SOLVER_KEY_ID,
    );
    expect(importKey.mock.calls.length).toBe(afterWarm);
    importKey.mockRestore();
  });
});
