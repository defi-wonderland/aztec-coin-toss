import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  BatchCall,
  computeAuthWitMessageHash,
  computeMessageSecretHash,
  ContractFunctionInteraction,
  createAccount,
  createPXEClient,
  ExtendedNote,
  Fr,
  getSandboxAccountsWallets,
  Note,
  PXE,
  TxHash,
  waitForSandbox,
} from "@aztec/aztec.js";

import { initAztecJs } from "@aztec/aztec.js/init";

import { BetNote, ResultNote } from "./Notes.js";
import { CoinTossContract } from "../artifacts/CoinToss.js";
import { TokenContract } from "../artifacts/token/Token.js";
import { PrivateOracleContract } from "../artifacts/oracle/PrivateOracle.js";

// Constants
const CONFIG_SLOT: Fr = new Fr(1);

// Oracle storage layout
const TOKEN_SLOT: Fr = new Fr(1);
const FEE_SLOT: Fr = new Fr(2);

const MINT_TOKENS = 100000n;

const ORACLE_FEE = 100n;
const BET_AMOUNT = 1337n;

// Global variables
let pxe: PXE;
let coinToss: CoinTossContract;
let token: TokenContract;
let oracle: PrivateOracleContract;

let user: AccountWalletWithPrivateKey;
let house: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;

// Setup: Set the sandbox up and get the accounts
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);

  [, [user, house, divinity], deployer] = await Promise.all([
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
  let betIdUser: bigint;
  let betIdHouse: bigint;
  let userRandomness: bigint;
  let houseRandomness: bigint;

  // Setup: Deploy the contracts and mint tokens, ready for escrow
  beforeAll(async () => {
    USER_BET_NOTES = createUserBetNotes(4);

    FIRST_BET_NOTE = USER_BET_NOTES[0];

    // Deploy the token with the  house as a minter
    token = await TokenContract.deploy(deployer, house.getAddress())
      .send()
      .deployed();

    // Deploy the oracle
    const oracleReceipt = await PrivateOracleContract.deploy(deployer, token.address, ORACLE_FEE)
    .send()
    .wait();

    oracle = oracleReceipt.contract;

    // Mint the tokens
    await mintTokenFor(house, house, MINT_TOKENS);
    await mintTokenFor(user, house, MINT_TOKENS);

    // Deploy Coin Toss
    const coinTossReceipt = await CoinTossContract.deploy(
      deployer,
      divinity.getAddress(),
      oracle.address,
      house.getAddress(),
      token.address,
      BET_AMOUNT
    )
      .send()
      .wait();

    coinToss = coinTossReceipt.contract;

    // Add the contract public key to the PXE
    await pxe.registerRecipient(coinToss.completeAddress);
    await pxe.registerRecipient(oracle.completeAddress);

    await addFeeAndTokenNotesToPxe(user.getAddress(), oracleReceipt.txHash);

    // Add all address notes to pxe
    await addConfigNotesToPxe(
      user.getAddress(),
      coinToss.address,
      coinTossReceipt.txHash
    );

    // Create 8 escrows
    await createEscrows(4);
    await createEscrows(4);
  }, 200_000);

  // Test: create_bet(..) flows, check if the bet is created correctly, with correct amounts transferred in escrow
  describe("create_bet(..)", () => {
    let expectedCallback: bigint[] = [];

    describe("errors", () => {
      it("Reverts if the escrow provided by the house is lower than the bet amount", async () => {
        const { escrowRandom, settleEscrowNonce } =
          await createEscrowWithAmount(BET_AMOUNT - 1n);

        // Approve the transfer of tokens from user
        const transferNonce = Fr.random();
        const transferAction = token.methods.transfer(
          user.getAddress(),
          coinToss.address,
          BET_AMOUNT,
          transferNonce
        );
        await createAuth(transferAction, user, coinToss.address);

        const createBetTx = await coinToss
          .withWallet(user)
          .methods.create_bet(
            FIRST_BET_NOTE.bet,
            transferNonce,
            escrowRandom,
            settleEscrowNonce,
            FIRST_BET_NOTE.bet_id
          );

        await expect(createBetTx.simulate()).rejects.toThrowError(
          `Invalid escrow amount`
        );
      });

      it("Reverts if the escrow provided by the house is higher than the bet amount", async () => {
        const { escrowRandom, settleEscrowNonce } =
          await createEscrowWithAmount(BET_AMOUNT + 1n);

        // Approve the transfer of tokens from user
        const transferNonce = Fr.random();
        const transferAction = token.methods.transfer(
          user.getAddress(),
          coinToss.address,
          BET_AMOUNT,
          transferNonce
        );
        await createAuth(transferAction, user, coinToss.address);

        const createBetTx = await coinToss
          .withWallet(user)
          .methods.create_bet(
            FIRST_BET_NOTE.bet,
            transferNonce,
            escrowRandom,
            settleEscrowNonce,
            FIRST_BET_NOTE.bet_id
          );

        await expect(createBetTx.simulate()).rejects.toThrowError(
          `Invalid escrow amount`
        );
      });
    });

    // Happy path:
    it("Tx to create_bet is mined", async () => {
      const createBetTx = await createBetAction(user, FIRST_BET_NOTE.bet, FIRST_BET_NOTE.bet_id);
      const receipt = await createBetTx.send().wait();
      expect(receipt.status).toBe("mined");
    });

    // Happy path:
    it("The bet_id should have been nullified", async () => {
      const result = await coinToss.withWallet(user).methods.is_id_nullified(FIRST_BET_NOTE.bet_id).view({from: user.getAddress()});
      expect(result).toBe(true);
    });

    it("User bet note should have the correct parameters", async () => {
      const bet: BetNote = new BetNote(
        (
          await coinToss
            .withWallet(user)
            .methods.get_user_bets_unconstrained(0n)
            .view({ from: user.getAddress() })
        )[0]._value
      );

      type BetNoteWithoutRandomness = Omit<BetNote, "escrow_randomness">

      // Check: Compare the note's data with the expected values
      const betNote: BetNoteWithoutRandomness = {
        owner: FIRST_BET_NOTE.owner,
        bet_id: FIRST_BET_NOTE.bet_id,
        bet: FIRST_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));

      // Store the random nullifier, for later comparison
      betIdUser = bet.bet_id;
      userRandomness = bet.escrow_randomness;
    });

    it("House should have the copy of the same note as the user with correct parameters", async () => {
      const bet: BetNote = new BetNote(
        (
          await coinToss
            .withWallet(house)
            .methods.get_user_bets_unconstrained(0n)
            .view({ from: house.getAddress() })
        )[0]._value
      );

      type BetNoteWithoutRandomness = Omit<BetNote, "escrow_randomness">

      const betNote: BetNoteWithoutRandomness = {
        owner: FIRST_BET_NOTE.owner,
        bet_id: FIRST_BET_NOTE.bet_id,
        bet: FIRST_BET_NOTE.bet,
      };

      expect(bet).toEqual(expect.objectContaining(betNote));

      // Store the random nullifier, for later comparison
      betIdHouse = bet.bet_id;
      houseRandomness = bet.escrow_randomness;
    });

    it("User and house should share the same bet_id and escrow_randomness", async () => {
      expect(betIdUser).toBe(betIdHouse);
      expect(userRandomness).toBe(houseRandomness);
    });

    it("Created a question note for the user with the correct parameters", async () => {
      const questionNote = (
        await oracle
          .withWallet(user)
          .methods.get_questions_unconstrained(user.getAddress(), 0)
          .view({ from: user.getAddress() })
      ).find((noteObj: any) => noteObj._is_some)._value;

      expectedCallback = [coinToss.address.toBigInt(), user.getAddress().toBigInt(), FIRST_BET_NOTE.bet_id, house.getAddress().toBigInt(), 0n, 0n]

      expect(questionNote.request).toBe(FIRST_BET_NOTE.bet_id);
      expect(questionNote.requester_address.address).toBe(user.getAddress().toBigInt());
      expect(questionNote.divinity_address.address).toBe(divinity.getAddress().toBigInt());
      expect(questionNote.callback).toStrictEqual(expectedCallback);
    });

    it("Created a question note for the house with the correct parameters", async () => {
      const questionNote = (
        await oracle
          .withWallet(house)
          .methods.get_questions_unconstrained(user.getAddress(), 0)
          .view({ from: house.getAddress() })
      ).find((noteObj: any) => noteObj._is_some)._value;

      expect(questionNote.request).toBe(FIRST_BET_NOTE.bet_id);
      expect(questionNote.requester_address.address).toBe(user.getAddress().toBigInt());
      expect(questionNote.divinity_address.address).toBe(divinity.getAddress().toBigInt());
      expect(questionNote.callback).toStrictEqual(expectedCallback);
    });

    it("Created a resulting escrow note with the correct parameters", async () => {
      const escrowNote = (
        await token
          .withWallet(user)
          .methods.get_escrows(10)
          .view({ from: user.getAddress() })
      ).find((noteObj: any) => noteObj._value.randomness == userRandomness)._value;

      expect(escrowNote.amount.value).toBe(BET_AMOUNT * 2n);
      expect(escrowNote.owner.address).toBe(coinToss.address.toBigInt());
    });

    it("Took the correct amount of tokens from the user", async () => {
      const userBalance = await token
        .withWallet(user)
        .methods.balance_of_private(user.getAddress())
        .view({ from: user.getAddress() });

      expect(userBalance).toBe(MINT_TOKENS - BET_AMOUNT - ORACLE_FEE);
    });
  });

  // Test: oracle_callback(..) flows, check if the result note is created correctly
  describe("oracle_callback(..)", () => {
    let callback_data: bigint[];

    beforeAll(async () => {
      callback_data = [
        user.getAddress().toBigInt(),
        FIRST_BET_NOTE.bet_id,
        house.getAddress().toBigInt(),
        0n,
        0n,
      ];
    });

    it("Tx to submit_answer is mined", async () => {
      const receipt = await oracle
      .withWallet(divinity)
      .methods.submit_answer(
        FIRST_BET_NOTE.bet_id,
        user.getAddress(),
        FIRST_BET_NOTE.bet == false ? 1n : 0n // user loses
      )
      .send()
      .wait();

      expect(receipt.status).toBe("mined");
    });

    it("creates a result note to the user", async () => {
      const result_notes = await coinToss
        .withWallet(user)
        .methods.get_results_unconstrained(user.getAddress(), 0n)
        .view({ from: user.getAddress() });

      const result_note = new ResultNote(
        result_notes.find(
          (noteObj: any) => noteObj._value.bet_id == callback_data[1]
        )._value
      );

      expect(result_note).toEqual(
        new ResultNote({
          owner: user.getAddress(),
          sender: oracle.address,
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

      const result_note = new ResultNote(
        result_notes.find(
          (noteObj: any) => noteObj._value.bet_id == callback_data[1]
        )._value
      );

      expect(result_note).toEqual(
        new ResultNote({
          owner: house.getAddress(),
          sender: oracle.address,
          bet_id: callback_data[1],
          result: true,
        })
      );
    });
  });

  // Test: settle_bet(..) flows, check if the bet note is nullified, the amount is transferred to the correct party, and the escrow note is nullified
  describe("settle_bet()", () => {
    let houseBalance: bigint;

    it("Tx to settle_bet is mined", async () => {
      // Save the private balance of the house
      houseBalance = await token
        .withWallet(house)
        .methods.balance_of_private(house.getAddress())
        .view({ from: house.getAddress() });

      const receipt = await coinToss
        .withWallet(user)
        .methods.settle_bet(FIRST_BET_NOTE.bet_id)
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
          .methods.get_user_bets_unconstrained(0n)
          .view({ from: house.getAddress() })
      ).find((noteObj: any) => noteObj._value.bet_id == FIRST_BET_NOTE.bet_id);

      expect(betNote).toBeUndefined();
    });

    it("Nullifies the escrow note", async () => {
      const escrowNote = (
        await token
          .withWallet(house)
          .methods.get_escrows(0)
          .view({ from: house.getAddress() })
      ).find((noteObj: any) => noteObj._value.randomness == houseRandomness);

      expect(escrowNote).toBeUndefined();
    });
  });

  // Test: get_user_bets_unconstrained(..), check if the correct bets are returned
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
      const uniqueBetIds = Array.from({ length: amount }, () => Fr.random());

      const transferActions = transferNonces.map((nonce: Fr) =>
        token.methods.transfer(
          user.getAddress(),
          coinToss.address,
          BET_AMOUNT,
          nonce
        )
      );

      const submitQuestionActions = uniqueBetIds.map((id: Fr) => oracle.methods.submit_question(user.getAddress(), id, divinity.getAddress(), id, [coinToss.address, user.getAddress(), id, house.getAddress(), 0, 0]));
      const escrowActions = uniqueBetIds.map((id) => token.methods.escrow(user.getAddress(), oracle.address, ORACLE_FEE, id));

      await Promise.all([
        ...transferActions.map((action) => createAuth(action, user, coinToss.address)),
        ...submitQuestionActions.map((action) => createAuth(action, user, coinToss.address)),
        ...escrowActions.map((action) => createAuth(action, user, oracle.address))
      ]);

      await sendBetBatch(
        SLICED_USER_BET_NOTES.map((bet, index) => {
          return {
            betNote: bet,
            userTransferNonce: transferNonces[index],
            houseEscrowRandomness: escrowsCreated[index].randomness,
            houseSettleEscrowNonce: escrowsCreated[index].authNonce,
            uniqueBetId: uniqueBetIds[index]
          };
        })
      );
    }, 250_000);

    it("returns the correct user bets", async () => {
      const bets: BetNote[] = (
        await coinToss
          .withWallet(user)
          .methods.get_user_bets_unconstrained(0n)
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

    it.skip("returns the correct questions when using an offset", async () => {
      // Implement based on questions offset test
    });
  });

  // Test: get_results_unconstrained(..), check if the correct config is returned
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
        oracle.address.toBigInt()
      );
      expect(config.house.address).toEqual(house.getAddress().toBigInt());
      expect(config.bet_amount).toEqual(BET_AMOUNT);
    });
  });
});

// Create an array of mock bet notes
function createUserBetNotes(number: number = 3): BetNote[] {
  let betNote: BetNote;
  let betNotes: BetNote[] = [];

  for (let i = 0; i < number; i++) {
    betNote = new BetNote({
      owner: user.getAddress(),
      bet_id: Fr.random().toBigInt(),
      bet: !!(i % 2), // 0: Heads, 1: Tails
    });

    betNotes.push(betNote);
  }

  return betNotes;
}

// Batch send bets
const sendBetBatch = async (
  bets: {
    betNote: BetNote;
    userTransferNonce: Fr;
    houseEscrowRandomness: Fr;
    houseSettleEscrowNonce: Fr;
    uniqueBetId: Fr;
  }[]
) => {
  const batchBets = new BatchCall(
    user,
    bets.map(
      ({
        betNote,
        userTransferNonce,
        houseEscrowRandomness,
        houseSettleEscrowNonce,
        uniqueBetId
      }) =>
        coinToss.methods
          .create_bet(
            betNote.bet,
            userTransferNonce,
            houseEscrowRandomness,
            houseSettleEscrowNonce,
            uniqueBetId
          )
          .request()
    )
  );

  await batchBets.send().wait();
};

// Add the config notes to the PXE
const addFeeAndTokenNotesToPxe = async (
  user: AztecAddress,
  txHash: TxHash
) => {
  await pxe.addNote(
    new ExtendedNote(
      new Note([new Fr(ORACLE_FEE)]),
      user,
      oracle.address,
      FEE_SLOT,
      txHash
    )
  );

  await pxe.addNote(
    new ExtendedNote(
      new Note([new Fr(token.address.toBigInt())]),
      user,
      oracle.address,
      TOKEN_SLOT,
      txHash
    )
  );
};

// Add the config notes to the PXE
const addConfigNotesToPxe = async (
  user: AztecAddress,
  contract: AztecAddress,
  txHash: TxHash
) => {
  const divinityAsFr = divinity.getAddress().toField();
  const privateOracleAsFr = oracle.address.toField();
  const houseAsFr = house.getAddress().toField();
  const tokenAsFr = token.address.toField();
  const betAmountAsFr = new Fr(BET_AMOUNT);

  await pxe.addNote(
    new ExtendedNote(
      new Note([
        divinityAsFr,
        privateOracleAsFr,
        houseAsFr,
        tokenAsFr,
        betAmountAsFr,
      ]),
      user,
      contract,
      CONFIG_SLOT,
      txHash
    )
  );
};

// Add the pending shield note to the PXE
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

// Mint tokens for an account
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

// Create an escrow with a specific amount
const createEscrowWithAmount = async (amount: bigint) => {
  await token
    .withWallet(house)
    .methods.escrow(house.getAddress(), house.getAddress(), amount, 0)
    .send()
    .wait();
  const escrowsArray = await token
    .withWallet(house)
    .methods.get_escrows(0)
    .view({ from: house.getAddress() });
  const escrowRandom = escrowsArray
    .filter((noteObj: any) => noteObj._is_some)
    .find((noteObj: any) => noteObj._value.amount.value == amount)
    ._value.randomness;

  const settleEscrowNonce = Fr.random();
  const settleEscrowAction = token
    .withWallet(house)
    .methods.settle_escrow(
      house.getAddress(),
      coinToss.address,
      escrowRandom,
      settleEscrowNonce
    );
  await createAuth(settleEscrowAction, house, coinToss.address);

  return { escrowRandom, settleEscrowNonce };
};

// Create multiple escrows (up to 4, limit of the batch call)
const createEscrows = async (amount: number = 4) => {
  const escrowAction = token.methods
    .escrow(house.getAddress(), house.getAddress(), BET_AMOUNT, 0)
    .request();
  // House creates multiple escrows and saves them offchain to share with the user
  // Can only create 4 escrows at a time
  const batchEscrows = new BatchCall(
    house,
    Array.from({ length: amount }, () => escrowAction)
  );
  await batchEscrows.send().wait();
};

// Get the escrow and auth nonce for the house
const getHouseEscrowAndAuthNonce = async (amount: number = 1) => {
  // Get the escrow
  const escrowsArray = await token
    .withWallet(house)
    .methods.get_escrows(0)
    .view({ from: house.getAddress() });
  const escrowsRandoms = escrowsArray
    .filter((noteObj: any) => noteObj._is_some)
    .filter((noteObj: any) => noteObj._value.amount.value == BET_AMOUNT)
    .map((escrow: any) => escrow._value.randomness);
  const randomness = escrowsRandoms.slice(0, amount);

  // Create the auth
  let authNonces = Array.from({ length: amount }, () => Fr.random());

  const auths = authNonces.map((nonce: Fr, index) => {
    const settleEscrowAction = token
      .withWallet(house)
      .methods.settle_escrow(
        house.getAddress(),
        coinToss.address,
        randomness[index],
        nonce
      );
    return createAuth(settleEscrowAction, house, coinToss.address);
  });
  await Promise.all(auths);

  return authNonces.map((nonce, index) => ({
    authNonce: nonce,
    randomness: randomness[index],
  }));
};

// Create an authWitness for a specific action
const createAuth = async (
  action: ContractFunctionInteraction,
  approver: AccountWalletWithPrivateKey,
  caller: AztecAddress
) => {
  // We need to compute the message we want to sign and add it to the wallet as approved
  const messageHash = computeAuthWitMessageHash(caller, action.request());

  // Both wallets are connected to same node and PXE so we could just insert directly using
  // await wallet.signAndAddAuthWitness(messageHash, );
  // But doing it in two actions to show the flow.
  const witness = await approver.createAuthWitness(messageHash);
  await approver.addAuthWitness(witness);
};

const createBetAction = async (caller: AccountWalletWithPrivateKey, bet: boolean, bet_id: bigint): Promise<ContractFunctionInteraction> => {
  const transferNonce = Fr.random();
  
  const {escrowRandom, settleEscrowNonce} = await createEscrowWithAmount(BET_AMOUNT);
  // Create transfer authwit
  const transferAction = token.methods.transfer(caller.getAddress(), coinToss.address, BET_AMOUNT, transferNonce);
  await createAuth(transferAction, user, coinToss.address);

  // Create submit_question authwit
  const submitQuestionAction = oracle.methods.submit_question(
    caller.getAddress(),
    bet_id,
    divinity.getAddress(),
    bet_id,
    [coinToss.address, caller.getAddress(), bet_id, house.getAddress(), 0, 0]
  );

  await createAuth(submitQuestionAction, caller, coinToss.address);
  
  // Create escrow authwit
  const escrowAction = token.methods.escrow(
    caller.getAddress(),
    oracle.address,
    ORACLE_FEE,
    bet_id,
  );

  await createAuth(escrowAction, caller, oracle.address);
  
  const contractInteraction: ContractFunctionInteraction = await coinToss
  .withWallet(caller)
  .methods.create_bet(bet, transferNonce, escrowRandom, settleEscrowNonce, bet_id);
  
  return contractInteraction
}