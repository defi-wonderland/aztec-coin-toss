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
        get_secret_key::get_secret_key,
        get_public_key::get_public_key
    },
    types::address::AztecAddress
};

/////////////////////////////////////////////////////////////////////
//                              Class                              //
/////////////////////////////////////////////////////////////////////

/// @notice A note that represents the result of a given bet
/// @member owner The owner of the note
/// @member sender The sender of the note
/// @member bet_id The id of the bet
/// @member result The result of the bet (heads or tails)
/// @member header The note header
struct ResultNote {
    owner: AztecAddress,
    sender: AztecAddress,
    bet_id: Field,
    result: bool, // Heads is 0 (False). Tails is 1 (True).
    header: NoteHeader
}

global RESULT_NOTE_LEN: Field = 4;

impl ResultNote {
    /////////////////////////////////////////////////////////////////////
    //                         Public methods                          //
    /////////////////////////////////////////////////////////////////////

    /// @notice Create a new ResultNote
    /// @dev This can be created by anyone calling the oracle callback, the sender
    ///      is therefore used in settlemend, to keep only note sent by the oracle 
    /// @param _owner The owner of the note (user or house)
    /// @param _sender The sender of the result (ie sender of oracle callback)
    /// @param _bet_id The id of the bet (random)
    /// @param _result The result of the bet (heads or tails)
    pub fn new(_owner: AztecAddress, _sender: AztecAddress, _bet_id: Field, _result: bool) -> Self {
        ResultNote {
            owner: _owner,
            sender: _sender,
            bet_id: _bet_id,
            result: _result,
            header: NoteHeader::empty(),
        }
    }

    /// @notice Serialize the note
    fn serialize(self) -> [Field; RESULT_NOTE_LEN] {
        [self.owner.address, self.sender.address, self.bet_id, self.result as Field]
    }

    /// @notice Deserialize the note
    fn deserialize(preimage: [Field; RESULT_NOTE_LEN]) -> Self {
        ResultNote {
            owner: AztecAddress::new(preimage[0]),
            sender: AztecAddress::new(preimage[1]),
            bet_id: preimage[2],
            result: preimage[3] as bool,
            header: NoteHeader::empty(),
        }
    }

    /// @notice Compute the note hash
    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.owner.address,
            self.sender.address,
            self.bet_id,
            self.result as Field
        ])
    }

    /// @notice This note is not nullifiable, return 0
    fn compute_nullifier(self) -> Field {
        let _ = self;
        0
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

fn deserialize(preimage: [Field; RESULT_NOTE_LEN]) -> ResultNote {
    ResultNote::deserialize(preimage)
}

fn serialize(note: ResultNote) -> [Field; RESULT_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: ResultNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: ResultNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: ResultNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut ResultNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: ResultNote) {
    note.broadcast(context, slot);
}

global ResultNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast,
};