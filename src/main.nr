mod types;

contract CoinToss {
    use dep::aztec::context::Context;
    use crate::types::bet_note::{BetNote, BetNoteMethods, BET_NOTE_LEN};
    use crate::types::bet_amount_note::{BetAmountNote, BetAmountNoteMethods, BET_AMOUNT_NOTE_LEN};
    use crate::types::address_note::{AddressNote, AddressNoteMethods, ADDRESS_NOTE_LEN};

    use dep::aztec::note::{
        note_getter_options::NoteGetterOptions,
        note_header::NoteHeader,
        note_interface::NoteInterface,
        note_viewer_options::NoteViewerOptions,
        utils as note_utils
    };

    use dep::std::option::Option;

    use dep::aztec::log::emit_encrypted_log;
    use dep::aztec::oracle::{
        get_public_key::get_public_key,
        rand::rand
    };
    use dep::aztec::state_vars::{
        public_state::PublicState,
        map::Map,
        set::Set,
        singleton::Singleton,
        immutable_singleton::ImmutableSingleton
    };
    use dep::aztec::selector::compute_selector;

    use dep::aztec::types::type_serialization::field_serialization::{ FieldSerializationMethods, FIELD_SERIALIZED_LEN};
    use dep::aztec::types::type_serialization::aztec_address_serialization::{AztecAddressSerializationMethods, AZTEC_ADDRESS_SERIALIZED_LEN};

    use dep::aztec::types::address::AztecAddress;


    global BET_AMOUNT_SLOT = 1;
    global DIVINITY_ADDRESS_SLOT = 2;
    global PRIVATE_ORACLE_ADDRESS_SLOT = 3;
    global HOUSE_ADDRESS_SLOT = 4;
    global BETS_SLOT = 5;

    // TODO: add slow update tree to make the switch from private to public
    struct Storage {
        bet_amount: ImmutableSingleton<BetAmountNote, BET_AMOUNT_NOTE_LEN>,
        divinity: ImmutableSingleton<AddressNote, ADDRESS_NOTE_LEN>,
        private_oracle: ImmutableSingleton<AddressNote, ADDRESS_NOTE_LEN>,
        house: ImmutableSingleton<AddressNote, ADDRESS_NOTE_LEN>,
        bets: Set<BetNote, BET_NOTE_LEN>,
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
                bet_amount: ImmutableSingleton::new(
                    context,
                    BET_AMOUNT_SLOT,
                    BetAmountNoteMethods,
                ),
                divinity: ImmutableSingleton::new(
                    context,
                    DIVINITY_ADDRESS_SLOT,
                    AddressNoteMethods,
                ),
                private_oracle: ImmutableSingleton::new(
                    context,
                    PRIVATE_ORACLE_ADDRESS_SLOT,
                    AddressNoteMethods,
                ),
                house: ImmutableSingleton::new(
                    context,
                    HOUSE_ADDRESS_SLOT,
                    AddressNoteMethods,
                ),
                bets: Set::new(context, BETS_SLOT, BetNoteMethods)
            }
        }
    }

    // Constructs the contract.
    #[aztec(private)]
    fn constructor(bet_amount: Field, divinity: AztecAddress, private_oracle: AztecAddress, house: AztecAddress) {
        let mut bet_amount_note = BetAmountNote::new(bet_amount);
        storage.bet_amount.initialize(&mut bet_amount_note, Option::none(), false);

        let mut divinity_note = AddressNote::new(divinity);
        storage.divinity.initialize(&mut divinity_note, Option::none(), false);

        let mut private_oracle_note = AddressNote::new(private_oracle);
        storage.private_oracle.initialize(&mut private_oracle_note, Option::none(), false);

        let mut house_note = AddressNote::new(house);
        storage.house.initialize(&mut house_note, Option::none(), false);
    }

    #[aztec(private)]
    fn create_bet(bet: bool) {
        let sender = AztecAddress::new(context.msg_sender());
        let house = storage.house.get_note().address;

        let mut user_bet: BetNote = BetNote::new(sender, bet);
        storage.bets.insert(&mut user_bet, true);

        // // TODO: should check for funds availability
        let mut house_bet: BetNote = BetNote::new(house, !bet);
        storage.bets.insert(&mut house_bet, true);
    }

    // Returns the bet amount
    unconstrained fn get_bet_amount_unconstrained() -> BetAmountNote {
        storage.bet_amount.view_note()
    }

    // Returns the divinity address
    unconstrained fn get_divinity_unconstrained() -> AddressNote {
        storage.divinity.view_note()
    }

    // Returns the private oracle address
    unconstrained fn get_private_oracle_unconstrained() -> AddressNote {
        storage.private_oracle.view_note()
    }

    // Returns the house address
    unconstrained fn get_house_unconstrained() -> AddressNote {
        storage.house.view_note()
    }

    unconstrained fn get_user_bets_unconstrained(user: AztecAddress, start_offset: u32) -> [Option<BetNote>; 10] {
        // MAX_NOTES_PER_PAGE == 10
        // https://github.com/AztecProtocol/aztec-packages/blob/2d498b352364debf59af940f0a69c453651a4ad0/yarn-project/aztec-nr/aztec/src/constants_gen.nr#L53

        // create the filter - limiting to 10 for future compatibility
        let user_bets_getter_option = NoteViewerOptions::new().select(0, user.address).set_offset(start_offset).set_limit(10);

        // filter the notes and return the answer-
        storage.bets.view_notes(user_bets_getter_option)
    }

    // Computes note hash and nullifier.
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; BET_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);

        if(storage_slot == BET_AMOUNT_SLOT) {
            note_utils::compute_note_hash_and_nullifier(BetAmountNoteMethods, note_header, preimage)
        } else if(storage_slot == BETS_SLOT) {
            note_utils::compute_note_hash_and_nullifier(BetNoteMethods, note_header, preimage)
        }
         else {
            note_utils::compute_note_hash_and_nullifier(AddressNoteMethods, note_header, preimage)
        }
    }
}