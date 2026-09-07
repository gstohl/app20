use app20_chat::maker_book::{IApp20MakerBookDispatcher, IApp20MakerBookDispatcherTrait};
use app20_chat::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use app20_chat::private_swap::{IApp20PrivateSwapDispatcher, IApp20PrivateSwapDispatcherTrait};
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_block_timestamp, cheat_caller_address,
    declare,
};
use starknet::{ContractAddress, get_tx_info};
#[derive(Copy, Drop)]
struct Context {
    swap: IApp20PrivateSwapDispatcher,
    book: IApp20MakerBookDispatcher,
    sell: IMockErc20Dispatcher,
    buy: IMockErc20Dispatcher,
}
fn addr(n: felt252) -> ContractAddress {
    n.try_into().unwrap()
}
fn caller(target: ContractAddress, n: felt252) {
    cheat_caller_address(target, addr(n), CheatSpan::Indefinite);
}
fn token() -> IMockErc20Dispatcher {
    let class = declare("MockErc20").unwrap().contract_class();
    let (address, _) = class.deploy(@array![51, 1000, 0]).unwrap();
    IMockErc20Dispatcher { contract_address: address }
}
fn setup() -> Context {
    let class = declare("App20MakerBook").unwrap().contract_class();
    let (book_addr, _) = class.deploy(@array![]).unwrap();
    let book = IApp20MakerBookDispatcher { contract_address: book_addr };
    let class = declare("App20PrivateSwap").unwrap().contract_class();
    let (swap_addr, _) = class.deploy(@array![99, book_addr.into()]).unwrap();
    let swap = IApp20PrivateSwapDispatcher { contract_address: swap_addr };
    cheat_block_timestamp(book_addr, 1000, CheatSpan::Indefinite);
    cheat_block_timestamp(swap_addr, 1000, CheatSpan::Indefinite);
    caller(book_addr, 51);
    book.register(11, 22, 4000);
    let ctx = Context { swap, book, sell: token(), buy: token() };
    cheat_caller_address(ctx.buy.contract_address, addr(51), CheatSpan::TargetCalls(1));
    ctx.buy.approve(swap_addr, 100);
    caller(swap_addr, 51);
    swap.deposit_inventory(ctx.buy.contract_address, 100);
    ctx
}
fn commitment(ctx: Context) -> felt252 {
    poseidon_hash_span(
        array![
            'APP20_SWAP_SECRET_V1', get_tx_info().unbox().chain_id,
            ctx.swap.contract_address.into(), 123,
        ]
            .span(),
    )
}
fn reserve(ctx: Context, id: felt252, amount: u128) {
    caller(ctx.book.contract_address, 71);
    ctx.book.request(id, addr(51), 1, 3000, array![1, 2, 3]);
    caller(ctx.swap.contract_address, 51);
    ctx
        .swap
        .reserve_quote(
            id,
            ctx.sell.contract_address,
            ctx.buy.contract_address,
            10,
            amount,
            commitment(ctx),
            2000,
        );
}
fn pay(ctx: Context, n: u256) {
    cheat_caller_address(ctx.sell.contract_address, addr(51), CheatSpan::TargetCalls(1));
    ctx.sell.transfer(ctx.swap.contract_address, n);
}
fn fill(ctx: Context, id: felt252) {
    caller(ctx.swap.contract_address, 99);
    let deposits = ctx.swap.privacy_invoke(id, 123, id + 100);
    assert(deposits.len() == 1, 'OUTPUT_COUNT');
    let deposit = *deposits.at(0);
    assert(
        deposit.token == ctx.buy.contract_address && deposit.note_id == id + 100, 'OUTPUT_BINDING',
    );
}
#[test]
fn inventory_is_reserved_then_paid_and_proceeds_withdrawable() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    assert(ctx.swap.available(addr(51), ctx.buy.contract_address) == 80, 'RESERVATION');
    pay(ctx, 10);
    fill(ctx, 1);
    assert(ctx.swap.quote(1).status == 2, 'FILLED');
    assert(ctx.swap.available(addr(51), ctx.sell.contract_address) == 10, 'EARNED');
    cheat_caller_address(ctx.buy.contract_address, addr(99), CheatSpan::TargetCalls(1));
    ctx.buy.transfer_from(ctx.swap.contract_address, addr(99), 20);
    assert(ctx.buy.balance_of(addr(99)) == 20, 'POOL_OUTPUT');
    caller(ctx.swap.contract_address, 51);
    ctx.swap.withdraw_inventory(ctx.sell.contract_address, 10);
    assert(ctx.sell.balance_of(addr(51)) == 1000, 'PROCEEDS');
    assert(ctx.swap.liability(ctx.sell.contract_address) == 0, 'LIABILITY');
}
#[test]
fn multiple_outputs_keep_pending_pool_allowance_reserved() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    reserve(ctx, 2, 30);
    pay(ctx, 20);
    fill(ctx, 1);
    fill(ctx, 2);
    assert(ctx.buy.allowance(ctx.swap.contract_address, addr(99)) == 50, 'OUTPUT_ALLOWANCE');
    assert(ctx.swap.liability(ctx.buy.contract_address) == 50, 'REMAINING_BACKING');
    caller(ctx.swap.contract_address, 51);
    ctx.swap.withdraw_inventory(ctx.buy.contract_address, 50);
    cheat_caller_address(ctx.buy.contract_address, addr(99), CheatSpan::TargetCalls(1));
    ctx.buy.transfer_from(ctx.swap.contract_address, addr(99), 50);
    assert(ctx.buy.balance_of(ctx.swap.contract_address) == 0, 'CONSERVATION');
}
#[test]
fn anyone_can_release_expiry_but_only_maker_receives_credit() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    cheat_block_timestamp(ctx.swap.contract_address, 2000, CheatSpan::Indefinite);
    caller(ctx.swap.contract_address, 77);
    ctx.swap.release_expired(1);
    assert(ctx.swap.available(addr(51), ctx.buy.contract_address) == 100, 'RETURNED');
    assert(ctx.swap.available(addr(77), ctx.buy.contract_address) == 0, 'NOT_STOLEN');
    assert(ctx.swap.quote(1).status == 3, 'RELEASED');
}
#[test]
#[should_panic(expected: ('UNAVAILABLE',))]
fn cannot_quote_more_than_inventory() {
    let ctx = setup();
    reserve(ctx, 1, 101);
}
#[test]
#[should_panic(expected: ('UNAVAILABLE',))]
fn reservations_cannot_double_spend_inventory() {
    let ctx = setup();
    reserve(ctx, 1, 60);
    reserve(ctx, 2, 60);
}
#[test]
#[should_panic(expected: ('UNAVAILABLE',))]
fn maker_cannot_withdraw_reserved_funds() {
    let ctx = setup();
    reserve(ctx, 1, 100);
    ctx.swap.withdraw_inventory(ctx.buy.contract_address, 1);
}
#[test]
#[should_panic(expected: ('UNAVAILABLE',))]
fn another_account_cannot_withdraw_inventory() {
    let ctx = setup();
    caller(ctx.swap.contract_address, 77);
    ctx.swap.withdraw_inventory(ctx.buy.contract_address, 1);
}
#[test]
#[should_panic(expected: ('ONLY_POOL',))]
fn public_account_cannot_fill() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    pay(ctx, 10);
    ctx.swap.privacy_invoke(1, 123, 2);
}
#[test]
#[should_panic(expected: ('MISSING_PAYMENT',))]
fn no_payment_no_fill() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    fill(ctx, 1);
}
#[test]
#[should_panic(expected: ('MISSING_PAYMENT',))]
fn previously_earned_proceeds_cannot_fund_another_fill() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    reserve(ctx, 2, 20);
    pay(ctx, 10);
    fill(ctx, 1);
    fill(ctx, 2);
}
#[test]
#[should_panic(expected: ('BAD_SECRET',))]
fn wrong_authorization_cannot_fill() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    pay(ctx, 10);
    caller(ctx.swap.contract_address, 99);
    ctx.swap.privacy_invoke(1, 124, 2);
}
#[test]
#[should_panic(expected: ('NOT_RESERVED',))]
fn filled_quote_is_single_use() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    pay(ctx, 20);
    fill(ctx, 1);
    fill(ctx, 1);
}
#[test]
#[should_panic(expected: ('EXPIRED',))]
fn expiry_boundary_disallows_fill() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    pay(ctx, 10);
    cheat_block_timestamp(ctx.swap.contract_address, 2000, CheatSpan::Indefinite);
    fill(ctx, 1);
}
#[test]
#[should_panic(expected: ('NOT_EXPIRED',))]
fn maker_cannot_revoke_a_live_quote() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    ctx.swap.release_expired(1);
}
#[test]
#[should_panic(expected: ('NOT_RESERVED',))]
fn refund_is_single_use() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    cheat_block_timestamp(ctx.swap.contract_address, 2000, CheatSpan::Indefinite);
    ctx.swap.release_expired(1);
    ctx.swap.release_expired(1);
}
#[test]
#[should_panic(expected: ('ZERO_SECRET_OR_NOTE',))]
fn zero_output_note_rejected() {
    let ctx = setup();
    reserve(ctx, 1, 20);
    pay(ctx, 10);
    caller(ctx.swap.contract_address, 99);
    ctx.swap.privacy_invoke(1, 123, 0);
}
