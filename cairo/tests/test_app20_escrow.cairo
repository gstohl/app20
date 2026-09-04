use app20_mail::OpenNoteDeposit;
use app20_mail::claim_ticket::{IClaimTicketDispatcher, IClaimTicketDispatcherTrait};
use app20_mail::escrow::{
    DealStatus, EscrowOperation, FillParams, FundParams, IApp20EscrowDispatcher,
    IApp20EscrowDispatcherTrait,
};
use app20_mail::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_block_timestamp, cheat_caller_address,
    declare, load, map_entry_address,
};
use starknet::{ClassHash, ContractAddress};

const DEAL_1: felt252 = 0xD001;
const DEAL_2: felt252 = 0xD002;
const FUND_TIME: u64 = 10;
const DEADLINE: u64 = 100;
const LEG_A_AMOUNT: u128 = 500;
const LEG_B_AMOUNT: u128 = 700;

fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn ticket_class_hash() -> ClassHash {
    *declare("ClaimTicket").unwrap().contract_class().class_hash
}

fn lock_ticket_class_hash() -> ClassHash {
    *declare("LockTicket").unwrap().contract_class().class_hash
}

fn deploy_escrow(pool: ContractAddress) -> (ContractAddress, IApp20EscrowDispatcher) {
    let contract = declare("App20Escrow").unwrap().contract_class();
    let mut calldata = array![pool.into()];
    ticket_class_hash().serialize(ref calldata);
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
    let pool = address(0x1000);
    let (escrow_address, escrow) = deploy_escrow(pool);
    let (token_a_address, token_a) = deploy_token(pool, 10_000);
    let (token_b_address, token_b) = deploy_token(pool, 10_000);
    (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b)
}

fn transfer_token(
    token_address: ContractAddress,
    token: IMockErc20Dispatcher,
    sender: ContractAddress,
    recipient: ContractAddress,
    amount: u128,
) {
    // Model the outer account's atomic prepare_funding -> pool transfer/invoke batch.
    IApp20EscrowDispatcher { contract_address: recipient }.prepare_funding(token_address);
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

fn ensure(
    escrow_address: ContractAddress, escrow: IApp20EscrowDispatcher, deal_id: felt252,
) -> ContractAddress {
    let ticket = escrow.ensure_ticket(deal_id);
    assert(ticket == escrow.ensure_ticket(deal_id), 'ensure not idempotent');
    assert(ticket == escrow.get_ticket(deal_id), 'ticket not stored');
    let dispatcher = IClaimTicketDispatcher { contract_address: ticket };
    assert(dispatcher.escrow() == escrow_address, 'wrong ticket escrow');
    assert(dispatcher.deal_id() == deal_id, 'wrong ticket deal');
    ticket
}

fn fund(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    token_a_address: ContractAddress,
    token_a: IMockErc20Dispatcher,
    token_b_address: ContractAddress,
    deal_id: felt252,
    amount: u128,
) -> OpenNoteDeposit {
    let ticket = ensure(escrow_address, escrow, deal_id);
    transfer_token(token_a_address, token_a, pool, escrow_address, amount);
    let deposits = invoke(
        pool,
        escrow_address,
        escrow,
        FUND_TIME,
        EscrowOperation::Fund(
            FundParams {
                token: token_a_address,
                amount,
                counter_token: token_b_address,
                counter_amount: LEG_B_AMOUNT,
                deadline: DEADLINE,
            },
        ),
        deal_id,
        0x711,
    );
    assert(deposits.len() == 1, 'fund needs ticket deposit');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == 0x711, 'wrong ticket note');
    assert(deposit.token == ticket, 'wrong ticket');
    assert(deposit.amount == 1, 'wrong ticket amount');
    deposit
}

fn pull_ticket(pool: ContractAddress, escrow_address: ContractAddress, deposit: OpenNoteDeposit) {
    let ticket = IClaimTicketDispatcher { contract_address: deposit.token };
    cheat_caller_address(deposit.token, pool, CheatSpan::TargetCalls(1));
    assert(ticket.transfer_from(escrow_address, pool, 1), 'ticket pull failed');
}

fn return_ticket(
    pool: ContractAddress, escrow_address: ContractAddress, ticket_address: ContractAddress,
) {
    let ticket = IClaimTicketDispatcher { contract_address: ticket_address };
    cheat_caller_address(ticket_address, pool, CheatSpan::TargetCalls(1));
    assert(ticket.transfer(escrow_address, 1), 'ticket return failed');
}

fn fill(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    token_b_address: ContractAddress,
    token_b: IMockErc20Dispatcher,
    deal_id: felt252,
    amount: u128,
) -> OpenNoteDeposit {
    transfer_token(token_b_address, token_b, pool, escrow_address, amount);
    let deposits = invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Fill(FillParams { token: token_b_address }),
        deal_id,
        0xF111,
    );
    assert(deposits.len() == 1, 'fill payout missing');
    *deposits.at(0)
}

fn pull_payout(pool: ContractAddress, escrow_address: ContractAddress, deposit: OpenNoteDeposit) {
    let token = IMockErc20Dispatcher { contract_address: deposit.token };
    cheat_caller_address(deposit.token, pool, CheatSpan::TargetCalls(1));
    assert(token.transfer_from(escrow_address, pool, deposit.amount.into()), 'pull failed');
}

fn accounted_balance(escrow_address: ContractAddress, token_address: ContractAddress) -> u256 {
    let entry = map_entry_address(selector!("accounted"), array![token_address.into()].span());
    let stored = load(escrow_address, entry, 2);
    u256 { low: (*stored.at(0)).try_into().unwrap(), high: (*stored.at(1)).try_into().unwrap() }
}

#[test]
fn fund_mints_supply_one_ticket_and_ensure_is_idempotent() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let deposit = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    let ticket = IClaimTicketDispatcher { contract_address: deposit.token };
    assert(ticket.decimals() == 0, 'wrong decimals');
    assert(ticket.total_supply() == 1, 'wrong supply');
    assert(ticket.balance_of(escrow_address) == 1, 'ticket not at escrow');
    assert(escrow.get_deal(DEAL_1).ticket == deposit.token, 'deal ticket mismatch');
}

#[test]
fn happy_path_consumes_ticket_and_conserves_both_legs() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket_deposit = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket_deposit);
    let taker_payout = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT,
    );
    assert(taker_payout.token == token_a_address, 'wrong taker token');
    assert(taker_payout.amount == LEG_A_AMOUNT, 'wrong taker amount');
    pull_payout(pool, escrow_address, taker_payout);

    return_ticket(pool, escrow_address, ticket_deposit.token);
    let maker = invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xC1A1);
    let payout = *maker.at(0);
    assert(payout.token == token_b_address, 'wrong maker token');
    assert(payout.amount == LEG_B_AMOUNT, 'wrong maker amount');
    pull_payout(pool, escrow_address, payout);

    let ticket = IClaimTicketDispatcher { contract_address: ticket_deposit.token };
    assert(ticket.total_supply() == 0, 'ticket not burned');
    assert(escrow.get_deal(DEAL_1).status == DealStatus::Settled, 'not settled');
    assert(token_a.balance_of(pool) == 10_000, 'leg A not conserved');
    assert(token_b.balance_of(pool) == 10_000, 'leg B not conserved');
}

#[test]
fn timeout_consumes_ticket_and_refunds_exact_leg_a() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    return_ticket(pool, escrow_address, ticket.token);
    let result = invoke(
        pool, escrow_address, escrow, DEADLINE, EscrowOperation::Timeout, DEAL_1, 0xCA11,
    );
    let payout = *result.at(0);
    assert(payout.token == token_a_address, 'wrong refund token');
    assert(payout.amount == LEG_A_AMOUNT, 'wrong refund amount');
    pull_payout(pool, escrow_address, payout);
    assert(escrow.get_deal(DEAL_1).status == DealStatus::TimedOut, 'not timed out');
    assert(token_a.balance_of(pool) == 10_000, 'refund not conserved');
}

#[test]
#[should_panic(expected: ('BAD_TICKET',))]
fn claim_without_ticket_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    let payout = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, payout);
    invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xBAD);
}

#[test]
#[should_panic(expected: ('BAD_TICKET',))]
fn copied_payout_calldata_without_ticket_cannot_steal() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    let payout = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, payout);
    invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xA77AC);
}

#[test]
#[should_panic(expected: ('BAD_TICKET',))]
fn wrong_deals_ticket_does_not_authorize_timeout() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket_1 = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket_1);
    let ticket_2 = fund(
        pool, escrow_address, escrow, token_a_address, token_a, token_b_address, DEAL_2, 300,
    );
    pull_ticket(pool, escrow_address, ticket_2);
    return_ticket(pool, escrow_address, ticket_1.token);
    invoke(pool, escrow_address, escrow, DEADLINE, EscrowOperation::Timeout, DEAL_2, 0xBAD);
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn ticket_cannot_replay_after_settlement() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    let payout = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, payout);
    return_ticket(pool, escrow_address, ticket.token);
    let payout = invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xA);
    pull_payout(pool, escrow_address, *payout.at(0));
    invoke(pool, escrow_address, escrow, 31, EscrowOperation::Claim, DEAL_1, 0xB);
}

#[test]
fn concurrent_deal_ticket_and_value_isolation() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket_1 = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket_1);
    let ticket_2 = fund(
        pool, escrow_address, escrow, token_a_address, token_a, token_b_address, DEAL_2, 300,
    );
    pull_ticket(pool, escrow_address, ticket_2);
    return_ticket(pool, escrow_address, ticket_1.token);
    let refund = invoke(
        pool, escrow_address, escrow, DEADLINE, EscrowOperation::Timeout, DEAL_1, 0x1,
    );
    pull_payout(pool, escrow_address, *refund.at(0));
    assert(token_a.balance_of(escrow_address) == 300, 'other liability spent');
    assert(escrow.get_deal(DEAL_2).status == DealStatus::Funded, 'other deal changed');
    let second_ticket = IClaimTicketDispatcher { contract_address: ticket_2.token };
    assert(second_ticket.balance_of(pool) == 1, 'other ticket changed');
}

#[test]
#[should_panic(expected: ('DEAL_NOT_EXPIRED',))]
fn timeout_before_deadline_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    return_ticket(pool, escrow_address, ticket.token);
    invoke(pool, escrow_address, escrow, DEADLINE - 1, EscrowOperation::Timeout, DEAL_1, 0x1);
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn short_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT - 1);
}

#[test]
#[should_panic(expected: ('NOT_AUTHORIZED',))]
fn ticket_transfer_rejects_public_caller() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    let dispatcher = IClaimTicketDispatcher { contract_address: ticket.token };
    dispatcher.transfer(address(0x123), 1);
}

#[test]
#[should_panic(expected: ('WRONG_TOKEN',))]
fn wrong_token_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    invoke(
        pool,
        escrow_address,
        escrow,
        20,
        EscrowOperation::Fill(FillParams { token: token_a_address }),
        DEAL_1,
        0xF111,
    );
}

#[test]
#[should_panic(expected: ('DEAL_EXPIRED',))]
fn fill_at_or_after_deadline_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    transfer_token(token_b_address, token_b, pool, escrow_address, LEG_B_AMOUNT);
    invoke(
        pool,
        escrow_address,
        escrow,
        DEADLINE,
        EscrowOperation::Fill(FillParams { token: token_b_address }),
        DEAL_1,
        0xF111,
    );
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn double_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    let payout = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, payout);
    fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn timeout_after_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    let payout = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, payout);
    return_ticket(pool, escrow_address, ticket.token);
    invoke(pool, escrow_address, escrow, DEADLINE, EscrowOperation::Timeout, DEAL_1, 0x1);
}

#[test]
fn preexisting_counter_token_dust_does_not_block_fill_or_change_exact_terms() {
    let dust: u128 = 1;
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    transfer_token(token_b_address, token_b, pool, escrow_address, dust);

    let taker = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    assert(taker.amount == LEG_A_AMOUNT, 'taker payout changed');
    assert(
        accounted_balance(escrow_address, token_b_address) == LEG_B_AMOUNT.into(),
        'dust was accounted',
    );
    assert(
        accounted_balance(escrow_address, token_b_address) <= token_b.balance_of(escrow_address),
        'fill payout not covered',
    );
    pull_payout(pool, escrow_address, taker);

    return_ticket(pool, escrow_address, ticket.token);
    let maker = *invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xD058)
        .at(0);
    assert(maker.amount == LEG_B_AMOUNT, 'maker terms changed');
    assert(
        token_b.allowance(escrow_address, pool) == LEG_B_AMOUNT.into(), 'maker payout not covered',
    );
    pull_payout(pool, escrow_address, maker);
    assert(token_b.balance_of(escrow_address) == dust.into(), 'dust was paid or absorbed');
    assert(accounted_balance(escrow_address, token_b_address) == 0, 'claimed dust accounted');
}

#[test]
#[should_panic(expected: ('BAD_RECIPIENT',))]
fn pool_cannot_strand_ticket_at_an_unusable_recipient() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket_deposit = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket_deposit);

    let ticket = IClaimTicketDispatcher { contract_address: ticket_deposit.token };
    cheat_caller_address(ticket_deposit.token, pool, CheatSpan::TargetCalls(1));
    ticket.transfer(address(0x123), 1);
}

#[test]
fn unrelated_outgoing_dust_is_not_attributed_to_a_deal() {
    let dust: u128 = 13;
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);

    transfer_token(token_a_address, token_a, pool, escrow_address, dust);
    let taker = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    assert(taker.amount == LEG_A_AMOUNT, 'leg A dust was attributed');
    pull_payout(pool, escrow_address, taker);
    assert(token_a.balance_of(escrow_address) == dust.into(), 'leg A dust did not remain');

    transfer_token(token_b_address, token_b, pool, escrow_address, dust);
    return_ticket(pool, escrow_address, ticket.token);
    let maker = invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xD057);
    let payout = *maker.at(0);
    assert(payout.amount == LEG_B_AMOUNT, 'leg B dust was attributed');
    pull_payout(pool, escrow_address, payout);
    assert(token_b.balance_of(escrow_address) == dust.into(), 'leg B dust did not remain');
}

#[test]
fn claim_after_deadline_succeeds_when_fill_was_timely() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    let taker = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, taker);
    return_ticket(pool, escrow_address, ticket.token);

    let maker = invoke(
        pool, escrow_address, escrow, DEADLINE + 1, EscrowOperation::Claim, DEAL_1, 0xC1A2,
    );
    assert((*maker.at(0)).amount == LEG_B_AMOUNT, 'late claim amount changed');
    assert(escrow.get_deal(DEAL_1).status == DealStatus::Settled, 'late claim not settled');
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn timeout_cannot_replay_after_refund() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        fixture();
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);
    return_ticket(pool, escrow_address, ticket.token);
    let refund = invoke(
        pool, escrow_address, escrow, DEADLINE, EscrowOperation::Timeout, DEAL_1, 0x701,
    );
    pull_payout(pool, escrow_address, *refund.at(0));
    invoke(pool, escrow_address, escrow, DEADLINE + 1, EscrowOperation::Timeout, DEAL_1, 0x702);
}

#[test]
fn fill_uses_exact_delta_beside_an_existing_counter_token_liability() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    let reverse_ticket = fund(
        pool, escrow_address, escrow, token_b_address, token_b, token_a_address, DEAL_2, 300,
    );
    pull_ticket(pool, escrow_address, reverse_ticket);
    let ticket = fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
    );
    pull_ticket(pool, escrow_address, ticket);

    let taker = fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT);
    pull_payout(pool, escrow_address, taker);
    return_ticket(pool, escrow_address, ticket.token);
    let maker = invoke(pool, escrow_address, escrow, 30, EscrowOperation::Claim, DEAL_1, 0xD311A);
    pull_payout(pool, escrow_address, *maker.at(0));

    assert(token_b.balance_of(escrow_address) == 300, 'other counter liability changed');
    assert(escrow.get_deal(DEAL_2).status == DealStatus::Funded, 'other deal changed');
    return_ticket(pool, escrow_address, reverse_ticket.token);
    let reverse_refund = invoke(
        pool, escrow_address, escrow, DEADLINE, EscrowOperation::Timeout, DEAL_2, 0xD311B,
    );
    pull_payout(pool, escrow_address, *reverse_refund.at(0));
    assert(token_b.balance_of(escrow_address) == 0, 'counter liability not conserved');
}

#[test]
fn claim_ticket_constructor_rejects_zero_deal_id() {
    let contract = declare("ClaimTicket").unwrap().contract_class();
    let deployment = contract.deploy(@array![address(0x1).into(), address(0x2).into(), 0]);
    assert(deployment.is_err(), 'zero deal id deployed');
}
