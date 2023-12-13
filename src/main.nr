mod types;

contract CoinToss {
    use dep::aztec::context::Context;
    use crate::types::bet_note::{BetNote, BetNoteMethods, BET_NOTE_LEN};
    use crate::types::config_note::{ConfigNote, ConfigNoteMethods, CONFIG_NOTE_LEN};
    use crate::types::result_note::{ResultNote, ResultNoteMethods, RESULT_NOTE_LEN};
 
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
        immutable_singleton::ImmutableSingleton
    };
    use dep::aztec::selector::compute_selector;
    use dep::aztec::types::address::AztecAddress;

    global CONFIG_NOTE_SLOT = 1;
    global BETS_SLOT = 2;
    global RESULT_SLOT = 3;

    // TODO: add slow update tree to make the switch from private to public
    struct Storage {
        config: ImmutableSingleton<ConfigNote, CONFIG_NOTE_LEN>,
        bets: Set<BetNote, BET_NOTE_LEN>,
        results: Set<ResultNote, RESULT_NOTE_LEN>
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
                config: ImmutableSingleton::new(
                    context,
                    CONFIG_NOTE_SLOT,
                    ConfigNoteMethods,
                ),
                bets: Set::new(context, BETS_SLOT, BetNoteMethods),
                results: Set::new(context, RESULT_SLOT, ResultNoteMethods)
            }
        }
    }

    // Constructs the contract.
    #[aztec(private)]
    fn constructor(divinity: AztecAddress, private_oracle: AztecAddress, house: AztecAddress, bet_amount: Field) {
        let mut config_note = ConfigNote::new(divinity, private_oracle, house, bet_amount);
        storage.config.initialize(&mut config_note, Option::none(), false);
    }

    #[aztec(private)]
    fn create_bet(bet: bool) {s
        let sender = AztecAddress::new(context.msg_sender());
        let house = storage.config.get_note().house;
        let address_this = AztecAddress::new(context.this_address()).address;

        let mut user_bet: BetNote = BetNote::new(sender, bet);
        storage.bets.insert(&mut user_bet, true);

        emit_encrypted_log(
            &mut context,
            address_this,
            BETS_SLOT,
            get_public_key(house.address),
            user_bet.serialize(),
        );
    }

    #[aztec(private)]
    fn settle_bet(bet_id: Field) {
        let sender = AztecAddress::new(context.msg_sender());

        let config = storage.config.view_note();
        let oracle = config.private_oracle.address;

        let bet_getter_option = NoteGetterOptions::new().select(1, bet_id).set_limit(1);
        let bet_note = storage.results.get_notes(bet_getter_option)[0];

        // Filter by bet_id and result sender (which must be the oracle)
        let result_getter_option = NoteGetterOptions::new().select(3, bet_id).select(1, oracle).set_limit(1);
        let result_note = storage.results.get_notes(result_getter_option)[0];

        
    }

    // Callback triggered on submit_answer in the oracle (add the result to both the user and the house).
    // data[0]: user address
    // data[1]: bet_id (the random id generated when creating the bet note)
    // data[2]: house address
    // data[2:5]: unused
    #[aztec(private)]
    fn oracle_callback(answer: Field, data: [Field; 5]) {
        let sender = AztecAddress::new(context.msg_sender());

        let mut result_note_user = ResultNote::new(AztecAddress::new(data[0]), sender, data[1], answer as bool);
        let mut result_note_house = ResultNote::new(AztecAddress::new(data[2]), sender, data[1], answer as bool);

        storage.results.insert(&mut result_note_user, true);
        storage.results.insert(&mut result_note_house, true);
    }

    // Returns the divinity address
    unconstrained fn get_config_unconstrained() -> ConfigNote {
        storage.config.view_note()
    }

    unconstrained fn get_user_bets_unconstrained(user: AztecAddress, start_offset: u32) -> [Option<BetNote>; 10] {
        let user_bets_getter_option = NoteViewerOptions::new().select(0, user.address).set_offset(start_offset);
        storage.bets.view_notes(user_bets_getter_option)
    }

    unconstrained fn get_results_unconstrained(owner: AztecAddress, start_offset: u32) -> [Option<ResultNote>; 10] {
        let results_getter_option = NoteViewerOptions::new().select(0, owner.address).set_offset(start_offset);
        storage.results.view_notes(results_getter_option)
    }

    // Computes note hash and nullifier.
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; CONFIG_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);

        if(storage_slot == BETS_SLOT) {
            note_utils::compute_note_hash_and_nullifier(BetNoteMethods, note_header, preimage)
        } else if(storage_slot == RESULT_SLOT) {
            note_utils::compute_note_hash_and_nullifier(ResultNoteMethods, note_header, preimage)
        } else {
            note_utils::compute_note_hash_and_nullifier(ConfigNoteMethods, note_header, preimage)
        }
    }
}