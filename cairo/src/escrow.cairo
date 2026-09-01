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
pub struct LockParams {
    pub token: ContractAddress,
    pub counter_token: ContractAddress,
    pub rfq_id: felt252,
    pub taker_commitment: felt252,
    pub expiry: u64,
    pub points_len: u8,
    pub p0_a: u128,
    pub p0_b: u128,
    pub p1_a: u128,
    pub p1_b: u128,
    pub p2_a: u128,
    pub p2_b: u128,
    pub p3_a: u128,
    pub p3_b: u128,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct TakeFill {
    pub lock_id: felt252,
    pub amount_a: u128,
}

#[derive(Serde, Drop, PartialEq, Debug)]
pub struct TakeParams {
    pub token: ContractAddress,
    pub counter_token: ContractAddress,
    pub taker_secret: felt252,
    pub fills: Array<TakeFill>,
}

#[derive(Serde, Drop, PartialEq, Debug)]
pub enum EscrowOperation {
    Fund: FundParams,
    Fill: FillParams,
    Claim,
    Timeout,
    Lock: LockParams,
    Take: TakeParams,
    SettleProceeds,
    ReleaseCollateral,
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

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum LockStatus {
    #[default]
    Empty,
    Open,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Lock {
    pub token_a: ContractAddress,
    pub token_b: ContractAddress,
    pub rfq_id: felt252,
    pub taker_commitment: felt252,
    pub expiry: u64,
    pub points_len: u8,
    pub p0_a: u128,
    pub p0_b: u128,
    pub p1_a: u128,
    pub p1_b: u128,
    pub p2_a: u128,
    pub p2_b: u128,
    pub p3_a: u128,
    pub p3_b: u128,
    pub remaining_b: u128,
    pub earned_a: u128,
    pub ticket: ContractAddress,
    pub proceeds_settled: bool,
    pub collateral_released: bool,
    pub status: LockStatus,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct TakeRecord {
    pub token_a: ContractAddress,
    pub total_a: u128,
    pub token_b: ContractAddress,
    pub total_b: u128,
    pub fill_count: u8,
    pub taken_at: u64,
}

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
    pub const EXCESS_FILL: felt252 = 'EXCESS_FILL';
    pub const BAD_TICKET: felt252 = 'BAD_TICKET';
    pub const BALANCE_DEFICIT: felt252 = 'BALANCE_DEFICIT';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
    pub const CONSERVATION_FAILURE: felt252 = 'CONSERVATION_FAILURE';
    pub const APPROVE_FAILED: felt252 = 'APPROVE_FAILED';
    pub const LOCK_EXISTS: felt252 = 'LOCK_EXISTS';
    pub const LOCK_NOT_OPEN: felt252 = 'LOCK_NOT_OPEN';
    pub const LOCK_EXPIRED: felt252 = 'LOCK_EXPIRED';
    pub const LOCK_NOT_EXPIRED: felt252 = 'LOCK_NOT_EXPIRED';
    pub const BAD_SCHEDULE: felt252 = 'BAD_SCHEDULE';
    pub const OUT_OF_SCHEDULE: felt252 = 'OUT_OF_SCHEDULE';
    pub const BAD_COMMITMENT: felt252 = 'BAD_COMMITMENT';
    pub const WRONG_RFQ: felt252 = 'WRONG_RFQ';
    pub const TOO_MANY_FILLS: felt252 = 'TOO_MANY_FILLS';
    pub const NO_FILLS: felt252 = 'NO_FILLS';
    pub const DUPLICATE_LOCK: felt252 = 'DUPLICATE_LOCK';
    pub const INSUFFICIENT_LOCK: felt252 = 'INSUFFICIENT_LOCK';
    pub const TAKE_EXISTS: felt252 = 'TAKE_EXISTS';
    pub const ALREADY_SETTLED: felt252 = 'ALREADY_SETTLED';
    pub const NOTHING_TO_SETTLE: felt252 = 'NOTHING_TO_SETTLE';
    pub const BAD_LOCK_AMOUNT: felt252 = 'BAD_LOCK_AMOUNT';
}

fn assert_schedule(
    points_len: u8,
    p0_a: u128,
    p0_b: u128,
    p1_a: u128,
    p1_b: u128,
    p2_a: u128,
    p2_b: u128,
    p3_a: u128,
    p3_b: u128,
) {
    assert(points_len >= 1 && points_len <= 4, errors::BAD_SCHEDULE);
    assert(p0_a > 0 && p0_b > 0, errors::BAD_SCHEDULE);
    if points_len >= 2 {
        assert(p1_a > p0_a && p1_b > 0 && p1_b >= p0_b, errors::BAD_SCHEDULE);
    }
    if points_len >= 3 {
        assert(p2_a > p1_a && p2_b > 0 && p2_b >= p1_b, errors::BAD_SCHEDULE);
    }
    if points_len == 4 {
        assert(p3_a > p2_a && p3_b > 0 && p3_b >= p2_b, errors::BAD_SCHEDULE);
    }
}

fn interpolate(left_a: u128, left_b: u128, right_a: u128, right_b: u128, amount_a: u128) -> u128 {
    let offset: u256 = (amount_a - left_a).into();
    let rise: u256 = (right_b - left_b).into();
    let width: u256 = (right_a - left_a).into();
    let base: u256 = left_b.into();
    (base + offset * rise / width).try_into().expect(errors::AMOUNT_OVERFLOW)
}

pub fn evaluate_schedule(
    points_len: u8,
    p0_a: u128,
    p0_b: u128,
    p1_a: u128,
    p1_b: u128,
    p2_a: u128,
    p2_b: u128,
    p3_a: u128,
    p3_b: u128,
    amount_a: u128,
) -> u128 {
    assert_schedule(points_len, p0_a, p0_b, p1_a, p1_b, p2_a, p2_b, p3_a, p3_b);
    let max_a = if points_len == 1 {
        p0_a
    } else if points_len == 2 {
        p1_a
    } else if points_len == 3 {
        p2_a
    } else {
        p3_a
    };
    assert(amount_a >= p0_a && amount_a <= max_a, errors::OUT_OF_SCHEDULE);
    if points_len == 1 {
        return p0_b;
    }
    if amount_a <= p1_a {
        return interpolate(p0_a, p0_b, p1_a, p1_b, amount_a);
    }
    assert(points_len >= 3, errors::OUT_OF_SCHEDULE);
    if amount_a <= p2_a {
        return interpolate(p1_a, p1_b, p2_a, p2_b, amount_a);
    }
    assert(points_len == 4, errors::OUT_OF_SCHEDULE);
    interpolate(p2_a, p2_b, p3_a, p3_b, amount_a)
}

fn schedule_max_b(points_len: u8, p0_b: u128, p1_b: u128, p2_b: u128, p3_b: u128) -> u128 {
    if points_len == 1 {
        p0_b
    } else if points_len == 2 {
        p1_b
    } else if points_len == 3 {
        p2_b
    } else {
        p3_b
    }
}

#[starknet::interface]
pub trait IApp20Escrow<TState> {
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
    fn ensure_lock_ticket(ref self: TState, lock_id: felt252) -> ContractAddress;
    fn get_lock_ticket(self: @TState, lock_id: felt252) -> ContractAddress;
    fn get_lock(self: @TState, lock_id: felt252) -> Lock;
    fn get_take(self: @TState, deal_id: felt252) -> TakeRecord;
    fn quote_schedule(self: @TState, lock_id: felt252, amount_a: u128) -> u128;
}

#[starknet::contract]
pub mod App20Escrow {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::syscalls::deploy_syscall;
    use starknet::{
        ClassHash, ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use crate::claim_ticket::{IClaimTicketDispatcher, IClaimTicketDispatcherTrait};
    use crate::lock_ticket::{ILockTicketDispatcher, ILockTicketDispatcherTrait};
    use crate::{IErc20Dispatcher, IErc20DispatcherTrait};
    use super::{
        Deal, DealStatus, EscrowOperation, FillParams, FundParams, IApp20Escrow, Lock, LockParams,
        LockStatus, OpenNoteDeposit, TakeParams, TakeRecord, errors, evaluate_schedule,
        schedule_max_b,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        ticket_class_hash: ClassHash,
        deals: Map<felt252, Deal>,
        tickets: Map<felt252, ContractAddress>,
        // Expected balances after the pool applies returned deposits.
        accounted: Map<ContractAddress, u256>,
        lock_ticket_class_hash: ClassHash,
        lock_tickets: Map<felt252, ContractAddress>,
        locks: Map<felt252, Lock>,
        takes: Map<felt252, TakeRecord>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DealFunded: DealFunded,
        DealFilled: DealFilled,
        DealClaimed: DealClaimed,
        DealTimedOut: DealTimedOut,
        LockCreated: LockCreated,
        LockTaken: LockTaken,
        DealTaken: DealTaken,
        LockProceedsSettled: LockProceedsSettled,
        LockCollateralReleased: LockCollateralReleased,
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

    #[derive(Drop, starknet::Event)]
    pub struct LockCreated {
        #[key]
        pub lock_id: felt252,
        #[key]
        pub rfq_id: felt252,
        pub token_a: ContractAddress,
        pub token_b: ContractAddress,
        pub expiry: u64,
        pub max_b: u128,
        pub points_len: u8,
        pub p0_a: u128,
        pub p0_b: u128,
        pub p1_a: u128,
        pub p1_b: u128,
        pub p2_a: u128,
        pub p2_b: u128,
        pub p3_a: u128,
        pub p3_b: u128,
        pub ticket: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LockTaken {
        #[key]
        pub lock_id: felt252,
        #[key]
        pub deal_id: felt252,
        pub amount_a: u128,
        pub amount_b: u128,
        pub remaining_b: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DealTaken {
        #[key]
        pub deal_id: felt252,
        pub token_a: ContractAddress,
        pub total_a: u128,
        pub token_b: ContractAddress,
        pub total_b: u128,
        pub fill_count: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LockProceedsSettled {
        #[key]
        pub lock_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LockCollateralReleased {
        #[key]
        pub lock_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        ticket_class_hash: ClassHash,
        lock_ticket_class_hash: ClassHash,
    ) {
        self.pool.write(pool);
        self.ticket_class_hash.write(ticket_class_hash);
        self.lock_ticket_class_hash.write(lock_ticket_class_hash);
    }

    #[abi(embed_v0)]
    impl App20EscrowImpl of IApp20Escrow<ContractState> {
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
                EscrowOperation::Lock(params) => lock(ref self, deal_id, note_id, params, pool),
                EscrowOperation::Take(params) => take(ref self, deal_id, note_id, params, pool),
                EscrowOperation::SettleProceeds => {
                    settle_proceeds(ref self, deal_id, note_id, pool)
                },
                EscrowOperation::ReleaseCollateral => {
                    release_collateral(ref self, deal_id, note_id, pool)
                },
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

        fn ensure_lock_ticket(ref self: ContractState, lock_id: felt252) -> ContractAddress {
            ensure_lock_ticket_internal(ref self, lock_id)
        }

        fn get_lock_ticket(self: @ContractState, lock_id: felt252) -> ContractAddress {
            self.lock_tickets.entry(lock_id).read()
        }

        fn get_lock(self: @ContractState, lock_id: felt252) -> Lock {
            self.locks.entry(lock_id).read()
        }

        fn get_take(self: @ContractState, deal_id: felt252) -> TakeRecord {
            self.takes.entry(deal_id).read()
        }

        fn quote_schedule(self: @ContractState, lock_id: felt252, amount_a: u128) -> u128 {
            let lock = self.locks.entry(lock_id).read();
            assert(lock.status == LockStatus::Open, errors::LOCK_NOT_OPEN);
            evaluate_lock_schedule(lock, amount_a)
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

    fn ensure_lock_ticket_internal(ref self: ContractState, lock_id: felt252) -> ContractAddress {
        assert(lock_id.is_non_zero(), errors::ZERO_DEAL_ID);
        let existing = self.lock_tickets.entry(lock_id).read();
        if existing.is_non_zero() {
            return existing;
        }
        let mut calldata = array![get_contract_address().into(), self.pool.read().into(), lock_id];
        let (ticket, _) = deploy_syscall(
            self.lock_ticket_class_hash.read(), lock_id, calldata.span(), false,
        )
            .unwrap_syscall();
        self.lock_tickets.entry(lock_id).write(ticket);
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
        let expected: u256 = deal.leg_b_terms.into();
        assert(received_u256 >= expected, errors::SHORT_FILL);
        assert(received_u256 == expected, errors::EXCESS_FILL);
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
        array![OpenNoteDeposit { note_id, token: deal.leg_a_token, amount: deal.leg_a_amount }]
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
    }

    fn claim(
        ref self: ContractState, deal_id: felt252, note_id: felt252, pool: ContractAddress,
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
        self.emit(DealClaimed { deal_id, token: deal.leg_b_token, amount: deal.leg_b_amount });
        array![OpenNoteDeposit { note_id, token: deal.leg_b_token, amount: deal.leg_b_amount }]
            .span()
    }

    fn timeout(
        ref self: ContractState, deal_id: felt252, note_id: felt252, pool: ContractAddress,
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
        self.emit(DealTimedOut { deal_id, token: deal.leg_a_token, amount: deal.leg_a_amount });
        array![OpenNoteDeposit { note_id, token: deal.leg_a_token, amount: deal.leg_a_amount }]
            .span()
    }

    fn lock(
        ref self: ContractState,
        lock_id: felt252,
        note_id: felt252,
        params: LockParams,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        assert(lock_id.is_non_zero(), errors::ZERO_DEAL_ID);
        assert(self.locks.entry(lock_id).read().status == LockStatus::Empty, errors::LOCK_EXISTS);
        assert(params.token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.counter_token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.token != params.counter_token, errors::SAME_TOKEN);
        assert(params.expiry > get_block_timestamp(), errors::DEADLINE_NOT_FUTURE);
        let _minimum = evaluate_schedule(
            params.points_len,
            params.p0_a,
            params.p0_b,
            params.p1_a,
            params.p1_b,
            params.p2_a,
            params.p2_b,
            params.p3_a,
            params.p3_b,
            params.p0_a,
        );
        let max_b = schedule_max_b(
            params.points_len, params.p0_b, params.p1_b, params.p2_b, params.p3_b,
        );

        let ticket_address = ensure_lock_ticket_internal(ref self, lock_id);
        let token = IErc20Dispatcher { contract_address: params.token };
        let balance = token.balance_of(get_contract_address());
        let previous = self.accounted.entry(params.token).read();
        assert(balance >= previous, errors::BALANCE_DEFICIT);
        let received_u256 = balance - previous;
        assert(received_u256 == max_b.into(), errors::BAD_LOCK_AMOUNT);
        let received: u128 = received_u256.try_into().expect(errors::AMOUNT_OVERFLOW);

        self.accounted.entry(params.token).write(balance);
        self
            .locks
            .entry(lock_id)
            .write(
                Lock {
                    token_a: params.counter_token,
                    token_b: params.token,
                    rfq_id: params.rfq_id,
                    taker_commitment: params.taker_commitment,
                    expiry: params.expiry,
                    points_len: params.points_len,
                    p0_a: params.p0_a,
                    p0_b: params.p0_b,
                    p1_a: params.p1_a,
                    p1_b: params.p1_b,
                    p2_a: params.p2_a,
                    p2_b: params.p2_b,
                    p3_a: params.p3_a,
                    p3_b: params.p3_b,
                    remaining_b: received,
                    earned_a: 0,
                    ticket: ticket_address,
                    proceeds_settled: false,
                    collateral_released: false,
                    status: LockStatus::Open,
                },
            );

        let ticket = ILockTicketDispatcher { contract_address: ticket_address };
        ticket.mint();
        assert(ticket.approve(pool, 2), errors::APPROVE_FAILED);
        self
            .emit(
                LockCreated {
                    lock_id,
                    rfq_id: params.rfq_id,
                    token_a: params.counter_token,
                    token_b: params.token,
                    expiry: params.expiry,
                    max_b,
                    points_len: params.points_len,
                    p0_a: params.p0_a,
                    p0_b: params.p0_b,
                    p1_a: params.p1_a,
                    p1_b: params.p1_b,
                    p2_a: params.p2_a,
                    p2_b: params.p2_b,
                    p3_a: params.p3_a,
                    p3_b: params.p3_b,
                    ticket: ticket_address,
                },
            );
        array![OpenNoteDeposit { note_id, token: ticket_address, amount: 2 }].span()
    }

    fn evaluate_lock_schedule(lock: Lock, amount_a: u128) -> u128 {
        evaluate_schedule(
            lock.points_len,
            lock.p0_a,
            lock.p0_b,
            lock.p1_a,
            lock.p1_b,
            lock.p2_a,
            lock.p2_b,
            lock.p3_a,
            lock.p3_b,
            amount_a,
        )
    }

    fn assert_distinct_fills(params: @TakeParams) {
        let fills = params.fills.span();
        let mut i = 0;
        while i < fills.len() {
            let mut j = i + 1;
            while j < fills.len() {
                assert(fills.at(i).lock_id != fills.at(j).lock_id, errors::DUPLICATE_LOCK);
                j += 1;
            }
            i += 1;
        };
    }

    fn take(
        ref self: ContractState,
        deal_id: felt252,
        note_id: felt252,
        params: TakeParams,
        pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        assert(deal_id.is_non_zero(), errors::ZERO_DEAL_ID);
        assert(self.takes.entry(deal_id).read().fill_count == 0, errors::TAKE_EXISTS);
        let fill_count = params.fills.len();
        assert(fill_count > 0, errors::NO_FILLS);
        assert(fill_count <= 4, errors::TOO_MANY_FILLS);
        assert_distinct_fills(@params);
        assert(params.token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.counter_token.is_non_zero(), errors::ZERO_TOKEN);
        assert(params.token != params.counter_token, errors::SAME_TOKEN);

        let mut expected_a: u256 = 0;
        for fill_ref in params.fills.span() {
            let fill = *fill_ref;
            expected_a += fill.amount_a.into();
        }
        let token_a = IErc20Dispatcher { contract_address: params.token };
        let balance_a = token_a.balance_of(get_contract_address());
        let accounted_a = self.accounted.entry(params.token).read();
        assert(balance_a >= accounted_a, errors::BALANCE_DEFICIT);
        let received_a = balance_a - accounted_a;
        assert(received_a >= expected_a, errors::SHORT_FILL);
        assert(received_a == expected_a, errors::EXCESS_FILL);

        let commitment = poseidon_hash_span(array![params.taker_secret].span());
        let mut total_b_u256: u256 = 0;
        for fill_ref in params.fills.span() {
            let fill = *fill_ref;
            let mut existing_lock = self.locks.entry(fill.lock_id).read();
            assert(existing_lock.status == LockStatus::Open, errors::LOCK_NOT_OPEN);
            assert(get_block_timestamp() < existing_lock.expiry, errors::LOCK_EXPIRED);
            assert(existing_lock.rfq_id == deal_id, errors::WRONG_RFQ);
            assert(
                existing_lock.token_a == params.token
                    && existing_lock.token_b == params.counter_token,
                errors::WRONG_TOKEN,
            );
            assert(commitment == existing_lock.taker_commitment, errors::BAD_COMMITMENT);
            let amount_b = evaluate_lock_schedule(existing_lock, fill.amount_a);
            assert(existing_lock.remaining_b >= amount_b, errors::INSUFFICIENT_LOCK);
            existing_lock.remaining_b -= amount_b;
            let earned: u256 = existing_lock.earned_a.into() + fill.amount_a.into();
            existing_lock.earned_a = earned.try_into().expect(errors::AMOUNT_OVERFLOW);
            self.locks.entry(fill.lock_id).write(existing_lock);
            total_b_u256 += amount_b.into();
            self
                .emit(
                    LockTaken {
                        lock_id: fill.lock_id,
                        deal_id,
                        amount_a: fill.amount_a,
                        amount_b,
                        remaining_b: existing_lock.remaining_b,
                    },
                );
        }

        let total_a: u128 = expected_a.try_into().expect(errors::AMOUNT_OVERFLOW);
        let total_b: u128 = total_b_u256.try_into().expect(errors::AMOUNT_OVERFLOW);
        let token_b = IErc20Dispatcher { contract_address: params.counter_token };
        let balance_b = token_b.balance_of(get_contract_address());
        let accounted_b = self.accounted.entry(params.counter_token).read();
        assert(balance_b >= accounted_b, errors::BALANCE_DEFICIT);
        assert(accounted_b >= total_b_u256, errors::CONSERVATION_FAILURE);

        self.accounted.entry(params.token).write(accounted_a + received_a);
        self.accounted.entry(params.counter_token).write(accounted_b - total_b_u256);
        let fill_count_u8: u8 = fill_count.try_into().expect(errors::AMOUNT_OVERFLOW);
        let record = TakeRecord {
            token_a: params.token,
            total_a,
            token_b: params.counter_token,
            total_b,
            fill_count: fill_count_u8,
            taken_at: get_block_timestamp(),
        };
        self.takes.entry(deal_id).write(record);

        assert(token_b.approve(pool, total_b.into()), errors::APPROVE_FAILED);
        self
            .emit(
                DealTaken {
                    deal_id,
                    token_a: params.token,
                    total_a,
                    token_b: params.counter_token,
                    total_b,
                    fill_count: fill_count_u8,
                },
            );
        array![OpenNoteDeposit { note_id, token: params.counter_token, amount: total_b }].span()
    }

    fn consume_lock_ticket(ref self: ContractState, lock: Lock) {
        let ticket = ILockTicketDispatcher { contract_address: lock.ticket };
        let balance = ticket.balance_of(get_contract_address());
        let accounted = self.accounted.entry(lock.ticket).read();
        assert(balance >= accounted, errors::BAD_TICKET);
        assert(balance - accounted == 1, errors::BAD_TICKET);
        ticket.burn();
        assert(ticket.balance_of(get_contract_address()) == accounted, errors::BAD_TICKET);
    }

    fn settle_proceeds(
        ref self: ContractState, lock_id: felt252, note_id: felt252, pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut existing_lock = self.locks.entry(lock_id).read();
        assert(existing_lock.status == LockStatus::Open, errors::LOCK_NOT_OPEN);
        assert(get_block_timestamp() >= existing_lock.expiry, errors::LOCK_NOT_EXPIRED);
        assert(!existing_lock.proceeds_settled, errors::ALREADY_SETTLED);
        assert(existing_lock.earned_a > 0, errors::NOTHING_TO_SETTLE);
        consume_lock_ticket(ref self, existing_lock);

        let token = IErc20Dispatcher { contract_address: existing_lock.token_a };
        let balance = token.balance_of(get_contract_address());
        let accounted = self.accounted.entry(existing_lock.token_a).read();
        assert(balance >= accounted, errors::BALANCE_DEFICIT);
        assert(accounted >= existing_lock.earned_a.into(), errors::CONSERVATION_FAILURE);
        self
            .accounted
            .entry(existing_lock.token_a)
            .write(accounted - existing_lock.earned_a.into());
        existing_lock.proceeds_settled = true;
        self.locks.entry(lock_id).write(existing_lock);

        assert(token.approve(pool, existing_lock.earned_a.into()), errors::APPROVE_FAILED);
        self
            .emit(
                LockProceedsSettled {
                    lock_id, token: existing_lock.token_a, amount: existing_lock.earned_a,
                },
            );
        array![
            OpenNoteDeposit {
                note_id, token: existing_lock.token_a, amount: existing_lock.earned_a,
            },
        ]
            .span()
    }

    fn release_collateral(
        ref self: ContractState, lock_id: felt252, note_id: felt252, pool: ContractAddress,
    ) -> Span<OpenNoteDeposit> {
        let mut existing_lock = self.locks.entry(lock_id).read();
        assert(existing_lock.status == LockStatus::Open, errors::LOCK_NOT_OPEN);
        assert(get_block_timestamp() >= existing_lock.expiry, errors::LOCK_NOT_EXPIRED);
        assert(!existing_lock.collateral_released, errors::ALREADY_SETTLED);
        assert(existing_lock.remaining_b > 0, errors::NOTHING_TO_SETTLE);
        consume_lock_ticket(ref self, existing_lock);

        let token = IErc20Dispatcher { contract_address: existing_lock.token_b };
        let balance = token.balance_of(get_contract_address());
        let accounted = self.accounted.entry(existing_lock.token_b).read();
        assert(balance >= accounted, errors::BALANCE_DEFICIT);
        assert(accounted >= existing_lock.remaining_b.into(), errors::CONSERVATION_FAILURE);
        self
            .accounted
            .entry(existing_lock.token_b)
            .write(accounted - existing_lock.remaining_b.into());
        existing_lock.collateral_released = true;
        self.locks.entry(lock_id).write(existing_lock);

        assert(token.approve(pool, existing_lock.remaining_b.into()), errors::APPROVE_FAILED);
        self
            .emit(
                LockCollateralReleased {
                    lock_id, token: existing_lock.token_b, amount: existing_lock.remaining_b,
                },
            );
        array![
            OpenNoteDeposit {
                note_id, token: existing_lock.token_b, amount: existing_lock.remaining_b,
            },
        ]
            .span()
    }
}
