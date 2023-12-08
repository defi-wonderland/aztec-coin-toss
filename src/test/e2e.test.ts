import {
  Fr,
  PXE,
  computeMessageSecretHash,
  createAccount,
  createPXEClient,
  getSandboxAccountsWallets,
  waitForSandbox,
  AztecAddress,
  AccountWalletWithPrivateKey,
  computeAuthWitMessageHash,
  TxHash,
  ExtendedNote,
  Note,
} from "@aztec/aztec.js";

import { CoinTossContract } from "../app/src/abis/cointoss/CoinToss.js";

import { BetNote } from "../../types/Notes.js";
import { initAztecJs } from "@aztec/aztec.js/init";

const BET_AMOUNT_SLOT: Fr = new Fr(1);
const DIVINITY_ADDRESS_SLOT: Fr = new Fr(2);
const PRIVATE_ORACLE_ADDRESS_SLOT: Fr = new Fr(3);
const HOUSE_ADDRESS_SLOT: Fr = new Fr(4);
const BETS_SLOT: Fr = new Fr(5);

const HEADS = false;
const TAILS = true;

const PRIVATE_ORACLE_ADDRESS = AztecAddress.fromBigInt(456n);
const BET_AMOUNT = 1337n;

const ADDRESS_ZERO = AztecAddress.fromBigInt(0n);

let pxe: PXE;
let coinToss: CoinTossContract;

let user: AccountWalletWithPrivateKey;
let house: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;

// Setup: Set the sandbox
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);

  [, [user, house, divinity], deployer] = await Promise.all([
    waitForSandbox(pxe),
    getSandboxAccountsWallets(pxe),
    createAccount(pxe),
  ]);
  await initAztecJs();
}, 120_000);

describe("E2E Coin Toss", () => {
  let USER_BET_NOTE: BetNote;
  let HOUSE_BET_NOTE: BetNote;
  let user_randomness: bigint;
  let house_randomness: bigint;

  describe("create_bet(..)", () => {
    beforeAll(async () => {
      USER_BET_NOTE = createCorrectNotes(user, 1)[0];
      HOUSE_BET_NOTE = createCorrectNotes(house, 1)[0];

      // Deploy Coin Toss
      const coinTossReceipt = await CoinTossContract.deploy(
        deployer,
        BET_AMOUNT,
        divinity.getAddress(),
        house.getAddress(),
        PRIVATE_ORACLE_ADDRESS
      )
        .send()
        .wait();

      coinToss = coinTossReceipt.contract;

      // Add the contract public key to the PXE
      await pxe.registerRecipient(coinToss.completeAddress);
      console.log({ pxe });

      // Add house note to pxe
      await addAddressNotesToPxe(
        user.getAddress(),
        coinToss.address,
        house.getAddress(),
        coinTossReceipt.txHash
      );
    }, 120_000);

    it("Tx to create_bet is mined", async () => {
      const receipt = await coinToss
        .withWallet(user)
        .methods.create_bet(HEADS)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it.skip("User bet note should have the correct parameters", async () => {
      const bet: BetNote = BetNote.fromChainData(
        (
          await coinToss
            .withWallet(user)
            .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      // Check: Compare the note's data with the expected values
      type BetNoteWithoutRandom = Omit<BetNote, "randomness">;

      const betNoteWithoutRandom: BetNoteWithoutRandom = {
        owner: USER_BET_NOTE.owner,
        bet: USER_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNoteWithoutRandom));

      // Store the random nullifier shared key, for later comparison
      user_randomness = bet.randomness;
    });

    it.skip("House bet note should have the correct parameters", async () => {
      const bet: BetNote = BetNote.fromChainData(
        (
          await coinToss
            .withWallet(house)
            .methods.get_user_bets_unconstrained(house.getAddress(), 0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      // Check: Compare the note's data with the expected values
      type BetNoteWithoutRandom = Omit<BetNote, "randomness">;

      const betNoteWithoutRandom: BetNoteWithoutRandom = {
        owner: HOUSE_BET_NOTE.owner,
        bet: HOUSE_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNoteWithoutRandom));

      // Store the random nullifier shared key, for later comparison
      house_randomness = bet.randomness;
    });
  });
});

function createCorrectNotes(
  owner: AccountWalletWithPrivateKey,
  number: number = 3
): BetNote[] {
  let betNotes: BetNote[] = [];
  let betNote: BetNote;

  for (let i = 0; i < number; i++) {
    betNote = BetNote.fromLocal({
      owner: owner.getAddress(),
      randomness: BigInt(Math.floor(Math.random() * 99999999)),
      bet: HEADS,
    });

    betNotes.push(betNote);
  }

  return betNotes;
}

const addAddressNotesToPxe = async (
  user: AztecAddress,
  contract: AztecAddress,
  house: AztecAddress,
  txHash: TxHash
) => {
  await Promise.all([
    pxe.addNote(
      new ExtendedNote(
        new Note([house.toField()]),
        user,
        contract,
        HOUSE_ADDRESS_SLOT,
        txHash
      )
    ),
  ]);
};
