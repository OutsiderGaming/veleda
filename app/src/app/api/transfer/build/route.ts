// Builds "send 1 VCR back to the platform" with the server as fee payer and
// returns it signed by the fee payer only. The user's wallet adds its own
// signature; the fee payer's signature covers the whole message, so the
// client can't change it.
import { createNoopSigner, getBase64EncodedWireTransaction, partiallySignTransactionMessageWithSigners } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { errorResponse, walletFromRequest } from "@/lib/server/privy";
import { TREASURY, VCR, VCR_DECIMALS, VCR_MINT, buildMessage, feePayer, vcrAccount } from "@/lib/server/solana";

export async function POST(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const payer = await feePayer();
    const [source, destination] = await Promise.all([vcrAccount(owner), vcrAccount(TREASURY)]);
    const message = await buildMessage(payer, [
      getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner: TREASURY, mint: VCR_MINT }),
      getTransferCheckedInstruction({ source, mint: VCR_MINT, destination, authority: createNoopSigner(owner), amount: 1n * VCR, decimals: VCR_DECIMALS }),
    ]);
    const tx = await partiallySignTransactionMessageWithSigners(message);
    return Response.json({ transaction: getBase64EncodedWireTransaction(tx) });
  } catch (e) {
    return errorResponse(e);
  }
}
