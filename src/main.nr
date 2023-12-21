mod types;

/// @notice This contract implements a private coin toss game between an user and a single party (the "house").
/// @dev The contract is deployed with a bet_amount and a private oracle.
///      The user can create a bet note with a bet (true or false) which is later settled by the private oracle.
///      Either the house or the user, based on the result, receive the bet_amount.
contract CoinToss {

    /////////////////////////////////////////////////////////////////////
    //                             Imports                             //
    /////////////////////////////////////////////////////////////////////

    use crate::types::{
        bet_note::{BetNote, BetNoteMethods, BET_NOTE_LEN},
        config_note::{ConfigNote, ConfigNoteMethods, CONFIG_NOTE_LEN},
        result_note::{ResultNote, ResultNoteMethods, RESULT_NOTE_LEN},
        token::{
            AccountsBroadcastEscrowNoteForStruct,
            FromEscrowStruct,
            FromTransferStruct, 
            OwnerEscrowStruct,
            OwnerSettleEscrowStruct,
            RecipientSettleEscrowStruct,
            TokenPrivateContextInterface, 
            ToTransferStruct
        }
    };

    use dep::aztec::{
        context::Context,
        log::emit_encrypted_log,
        note::{
            note_getter_options::NoteGetterOptions,
            note_header::NoteHeader,
            note_viewer_options::NoteViewerOptions,
            utils as note_utils
        },
        oracle::{
            get_public_key::get_public_key,
            rand::rand
        },
        selector::compute_selector,
        state_vars::{
            immutable_singleton::ImmutableSingleton,
            set::Set
        },
        types::address::AztecAddress
    };

    use dep::std::option::Option;

    /////////////////////////////////////////////////////////////////////
    //                             Storage                             //
    /////////////////////////////////////////////////////////////////////

    global CONFIG_NOTE_SLOT = 1;
    global BETS_SLOT = 2;
    global RESULT_SLOT = 3;

    /// @member config The config note, containing the divinity address, the private oracle address, the house address, the token address and the bet amount
    /// @member bets The set of bet notes (ie active bets)
    /// @member results The set of result notes (ie settled bets)
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

    /////////////////////////////////////////////////////////////////////
    //                           Constructor                           //
    /////////////////////////////////////////////////////////////////////

    /// @notice         Constructor for the contract, setting the config note
    /// @custom:privacy private
    /// @param          divinity The divinity address, invoked by the oracle
    /// @param          private_oracle The private oracle contract address
    /// @param          house The house address (ie the other party in every bet)
    /// @param          token The token used to bet
    /// @param          bet_amount The bet amount
    #[aztec(private)]
    fn constructor(divinity: AztecAddress, private_oracle: AztecAddress, house: AztecAddress, token: AztecAddress, bet_amount: Field) {
        let mut config_note = ConfigNote::new(divinity, private_oracle, house, token, bet_amount);
        storage.config.initialize(&mut config_note, Option::none(), false);
    }

    /////////////////////////////////////////////////////////////////////
    //                   Private external functions                    //
    /////////////////////////////////////////////////////////////////////

    /// @notice         Creates a bet
    /// @custom:privacy private
    /// @dev            House shares off-chain with the user the preimage for an escrow note for the bet_amount and an authwit to consume it
    /// @param          bet The bet outcome (true or false)
    /// @param          user_transfer_nonce The nonce used for transferring the bet amount from the user to the contract
    /// @param          house_escrow The house escrow 
    /// @param          settle_escrow_nonce The settle escrow nonce
    #[aztec(private)]
    fn create_bet(bet: bool, user_transfer_nonce: Field, house_escrow: Field, settle_escrow_nonce: Field) {
        let sender = AztecAddress::new(context.msg_sender());
        let config_note = storage.config.get_note();
        let house = config_note.house;
        let bet_amount = config_note.bet_amount;
        let address_this = AztecAddress::new(context.this_address());
        let token_contract = TokenPrivateContextInterface::at(config_note.token.address);

        // We transfer private tokens from the user to the coin toss contract (this)
        let _ = token_contract.transfer(
            &mut context,
            FromTransferStruct { address: sender.address },
            ToTransferStruct { address: address_this.address },
            bet_amount,
            user_transfer_nonce
        );

        // Check that the escrow provided has the correct amount of tokens
        let house_escrow_note = token_contract.get_escrow(
            &mut context,
            house_escrow
        )[0];

        assert(house_escrow_note == bet_amount, "Invalid escrow amount");

        // Create a new escrow between the user and the house
        let emit_escrow_selector = compute_selector("_create_bet_escrow((Field),Field,Field)");
        
        let escrow_randomness = context.call_private_function(
            address_this.address,
            emit_escrow_selector,
            [sender.address, house_escrow, settle_escrow_nonce])[0];
        
        // Create the bet note and send it to both user and house. Use the escrow randomness as bet_id
        let mut user_bet: BetNote = BetNote::new(sender, escrow_randomness, bet);
        storage.bets.insert(&mut user_bet, true);

        emit_encrypted_log(
            &mut context,
            address_this.address,
            BETS_SLOT,
            get_public_key(house.address),
            user_bet.serialize(),
        );
    }

    /// @notice         Callback from the oracle, creating the result note
    /// @dev            This callback is triggered on private_oracle::submit_answer, from the oracle (add the result to both the user and the house).
    ///                 The result note is created with the following data, coming from the callback:
    ///                 data[0]: user address
    ///                 data[1]: bet_id (the randomness generated when creating the escrow)
    ///                 data[2]: house address
    ///                 data[3:5]: unused
    ///                 This callback can be called by any address, but the caller is part of the result note (and constrained when settling the bet)
    /// @custom:privacy private
    /// @param          answer The bet result (true or false) from the oracle
    /// @param          data The data from the callback, used to create the note
    #[aztec(private)]
    fn oracle_callback(answer: Field, data: [Field; 5]) {
        let sender = AztecAddress::new(context.msg_sender());

        // Note with owner := user
        let mut result_note_user = ResultNote::new(AztecAddress::new(data[0]), sender, data[1], answer as bool);

        // Note with owner := house
        let mut result_note_house = ResultNote::new(AztecAddress::new(data[2]), sender, data[1], answer as bool);

        // Commmit and emit both result notes
        storage.results.insert(&mut result_note_user, true);
        storage.results.insert(&mut result_note_house, true);
    }

    /// @notice         Settles a bet (send the token to the winner and remove it from the active bets)
    /// @custom:privacy private
    /// @dev            The bet is settled by the oracle (which ask the divinity), which sends the result to the contract in the oracle callback
    ///                 The contract then checks the result and sends the bet amount to the winner.
    /// @param          bet_id The bet id to settle
    #[aztec(private)]
    fn settle_bet(bet_id: Field) {
        let config_note = storage.config.get_note();

        let house = config_note.house;
        let token = config_note.token;
        let oracle = config_note.private_oracle;

        let address_this = AztecAddress::new(context.this_address());

        let bets = storage.bets;

        // Get the bet note, filtered by bet_id
        let options = NoteGetterOptions::new().select(1, bet_id).set_limit(1);
        let bet_notes = bets.get_notes(options);
        
        // Check if the bet exists
        if(bet_notes[0].is_some()) {
            let note = bet_notes[0].unwrap_unchecked();

            // Filter by bet_id and result sender, only keep the results sent by the oracle
            let result_getter_option = NoteGetterOptions::new().select(2, bet_id).select(1, oracle.address).set_limit(1);
            let result_note = storage.results.get_notes(result_getter_option)[0];

            assert(result_note.is_some(), "Invalid bet result (not settled yet or wrong oracle)");

            let result = result_note.unwrap_unchecked().result;

            // Send the bet amount to the winner
            let receiver = if(result == note.bet) { note.owner } else { house };

            let _ = TokenPrivateContextInterface::at(token.address).settle_escrow(
                &mut context,
                OwnerSettleEscrowStruct { address: address_this.address },
                RecipientSettleEscrowStruct { address: receiver.address }, 
                bet_id,
                0
            );

            // Nullify the bet note
            bets.remove(note);
        } else {
            assert(false, "Bet not found");
        }
    }

    /////////////////////////////////////////////////////////////////////
    //                   Private internal functions                    //
    /////////////////////////////////////////////////////////////////////

    /// @notice         Internal function to create an escrowed token amount for a bet
    /// @dev            This function consumes the escrow from the house, creates a combined escrow with both amounts, and shares it with the user and the house.
    /// @custom:privacy internal
    /// @param          sender The address of the sender
    /// @param          house_escrow The house escrow 
    /// @param          settle_escrow_nonce The settle escrow nonce
    /// @return         The escrow randomness, used as bet_id too
    #[aztec(private)]
    #[internal]
    fn _create_bet_escrow(
        sender: AztecAddress,
        house_escrow: Field,
        settle_escrow_nonce: Field
    ) -> Field {
        let address_this = AztecAddress::new(context.this_address());
        let config_note = storage.config.get_note();

        let token_contract = TokenPrivateContextInterface::at(config_note.token.address);

        // We consume the escrow from the house
        let __ = token_contract.settle_escrow(
            &mut context,
            OwnerSettleEscrowStruct { address: config_note.house.address },
            RecipientSettleEscrowStruct { address: address_this.address }, 
            house_escrow,
            settle_escrow_nonce
        );

        // Create a combined escrow with both amounts
        let escrow_randomness = token_contract.escrow(
            &mut context,
            FromEscrowStruct { address: address_this.address },
            OwnerEscrowStruct { address: address_this.address },
            config_note.bet_amount * 2,
            0
        )[0];

        // Share with the user and the house
         let _ = token_contract.broadcast_escrow_note_for(
             &mut context,
             [
                 AccountsBroadcastEscrowNoteForStruct { address: sender.address },
                 AccountsBroadcastEscrowNoteForStruct { address: config_note.house.address },
                 AccountsBroadcastEscrowNoteForStruct { address: 0 },
                 AccountsBroadcastEscrowNoteForStruct { address: 0 }
             ],
             escrow_randomness
        );
        
        escrow_randomness
    }

    /////////////////////////////////////////////////////////////////////
    //             Public unconstrained external functions             //
    /////////////////////////////////////////////////////////////////////

    /// @notice         Gets the config note
    /// @custom:privacy unconstrained
    /// @return         The config note (divinity, private oracle, house, token, bet_amount)
    unconstrained fn get_config_unconstrained() -> ConfigNote {
        storage.config.view_note()
    }

    /// @notice         Gets the bet notes for an user
    /// @custom:privacy unconstrained
    /// @param          user The user address
    /// @param          start_offset The offset to start from
    /// @return         The bet notes for the user (padded with empty notes, up to 10)
    unconstrained fn get_user_bets_unconstrained(user: AztecAddress, start_offset: u32) -> [Option<BetNote>; 10] {
        let user_bets_getter_option = NoteViewerOptions::new().select(0, user.address).set_offset(start_offset);
        storage.bets.view_notes(user_bets_getter_option)
    }

    /// @notice         Gets the result notes for an user
    /// @custom:privacy unconstrained
    /// @param          owner The owner address
    /// @param          start_offset The offset to start from
    /// @return         The result notes for the user (padded with empty notes, up to 10)
    unconstrained fn get_results_unconstrained(owner: AztecAddress, start_offset: u32) -> [Option<ResultNote>; 10] {
        let results_getter_option = NoteViewerOptions::new().select(0, owner.address).set_offset(start_offset);
        storage.results.view_notes(results_getter_option)
    }

    /// @notice         Compute the note hash and nullifier for a note
    /// @custom:privacy unconstrained
    /// @param          contract_address The contract address (this)
    /// @param          nonce The nonce
    /// @param          storage_slot The storage slot of the note
    /// @param          preimage The preimage of the note
    /// @return         The note hash and nullifier
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