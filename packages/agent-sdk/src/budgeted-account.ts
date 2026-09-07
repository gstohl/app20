import type { Account, Call } from 'starknet';

export type BudgetState = { spent: string; pending?: { hash?: string } };
export async function executeBudgeted<S extends BudgetState>(
  account: Account,
  calls: Call | Call[],
  details: Parameters<Account['execute']>[1],
  budget: { maxFeePerTransaction: bigint; maxTotalFees: bigint; load(): Promise<S>; save(state: S): Promise<void> },
) {
  const state = await budget.load();
  if (state.pending) throw new Error('Reconcile the previous account transaction first.');
  // Proof data and proof facts must survive both estimation and submission.
  const transactionDetails = { ...details, tip: 0n };
  const estimate = await account.estimateInvokeFee(calls, transactionDetails);
  const bounds = estimate.resourceBounds;
  const fee = Object.values(bounds).reduce((sum, resource) => sum + BigInt(resource.max_amount) * BigInt(resource.max_price_per_unit), 0n);
  if (fee > budget.maxFeePerTransaction || BigInt(state.spent) + fee > budget.maxTotalFees) throw new Error('Wallet gas budget exceeded.');
  state.spent = (BigInt(state.spent) + fee).toString();
  state.pending = {};
  await budget.save(state);
  const tx = await account.execute(calls, { ...transactionDetails, resourceBounds: bounds });
  state.pending = { hash: tx.transaction_hash };
  await budget.save(state);
  return tx;
}
