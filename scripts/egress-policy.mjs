/**
 * Node-only SSRF egress policy.
 *
 * Cloudflare Workers cannot resolve DNS or pin connection addresses, so this
 * module hardens server-side Node callers only. It does not satisfy P0-23 for
 * any Worker path, does not implement production RPC allowlisting, and does
 * not close P0-23.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { checkServerIdentity as tlsCheckServerIdentity } from "node:tls";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export class EgressRefusal extends Error {}
export class EgressFailure extends Error {}

function createErrorMessages(kind = "egress") {
  const urlLabel =
    kind === "RPC" ? "RPC URL" : kind === "egress" ? "URL" : `${kind} URL`;
  const requestKind = kind === "egress" ? "egress" : kind;
  return Object.freeze({
    urlLabel,
    notHttps: `${urlLabel} must be an absolute HTTPS URL`,
    credentials: `${urlLabel} must use an HTTPS origin without embedded credentials`,
    lookupFailed: (message) =>
      `${requestKind} hostname resolution failed: ${message}`,
    noAddresses: `${requestKind} hostname resolution returned no addresses`,
    notPublic: `${urlLabel} must resolve exclusively to public IP addresses`,
    timedOut: `${requestKind} request timed out`,
    requestFailed: (message) => `${requestKind} request failed: ${message}`,
    redirect: `${requestKind} redirect refused`,
    sizeLimit: `${requestKind} response exceeds the response-size limit`,
    noBody: `${requestKind} response has no body`,
    readFailed: (message) =>
      `${requestKind} response could not be read: ${message}`,
    notUtf8: `${requestKind} response is not valid UTF-8`,
    pinLost: `${requestKind} pinned address missing after DNS re-resolution`,
    hostMismatch: `${requestKind} Host header must match the request URL host`,
    sniMismatch: "TLS SNI does not match the request hostname",
  });
}

function ipv4Value(address) {
  return address
    .split(".")
    .reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6Value(address) {
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const separator = input.lastIndexOf(":");
    const ipv4 = ipv4Value(input.slice(separator + 1));
    input = `${input.slice(0, separator)}:${(ipv4 >> 16n).toString(16)}:${(
      ipv4 & 0xffffn
    ).toString(16)}`;
  }
  const halves = input.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const words =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  return words.reduce(
    (value, word) => (value << 16n) | BigInt(`0x${word || "0"}`),
    0n,
  );
}

function ipv4InCidr(value, base, prefix) {
  const shift = 32n - BigInt(prefix);
  return value >> shift === ipv4Value(base) >> shift;
}

function ipv6InCidr(value, base, prefix) {
  const shift = 128n - BigInt(prefix);
  return value >> shift === ipv6Value(base) >> shift;
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    const refused = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return !refused.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
  }
  if (family === 6) {
    const value = ipv6Value(address);
    // Start with global unicast, then exclude the special-purpose blocks that
    // sit inside 2000::/3. Everything outside global unicast (including
    // unspecified, loopback, mapped/compatible, translation, ULA, link-local,
    // multicast, and reserved space) is refused by the first condition.
    if (value >> 125n !== 1n) return false;
    const refused = [
      ["2001::", 23], // IETF protocol assignments, including Teredo/ORCHID
      ["2001:2::", 48], // benchmarking
      ["2001:20::", 28], // non-routeable ORCHIDv2 identifiers
      ["2001:db8::", 32], // documentation
      ["2002::", 16], // deprecated 6to4 can encapsulate a private IPv4 target
      ["3fff::", 20], // documentation
    ];
    return !refused.some(([base, prefix]) => ipv6InCidr(value, base, prefix));
  }
  return false;
}

function hostnameFromUrl(url) {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

export function assertHttpsUrl(value, label = "URL") {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new EgressRefusal(`${label} must be an absolute HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new EgressRefusal(
      `${label} must use an HTTPS origin without embedded credentials`,
    );
  }
  return url;
}

async function abortableLookup(lookupImpl, hostname, signal, timedOutMessage) {
  const lookup = lookupImpl(hostname, { all: true, verbatim: true });
  if (!signal) return lookup;
  if (signal.aborted) throw new EgressFailure(timedOutMessage);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new EgressFailure(timedOutMessage));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([lookup, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function freezeEndpoint(address, family) {
  return Object.freeze({ address, family });
}

async function resolvePublicAddresses(url, options = {}) {
  const messages = options.messages ?? createErrorMessages(options.kind);
  const lookupImpl = options.lookupImpl ?? dnsLookup;
  const hostname = hostnameFromUrl(url);
  const literalFamily = isIP(hostname);
  let answers;
  if (literalFamily) {
    answers = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      answers = await abortableLookup(
        lookupImpl,
        hostname,
        options.signal,
        messages.timedOut,
      );
    } catch (error) {
      if (error instanceof EgressFailure) throw error;
      throw new EgressFailure(messages.lookupFailed(error.message));
    }
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new EgressFailure(messages.noAddresses);
  }
  const resolved = [];
  for (const answer of answers) {
    const family = isIP(answer?.address ?? "");
    if (
      (family !== 4 && family !== 6) ||
      (answer.family !== undefined && Number(answer.family) !== family) ||
      !isPublicAddress(answer.address)
    ) {
      throw new EgressRefusal(messages.notPublic);
    }
    resolved.push(freezeEndpoint(answer.address, family));
  }
  return Object.freeze(resolved);
}

export async function resolvePublicEndpoint(url, options = {}) {
  const answers = await resolvePublicAddresses(url, options);
  return answers[0];
}

export async function reresolvePinnedEndpoint(url, endpoint, options = {}) {
  const messages = options.messages ?? createErrorMessages(options.kind);
  const answers = await resolvePublicAddresses(url, options);
  const stillPresent = answers.some(
    (answer) =>
      answer.address === endpoint.address && answer.family === endpoint.family,
  );
  if (!stillPresent) {
    throw new EgressRefusal(messages.pinLost);
  }
  return endpoint;
}

export function createPinnedLookup(endpoint) {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address: endpoint.address, family: endpoint.family }]);
    } else {
      callback(null, endpoint.address, endpoint.family);
    }
  };
}

function assertConsistentHostHeaders(url, headers, messages) {
  const hostHeader = url.host;
  const merged = { ...(headers ?? {}) };
  for (const [name, value] of Object.entries(merged)) {
    if (name.toLowerCase() === "host" && value !== hostHeader) {
      throw new EgressRefusal(messages.hostMismatch);
    }
  }
  merged.host = hostHeader;
  return merged;
}

export function createPinnedHttpsFetch(options = {}) {
  const requestImpl = options.requestImpl ?? httpsRequest;
  const messages = options.messages ?? createErrorMessages(options.kind);
  return function pinnedHttpsFetch(url, init) {
    return new Promise((resolveResponse, reject) => {
      let request;
      try {
        const target =
          url instanceof URL ? url : assertHttpsUrl(url, messages.urlLabel);
        const hostname = hostnameFromUrl(target);
        const headers = assertConsistentHostHeaders(
          target,
          init.headers,
          messages,
        );
        request = requestImpl(target, {
          method: init.method,
          headers,
          signal: init.signal,
          lookup: init.lookup,
          // Pin SNI to the original hostname while lookup pins the IP.
          servername: hostname,
          // Never reuse a process-global socket that may predate validation.
          agent: false,
          checkServerIdentity(servername, cert) {
            if (servername !== hostname) {
              return new Error(messages.sniMismatch);
            }
            return tlsCheckServerIdentity(hostname, cert);
          },
        });
      } catch (error) {
        reject(error);
        return;
      }
      request.on("response", (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }
        resolveResponse({
          status: response.statusCode ?? 0,
          ok:
            response.statusCode !== undefined &&
            response.statusCode >= 200 &&
            response.statusCode < 300,
          headers: responseHeaders,
          body: Readable.toWeb(response),
        });
      });
      request.on("error", reject);
      if (init.body) request.write(init.body);
      request.end();
    });
  };
}

function responseTextFromChunks(chunks, total) {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

export async function readBoundedResponseText(response, maximum, messages) {
  const errors = messages ?? createErrorMessages();
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximum)
  ) {
    throw new EgressFailure(errors.sizeLimit);
  }
  if (!response.body) throw new EgressFailure(errors.noBody);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new EgressFailure(errors.sizeLimit);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof EgressFailure) throw error;
    throw new EgressFailure(errors.readFailed(error.message));
  }
  try {
    return responseTextFromChunks(chunks, total);
  } catch {
    throw new EgressFailure(errors.notUtf8);
  }
}

export async function createEgressSession(urlInput, options = {}) {
  const kind = options.kind ?? "egress";
  const messages = options.messages ?? createErrorMessages(kind);
  const url = assertHttpsUrl(urlInput, messages.urlLabel);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new EgressRefusal("timeout must be a positive integer");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new EgressRefusal("response-size limit must be a positive integer");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const endpoint = await resolvePublicEndpoint(url, {
      lookupImpl: options.lookupImpl,
      signal: controller.signal,
      messages,
    });
    const lookup = createPinnedLookup(endpoint);
    const fetchImpl =
      options.fetchImpl ??
      createPinnedHttpsFetch({
        requestImpl: options.requestImpl,
        messages,
      });
    return {
      endpoint,
      close() {
        clearTimeout(timer);
      },
      async request(init = {}) {
        const headers = assertConsistentHostHeaders(
          url,
          init.headers,
          messages,
        );
        let response;
        try {
          response = await fetchImpl(url, {
            method: init.method ?? "GET",
            redirect: "manual",
            signal: controller.signal,
            headers,
            body: init.body,
            lookup,
          });
        } catch (error) {
          if (
            error instanceof EgressRefusal ||
            error instanceof EgressFailure
          ) {
            throw error;
          }
          if (controller.signal.aborted) {
            throw new EgressFailure(messages.timedOut);
          }
          throw new EgressFailure(messages.requestFailed(error.message));
        }
        try {
          await reresolvePinnedEndpoint(url, endpoint, {
            lookupImpl: options.lookupImpl,
            signal: controller.signal,
            messages,
          });
        } catch (error) {
          if (response.body && typeof response.body.cancel === "function") {
            await response.body.cancel().catch(() => {});
          }
          throw error;
        }
        if (response.status >= 300 && response.status < 400) {
          throw new EgressFailure(messages.redirect);
        }
        const text = await readBoundedResponseText(
          response,
          maxResponseBytes,
          messages,
        );
        return {
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          text,
          endpoint,
        };
      },
    };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}
