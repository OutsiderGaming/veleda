"use client";

// The signed-in user: Privy session, embedded wallet, VCR balance (with the
// sign-up airdrop sent automatically the first time), open positions, and
// the build → sign → submit flow every trade uses.
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase64Decoder, getBase64Encoder } from "@solana/kit";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface PositionView {
  address: string;
  market: string;
  from: number;
  to: number;
  shares: number;
  /** Cash-out value now (VCR), payout once resolved, or null while locked. */
  value: number | null;
  status: "open" | "locked" | "resolved";
  /** What the user paid for the shares still held (VCR), if known. */
  paid?: number | null;
  /** Window price when bought, 0..1, if known. */
  entryPrice?: number | null;
}

interface Session {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  address: string | null;
  /** VCR, or null until known. */
  balance: number | null;
  /** The sign-up airdrop is on its way. */
  airdropping: boolean;
  positions: PositionView[] | null;
  refresh: () => Promise<void>;
  /** Authenticated JSON request to our API. */
  request: <T = Record<string, unknown>>(path: string, body?: unknown) => Promise<T>;
  /** Builds a transaction on the server, signs it in the wallet, relays it. */
  signAndSubmit: <T = Record<string, unknown>>(path: string, body: unknown) => Promise<{ built: T; signature: string }>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0];
  const address = authenticated ? (wallet?.address ?? null) : null;

  const [balance, setBalance] = useState<number | null>(null);
  const [positions, setPositions] = useState<PositionView[] | null>(null);
  const [airdropping, setAirdropping] = useState(false);
  const airdropTried = useRef<string | null>(null);

  const request = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      return json as T;
    },
    [getAccessToken],
  );

  const refresh = useCallback(async () => {
    if (!address) return;
    const [bal, pos] = await Promise.allSettled([
      fetch(`/api/balance?owner=${address}`, { cache: "no-store" }).then((r) => r.json()),
      request<{ positions: PositionView[] }>("/api/positions"),
    ]);
    if (bal.status === "fulfilled" && typeof bal.value.vcr === "number") setBalance(bal.value.vcr);
    if (pos.status === "fulfilled") setPositions(pos.value.positions);
  }, [address, request]);

  // Sign-up airdrop: the first time we see this wallet with no VCR, ask for the 100 VCR (the route is idempotent).
  useEffect(() => {
    if (!address || balance === null || balance > 0 || airdropTried.current === address) return;
    airdropTried.current = address;
    setAirdropping(true);
    request("/api/airdrop", {})
      .catch(() => {})
      .finally(async () => {
        await refresh();
        setAirdropping(false);
      });
  }, [address, balance, request, refresh]);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setPositions(null);
      return;
    }
    void refresh();
    const t = setInterval(() => document.visibilityState === "visible" && void refresh(), 15_000);
    return () => clearInterval(t);
  }, [address, refresh]);

  const signAndSubmit = useCallback(
    async <T,>(path: string, body: unknown) => {
      if (!wallet) throw new Error("Your wallet is still being set up");
      const built = await request<T & { transaction: string }>(path, body);
      const { signedTransaction } = await signTransaction({ transaction: getBase64Encoder().encode(built.transaction) as Uint8Array, wallet });
      const { signature } = await request<{ signature: string }>("/api/submit", { transaction: getBase64Decoder().decode(signedTransaction) });
      void refresh();
      return { built: built as T, signature };
    },
    [wallet, request, signTransaction, refresh],
  );

  return (
    <Ctx.Provider
      value={{ ready, authenticated, login, logout, address, balance, airdropping, positions, refresh, request, signAndSubmit }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
