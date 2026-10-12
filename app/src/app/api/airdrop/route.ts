// Sign-up airdrop: creates the user's VCR account and mints 100 VCR into it.
// The server pays the fee and the account's rent; the user signs nothing.
import { getBase64EncodedWireTransaction, getSignatureFromTransaction, signTransactionMessageWithSigners } from "@solana/kit";
import { fetchMaybeToken, getCreateAssociatedTokenIdempotentInstruction, getMintToCheckedInstruction } from "@solana-program/token";
import { errorResponse, walletFromRequest } from "@/lib/server/privy";
import { VCR, VCR_DECIMALS, VCR_MINT, buildMessage, feePayer, mintAuthority, rpc, sendAndConfirm, vcrAccount } from "@/lib/server/solana";

const SIGNUP_AMOUNT = 100n * VCR;
const inFlight = new Set<string>(); // stops double-clicks minting twice (single server process)

export async function POST(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const ata = await vcrAccount(owner);
    if ((await fetchMaybeToken(rpc, ata)).exists || inFlight.has(owner)) {
      return Response.json({ status: "already-claimed" });
    }
    inFlight.add(owner);
    try {
      const [payer, authority] = await Promise.all([feePayer(), mintAuthority()]);
      const message = await buildMessage(payer, [
        getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner, mint: VCR_MINT }),
        getMintToCheckedInstruction({ mint: VCR_MINT, token: ata, mintAuthority: authority, amount: SIGNUP_AMOUNT, decimals: VCR_DECIMALS }),
      ]);
      const tx = await signTransactionMessageWithSigners(message);
      await sendAndConfirm(getBase64EncodedWireTransaction(tx));
      return Response.json({ status: "sent", signature: getSignatureFromTransaction(tx) });
    } finally {
      inFlight.delete(owner);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
