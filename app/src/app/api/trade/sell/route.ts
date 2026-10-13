// Builds a cash-out: sells `shares` (default: all) from one of the user's
// positions at the live price, accepting up to 1% slippage.
import { address, createNoopSigner } from "@solana/kit";
import { HttpError, errorResponse, walletFromRequest } from "@/lib/server/privy";
import { body, feePayerSigned, tokenAccount } from "@/lib/server/trade";
import { fetchMarket, fetchPosition, marketAddress } from "@/lib/server/veleda";
import { BASE, firstOpenAtom, quoteSell } from "@/lib/veleda/market";
import { sellRange } from "@/lib/veleda/program";

export async function POST(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const b = await body<{ position: string; shares: number }>(req);
    const positionAddress = address(String(b.position));
    const position = await fetchPosition(positionAddress);
    if (position.owner !== owner) throw new HttpError(403, "Not your position");
    const { address: market, header, prices } = await fetchMarket(marketAddress(position.market));
    if (header.resolved) throw new HttpError(409, "This market has resolved: claim instead");
    if (position.from < firstOpenAtom(header)) throw new HttpError(409, "This window is in the locked zone and can't be cashed out");
    const shares = b.shares === undefined ? position.shares : Math.round(Number(b.shares) * BASE);
    if (!(shares > 0 && shares <= position.shares)) throw new HttpError(400, "Invalid share amount");

    const quote = quoteSell(header, prices, position.from, position.to, shares);
    const instruction = await sellRange({ market, mint: address(header.mint) }, createNoopSigner(owner), positionAddress, address(position.rentPayer),
      await tokenAccount(owner, header), { shares, minProceeds: quote.minProceeds });
    return Response.json({
      transaction: await feePayerSigned([instruction]),
      quote: { shares: shares / BASE, proceeds: quote.net / BASE, minProceeds: quote.minProceeds / BASE },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
