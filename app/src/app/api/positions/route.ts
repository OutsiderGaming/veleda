// The signed-in user's open positions, with what each is worth now: the
// cash-out value at the live price, the payout once resolved, or null while
// the window is in the locked zone.
import { errorResponse, walletFromRequest } from "@/lib/server/privy";
import { fetchMarket, marketList, positionsOf, type MarketState } from "@/lib/server/veleda";
import { BASE, firstOpenAtom, quoteSell } from "@/lib/veleda/market";

export async function GET(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const markets = marketList();
    const positions = (await positionsOf(owner)).filter((p) => markets.some((m) => m.address === p.market));
    const states = new Map<string, MarketState>();
    for (const m of new Set(positions.map((p) => p.market))) states.set(m, await fetchMarket(markets.find((x) => x.address === m)!.address));

    return Response.json({
      positions: positions.map((p) => {
        const { header, prices } = states.get(p.market)!;
        const name = markets.find((m) => m.address === p.market)!.name;
        let value: number | null;
        if (header.resolved) value = p.from <= header.winner && header.winner <= p.to ? p.shares : 0;
        else if (p.from < firstOpenAtom(header)) value = null;
        else value = quoteSell(header, prices, p.from, p.to, p.shares, 0).net;
        return {
          address: p.address, market: name, from: p.from, to: p.to, shares: p.shares / BASE,
          value: value === null ? null : value / BASE, status: header.resolved ? "resolved" : value === null ? "locked" : "open",
        };
      }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
