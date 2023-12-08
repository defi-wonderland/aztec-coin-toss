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

struct AddressNote {
    address: AztecAddress,
    header: NoteHeader
}

global ADDRESS_NOTE_LEN: Field = 1;

impl AddressNote {
    pub fn new(_address: AztecAddress) -> Self {
        AddressNote {
            address: _address,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; ADDRESS_NOTE_LEN] {
        [self.address.address]
    }

    fn deserialize(preimage: [Field; ADDRESS_NOTE_LEN]) -> Self {
        AddressNote {
            address: AztecAddress::new(preimage[0]),
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.address.address,
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

fn deserialize(preimage: [Field; ADDRESS_NOTE_LEN]) -> AddressNote {
    AddressNote::deserialize(preimage)
}

fn serialize(note: AddressNote) -> [Field; ADDRESS_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: AddressNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: AddressNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: AddressNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut AddressNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: AddressNote) {
    note.broadcast(context, slot);
}

global AddressNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast,
};