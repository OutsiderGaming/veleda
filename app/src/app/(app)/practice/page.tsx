"use client";

// Practice mode (hackathon spec, "Practice mode"): a scripted market on a
// fictional event that you scrub forwards and backwards. Same maths as the
// real markets (the reference model), no chain, no sign-in, labelled as
// simulated throughout.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Timeline, fmtMult, type Range } from "@/components/Timeline";
import { BEATS, END_TIME, beatById, quoteAtBuy, replay } from "@/lib/practice/replay";
import { DAY, SCENARIO as S } from "@/lib/practice/scenario";
import { pct, vcr, type TimelineMarket } from "@/lib/veleda/timeline";
import s from "./practice.module.css";

const HOUR = 3_600;
const LABELS = Array.from({ length: S.atoms }, (_, i) => `DAY ${i + 1}`);
const days = (w: Range) => (w.from === w.to ? `Day ${w.from + 1}` : `Days ${w.from + 1}–${w.to + 1}`);
/** The script needs the window it's written for, so the pick step only accepts days 6–7 (or part of it on the way there). */
const W = S.window;
const isScripted = (w: Range | null) => w?.from === W.from && w.to === W.to;

export default function Practice() {
  const [t, setT] = useState(0);
  const [picked, setPicked] = useState<Range | null>(null);
  const [cashOut, setCashOut] = useState(false);
  const buyAt = beatById("buy").at;
  const choiceAt = beatById("choice").at;

  // Scrubbing back to (or before) the choice undoes it.
  const move = (to: number) => {
    const next = Math.max(0, Math.min(END_TIME, to));
    if (next <= choiceAt) setCashOut(false);
    setT(next);
  };

  const snap = useMemo(() => replay(t, W, cashOut), [t, cashOut]);
  const quote = useMemo(() => quoteAtBuy(W), []);
  const picking = t < buyAt && snap.beat.id === "pick";
  // From the buy on, the window is always the scripted one, even if the user skipped ahead with the scrubber.
  const selection = t >= buyAt ? W : picking ? picked : null;
  const beatIndex = BEATS.findIndex((b) => b.id === snap.beat.id);

  // Scroll to what the caption talks about: the question first, then the start of the
  // timeline, then the user's window as the story moves on.
  useEffect(() => {
    const id = snap.beat.id;
    if (id === "question") { scrollTo({ top: 0, behavior: "smooth" }); return; }
    const row = document.querySelector<HTMLElement>(`[data-bar="${id === "timeline" ? 0 : W.from}"]`);
    if (!row) return;
    const top = row.getBoundingClientRect().top + scrollY - innerHeight * 0.22;
    scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [snap.beat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const market: TimelineMarket = {
    atoms: S.atoms, atomSeconds: S.atomSeconds, startTime: S.startTime, b: S.b * 1_000_000, labels: LABELS,
    liveEdge: snap.liveEdge, firstOpenAtom: snap.firstOpenAtom, prices: snap.prices, now: Math.min(t, S.happensAt),
  };
  const pos = snap.position;
  const clock = `Day ${Math.floor(Math.min(t, END_TIME - 1) / DAY) + 1} · ${String(Math.floor((t % DAY) / HOUR)).padStart(2, "0")}:00`;

  return (
    <>
      <div className={s.top}>
        <span className={s.tag}>PRACTICE · SIMULATED PRICES</span>
        <button className={s.restart} onClick={() => { setT(0); setCashOut(false); setPicked(null); }}>Restart</button>
      </div>
      <h1 className={`${s.question} ${snap.beat.id === "question" ? s.spotlight : ""}`}>{S.question}</h1>
      <div className={s.clock}>{clock}</div>

      <div className={s.caption}>
        <div className={s.step}>STEP {beatIndex + 1} OF {BEATS.length}</div>
        <p className={s.text}>{snap.beat.caption}</p>

        {picking && !isScripted(picked) && (
          <p className={s.hint}>Press and hold {days({ from: W.from, to: W.from })}, then drag down to {days({ from: W.to, to: W.to })}.</p>
        )}
        {picking && isScripted(picked) && (
          <>
            <div className={s.figures}>
              <Fig label="Your window" value={days(W)} />
              <Fig label="Crowd odds" value={pct(quote.price)} />
              <Fig label="Pays" value={`×${fmtMult(quote.multiplier)}`} copper />
            </div>
            <button className={s.primary} onClick={() => move(buyAt)}>
              PREDICT THE FUTURE <span className={s.sep} /> {S.stake} VCR
            </button>
          </>
        )}

        {pos && (
          <div className={s.figures}>
            <Fig label="Paid" value={vcr(pos.paid)} />
            {pos.cashedOut !== null ? (
              <Fig label="Cashed out" value={vcr(pos.cashedOut)} copper />
            ) : snap.resolved ? (
              <Fig label="Paid out" value={vcr(pos.payout ?? 0)} copper />
            ) : (
              <Fig label="Worth now" value={pos.value === null ? "Locked" : vcr(pos.value)} />
            )}
            <Fig label="If it lands" value={pos.cashedOut !== null ? "—" : vcr(pos.shares)} copper={pos.cashedOut === null} />
          </div>
        )}

        {snap.beat.id === "choice" && pos && pos.cashedOut === null && pos.value !== null && (
          <>
            <button className={s.primary} onClick={() => { setCashOut(true); move(beatById("locked").at); }}>
              CASH OUT <span className={s.sep} /> {vcr(pos.value)} VCR
            </button>
            <button className={s.secondary} onClick={() => move(beatById("locked").at)}>Hold for {vcr(pos.shares)} VCR</button>
          </>
        )}

        {snap.resolved && pos && (
          <div className={s.result}>
            {pos.cashedOut !== null
              ? `You locked in ${vcr(pos.cashedOut)} VCR early.`
              : pos.payout
                ? `You win ${vcr(pos.payout)} VCR.`
                : "Not this time: your window missed."}
          </div>
        )}
        {snap.resolved ? (
          <Link href="/" className={s.primary} style={{ textDecoration: "none" }}>TRY A REAL MARKET →</Link>
        ) : snap.beat.id !== "pick" && snap.beat.id !== "choice" && t < END_TIME && (
          <button className={s.secondary} onClick={() => move(BEATS[beatIndex + 1]?.at ?? END_TIME)}>Next →</button>
        )}
      </div>

      <Timeline
        market={market}
        zoom="day"
        selection={selection}
        mine={pos && pos.cashedOut === null ? [W] : []}
        lockLabel="24h"
        rowHeight={46}
        handles={false}
        endLabel="NOT BY DAY 10"
        winner={snap.winner}
        readOnly={!picking}
        onSelect={(r, done) => {
          // Mid-drag, anything goes; on release, keep it only if it's days 6–7 or part of the way there.
          if (!done) return;
          setPicked(r.from >= W.from && r.to <= W.to ? r : null);
        }}
        onClear={() => setPicked(null)}
        onLocked={() => {}}
      />
      <div className={s.spacer} />

      <div className={s.scrubber}>
        <div className={s.scrubInner}>
          <button className={s.nav} disabled={beatIndex <= 0 && t === 0} aria-label="Previous step"
            onClick={() => move(t > snap.beat.at ? snap.beat.at : (BEATS[beatIndex - 1]?.at ?? 0))}>‹</button>
          <div className={s.rangeWrap}>
            <div className={s.ticks}>
              {BEATS.map((b) => <span key={b.id} className={s.tick} style={{ left: `${(b.at / END_TIME) * 100}%` }} />)}
            </div>
            <input className={s.range} type="range" min={0} max={END_TIME} step={HOUR} value={t} aria-label="Time"
              onChange={(e) => move(Number(e.target.value))} />
          </div>
          <button className={s.nav} disabled={t >= END_TIME} aria-label="Next step"
            onClick={() => move(BEATS[beatIndex + 1]?.at ?? END_TIME)}>›</button>
        </div>
      </div>
    </>
  );
}

function Fig({ label, value, copper }: { label: string; value: string; copper?: boolean }) {
  return (
    <div>
      <div className={s.label}>{label}</div>
      <div className={`${s.value} ${copper ? s.copper : ""}`}>{value}</div>
    </div>
  );
}
