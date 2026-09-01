import { describe, expect, it } from "vitest";
import {
  SEPOLIA_RFQ_MANIFEST,
  assertPrivateRfqNetwork,
  isSepoliaRfqCandidateEnabled,
  validateSepoliaRfqManifest,
  type SepoliaRfqManifest,
} from "./sepolia-rfq-manifest";

const DIGEST = `0x${"11".repeat(32)}`;
const LEGACY_ESCROW_CLASS_HASH =
  "0x0638d8554dc095f63f253c8dd32ac09a3e9ffedd5a308b0d0f188e5fca6c8c3b";
const LEGACY_CLAIM_TICKET_CLASS_HASH =
  "0x07619ea7dcb8615874fb9d29b217f649e9b7b596f01d47d673e4e37132b17196";

function apparentlyComplete(): SepoliaRfqManifest {
  return {
    ...SEPOLIA_RFQ_MANIFEST,
    escrowAddress: "0x1",
    escrowClassHash: "0x2",
    app20ClaimClassHash: "0x3",
    abiManifestDigest: DIGEST,
    directoryAuthorityKeys: [
      {
        keyId: "authority",
        publicKey: {
          kty: "EC",
          crv: "P-256",
          x: "A".repeat(43),
          y: "B".repeat(43),
        },
        validFrom: 1,
        validUntil: 200,
      },
    ],
    directoryMinimumEpoch: 1,
    directoryCheckpoint: { epoch: 1, digest: DIGEST },
    rpcQuorum: ["rpc-a", "rpc-b"],
    reviewEvidence: { reference: "review", reviewedAt: 50, validUntil: 200 },
    deploymentEvidence: { reference: "deploy", deployedAt: 60 },
  };
}

describe("localnet-final Sepolia RFQ manifest", () => {
  it("cannot be enabled by apparently complete configuration", () => {
    const manifest = apparentlyComplete();
    expect(
      validateSepoliaRfqManifest(manifest, 100, {
        escrowHelper: "0x1",
        usdcConfigured: true,
      }),
    ).toBe(false);
    expect(isSepoliaRfqCandidateEnabled(manifest, 100)).toBe(false);
  });

  it("rejects the known historical escrow and ClaimTicket identities", () => {
    const manifest = {
      ...apparentlyComplete(),
      escrowClassHash: LEGACY_ESCROW_CLASS_HASH,
      app20ClaimClassHash: LEGACY_CLAIM_TICKET_CLASS_HASH,
    };
    expect(
      validateSepoliaRfqManifest(manifest, 100, {
        escrowHelper: manifest.escrowAddress,
        usdcConfigured: true,
      }),
    ).toBe(false);
  });

  it.each(["mainnet", "sepolia", "localnet"] as const)(
    "hard-denies production private RFQ on %s",
    (network) => {
      expect(() =>
        assertPrivateRfqNetwork(network, apparentlyComplete()),
      ).toThrow(network === "mainnet" ? /hard-disabled/ : /unavailable/);
      expect(isSepoliaRfqCandidateEnabled(apparentlyComplete(), 100)).toBe(
        false,
      );
    },
  );
});
