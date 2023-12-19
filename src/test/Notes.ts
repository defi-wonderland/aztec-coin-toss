import { AztecAddress } from "@aztec/aztec.js";

export class BetNote {
  owner: AztecAddress;
  bet_id: bigint;
  bet: boolean;

  constructor(note: any) {
    this.owner = AztecAddress.fromBigInt(
      note.owner.address || note.owner.asBigInt
    );
    this.bet_id = note.bet_id;
    this.bet = note.bet;
  }
}

export class ResultNote {
  owner: AztecAddress;
  sender: AztecAddress;
  bet_id: bigint;
  result: boolean;

  constructor(note: any) {
    this.owner = AztecAddress.fromBigInt(
      note.owner.address || note.owner.asBigInt
    );
    this.sender = AztecAddress.fromBigInt(
      note.sender.address || note.sender.asBigInt
    );
    this.bet_id = note.bet_id;
    this.result = note.result;
  }
}