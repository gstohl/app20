import { describe, expect, it } from "vitest";
import { escrowForNetwork, helperForNetwork } from "./mailbox-model";

// Live helper variables are deliberately ignored by src/utils/constants.ts.
// These assertions cover the runtime boundary used by Inbox and Compose.
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
