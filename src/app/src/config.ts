import { PXE, createPXEClient } from '@aztec/aztec.js';
import { ContractArtifact } from '@aztec/foundation/abi';
import { PrivateOracleContractArtifact } from './abis/oracle/PrivateOracle.js';
import { TokenContractArtifact } from './abis/token/Token.js';

// update this if using a different contract

export const oracleArtifact: ContractArtifact = PrivateOracleContractArtifact;
export const tokenArtifact: ContractArtifact = TokenContractArtifact;

export const PXE_URL: string = process.env.PXE_URL || 'http://localhost:8080';
export const pxe: PXE = createPXEClient(PXE_URL);

export const CONTRACT_ADDRESS_PARAM_NAMES = ['owner', 'address', 'recipient'];
export const FILTERED_FUNCTION_NAMES = ['compute_note_hash_and_nullifier'];
