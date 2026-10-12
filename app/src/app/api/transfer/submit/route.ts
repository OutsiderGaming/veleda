// Relays a transaction the user has signed. It must already carry our fee
// payer's signature (so only messages this server built can be sent) and be
// fully signed.
import { assertIsFullySignedTransaction, getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { HttpError, errorResponse, walletFromRequest } from "@/lib/server/privy";
import { feePayer, sendAndConfirm } from "@/lib/server/solana";

export async function POST(req: Request) {
  try {
    await walletFromRequest(req);
    const { transaction } = (await req.json()) as { transaction?: string };
    if (!transaction) throw new HttpError(400, "Missing transaction");
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(transaction));
    const payer = await feePayer();
    if (!tx.signatures[payer.address]) throw new HttpError(400, "Not a transaction this server built");
    try {
      assertIsFullySignedTransaction(tx);
    } catch {
      throw new HttpError(400, "Transaction is missing a signature");
    }
    const signature = await sendAndConfirm(getBase64EncodedWireTransaction(tx));
    return Response.json({ signature });
  } catch (e) {
    return errorResponse(e);
  }
}
