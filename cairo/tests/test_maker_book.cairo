use app20_chat::maker_book::{IApp20MakerBookDispatcher, IApp20MakerBookDispatcherTrait};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_block_timestamp, cheat_caller_address,
    declare,
};
fn setup() -> IApp20MakerBookDispatcher {
    let class = declare("App20MakerBook").unwrap().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap();
    cheat_block_timestamp(address, 1000, CheatSpan::Indefinite);
    IApp20MakerBookDispatcher { contract_address: address }
}
fn caller(book: IApp20MakerBookDispatcher, address: felt252) {
    cheat_caller_address(book.contract_address, address.try_into().unwrap(), CheatSpan::Indefinite);
}
fn register(book: IApp20MakerBookDispatcher, who: felt252) {
    caller(book, who);
    book.register(11, 22, 2000);
}
fn request(book: IApp20MakerBookDispatcher) {
    caller(book, 42);
    book.request(123, 7.try_into().unwrap(), 1, 1500, array![1, 2, 3]);
}
#[test]
fn independent_makers_register_without_admin() {
    let book = setup();
    register(book, 7);
    register(book, 8);
    assert(book.maker_count() == 2, 'COUNT');
    assert(book.maker_at(0) == 7.try_into().unwrap(), 'FIRST');
    assert(book.maker_at(1) == 8.try_into().unwrap(), 'SECOND');
    register(book, 7);
    assert(book.maker_count() == 2, 'DUPLICATE');
    assert(book.maker(7.try_into().unwrap()).revision == 2, 'REVISION');
}
#[test]
fn request_and_encrypted_response() {
    let book = setup();
    register(book, 7);
    request(book);
    caller(book, 7);
    book.respond(123, array![4, 5, 6]);
    let record = book.get_request(123);
    assert(record.status == 2 && record.taker == 42.try_into().unwrap(), 'RESPONSE');
}
#[test]
#[should_panic(expected: ('ONLY_MAKER',))]
fn another_maker_cannot_answer() {
    let book = setup();
    register(book, 7);
    register(book, 8);
    request(book);
    caller(book, 8);
    book.respond(123, array![4, 5, 6]);
}
#[test]
#[should_panic(expected: ('REQUEST_CLOSED',))]
fn responses_cannot_be_replayed() {
    let book = setup();
    register(book, 7);
    request(book);
    caller(book, 7);
    book.respond(123, array![4, 5, 6]);
    book.respond(123, array![4, 5, 6]);
}
#[test]
#[should_panic(expected: ('REQUEST_EXISTS',))]
fn request_ids_are_single_use() {
    let book = setup();
    register(book, 7);
    request(book);
    request(book);
}
#[test]
#[should_panic(expected: ('INACTIVE_KEY',))]
fn rotation_invalidates_pending_request() {
    let book = setup();
    register(book, 7);
    request(book);
    register(book, 7);
    book.respond(123, array![4, 5, 6]);
}
#[test]
#[should_panic(expected: ('INACTIVE_KEY',))]
fn deactivation_prevents_new_requests() {
    let book = setup();
    register(book, 7);
    book.deactivate();
    request(book);
}
#[test]
#[should_panic(expected: ('REQUEST_CLOSED',))]
fn expired_request_cannot_be_answered() {
    let book = setup();
    register(book, 7);
    request(book);
    cheat_block_timestamp(book.contract_address, 1500, CheatSpan::Indefinite);
    caller(book, 7);
    book.respond(123, array![4, 5, 6]);
}
#[test]
#[should_panic(expected: ('ONLY_TAKER',))]
fn cancellation_requires_request_owner() {
    let book = setup();
    register(book, 7);
    request(book);
    caller(book, 8);
    book.cancel(123);
}
#[test]
#[should_panic(expected: ('REQUEST_CLOSED',))]
fn cancellation_prevents_response() {
    let book = setup();
    register(book, 7);
    request(book);
    book.cancel(123);
    caller(book, 7);
    book.respond(123, array![4, 5, 6]);
}
#[test]
#[should_panic(expected: ('BAD_EXPIRY',))]
fn request_cannot_outlive_key() {
    let book = setup();
    register(book, 7);
    caller(book, 42);
    book.request(123, 7.try_into().unwrap(), 1, 2001, array![1, 2, 3]);
}
#[test]
#[should_panic(expected: ('BAD_PAYLOAD_SIZE',))]
fn oversized_payload_is_rejected() {
    let book = setup();
    register(book, 7);
    caller(book, 42);
    let mut payload = array![];
    for _ in 0_u32..141_u32 {
        payload.append(1);
    }
    book.request(123, 7.try_into().unwrap(), 1, 1500, payload);
}
