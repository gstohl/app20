/** Public mainnet operation is enabled; complete real-proof settlement remains unverified. */
export const CONFIDENTIAL_RFQ_MAINNET_ENABLED = true;
export const CONFIDENTIAL_RFQ_REAL_PROOF_VERIFIED = false;
export const CONFIDENTIAL_RFQ_STATUS = Object.freeze({
  nodeDevelopment: true,
  mainnetEnabled: CONFIDENTIAL_RFQ_MAINNET_ENABLED,
  browserWalletSupported: false,
  realProofVerified: CONFIDENTIAL_RFQ_REAL_PROOF_VERIFIED,
  independentReviewComplete: false,
  privacy: 'Encrypted settlement amounts and assets; public escrow activity and timing.',
});
