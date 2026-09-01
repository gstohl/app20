use app20_mail::OpenNoteDeposit;
use app20_mail::claim_ticket::{IClaimTicketDispatcher, IClaimTicketDispatcherTrait};
use app20_mail::escrow::{
    App20Escrow, EscrowOperation, FillParams, FundParams, IApp20EscrowDispatcher,
    IApp20EscrowDispatcherTrait, IApp20EscrowSafeDispatcher, IApp20EscrowSafeDispatcherTrait,
    LockParams, LockStatus, TakeFill, TakeParams, evaluate_schedule,
};
use app20_mail::lock_ticket::{ILockTicketDispatcher, ILockTicketDispatcherTrait};
use app20_mail::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait,
    cheat_block_timestamp, cheat_caller_address, declare, map_entry_address, spy_events, store,
};
use starknet::{ClassHash, ContractAddress};

const POOL: felt252 = 0x3000;
const RFQ: felt252 = 0xA300;
const LOCK_1: felt252 = 0xB301;
const SECRET: felt252 = 0xC302;
const CREATED_AT: u64 = 10;
const EXPIRY: u64 = 100;

fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn claim_ticket_class_hash() -> ClassHash {
    *declare("ClaimTicket").unwrap().contract_class().class_hash
}

fn lock_ticket_class_hash() -> ClassHash {
    *declare("LockTicket").unwrap().contract_class().class_hash
}

fn deploy_escrow(pool: ContractAddress) -> (ContractAddress, IApp20EscrowDispatcher) {
    let contract = declare("App20Escrow").unwrap().contract_class();
    let mut calldata = array![pool.into()];
    claim_ticket_class_hash().serialize(ref calldata);
    lock_ticket_class_hash().serialize(ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap();
    (contract_address, IApp20EscrowDispatcher { contract_address })
}

fn deploy_token(
    recipient: ContractAddress, supply: u256,
) -> (ContractAddress, IMockErc20Dispatcher) {
    let contract = declare("MockErc20").unwrap().contract_class();
    let mut calldata = array![recipient.into()];
    supply.serialize(ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap();
    (contract_address, IMockErc20Dispatcher { contract_address })
}

fn fixture() -> (
    ContractAddress,
    ContractAddress,
    IApp20EscrowDispatcher,
    ContractAddress,
    IMockErc20Dispatcher,
    ContractAddress,
    IMockErc20Dispatcher,
) {
    let pool = address(POOL);
    let (escrow_address, escrow) = deploy_escrow(pool);
    let (token_a_address, token_a) = deploy_token(pool, 100_000);
    let (token_b_address, token_b) = deploy_token(pool, 100_000);
    (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b)
}

fn transfer_token(
    token_address: ContractAddress,
    token: IMockErc20Dispatcher,
    sender: ContractAddress,
    recipient: ContractAddress,
    amount: u128,
) {
    cheat_caller_address(token_address, sender, CheatSpan::TargetCalls(1));
    assert(token.transfer(recipient, amount.into()), 'transfer failed');
}

fn invoke(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    at: u64,
    operation: EscrowOperation,
    deal_id: felt252,
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    cheat_caller_address(escrow_address, pool, CheatSpan::TargetCalls(1));
    cheat_block_timestamp(escrow_address, at, CheatSpan::TargetCalls(1));
    escrow.privacy_invoke(operation, deal_id, address(0xBAD), note_id)
}

fn commitment(secret: felt252) -> felt252 {
    poseidon_hash_span(array![secret].span())
}

fn standard_lock_params(
    token_b: ContractAddress,
    token_a: ContractAddress,
    rfq_id: felt252,
    secret: felt252,
    expiry: u64,
) -> LockParams {
    LockParams {
        token: token_b,
        counter_token: token_a,
        rfq_id,
        taker_commitment: commitment(secret),
        expiry,
        points_len: 2,
        p0_a: 10,
        p0_b: 20,
        p1_a: 100,
        p1_b: 200,
        p2_a: 0,
        p2_b: 0,
        p3_a: 0,
        p3_b: 0,
    }
}

fn create_lock(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    token_a_address: ContractAddress,
    token_b_address: ContractAddress,
    token_b: IMockErc20Dispatcher,
    lock_id: felt252,
    rfq_id: felt252,
) -> OpenNoteDeposit {
    transfer_token(token_b_address, token_b, pool, escrow_address, 200);
    let deposits = invoke(
        pool,
        escrow_address,
        escrow,
        CREATED_AT,
        EscrowOperation::Lock(
            standard_lock_params(token_b_address, token_a_address, rfq_id, SECRET, EXPIRY),
        ),
        lock_id,
        0xD301,
    );
    assert(deposits.len() == 1, 'lock deposit missing');
    *deposits.at(0)
}

fn pull_payout(pool: ContractAddress, escrow_address: ContractAddress, deposit: OpenNoteDeposit) {
    let token = IMockErc20Dispatcher { contract_address: deposit.token };
    cheat_caller_address(deposit.token, pool, CheatSpan::TargetCalls(1));
    assert(token.transfer_from(escrow_address, pool, deposit.amount.into()), 'payout pull failed');
}

fn pull_lock_ticket_units(
    pool: ContractAddress, escrow_address: ContractAddress, ticket_address: ContractAddress,
) {
    let ticket = ILockTicketDispatcher { contract_address: ticket_address };
    cheat_caller_address(ticket_address, pool, CheatSpan::TargetCalls(2));
    assert(ticket.transfer_from(escrow_address, pool, 1), 'first ticket pull failed');
    assert(ticket.transfer_from(escrow_address, pool, 1), 'second ticket pull failed');
}

fn return_lock_ticket(
    pool: ContractAddress, escrow_address: ContractAddress, ticket_address: ContractAddress,
) {
    let ticket = ILockTicketDispatcher { contract_address: ticket_address };
    cheat_caller_address(ticket_address, pool, CheatSpan::TargetCalls(1));
    assert(ticket.transfer(escrow_address, 1), 'ticket return failed');
}

fn take_one(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    token_a_address: ContractAddress,
    token_a: IMockErc20Dispatcher,
    token_b_address: ContractAddress,
    rfq_id: felt252,
    lock_id: felt252,
    amount_a: u128,
    secret: felt252,
) -> Span<OpenNoteDeposit> {
    transfer_token(token_a_address, token_a, pool, escrow_address, amount_a);
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address,
                counter_token: token_b_address,
                taker_secret: secret,
                fills: array![TakeFill { lock_id, amount_a }],
            },
        ),
        rfq_id,
        0xD302,
    )
}

#[test]
fn shared_schedule_evaluate_vectors_match() {
    assert(
        evaluate_schedule(
            1, 1000000000000000000, 2000000, 0, 0, 0, 0, 0, 0, 1000000000000000000,
        ) == 2000000,
        'single point',
    );
    assert(
        evaluate_schedule(
            2,
            100000000000000000,
            200000,
            1000000000000000000,
            2000000,
            0,
            0,
            0,
            0,
            500000000000000000,
        ) == 1000000,
        'linear mid',
    );
    assert(
        evaluate_schedule(
            2,
            100000000000000000,
            200000,
            1000000000000000000,
            2000000,
            0,
            0,
            0,
            0,
            100000000000000000,
        ) == 200000,
        'linear min',
    );
    assert(
        evaluate_schedule(
            2,
            100000000000000000,
            200000,
            1000000000000000000,
            2000000,
            0,
            0,
            0,
            0,
            1000000000000000000,
        ) == 2000000,
        'linear max',
    );
    assert(
        evaluate_schedule(
            2,
            100000000000000000,
            200000,
            1000000000000000000,
            2000000,
            0,
            0,
            0,
            0,
            123456789012345678,
        ) == 246913,
        'linear odd',
    );
    assert(
        evaluate_schedule(
            3,
            1000000000000000000,
            2000000,
            2000000000000000000,
            4010000,
            4000000000000000000,
            8100000,
            0,
            0,
            3000000000000000000,
        ) == 6055000,
        'tier segment two',
    );
    assert(
        evaluate_schedule(
            3,
            1000000000000000000,
            2000000,
            2000000000000000000,
            4010000,
            4000000000000000000,
            8100000,
            0,
            0,
            1500000000000000000,
        ) == 3005000,
        'tier segment one',
    );
    assert(
        evaluate_schedule(
            3,
            1000000000000000000,
            2000000,
            2000000000000000000,
            4010000,
            4000000000000000000,
            8100000,
            0,
            0,
            2000000000000000000,
        ) == 4010000,
        'tier breakpoint',
    );
    assert(evaluate_schedule(2, 3, 10, 6, 11, 0, 0, 0, 0, 4) == 10, 'floor four');
    assert(evaluate_schedule(2, 3, 10, 6, 11, 0, 0, 0, 0, 5) == 10, 'floor five');
    assert(evaluate_schedule(2, 1, 5, 3, 5, 0, 0, 0, 0, 2) == 5, 'flat b');
    assert(evaluate_schedule(4, 1, 1, 10, 20, 100, 190, 1000, 1800, 550) == 995, 'four points');
    assert(
        evaluate_schedule(
            2,
            1,
            1,
            340282366920938463463374607431768211455,
            340282366920938463463374607431768211455,
            0,
            0,
            0,
            0,
            170141183460469231731687303715884105728,
        ) == 170141183460469231731687303715884105728,
        'u128 extreme',
    );
}

#[test]
#[should_panic(expected: ('OUT_OF_SCHEDULE',))]
fn schedule_rejects_below_domain() {
    evaluate_schedule(2, 10, 10, 20, 20, 0, 0, 0, 0, 9);
}

#[test]
#[should_panic(expected: ('OUT_OF_SCHEDULE',))]
fn schedule_rejects_above_domain() {
    evaluate_schedule(2, 10, 10, 20, 20, 0, 0, 0, 0, 21);
}

#[test]
#[should_panic(expected: ('OUT_OF_SCHEDULE',))]
fn schedule_rejects_single_point_mismatch() {
    evaluate_schedule(1, 10, 10, 0, 0, 0, 0, 0, 0, 11);
}

#[test]
#[should_panic(expected: ('BAD_SCHEDULE',))]
fn schedule_rejects_non_increasing_a() {
    evaluate_schedule(2, 10, 10, 10, 20, 0, 0, 0, 0, 10);
}

#[test]
#[should_panic(expected: ('BAD_SCHEDULE',))]
fn schedule_rejects_decreasing_b() {
    evaluate_schedule(2, 10, 20, 20, 10, 0, 0, 0, 0, 15);
}

#[test]
#[should_panic(expected: ('BAD_SCHEDULE',))]
fn schedule_rejects_zero_a() {
    evaluate_schedule(2, 0, 10, 20, 20, 0, 0, 0, 0, 10);
}

#[test]
#[should_panic(expected: ('BAD_SCHEDULE',))]
fn schedule_rejects_zero_b() {
    evaluate_schedule(2, 10, 0, 20, 20, 0, 0, 0, 0, 10);
}

#[test]
#[should_panic(expected: ('BAD_SCHEDULE',))]
fn schedule_rejects_five_points() {
    evaluate_schedule(5, 1, 1, 2, 2, 3, 3, 4, 4, 3);
}

#[test]
#[should_panic(expected: ('BAD_SCHEDULE',))]
fn schedule_rejects_zero_points() {
    evaluate_schedule(0, 0, 0, 0, 0, 0, 0, 0, 0, 3);
}

#[test]
fn lock_mints_supply_two_and_records_exact_delta_and_event() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    let mut spy = spy_events();
    let deposit = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    let lock = escrow.get_lock(LOCK_1);
    let ticket = ILockTicketDispatcher { contract_address: deposit.token };

    assert(deposit.note_id == 0xD301, 'wrong note');
    assert(deposit.amount == 2, 'wrong ticket amount');
    assert(deposit.token == escrow.get_lock_ticket(LOCK_1), 'ticket not stored');
    assert(ticket.name() == "APP20 Lock Ticket", 'wrong name');
    assert(ticket.symbol() == "A20LT", 'wrong symbol');
    assert(ticket.decimals() == 0, 'wrong decimals');
    assert(ticket.total_supply() == 2, 'wrong supply');
    assert(ticket.balance_of(escrow_address) == 2, 'tickets not at escrow');
    assert(ticket.allowance(escrow_address, pool) == 2, 'wrong approval');
    assert(ticket.escrow() == escrow_address, 'wrong ticket escrow');
    assert(ticket.pool() == pool, 'wrong ticket pool');
    assert(ticket.lock_id() == LOCK_1, 'wrong ticket lock');
    assert(lock.status == LockStatus::Open, 'lock not open');
    assert(lock.token_a == token_a_address, 'wrong token a');
    assert(lock.token_b == token_b_address, 'wrong token b');
    assert(lock.remaining_b == 200, 'wrong remaining');
    assert(lock.earned_a == 0, 'unexpected earnings');
    assert(escrow.quote_schedule(LOCK_1, 50) == 100, 'wrong quote view');
    spy
        .assert_emitted(
            @array![
                (
                    escrow_address,
                    App20Escrow::Event::LockCreated(
                        App20Escrow::LockCreated {
                            lock_id: LOCK_1,
                            rfq_id: RFQ,
                            token_a: token_a_address,
                            token_b: token_b_address,
                            expiry: EXPIRY,
                            max_b: 200,
                            points_len: 2,
                            p0_a: 10,
                            p0_b: 20,
                            p1_a: 100,
                            p1_b: 200,
                            p2_a: 0,
                            p2_b: 0,
                            p3_a: 0,
                            p3_b: 0,
                            ticket: deposit.token,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: ('BAD_LOCK_AMOUNT',))]
fn lock_requires_exact_schedule_max() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    transfer_token(token_b_address, token_b, pool, escrow_address, 199);
    invoke(
        pool,
        escrow_address,
        escrow,
        CREATED_AT,
        EscrowOperation::Lock(
            standard_lock_params(token_b_address, token_a_address, RFQ, SECRET, EXPIRY),
        ),
        LOCK_1,
        1,
    );
}

#[test]
#[should_panic(expected: ('LOCK_EXISTS',))]
fn duplicate_lock_id_reverts() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    invoke(
        pool,
        escrow_address,
        escrow,
        CREATED_AT,
        EscrowOperation::Lock(
            standard_lock_params(token_b_address, token_a_address, RFQ, SECRET, EXPIRY),
        ),
        LOCK_1,
        2,
    );
}

#[test]
#[should_panic(expected: ('DEADLINE_NOT_FUTURE',))]
fn lock_expiry_must_be_future() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    transfer_token(token_b_address, token_b, pool, escrow_address, 200);
    invoke(
        pool,
        escrow_address,
        escrow,
        CREATED_AT,
        EscrowOperation::Lock(
            standard_lock_params(token_b_address, token_a_address, RFQ, SECRET, CREATED_AT),
        ),
        LOCK_1,
        3,
    );
}

#[test]
fn take_single_fill_updates_lock_record_and_events() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    let mut spy = spy_events();
    let deposits = take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        50,
        SECRET,
    );
    let deposit = *deposits.at(0);
    let lock = escrow.get_lock(LOCK_1);
    let record = escrow.get_take(RFQ);

    assert(deposits.len() == 1, 'take needs one deposit');
    assert(deposit.token == token_b_address, 'wrong payout token');
    assert(deposit.amount == 100, 'wrong payout amount');
    assert(lock.remaining_b == 100, 'remaining not reduced');
    assert(lock.earned_a == 50, 'earnings not updated');
    assert(record.token_a == token_a_address, 'record token a');
    assert(record.total_a == 50, 'record total a');
    assert(record.token_b == token_b_address, 'record token b');
    assert(record.total_b == 100, 'record total b');
    assert(record.fill_count == 1, 'record count');
    assert(record.taken_at == 20, 'record timestamp');
    assert(token_b.allowance(escrow_address, pool) == 100, 'payout approval');
    spy
        .assert_emitted(
            @array![
                (
                    escrow_address,
                    App20Escrow::Event::LockTaken(
                        App20Escrow::LockTaken {
                            lock_id: LOCK_1,
                            deal_id: RFQ,
                            amount_a: 50,
                            amount_b: 100,
                            remaining_b: 100,
                        },
                    ),
                ),
                (
                    escrow_address,
                    App20Escrow::Event::DealTaken(
                        App20Escrow::DealTaken {
                            deal_id: RFQ,
                            token_a: token_a_address,
                            total_a: 50,
                            token_b: token_b_address,
                            total_b: 100,
                            fill_count: 1,
                        },
                    ),
                ),
            ],
        );
}

fn run_multi_fill(fill_count: u8) {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let mut fills = array![];
    let mut index: u8 = 0;
    while index < fill_count {
        let lock_id = 0xE000 + index.into();
        create_lock(
            pool, escrow_address, escrow, token_a_address, token_b_address, token_b, lock_id, RFQ,
        );
        fills.append(TakeFill { lock_id, amount_a: 10 });
        index += 1;
    }
    let total_a: u128 = 10 * fill_count.into();
    transfer_token(token_a_address, token_a, pool, escrow_address, total_a);
    let deposits = invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address, counter_token: token_b_address, taker_secret: SECRET, fills,
            },
        ),
        RFQ,
        0xE100,
    );
    let payout = *deposits.at(0);
    assert(payout.amount == 20 * fill_count.into(), 'wrong aggregate payout');
    assert(escrow.get_take(RFQ).fill_count == fill_count, 'wrong aggregate count');
}

#[test]
fn take_supports_two_three_and_four_distinct_locks() {
    run_multi_fill(2);
    run_multi_fill(3);
    run_multi_fill(4);
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn take_requires_exact_sum_received() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    transfer_token(token_a_address, token_a, pool, escrow_address, 49);
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address,
                counter_token: token_b_address,
                taker_secret: SECRET,
                fills: array![TakeFill { lock_id: LOCK_1, amount_a: 50 }],
            },
        ),
        RFQ,
        4,
    );
}

#[test]
#[should_panic(expected: ('BAD_COMMITMENT',))]
fn take_rejects_wrong_secret() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        50,
        SECRET + 1,
    );
}

#[test]
#[should_panic(expected: ('WRONG_RFQ',))]
fn take_rejects_wrong_rfq() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ + 1,
        LOCK_1,
        50,
        SECRET,
    );
}

#[test]
#[should_panic(expected: ('LOCK_EXPIRED',))]
fn take_rejects_expired_lock() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    transfer_token(token_a_address, token_a, pool, escrow_address, 50);
    invoke(
        pool,
        escrow_address,
        escrow,
        EXPIRY,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address,
                counter_token: token_b_address,
                taker_secret: SECRET,
                fills: array![TakeFill { lock_id: LOCK_1, amount_a: 50 }],
            },
        ),
        RFQ,
        5,
    );
}

#[test]
#[should_panic(expected: ('DUPLICATE_LOCK',))]
fn take_rejects_duplicate_lock_ids() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    transfer_token(token_a_address, token_a, pool, escrow_address, 20);
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address,
                counter_token: token_b_address,
                taker_secret: SECRET,
                fills: array![
                    TakeFill { lock_id: LOCK_1, amount_a: 10 },
                    TakeFill { lock_id: LOCK_1, amount_a: 10 },
                ],
            },
        ),
        RFQ,
        6,
    );
}

#[test]
#[should_panic(expected: ('NO_FILLS',))]
fn take_rejects_zero_fills() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, _token_b) =
        fixture();
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address,
                counter_token: token_b_address,
                taker_secret: SECRET,
                fills: array![],
            },
        ),
        RFQ,
        7,
    );
}

#[test]
#[should_panic(expected: ('TOO_MANY_FILLS',))]
fn take_rejects_five_fills() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, _token_b) =
        fixture();
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_a_address,
                counter_token: token_b_address,
                taker_secret: SECRET,
                fills: array![
                    TakeFill { lock_id: 1, amount_a: 10 }, TakeFill { lock_id: 2, amount_a: 10 },
                    TakeFill { lock_id: 3, amount_a: 10 }, TakeFill { lock_id: 4, amount_a: 10 },
                    TakeFill { lock_id: 5, amount_a: 10 },
                ],
            },
        ),
        RFQ,
        8,
    );
}

#[test]
#[should_panic(expected: ('WRONG_TOKEN',))]
fn take_rejects_wrong_tokens() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    transfer_token(token_b_address, token_b, pool, escrow_address, 50);
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Take(
            TakeParams {
                token: token_b_address,
                counter_token: token_a_address,
                taker_secret: SECRET,
                fills: array![TakeFill { lock_id: LOCK_1, amount_a: 50 }],
            },
        ),
        RFQ,
        9,
    );
}

#[test]
#[should_panic(expected: ('TAKE_EXISTS',))]
fn take_rejects_second_deal_id_use() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    let first = take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        50,
        SECRET,
    );
    pull_payout(pool, escrow_address, *first.at(0));
    take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        10,
        SECRET,
    );
}

#[test]
#[should_panic(expected: ('OUT_OF_SCHEDULE',))]
fn take_rejects_amount_outside_schedule() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        9,
        SECRET,
    );
}

#[test]
#[should_panic(expected: ('LOCK_NOT_EXPIRED',))]
fn settlement_rejects_before_expiry() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    let ticket = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, ticket.token);
    return_lock_ticket(pool, escrow_address, ticket.token);
    invoke(pool, escrow_address, escrow, EXPIRY - 1, EscrowOperation::SettleProceeds, LOCK_1, 10);
}

#[test]
fn settlement_pays_both_sides_and_burns_one_unit_each() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket_deposit = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, ticket_deposit.token);
    let take = take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        50,
        SECRET,
    );
    pull_payout(pool, escrow_address, *take.at(0));
    let ticket = ILockTicketDispatcher { contract_address: ticket_deposit.token };
    let mut spy = spy_events();

    return_lock_ticket(pool, escrow_address, ticket_deposit.token);
    let proceeds = invoke(
        pool, escrow_address, escrow, EXPIRY, EscrowOperation::SettleProceeds, LOCK_1, 0xA1,
    );
    assert((*proceeds.at(0)).token == token_a_address, 'wrong proceeds token');
    assert((*proceeds.at(0)).amount == 50, 'wrong proceeds amount');
    assert(ticket.total_supply() == 1, 'first unit not burned');
    pull_payout(pool, escrow_address, *proceeds.at(0));

    return_lock_ticket(pool, escrow_address, ticket_deposit.token);
    let collateral = invoke(
        pool, escrow_address, escrow, EXPIRY, EscrowOperation::ReleaseCollateral, LOCK_1, 0xA2,
    );
    assert((*collateral.at(0)).token == token_b_address, 'wrong collateral token');
    assert((*collateral.at(0)).amount == 100, 'wrong collateral amount');
    assert(ticket.total_supply() == 0, 'second unit not burned');
    pull_payout(pool, escrow_address, *collateral.at(0));

    let lock = escrow.get_lock(LOCK_1);
    assert(lock.proceeds_settled, 'proceeds flag missing');
    assert(lock.collateral_released, 'collateral flag missing');
    assert(token_a.balance_of(escrow_address) == 0, 'token a not conserved');
    assert(token_b.balance_of(escrow_address) == 0, 'token b not conserved');
    spy
        .assert_emitted(
            @array![
                (
                    escrow_address,
                    App20Escrow::Event::LockProceedsSettled(
                        App20Escrow::LockProceedsSettled {
                            lock_id: LOCK_1, token: token_a_address, amount: 50,
                        },
                    ),
                ),
                (
                    escrow_address,
                    App20Escrow::Event::LockCollateralReleased(
                        App20Escrow::LockCollateralReleased {
                            lock_id: LOCK_1, token: token_b_address, amount: 100,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: ('NOTHING_TO_SETTLE',))]
fn nothing_to_settle_keeps_ticket_and_state() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    let ticket_deposit = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, ticket_deposit.token);
    return_lock_ticket(pool, escrow_address, ticket_deposit.token);
    invoke(pool, escrow_address, escrow, EXPIRY, EscrowOperation::SettleProceeds, LOCK_1, 0xA3);
}

#[test]
#[should_panic(expected: ('ALREADY_SETTLED',))]
fn proceeds_cannot_settle_twice() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, ticket.token);
    let take = take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        50,
        SECRET,
    );
    pull_payout(pool, escrow_address, *take.at(0));
    return_lock_ticket(pool, escrow_address, ticket.token);
    let proceeds = invoke(
        pool, escrow_address, escrow, EXPIRY, EscrowOperation::SettleProceeds, LOCK_1, 0xA4,
    );
    pull_payout(pool, escrow_address, *proceeds.at(0));
    invoke(pool, escrow_address, escrow, EXPIRY + 1, EscrowOperation::SettleProceeds, LOCK_1, 0xA5);
}

#[test]
#[should_panic(expected: ('ALREADY_SETTLED',))]
fn collateral_cannot_release_twice() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    let ticket = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, ticket.token);
    return_lock_ticket(pool, escrow_address, ticket.token);
    let collateral = invoke(
        pool, escrow_address, escrow, EXPIRY, EscrowOperation::ReleaseCollateral, LOCK_1, 0xA6,
    );
    pull_payout(pool, escrow_address, *collateral.at(0));
    invoke(
        pool, escrow_address, escrow, EXPIRY + 1, EscrowOperation::ReleaseCollateral, LOCK_1, 0xA7,
    );
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_LOCK',))]
fn take_defensively_rejects_insufficient_lock_storage() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    // A reduced balance before the RFQ's only Take is unreachable through the public ABI. Mutate
    // the Lock.remaining_b field to exercise the defense-in-depth guard against corrupt state.
    let lock_storage = map_entry_address(selector!("locks"), array![LOCK_1].span());
    store(escrow_address, lock_storage + 14, array![1].span());
    take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        10,
        SECRET,
    );
}

#[test]
fn legacy_and_v3_operations_conserve_shared_token_balances() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();

    transfer_token(token_a_address, token_a, pool, escrow_address, 30);
    let legacy_ticket_deposit = *invoke(
        pool,
        escrow_address,
        escrow,
        10,
        EscrowOperation::Fund(
            FundParams {
                token: token_a_address,
                counter_token: token_b_address,
                counter_amount: 40,
                deadline: 90,
            },
        ),
        0xF300,
        0xF301,
    )
        .at(0);
    let legacy_ticket = IClaimTicketDispatcher { contract_address: legacy_ticket_deposit.token };
    cheat_caller_address(legacy_ticket_deposit.token, pool, CheatSpan::TargetCalls(1));
    assert(legacy_ticket.transfer_from(escrow_address, pool, 1), 'legacy ticket pull');

    let lock_ticket_deposit = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, lock_ticket_deposit.token);

    transfer_token(token_b_address, token_b, pool, escrow_address, 40);
    let legacy_taker = *invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Fill(FillParams { token: token_b_address }),
        0xF300,
        0xF302,
    )
        .at(0);
    pull_payout(pool, escrow_address, legacy_taker);

    let v3_taker = *take_one(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        RFQ,
        LOCK_1,
        50,
        SECRET,
    )
        .at(0);
    pull_payout(pool, escrow_address, v3_taker);

    cheat_caller_address(legacy_ticket_deposit.token, pool, CheatSpan::TargetCalls(1));
    assert(legacy_ticket.transfer(escrow_address, 1), 'legacy ticket return');
    let legacy_maker = *invoke(
        pool, escrow_address, escrow, 30, EscrowOperation::Claim, 0xF300, 0xF303,
    )
        .at(0);
    pull_payout(pool, escrow_address, legacy_maker);

    return_lock_ticket(pool, escrow_address, lock_ticket_deposit.token);
    let proceeds = *invoke(
        pool, escrow_address, escrow, EXPIRY, EscrowOperation::SettleProceeds, LOCK_1, 0xF304,
    )
        .at(0);
    pull_payout(pool, escrow_address, proceeds);
    return_lock_ticket(pool, escrow_address, lock_ticket_deposit.token);
    let collateral = *invoke(
        pool, escrow_address, escrow, EXPIRY, EscrowOperation::ReleaseCollateral, LOCK_1, 0xF305,
    )
        .at(0);
    pull_payout(pool, escrow_address, collateral);

    assert(token_a.balance_of(escrow_address) == 0, 'shared a not conserved');
    assert(token_b.balance_of(escrow_address) == 0, 'shared b not conserved');
}

#[test]
#[feature("safe_dispatcher")]
fn nothing_to_settle_revert_preserves_ticket_and_lock() {
    let (pool, escrow_address, escrow, token_a_address, _token_a, token_b_address, token_b) =
        fixture();
    let ticket_deposit = create_lock(
        pool, escrow_address, escrow, token_a_address, token_b_address, token_b, LOCK_1, RFQ,
    );
    pull_lock_ticket_units(pool, escrow_address, ticket_deposit.token);
    return_lock_ticket(pool, escrow_address, ticket_deposit.token);
    let ticket = ILockTicketDispatcher { contract_address: ticket_deposit.token };
    let safe_escrow = IApp20EscrowSafeDispatcher { contract_address: escrow_address };
    cheat_caller_address(escrow_address, pool, CheatSpan::TargetCalls(1));
    cheat_block_timestamp(escrow_address, EXPIRY, CheatSpan::TargetCalls(1));
    let result = safe_escrow
        .privacy_invoke(EscrowOperation::SettleProceeds, LOCK_1, address(0xBAD), 0xF306);

    assert(result.is_err(), 'settlement unexpectedly passed');
    let lock = escrow.get_lock(LOCK_1);
    assert(!lock.proceeds_settled, 'empty side marked settled');
    assert(lock.earned_a == 0, 'empty side changed');
    assert(lock.remaining_b == 200, 'collateral changed');
    assert(ticket.balance_of(escrow_address) == 1, 'ticket unit consumed');
    assert(ticket.total_supply() == 2, 'ticket supply changed');
}
