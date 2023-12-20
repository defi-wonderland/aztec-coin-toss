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

struct BetNote {
    owner: AztecAddress,
    bet_id: Field,
    bet: bool, // Heads is 0 (False). Tails is 1 (True).
    header: NoteHeader
}

global BET_NOTE_LEN: Field = 3;

impl BetNote {
    pub fn new(_owner: AztecAddress, _bet: bool, _bet_id: Field) -> Self {
        BetNote {
            owner: _owner,
            bet_id: _bet_id,
            bet: _bet,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; BET_NOTE_LEN] {
        [self.owner.address, self.bet_id, self.bet as Field]
    }

    fn deserialize(preimage: [Field; BET_NOTE_LEN]) -> Self {
        BetNote {
            owner: AztecAddress::new(preimage[0]),
            bet_id: preimage[1],
            bet: preimage[2] as bool,
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.owner.address,
            self.bet_id,
            self.bet as Field
        ])
    }

    fn compute_nullifier(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BetNoteMethods, self);
        let nullifier_key = self.bet_id;

        dep::std::hash::pedersen_hash([
            note_hash_for_nullify,
            nullifier_key,
        ])
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