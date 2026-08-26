import { describe, expect, it } from "vitest";
import { deriveKeypair } from "./mail";
import { deriveMailAuthKeypair } from "./mail-auth";
import {
  CHANNEL_EPOCH_DOMAIN,
  CHANNEL_HAS_SETTLEMENT_AUTHORITY,
  CHANNEL_INVITATION_DOMAIN,
  CHANNEL_MAX_MESSAGE_BYTES,
  WALLET_MAIL_BINDING_DOMAIN,
  activateRelationshipChannelEpoch,
  consumeRelationshipChannelQuota,
  createWalletMailBindingCertificate,
  normalizeWalletMailBindingStatement,
  openRelationshipChannel,
  relationshipChannelEpochDigest,
  signRelationshipChannelEpoch,
  signRelationshipChannelInvitation,
  terminateRelationshipChannel,
  verifyRelationshipChannelInvitation,
  verifyWalletMailBindingCertificate,
  walletMailBindingStatementDigest,
  walletMailBindingTypedData,
  type RelationshipChannelEpochV1,
  type RelationshipChannelInvitationV1,
  type VerifiedWalletMailBinding,
  type WalletMailBindingStatementV1,
} from "./relationship-channel";

const now = 2_000_000_000_000;
const inviterSeed = Uint8Array.from({ length: 32 }, () => 11);
const inviteeSeed = Uint8Array.from({ length: 32 }, () => 12);
const currentRevocations = {
  revokedIds: new Set<string>(),
  snapshotDigest: `sha256:${"91".repeat(32)}`,
};

function bareHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bindingStatement(
  seed = inviterSeed,
  account = "0xa11ce",
  nonceByte = "11",
): WalletMailBindingStatementV1 {
  return {
    domain: WALLET_MAIL_BINDING_DOMAIN,
    version: 1,
    account,
    chainId: "SN_SEPOLIA",
    mailboxPublicKey: bareHex(deriveKeypair(seed).publicKey),
    authPublicKey: bareHex(deriveMailAuthKeypair(seed).publicKey),
    issuedAt: now,
    expiresAt: now + 86_400_000,
    nonce: `0x${nonceByte.repeat(32)}`,
    revocationId: `0x${nonceByte.repeat(32)}`,
  };
}

async function verifiedBinding(
  seed = inviterSeed,
  account = "0xa11ce",
  nonceByte = "11",
): Promise<VerifiedWalletMailBinding> {
  const statement = bindingStatement(seed, account, nonceByte);
  const certificate = createWalletMailBindingCertificate(statement, [
    "0x1",
    "0x2",
  ]);
  return verifyWalletMailBindingCertificate(certificate, {
    now: now + 1,
    revokedIds: new Set(),
    revocationSnapshotDigest: `sha256:${"91".repeat(32)}`,
    verifySignature: async () => true,
  });
}

function invitation(
  inviterBindingDigest: string,
  inviteeBindingDigest: string,
  overrides: Partial<RelationshipChannelInvitationV1> = {},
): RelationshipChannelInvitationV1 {
  return {
    domain: CHANNEL_INVITATION_DOMAIN,
    version: 1,
    invitationId: `0x${"31".repeat(32)}`,
    channelId: `0x${"32".repeat(32)}`,
    inviterBindingDigest,
    inviteeBindingDigest,
    inviterHandshakeKey: bareHex(deriveKeypair(inviteeSeed).publicKey),
    relayCapability: `0x${"34".repeat(32)}`,
    issuedAt: now,
    expiresAt: now + 86_400_000,
    quota: { maxMessages: 2, maxTotalBytes: 1_000 },
    ...overrides,
  };
}

function epoch(
  channelId: string,
  overrides: Partial<RelationshipChannelEpochV1> = {},
): RelationshipChannelEpochV1 {
  return {
    domain: CHANNEL_EPOCH_DOMAIN,
    version: 1,
    channelId,
    epoch: 1,
    previousEpochDigest: null,
    initiatorKey: "41".repeat(32),
    responderKey: "42".repeat(32),
    rootKeyCommitment: `sha256:${"43".repeat(32)}`,
    suite: "Double-Ratchet/X25519/HKDF-SHA256/AES-256-GCM",
    createdAt: now + 1,
    expiresAt: now + 86_000_000,
    ...overrides,
  };
}

describe("wallet-to-Mail binding v1", () => {
  it("builds deterministic SNIP-12 typed data without deriving encryption keys", () => {
    const statement = bindingStatement();
    const typed = walletMailBindingTypedData(statement);

    expect(typed.primaryType).toBe("App20MailBinding");
    expect(typed.domain).toMatchObject({
      name: "APP20 Mail",
      version: "1",
      chainId: "SN_SEPOLIA",
    });
    expect(walletMailBindingStatementDigest(statement)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(typed.message).not.toHaveProperty("privateKey");
    expect(typed.message).not.toHaveProperty("viewingKey");
  });

  it("requires external account-signature verification and rejects expiry or revocation", async () => {
    const statement = bindingStatement();
    const certificate = createWalletMailBindingCertificate(statement, [
      "0x1",
      "0x2",
    ]);
    await expect(
      verifyWalletMailBindingCertificate(certificate, {
        now: now + 1,
        revokedIds: new Set(),
        revocationSnapshotDigest: `sha256:${"91".repeat(32)}`,
        verifySignature: async () => false,
      }),
    ).rejects.toThrow(/signature/i);
    await expect(
      verifyWalletMailBindingCertificate(certificate, {
        now: statement.expiresAt + 1,
        revokedIds: new Set(),
        revocationSnapshotDigest: `sha256:${"91".repeat(32)}`,
        verifySignature: async () => true,
      }),
    ).rejects.toThrow(/currently valid/i);
    await expect(
      verifyWalletMailBindingCertificate(certificate, {
        now: now + 1,
        revokedIds: new Set([statement.revocationId]),
        revocationSnapshotDigest: `sha256:${"91".repeat(32)}`,
        verifySignature: async () => true,
      }),
    ).rejects.toThrow(/currently valid/i);
  });

  it("rejects unknown fields and invalid binding lifetimes", () => {
    expect(() =>
      normalizeWalletMailBindingStatement({
        ...bindingStatement(),
        extra: true,
      }),
    ).toThrow(/schema/i);
    expect(() =>
      normalizeWalletMailBindingStatement({
        ...bindingStatement(),
        expiresAt: now,
      }),
    ).toThrow(/lifetime/i);
  });
});

describe("relationship-channel protocol v1", () => {
  it("binds an opaque invitation to both verified wallet/Mail certificates", async () => {
    const inviter = await verifiedBinding();
    const invitee = await verifiedBinding(inviteeSeed, "0xb0b", "12");
    const bindings = { inviter, invitee };
    const signed = signRelationshipChannelInvitation(
      invitation(inviter.certificateDigest, invitee.certificateDigest),
      inviterSeed,
    );

    expect(verifyRelationshipChannelInvitation(signed, bindings)).toEqual(
      signed,
    );
    expect(
      verifyRelationshipChannelInvitation(
        {
          ...signed,
          invitation: {
            ...signed.invitation,
            relayCapability: `0x${"99".repeat(32)}`,
          },
        },
        bindings,
      ),
    ).toBeNull();
    expect(
      verifyRelationshipChannelInvitation(signed, {
        ...bindings,
        inviter: {
          ...inviter,
          certificateDigest: `sha256:${"98".repeat(32)}`,
        },
      }),
    ).toBeNull();
    expect(() =>
      openRelationshipChannel(
        signed,
        now + 1,
        { ...bindings, inviter: { ...inviter } as typeof inviter },
        currentRevocations,
      ),
    ).toThrow(/jointly verified/i);
    expect(() =>
      openRelationshipChannel(signed, now + 1, bindings, {
        ...currentRevocations,
        revokedIds: new Set([inviter.certificate.statement.revocationId]),
      }),
    ).toThrow(/expired or revoked/i);
    expect(CHANNEL_HAS_SETTLEMENT_AUTHORITY).toBe(false);
  });

  it("opens a channel, activates predecessor-bound epochs, and enforces replay-safe quotas", async () => {
    const inviter = await verifiedBinding();
    const invitee = await verifiedBinding(inviteeSeed, "0xb0b", "12");
    const bindings = { inviter, invitee };
    const signed = signRelationshipChannelInvitation(
      invitation(inviter.certificateDigest, invitee.certificateDigest),
      inviterSeed,
    );
    let state = openRelationshipChannel(
      signed,
      now + 1,
      bindings,
      currentRevocations,
    );
    const firstEpoch = epoch(state.channelId);
    const signedFirstEpoch = signRelationshipChannelEpoch(firstEpoch, {
      initiatorSeed: inviterSeed,
      responderSeed: inviteeSeed,
    });
    state = activateRelationshipChannelEpoch(
      state,
      signedFirstEpoch,
      bindings,
      currentRevocations,
    );

    expect(state).toMatchObject({
      status: "active",
      activeEpoch: 1,
      activeEpochDigest: relationshipChannelEpochDigest(firstEpoch),
      nextSequence: 0,
      messagesUsed: 0,
      bytesUsed: 0,
    });

    state = consumeRelationshipChannelQuota(state, {
      sequence: 0,
      ciphertextBytes: 400,
      sentAt: now + 2,
    });
    expect(state).toMatchObject({
      nextSequence: 1,
      messagesUsed: 1,
      bytesUsed: 400,
    });
    expect(() =>
      consumeRelationshipChannelQuota(state, {
        sequence: 0,
        ciphertextBytes: 100,
        sentAt: now + 3,
      }),
    ).toThrow(/sequence|replayed/i);
    expect(() =>
      consumeRelationshipChannelQuota(state, {
        sequence: 1,
        ciphertextBytes: CHANNEL_MAX_MESSAGE_BYTES + 1,
        sentAt: now + 3,
      }),
    ).toThrow(/limit/i);
    expect(() =>
      consumeRelationshipChannelQuota(state, {
        sequence: 1,
        ciphertextBytes: 700,
        sentAt: now + 3,
      }),
    ).toThrow(/quota/i);
  });

  it("rotates channel keys only through an ordered continuity chain", async () => {
    const inviter = await verifiedBinding();
    const invitee = await verifiedBinding(inviteeSeed, "0xb0b", "12");
    const bindings = { inviter, invitee };
    const signed = signRelationshipChannelInvitation(
      invitation(inviter.certificateDigest, invitee.certificateDigest),
      inviterSeed,
    );
    const opened = openRelationshipChannel(
      signed,
      now + 1,
      bindings,
      currentRevocations,
    );
    const first = epoch(opened.channelId);
    const signedFirst = signRelationshipChannelEpoch(first, {
      initiatorSeed: inviterSeed,
      responderSeed: inviteeSeed,
    });
    const active = activateRelationshipChannelEpoch(
      opened,
      signedFirst,
      bindings,
      currentRevocations,
    );
    const second = epoch(opened.channelId, {
      epoch: 2,
      previousEpochDigest: active.activeEpochDigest,
      initiatorKey: "51".repeat(32),
      responderKey: "52".repeat(32),
      rootKeyCommitment: `sha256:${"53".repeat(32)}`,
      createdAt: now + 2,
    });
    expect(() =>
      activateRelationshipChannelEpoch(
        active,
        first as unknown as ReturnType<typeof signRelationshipChannelEpoch>,
        bindings,
        currentRevocations,
      ),
    ).toThrow(/signatures/i);
    const signedSecond = signRelationshipChannelEpoch(second, {
      initiatorSeed: inviterSeed,
      responderSeed: inviteeSeed,
    });
    expect(
      activateRelationshipChannelEpoch(
        active,
        signedSecond,
        bindings,
        currentRevocations,
      ).activeEpoch,
    ).toBe(2);
    const wrongPredecessor = signRelationshipChannelEpoch(
      {
        ...second,
        previousEpochDigest: `sha256:${"00".repeat(32)}`,
      },
      { initiatorSeed: inviterSeed, responderSeed: inviteeSeed },
    );
    expect(() =>
      activateRelationshipChannelEpoch(
        active,
        wrongPredecessor,
        bindings,
        currentRevocations,
      ),
    ).toThrow(/continuity/i);
    expect(() =>
      activateRelationshipChannelEpoch(
        active,
        {
          ...signedSecond,
          responderSignature: `${signedSecond.responderSignature.slice(0, -2)}00`,
        },
        bindings,
        currentRevocations,
      ),
    ).toThrow(/signatures/i);
  });

  it("makes block, report, revoke, and expiry terminal", async () => {
    const inviter = await verifiedBinding();
    const invitee = await verifiedBinding(inviteeSeed, "0xb0b", "12");
    const bindings = { inviter, invitee };
    const signed = signRelationshipChannelInvitation(
      invitation(inviter.certificateDigest, invitee.certificateDigest),
      inviterSeed,
    );
    const active = activateRelationshipChannelEpoch(
      openRelationshipChannel(signed, now + 1, bindings, currentRevocations),
      signRelationshipChannelEpoch(epoch(signed.invitation.channelId), {
        initiatorSeed: inviterSeed,
        responderSeed: inviteeSeed,
      }),
      bindings,
      currentRevocations,
    );
    const reported = terminateRelationshipChannel(active, {
      kind: "report",
      evidenceDigest: `sha256:${"81".repeat(32)}`,
    });
    expect(reported).toMatchObject({
      status: "reported",
      reportDigest: `sha256:${"81".repeat(32)}`,
    });
    expect(() =>
      terminateRelationshipChannel(reported, { kind: "block" }),
    ).toThrow(/terminal/i);
    expect(terminateRelationshipChannel(active, { kind: "block" }).status).toBe(
      "blocked",
    );
    expect(
      terminateRelationshipChannel(active, { kind: "revoke" }).status,
    ).toBe("revoked");

    expect(
      consumeRelationshipChannelQuota(active, {
        sequence: 0,
        ciphertextBytes: 10,
        sentAt: active.expiresAt + 1,
      }).status,
    ).toBe("expired");
  });
});
