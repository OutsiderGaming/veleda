// Verifies the caller's Privy session and finds their embedded Solana wallet.
// The wallet address always comes from Privy, never from the request body.
import "./env";
import { PrivyClient } from "@privy-io/node";
import { address, type Address } from "@solana/kit";

let client: PrivyClient | undefined;
function privy(): PrivyClient {
  if (!client) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must be set in the repo's .env");
    client = new PrivyClient({ appId, appSecret });
  }
  return client;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function walletFromRequest(req: Request): Promise<Address> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Not signed in");
  let userId: string;
  try {
    ({ user_id: userId } = await privy().utils().auth().verifyAccessToken(token));
  } catch {
    throw new HttpError(401, "Session expired, sign in again");
  }
  const user = await privy().users()._get(userId);
  const wallet = user.linked_accounts
    .map((a) => a as { type: string; chain_type?: string; connector_type?: string; address?: string })
    .find((a) => a.type === "wallet" && a.chain_type === "solana" && a.connector_type === "embedded");
  if (!wallet?.address) throw new HttpError(409, "No Solana wallet yet");
  return address(wallet.address);
}

export function errorResponse(e: unknown): Response {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : String(e);
  if (status === 500) console.error(e);
  return Response.json({ error: message }, { status });
}
