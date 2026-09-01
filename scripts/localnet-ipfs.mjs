import { createHash } from "node:crypto";
import { createServer } from "node:http";

export const LOCALNET_IPFS_HOST = "127.0.0.1";
export const LOCALNET_IPFS_PORT = 5054;
export const LOCALNET_IPFS_MAX_BYTES = 1024 * 1024;
const RAW_MEDIA_TYPE = "application/vnd.ipld.raw";
const MAX_MULTIPART_OVERHEAD = 64 * 1024;

function base32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function computeLocalnetRawCidV1(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("Localnet IPFS CID input must be bytes.");
  }
  const digest = createHash("sha256").update(bytes).digest();
  return `b${base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]))}`;
}

function json(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function parseBoundary(contentType) {
  if (typeof contentType !== "string") return undefined;
  const match =
    /^multipart\/form-data(?:\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+)))$/i.exec(
      contentType.trim(),
    );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    return undefined;
  }
  return boundary;
}

function parseMultipartFile(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  if (!body.subarray(0, delimiter.length).equals(delimiter)) {
    throw new Error("Localnet IPFS multipart body has an invalid boundary.");
  }
  let cursor = delimiter.length;
  const files = [];
  for (;;) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) {
      cursor += 2;
      if (cursor === body.length) break;
      if (
        cursor + 2 === body.length &&
        body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))
      ) {
        break;
      }
      throw new Error("Localnet IPFS multipart body has trailing bytes.");
    }
    if (!body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) {
      throw new Error("Localnet IPFS multipart part is malformed.");
    }
    cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0 || headerEnd - cursor > 16 * 1024) {
      throw new Error("Localnet IPFS multipart headers are malformed.");
    }
    const headers = body.subarray(cursor, headerEnd).toString("utf8");
    const disposition = headers
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-disposition:"));
    if (!disposition || !/\bname="file"(?:;|$)/i.test(disposition)) {
      throw new Error("Localnet IPFS multipart upload requires a file part.");
    }
    cursor = headerEnd + 4;
    const next = body.indexOf(separator, cursor);
    if (next < 0) {
      throw new Error("Localnet IPFS multipart body is truncated.");
    }
    files.push(Buffer.from(body.subarray(cursor, next)));
    cursor = next + 2 + delimiter.length;
  }
  if (files.length !== 1) {
    throw new Error(
      "Localnet IPFS multipart upload requires exactly one file.",
    );
  }
  return files[0];
}

async function requestBytes(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      const error = new Error("Localnet IPFS upload exceeded 1 MiB.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function rawRequested(request, url) {
  if (request.method === "HEAD" || url.searchParams.get("format") === "raw")
    return true;
  const accept = request.headers.accept;
  return (
    typeof accept === "string" &&
    accept
      .split(",")
      .some((item) => item.trim().split(";", 1)[0] === RAW_MEDIA_TYPE)
  );
}

export function createLocalnetIpfsServer(options = {}) {
  const host = options.host ?? LOCALNET_IPFS_HOST;
  const port = options.port ?? LOCALNET_IPFS_PORT;
  const maxBytes = options.maxBytes ?? LOCALNET_IPFS_MAX_BYTES;
  if (host !== LOCALNET_IPFS_HOST) {
    throw new Error("Localnet IPFS must bind to 127.0.0.1.");
  }
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Localnet IPFS port must be a valid TCP port.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Localnet IPFS byte limit must be positive.");
  }
  const blobs = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (request.method === "POST" && url.pathname === "/api/v0/add") {
        if (
          url.searchParams.get("cid-version") !== "1" ||
          url.searchParams.get("raw-leaves") !== "true" ||
          url.searchParams.get("hash") !== "sha2-256" ||
          url.searchParams.get("pin") !== "true"
        ) {
          json(response, 400, {
            error: "Localnet IPFS requires CIDv1 raw sha2-256 uploads.",
          });
          return;
        }
        const boundary = parseBoundary(request.headers["content-type"]);
        if (!boundary) {
          json(response, 400, {
            error: "Localnet IPFS upload must be multipart/form-data.",
          });
          return;
        }
        const body = await requestBytes(
          request,
          maxBytes + MAX_MULTIPART_OVERHEAD,
        );
        const bytes = parseMultipartFile(body, boundary);
        if (bytes.length > maxBytes) {
          json(response, 413, {
            error: "Localnet IPFS upload exceeded 1 MiB.",
          });
          return;
        }
        const cid = computeLocalnetRawCidV1(bytes);
        blobs.set(cid, bytes);
        json(response, 200, { Hash: cid, Size: String(bytes.length) });
        return;
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        url.pathname.startsWith("/ipfs/")
      ) {
        if (!rawRequested(request, url)) {
          json(response, 400, {
            error: "Localnet IPFS serves raw blocks only.",
          });
          return;
        }
        const cid = url.pathname.slice("/ipfs/".length);
        const bytes = blobs.get(cid);
        if (!bytes) {
          json(response, 404, { error: "Localnet IPFS block was not found." });
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": String(bytes.length),
          "content-type": RAW_MEDIA_TYPE,
        });
        response.end(request.method === "HEAD" ? undefined : bytes);
        return;
      }
      json(response, 404, { error: "Unknown localnet IPFS route." });
    } catch (error) {
      json(response, error?.status === 413 ? 413 : 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return Object.freeze({
    host,
    port,
    server,
    blobs,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve(server);
        });
      });
    },
  });
}
