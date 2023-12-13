use dep::aztec::{
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

    log::emit_encrypted_log,
    context::PrivateContext,
    types::{
        address::AztecAddress,
    }
};

struct ResultNote {
    owner: AztecAddress,
    sender: AztecAddress,
    bet_id: Field,
    result: bool, // Heads is 0 (False). Tails is 1 (True).
    header: NoteHeader
}

global RESULT_NOTE_LEN: Field = 4;

impl ResultNote {
    pub fn new(_owner: AztecAddress, _sender: AztecAddress, _bet_id: Field, _result: bool) -> Self {
        ResultNote {
            owner: _owner,
            sender: _sender,
            bet_id: _bet_id,
            result: _result,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; RESULT_NOTE_LEN] {
        [self.owner.address, self.sender.address, self.bet_id, self.result as Field]
    }

    fn deserialize(preimage: [Field; RESULT_NOTE_LEN]) -> Self {
        ResultNote {
            owner: AztecAddress::new(preimage[0]),
            sender: AztecAddress::new(preimage[1]),
            bet_id: preimage[2],
            result: preimage[3] as bool,
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.owner.address,
            self.sender.address,
            self.bet_id,
            self.result as Field
        ])
    }

    fn compute_nullifier(self) -> Field {
        let _ = self;
        0
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

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