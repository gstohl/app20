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

/// Pre-transfer balance observed in the same outer transaction as the pool invocation.
#[derive(Copy, Drop, starknet::Store)]
pub struct MailFundingSnapshot {
    pub transaction_hash: felt252,
    pub balance: u256,
    pub prepared: bool,
}

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IApp20Mail<TState> {
    /// The submitting account calls this before the pool withdrawal in one atomic multicall.
    fn prepare_funding(ref self: TState, token: ContractAddress);
    fn privacy_compute(
        self: @TState,
        identity_key: felt252,
        token: ContractAddress,
        note_id: felt252,
        eph_pk: (felt252, felt252),
        view_tag: u8,
        nonce: (felt252, felt252),
        ct: Array<felt252>,
        action_id: felt252,
    ) -> (felt252, felt252);
    fn privacy_invoke_with_computation(
        ref self: TState,
        replay_slot: felt252,
        payload_commitment: felt252,
        token: ContractAddress,
        pool_address: ContractAddress,
        note_id: felt252,
        eph_pk: (felt252, felt252),
        view_tag: u8,
        nonce: (felt252, felt252),
        ct: Array<felt252>,
        action_id: felt252,
    ) -> Span<OpenNoteDeposit>;
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
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address, get_tx_info};
    use super::{
        IErc20Dispatcher, IErc20DispatcherTrait, MAIL_RECOVERY_AMOUNT, MAX_CT_FELTS,
        MailFundingSnapshot, OpenNoteDeposit,
    };

    mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const CT_TOO_LARGE: felt252 = 'CT_TOO_LARGE';
        pub const ACTION_ID_USED: felt252 = 'ACTION_ID_USED';
        pub const PROTECTED_ACTION_REQUIRED: felt252 = 'PROTECTED_ACTION_REQUIRED';
        pub const PAYLOAD_MISMATCH: felt252 = 'PAYLOAD_MISMATCH';
        pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
        pub const BALANCE_DEFICIT: felt252 = 'BALANCE_DEFICIT';
        pub const SHORT_FILL: felt252 = 'SHORT_FILL';
        pub const EXCESS_FILL: felt252 = 'EXCESS_FILL';
        pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        pubkeys: Map<ContractAddress, (felt252, felt252)>,
        message_count: u64,
        used_replay_slots: Map<felt252, bool>,
        funding_snapshots: Map<ContractAddress, MailFundingSnapshot>,
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

    fn compute_payload_commitment(
        token: ContractAddress,
        note_id: felt252,
        eph_pk: (felt252, felt252),
        view_tag: u8,
        nonce: (felt252, felt252),
        ct: Span<felt252>,
        action_id: felt252,
    ) -> felt252 {
        let (eph_pk_x, eph_pk_y) = eph_pk;
        let (nonce_low, nonce_high) = nonce;
        let mut preimage = array![
            'APP20_MAIL_PAYLOAD_V2', token.into(), note_id, eph_pk_x, eph_pk_y, view_tag.into(),
            nonce_low, nonce_high, ct.len().into(),
        ];
        preimage.append_span(ct);
        preimage.append(action_id);
        poseidon_hash_span(preimage.span())
    }

    fn post_message(
        ref self: ContractState,
        token: ContractAddress,
        note_id: felt252,
        eph_pk: (felt252, felt252),
        view_tag: u8,
        nonce: (felt252, felt252),
        ct: Span<felt252>,
        action_id: felt252,
    ) -> Span<OpenNoteDeposit> {
        let index = self.message_count.read();
        self.message_count.write(index + 1);
        self.emit(MessagePosted { index, eph_pk, view_tag, nonce, ct, action_id });

        let mut snapshot = self.funding_snapshots.entry(token).read();
        let current_transaction_hash = get_tx_info().unbox().transaction_hash;
        if !snapshot.prepared || snapshot.transaction_hash != current_transaction_hash {
            let deposits: Array<OpenNoteDeposit> = array![];
            return deposits.span();
        }

        snapshot.prepared = false;
        self.funding_snapshots.entry(token).write(snapshot);
        let pool = self.pool.read();
        let erc20 = IErc20Dispatcher { contract_address: token };
        let balance = erc20.balance_of(get_contract_address());
        assert(balance >= snapshot.balance, errors::BALANCE_DEFICIT);
        let received = balance - snapshot.balance;
        let recovery_amount: u256 = MAIL_RECOVERY_AMOUNT.into();
        assert(received >= recovery_amount, errors::SHORT_FILL);
        assert(received == recovery_amount, errors::EXCESS_FILL);
        assert(erc20.approve(pool, recovery_amount), errors::APPROVE_FAILED);
        array![OpenNoteDeposit { note_id, token, amount: MAIL_RECOVERY_AMOUNT }].span()
    }

    #[abi(embed_v0)]
    impl App20MailImpl of super::IApp20Mail<ContractState> {
        fn prepare_funding(ref self: ContractState, token: ContractAddress) {
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            let erc20 = IErc20Dispatcher { contract_address: token };
            self
                .funding_snapshots
                .entry(token)
                .write(
                    MailFundingSnapshot {
                        transaction_hash: get_tx_info().unbox().transaction_hash,
                        balance: erc20.balance_of(get_contract_address()),
                        prepared: true,
                    },
                );
        }

        fn privacy_compute(
            self: @ContractState,
            identity_key: felt252,
            token: ContractAddress,
            note_id: felt252,
            eph_pk: (felt252, felt252),
            view_tag: u8,
            nonce: (felt252, felt252),
            ct: Array<felt252>,
            action_id: felt252,
        ) -> (felt252, felt252) {
            assert(action_id != 0, errors::PROTECTED_ACTION_REQUIRED);
            assert(ct.len() <= MAX_CT_FELTS, errors::CT_TOO_LARGE);
            let payload = compute_payload_commitment(
                token, note_id, eph_pk, view_tag, nonce, ct.span(), action_id,
            );
            let replay_slot = poseidon_hash_span(
                array!['APP20_MAIL_ACTION_V2', identity_key, action_id].span(),
            );
            (replay_slot, payload)
        }

        fn privacy_invoke_with_computation(
            ref self: ContractState,
            replay_slot: felt252,
            payload_commitment: felt252,
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
            assert(caller == self.pool.read(), errors::BAD_POOL);
            assert(action_id != 0, errors::PROTECTED_ACTION_REQUIRED);
            assert(ct.len() <= MAX_CT_FELTS, errors::CT_TOO_LARGE);
            assert(
                payload_commitment == compute_payload_commitment(
                    token, note_id, eph_pk, view_tag, nonce, ct.span(), action_id,
                ),
                errors::PAYLOAD_MISMATCH,
            );

            let used_replay_slot = self.used_replay_slots.entry(replay_slot);
            assert(!used_replay_slot.read(), errors::ACTION_ID_USED);
            used_replay_slot.write(true);

            post_message(ref self, token, note_id, eph_pk, view_tag, nonce, ct.span(), action_id)
        }

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
            assert(action_id == 0, errors::PROTECTED_ACTION_REQUIRED);

            post_message(ref self, token, note_id, eph_pk, view_tag, nonce, ct.span(), action_id)
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
