// Shared by the trade routes: the user's token account for a market's mint,
// and turning instructions into a fee-payer-signed transaction for the
// user's wallet to sign (then POST it to /api/submit).
import { address, getBase64EncodedWireTransaction, partiallySignTransactionMessageWithSigners, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { HttpError } from "./privy";
import { buildMessage, feePayer } from "./solana";
import type { MarketHeader } from "../veleda/market";

export async function tokenAccount(owner: Address, header: MarketHeader): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: address(header.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

export async function feePayerSigned(instructions: Instruction[]): Promise<string> {
  const message = await buildMessage(await feePayer(), instructions);
  return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message));
}

export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
}

export function atomIndex(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new HttpError(400, `${name} must be an atom index`);
  return v;
}
