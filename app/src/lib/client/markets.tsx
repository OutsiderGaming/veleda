"use client";

// Live market state for every screen: polls /api/markets (header plus every
// atom's price) every 10 seconds while the page is visible, and on demand
// after a trade.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface MarketView {
  name: string;
  address: string;
  question: string;
  /** One line on how it resolves. */
  resolves: string;
  atoms: number;
  atomSeconds: number;
  startTime: number;
  /** The market's clock (chain time + offset) when this was fetched, unix seconds. */
  now: number;
  lockSeconds: number;
  liveEdge: number;
  firstOpenAtom: number;
  resolved: boolean;
  winner: number | null;
  /** Depth in base units (the API sends VCR; converted on fetch for the quote functions). */
  b: number;
  prices: number[];
  /** Total traded, VCR. */
  volume: number;
  /** Date.now() when fetched. */
  fetchedAt: number;
}

interface MarketsState {
  markets: MarketView[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MarketsState>({ markets: null, error: null, refresh: async () => {} });
const POLL_MS = 10_000;

export function MarketsProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<MarketView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      const fetchedAt = Date.now();
      setMarkets((json.markets as Omit<MarketView, "fetchedAt">[]).map((m) => ({ ...m, b: m.b * 1_000_000, fetchedAt })));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return <Ctx.Provider value={{ markets, error, refresh }}>{children}</Ctx.Provider>;
}

export const useMarkets = () => useContext(Ctx);

export function useMarket(name: string): MarketView | null | undefined {
  const { markets } = useMarkets();
  if (!markets) return undefined; // still loading
  return markets.find((m) => m.name === name) ?? null;
}

/** The market's clock now, unix seconds (extrapolated from the last fetch). */
export const marketNowSec = (m: MarketView, nowMs = Date.now()) => m.now + (nowMs - m.fetchedAt) / 1000;
