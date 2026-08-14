use starknet::ContractAddress;

// Must match privacy::objects::OpenNoteDeposit (positional Serde).
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IQuietlineMail<TState> {
    fn privacy_invoke(
        ref self: TState,
        token: ContractAddress,
        pool_address: ContractAddress,
        note_id: felt252,
        eph_pk: (felt252, felt252),
        view_tag: u8,
        nonce: (felt252, felt252),
        ct: Array<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn register_pubkey(ref self: TState, pk: (felt252, felt252));
    fn get_pubkey(self: @TState, addr: ContractAddress) -> (felt252, felt252);
    fn message_count(self: @TState) -> u64;
}

#[starknet::contract]
pub mod QuietlineMail {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{IErc20Dispatcher, IErc20DispatcherTrait, OpenNoteDeposit};

    mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
        pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        pubkeys: Map<ContractAddress, (felt252, felt252)>,
        message_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MessagePosted: MessagePosted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MessagePosted {
        #[key]
        pub index: u64,
        pub eph_pk: (felt252, felt252),
        pub view_tag: u8,
        pub nonce: (felt252, felt252),
        pub ct: Span<felt252>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl QuietlineMailImpl of super::IQuietlineMail<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            token: ContractAddress,
            pool_address: ContractAddress,
            note_id: felt252,
            eph_pk: (felt252, felt252),
            view_tag: u8,
            nonce: (felt252, felt252),
            ct: Array<felt252>,
        ) -> Span<OpenNoteDeposit> {
            // This argument is a wallet placeholder only; authorization uses storage.
            let _pool_placeholder = pool_address;
            let caller = get_caller_address();
            let pool = self.pool.read();
            assert(caller == pool, errors::BAD_POOL);

            let index = self.message_count.read();
            self.message_count.write(index + 1);
            self.emit(MessagePosted { index, eph_pk, view_tag, nonce, ct: ct.span() });

            let erc20 = IErc20Dispatcher { contract_address: token };
            let balance = erc20.balance_of(get_contract_address());
            if balance == 0 {
                let deposits: Array<OpenNoteDeposit> = array![];
                return deposits.span();
            }

            let amount: u128 = balance.try_into().expect(errors::AMOUNT_OVERFLOW);
            assert(erc20.approve(pool, balance), errors::APPROVE_FAILED);
            array![OpenNoteDeposit { note_id, token, amount }].span()
        }

        fn register_pubkey(ref self: ContractState, pk: (felt252, felt252)) {
            self.pubkeys.entry(get_caller_address()).write(pk);
        }

        fn get_pubkey(self: @ContractState, addr: ContractAddress) -> (felt252, felt252) {
            self.pubkeys.entry(addr).read()
        }

        fn message_count(self: @ContractState) -> u64 {
            self.message_count.read()
        }
    }
}

pub mod mock_erc20;
