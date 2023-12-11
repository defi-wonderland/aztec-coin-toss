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
  let USER_AND_HOUSE_BET_NOTES: UserAndHouseBetNotes;

  beforeAll(async () => {
    USER_AND_HOUSE_BET_NOTES = createUserAndHouseBetNotes(4);

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
      const firstBet = USER_AND_HOUSE_BET_NOTES.userNotes[0].bet;
      const receipt = await coinToss
        .withWallet(user)
        .methods.create_bet(firstBet)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("User bet note should have the correct parameters", async () => {
      const USER_BET_NOTE = USER_AND_HOUSE_BET_NOTES.userNotes[0];

      const bet: BetNote = BetNote.fromChainData(
        (
          await coinToss
            .withWallet(user)
            .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      // Check: Compare the note's data with the expected values

      const betNote = {
        owner: USER_BET_NOTE.owner,
        bet: USER_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));
    });

    it("House bet note should have the correct parameters", async () => {
      const HOUSE_BET_NOTE = USER_AND_HOUSE_BET_NOTES.houseNotes[0];
      const bet: BetNote = BetNote.fromChainData(
        (
          await coinToss
            .withWallet(house)
            .methods.get_user_bets_unconstrained(house.getAddress(), 0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      const betNote: BetNote = {
        owner: HOUSE_BET_NOTE.owner,
        bet: HOUSE_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));
    });
  });

  describe("get_user_bets_unconstrained", () => {
    let SLICED_USER_BET_NOTES: BetNote[];
    let SLICED_HOUSE_BET_NOTES: BetNote[];

    beforeAll(async () => {
      // Slicing the first one because it has already been mined
      SLICED_USER_BET_NOTES = USER_AND_HOUSE_BET_NOTES.userNotes.slice(1);
      SLICED_HOUSE_BET_NOTES = USER_AND_HOUSE_BET_NOTES.houseNotes.slice(1);

      await sendBetBatch(SLICED_USER_BET_NOTES);
      await sendBetBatch(SLICED_HOUSE_BET_NOTES);
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

    it("returns the correct house bets to the house", async () => {
      const bets: BetNote[] = (
        await coinToss
          .withWallet(house)
          .methods.get_user_bets_unconstrained(house.getAddress(), 0n)
          .view({ from: house.getAddress() })
      )
        .filter((noteObj: any) => noteObj._is_some)
        .map((betNote: any) => BetNote.fromChainData(betNote._value));

      expect(bets).toEqual(
        expect.arrayContaining(
          SLICED_HOUSE_BET_NOTES.map((betNote) => {
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

function createUserAndHouseBetNotes(number: number = 3): UserAndHouseBetNotes {
  let userNote: BetNote;
  let houseNote: BetNote;
  let userNotes: BetNote[] = [];
  let houseNotes: BetNote[] = [];

  for (let i = 0; i < number; i++) {
    userNote = BetNote.fromLocal({
      owner: user.getAddress(),
      bet: !!(i % 2), // 0: Heads, 1: Tails
    });

    houseNote = BetNote.fromLocal({
      owner: house.getAddress(),
      bet: !userNote.bet,
    });

    userNotes.push(userNote);
    houseNotes.push(houseNote);
  }

  return {
    userNotes,
    houseNotes,
  };
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
