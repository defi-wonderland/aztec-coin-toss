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

import { TokenContract } from "../app/src/abis/token/Token.js";

import { PrivateOracleContract } from "../app/src/abis/oracle/PrivateOracle.js";

const PAYMENT_TOKEN_SLOT: Fr = new Fr(1);
const FEE_SLOT: Fr = new Fr(2);
const QUESTIONS_SLOT: Fr = new Fr(3);
const ANSWERS_SLOT: Fr = new Fr(4);

const QUESTION = 123n;
const ANSWER = 456n;
const ALTERNATIVE_ANSWER = 789n;
const FEE = 1000n;
const MINT_AMOUNT = 10000n;

const ADDRESS_ZERO = AztecAddress.fromBigInt(0n);

let pxe: PXE;
let oracle: PrivateOracleContract;
let token: TokenContract;

let requester: AccountWalletWithPrivateKey;
let requester2: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;

// Setup: Set the sandbox
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);

  [, [requester, requester2, divinity], deployer] = await Promise.all([
    waitForSandbox(pxe),
    getSandboxAccountsWallets(pxe),
    createAccount(pxe),
  ]);
}, 60_000);

describe("E2E Coin Toss", () => {

  beforeAll(async () => {
    // Deploy the token
    token = await TokenContract.deploy(deployer, requester.getAddress())
      .send()
      .deployed();

    // Mint tokens for the requester
    await mintTokenFor(requester, requester, MINT_AMOUNT);

    // Deploy the oracle
    const receipt = await PrivateOracleContract.deploy(
      deployer,
      token.address,
      FEE
    )
      .send()
      .wait();
    oracle = receipt.contract;

    // Add the contract public key to the PXE
    await pxe.registerRecipient(oracle.completeAddress);

    await addTokenAndFeeNotesToPXE(
      requester.getAddress(),
      oracle.address,
      token.address,
      FEE,
      receipt.txHash
    );
  }, 60_000);

  it('passes', () => {
    expect(true).toBe(true);
  })
});

const createAuthEscrowMessage = async (
  token: TokenContract,
  from: AccountWalletWithPrivateKey,
  agent: AztecAddress,
  participants: AztecAddress[],
  amount: any
) => {
  const nonce = Fr.random();

  // We need to compute the message we want to sign and add it to the wallet as approved
  const action = token.methods.escrow(
    from.getAddress(),
    agent,
    amount,
    participants,
    nonce
  );
  const messageHash = await computeAuthWitMessageHash(agent, action.request());

  // Both wallets are connected to same node and PXE so we could just insert directly using
  // await wallet.signAndAddAuthWitness(messageHash, );
  // But doing it in two actions to show the flow.
  const witness = await from.createAuthWitness(messageHash);
  await from.addAuthWitness(witness);
  return nonce;
};

const addTokenAndFeeNotesToPXE = async (
  requester: AztecAddress,
  oracle: AztecAddress,
  token: AztecAddress,
  fee: bigint,
  txHash: TxHash
) => {
  await Promise.all([
    // Add note for the payment token
    pxe.addNote(
      new ExtendedNote(
        new Note([token.toField()]),
        requester,
        oracle,
        PAYMENT_TOKEN_SLOT,
        txHash
      )
    ),

    // Add note for the fee
    pxe.addNote(
      new ExtendedNote(
        new Note([new Fr(fee)]),
        requester,
        oracle,
        FEE_SLOT,
        txHash
      )
    ),
  ]);
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
