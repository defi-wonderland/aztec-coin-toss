import {
  Fr,
  PXE,
  createAccount,
  createPXEClient,
  getSandboxAccountsWallets,
  waitForSandbox,
  AztecAddress,
  AccountWalletWithPrivateKey,
  TxHash,
  ExtendedNote,
  Note,
  BatchCall,
} from "@aztec/aztec.js";

import { CoinTossContract } from "../app/src/abis/cointoss/CoinToss.js";
import { TokenContract } from "../token/Token.js";

import { BetNote, ResultNote } from "../../types/Notes.js";
import { initAztecJs } from "@aztec/aztec.js/init";

const CONFIG_SLOT: Fr = new Fr(1);
const BETS_SLOT: Fr = new Fr(2);
const RESULT_SLOT: Fr = new Fr(3);

const BET_AMOUNT = 1337n;

let pxe: PXE;
let coinToss: CoinTossContract;
let token: TokenContract;

let user: AccountWalletWithPrivateKey;
let house: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;
let mock_oracle: AccountWalletWithPrivateKey;

// Setup: Set the sandbox
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);

  [, [user, house, divinity], deployer, mock_oracle] = await Promise.all([
    waitForSandbox(pxe),
    getSandboxAccountsWallets(pxe),
    createAccount(pxe),
    createAccount(pxe),
  ]);
  await initAztecJs();
}, 120_000);

describe("E2E Coin Toss", () => {
  let USER_BET_NOTES: BetNote[];
  let FIRST_BET_NOTE: BetNote;
  let userRandomness: bigint;
  let houseRandomness: bigint;

  beforeAll(async () => {
    USER_BET_NOTES = createUserBetNotes(4);
    FIRST_BET_NOTE = USER_BET_NOTES[0];

    // Deploy the token
    token = await TokenContract.deploy(deployer, requester.getAddress())
    .send()
    .deployed();

    // Deploy Coin Toss
    const coinTossReceipt = await CoinTossContract.deploy(
      deployer,
      divinity.getAddress(),
      mock_oracle.getAddress(),
      house.getAddress(),
      BET_AMOUNT
    )
      .send()
      .wait();

    coinToss = coinTossReceipt.contract;

    // Add the contract public key to the PXE
    await pxe.registerRecipient(coinToss.completeAddress);

    // Add all address notes to pxe
    await addConfigNotesToPxe(
      user.getAddress(),
      coinToss.address,
      coinTossReceipt.txHash
    );
  }, 120_000);

  describe("create_bet(..)", () => {
    it("Tx to create_bet is mined", async () => {
      const receipt = await coinToss
        .withWallet(user)
        .methods.create_bet(FIRST_BET_NOTE.bet)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("User bet note should have the correct parameters", async () => {
      const bet: BetNote = new BetNote(
        (
          await coinToss
            .withWallet(user)
            .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      type BetNoteWithoutRandomness = Omit<BetNote, "randomness">;

      // Check: Compare the note's data with the expected values
      const betNote: BetNoteWithoutRandomness = {
        owner: FIRST_BET_NOTE.owner,
        bet: FIRST_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));

      // Store the random nullifier, for later comparison
      userRandomness = bet.randomness;
    });

    it("House should have the copy of the same note as the user with correct parameters", async () => {
      const bet: BetNote = new BetNote(
        (
          await coinToss
            .withWallet(house)
            .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
            .view({ from: house.getAddress() })
        )[0]._value
      );

      type BetNoteWithoutRandomness = Omit<BetNote, "randomness">;

      const betNote: BetNoteWithoutRandomness = {
        owner: FIRST_BET_NOTE.owner,
        bet: FIRST_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));

      // Store the random nullifier, for later comparison
      houseRandomness = bet.randomness;
    });

    it("User and house should share the same randomness for notes, and therefore same nullifier key", async () => {
      expect(userRandomness).toBe(houseRandomness);
    });
  });

  describe("oracle_callback(..)", () => {
    let callback_data: bigint[];

    beforeAll(async () => {
      await coinToss
        .withWallet(user)
        .methods.create_bet(FIRST_BET_NOTE.bet)
        .send()
        .wait();

      const bet: BetNote = new BetNote(
        (
          await coinToss
            .withWallet(user)
            .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      callback_data = [
        user.getAddress().toBigInt(),
        bet.randomness,
        house.getAddress().toBigInt(),
        0n,
        0n,
      ];
    });

    it("callable by the oracle address", async () => {
      const receipt = await coinToss
        .withWallet(mock_oracle)
        .methods.oracle_callback(1n, callback_data)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("creates a result note to the user", async () => {
      const result_notes = await coinToss
        .withWallet(user)
        .methods.get_results_unconstrained(user.getAddress(), 0n)
        .view({ from: user.getAddress() });

      const result_note = new ResultNote(result_notes[0]._value);

      expect(result_note).toEqual(
        new ResultNote({
          owner: user.getAddress(),
          sender: mock_oracle.getAddress(),
          bet_id: callback_data[1],
          result: true,
        })
      );
    });

    it("creates a result note to the house", async () => {
      const result_notes = await coinToss
        .withWallet(house)
        .methods.get_results_unconstrained(house.getAddress(), 0n)
        .view({ from: house.getAddress() });

      const result_note = new ResultNote(result_notes[0]._value);

      expect(result_note).toEqual(
        new ResultNote({
          owner: house.getAddress(),
          sender: mock_oracle.getAddress(),
          bet_id: callback_data[1],
          result: true,
        })
      );
    });
  });

  describe("get_user_bets_unconstrained", () => {
    let SLICED_USER_BET_NOTES: BetNote[];

    beforeAll(async () => {
      // Slicing the first one because it has already been mined
      SLICED_USER_BET_NOTES = USER_BET_NOTES.slice(1);

      await sendBetBatch(SLICED_USER_BET_NOTES);
    });

    it("returns the correct user bets to the user", async () => {
      const bets: BetNote[] = (
        await coinToss
          .withWallet(user)
          .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
          .view({ from: user.getAddress() })
      )
        .filter((noteObj: any) => noteObj._is_some)
        .map((betNote: any) => new BetNote(betNote._value));

      expect(bets).toEqual(
        expect.arrayContaining(
          SLICED_USER_BET_NOTES.map((betNote) => {
            const bets = {
              owner: betNote.owner,
              bet: betNote.bet,
            };
            return expect.objectContaining(bets);
          })
        )
      );
    });

    it("returns the correct user bets to the house", async () => {
      const bets: BetNote[] = (
        await coinToss
          .withWallet(house)
          .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
          .view({ from: house.getAddress() })
      )
        .filter((noteObj: any) => noteObj._is_some)
        .map((betNote: any) => new BetNote(betNote._value));

      expect(bets).toEqual(
        expect.arrayContaining(
          SLICED_USER_BET_NOTES.map((betNote) => {
            const bets = {
              owner: betNote.owner,
              bet: betNote.bet,
            };
            return expect.objectContaining(bets);
          })
        )
      );
    });

    it.skip("returns the correct questions when using an offset", async () => {
      // Implement based on questions offset test
    });
  });

  describe("get_config_unconstrained", () => {
    it("returns the correct parameters for all configs", async () => {
      type AddressObj = {
        address: bigint;
      };

      type ConfigNote = {
        divinity: AddressObj;
        private_oracle: AddressObj;
        house: AddressObj;
        bet_amount: bigint;
      };

      let config: ConfigNote = await coinToss.methods
        .get_config_unconstrained()
        .view();

      expect(config.divinity.address).toEqual(divinity.getAddress().toBigInt());
      expect(config.private_oracle.address).toEqual(
        mock_oracle.getAddress().toBigInt()
      );
      expect(config.house.address).toEqual(house.getAddress().toBigInt());
      expect(config.bet_amount).toEqual(BET_AMOUNT);
    });
  });
});

function createUserBetNotes(number: number = 3): BetNote[] {
  let betNote: BetNote;
  let betNotes: BetNote[] = [];

  for (let i = 0; i < number; i++) {
    betNote = new BetNote({
      owner: user.getAddress(),
      bet: !!(i % 2), // 0: Heads, 1: Tails
    });

    betNotes.push(betNote);
  }

  return betNotes;
}

const sendBetBatch = async (betNotes: BetNote[]) => {
  const batchBets = new BatchCall(
    user,
    betNotes.map((betNote) =>
      coinToss.methods.create_bet(betNote.bet).request()
    )
  );

  await batchBets.send().wait();
};

const addConfigNotesToPxe = async (
  user: AztecAddress,
  contract: AztecAddress,
  txHash: TxHash
) => {
  const divinityAsFr = divinity.getAddress().toField();
  const privateOracleAsFr = mock_oracle.getAddress().toField();
  const houseAsFr = house.getAddress().toField();
  const betAmountAsFr = new Fr(BET_AMOUNT);

  await pxe.addNote(
    new ExtendedNote(
      new Note([divinityAsFr, privateOracleAsFr, houseAsFr, betAmountAsFr]),
      user,
      contract,
      CONFIG_SLOT,
      txHash
    )
  );
};
