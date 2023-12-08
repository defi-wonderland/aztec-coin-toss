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
        address::AztecAddress
    }
};

struct BetAmountNote {
    amount: Field,
    header: NoteHeader
}

global BET_AMOUNT_NOTE_LEN: Field = 1;

impl BetAmountNote {
    pub fn new(_amount: Field) -> Self {
        BetAmountNote {
            amount: _amount,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; BET_AMOUNT_NOTE_LEN] {
        [self.amount]
    }

    fn deserialize(preimage: [Field; BET_AMOUNT_NOTE_LEN]) -> Self {
        BetAmountNote {
            amount: preimage[0],
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.amount,
        ])
    }

    fn compute_nullifier(self) -> Field {
         let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
         0
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        // no owner == no broadcast
        let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
        let __ = context;
        let ___ = slot;
    }
}

fn deserialize(preimage: [Field; BET_AMOUNT_NOTE_LEN]) -> BetAmountNote {
    BetAmountNote::deserialize(preimage)
}

fn serialize(note: BetAmountNote) -> [Field; BET_AMOUNT_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: BetAmountNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: BetAmountNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: BetAmountNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut BetAmountNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: BetAmountNote) {
    note.broadcast(context, slot);
}

global BetAmountNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast,
};