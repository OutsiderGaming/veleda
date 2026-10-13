// The demo markets with their live state and every atom's price (public data).
import { errorResponse } from "@/lib/server/privy";
import { fetchMarket, marketList } from "@/lib/server/veleda";
import { BASE, firstOpenAtom, marketNow } from "@/lib/veleda/market";

export async function GET() {
  try {
    const markets = await Promise.all(
      marketList().map(async ({ name, address, question }) => {
        const { header: h, prices } = await fetchMarket(address);
        return {
          name, address, question,
          atoms: h.atoms, atomSeconds: h.atomSeconds, startTime: h.startTime, now: marketNow(h),
          lockSeconds: h.lockSeconds, liveEdge: h.liveEdge, firstOpenAtom: firstOpenAtom(h),
          resolved: h.resolved, winner: h.resolved ? h.winner : null, b: h.b / BASE, prices,
        };
      }),
    );
    return Response.json({ markets });
  } catch (e) {
    return errorResponse(e);
  }
}
