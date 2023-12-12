import { AztecAddress } from "@aztec/aztec.js";

export class BetNote {
  owner: AztecAddress;
  randomness: bigint;
  bet: boolean;

  constructor(owner: AztecAddress, randomness: bigint, bet: boolean) {
    this.owner = owner;
    this.randomness = randomness;
    this.bet = bet;
  }

  static fromChainData(note: any) {
    return new BetNote(
      AztecAddress.fromBigInt(note.owner.address),
      note.randomness,
      note.bet
    );
  }

  static fromLocal(note: any) {
    return new BetNote(
      AztecAddress.fromBigInt(note.owner.asBigInt),
      note.randomness,
      note.bet
    );
  }
}

export class ResultNote {
  owner: AztecAddress;
  bet_id: bigint;
  result: boolean;

  constructor(owner: AztecAddress, bet_id: bigint, result: boolean) {
    this.owner = owner;
    this.bet_id = bet_id;
    this.result = result;
  }

  static fromChainData(note: any) {
    return new ResultNote(
      AztecAddress.fromBigInt(note.owner.address),
      note.bet_id,
      note.result
    );
  }

  static fromLocal(note: any) {
    return new ResultNote(
      AztecAddress.fromBigInt(note.owner.asBigInt),
      note.bet_id,
      note.result
    );
  }
}
