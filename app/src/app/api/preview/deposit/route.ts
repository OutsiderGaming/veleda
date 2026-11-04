// Launch preview: the "payment" is simulated, and this mints the chosen amount of test VCR. No payment
// details reach this route. Only set amounts are accepted, and a wallet's balance is capped, so it can't
// be used to mint without limit. The wallet comes from the verified session, as in every other route.
import { fetchMaybeToken, getCreateAssociatedTokenIdempotentInstruction, getMintToCheckedInstruction } from "@solana-program/token";
import { getBase64EncodedWireTransaction, signTransactionMessageWithSigners } from "@solana/kit";
import { HttpError, errorResponse, walletFromRequest } from "@/lib/server/privy";
import { VCR, VCR_DECIMALS, VCR_MINT, buildMessage, feePayer, mintAuthority, rpc, sendAndConfirm, vcrAccount } from "@/lib/server/solana";

const AMOUNTS = [20, 50, 100];
const MAX_BALANCE = 500n * VCR;
const inFlight = new Set<string>(); // stops double-taps minting twice (single server process)

export async function POST(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const { amount } = (await req.json()) as { amount?: unknown };
    if (typeof amount !== "number" || !AMOUNTS.includes(amount)) throw new HttpError(400, "Choose one of the set amounts");
    if (inFlight.has(owner)) throw new HttpError(409, "Your last deposit is still going through");
    inFlight.add(owner);
    try {
      const ata = await vcrAccount(owner);
      const token = await fetchMaybeToken(rpc, ata);
      const minted = BigInt(amount) * VCR;
      if ((token.exists ? token.data.amount : 0n) + minted > MAX_BALANCE) throw new HttpError(409, "This preview is limited to a balance of 500");
      const [payer, authority] = await Promise.all([feePayer(), mintAuthority()]);
      const message = await buildMessage(payer, [
        getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner, mint: VCR_MINT }),
        getMintToCheckedInstruction({ mint: VCR_MINT, token: ata, mintAuthority: authority, amount: minted, decimals: VCR_DECIMALS }),
      ]);
      const tx = await signTransactionMessageWithSigners(message);
      await sendAndConfirm(getBase64EncodedWireTransaction(tx));
      return Response.json({ status: "sent" });
    } finally {
      inFlight.delete(owner);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
