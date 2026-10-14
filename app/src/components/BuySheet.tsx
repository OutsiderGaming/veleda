"use client";

// Buy sheet (mockup screen 3): the selected window, multiplier after fees and
// price impact for the chosen stake, stake chips, payout, the primary button,
// and the share link. Signed out, the button opens sign-in; the sheet stays.
// Swipe down (or tap outside) to close.

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useMarkets, type MarketView } from "@/lib/client/markets";
import { useSession } from "@/lib/client/session";
import { FEE, priceForCost, quoteBuy } from "@/lib/veleda/market";
import { formatWindow, pct, vcr } from "@/lib/veleda/timeline";
import { fmtMult, type Range } from "./Timeline";
import s from "./BuySheet.module.css";

const CHIPS = [5, 20, 50];

export function BuySheet({ market, range, onClose }: { market: MarketView; range: Range; onClose: () => void }) {
  const session = useSession();
  const { refresh: refreshMarkets } = useMarkets();
  const [stake, setStake] = useState(20);
  const [other, setOther] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ shares: number } | null>(null);
  const [shared, setShared] = useState(false);
  const [dy, setDy] = useState(0);
  const dragStart = useRef<number | null>(null);

  useEffect(() => setError(null), [range.from, range.to, stake]);

  const base = Math.round(stake * 1_000_000);
  const q = quoteBuy(market, market.prices, range.from, range.to, Math.max(base, 1));
  const shares = q.shares / 1_000_000;
  const cancelAt = priceForCost(market, base * (1 - FEE), q.shares);

  // Swipe down to close.
  const onDown = (e: ReactPointerEvent) => {
    dragStart.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => dragStart.current !== null && setDy(Math.max(0, e.clientY - dragStart.current));
  const onUp = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dy > 90) onClose();
    setDy(0);
  };

  async function buy() {
    if (!session.authenticated) return session.login();
    setBusy(true);
    setError(null);
    try {
      await session.signAndSubmit("/api/trade/buy", { market: market.name, from: range.from, to: range.to, stake });
      setDone({ shares });
      void refreshMarkets();
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = `${location.origin}/m/${market.name}?from=${range.from}&to=${range.to}`;
    try {
      if (navigator.share) await navigator.share({ title: market.question, text: `${formatWindow(market, range.from, range.to)} · ×${fmtMult(q.multiplier)}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {}
  }

  const balance = session.balance;
  let label: React.ReactNode = <>PREDICT THE FUTURE <span className={s.sep} /> {vcrShort(stake)} VCR</>;
  let disabled = busy || stake <= 0 || q.shares <= 0 || market.resolved;
  if (busy) label = "PLACING YOUR CALL…";
  else if (session.authenticated && session.airdropping) {
    label = "GETTING YOUR 100 VCR…";
    disabled = true;
  } else if (session.authenticated && balance === null) {
    label = "ONE MOMENT…";
    disabled = true;
  } else if (session.authenticated && balance !== null && balance < stake) {
    label = "NOT ENOUGH VCR";
    disabled = true;
  }

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <div className={s.sheet} style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: dy ? "none" : "transform 0.2s" }}>
        <div className={s.grab} style={{ touchAction: "none" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {done ? (
          <div className={s.done}>
            <div className={`${s.raysArea} ${s.doneHead}`}>
              <Rays />
              <div className={s.doneTick}>✓</div>
              <div className={s.doneTitle}>You&apos;ve called it</div>
            </div>
            <p className={s.doneText}>
              {formatWindow(market, range.from, range.to)}
              <br />
              Wins {vcr(done.shares)} VCR if it lands. Cash out any time.
            </p>
            <Link href="/positions" className={s.primary} style={{ textDecoration: "none" }}>SEE YOUR POSITIONS</Link>
            <button className={s.secondary} onClick={onClose}>Back to the timeline</button>
          </div>
        ) : (
          <div>
            <div className={`${s.raysArea} ${s.tradeHead}`}>
              <Rays />
              <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: "none" }}>
                <div className={s.window}>{formatWindow(market, range.from, range.to)}</div>
                <div className={s.multRow}>
                  <span className={s.mult}><small>×</small>{fmtMult(q.multiplier)}</span>
                </div>
                <div className={s.odds}>Crowd odds {pct(q.price)} · payout after fees</div>
              </div>
              <div className={s.stakeLabel}>Stake (VCR)</div>
              <div className={s.chips}>
                {CHIPS.map((c) => (
                  <button key={c} className={`${s.chip} ${other === null && stake === c ? s.chipOn : ""}`} onClick={() => { setOther(null); setStake(c); }}>
                    {c}
                  </button>
                ))}
                {other === null ? (
                  <button className={`${s.chip} ${s.chipOther}`} onClick={() => setOther(String(stake))}>Other</button>
                ) : (
                  <input
                    className={s.chipInput}
                    inputMode="decimal"
                    autoFocus
                    value={other}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, "");
                      setOther(v);
                      const n = Number(v);
                      if (n > 0) setStake(Math.min(n, 100_000));
                    }}
                  />
                )}
              </div>
            </div>
            <div className={s.wins}>
              <span className={s.winsLabel}>Wins if it lands</span>
              <span className={s.winsValue}>{vcr(shares)}<small>VCR</small></span>
            </div>
            <div className={s.detail}>
              {Math.round(shares).toLocaleString("en-GB")} shares · 3.5% fee included · cancels if price passes {pctFine(cancelAt)}
            </div>
            {error && <div className={s.error}>{error}</div>}
            <div>
              <button className={s.primary} disabled={disabled} onClick={buy}>{label}</button>
              <button className={s.secondary} onClick={share}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
                {shared ? "Link copied" : "Share this window as a link"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** One more decimal place than pct(): the cancel price sits just above the current odds. */
const pctFine = (p: number) => `${(p * 100).toFixed(p >= 0.01 ? 2 : 3)}%`;

const vcrShort = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** Program errors arrive as custom error codes in the failed transaction. */
function friendly(message: string): string {
  if (/Slippage|0x1775|6005/.test(message)) return "The price moved while you were deciding. Check the new figures and try again.";
  if (/Locked|0x1771|6001/.test(message)) return "That window has just entered the locked zone. Pick a later start.";
  if (/insufficient funds|0x1\b/.test(message)) return "Not enough VCR for that stake.";
  if (/User rejected|cancel/i.test(message)) return "Cancelled.";
  return message.length > 140 ? "Something went wrong placing your call. Try again." : message;
}

/** Decorative radiating copper lines (mockup screen 3), clipped to the bottom of its .raysArea. */
function Rays() {
  const lines = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    return <line key={i} x1="200" y1="190" x2={200 + Math.cos(a) * 400} y2={190 + Math.sin(a) * 400} stroke="#E9A867" strokeWidth="0.8" opacity="0.5" />;
  });
  return (
    <div className={s.raysClip} aria-hidden>
      <svg className={s.rays} viewBox="0 0 320 340">
        {lines}
        <circle cx="200" cy="190" r="2" fill="#F6C792" />
      </svg>
    </div>
  );
}
