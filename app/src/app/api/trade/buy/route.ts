// Builds a buy: `stake` VCR (fee included) on atoms [from, to] of a market,
// quoted at the live price. The stake is the most the user can pay; the
// program rejects the trade if the price moved too far. Our fee payer pays
// the transaction fee and the position's rent.
import { address, createNoopSigner } from "@solana/kit";
import { HttpError, errorResponse, walletFromRequest } from "@/lib/server/privy";
import { feePayer } from "@/lib/server/solana";
import { atomIndex, body, feePayerSigned, tokenAccount } from "@/lib/server/trade";
import { fetchMarket, marketAddress } from "@/lib/server/veleda";
import { BASE, firstOpenAtom, quoteBuy } from "@/lib/veleda/market";
import { buyRange, positionPda } from "@/lib/veleda/program";

export async function POST(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const b = await body<{ market: string; from: number; to: number; stake: number }>(req);
    const { address: market, header, prices } = await fetchMarket(marketAddress(String(b.market)));
    const from = atomIndex(b.from, "from");
    const to = atomIndex(b.to, "to");
    const stake = Math.round(Number(b.stake) * BASE);
    if (!(stake >= BASE / 100)) throw new HttpError(400, "Stake must be at least 0.01 VCR");
    if (header.resolved) throw new HttpError(409, "This market has resolved");
    if (from > to || to > header.atoms) throw new HttpError(400, "That window is outside the market");
    if (from < firstOpenAtom(header)) throw new HttpError(400, "That window starts too soon: it's inside the locked zone");

    const quote = quoteBuy(header, prices, from, to, stake);
    if (quote.shares <= 0) throw new HttpError(400, "Stake too small for this window");
    const payer = await feePayer();
    const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const instruction = await buyRange({ market, mint: address(header.mint) }, createNoopSigner(owner), payer, await tokenAccount(owner, header), {
      nonce, from, to, shares: quote.shares, maxCost: quote.maxCost,
    });
    return Response.json({
      transaction: await feePayerSigned([instruction]),
      position: await positionPda(market, owner, nonce),
      quote: { stake: stake / BASE, shares: quote.shares / BASE, price: quote.price, multiplier: quote.multiplier },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
