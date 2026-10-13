// Builds a claim on a resolved market: pays 1 VCR per share if the
// position's window holds the winning atom, and closes the position.
import { address, createNoopSigner } from "@solana/kit";
import { HttpError, errorResponse, walletFromRequest } from "@/lib/server/privy";
import { body, feePayerSigned, tokenAccount } from "@/lib/server/trade";
import { fetchMarket, fetchPosition, marketAddress } from "@/lib/server/veleda";
import { BASE } from "@/lib/veleda/market";
import { claim } from "@/lib/veleda/program";

export async function POST(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const b = await body<{ position: string }>(req);
    const positionAddress = address(String(b.position));
    const position = await fetchPosition(positionAddress);
    if (position.owner !== owner) throw new HttpError(403, "Not your position");
    const { address: market, header } = await fetchMarket(marketAddress(position.market));
    if (!header.resolved) throw new HttpError(409, "This market hasn't resolved yet");

    const won = position.from <= header.winner && header.winner <= position.to;
    const instruction = await claim({ market, mint: address(header.mint) }, createNoopSigner(owner), positionAddress, address(position.rentPayer),
      await tokenAccount(owner, header));
    return Response.json({ transaction: await feePayerSigned([instruction]), payout: won ? position.shares / BASE : 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
