/** In-process ordering/maturity state for one Starknet account. */
export interface PrivacySequencingState {
 lastPrivateTxBlock?: number;
 queue?: Promise<void>;
}

/**
 * A distributed coordinator lease. Implementations should acquire an exclusive
 * lock and load the last submitted private-transaction block atomically.
 */
export interface PrivacyCoordinationLease {
 readonly lastPrivateTxBlock?: number;
 setLastPrivateTxBlock(blockNumber: number): Promise<void> | void;
 release(): Promise<void> | void;
}

/**
 * Optional cross-process coordination for replicated/serverless applications.
 * Use a Redis/DB advisory lock keyed by the supplied chain/account key and
 * persist `lastPrivateTxBlock` with the lease.
 */
export interface PrivacyCoordinator {
 acquire(key: string): Promise<PrivacyCoordinationLease>;
}

const defaultSequencingStates = new Map<string, PrivacySequencingState>();

/** Share ordering state across every Strk20Privy instance in this Node process. */
export function inMemoryPrivacySequencing(key: string): PrivacySequencingState {
 const existing = defaultSequencingStates.get(key);
 if (existing) return existing;
 const created: PrivacySequencingState = {};
 defaultSequencingStates.set(key, created);
 return created;
}
