/** Public browser-side OHTTP transport configuration. */
export interface OhttpTransportOptions {
  relayUrl?: string;
  /** RFC 9458 `application/ohttp-keys` bytes used without a key fetch. */
  publicKeyConfig?: Uint8Array;
}

export type OhttpTransportOption = boolean | OhttpTransportOptions;
