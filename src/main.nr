mod types;
 
contract CoinToss {
    use dep::aztec::context::Context;

    struct Storage {
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
            }
        }
    }
 
    // Constructs the contract.
    #[aztec(private)]
    fn constructor() {}

    // Computes note hash and nullifier.
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; 0]) -> [Field; 1] {
        [0]
    }
}