import { sha256 } from "@noble/hashes/sha2.js";

export const BLOB_STORE_MAX_RESPONSE_BYTES = 1_048_576;
export const BLOB_STORE_FETCH_TIMEOUT_MS = 10_000;

export interface BlobStore {
  readonly available: boolean;
  readonly reason?: string;
  put(bytes: Uint8Array): Promise<{ cid: string }>;
  get(cid: string): Promise<Uint8Array>;
}

export type IpfsBlobStoreConfig = Readonly<{
  rpcOrigin: string;
  gatewayOrigins: readonly string[];
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}>;

export type BlobStoreConfigResolution =
  | Readonly<{
      available: true;
      rpcOrigin: string;
      gatewayOrigins: readonly string[];
    }>
  | Readonly<{ available: false; reason: string }>;

export type ResolveBlobStoreConfigInput = Readonly<{
  localnetConfig?: unknown;
  env?: Readonly<Record<string, unknown>>;
  origin?: string;
}>;

const CID_VERSION = 0x01;
const RAW_CODEC = 0x55;
const SHA2_256_CODE = 0x12;
const SHA2_256_BYTES = 0x20;
const CID_PREFIX = Uint8Array.of(
  CID_VERSION,
  RAW_CODEC,
  SHA2_256_CODE,
  SHA2_256_BYTES,
);
const CID_PATTERN = /^b[a-z2-7]{58}$/;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const UPLOAD_RESPONSE_MAX_BYTES = 16 * 1_024;

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    bytes.set(value, offset);
    offset += value.length;
  }
  return bytes;
}

function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let encoded = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) encoded += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return encoded;
}

export function computeCidV1Raw(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("CID input must be bytes.");
  }
  return `b${base32Lower(concatBytes(CID_PREFIX, sha256(bytes)))}`;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function parseBaseUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error: unknown) {
    throw new Error(`${label} must be a valid HTTP(S) URL.`, { cause: error });
  }
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must use HTTPS (or loopback HTTP) without credentials, query, or fragment.`,
    );
  }
  return url;
}

/** Builds a request string under a validated base; `query` values are URL-encoded. */
function endpoint(
  base: URL,
  suffix: string,
  query: Readonly<Record<string, string>> = {},
): string {
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const search = new URLSearchParams(query).toString();
  return `${base.origin}${prefix}${suffix.replace(/^\//, "")}${search ? `?${search}` : ""}`;
}

function requireTimeout(value: number | undefined): number {
  const timeout = value ?? BLOB_STORE_FETCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 60_000) {
    throw new Error("Blob store timeout must be between 1 and 60000 ms.");
  }
  return timeout;
}

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) {
      throw new Error("The blob response has an invalid Content-Length.");
    }
    if (Number(declared) > maximumBytes) {
      throw new Error("The blob response exceeds the 1 MiB limit.");
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("The blob response exceeds the 1 MiB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(...chunks);
}

function parseUploadResponse(bytes: Uint8Array): {
  Hash: string;
  Size: number;
} {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("The IPFS upload response is not valid UTF-8 JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The IPFS upload response is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    !keys.includes("Hash") ||
    !keys.includes("Size") ||
    keys.some((key) => key !== "Hash" && key !== "Name" && key !== "Size") ||
    (record.Name !== undefined && typeof record.Name !== "string") ||
    typeof record.Hash !== "string" ||
    !CID_PATTERN.test(record.Hash)
  ) {
    throw new Error("The IPFS upload response is invalid.");
  }
  const rawSize = record.Size;
  const size =
    typeof rawSize === "number"
      ? rawSize
      : typeof rawSize === "string" && /^(?:0|[1-9][0-9]*)$/.test(rawSize)
        ? Number(rawSize)
        : Number.NaN;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("The IPFS upload response has an invalid size.");
  }
  return { Hash: record.Hash, Size: size };
}

export function createUnavailableBlobStore(reason: string): BlobStore {
  const message = reason.trim() || "Encrypted blob storage is unavailable.";
  const unavailable = () =>
    Promise.reject(
      new Error(`Encrypted blob storage is unavailable: ${message}`),
    );
  return Object.freeze({
    available: false,
    reason: message,
    put: unavailable,
    get: unavailable,
  });
}

export function createIpfsBlobStore(config: IpfsBlobStoreConfig): BlobStore {
  const rpc = parseBaseUrl(config.rpcOrigin, "IPFS RPC origin");
  const gateways = [
    ...new Map(
      config.gatewayOrigins.map((origin) => {
        const parsed = parseBaseUrl(origin, "IPFS gateway origin");
        return [parsed.toString(), parsed] as const;
      }),
    ).values(),
  ];
  if (gateways.length === 0) {
    throw new Error("At least one IPFS gateway origin is required.");
  }
  const timeoutMs = requireTimeout(config.timeoutMs);
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable for encrypted blob storage.");
  }

  return Object.freeze({
    available: true,
    async put(bytes: Uint8Array): Promise<{ cid: string }> {
      if (!(bytes instanceof Uint8Array)) {
        throw new Error("The blob upload must be bytes.");
      }
      if (bytes.length > BLOB_STORE_MAX_RESPONSE_BYTES) {
        throw new Error("The blob upload exceeds the 1 MiB limit.");
      }
      const expectedCid = computeCidV1Raw(bytes);
      const uploadBytes = new Uint8Array(bytes.length);
      uploadBytes.set(bytes);
      const body = new FormData();
      body.append(
        "file",
        new Blob([uploadBytes.buffer], { type: "application/octet-stream" }),
        "backup.bin",
      );
      const uploadUrl = endpoint(rpc, "api/v0/add", {
        "cid-version": "1",
        "raw-leaves": "true",
        hash: "sha2-256",
        pin: "true",
      });
      const response = await fetchWithTimeout(
        fetchImpl,
        uploadUrl,
        { method: "POST", body },
        timeoutMs,
      );
      if (!response.ok) {
        throw new Error(`The IPFS upload failed with HTTP ${response.status}.`);
      }
      const uploaded = parseUploadResponse(
        await readBoundedResponse(response, UPLOAD_RESPONSE_MAX_BYTES),
      );
      if (uploaded.Hash !== expectedCid || uploaded.Size !== bytes.length) {
        throw new Error(
          "The IPFS upload response does not match the encrypted blob.",
        );
      }
      return { cid: expectedCid };
    },
    async get(cid: string): Promise<Uint8Array> {
      if (!CID_PATTERN.test(cid)) {
        throw new Error(
          "The backup CID is not a canonical CIDv1 raw identifier.",
        );
      }
      const failures: string[] = [];
      for (const gateway of gateways) {
        try {
          const fetchUrl = endpoint(gateway, `ipfs/${cid}`, { format: "raw" });
          const response = await fetchWithTimeout(
            fetchImpl,
            fetchUrl,
            {
              method: "GET",
              headers: { Accept: "application/vnd.ipld.raw" },
            },
            timeoutMs,
          );
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const bytes = await readBoundedResponse(
            response,
            BLOB_STORE_MAX_RESPONSE_BYTES,
          );
          if (computeCidV1Raw(bytes) !== cid) {
            throw new Error("content hash mismatch");
          }
          return bytes;
        } catch (error: unknown) {
          failures.push(
            error instanceof Error ? error.message : "fetch failed",
          );
        }
      }
      throw new Error(
        `No configured IPFS gateway returned the verified encrypted blob: ${failures.join("; ")}`,
      );
    },
  });
}

function unavailable(reason: string): BlobStoreConfigResolution {
  return Object.freeze({ available: false, reason });
}

function configuredEnvValue(
  env: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function resolveBlobStoreConfig(
  input: ResolveBlobStoreConfigInput,
): BlobStoreConfigResolution {
  if (input.localnetConfig !== undefined) {
    if (
      !input.localnetConfig ||
      typeof input.localnetConfig !== "object" ||
      Array.isArray(input.localnetConfig)
    ) {
      return unavailable("The localnet configuration response is invalid.");
    }
    const path = (input.localnetConfig as Record<string, unknown>)
      .ipfsProxyPath;
    if (path === undefined) {
      return unavailable(
        "This localnet does not advertise an encrypted blob store.",
      );
    }
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("?") ||
      path.includes("#")
    ) {
      return unavailable("The localnet IPFS proxy path is invalid.");
    }
    const origin = input.origin ?? globalThis.location?.origin;
    if (!origin) return unavailable("The browser origin is unavailable.");
    try {
      const base = parseBaseUrl(
        new URL(path, origin).toString(),
        "Localnet IPFS proxy",
      );
      return Object.freeze({
        available: true,
        rpcOrigin: base.toString(),
        gatewayOrigins: Object.freeze([base.toString()]),
      });
    } catch (error: unknown) {
      return unavailable(
        error instanceof Error
          ? error.message
          : "The localnet IPFS proxy is invalid.",
      );
    }
  }

  const env = input.env ?? {};
  const rpcOrigin = configuredEnvValue(env, "VITE_IPFS_RPC_ORIGIN");
  const gatewayOrigins = configuredEnvValue(env, "VITE_IPFS_GATEWAY_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!rpcOrigin && gatewayOrigins.length === 0) {
    return unavailable("No encrypted blob-store origins are configured.");
  }
  if (!rpcOrigin || gatewayOrigins.length === 0) {
    return unavailable("Both IPFS RPC and gateway origins must be configured.");
  }
  try {
    const rpc = parseBaseUrl(rpcOrigin, "IPFS RPC origin");
    const gateways = gatewayOrigins.map((origin) =>
      parseBaseUrl(origin, "IPFS gateway origin"),
    );
    if (
      rpc.pathname !== "/" ||
      gateways.some((gateway) => gateway.pathname !== "/")
    ) {
      return unavailable(
        "Configured production IPFS values must be HTTPS origins without paths.",
      );
    }
    return Object.freeze({
      available: true,
      rpcOrigin: rpc.origin,
      gatewayOrigins: Object.freeze(gateways.map((gateway) => gateway.origin)),
    });
  } catch (error: unknown) {
    return unavailable(
      error instanceof Error ? error.message : "The IPFS origins are invalid.",
    );
  }
}
