import { RelayHttpError } from "./errors.ts";

export const RFQ_MAX_BODY_BYTES = 96 * 1024;
export const RFQ_MAX_PAGE_ITEMS = 50;

export async function readBoundedJson(request: Request, maxBytes = RFQ_MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RelayHttpError(413, "RFQ request is too large.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new RelayHttpError(413, "RFQ request is too large.");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RelayHttpError(400, "Invalid RFQ JSON."); }
}

export function noStoreJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}
