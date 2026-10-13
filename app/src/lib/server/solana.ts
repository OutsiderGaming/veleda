// Server-side Solana: RPC, the platform's signers and transaction helpers.
// Keys are read from the repo's keys/ directory (gitignored) for local dev, or
// from FEE_PAYER_KEY / MINT_AUTHORITY_KEY environment variables when deployed.
import "./env";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createTransactionMessage, devnet,
  getBase64EncodedWireTransaction, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  type Address, type Instruction, type KeyPairSigner, type Signature, type TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const rpc = createSolanaRpc(devnet(RPC_URL));

export const VCR_MINT = address(process.env.TOKEN_MINT ?? "CjkpwuK5BU8sC4vhAgvnGLFg1QAf4xLNxiRKesMEfXaP");
export const VCR_DECIMALS = 6;
export const VCR = 10n ** BigInt(VCR_DECIMALS);
/** The admin key's address; receives VCR sent back to the platform. */
export const TREASURY = address("7dWt1KD67eQXbjAitJEAYtNJbRjYQdep3sGwK5rrzDiC");

const KEYS_DIR = process.env.VELEDA_KEYS_DIR ?? path.resolve(process.cwd(), "..", "keys");
const signers = new Map<string, Promise<KeyPairSigner>>();
function signer(name: string): Promise<KeyPairSigner> {
  if (!signers.has(name)) {
    // On a host without keys/ (Vercel), the same JSON comes from FEE_PAYER_KEY / MINT_AUTHORITY_KEY.
    const env = process.env[`${name.replace(/-/g, "_").toUpperCase()}_KEY`];
    const json = env || readFileSync(/*turbopackIgnore: true*/ path.join(KEYS_DIR, `${name}.json`), "utf8");
    const bytes = Uint8Array.from(JSON.parse(json));
    signers.set(name, createKeyPairSignerFromBytes(bytes));
  }
  return signers.get(name)!;
}
/** Pays every transaction fee and every rent deposit, so users never need SOL. */
export const feePayer = () => signer("fee-payer");
export const mintAuthority = () => signer("mint-authority");

export async function vcrAccount(owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: VCR_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

export async function buildMessage(payer: TransactionSigner, instructions: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** Sends a fully signed base64 wire transaction and waits (up to ~45s) for confirmation. */
export async function sendAndConfirm(wire: ReturnType<typeof getBase64EncodedWireTransaction>): Promise<Signature> {
  const signature = await rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
  for (let i = 0; i < 45; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not confirmed in time: ${signature}`);
}
