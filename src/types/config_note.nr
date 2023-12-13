use dep::aztec::{
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
    },

    context::PrivateContext,
    types::{
        address::AztecAddress
    }
};

struct ConfigNote {
    divinity: AztecAddress,
    private_oracle: AztecAddress,
    house: AztecAddress,
    token: AztecAddress,
    bet_amount: Field,
    header: NoteHeader
}

global CONFIG_NOTE_LEN: Field = 5;

impl ConfigNote {
    pub fn new(_divinity: AztecAddress, _private_oracle: AztecAddress, _house: AztecAddress, _token: AztecAddress, _amount: Field) -> Self {
        ConfigNote {
            divinity: _divinity,
            private_oracle: _private_oracle,
            house: _house,
            token: _token,
            bet_amount: _amount,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; CONFIG_NOTE_LEN] {
        [self.divinity.address, self.private_oracle.address, self.house.address, self.token.address, self.bet_amount]
    }

    fn deserialize(preimage: [Field; CONFIG_NOTE_LEN]) -> Self {
        ConfigNote {
            divinity: AztecAddress::new(preimage[0]),
            private_oracle: AztecAddress::new(preimage[1]),
            house: AztecAddress::new(preimage[2]),
            token: AztecAddress::new(preimage[3]),
            bet_amount: preimage[3],
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.divinity.address,
            self.private_oracle.address,
            self.house.address,
            self.token.address,
            self.bet_amount
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

fn deserialize(preimage: [Field; CONFIG_NOTE_LEN]) -> ConfigNote {
    ConfigNote::deserialize(preimage)
}

fn serialize(note: ConfigNote) -> [Field; CONFIG_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: ConfigNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: ConfigNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: ConfigNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut ConfigNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: ConfigNote) {
    note.broadcast(context, slot);
}

global ConfigNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast,
};