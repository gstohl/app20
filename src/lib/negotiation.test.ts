import { describe, expect, it } from "vitest";
import { deriveKeypair } from "./mail";
import { deriveMailAuthKeypair } from "./mail-auth";
import {
  WALLET_MAIL_BINDING_DOMAIN,
  createWalletMailBindingCertificate,
  verifyWalletMailBindingCertificate,
  type VerifiedWalletMailBinding,
  type WalletMailBindingStatementV1,
} from "./relationship-channel";
import {
  MAX_NEGOTIATION_ATTACHMENT_BYTES,
  NEGOTIATION_DOCUMENT_DOMAIN,
  NEGOTIATION_HAS_SETTLEMENT_AUTHORITY,
  canonicalNegotiationDocument,
  createMemoryNegotiationEquivocationStore,
  evaluateNegotiationTranscript,
  negotiationDocumentDigest,
  negotiationTermsDigest,
  normalizeNegotiationDocument,
  signNegotiationDocument,
  verifySignedNegotiationDocument,
  type NegotiationDocumentV1,
  type NegotiationTermsV1,
  type SignedNegotiationDocumentV1,
} from "./negotiation";

const now = 2_000_000_000_000;
const conversationId = `0x${"11".repeat(32)}`;
const intentDigest = `sha256:${"22".repeat(32)}`;
const takerBinding = `sha256:${"33".repeat(32)}`;
const makerBinding = `sha256:${"44".repeat(32)}`;
const takerSeed = Uint8Array.from({ length: 32 }, () => 7);
const makerSeed = Uint8Array.from({ length: 32 }, () => 9);

function terms(
  overrides: Partial<NegotiationTermsV1> = {},
): NegotiationTermsV1 {
  return {
    chainId: "SN_SEPOLIA",
    registryRevision: "app20-assets/sepolia/2026-08-25",
    intentDigest,
    makerId: "maker-a",
    sellToken: "0x111",
    buyToken: "0x222",
    sellAmount: "1000000000000000000",
    minBuyAmount: "1250000",
    quoteExpiresAt: now + 60_000,
    settlementDeadline: now + 600_000,
    ...overrides,
  };
}

function offer(
  overrides: Partial<Extract<NegotiationDocumentV1, { kind: "offer" }>> = {},
): Extract<NegotiationDocumentV1, { kind: "offer" }> {
  const value = terms();
  const document: Extract<NegotiationDocumentV1, { kind: "offer" }> = {
    domain: NEGOTIATION_DOCUMENT_DOMAIN,
    version: 1,
    kind: "offer",
    documentId: `0x${"51".repeat(32)}`,
    conversationId,
    revision: 1,
    parentDigest: null,
    authorRole: "taker",
    authorBindingDigest: takerBinding,
    createdAt: now,
    expiresAt: now + 60_000,
    note: "Request one private quote.",
    terms: value,
    termsDigest: negotiationTermsDigest(value),
    attachments: [
      {
        version: 1,
        attachmentId: `0x${"61".repeat(32)}`,
        fileName: "mandate.pdf",
        mediaType: "application/pdf",
        byteLength: 512,
        ciphertextDigest: `sha256:${"71".repeat(32)}`,
        encryption: "AES-256-GCM",
      },
    ],
    ...overrides,
  };
  if (overrides.terms && overrides.termsDigest === undefined) {
    document.termsDigest = negotiationTermsDigest(document.terms);
  }
  return document;
}

async function verifiedBinding(
  seed: Uint8Array,
  account: string,
  nonceByte: string,
): Promise<VerifiedWalletMailBinding> {
  const mailboxPublicKey = Array.from(deriveKeypair(seed).publicKey, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const authPublicKey = Array.from(
    deriveMailAuthKeypair(seed).publicKey,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const statement: WalletMailBindingStatementV1 = {
    domain: WALLET_MAIL_BINDING_DOMAIN,
    version: 1,
    account,
    chainId: "SN_SEPOLIA",
    mailboxPublicKey,
    authPublicKey,
    issuedAt: now - 1,
    expiresAt: now + 86_400_000,
    nonce: `0x${nonceByte.repeat(32)}`,
    revocationId: `0x${nonceByte.repeat(32)}`,
  };
  return verifyWalletMailBindingCertificate(
    createWalletMailBindingCertificate(statement, ["0x1", "0x2"]),
    {
      now,
      revokedIds: new Set(),
      revocationSnapshotDigest: `sha256:${"90".repeat(32)}`,
      verifySignature: async () => true,
    },
  );
}

async function roleBindings(): Promise<{
  taker: VerifiedWalletMailBinding;
  maker: VerifiedWalletMailBinding;
}> {
  return {
    taker: await verifiedBinding(takerSeed, "0xa11ce", "81"),
    maker: await verifiedBinding(makerSeed, "0xb0b", "82"),
  };
}

function counter(
  parent: SignedNegotiationDocumentV1,
  authorBindingDigest = makerBinding,
): Extract<NegotiationDocumentV1, { kind: "counter" }> {
  const value = terms({ minBuyAmount: "1275000" });
  return {
    domain: NEGOTIATION_DOCUMENT_DOMAIN,
    version: 1,
    kind: "counter",
    documentId: `0x${"52".repeat(32)}`,
    conversationId,
    revision: 2,
    parentDigest: parent.documentDigest,
    authorRole: "maker",
    authorBindingDigest,
    createdAt: now + 1_000,
    expiresAt: now + 50_000,
    note: "Counter with a higher minimum output.",
    terms: value,
    termsDigest: negotiationTermsDigest(value),
    attachments: [],
  };
}

describe("negotiation document v1", () => {
  it("canonicalizes exact units and changes its digest for semantic mutations", () => {
    const first = offer();
    const reordered = {
      attachments: first.attachments,
      termsDigest: first.termsDigest,
      terms: first.terms,
      note: first.note,
      expiresAt: first.expiresAt,
      createdAt: first.createdAt,
      authorBindingDigest: first.authorBindingDigest,
      authorRole: first.authorRole,
      parentDigest: first.parentDigest,
      revision: first.revision,
      conversationId: first.conversationId,
      documentId: first.documentId,
      kind: first.kind,
      version: first.version,
      domain: first.domain,
    } as NegotiationDocumentV1;

    expect(canonicalNegotiationDocument(reordered)).toBe(
      canonicalNegotiationDocument(first),
    );
    expect(negotiationDocumentDigest(reordered)).toBe(
      negotiationDocumentDigest(first),
    );
    expect(
      negotiationDocumentDigest(
        offer({ terms: terms({ minBuyAmount: "1275000" }) }),
      ),
    ).not.toBe(negotiationDocumentDigest(first));
  });

  it("signs the full document and rejects body, terms, and signature tampering", () => {
    const signed = signNegotiationDocument(offer(), takerSeed);
    expect(verifySignedNegotiationDocument(signed)).toEqual(signed);
    expect(
      verifySignedNegotiationDocument({
        ...signed,
        document: { ...signed.document, note: "changed" },
      }),
    ).toBeNull();
    expect(
      verifySignedNegotiationDocument({
        ...signed,
        signature: `${signed.signature.slice(0, -2)}00`,
      }),
    ).toBeNull();
    expect(
      verifySignedNegotiationDocument({ ...signed, extra: "unsupported" }),
    ).toBeNull();
  });

  it("evaluates a predecessor-bound offer, counter, and acceptance", async () => {
    const bindings = await roleBindings();
    const signedOffer = signNegotiationDocument(
      offer({ authorBindingDigest: bindings.taker.certificateDigest }),
      takerSeed,
    );
    const signedCounter = signNegotiationDocument(
      counter(signedOffer, bindings.maker.certificateDigest),
      makerSeed,
    );
    if (signedCounter.document.kind !== "counter") {
      throw new Error("Test setup did not produce a counter.");
    }
    const acceptance = signNegotiationDocument(
      {
        domain: NEGOTIATION_DOCUMENT_DOMAIN,
        version: 1,
        kind: "accept",
        documentId: `0x${"53".repeat(32)}`,
        conversationId,
        revision: 3,
        parentDigest: signedCounter.documentDigest,
        authorRole: "taker",
        authorBindingDigest: bindings.taker.certificateDigest,
        createdAt: now + 2_000,
        expiresAt: now + 40_000,
        note: "Accept counter.",
        acceptedTermsDigest: signedCounter.document.termsDigest,
      },
      takerSeed,
    );

    expect(
      evaluateNegotiationTranscript(
        [signedOffer, signedCounter, acceptance],
        now + 3_000,
        bindings,
      ),
    ).toMatchObject({
      state: "accepted",
      conversationId,
      intentDigest,
      latestDocumentDigest: acceptance.documentDigest,
      activeTermsDigest: signedCounter.document.termsDigest,
      revisions: 3,
    });
    expect(NEGOTIATION_HAS_SETTLEMENT_AUTHORITY).toBe(false);
  });

  it("fails closed on wrong parents, role impersonation, stale terms, and post-terminal edits", async () => {
    const bindings = await roleBindings();
    const signedOffer = signNegotiationDocument(
      offer({ authorBindingDigest: bindings.taker.certificateDigest }),
      takerSeed,
    );
    const sameParty = signNegotiationDocument(
      {
        ...counter(signedOffer, bindings.taker.certificateDigest),
        authorRole: "taker",
      },
      takerSeed,
    );
    expect(() =>
      evaluateNegotiationTranscript(
        [signedOffer, sameParty],
        now + 2_000,
        bindings,
      ),
    ).toThrow(/other party/i);

    const impersonatedMaker = signNegotiationDocument(
      counter(signedOffer, bindings.maker.certificateDigest),
      takerSeed,
    );
    expect(() =>
      evaluateNegotiationTranscript(
        [signedOffer, impersonatedMaker],
        now + 2_000,
        bindings,
      ),
    ).toThrow(/wallet-bound role/i);

    const signedCounter = signNegotiationDocument(
      counter(signedOffer, bindings.maker.certificateDigest),
      makerSeed,
    );
    if (signedCounter.document.kind !== "counter") {
      throw new Error("Test setup did not produce a counter.");
    }
    const badAcceptance = signNegotiationDocument(
      {
        domain: NEGOTIATION_DOCUMENT_DOMAIN,
        version: 1,
        kind: "accept",
        documentId: `0x${"54".repeat(32)}`,
        conversationId,
        revision: 3,
        parentDigest: `sha256:${"99".repeat(32)}`,
        authorRole: "taker",
        authorBindingDigest: bindings.taker.certificateDigest,
        createdAt: now + 2_000,
        expiresAt: now + 40_000,
        note: "Invalid acceptance.",
        acceptedTermsDigest: `sha256:${"98".repeat(32)}`,
      },
      takerSeed,
    );
    expect(() =>
      evaluateNegotiationTranscript(
        [signedOffer, signedCounter, badAcceptance],
        now + 3_000,
        bindings,
      ),
    ).toThrow(/revision chain/i);

    const cancellation = signNegotiationDocument(
      {
        domain: NEGOTIATION_DOCUMENT_DOMAIN,
        version: 1,
        kind: "cancel",
        documentId: `0x${"55".repeat(32)}`,
        conversationId,
        revision: 3,
        parentDigest: signedCounter.documentDigest,
        authorRole: "taker",
        authorBindingDigest: bindings.taker.certificateDigest,
        createdAt: now + 2_000,
        expiresAt: now + 40_000,
        note: "Cancel.",
        cancelledTermsDigest: signedCounter.document.termsDigest,
        reason: "user_cancelled",
      },
      takerSeed,
    );
    const afterCancel = signNegotiationDocument(
      {
        ...counter(signedOffer, bindings.maker.certificateDigest),
        revision: 4,
        documentId: `0x${"56".repeat(32)}`,
        parentDigest: cancellation.documentDigest,
        createdAt: now + 3_000,
      },
      makerSeed,
    );
    expect(() =>
      evaluateNegotiationTranscript(
        [signedOffer, signedCounter, cancellation, afterCancel],
        now + 4_000,
        bindings,
      ),
    ).toThrow(/terminal/i);
  });

  it("detects same-role same-revision forks across transcript evaluations", async () => {
    const bindings = await roleBindings();
    const store = createMemoryNegotiationEquivocationStore();
    const first = signNegotiationDocument(
      offer({ authorBindingDigest: bindings.taker.certificateDigest }),
      takerSeed,
    );
    evaluateNegotiationTranscript([first], now + 1, bindings, store);
    const fork = signNegotiationDocument(
      offer({
        authorBindingDigest: bindings.taker.certificateDigest,
        documentId: `0x${"59".repeat(32)}`,
        note: "Conflicting root offer.",
      }),
      takerSeed,
    );
    expect(() =>
      evaluateNegotiationTranscript([fork], now + 1, bindings, store),
    ).toThrow(/equivocated/i);
  });

  it("marks an unaccepted transcript expired without treating idle as refusal", async () => {
    const bindings = await roleBindings();
    const signed = signNegotiationDocument(
      offer({ authorBindingDigest: bindings.taker.certificateDigest }),
      takerSeed,
    );
    expect(
      evaluateNegotiationTranscript([signed], now + 60_001, bindings).state,
    ).toBe("expired");
  });

  it("enforces attachment types, sizes, filenames, exact terms digests, and schemas", () => {
    expect(() =>
      normalizeNegotiationDocument(
        offer({
          attachments: [
            {
              ...offer().attachments[0],
              mediaType: "text/html",
            },
          ],
        }),
      ),
    ).toThrow(/allowlisted/i);
    expect(() =>
      normalizeNegotiationDocument(
        offer({
          attachments: [
            {
              ...offer().attachments[0],
              byteLength: MAX_NEGOTIATION_ATTACHMENT_BYTES + 1,
            },
          ],
        }),
      ),
    ).toThrow(/limit/i);
    expect(() =>
      normalizeNegotiationDocument(
        offer({
          attachments: [
            {
              ...offer().attachments[0],
              fileName: "../mandate.pdf",
            },
          ],
        }),
      ),
    ).toThrow(/path/i);
    expect(() =>
      normalizeNegotiationDocument({
        ...offer(),
        termsDigest: `sha256:${"00".repeat(32)}`,
      }),
    ).toThrow(/does not match/i);
    expect(() =>
      normalizeNegotiationDocument({ ...offer(), surprise: true }),
    ).toThrow(/schema/i);
  });
});
