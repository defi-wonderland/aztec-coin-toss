# Aztec Coin Toss

Aztec Coin Toss provides a framework for betting markets. In this iteration we include betting for the toss of a coin (heads/tails, true/false). We leverage the [Aztec Private Oracle](https://github.com/defi-wonderland/aztec-private-oracle/) by choosing a trusted divinity that will provide a random number that determines the outcome of the bet. 

The users that bet and the results of each round remain fully private at all times. No information is leaked to the outside and only the user and the house know that bets are happening. This allows users to be able to bet freely on anything they want at all times. 

The Coin Toss works by pairing the users and house balance in equal parts in a winner takes all scenario. The user chooses heads or tails and the house takes the other side. It uses the [escrow functionality](https://github.com/defi-wonderland/aztec-token/blob/dev/src/contracts/src/main.nr#L365-L387) added to the token implementation to allow contracts to hold private tokens temporarily for users. The house creates escrows from their side with the bet amount and then shares this escrows with the users via an off-chain layer for them to use.

You can check our design for the proof of concept on [Figma](https://www.figma.com/file/5eKR0a3jnMgcGZp49cYIrS/Aztec-Coin-Toss?type=whiteboard&node-id=1%3A26&t=1PE3dJpf7iXGaMK2-1).

![Design](design.png?raw=true)

## Flow:

1. User requests an escrow note from the off-chain layer and the house shares it with them

2. User creates a new bet, betting on heads. Consuming the escrow note shared from the house.
    
3. The creation of the bet also initiates the request in the private oracle

4. The divinity answers with a randomness, triggering the creation of answer notes for both the user and the house via a callback included in the contract

5. If the user won, they can call settle_bet which pairs the result note with the bet validating that the user won and then it burns the escrow note sending the full amount to the user. If they lost, the house can claim the win at any time.

## Installation

1) Install the Aztec Sandbox by following this [guide](https://docs.aztec.network/dev_docs/getting_started/quickstart#install-the-sandbox)

2) To install the coin toss, in the root of the project run:
```
yarn
```

## Running tests

With the sandbox running and the project installed, execute this to compile the contracts and run the tests:
```
yarn test
```

## Want to contribute?

If you have ideas on how to make the coin toss better, improve its performance or add additional features, don't hesitate to fork and send pull requests!

We also need people to test out pull requests. So take a look through the open issues and help where you want.
