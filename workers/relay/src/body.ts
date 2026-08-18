import { RelayHttpError } from "./errors.ts";

function declaredLength(headers: Headers, tooLargeMessage: string, maxBytes: number): void {
  const raw = headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/.test(raw)) throw new RelayHttpError(400, "Invalid Content-Length.");
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) throw new RelayHttpError(400, "Invalid Content-Length.");
  if (length > maxBytes) throw new RelayHttpError(413, tooLargeMessage);
}

export async function readBoundedRequest(
  request: Request,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Uint8Array> {
  declaredLength(request.headers, tooLargeMessage, maxBytes);
  return readBoundedStream(request.body, maxBytes, 413, tooLargeMessage, true);
}

export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Uint8Array> {
  const raw = response.headers.get("content-length");
  if (raw !== null && /^\d+$/.test(raw) && Number(raw) > maxBytes) {
    await response.body?.cancel();
    throw new RelayHttpError(502, tooLargeMessage);
  }
  return readBoundedStream(response.body, maxBytes, 502, tooLargeMessage, false);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  status: number,
  tooLargeMessage: string,
  requireBody: boolean,
): Promise<Uint8Array> {
  if (!stream) {
    if (requireBody) throw new RelayHttpError(400, "Request body is required.");
    return new Uint8Array();
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RelayHttpError(status, tooLargeMessage);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (requireBody && total === 0) throw new RelayHttpError(400, "Request body is required.");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);
  return result.buffer;
}
