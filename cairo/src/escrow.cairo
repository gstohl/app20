use starknet::ContractAddress;
use crate::OpenNoteDeposit;

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct FundParams {
    pub token: ContractAddress,
    pub counter_token: ContractAddress,
    pub counter_amount: u128,
    pub deadline: u64,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct FillParams {
    pub token: ContractAddress,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum EscrowOperation {
    Fund: FundParams,
    Fill: FillParams,
    Claim,
    Timeout,
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
    pub ticket: ContractAddress,
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
    fn ensure_ticket(ref self: TState, deal_id: felt252) -> ContractAddress;
    fn get_ticket(self: @TState, deal_id: felt252) -> ContractAddress;
    fn get_deal(self: @TState, deal_id: felt252) -> Deal;
}

#[starknet::contract]
pub mod QuietlineEscrow {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::syscalls::deploy_syscall;
    use starknet::{
        ClassHash, ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use crate::{IErc20Dispatcher, IErc20DispatcherTrait};
    use crate::claim_ticket::{IClaimTicketDispatcher, IClaimTicketDispatcherTrait};
    use super::{
        Deal, DealStatus, EscrowOperation, FillParams, FundParams, IQuietlineEscrow,
        OpenNoteDeposit,
    };

    mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const ZERO_DEAL_ID: felt252 = 'ZERO_DEAL_ID';
        pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
        pub const SAME_TOKEN: felt252 = 'SAME_TOKEN';
        pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
        pub const DEADLINE_NOT_FUTURE: felt252 = 'DEADLINE_NOT_FUTURE';
        pub const DEAL_EXISTS: felt252 = 'DEAL_EXISTS';
        pub const BAD_STATE: felt252 = 'BAD_STATE';
        pub const DEAL_EXPIRED: felt252 = 'DEAL_EXPIRED';
        pub const DEAL_NOT_EXPIRED: felt252 = 'DEAL_NOT_EXPIRED';
        pub const WRONG_TOKEN: felt252 = 'WRONG_TOKEN';
        pub const SHORT_FILL: felt252 = 'SHORT_FILL';
        pub const BAD_TICKET: felt252 = 'BAD_TICKET';
        pub const BALANCE_DEFICIT: felt252 = 'BALANCE_DEFICIT';
        pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
        pub const CONSERVATION_FAILURE: felt252 = 'CONSERVATION_FAILURE';
        pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        ticket_class_hash: ClassHash,
        deals: Map<felt252, Deal>,
        tickets: Map<felt252, ContractAddress>,
        // Expected balances after the pool applies returned deposits.
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
        pub ticket: ContractAddress,
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
    fn constructor(ref self: ContractState, pool: ContractAddress, ticket_class_hash: ClassHash) {
        self.pool.write(pool);
        self.ticket_class_hash.write(ticket_class_hash);
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
            let _pool_placeholder = pool_address;
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::BAD_POOL);

            match operation {
                EscrowOperation::Fund(params) => fund(ref self, deal_id, note_id, params, pool),
                EscrowOperation::Fill(params) => fill(ref self, deal_id, note_id, params, pool),
                EscrowOperation::Claim => claim(ref self, deal_id, note_id, pool),
                EscrowOperation::Timeout => timeout(ref self, deal_id, note_id, pool),
            }
        }

        fn ensure_ticket(ref self: ContractState, deal_id: felt252) -> ContractAddress {
            ensure_ticket_internal(ref self, deal_id)
        }

        fn get_ticket(self: @ContractState, deal_id: felt252) -> ContractAddress {
            self.tickets.entry(deal_id).read()
        }

        fn get_deal(self: @ContractState, deal_id: felt252) -> Deal {
            self.deals.entry(deal_id).read()
        }
    }

    fn ensure_ticket_internal(ref self: ContractState, deal_id: felt252) -> ContractAddress {
        assert(deal_id.is_non_zero(), errors::ZERO_DEAL_ID);
        let existing = self.tickets.entry(deal_id).read();
        if existing.is_non_zero() {
            return existing;
        }
        let mut calldata = array![get_contract_address().into(), self.pool.read().into(), deal_id];
        let (ticket, _) = deploy_syscall(
            self.ticket_class_hash.read(), deal_id, calldata.span(), false,
        )
            .unwrap_syscall();
        self.tickets.entry(deal_id).write(ticket);
        ticket
    }

    fn fund(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        params: FundParams,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        assert(deal_id.is_non_zero(), errors::ZERO_DEAL_ID);
        assert(params.token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.counter_token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.token != params.counter_token, errors::SAME_TOKEN);
        assert(params.counter_amount.is_non_zero(), errors::ZERO_AMOUNT);
        assert(params.deadline > get_block_timestamp(), errors::DEADLINE_NOT_FUTURE);
        assert(self.deals.entry(deal_id).read().status == DealStatus::Empty, errors::DEAL_EXISTS);

        let ticket_address = ensure_ticket_internal(ref self, deal_id);
        let token = IErc20Dispatcher { contract_address: params.token };
        let balance = token.balance_of(get_contract_address());
        let previous = self.accounted.entry(params.token).read();
        assert(balance >= previous, errors::BALANCE_DEFICIT);
        let received_u256 = balance - previous;
        let received: u128 = received_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        assert(received.is_non_zero(), errors::ZERO_AMOUNT);

        self.accounted.entry(params.token).write(balance);
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
                    ticket: ticket_address,
                    status: DealStatus::Funded,
                },
            );

        let ticket = IClaimTicketDispatcher { contract_address: ticket_address };
        ticket.mint();
        assert(ticket.approve(pool, 1), errors::APPROVE_FAILED);
        self
            .emit(
                DealFunded {
                    deal_id,
                    leg_a_token: params.token,
                    leg_a_amount: received,
                    leg_b_token: params.counter_token,
                    leg_b_terms: params.counter_amount,
                    deadline: params.deadline,
                    ticket: ticket_address,
                },
            );
        array![OpenNoteDeposit { note_id, token: ticket_address, amount: 1 }].span()
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
        let leg_a_after = leg_a_balance - deal.leg_a_amount.into();

        let leg_b_balance = leg_b.balance_of(contract_address);
        let leg_b_accounted = self.accounted.entry(deal.leg_b_token).read();
        assert(leg_b_balance >= leg_b_accounted, errors::BALANCE_DEFICIT);
        let received_u256 = leg_b_balance - leg_b_accounted;
        assert(received_u256 >= deal.leg_b_terms.into(), errors::SHORT_FILL);
        let received: u128 = received_u256.try_into().expect(errors::AMOUNT_OVERFLOW);

        self.accounted.entry(deal.leg_a_token).write(leg_a_after);
        self.accounted.entry(deal.leg_b_token).write(leg_b_balance);
        deal.leg_b_amount = received;
        deal.status = DealStatus::Filled;
        self.deals.entry(deal_id).write(deal);

        assert(leg_a.approve(pool, deal.leg_a_amount.into()), errors::APPROVE_FAILED);
        self
            .emit(
                DealFilled {
                    deal_id,
                    leg_a_token: deal.leg_a_token,
                    leg_a_amount: deal.leg_a_amount,
                    leg_b_token: deal.leg_b_token,
                    leg_b_amount: received,
                },
            );
        array![
            OpenNoteDeposit { note_id, token: deal.leg_a_token, amount: deal.leg_a_amount },
        ]
            .span()
    }

    fn consume_ticket(ref self: ContractState, deal: Deal) {
        let ticket = IClaimTicketDispatcher { contract_address: deal.ticket };
        let balance = ticket.balance_of(get_contract_address());
        let accounted = self.accounted.entry(deal.ticket).read();
        assert(balance >= accounted, errors::BAD_TICKET);
        assert(balance - accounted == 1, errors::BAD_TICKET);
        ticket.burn();
        assert(ticket.balance_of(get_contract_address()) == accounted, errors::BAD_TICKET);
        self.accounted.entry(deal.ticket).write(accounted);
    }

    fn claim(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut deal = self.deals.entry(deal_id).read();
        assert(deal.status == DealStatus::Filled, errors::BAD_STATE);
        consume_ticket(ref self, deal);

        let token = IErc20Dispatcher { contract_address: deal.leg_b_token };
        let balance = token.balance_of(get_contract_address());
        let accounted = self.accounted.entry(deal.leg_b_token).read();
        assert(balance >= accounted, errors::BALANCE_DEFICIT);
        assert(accounted >= deal.leg_b_amount.into(), errors::CONSERVATION_FAILURE);
        let after = balance - deal.leg_b_amount.into();
        self.accounted.entry(deal.leg_b_token).write(after);
        deal.status = DealStatus::Settled;
        self.deals.entry(deal_id).write(deal);

        assert(token.approve(pool, deal.leg_b_amount.into()), errors::APPROVE_FAILED);
        self
            .emit(
                DealClaimed {
                    deal_id, token: deal.leg_b_token, amount: deal.leg_b_amount,
                },
            );
        array![
            OpenNoteDeposit { note_id, token: deal.leg_b_token, amount: deal.leg_b_amount },
        ]
            .span()
    }

    fn timeout(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut deal = self.deals.entry(deal_id).read();
        assert(deal.status == DealStatus::Funded, errors::BAD_STATE);
        assert(get_block_timestamp() >= deal.deadline, errors::DEAL_NOT_EXPIRED);
        consume_ticket(ref self, deal);

        let token = IErc20Dispatcher { contract_address: deal.leg_a_token };
        let balance = token.balance_of(get_contract_address());
        let accounted = self.accounted.entry(deal.leg_a_token).read();
        assert(balance >= accounted, errors::BALANCE_DEFICIT);
        assert(accounted >= deal.leg_a_amount.into(), errors::CONSERVATION_FAILURE);
        let after = balance - deal.leg_a_amount.into();
        self.accounted.entry(deal.leg_a_token).write(after);
        deal.status = DealStatus::TimedOut;
        self.deals.entry(deal_id).write(deal);

        assert(token.approve(pool, deal.leg_a_amount.into()), errors::APPROVE_FAILED);
        self
            .emit(
                DealTimedOut {
                    deal_id, token: deal.leg_a_token, amount: deal.leg_a_amount,
                },
            );
        array![
            OpenNoteDeposit { note_id, token: deal.leg_a_token, amount: deal.leg_a_amount },
        ]
            .span()
    }
}
