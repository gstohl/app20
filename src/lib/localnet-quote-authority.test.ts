import { describe, expect, it } from "vitest";
import { LOCALNET_SOLVER_KEY_ID } from "@app20/private-intents";
import {
  LOCALNET_SOLVER_PUBLIC_JWK,
  verifyLocalnetSolverQuote,
} from "./localnet-quote-authority";

const CANONICAL_FIXTURE = '{"buyAmount":"1"}';
const SIGNATURE_FIXTURE =
  "0x1a475e032e08c7f71ff6c2c7692d473025fd7bd35b1b4478b1b3d87caa4456ad2da3931a4b36bd3ffa327b8331916710a56c372dd565f2db9327df8c82c10eb4";

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
        SIGNATURE_FIXTURE,
        "forged-solver",
      ),
    ).resolves.toBe(false);
    expect(LOCALNET_SOLVER_PUBLIC_JWK.d).toBeUndefined();
  });
});
