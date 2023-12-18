import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  BatchCall,
  ContractFunctionInteraction,
  ExtendedNote,
  Fr,
  Note,
  PXE,
  TxHash,
  computeAuthWitMessageHash,
  computeMessageSecretHash,
  createAccount,
  createPXEClient,
  getSandboxAccountsWallets,
  waitForSandbox,
} from "@aztec/aztec.js";

import { CoinTossContract } from "../artifacts/CoinToss.js";
import { TokenContract } from "../artifacts/token/Token.js";

import { initAztecJs } from "@aztec/aztec.js/init";
import { BetNote, ResultNote } from "./Notes.js";

const CONFIG_SLOT: Fr = new Fr(1);
const BETS_SLOT: Fr = new Fr(2);
const RESULT_SLOT: Fr = new Fr(3);

const MINT_TOKENS = 100000n;

const PRIVATE_ORACLE_ADDRESS = AztecAddress.fromBigInt(456n);
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

  let userEscrowRandomness: bigint;
  let houseEscrowRandomness: bigint;

  beforeAll(async () => {
    USER_BET_NOTES = createUserBetNotes(4);
    FIRST_BET_NOTE = USER_BET_NOTES[0];

    // Deploy the token with the  house as a minter
    token = await TokenContract.deploy(deployer, house.getAddress())
    .send()
    .deployed();

    // Mint the tokens
    await mintTokenFor(house, house, MINT_TOKENS);
    await mintTokenFor(user, house, MINT_TOKENS);

    // Deploy Coin Toss
    const coinTossReceipt = await CoinTossContract.deploy(
      deployer,
      divinity.getAddress(),
      mock_oracle.getAddress(),
      house.getAddress(),
      token.address,
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
    
    // Create 8 escrows
    await createEscrows(4);
    await createEscrows(4);
  }, 120_000);

  describe("create_bet(..)", () => {
    it("Tx to create_bet is mined", async () => {
      // House creates the escrow and shares with the user
      const {randomness: escrowRandomness, authNonce: settleEscrowNonce} = (await getHouseEscrowAndAuthNonce())[0];

      // Approve the transfer of tokens from user
      const transferNonce = Fr.random();
      const transferAction = token.methods.transfer(user.getAddress(), coinToss.address, BET_AMOUNT, transferNonce);
      await createAuth(transferAction, user, coinToss.address);

      const receipt = await coinToss
        .withWallet(user)
        .methods.create_bet(FIRST_BET_NOTE.bet, transferNonce, escrowRandomness, settleEscrowNonce)
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

      type BetNoteWithoutRandomness = Omit<
        BetNote,
        "bet_id" | "escrow_randomness"
      >;

      // Check: Compare the note's data with the expected values
      const betNote: BetNoteWithoutRandomness = {
        owner: FIRST_BET_NOTE.owner,
        bet: FIRST_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));

      // Store the random nullifier, for later comparison
      userRandomness = bet.bet_id;
      userEscrowRandomness = bet.escrow_randomness;
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

      type BetNoteWithoutRandomness = Omit<
        BetNote,
        "bet_id" | "escrow_randomness"
      >;

      const betNote: BetNoteWithoutRandomness = {
        owner: FIRST_BET_NOTE.owner,
        bet: FIRST_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));

      // Store the random nullifier, for later comparison
      houseRandomness = bet.bet_id;
      houseEscrowRandomness = bet.escrow_randomness;
    });

    it("User and house should share the same randomness for notes, and therefore same nullifier key", async () => {
      expect(userRandomness).toBe(houseRandomness);
      expect(userEscrowRandomness).toBe(houseEscrowRandomness);
    });

    it("Created a resulting escrow note with the correct parameters", async () => {
      const escrowNote = (
        await token
          .withWallet(user)
          .methods.get_escrows(0)
          .view({ from: user.getAddress() })
      ).find(
        (noteObj: any) => noteObj._value.randomness == userEscrowRandomness
      )._value;

      expect(escrowNote.amount.value).toBe(BET_AMOUNT * 2n);
      expect(escrowNote.owner.address).toBe(coinToss.address.toBigInt());
    });

    it("Took the correct amount of tokens from the user", async () => {
      const userBalance = await token
        .withWallet(user)
        .methods.balance_of_private(user.getAddress())
        .view({ from: user.getAddress() });

      expect(userBalance).toBe(MINT_TOKENS - BET_AMOUNT);
    })
  });

  describe.only("settle_bet()", () => {
    let houseBalance: bigint;
    let betId: bigint;

    // Create a bet and trigger the oracle callback with the result
    beforeAll(async () => {
      // House creates the escrow and shares with the user
      const { randomness: escrowRandomness, authNonce: settleEscrowNonce } = (
        await getHouseEscrowAndAuthNonce()
      )[0];

      // Approve the transfer of tokens from user
      const transferNonce = Fr.random();
      const transferAction = token.methods.transfer(
        user.getAddress(),
        coinToss.address,
        BET_AMOUNT,
        transferNonce
      );
      await createAuth(transferAction, user, coinToss.address);

      await coinToss
        .withWallet(user)
        .methods.create_bet(
          FIRST_BET_NOTE.bet,
          transferNonce,
          escrowRandomness,
          settleEscrowNonce
        )
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

      betId = bet.bet_id;

      const callback_data = [
        user.getAddress().toBigInt(),
        bet.bet_id,
        house.getAddress().toBigInt(),
        0n,
        0n,
      ];

      await coinToss
        .withWallet(mock_oracle)
        .methods.oracle_callback(1n, callback_data)
        .send()
        .wait();
    });

    it("Tx to settle_bet is mined", async () => {
      // Save the private balance of the house
      houseBalance = await token
        .withWallet(house)
        .methods.balance_of_private(house.getAddress())
        .view({ from: house.getAddress() });

      const receipt = await coinToss
        .withWallet(user)
        .methods.settle_bet(betId)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("Sends the tokens to the correct party", async () => {
      // Get the new private balance of the house
      const newHouseBalance = await token
        .withWallet(house)
        .methods.balance_of_private(house.getAddress())
        .view({ from: house.getAddress() });

      // Check that the house got the tokens
      expect(newHouseBalance).toBe(houseBalance + BET_AMOUNT * 2n);
    });

    it("Nullifies the bet note", async () => {
      const betNote = (
        await coinToss
          .withWallet(house)
          .methods.get_user_bets_unconstrained(user.getAddress(), 0n)
          .view({ from: house.getAddress() })
      ).find((noteObj: any) => noteObj._value.bet_id == userRandomness);

      expect(betNote).toBeUndefined();
    });

    it("Nullifies the escrow note", async () => {
      const escrowNote = (
        await token
          .withWallet(house)
          .methods.get_escrows(0)
          .view({ from: house.getAddress() })
      ).find((noteObj: any) => noteObj._value.bet_id == userEscrowRandomness);

      expect(escrowNote).toBeUndefined();
    });
  });

  describe("oracle_callback(..)", () => {
    let callback_data: bigint[];

    beforeAll(async () => {
      // House creates the escrow and shares with the user
      const { randomness: escrowRandomness, authNonce: settleEscrowNonce } = (
        await getHouseEscrowAndAuthNonce()
      )[0];

      // Approve the transfer of tokens from user
      const transferNonce = Fr.random();
      const transferAction = token.methods.transfer(
        user.getAddress(),
        coinToss.address,
        BET_AMOUNT,
        transferNonce
      );
      await createAuth(transferAction, user, coinToss.address);

      await coinToss
        .withWallet(user)
        .methods.create_bet(
          FIRST_BET_NOTE.bet,
          transferNonce,
          escrowRandomness,
          settleEscrowNonce
        )
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
        bet.bet_id,
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

      const amount = SLICED_USER_BET_NOTES.length;

      // Create amount of escrows from the house and authwits
      // House creates the escrow and shares with the user
      const escrowsCreated = await getHouseEscrowAndAuthNonce(amount);

      // Create amount of transfer authwits from the user
      const transferNonces = Array.from({ length: amount }, () => Fr.random());
      const transferActions = transferNonces.map((nonce: Fr) => token.methods.transfer(user.getAddress(), coinToss.address, BET_AMOUNT, nonce));
      await Promise.all(transferActions.map((action) => createAuth(action, user, coinToss.address)));

      await sendBetBatch(SLICED_USER_BET_NOTES.map((bet, index) => {
        return {
          betNote: bet,
          userTransferNonce: transferNonces[index],
          houseEscrowRandomness: escrowsCreated[index].randomness,
          houseSettleEscrowNonce: escrowsCreated[index].authNonce
        }
      }));
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

const sendBetBatch = async (bets: { betNote: BetNote, userTransferNonce: Fr, houseEscrowRandomness: Fr, houseSettleEscrowNonce: Fr }[]) => {
  const batchBets = new BatchCall(
    user,
    bets.map(({betNote, userTransferNonce, houseEscrowRandomness, houseSettleEscrowNonce}) =>
      coinToss.methods.create_bet(betNote.bet, userTransferNonce, houseEscrowRandomness, houseSettleEscrowNonce).request()
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
  const tokenAsFr = token.address.toField();
  const betAmountAsFr = new Fr(BET_AMOUNT);

  await pxe.addNote(
    new ExtendedNote(
      new Note([divinityAsFr, privateOracleAsFr, houseAsFr, tokenAsFr, betAmountAsFr]),
      user,
      contract,
      CONFIG_SLOT,
      txHash
    )
  );
};

const addPendingShieldNoteToPXE = async (
  account: AccountWalletWithPrivateKey,
  amount: bigint,
  secretHash: Fr,
  txHash: TxHash
) => {
  const storageSlot = new Fr(5); // The storage slot of `pending_shields` is 5.

  await pxe.addNote(
    new ExtendedNote(
      new Note([new Fr(amount), secretHash]),
      account.getAddress(),
      token.address,
      storageSlot,
      txHash
    )
  );
};

const mintTokenFor = async (
  account: AccountWalletWithPrivateKey,
  minter: AccountWalletWithPrivateKey,
  amount: bigint
) => {
  // Mint private tokens
  const secret = Fr.random();
  const secretHash = await computeMessageSecretHash(secret);

  const recipt = await token
    .withWallet(minter)
    .methods.mint_private(amount, secretHash)
    .send()
    .wait();

  await addPendingShieldNoteToPXE(minter, amount, secretHash, recipt.txHash);

  await token
    .withWallet(minter)
    .methods.redeem_shield(account.getAddress(), amount, secret)
    .send()
    .wait();
};

// Max is 4
const createEscrows = async (amount: number = 4) => {
  const escrowAction = token.methods.escrow(house.getAddress(), house.getAddress(), BET_AMOUNT, 0).request();
  // House creates multiple escrows and saves them offchain to share with the user
  // Can only create 4 escrows at a time
  const batchEscrows = new BatchCall(
    house,
    Array.from({ length: amount }, () => escrowAction)
  );
  await batchEscrows.send().wait();
}

const getHouseEscrowAndAuthNonce = async (amount: number = 1) => {
  // Get the escrow
  const escrowsArray = await token.withWallet(house).methods.get_escrows(0).view({ from: house.getAddress() });
  const escrowsRandoms = escrowsArray.filter((noteObj: any) => noteObj._is_some).map((escrow: any) => escrow._value.randomness);
  const randomness = escrowsRandoms.slice(0, amount);

  // Create the auth
  let authNonces = Array.from({ length: amount }, () => Fr.random());

  const auths = authNonces.map((nonce: Fr, index) => {
    const settleEscrowAction = token.withWallet(house).methods.settle_escrow(house.getAddress(), coinToss.address, randomness[index], nonce);
    return createAuth(settleEscrowAction, house, coinToss.address);
  });
  await Promise.all(auths)

  return authNonces.map((nonce, index) => ({ authNonce: nonce, randomness: randomness[index] }));
}

const createAuth = async (
  action: ContractFunctionInteraction,
  approver: AccountWalletWithPrivateKey,
  caller: AztecAddress
) => {
  // We need to compute the message we want to sign and add it to the wallet as approved
  const messageHash = await computeAuthWitMessageHash(caller, action.request());

  // Both wallets are connected to same node and PXE so we could just insert directly using
  // await wallet.signAndAddAuthWitness(messageHash, );
  // But doing it in two actions to show the flow.
  const witness = await approver.createAuthWitness(messageHash);
  await approver.addAuthWitness(witness);
};