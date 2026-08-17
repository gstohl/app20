import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import type { PaymentRequestPayload } from "./otc";
import {
  MAX_PAYMENT_LINK_EXPIRY_HOURS,
  MAX_PAYMENT_LINK_FRAGMENT_LENGTH,
  createPaymentLink,
  createPaymentLinkRequest,
  decodePaymentLinkFragment,
  encodePaymentLinkFragment,
  normalizePaymentLinkChainId,
  paymentLinkChainIdsEqual,
  paymentLinkNetworkLabel,
} from "./payment-link";

const request: PaymentRequestPayload = {
  requestId: `0x${"12".repeat(32)}`,
  token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
  amount: "1250000000000000000",
  memo: "Consulting invoice 42",
  expiresAt: 2_000_000_000,
  requester: "0x4567",
  chainId: "SN_SEPOLIA",
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
  const domain = new TextEncoder().encode("quietline/payment-link/v2\0");
  const checksumInput = new Uint8Array(domain.length + payload.length);
  checksumInput.set(domain);
  checksumInput.set(payload, domain.length);
  return `#qlp2.${bytesToBase64Url(payload)}.${bytesToBase64Url(
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
  it("creates a canonical request from human-entered fields", () => {
    const created = createPaymentLinkRequest(
      {
        amount: "0.125",
        memo: "  Invoice 42  ",
        expiryHours: "72",
        requester: "0x4567",
        chainId: "SN_SEPOLIA",
      },
      {
        atSeconds: 1_900_000_000,
        requestId: `0x${"ab".repeat(32)}`,
      },
    );

    expect(created).toEqual({
      requestId: `0x${"ab".repeat(32)}`,
      token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
      amount: "125000000000000000",
      memo: "Invoice 42",
      expiresAt: 1_900_259_200,
      requester: "0x4567",
      chainId: "SN_SEPOLIA",
    });
    expect(
      decodePaymentLinkFragment(encodePaymentLinkFragment(created)),
    ).toEqual(created);
  });

  it("generates a fresh request id and supports an explicit no-expiry link", () => {
    const first = createPaymentLinkRequest({
      amount: "1",
      expiryHours: "0",
      requester: "0x4567",
      chainId: "SN_SEPOLIA",
    });
    const second = createPaymentLinkRequest({
      amount: "1",
      expiryHours: "0",
      requester: "0x4567",
      chainId: "SN_SEPOLIA",
    });

    expect(first.requestId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.expiresAt).toBe(0);
    expect(first).not.toHaveProperty("memo");
  });

  it("rejects unsafe creator fields before producing a link", () => {
    const input = {
      amount: "0.1",
      expiryHours: "72",
      requester: "0x4567",
      chainId: "SN_SEPOLIA",
    };

    expect(() =>
      createPaymentLinkRequest({ ...input, amount: "0" }),
    ).toThrow(/greater than zero/i);
    expect(() =>
      createPaymentLinkRequest({ ...input, expiryHours: "1.5" }),
    ).toThrow(/whole number/i);
    expect(() =>
      createPaymentLinkRequest({
        ...input,
        expiryHours: String(MAX_PAYMENT_LINK_EXPIRY_HOURS + 1),
      }),
    ).toThrow(/between 0/i);
    expect(() =>
      createPaymentLinkRequest({ ...input, memo: "x".repeat(513) }),
    ).toThrow(/at most 512/i);
    expect(() =>
      createPaymentLinkRequest({ ...input, requester: "0x0" }),
    ).toThrow(/non-zero/i);
    expect(() =>
      createPaymentLinkRequest({ ...input, chainId: "SN_GOERLI" }),
    ).toThrow(/Mainnet or Sepolia/i);
  });

  it("round-trips a canonical STRK request in a URL-safe fragment", () => {
    const fragment = encodePaymentLinkFragment(request);

    expect(fragment).toMatch(/^#qlp2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(fragment).not.toContain("?");
    expect(decodePaymentLinkFragment(fragment)).toEqual(request);
  });

  it("binds links to one supported Starknet network", () => {
    expect(normalizePaymentLinkChainId("SN_MAIN")).toBe("SN_MAIN");
    expect(paymentLinkNetworkLabel("SN_SEPOLIA")).toBe("Sepolia");
    expect(paymentLinkChainIdsEqual("SN_MAIN", "SN_MAIN")).toBe(true);
    expect(paymentLinkChainIdsEqual("SN_MAIN", "SN_SEPOLIA")).toBe(false);
    expect(() =>
      encodePaymentLinkFragment({ ...request, chainId: undefined }),
    ).toThrow(/name their Starknet network/i);
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
      decodePaymentLinkFragment(fragment.replace("#qlp2.", "#qlp1.")),
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
