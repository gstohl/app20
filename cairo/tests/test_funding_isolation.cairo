use app20_mail::OpenNoteDeposit;
use app20_mail::escrow::{
    DealStatus, EscrowOperation, FillParams, FundParams, IApp20EscrowDispatcher,
    IApp20EscrowDispatcherTrait,
};
use app20_mail::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_block_timestamp, cheat_caller_address,
    declare, start_cheat_transaction_hash,
};
use starknet::{ClassHash, ContractAddress};

const AMOUNT_A: u128 = 50;
const AMOUNT_B: u128 = 70;
const DEADLINE: u64 = 100;

fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn ticket_class_hash() -> ClassHash {
    *declare("ClaimTicket").unwrap().contract_class().class_hash
}

fn lock_ticket_class_hash() -> ClassHash {
    *declare("LockTicket").unwrap().contract_class().class_hash
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
    let escrow_class = declare("App20Escrow").unwrap().contract_class();
    let mut constructor = array![pool.into()];
    ticket_class_hash().serialize(ref constructor);
    lock_ticket_class_hash().serialize(ref constructor);
    let (escrow_address, _) = escrow_class.deploy(@constructor).unwrap();
    let escrow = IApp20EscrowDispatcher { contract_address: escrow_address };

    let token_class = declare("MockErc20").unwrap().contract_class();
    let mut token_a_constructor = array![pool.into()];
    let supply: u256 = 10_000;
    supply.serialize(ref token_a_constructor);
    let (token_a_address, _) = token_class.deploy(@token_a_constructor).unwrap();
    let token_a = IMockErc20Dispatcher { contract_address: token_a_address };

    let mut token_b_constructor = array![pool.into()];
    supply.serialize(ref token_b_constructor);
    let (token_b_address, _) = token_class.deploy(@token_b_constructor).unwrap();
    let token_b = IMockErc20Dispatcher { contract_address: token_b_address };

    (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b)
}

fn transfer_from_pool(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    token_address: ContractAddress,
    token: IMockErc20Dispatcher,
    amount: u128,
) {
    cheat_caller_address(token_address, pool, CheatSpan::TargetCalls(1));
    assert(token.transfer(escrow_address, amount.into()), 'transfer failed');
}

fn invoke(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    operation: EscrowOperation,
    deal_id: felt252,
) -> Span<OpenNoteDeposit> {
    cheat_caller_address(escrow_address, pool, CheatSpan::TargetCalls(1));
    cheat_block_timestamp(escrow_address, 10, CheatSpan::TargetCalls(1));
    escrow.privacy_invoke(operation, deal_id, address(0xbad), 0x711)
}

fn fund_operation(token: ContractAddress, counter_token: ContractAddress) -> EscrowOperation {
    EscrowOperation::Fund(
        FundParams {
            token, amount: AMOUNT_A, counter_token, counter_amount: AMOUNT_B, deadline: DEADLINE,
        },
    )
}

fn prepare_and_transfer(
    tx_hash: felt252,
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IApp20EscrowDispatcher,
    token_address: ContractAddress,
    token: IMockErc20Dispatcher,
    amount: u128,
) {
    start_cheat_transaction_hash(escrow_address, tx_hash);
    escrow.prepare_funding(token_address);
    transfer_from_pool(pool, escrow_address, token_address, token, amount);
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn preexisting_donation_cannot_subsidize_short_fund_input() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    transfer_from_pool(pool, escrow_address, token_a_address, token_a, 1);
    prepare_and_transfer(
        0x101, pool, escrow_address, escrow, token_a_address, token_a, AMOUNT_A - 1,
    );

    invoke(pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd01);
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn preexisting_donation_cannot_fund_zero_new_input() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    transfer_from_pool(pool, escrow_address, token_a_address, token_a, AMOUNT_A);
    start_cheat_transaction_hash(escrow_address, 0x102);
    escrow.prepare_funding(token_a_address);

    invoke(pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd02);
}

#[test]
fn exact_new_input_succeeds_without_claiming_old_dust() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    let old_dust: u128 = 11;
    transfer_from_pool(pool, escrow_address, token_a_address, token_a, old_dust);
    prepare_and_transfer(0x103, pool, escrow_address, escrow, token_a_address, token_a, AMOUNT_A);

    let deposits = invoke(
        pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd03,
    );
    assert(deposits.len() == 1, 'ticket deposit missing');
    let deal = escrow.get_deal(0xd03);
    assert(deal.status == DealStatus::Funded, 'deal not funded');
    assert(deal.leg_a_amount == AMOUNT_A, 'old dust was attributed');
    assert(token_a.balance_of(escrow_address) == (old_dust + AMOUNT_A).into(), 'dust moved');
}

#[test]
#[should_panic(expected: ('EXCESS_FILL',))]
fn excess_new_fund_input_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    prepare_and_transfer(
        0x104, pool, escrow_address, escrow, token_a_address, token_a, AMOUNT_A + 1,
    );

    invoke(pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd04);
}

#[test]
#[should_panic(expected: ('FUNDING_NOT_PREPARED',))]
fn missing_preparation_rejects_exact_fund_input() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    start_cheat_transaction_hash(escrow_address, 0x105);
    transfer_from_pool(pool, escrow_address, token_a_address, token_a, AMOUNT_A);

    invoke(pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd05);
}

#[test]
#[should_panic(expected: ('STALE_FUNDING',))]
fn preparation_from_another_transaction_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    prepare_and_transfer(0x106, pool, escrow_address, escrow, token_a_address, token_a, AMOUNT_A);
    start_cheat_transaction_hash(escrow_address, 0x206);

    invoke(pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd06);
}

#[test]
#[should_panic(expected: ('FUNDING_NOT_PREPARED',))]
fn consumed_snapshot_cannot_be_reused() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _) = fixture();
    prepare_and_transfer(0x107, pool, escrow_address, escrow, token_a_address, token_a, AMOUNT_A);
    let first = invoke(
        pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd07,
    );
    assert(first.len() == 1, 'first fund failed');
    transfer_from_pool(pool, escrow_address, token_a_address, token_a, AMOUNT_A);

    invoke(pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd08);
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn preexisting_donation_cannot_subsidize_short_fill_input() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        fixture();
    prepare_and_transfer(0x108, pool, escrow_address, escrow, token_a_address, token_a, AMOUNT_A);
    let funded = invoke(
        pool, escrow_address, escrow, fund_operation(token_a_address, token_b_address), 0xd09,
    );
    assert(funded.len() == 1, 'fund setup failed');

    transfer_from_pool(pool, escrow_address, token_b_address, token_b, 1);
    prepare_and_transfer(
        0x109, pool, escrow_address, escrow, token_b_address, token_b, AMOUNT_B - 1,
    );
    invoke(
        pool,
        escrow_address,
        escrow,
        EscrowOperation::Fill(FillParams { token: token_b_address }),
        0xd09,
    );
}
