/** Release facts, not an environment switch. Real-proof and wallet evidence are still pending. */
export const CONFIDENTIAL_RFQ_MAINNET_ENABLED = false;
export const CONFIDENTIAL_RFQ_REAL_PROOF_VERIFIED = false;
export const CONFIDENTIAL_RFQ_STATUS = Object.freeze({
  nodeDevelopment: true,
  mainnetEnabled: CONFIDENTIAL_RFQ_MAINNET_ENABLED,
  browserWalletSupported: false,
  realProofVerified: CONFIDENTIAL_RFQ_REAL_PROOF_VERIFIED,
  independentReviewComplete: false,
  privacy: 'Encrypted settlement amounts and assets; public escrow activity and timing.',
});
