"use client";

// Positions (mockup screen 4): total value, P&L, Open / Settled tabs, a card
// per position with paid / worth now / if it lands, entry vs current odds,
// and cash out (or claim once the market resolves).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMarkets, type MarketView } from "@/lib/client/markets";
import { useSession, type PositionView } from "@/lib/client/session";
import { formatWindow, pct, vcr } from "@/lib/veleda/timeline";
import s from "./positions.module.css";

interface Settled {
  address: string;
  market: string;
  from: number;
  to: number;
  shares: number;
  paid: number;
  received: number;
  outcome: "won" | "lost" | "cashed out";
}

export default function Positions() {
  const { ready, authenticated, login, positions, request, signAndSubmit } = useSession();
  const { markets, refresh: refreshMarkets } = useMarkets();
  const [tab, setTab] = useState<"open" | "settled">("open");
  const [settled, setSettled] = useState<Settled[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadSettled = useCallback(async () => {
    try {
      setSettled((await request<{ settled: Settled[] }>("/api/positions?settled=1")).settled);
    } catch {
      setSettled((x) => x ?? []);
    }
  }, [request]);

  useEffect(() => {
    if (authenticated) void loadSettled();
  }, [authenticated, loadSettled]);

  if (!ready) return null;
  if (!authenticated) {
    return (
      <div className={s.empty}>
        Sign in to see your windows and cash them out.
        <button className={s.signIn} onClick={login}>Sign in</button>
      </div>
    );
  }

  const open = positions ?? [];
  const valued = open.filter((p) => p.value !== null);
  const total = valued.reduce((t, p) => t + (p.value ?? 0), 0);
  const paid = open.reduce((t, p) => t + (p.paid ?? 0), 0);
  const paidValued = valued.reduce((t, p) => t + (p.paid ?? 0), 0);
  const pnl = total - paidValued;

  async function act(p: PositionView, kind: "sell" | "claim") {
    setBusy(p.address);
    setErrors((e) => ({ ...e, [p.address]: "" }));
    try {
      await signAndSubmit(`/api/trade/${kind}`, { position: p.address });
      void refreshMarkets();
      void loadSettled();
    } catch (e) {
      const m = (e as Error).message;
      setErrors((x) => ({ ...x, [p.address]: /Slippage|0x1775|6005/.test(m) ? "The price moved. Try again." : m.length > 140 ? "That didn't go through. Try again." : m }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className={s.hero}>
        <span className={s.heroValue}>{vcr(total)}</span>
        <span className={s.heroUnit}>VCR</span>
      </div>
      <div className={s.summary}>
        {paidValued > 0 && <span className={pnl >= 0 ? s.gain : s.loss}>{signed(pnl)} ({signedPct(pnl / paidValued)})</span>}
        <span>{vcr(paid)} paid</span>
        <span>{open.length} open</span>
      </div>
      <div className={s.tabs}>
        <button className={`${s.tab} ${tab === "open" ? s.tabOn : ""}`} onClick={() => setTab("open")}>Open · {open.length}</button>
        <button className={`${s.tab} ${tab === "settled" ? s.tabOn : ""}`} onClick={() => setTab("settled")}>Settled · {settled?.length ?? "…"}</button>
      </div>

      {tab === "open" &&
        (open.length === 0 ? (
          <p className={s.empty}>
            No open windows yet. <Link href="/">Pick one on a market</Link>.
          </p>
        ) : (
          open.map((p) => {
            const m = markets?.find((x) => x.name === p.market);
            return m ? <OpenCard key={p.address} p={p} m={m} busy={busy === p.address} error={errors[p.address]} onAct={act} /> : null;
          })
        ))}

      {tab === "settled" &&
        (settled === null ? null : settled.length === 0 ? (
          <p className={s.empty}>Nothing settled yet. Windows you cash out or claim show up here.</p>
        ) : (
          settled.map((x) => {
            const m = markets?.find((y) => y.name === x.market);
            if (!m) return null;
            const gain = x.received - x.paid;
            return (
              <div key={x.address} className={s.card}>
                <div className={s.cardTop}>
                  <div>
                    <Link href={`/m/${m.name}`} className={s.question}>{m.question}</Link>
                    <div className={s.window}>{formatWindow(m, x.from, x.to)}</div>
                  </div>
                  <div className={s.pnl}>
                    <div className={s.outcome}>{x.outcome.toUpperCase()}</div>
                    <div className={`${s.pnlValue} ${gain >= 0 ? s.gain : s.loss}`}>{signed(gain)}</div>
                  </div>
                </div>
                <div className={s.grid} style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 0 }}>
                  <Cell label="Paid" value={vcr(x.paid)} />
                  <Cell label={x.outcome === "cashed out" ? "Cashed out for" : "Paid out"} value={vcr(x.received)} />
                </div>
              </div>
            );
          })
        ))}
    </>
  );
}

function OpenCard({ p, m, busy, error, onAct }: { p: PositionView; m: MarketView; busy: boolean; error?: string; onAct: (p: PositionView, kind: "sell" | "claim") => void }) {
  const gain = p.value !== null && p.paid ? p.value - p.paid : null;
  const won = m.resolved && p.value !== null && p.value > 0;
  const lock = `${m.lockSeconds / 3600}h`;
  return (
    <div className={s.card}>
      <div className={s.cardTop}>
        <div>
          <Link href={`/m/${m.name}`} className={s.question}>{m.question}</Link>
          <div className={s.window}>{formatWindow(m, p.from, p.to)}</div>
        </div>
        {gain !== null && p.paid ? (
          <div className={s.pnl}>
            <div className={s.pnlLabel}>{!m.resolved && <span className={s.liveDot} />}{m.resolved ? "RESULT" : "LIVE P&L"}</div>
            <div className={`${s.pnlValue} ${gain >= 0 ? s.gain : s.loss}`}>{gain >= 0 ? "▲" : "▼"} {signed(gain)}</div>
            <div className={`${s.pnlPct} ${gain >= 0 ? s.gain : s.loss}`}>{signedPct(gain / p.paid)}</div>
          </div>
        ) : null}
      </div>
      <div className={s.grid}>
        <Cell label="Paid" value={p.paid ? vcr(p.paid) : "—"} />
        <Cell label={m.resolved ? "Pays out" : "Worth now"} value={p.value === null ? "Locked" : vcr(p.value)} note={m.resolved ? undefined : "after 3.5% fee"} />
        <Cell label="If it lands" value={vcr(p.shares)} copper note={p.paid ? `×${(p.shares / p.paid).toFixed(1)} at entry` : undefined} />
      </div>
      {p.entryPrice != null && p.currentPrice != null && !m.resolved && (
        <div className={s.odds}>Crowd odds {pct(p.entryPrice)} when you bought · {pct(p.currentPrice)} now</div>
      )}
      {m.resolved ? (
        <button className={s.primary} disabled={busy} onClick={() => onAct(p, "claim")}>
          {busy ? "CLAIMING…" : won ? <>CLAIM <span className={s.sep} /> {vcr(p.value ?? 0)} VCR</> : "CLOSE · NO PAYOUT"}
        </button>
      ) : p.status === "locked" ? (
        <button className={s.locked} disabled>🔒 Locked · within {lock} of now</button>
      ) : (
        <button className={s.primary} disabled={busy} onClick={() => onAct(p, "sell")}>
          {busy ? "CASHING OUT…" : <>CASH OUT <span className={s.sep} /> {vcr(p.value ?? 0)} VCR</>}
        </button>
      )}
      {error && <div className={s.error}>{error}</div>}
    </div>
  );
}

function Cell({ label, value, note, copper }: { label: string; value: string; note?: string; copper?: boolean }) {
  return (
    <div>
      <div className={s.cellLabel}>{label}</div>
      <div className={`${s.cellValue} ${copper ? s.cellCopper : ""}`}>{value}</div>
      {note && <div className={s.cellNote}>{note}</div>}
    </div>
  );
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${vcr(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
