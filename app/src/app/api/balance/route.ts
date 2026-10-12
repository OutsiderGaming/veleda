// SOL and VCR balances for an address (public data).
import { address } from "@solana/kit";
import { fetchMaybeToken } from "@solana-program/token";
import { errorResponse } from "@/lib/server/privy";
import { rpc, vcrAccount } from "@/lib/server/solana";

export async function GET(req: Request) {
  try {
    const owner = address(new URL(req.url).searchParams.get("owner") ?? "");
    const [{ value: lamports }, token] = await Promise.all([rpc.getBalance(owner).send(), vcrAccount(owner).then((a) => fetchMaybeToken(rpc, a))]);
    return Response.json({ sol: Number(lamports) / 1e9, vcr: token.exists ? Number(token.data.amount) / 1e6 : 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
