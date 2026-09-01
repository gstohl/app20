import type { RfqEnvelopeOpener, PrivateRfqV1 } from "#protocol";
import {
    canonicalPrivateRfq,
    canonicalRfqTransportAad,
    PRIVATE_RFQ_DOMAIN,
} from "#protocol";
import {
    RFQ_HPKE_INFO,
    createRfqHpkeSuite,
    decodeBase64url,
    unpadRfqPlaintext,
} from "#hpke";

const encoder = new TextEncoder();

function parsePrivateRfq(canonical: string): PrivateRfqV1 {
    let value: unknown;
    try {
        value = JSON.parse(canonical);
    } catch {
        throw new Error("RFQ HPKE plaintext is invalid.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("RFQ HPKE plaintext is invalid.");
    }
    const item = value as Record<string, unknown>;
    let rfq: PrivateRfqV1;
    try {
        rfq = {
            version: 1,
            domain: PRIVATE_RFQ_DOMAIN,
            rfqId: String(item.rfqId),
            intentDigest: String(item.intentDigest),
            chainId: String(item.chainId) as PrivateRfqV1["chainId"],
            registryRevision: String(item.registryRevision),
            directoryEpoch: Number(item.directoryEpoch),
            settlementHelper: String(item.settlementHelper),
            sellToken: String(item.sellToken),
            sellAmountBaseUnits: BigInt(String(item.sellAmountBaseUnits)),
            buyToken: String(item.buyToken),
            minBuyAmountBaseUnits: BigInt(String(item.minBuyAmountBaseUnits)),
            createdAt: Number(item.createdAt),
            responseDeadline: Number(item.responseDeadline),
            expiresAt: Number(item.expiresAt),
        };
    } catch {
        throw new Error("RFQ HPKE plaintext is invalid.");
    }
    // AEAD success is not enough: extra keys, number encodings, or key-order
    // drift must not become a different RFQ than the sealed canonical bytes.
    try {
        if (canonicalPrivateRfq(rfq) !== canonical) {
            throw new Error("RFQ HPKE plaintext is invalid.");
        }
    } catch {
        throw new Error("RFQ HPKE plaintext is invalid.");
    }
    return rfq;
}

/** Maker/Node-only opener. resolvePrivateKey should return a non-exportable HSM/KMS handle in production. */
export function createRfqEnvelopeOpener(
    resolvePrivateKey: (keyId: string) => CryptoKey | Promise<CryptoKey>,
): RfqEnvelopeOpener {
    return {
        async open(envelope, transportKey) {
            try {
                const recipientKey = await resolvePrivateKey(
                    transportKey.keyId,
                );
                const plaintext = await createRfqHpkeSuite().open(
                    {
                        recipientKey,
                        enc: decodeBase64url(envelope.encapsulatedKey),
                        info: encoder.encode(RFQ_HPKE_INFO),
                    },
                    decodeBase64url(envelope.ciphertext),
                    encoder.encode(canonicalRfqTransportAad(envelope.aad)),
                );
                return parsePrivateRfq(
                    unpadRfqPlaintext(new Uint8Array(plaintext)),
                );
            } catch {
                throw new Error(
                    "RFQ envelope HPKE authentication or decryption failed.",
                );
            }
        },
    };
}
