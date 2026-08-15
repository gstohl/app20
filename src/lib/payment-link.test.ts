import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import type { PaymentRequestPayload } from "./otc";
import {
  MAX_PAYMENT_LINK_FRAGMENT_LENGTH,
  createPaymentLink,
  decodePaymentLinkFragment,
  encodePaymentLinkFragment,
} from "./payment-link";

const request: PaymentRequestPayload = {
  requestId: `0x${"12".repeat(32)}`,
  token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
  amount: "1250000000000000000",
  memo: "Consulting invoice 42",
  expiresAt: 2_000_000_000,
  requester: "0x4567",
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat(
    (4 - (value.length % 4)) % 4,
  )}`;
  return Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  );
}

function fragmentForTuple(tuple: unknown): string {
  const payload = new TextEncoder().encode(JSON.stringify(tuple));
  const domain = new TextEncoder().encode("quietline/payment-link/v1\0");
  const checksumInput = new Uint8Array(domain.length + payload.length);
  checksumInput.set(domain);
  checksumInput.set(payload, domain.length);
  return `#qlp1.${bytesToBase64Url(payload)}.${bytesToBase64Url(
    sha256(checksumInput),
  )}`;
}

function tupleFromFragment(fragment: string): unknown[] {
  const payload = fragment.slice(1).split(".")[1];
  return JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(payload)),
  ) as unknown[];
}

describe("payment links", () => {
  it("round-trips a canonical STRK request in a URL-safe fragment", () => {
    const fragment = encodePaymentLinkFragment(request);

    expect(fragment).toMatch(/^#qlp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(fragment).not.toContain("?");
    expect(decodePaymentLinkFragment(fragment)).toEqual(request);
  });

  it("round-trips omitted optionals and a valid legacy invoice id", () => {
    const withoutMemo = { ...request };
    delete withoutMemo.memo;
    const withInvoiceId = {
      ...withoutMemo,
      invoiceId: `0x${"34".repeat(32)}`,
    };

    expect(
      decodePaymentLinkFragment(encodePaymentLinkFragment(withoutMemo)),
    ).toEqual(withoutMemo);
    expect(
      decodePaymentLinkFragment(encodePaymentLinkFragment(withInvoiceId)),
    ).toEqual(withInvoiceId);
  });

  it("builds /pay with no query-string payload", () => {
    const link = createPaymentLink(
      request,
      "https://quietline.example/current?logged=value#old",
    );
    const url = new URL(link);

    expect(url.pathname).toBe("/pay");
    expect(url.search).toBe("");
    expect(decodePaymentLinkFragment(url.hash)).toEqual(request);
  });

  it("rejects a payload changed without its checksum", () => {
    const fragment = encodePaymentLinkFragment(request);
    const parts = fragment.split(".");
    const first = parts[1][0];
    parts[1] = `${first === "A" ? "B" : "A"}${parts[1].slice(1)}`;

    expect(() => decodePaymentLinkFragment(parts.join("."))).toThrow(
      /integrity.*tampered/i,
    );
  });

  it("rejects truncated and wrong-version fragments", () => {
    const fragment = encodePaymentLinkFragment(request);

    expect(() => decodePaymentLinkFragment(fragment.slice(0, -8))).toThrow(
      /malformed|truncated|integrity/i,
    );
    expect(() =>
      decodePaymentLinkFragment(fragment.replace("#qlp1.", "#qlp2.")),
    ).toThrow(/unsupported.*version/i);
  });

  it("rejects oversized fragments and oversized requests", () => {
    expect(() =>
      decodePaymentLinkFragment(
        `#${"a".repeat(MAX_PAYMENT_LINK_FRAGMENT_LENGTH)}`,
      ),
    ).toThrow(/too large/i);
    expect(() =>
      encodePaymentLinkFragment({
        ...request,
        memo: "漢".repeat(512),
      }),
    ).toThrow(/too large/i);
  });

  it("bounds payment fields before they reach the wallet flow", () => {
    expect(() =>
      encodePaymentLinkFragment({
        ...request,
        amount: (2n ** 256n).toString(),
      }),
    ).toThrow(/uint256/i);
    expect(() =>
      encodePaymentLinkFragment({ ...request, requester: "0x0" }),
    ).toThrow(/non-zero/i);
    expect(() =>
      encodePaymentLinkFragment({
        ...request,
        expiresAt: 8_640_000_000_001,
      }),
    ).toThrow(/date range/i);
  });

  it("rejects a checksummed payload whose token is not canonical STRK", () => {
    const tuple = tupleFromFragment(encodePaymentLinkFragment(request));
    tuple[3] = 6;

    expect(() => decodePaymentLinkFragment(fragmentForTuple(tuple))).toThrow(
      /canonical STRK/i,
    );
    expect(() =>
      encodePaymentLinkFragment({
        ...request,
        token: { ...request.token, decimals: 6 },
      }),
    ).toThrow(/canonical STRK/i);
  });

  it("rejects non-canonical encodings even with a recomputed checksum", () => {
    const tuple = tupleFromFragment(encodePaymentLinkFragment(request));
    tuple[7] = "00004567";

    expect(() => decodePaymentLinkFragment(fragmentForTuple(tuple))).toThrow(
      /not canonical/i,
    );
  });

  it("never serializes extra fields such as a mailbox seed", () => {
    const hostile = {
      ...request,
      mailboxSeed: "do-not-share-this-secret",
    } as PaymentRequestPayload;
    const fragment = encodePaymentLinkFragment(hostile);
    const serializedTuple = new TextDecoder().decode(
      base64UrlToBytes(fragment.slice(1).split(".")[1]),
    );

    expect(serializedTuple).not.toContain("do-not-share-this-secret");
    expect(decodePaymentLinkFragment(fragment)).toEqual(request);
  });
});
