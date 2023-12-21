/////////////////////////////////////////////////////////////////////
//                             Imports                             //
/////////////////////////////////////////////////////////////////////

use dep::aztec::{
    context::PrivateContext,
    log::emit_encrypted_log,
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        utils::compute_note_hash_for_read_or_nullify,
    },
    oracle::{
        rand::rand,
        get_public_key::get_public_key,
        get_secret_key::get_secret_key,
    },
    types::address::AztecAddress
};

/////////////////////////////////////////////////////////////////////
//                              Class                              //
/////////////////////////////////////////////////////////////////////

/// @notice A note that represents a given bet, of a given user
/// @member owner The owner of the note
/// @member bet_id The id of the bet (the escrow randomness is reused for this)
/// @member bet The bet outcome given by the user (true or false)
/// @member header The note header
struct BetNote {
    owner: AztecAddress,
    bet_id: Field,
    bet: bool,
    header: NoteHeader
}

global BET_NOTE_LEN: Field = 3;

impl BetNote {
    /////////////////////////////////////////////////////////////////////
    //                         Public methods                          //
    /////////////////////////////////////////////////////////////////////

    /// @notice Bet note constructor
    /// @param _owner The owner of the note
    /// @param _bet_id The id of the bet (randomlty generated, by reusing the escrow randomness)
    /// @param _bet The bet outcome given by the user (true or false, representing head or tail)
    pub fn new(_owner: AztecAddress, _bet_id: Field, _bet: bool) -> Self {
        BetNote {
            owner: _owner,
            bet_id: _bet_id,
            bet: _bet,
            header: NoteHeader::empty(),
        }
    }

    /////////////////////////////////////////////////////////////////////
    //                        Internal methods                         //
    /////////////////////////////////////////////////////////////////////

    /// @notice Serializes the note
    fn serialize(self) -> [Field; BET_NOTE_LEN] {
        [self.owner.address, self.bet_id, self.bet as Field]
    }

    /// @notice Deserializes the note
    fn deserialize(preimage: [Field; BET_NOTE_LEN]) -> Self {
        BetNote {
            owner: AztecAddress::new(preimage[0]),
            bet_id: preimage[1],
            bet: preimage[2] as bool,
            header: NoteHeader::empty(),
        }
    }

    /// @notice Computes the note hash of the note
    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.owner.address,
            self.bet_id,
            self.bet as Field
        ])
    }

    /// @notice Computes the nullifier of the note
    /// @dev    This is a pretty standard nullifier computation, using the bet_id as the key
    fn compute_nullifier(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BetNoteMethods, self);
        let nullifier_key = self.bet_id;

        dep::std::hash::pedersen_hash([
            note_hash_for_nullify,
            nullifier_key,
        ])
    }

    /// @notice Sets the note header
    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    /// @notice Emit the note creation event using the owner public key
    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        let encryption_pub_key = get_public_key(self.owner.address);
        emit_encrypted_log(
            context,
            (*context).this_address(),
            slot,
            encryption_pub_key,
            self.serialize(),
        );
    }
}

/////////////////////////////////////////////////////////////////////
//                         Global methods                          //
/////////////////////////////////////////////////////////////////////

fn deserialize(preimage: [Field; BET_NOTE_LEN]) -> BetNote {
    BetNote::deserialize(preimage)
}

fn serialize(note: BetNote) -> [Field; BET_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: BetNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: BetNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: BetNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut BetNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: BetNote) {
    note.broadcast(context, slot);
}

global BetNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast,
};