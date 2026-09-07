// Test-only forwarding probe. NOT a swap, custodian, or production coordinator.
// It checks whether a nested contract call can compose two pool action proofs.
#[starknet::interface]
pub trait IProofPairProbe<TState> {
    fn apply_pair(
        ref self: TState,
        pool: starknet::ContractAddress,
        first: Span<felt252>,
        second: Span<felt252>,
    );
}

#[starknet::contract]
pub mod ProofPairProbe {
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl Probe of super::IProofPairProbe<ContractState> {
        fn apply_pair(
            ref self: ContractState,
            pool: ContractAddress,
            first: Span<felt252>,
            second: Span<felt252>,
        ) {
            call_contract_syscall(pool, selector!("apply_actions"), first).unwrap_syscall();
            call_contract_syscall(pool, selector!("apply_actions"), second).unwrap_syscall();
        }
    }
}
