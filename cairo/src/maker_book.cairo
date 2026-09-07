use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Maker {
    pub x: u256,
    pub y: u256,
    pub revision: u64,
    pub valid_until: u64,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Request {
    pub taker: ContractAddress,
    pub maker: ContractAddress,
    pub revision: u64,
    pub expires_at: u64,
    pub status: u8 // 0 absent, 1 open, 2 answered, 3 cancelled
}

#[starknet::interface]
pub trait IApp20MakerBook<T> {
    fn register(ref self: T, x: u256, y: u256, valid_until: u64);
    fn deactivate(ref self: T);
    fn maker(self: @T, account: ContractAddress) -> Maker;
    fn maker_count(self: @T) -> u64;
    fn maker_at(self: @T, index: u64) -> ContractAddress;
    fn request(
        ref self: T,
        id: felt252,
        maker: ContractAddress,
        revision: u64,
        expires_at: u64,
        payload: Array<felt252>,
    );
    fn respond(ref self: T, id: felt252, payload: Array<felt252>);
    fn cancel(ref self: T, id: felt252);
    fn get_request(self: @T, id: felt252) -> Request;
}

/// Permissionless discovery and encrypted quote transport. No custody, fees,
/// reservation guarantees, or settlement authority. Quotes are indicative.
#[starknet::contract]
pub mod App20MakerBook {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use super::{Maker, Request};

    #[storage]
    struct Storage {
        makers: Map<ContractAddress, Maker>,
        accounts: Map<u64, ContractAddress>,
        count: u64,
        requests: Map<felt252, Request>,
    }
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MakerUpdated: MakerUpdated,
        Requested: Requested,
        Responded: Responded,
        Cancelled: Cancelled,
    }
    #[derive(Drop, starknet::Event)]
    pub struct MakerUpdated {
        #[key]
        pub account: ContractAddress,
        pub revision: u64,
        pub valid_until: u64,
    }
    #[derive(Drop, starknet::Event)]
    pub struct Requested {
        #[key]
        pub maker: ContractAddress,
        #[key]
        pub id: felt252,
        pub taker: ContractAddress,
        pub revision: u64,
        pub expires_at: u64,
        pub payload: Span<felt252>,
    }
    #[derive(Drop, starknet::Event)]
    pub struct Responded {
        #[key]
        pub id: felt252,
        #[key]
        pub maker: ContractAddress,
        pub payload: Span<felt252>,
    }
    #[derive(Drop, starknet::Event)]
    pub struct Cancelled {
        #[key]
        pub id: felt252,
    }

    fn check_payload(payload: Span<felt252>) {
        assert(payload.len() >= 3 && payload.len() <= 140, 'BAD_PAYLOAD_SIZE');
    }

    #[abi(embed_v0)]
    impl Impl of super::IApp20MakerBook<ContractState> {
        fn register(ref self: ContractState, x: u256, y: u256, valid_until: u64) {
            let caller = get_caller_address();
            assert(caller != 0.try_into().unwrap(), 'ZERO_CALLER');
            let now = get_block_timestamp();
            assert(valid_until > now && valid_until - now <= 2592000, 'BAD_KEY_EXPIRY');
            assert(x != 0 && y != 0, 'ZERO_KEY');
            // Clients additionally validate that this is a P-256 curve point.
            let previous = self.makers.read(caller);
            if previous.revision == 0 {
                let index = self.count.read();
                self.accounts.write(index, caller);
                self.count.write(index + 1);
            }
            let revision = previous.revision + 1;
            self.makers.write(caller, Maker { x, y, revision, valid_until });
            self.emit(MakerUpdated { account: caller, revision, valid_until });
        }
        fn deactivate(ref self: ContractState) {
            let caller = get_caller_address();
            let previous = self.makers.read(caller);
            assert(previous.revision != 0, 'UNKNOWN_MAKER');
            let revision = previous.revision + 1;
            self.makers.write(caller, Maker { revision, valid_until: 0, ..previous });
            self.emit(MakerUpdated { account: caller, revision, valid_until: 0 });
        }
        fn maker(self: @ContractState, account: ContractAddress) -> Maker {
            self.makers.read(account)
        }
        fn maker_count(self: @ContractState) -> u64 {
            self.count.read()
        }
        fn maker_at(self: @ContractState, index: u64) -> ContractAddress {
            assert(index < self.count.read(), 'BAD_INDEX');
            self.accounts.read(index)
        }
        fn request(
            ref self: ContractState,
            id: felt252,
            maker: ContractAddress,
            revision: u64,
            expires_at: u64,
            payload: Array<felt252>,
        ) {
            assert(id != 0 && self.requests.read(id).status == 0, 'REQUEST_EXISTS');
            let key = self.makers.read(maker);
            let now = get_block_timestamp();
            assert(
                key.revision != 0 && key.revision == revision && key.valid_until > now,
                'INACTIVE_KEY',
            );
            assert(
                expires_at > now && expires_at - now <= 3600 && expires_at <= key.valid_until,
                'BAD_EXPIRY',
            );
            check_payload(payload.span());
            let taker = get_caller_address();
            self.requests.write(id, Request { taker, maker, revision, expires_at, status: 1 });
            self
                .emit(
                    Requested { maker, id, taker, revision, expires_at, payload: payload.span() },
                );
        }
        fn respond(ref self: ContractState, id: felt252, payload: Array<felt252>) {
            let record = self.requests.read(id);
            let now = get_block_timestamp();
            assert(record.status == 1 && record.expires_at > now, 'REQUEST_CLOSED');
            assert(record.maker == get_caller_address(), 'ONLY_MAKER');
            let key = self.makers.read(record.maker);
            assert(key.revision == record.revision && key.valid_until > now, 'INACTIVE_KEY');
            check_payload(payload.span());
            self.requests.write(id, Request { status: 2, ..record });
            self.emit(Responded { id, maker: record.maker, payload: payload.span() });
        }
        fn cancel(ref self: ContractState, id: felt252) {
            let record = self.requests.read(id);
            assert(record.status == 1, 'REQUEST_CLOSED');
            assert(record.taker == get_caller_address(), 'ONLY_TAKER');
            self.requests.write(id, Request { status: 3, ..record });
            self.emit(Cancelled { id });
        }
        fn get_request(self: @ContractState, id: felt252) -> Request {
            self.requests.read(id)
        }
    }
}
