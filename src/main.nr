mod types;

contract CoinToss {
    use dep::aztec::context::Context;
    use crate::types::bet_note::{BetNote, BetNoteMethods, BET_NOTE_LEN};
    use crate::types::config_note::{ConfigNote, ConfigNoteMethods, CONFIG_NOTE_LEN};
    use crate::types::result_note::{ResultNote, ResultNoteMethods, RESULT_NOTE_LEN};
 
    use crate::types::token::{
        TokenPrivateContextInterface, 
        FromTransferStruct, 
        ToTransferStruct, 
        FromEscrowStruct,
        OwnerEscrowStruct,
        RecipientSettleEscrowStruct,
        OwnerSettleEscrowStruct,
        AccountsBroadcastEscrowNoteForStruct
    };

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
    fn constructor(divinity: AztecAddress, private_oracle: AztecAddress, house: AztecAddress, token: AztecAddress, bet_amount: Field) {
        let mut config_note = ConfigNote::new(divinity, private_oracle, house, token, bet_amount);
        storage.config.initialize(&mut config_note, Option::none(), false);
    }

    // House shares off-chain with the user the preimage for an escrow note for the bet_amount and an authwit to consume it
    #[aztec(private)]
    fn create_bet(bet: bool, userTransferNonce: Field, houseEscrowRandomness: Field, houseSettleEscrowNonce: Field) {
        let sender = AztecAddress::new(context.msg_sender());
        let config_note = storage.config.get_note();
        let house = config_note.house;
        let token = config_note.token;
        let bet_amount = config_note.bet_amount;
        let address_this = AztecAddress::new(context.this_address());

        let token_contract = TokenPrivateContextInterface::at(token.address);

        // We transfer private tokens from the user to the coin toss 
        let _ = token_contract.transfer(
            &mut context,
            FromTransferStruct { address: sender.address },
            ToTransferStruct { address: address_this.address },
            bet_amount,
            userTransferNonce
        );

        // We consume the escrow from the house
        let __ = token_contract.settle_escrow(
            &mut context,
            OwnerSettleEscrowStruct { address: house.address },
            RecipientSettleEscrowStruct { address: address_this.address }, 
            houseEscrowRandomness,
            houseSettleEscrowNonce
        );

        // Create a combined escrow with both amounts
        let escrow_randomness = token_contract.escrow(
            &mut context,
            FromEscrowStruct { address: address_this.address },
            OwnerEscrowStruct { address: address_this.address },
            bet_amount * 2,
            0
        )[0];

        // Share with the user and the house
        let ___ = token_contract.broadcast_escrow_note_for(
            &mut context,
            [
                AccountsBroadcastEscrowNoteForStruct { address: sender.address },
                AccountsBroadcastEscrowNoteForStruct { address: house.address },
                AccountsBroadcastEscrowNoteForStruct { address: 0 },
                AccountsBroadcastEscrowNoteForStruct { address: 0 }
            ],
            escrow_randomness
        );

        let mut user_bet: BetNote = BetNote::new(sender, bet, escrow_randomness);
        storage.bets.insert(&mut user_bet, true);

        emit_encrypted_log(
            &mut context,
            address_this.address,
            BETS_SLOT,
            get_public_key(house.address),
            user_bet.serialize(),
        );
    }

    // Callback triggered on submit_answer in the oracle (add the result to both the user and the house).
    // data[0]: user address
    // data[1]: bet_id (the randomness generated when creating the bet note)
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

    #[aztec(private)]
    fn settle_bet(bet_id: Field) {
        // Place holder, oracle auth MUST be checked here
        // assert(ResultNote.sender.address == config_note.private_oracle.address, "Unauthorized callback");

        let config_note = storage.config.get_note();

        let house = config_note.house;
        let token = config_note.token;
        let oracle = config_note.private_oracle;
        
        let address_this = AztecAddress::new(context.this_address());
        
        let bets = storage.bets;

        let options = NoteGetterOptions::new().select(1, bet_id).set_limit(1);
        let bet_notes = bets.get_notes(options);
        
        if(bet_notes[0].is_some()) {
            let note = bet_notes[0].unwrap_unchecked();

            // Filter by bet_id and result sender (which must be the oracle)
            let result_getter_option = NoteGetterOptions::new().select(3, bet_id).select(1, oracle.address).set_limit(1);
            let result_note = storage.results.get_notes(result_getter_option)[0];

            assert(result_note.is_some(), "Invalid bet result (not settled yet or wrong oracle)");

            let result = result_note.unwrap_unchecked().result;

            // Send the bet amount to the winner
            let receiver = if(result == note.bet) { note.owner } else { house };

            // Nullify the bet note
            bets.remove(note);

            let _ = TokenPrivateContextInterface::at(token.address).settle_escrow(
                &mut context,
                OwnerSettleEscrowStruct { address: address_this.address },
                RecipientSettleEscrowStruct { address: receiver.address }, 
                note.escrow_randomness,
                0
            );
        } else {
            assert(false, "Bet not found");
        }
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