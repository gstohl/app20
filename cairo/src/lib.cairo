use starknet::ContractAddress;

pub const MAX_CT_FELTS: usize = 140;
pub const MAIL_RECOVERY_AMOUNT: u128 = 7;

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
pub trait IApp20Mail<TState> {
    fn privacy_invoke(
        ref self: TState,
        token: ContractAddress,
        pool_address: ContractAddress,
        note_id: felt252,
        eph_pk: (felt252, felt252),
        view_tag: u8,
        nonce: (felt252, felt252),
        ct: Array<felt252>,
        action_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn register_pubkey(ref self: TState, pk: (felt252, felt252));
    fn get_pubkey(self: @TState, addr: ContractAddress) -> (felt252, felt252);
    fn message_count(self: @TState) -> u64;
}

#[starknet::contract]
pub mod App20Mail {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        IErc20Dispatcher, IErc20DispatcherTrait, MAIL_RECOVERY_AMOUNT, MAX_CT_FELTS,
        OpenNoteDeposit,
    };

    mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const CT_TOO_LARGE: felt252 = 'CT_TOO_LARGE';
        pub const ACTION_ID_USED: felt252 = 'ACTION_ID_USED';
        pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        pubkeys: Map<ContractAddress, (felt252, felt252)>,
        message_count: u64,
        used_action_ids: Map<felt252, bool>,
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
        pub action_id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl App20MailImpl of super::IApp20Mail<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            token: ContractAddress,
            pool_address: ContractAddress,
            note_id: felt252,
            eph_pk: (felt252, felt252),
            view_tag: u8,
            nonce: (felt252, felt252),
            ct: Array<felt252>,
            action_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // This argument is a wallet placeholder only; authorization uses storage.
            let _pool_placeholder = pool_address;
            let caller = get_caller_address();
            let pool = self.pool.read();
            assert(caller == pool, errors::BAD_POOL);
            assert(ct.len() <= MAX_CT_FELTS, errors::CT_TOO_LARGE);

            // Zero means no idempotency is required; it is never recorded or rejected.
            if action_id != 0 {
                let used_action_id = self.used_action_ids.entry(action_id);
                assert(!used_action_id.read(), errors::ACTION_ID_USED);
                used_action_id.write(true);
            }

            let index = self.message_count.read();
            self.message_count.write(index + 1);
            self.emit(MessagePosted { index, eph_pk, view_tag, nonce, ct: ct.span(), action_id });

            let erc20 = IErc20Dispatcher { contract_address: token };
            let balance = erc20.balance_of(get_contract_address());
            let recovery_amount: u256 = MAIL_RECOVERY_AMOUNT.into();
            if balance < recovery_amount {
                let deposits: Array<OpenNoteDeposit> = array![];
                return deposits.span();
            }

            assert(erc20.approve(pool, recovery_amount), errors::APPROVE_FAILED);
            array![OpenNoteDeposit { note_id, token, amount: MAIL_RECOVERY_AMOUNT }].span()
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
pub mod claim_ticket;
pub mod escrow;
pub mod lock_ticket;

pub mod mock_erc20;
