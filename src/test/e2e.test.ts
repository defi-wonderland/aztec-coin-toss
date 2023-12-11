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

import { BetNote } from "../../types/Notes.js";
import { initAztecJs } from "@aztec/aztec.js/init";

const BET_AMOUNT_SLOT: Fr = new Fr(1);
const DIVINITY_ADDRESS_SLOT: Fr = new Fr(2);
const PRIVATE_ORACLE_ADDRESS_SLOT: Fr = new Fr(3);
const HOUSE_ADDRESS_SLOT: Fr = new Fr(4);
const BETS_SLOT: Fr = new Fr(5);

const PRIVATE_ORACLE_ADDRESS = AztecAddress.fromBigInt(456n);
const BET_AMOUNT = 1337n;

let pxe: PXE;
let coinToss: CoinTossContract;

let user: AccountWalletWithPrivateKey;
let house: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;

type UserAndHouseBetNotes = {
  userNotes: BetNote[];
  houseNotes: BetNote[];
};

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
  let USER_BET_NOTES: BetNote[];
  let FIRST_BET_NOTE: BetNote;
  let userRandomness: bigint;
  let houseRandomness: bigint;

  beforeAll(async () => {
    USER_BET_NOTES = createUserBetNotes(4);
    FIRST_BET_NOTE = USER_BET_NOTES[0];

    // Deploy Coin Toss
    const coinTossReceipt = await CoinTossContract.deploy(
      deployer,
      BET_AMOUNT,
      divinity.getAddress(),
      PRIVATE_ORACLE_ADDRESS,
      house.getAddress()
    )
      .send()
      .wait();

    coinToss = coinTossReceipt.contract;

    // Add the contract public key to the PXE
    await pxe.registerRecipient(coinToss.completeAddress);

    // Add all address notes to pxe
    await addAddressNotesToPxe(
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
      const bet: BetNote = BetNote.fromChainData(
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
      const bet: BetNote = BetNote.fromChainData(
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
        .map((betNote: any) => BetNote.fromChainData(betNote._value));

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
        .map((betNote: any) => BetNote.fromChainData(betNote._value));

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

  describe("get_house_unconstrained", () => {
    it("returns the correct house address", async () => {
      let storedHouse = await coinToss.methods.get_house_unconstrained().view();
      expect(storedHouse.address.address).toEqual(
        house.getAddress().toBigInt()
      );
    });
  });

  describe("get_private_oracle_unconstrained", () => {
    it("returns the correct private oracle address", async () => {
      let storedPrivateOracle = await coinToss.methods
        .get_private_oracle_unconstrained()
        .view();

      expect(storedPrivateOracle.address.address).toEqual(
        PRIVATE_ORACLE_ADDRESS.toBigInt().valueOf()
      );
    });
  });

  describe("get_divinity_unconstrained", () => {
    it("returns the correct divinity address", async () => {
      let storedDivinity = await coinToss.methods
        .get_divinity_unconstrained()
        .view();

      expect(storedDivinity.address.address).toEqual(
        divinity.getAddress().toBigInt().valueOf()
      );
    });
  });

  describe("get_bet_amount_unconstrained", () => {
    it("returns the correct bet amount", async () => {
      let storedBetAmount = await coinToss.methods
        .get_bet_amount_unconstrained()
        .view();

      expect(storedBetAmount.amount).toEqual(BET_AMOUNT);
    });
  });
});

function createUserBetNotes(number: number = 3): BetNote[] {
  let betNote: BetNote;
  let betNotes: BetNote[] = [];

  for (let i = 0; i < number; i++) {
    betNote = BetNote.fromLocal({
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

const addAddressNotesToPxe = async (
  user: AztecAddress,
  contract: AztecAddress,
  txHash: TxHash
) => {
  await Promise.all([
    pxe.addNote(
      new ExtendedNote(
        new Note([house.getAddress().toField()]),
        user,
        contract,
        HOUSE_ADDRESS_SLOT,
        txHash
      )
    ),
    pxe.addNote(
      new ExtendedNote(
        new Note([PRIVATE_ORACLE_ADDRESS.toField()]),
        user,
        contract,
        PRIVATE_ORACLE_ADDRESS_SLOT,
        txHash
      )
    ),
    pxe.addNote(
      new ExtendedNote(
        new Note([divinity.getAddress().toField()]),
        user,
        contract,
        DIVINITY_ADDRESS_SLOT,
        txHash
      )
    ),
    pxe.addNote(
      new ExtendedNote(
        new Note([new Fr(BET_AMOUNT)]),
        user,
        contract,
        BET_AMOUNT_SLOT,
        txHash
      )
    ),
  ]);
};
