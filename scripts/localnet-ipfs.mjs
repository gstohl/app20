import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OBJECTS = 64;
const DEFAULT_BLOB_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_UPLOADS = 2;
const DEFAULT_UPLOAD_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_UPLOADS_PER_WINDOW = 32;
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 1000;

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes) {
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

export function computeLocalnetRawCidV1(bytes) {
  if (!(bytes instanceof Uint8Array))
    throw new Error("Localnet IPFS content must be bytes.");
  const digest = createHash("sha256").update(bytes).digest();
  // CIDv1 + raw codec + sha2-256 multihash(code + length + digest).
  return `b${base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]))}`;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function sameToken(supplied, expected) {
  if (typeof supplied !== "string") return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertAuthorized(request, { controlToken, expectedOrigin }) {
  if (!sameToken(request.headers["x-app20-localnet-control"], controlToken)) {
    const error = new Error("Localnet IPFS control authentication failed.");
    error.status = 403;
    throw error;
  }
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== expectedOrigin) {
    const error = new Error("Localnet IPFS origin was refused.");
    error.status = 403;
    throw error;
  }
  if (request.method === "POST" && origin !== expectedOrigin) {
    const error = new Error("Localnet IPFS writes require the app origin.");
    error.status = 403;
    throw error;
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (
    fetchSite !== undefined &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    const error = new Error("Cross-site localnet IPFS access was refused.");
    error.status = 403;
    throw error;
  }
}

async function requestBytes(request, maxBytes, timeoutMs) {
  let size = 0;
  const chunks = [];
  const timeout = setTimeout(() => {
    const error = new Error("Localnet IPFS request timed out.");
    error.status = 408;
    request.destroy(error);
  }, timeoutMs);
  timeout.unref();
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Localnet IPFS request is too large.");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
  }
}

function multipartPayload(request, bytes) {
  const contentType = request.headers["content-type"] ?? "";
  const match = /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))$/i.exec(
    contentType,
  );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200) {
    const error = new Error("Localnet IPFS add requires multipart/form-data.");
    error.status = 400;
    throw error;
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const headerEnd = bytes.indexOf(Buffer.from("\r\n\r\n"));
  const footer = Buffer.from(`\r\n--${boundary}--`);
  const footerStart = bytes.lastIndexOf(footer);
  if (
    !bytes.subarray(0, delimiter.length).equals(delimiter) ||
    headerEnd < delimiter.length ||
    footerStart < headerEnd + 4 ||
    footerStart + footer.length + 2 !== bytes.length ||
    !bytes.subarray(headerEnd + 4, footerStart).length
  ) {
    const error = new Error("Localnet IPFS multipart body is malformed.");
    error.status = 400;
    throw error;
  }
  return bytes.subarray(headerEnd + 4, footerStart);
}

function json(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function createLocalnetIpfsServer({
  host = "127.0.0.1",
  port = 5054,
  controlToken,
  expectedOrigin,
  maxBytes = DEFAULT_MAX_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxObjects = DEFAULT_MAX_OBJECTS,
  blobTtlMs = DEFAULT_BLOB_TTL_MS,
  maxConcurrentUploads = DEFAULT_MAX_CONCURRENT_UPLOADS,
  uploadWindowMs = DEFAULT_UPLOAD_WINDOW_MS,
  maxUploadsPerWindow = DEFAULT_MAX_UPLOADS_PER_WINDOW,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  if (host !== "127.0.0.1")
    throw new Error("The localnet IPFS emulator must bind to 127.0.0.1.");
  if (typeof controlToken !== "string" || Buffer.byteLength(controlToken) < 32)
    throw new Error("The localnet IPFS emulator requires a per-run control token.");
  let parsedOrigin;
  try {
    parsedOrigin = new URL(expectedOrigin);
  } catch {
    throw new Error("The localnet IPFS emulator requires the loopback app origin.");
  }
  if (
    parsedOrigin.origin !== expectedOrigin ||
    parsedOrigin.protocol !== "http:" ||
    parsedOrigin.hostname !== "127.0.0.1" ||
    !parsedOrigin.port
  )
    throw new Error("The localnet IPFS emulator requires the loopback app origin.");
  if (typeof now !== "function") throw new Error("Localnet IPFS clock is invalid.");
  positiveInteger(maxBytes, "Localnet IPFS object limit");
  positiveInteger(maxTotalBytes, "Localnet IPFS aggregate limit");
  positiveInteger(maxObjects, "Localnet IPFS object-count limit");
  positiveInteger(blobTtlMs, "Localnet IPFS blob TTL");
  positiveInteger(maxConcurrentUploads, "Localnet IPFS upload concurrency");
  positiveInteger(uploadWindowMs, "Localnet IPFS upload window");
  positiveInteger(maxUploadsPerWindow, "Localnet IPFS upload rate");
  positiveInteger(requestTimeoutMs, "Localnet IPFS request timeout");
  if (maxBytes > maxTotalBytes)
    throw new Error("The localnet IPFS object limit cannot exceed its aggregate limit.");

  const blobs = new Map();
  const metadata = new Map();
  let totalBytes = 0;
  let activeUploads = 0;
  let uploadStarts = [];

  const remove = (cid) => {
    const value = blobs.get(cid);
    if (!value) return;
    totalBytes -= value.length;
    blobs.delete(cid);
    metadata.delete(cid);
  };

  const pruneExpired = (timestamp) => {
    for (const [cid, entry] of metadata) {
      if (timestamp - entry.createdAt >= blobTtlMs) remove(cid);
    }
  };

  const leastRecentlyUsed = () =>
    [...metadata.entries()].sort(
      ([leftCid, left], [rightCid, right]) =>
        left.lastAccess - right.lastAccess || leftCid.localeCompare(rightCid),
    )[0]?.[0];

  const store = (cid, payload, timestamp) => {
    pruneExpired(timestamp);
    const existing = blobs.get(cid);
    if (existing) {
      metadata.set(cid, { createdAt: metadata.get(cid).createdAt, lastAccess: timestamp });
      return;
    }
    while (
      blobs.size >= maxObjects ||
      totalBytes + payload.length > maxTotalBytes
    ) {
      const evicted = leastRecentlyUsed();
      if (!evicted) {
        const error = new Error("Localnet IPFS aggregate capacity is unavailable.");
        error.status = 429;
        throw error;
      }
      remove(evicted);
    }
    blobs.set(cid, Buffer.from(payload));
    metadata.set(cid, { createdAt: timestamp, lastAccess: timestamp });
    totalBytes += payload.length;
  };

  const server = createServer(async (request, response) => {
    try {
      assertAuthorized(request, { controlToken, expectedOrigin });
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (request.method === "POST" && url.pathname === "/api/v0/add") {
        if (
          url.searchParams.get("cid-version") !== "1" ||
          url.searchParams.get("raw-leaves") !== "true" ||
          url.searchParams.get("hash") !== "sha2-256" ||
          ![null, "true"].includes(url.searchParams.get("pin"))
        ) {
          json(response, 400, { error: "Only raw CIDv1 sha2-256 adds exist." });
          return;
        }
        const timestamp = now();
        uploadStarts = uploadStarts.filter(
          (startedAt) => timestamp - startedAt < uploadWindowMs,
        );
        if (
          activeUploads >= maxConcurrentUploads ||
          uploadStarts.length >= maxUploadsPerWindow
        ) {
          json(
            response,
            429,
            { error: "Localnet IPFS upload quota exceeded." },
            { "retry-after": "1" },
          );
          return;
        }
        activeUploads += 1;
        uploadStarts.push(timestamp);
        try {
          const body = await requestBytes(
            request,
            maxBytes + 64 * 1024,
            requestTimeoutMs,
          );
          const payload = multipartPayload(request, body);
          if (payload.length > maxBytes) {
            json(response, 413, { error: "Localnet IPFS blob is too large." });
            return;
          }
          const cid = computeLocalnetRawCidV1(payload);
          store(cid, payload, timestamp);
          json(response, 200, { Name: "blob", Hash: cid, Size: String(payload.length) });
        } finally {
          activeUploads -= 1;
        }
        return;
      }

      const match = /^\/ipfs\/(b[a-z2-7]+)$/.exec(url.pathname);
      if ((request.method === "GET" || request.method === "HEAD") && match) {
        const timestamp = now();
        pruneExpired(timestamp);
        const payload = blobs.get(match[1]);
        if (!payload) {
          json(response, 404, { error: "CID not found." });
          return;
        }
        if (url.searchParams.get("format") !== "raw") {
          json(response, 400, { error: "Only raw block reads are supported." });
          return;
        }
        metadata.set(match[1], {
          createdAt: metadata.get(match[1]).createdAt,
          lastAccess: timestamp,
        });
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'",
          "content-type": "application/vnd.ipld.raw",
          "content-length": String(payload.length),
        });
        response.end(request.method === "HEAD" ? undefined : payload);
        return;
      }

      json(response, 404, { error: "Not found." });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
      } else {
        json(response, Number(error?.status) || 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  return Object.freeze({
    server,
    stats: () =>
      Object.freeze({
        objects: blobs.size,
        totalBytes,
        activeUploads,
      }),
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      }),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  throw new Error(
    "Run the local IPFS emulator through scripts/localnet-app.mjs so a per-run control token is installed.",
  );
}
