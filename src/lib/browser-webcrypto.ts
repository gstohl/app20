// HPKE's optional Node fallback resolves to the browser's native WebCrypto.
// No Node polyfill or software fallback is shipped to the frontend.
export const webcrypto = globalThis.crypto;
