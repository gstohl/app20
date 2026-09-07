// Adapter example: import this module; it does not connect, generate keys or spend on import.
// Both clients must be configured for the same reviewed non-mainnet agreement.
// Peer transport must be authenticated and encrypted: prepared contains private escrow inputs.
export async function jointlyAuthorize({ client, role, mode, sign, requestPeerApproval }) {
  if (!['setup', 'settle'].includes(mode) || !['a', 'b'].includes(role)) throw new Error('Joint setup or settlement and a valid role required.');
  const prepared = await client.prepare(mode);
  const ownApproval = await client.approve(prepared, role, sign);
  // On the other device, call peerClient.approve(prepared, otherRole, peerSigner).
  // That client verifies its own stored agreement, live deployment and private action policy.
  const peerApproval = await requestPeerApproval(prepared);
  return client.execute(prepared, [ownApproval, peerApproval]);
}

export async function refundAfterExpiry({ client, role, sign }) {
  if (!['a', 'b'].includes(role)) throw new Error('A valid refund role is required.');
  await client.reconcile();
  const prepared = await client.prepare(role === 'a' ? 'refundA' : 'refundB');
  return client.execute(prepared, [await client.approve(prepared, role, sign)]);
}

export async function fundOwnSide({ client, role, privateWallet }) {
  // This adapter must send an encrypted note from this party's wallet and enforce its budget.
  // Never replace it with a public ERC-20 transfer to the escrow contract address.
  return client.fund(role, payment => privateWallet.encryptedTransfer(payment));
}
