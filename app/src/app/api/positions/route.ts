// The signed-in user's positions.
// Open (default): each position with what it's worth now (the cash-out value
// at the live price, the payout once resolved, or null while the window is in
// the locked zone), what was paid for it and the odds when bought.
// ?settled=1: positions closed by selling or claiming, from recent transactions.
import { errorResponse, walletFromRequest } from "@/lib/server/privy";
import { buyOf, recentEvents } from "@/lib/server/history";
import { fetchMarket, marketList, positionsOf, type MarketState } from "@/lib/server/veleda";
import { BASE, firstOpenAtom, priceForCost, quoteSell } from "@/lib/veleda/market";
import { address } from "@solana/kit";

export async function GET(req: Request) {
  try {
    const owner = await walletFromRequest(req);
    const markets = marketList();
    const nameOf = (market: string) => markets.find((m) => m.address === market)?.name;
    const open = (await positionsOf(owner)).filter((p) => nameOf(p.market));

    if (new URL(req.url).searchParams.get("settled")) {
      const openSet = new Set(open.map((p) => p.address as string));
      const byPosition = new Map<string, { market: string; received: number; won: boolean; claimed: boolean; time: number }>();
      for (const e of await recentEvents(owner)) {
        if (!nameOf(e.market) || openSet.has(e.position) || (e.kind === "trade" && e.isBuy)) continue;
        const s = byPosition.get(e.position) ?? { market: e.market, received: 0, won: false, claimed: false, time: e.time };
        s.received += e.kind === "trade" ? e.amount : e.payout;
        if (e.kind === "claimed") {
          s.claimed = true;
          s.won = e.payout > 0;
        }
        s.time = Math.max(s.time, e.time);
        byPosition.set(e.position, s);
      }
      const settled = [];
      for (const [position, s] of byPosition) {
        const buy = await buyOf(address(position));
        if (!buy) continue;
        settled.push({
          address: position, market: nameOf(s.market), from: buy.from, to: buy.to, shares: buy.shares / BASE,
          paid: buy.amount / BASE, received: s.received / BASE, outcome: s.claimed ? (s.won ? "won" : "lost") : "cashed out", time: s.time,
        });
      }
      settled.sort((a, b) => b.time - a.time);
      return Response.json({ settled });
    }

    const states = new Map<string, MarketState>();
    for (const m of new Set(open.map((p) => p.market))) states.set(m, await fetchMarket(address(m)));
    const positions = [];
    for (const p of open) {
      const { header, prices } = states.get(p.market)!;
      let value: number | null;
      if (header.resolved) value = p.from <= header.winner && header.winner <= p.to ? p.shares : 0;
      else if (p.from < firstOpenAtom(header)) value = null;
      else value = quoteSell(header, prices, p.from, p.to, p.shares, 0).net;
      const buy = await buyOf(p.address).catch(() => null);
      positions.push({
        address: p.address, market: nameOf(p.market), from: p.from, to: p.to, shares: p.shares / BASE,
        value: value === null ? null : value / BASE, status: header.resolved ? "resolved" : value === null ? "locked" : "open",
        // Partial sells keep the original price per share.
        paid: buy ? ((buy.amount / BASE) * p.shares) / buy.shares : null,
        entryPrice: buy ? priceForCost(header, buy.amount - buy.fee, buy.shares) : null,
        currentPrice: prices.slice(p.from, p.to + 1).reduce((a, b) => a + b, 0),
      });
    }
    return Response.json({ positions });
  } catch (e) {
    return errorResponse(e);
  }
}
