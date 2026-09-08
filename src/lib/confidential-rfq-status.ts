/** Controlled mainnet settlement verified; see deployments/mainnet/confidential-settlement-2026-09-08.json. */
export const CONFIDENTIAL_RFQ_MAINNET_ENABLED = true;
export const CONFIDENTIAL_RFQ_REAL_PROOF_VERIFIED = true;
export const CONFIDENTIAL_RFQ_STATUS = Object.freeze({
  nodeDevelopment: true,
  mainnetEnabled: CONFIDENTIAL_RFQ_MAINNET_ENABLED,
  browserWalletSupported: true,
  nativeReadyEndToEndVerified: false,
  realProofVerified: CONFIDENTIAL_RFQ_REAL_PROOF_VERIFIED,
  independentReviewComplete: false,
  privacy: 'Encrypted settlement amounts and assets; public escrow activity and timing.',
});
