use starknet::ContractAddress;
use crate::OpenNoteDeposit;

pub const ESCROW_CLAIM_TAG: felt252 = 'QUIETLINE_ESCROW_CLAIM_V1';
pub const CLAIM_OPERATION: felt252 = 'CLAIM';
pub const TIMEOUT_OPERATION: felt252 = 'TIMEOUT';

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct FundParams {
    pub token: ContractAddress,
    pub counter_token: ContractAddress,
    pub counter_amount: u128,
    pub deadline: u64,
    pub claim_pubkey: felt252,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct FillParams {
    pub token: ContractAddress,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct ClaimParams {
    pub sig_r: felt252,
    pub sig_s: felt252,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct TimeoutParams {
    pub sig_r: felt252,
    pub sig_s: felt252,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum PayoutOperation {
    Claim,
    Timeout,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum EscrowOperation {
    Fund: FundParams,
    Fill: FillParams,
    Claim: ClaimParams,
    Timeout: TimeoutParams,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum DealStatus {
    #[default]
    Empty,
    Funded,
    Filled,
    Settled,
    TimedOut,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Deal {
    pub leg_a_token: ContractAddress,
    pub leg_a_amount: u128,
    pub leg_b_token: ContractAddress,
    pub leg_b_terms: u128,
    pub leg_b_amount: u128,
    pub deadline: u64,
    pub claim_pubkey: felt252,
    pub status: DealStatus,
}

#[starknet::interface]
pub trait IQuietlineEscrow<TState> {
    fn privacy_invoke(
        ref self: TState,
        operation: EscrowOperation,
        deal_id: felt252,
        pool_address: ContractAddress,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn get_deal(self: @TState, deal_id: felt252) -> Deal;

    /// Returns the exact message the claim key must sign. Clients MUST derive `claim_privkey` as
    /// `HKDF(mail_seed, "quietline/escrow-claim/v1", deal_id)`, rejecting and re-deriving an
    /// out-of-range scalar rather than truncating or using biased modular reduction. It is not user
    /// input and needs no separate backup: restoring the mailbox seed restores every claim key.
    fn compute_claim_message(
        self: @TState, deal_id: felt252, operation: PayoutOperation, note_id: felt252,
    ) -> felt252;
}

#[starknet::contract]
pub mod QuietlineEscrow {
    use core::ecdsa::check_ecdsa_signature;
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use crate::{IErc20Dispatcher, IErc20DispatcherTrait};
    use super::{
        CLAIM_OPERATION, ClaimParams, Deal, DealStatus, ESCROW_CLAIM_TAG, EscrowOperation,
        FillParams, FundParams, IQuietlineEscrow, OpenNoteDeposit, PayoutOperation,
        TIMEOUT_OPERATION, TimeoutParams,
    };

    mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const ZERO_DEAL_ID: felt252 = 'ZERO_DEAL_ID';
        pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
        pub const SAME_TOKEN: felt252 = 'SAME_TOKEN';
        pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
        pub const ZERO_CLAIM_PUBKEY: felt252 = 'ZERO_CLAIM_PUBKEY';
        pub const DEADLINE_NOT_FUTURE: felt252 = 'DEADLINE_NOT_FUTURE';
        pub const DEAL_EXISTS: felt252 = 'DEAL_EXISTS';
        pub const BAD_STATE: felt252 = 'BAD_STATE';
        pub const DEAL_EXPIRED: felt252 = 'DEAL_EXPIRED';
        pub const DEAL_NOT_EXPIRED: felt252 = 'DEAL_NOT_EXPIRED';
        pub const WRONG_TOKEN: felt252 = 'WRONG_TOKEN';
        pub const SHORT_FILL: felt252 = 'SHORT_FILL';
        pub const BAD_SIGNATURE: felt252 = 'BAD_SIGNATURE';
        pub const BALANCE_DEFICIT: felt252 = 'BALANCE_DEFICIT';
        pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
        pub const CONSERVATION_FAILURE: felt252 = 'CONSERVATION_FAILURE';
        pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        deals: Map<felt252, Deal>,
        // Expected token balances after the pool applies returned deposits. This is also the
        // aggregate outstanding liability for each token between invocations.
        accounted: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DealFunded: DealFunded,
        DealFilled: DealFilled,
        DealClaimed: DealClaimed,
        DealTimedOut: DealTimedOut,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DealFunded {
        #[key]
        pub deal_id: felt252,
        pub leg_a_token: ContractAddress,
        pub leg_a_amount: u128,
        pub leg_b_token: ContractAddress,
        pub leg_b_terms: u128,
        pub deadline: u64,
        pub claim_pubkey: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DealFilled {
        #[key]
        pub deal_id: felt252,
        pub leg_a_token: ContractAddress,
        pub leg_a_amount: u128,
        pub leg_b_token: ContractAddress,
        pub leg_b_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DealClaimed {
        #[key]
        pub deal_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DealTimedOut {
        #[key]
        pub deal_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl QuietlineEscrowImpl of IQuietlineEscrow<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: EscrowOperation,
            deal_id: felt252,
            pool_address: ContractAddress,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // This argument is a wallet placeholder only; authorization uses constructor storage.
            let _pool_placeholder = pool_address;
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::BAD_POOL);

            match operation {
                EscrowOperation::Fund(params) => fund(ref self, deal_id, params),
                EscrowOperation::Fill(params) => fill(ref self, deal_id, note_id, params, pool),
                EscrowOperation::Claim(params) => claim(ref self, deal_id, note_id, params, pool),
                EscrowOperation::Timeout(params) => {
                    timeout(ref self, deal_id, note_id, params, pool)
                },
            }
        }

        fn get_deal(self: @ContractState, deal_id: felt252) -> Deal {
            self.deals.entry(deal_id).read()
        }

        fn compute_claim_message(
            self: @ContractState, deal_id: felt252, operation: PayoutOperation, note_id: felt252,
        ) -> felt252 {
            claim_message(deal_id, operation_felt(operation), note_id)
        }
    }

    fn fund(
        ref self: ContractState, deal_id: felt252, params: FundParams,
    ) -> Span<OpenNoteDeposit> {
        assert(deal_id.is_non_zero(), errors::ZERO_DEAL_ID);
        assert(params.token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.counter_token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.token != params.counter_token, errors::SAME_TOKEN);
        assert(params.counter_amount.is_non_zero(), errors::ZERO_AMOUNT);
        assert(params.claim_pubkey.is_non_zero(), errors::ZERO_CLAIM_PUBKEY);
        assert(params.deadline > get_block_timestamp(), errors::DEADLINE_NOT_FUTURE);

        let existing = self.deals.entry(deal_id).read();
        assert(existing.status == DealStatus::Empty, errors::DEAL_EXISTS);

        let token = IErc20Dispatcher { contract_address: params.token };
        let balance = token.balance_of(get_contract_address());
        let previous = self.accounted.entry(params.token).read();
        assert(balance >= previous, errors::BALANCE_DEFICIT);
        let received_u256 = balance - previous;
        let received: u128 = received_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        assert(received.is_non_zero(), errors::ZERO_AMOUNT);

        let new_accounted = previous + received_u256;
        assert(new_accounted == balance, errors::CONSERVATION_FAILURE);
        self.accounted.entry(params.token).write(new_accounted);
        self
            .deals
            .entry(deal_id)
            .write(
                Deal {
                    leg_a_token: params.token,
                    leg_a_amount: received,
                    leg_b_token: params.counter_token,
                    leg_b_terms: params.counter_amount,
                    leg_b_amount: 0,
                    deadline: params.deadline,
                    claim_pubkey: params.claim_pubkey,
                    status: DealStatus::Funded,
                },
            );
        self
            .emit(
                DealFunded {
                    deal_id,
                    leg_a_token: params.token,
                    leg_a_amount: received,
                    leg_b_token: params.counter_token,
                    leg_b_terms: params.counter_amount,
                    deadline: params.deadline,
                    claim_pubkey: params.claim_pubkey,
                },
            );

        array![].span()
    }

    fn fill(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        params: FillParams,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut deal = self.deals.entry(deal_id).read();
        assert(deal.status == DealStatus::Funded, errors::BAD_STATE);
        assert(get_block_timestamp() < deal.deadline, errors::DEAL_EXPIRED);
        assert(params.token == deal.leg_b_token, errors::WRONG_TOKEN);

        let contract_address = get_contract_address();
        let leg_a = IErc20Dispatcher { contract_address: deal.leg_a_token };
        let leg_b = IErc20Dispatcher { contract_address: deal.leg_b_token };

        let leg_a_balance = leg_a.balance_of(contract_address);
        let leg_a_accounted = self.accounted.entry(deal.leg_a_token).read();
        assert(leg_a_balance >= leg_a_accounted, errors::BALANCE_DEFICIT);
        assert(leg_a_accounted >= deal.leg_a_amount.into(), errors::CONSERVATION_FAILURE);
        let leg_a_dust = leg_a_balance - leg_a_accounted;
        let leg_a_payout_u256: u256 = deal.leg_a_amount.into() + leg_a_dust;
        let leg_a_payout: u128 = leg_a_payout_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        let leg_a_after = leg_a_balance - leg_a_payout_u256;
        let expected_leg_a_after = leg_a_accounted - deal.leg_a_amount.into();
        assert(leg_a_after == expected_leg_a_after, errors::CONSERVATION_FAILURE);

        let leg_b_balance = leg_b.balance_of(contract_address);
        let leg_b_accounted = self.accounted.entry(deal.leg_b_token).read();
        assert(leg_b_balance >= leg_b_accounted, errors::BALANCE_DEFICIT);
        let received_u256 = leg_b_balance - leg_b_accounted;
        assert(received_u256 >= deal.leg_b_terms.into(), errors::SHORT_FILL);
        let received: u128 = received_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        let new_leg_b_accounted = leg_b_accounted + received_u256;
        assert(new_leg_b_accounted == leg_b_balance, errors::CONSERVATION_FAILURE);

        // Effects precede the external approval. A failed approval reverts the whole transition.
        self.accounted.entry(deal.leg_a_token).write(leg_a_after);
        self.accounted.entry(deal.leg_b_token).write(new_leg_b_accounted);
        deal.leg_b_amount = received;
        deal.status = DealStatus::Filled;
        self.deals.entry(deal_id).write(deal);

        assert(leg_a.approve(pool, leg_a_payout_u256), errors::APPROVE_FAILED);
        self
            .emit(
                DealFilled {
                    deal_id,
                    leg_a_token: deal.leg_a_token,
                    leg_a_amount: leg_a_payout,
                    leg_b_token: deal.leg_b_token,
                    leg_b_amount: received,
                },
            );

        array![OpenNoteDeposit { note_id, token: deal.leg_a_token, amount: leg_a_payout }].span()
    }

    fn claim(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        params: ClaimParams,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut deal = self.deals.entry(deal_id).read();
        assert(deal.status == DealStatus::Filled, errors::BAD_STATE);
        assert(
            check_ecdsa_signature(
                claim_message(deal_id, CLAIM_OPERATION, note_id),
                deal.claim_pubkey,
                params.sig_r,
                params.sig_s,
            ),
            errors::BAD_SIGNATURE,
        );

        let token = IErc20Dispatcher { contract_address: deal.leg_b_token };
        let balance = token.balance_of(get_contract_address());
        let accounted = self.accounted.entry(deal.leg_b_token).read();
        assert(balance >= accounted, errors::BALANCE_DEFICIT);
        assert(accounted >= deal.leg_b_amount.into(), errors::CONSERVATION_FAILURE);
        let dust = balance - accounted;
        let payout_u256: u256 = deal.leg_b_amount.into() + dust;
        let payout: u128 = payout_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        let after = balance - payout_u256;
        let expected_after = accounted - deal.leg_b_amount.into();
        assert(after == expected_after, errors::CONSERVATION_FAILURE);

        self.accounted.entry(deal.leg_b_token).write(after);
        deal.status = DealStatus::Settled;
        self.deals.entry(deal_id).write(deal);

        assert(token.approve(pool, payout_u256), errors::APPROVE_FAILED);
        self.emit(DealClaimed { deal_id, token: deal.leg_b_token, amount: payout });

        array![OpenNoteDeposit { note_id, token: deal.leg_b_token, amount: payout }].span()
    }

    fn timeout(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        params: TimeoutParams,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut deal = self.deals.entry(deal_id).read();
        assert(deal.status == DealStatus::Funded, errors::BAD_STATE);
        assert(get_block_timestamp() >= deal.deadline, errors::DEAL_NOT_EXPIRED);
        assert(
            check_ecdsa_signature(
                claim_message(deal_id, TIMEOUT_OPERATION, note_id),
                deal.claim_pubkey,
                params.sig_r,
                params.sig_s,
            ),
            errors::BAD_SIGNATURE,
        );

        let token = IErc20Dispatcher { contract_address: deal.leg_a_token };
        let balance = token.balance_of(get_contract_address());
        let accounted = self.accounted.entry(deal.leg_a_token).read();
        assert(balance >= accounted, errors::BALANCE_DEFICIT);
        assert(accounted >= deal.leg_a_amount.into(), errors::CONSERVATION_FAILURE);
        let dust = balance - accounted;
        let payout_u256: u256 = deal.leg_a_amount.into() + dust;
        let payout: u128 = payout_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        let after = balance - payout_u256;
        let expected_after = accounted - deal.leg_a_amount.into();
        assert(after == expected_after, errors::CONSERVATION_FAILURE);

        self.accounted.entry(deal.leg_a_token).write(after);
        deal.status = DealStatus::TimedOut;
        self.deals.entry(deal_id).write(deal);

        assert(token.approve(pool, payout_u256), errors::APPROVE_FAILED);
        self.emit(DealTimedOut { deal_id, token: deal.leg_a_token, amount: payout });

        array![OpenNoteDeposit { note_id, token: deal.leg_a_token, amount: payout }].span()
    }

    fn operation_felt(operation: PayoutOperation) -> felt252 {
        match operation {
            PayoutOperation::Claim => CLAIM_OPERATION,
            PayoutOperation::Timeout => TIMEOUT_OPERATION,
        }
    }

    fn claim_message(deal_id: felt252, operation: felt252, note_id: felt252) -> felt252 {
        let contract_address: felt252 = get_contract_address().into();
        core::poseidon::poseidon_hash_span(
            [ESCROW_CLAIM_TAG, contract_address, deal_id, operation, note_id].span(),
        )
    }
}
