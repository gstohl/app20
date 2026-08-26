import {
  scanAndDecrypt,
  type DecryptedMail,
  type EncryptedMailRecord,
} from "../lib/mail";

type ScanRequest = {
  privateKey: Uint8Array;
  records: EncryptedMailRecord[];
};

type ScanResponse =
  | { ok: true; decrypted: DecryptedMail[] }
  | { ok: false; message: string };

// SAFETY: Vite loads this module only as a dedicated Web Worker; the narrowed
// surface lists the two worker-global methods used below.
const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ScanRequest>) => void,
  ): void;
  postMessage(message: ScanResponse): void;
};

workerScope.addEventListener("message", (event) => {
  void (async () => {
    try {
      const decrypted = await scanAndDecrypt(
        event.data.privateKey,
        event.data.records,
      );
      workerScope.postMessage({ ok: true, decrypted });
    } catch (error: unknown) {
      workerScope.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : "Mail scan failed.",
      });
    }
  })();
});
