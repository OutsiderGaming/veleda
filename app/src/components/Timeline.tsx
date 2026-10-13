"use client";

// The vertical timeline: now at the top, one bar per unit of the zoom level,
// width = crowd odds. Gestures (build plan, week 3 "Select"):
// - swipe scrolls;
// - press and hold a bar anchors a selection, and dragging without lifting
//   extends it, with auto-scroll near the edges and a floating tag;
// - releasing (or a tap, which selects one bar) reports the selection as done;
// - the handles on a finished selection drag either end;
// - a selection never extends into the locked zone or the past.
// With a mouse, pressing and dragging selects straight away.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { rangePrice } from "@/lib/veleda/market";
import { buildBars, isThick, multiplierFor, pct, type Bar, type TimelineMarket, type Zoom } from "@/lib/veleda/timeline";
import s from "./Timeline.module.css";

export interface Range {
  from: number;
  to: number;
}

interface Props {
  market: TimelineMarket;
  zoom: Zoom;
  selection: Range | null;
  /** The user's open positions, drawn as a stripe beside their bars. */
  mine: Range[];
  /** Selection changed; `done` once the finger lifts (or on a tap). */
  onSelect: (range: Range, done: boolean) => void;
  /** The user pressed a bar that can't be traded. */
  onLocked: () => void;
  /** "72h", "1h": the locked zone's length. */
  lockLabel: string;
  /** Hide gestures (resolved markets). */
  readOnly?: boolean;
}

const HOLD_MS = 300;
const SLOP = 8;
const EDGE = 90;
const NAV = 64;

interface Gesture {
  id: number;
  x: number;
  y: number;
  t: number;
  bar: number | null;
  mouse: boolean;
  moved: boolean;
  selecting: boolean;
  anchor: number;
  current: number;
  lastY: number;
  timer?: number;
  raf?: number;
}

export function Timeline({ market, zoom, selection, mine, onSelect, onLocked, lockLabel, readOnly }: Props) {
  const bars = useMemo(() => buildBars(market, zoom), [market, zoom]);
  const END = bars.length; // index of the "not by end date" row
  const thick = isThick(zoom, bars.length);
  const maxPrice = useMemo(() => Math.max(1e-9, ...bars.filter((b) => b.state !== "elapsed").map((b) => b.price)), [bars]);
  const firstOpenBar = useMemo(() => {
    const i = bars.findIndex((b) => b.state === "open");
    return i < 0 ? END : i;
  }, [bars, END]);

  const listRef = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ anchor: number; current: number; y: number } | null>(null);

  // Keep the latest props for the gesture callbacks.
  const live = useRef({ bars, END, firstOpenBar, onSelect, onLocked, market });
  live.current = { bars, END, firstOpenBar, onSelect, onLocked, market };

  const rangeOf = (a: number, b: number): Range => {
    const { bars, market } = live.current;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return { from: Math.max(bars[lo].from, market.firstOpenAtom), to: bars[hi].to };
  };

  const barAt = (y: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const r = list.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, y)?.closest<HTMLElement>("[data-bar]");
    return el && list.contains(el) ? Number(el.dataset.bar) : null;
  };

  const update = (y: number) => {
    const gg = g.current;
    if (!gg?.selecting) return;
    let idx = barAt(y);
    if (idx === null) return;
    const { END, firstOpenBar, onSelect } = live.current;
    idx = Math.min(Math.max(idx, firstOpenBar), END - 1); // stop at the first open bar; never run into "not by end date"
    gg.current = idx;
    setDrag({ anchor: gg.anchor, current: idx, y });
    onSelect(rangeOf(gg.anchor, idx), false);
  };

  const begin = (anchor: number, y: number) => {
    const gg = g.current;
    if (!gg) return;
    const { bars, END, onLocked } = live.current;
    if (anchor === END || bars[anchor]?.state !== "open") {
      if (anchor !== END) onLocked();
      g.current = null;
      return;
    }
    gg.selecting = true;
    gg.anchor = gg.current = anchor;
    try {
      listRef.current?.setPointerCapture(gg.id);
    } catch {}
    navigator.vibrate?.(8);
    setDrag({ anchor, current: anchor, y });
    live.current.onSelect(rangeOf(anchor, anchor), false);
    const tick = () => {
      const cur = g.current;
      if (!cur?.selecting) return;
      const top = EDGE, bottom = window.innerHeight - EDGE - NAV;
      let dy = 0;
      if (cur.lastY < top) dy = -Math.min(28, 3 + (top - cur.lastY) / 3);
      else if (cur.lastY > bottom) dy = Math.min(28, 3 + (cur.lastY - bottom) / 3);
      if (dy) {
        window.scrollBy(0, dy);
        update(cur.lastY);
      }
      cur.raf = requestAnimationFrame(tick);
    };
    gg.raf = requestAnimationFrame(tick);
  };

  const finish = () => {
    const gg = g.current;
    if (!gg) return;
    clearTimeout(gg.timer);
    if (gg.raf) cancelAnimationFrame(gg.raf);
    if (gg.selecting) live.current.onSelect(rangeOf(gg.anchor, gg.current), true);
    g.current = null;
    setDrag(null);
  };

  // Block native scrolling while a selection is being dragged (touch).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const block = (e: TouchEvent) => {
      if (g.current?.selecting) e.preventDefault();
    };
    list.addEventListener("touchmove", block, { passive: false });
    return () => list.removeEventListener("touchmove", block);
  }, []);

  const selected = drag ? rangeOf(drag.anchor, drag.current) : selection;
  const isSel = (b: Pick<Bar, "from" | "to">) => !!selected && b.from <= selected.to && b.to >= selected.from;
  const selLo = selected ? bars.findIndex(isSel) : -1;
  const selHi = selected ? bars.length - 1 - [...bars].reverse().findIndex(isSel) : -1;
  const endSelected = !!selected && selected.from === market.atoms;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (readOnly || e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]");
    g.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), bar: barAt(e.clientY), mouse: e.pointerType === "mouse",
      moved: false, selecting: false, anchor: -1, current: -1, lastY: e.clientY,
    };
    if (handle && selLo >= 0) {
      e.preventDefault();
      begin(handle.dataset.handle === "top" ? selHi : selLo, e.clientY);
      return;
    }
    const gg = g.current;
    if (gg.bar !== null && !gg.mouse) gg.timer = window.setTimeout(() => g.current === gg && begin(gg.bar!, gg.lastY), HOLD_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const gg = g.current;
    if (!gg || e.pointerId !== gg.id) return;
    gg.lastY = e.clientY;
    if (gg.selecting) return update(e.clientY);
    if (Math.hypot(e.clientX - gg.x, e.clientY - gg.y) > SLOP) {
      gg.moved = true;
      clearTimeout(gg.timer);
      if (gg.mouse && gg.bar !== null) begin(gg.bar, e.clientY);
      else g.current = null; // a scroll
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const gg = g.current;
    if (!gg || e.pointerId !== gg.id) return;
    if (gg.selecting) return finish();
    clearTimeout(gg.timer);
    g.current = null;
    if (gg.moved || gg.bar === null) return;
    // A tap selects one bar.
    const { bars, END, onSelect, onLocked, market } = live.current;
    if (gg.bar === END) return onSelect({ from: market.atoms, to: market.atoms }, true);
    if (bars[gg.bar].state !== "open") return onLocked();
    onSelect(rangeOf(gg.bar, gg.bar), true);
  };

  const onPointerCancel = () => {
    if (g.current?.selecting) return finish();
    clearTimeout(g.current?.timer);
    g.current = null;
  };

  const firstLocked = bars.findIndex((b) => b.state === "locked");
  const firstLive = bars.findIndex((b) => b.state !== "elapsed");
  const rowHeight = thick ? 76 : 18;

  return (
    <>
      <div
        ref={listRef}
        className={`${s.list} ${drag ? s.selecting : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {bars.map((b) => {
          const sel = isSel(b);
          const isMine = mine.some((r) => b.from <= r.to && b.to >= r.from);
          const width = b.state === "elapsed" ? 30 : Math.max(thick ? 22 : 6, (b.price / maxPrice) * 100);
          return (
            <div key={`${zoom}-${b.from}`}>
              {b.index === firstLive && (
                <div className={s.marker}>↑ Now{firstLocked === b.index ? ` · locked for ${lockLabel}` : ""}</div>
              )}
              {firstLocked >= 0 && b.index === firstOpenBar && firstOpenBar !== firstLive && (
                <div className={`${s.marker} ${s.markerMuted}`}>Open for trading</div>
              )}
              {b.divider && <div className={thick ? s.divider : s.dividerSmall}>{b.divider}</div>}
              <div
                data-bar={b.index}
                className={`${s.row} ${thick ? s.thick : ""} ${sel ? s.selected : ""} ${sel && b.index === selLo ? s.frameTop : ""} ${sel && b.index === selHi ? s.frameBottom : ""} ${b.state === "elapsed" ? s.elapsed : ""} ${b.state === "locked" ? `${s.locked} ${s.lockedZone}` : ""}`}
                style={{ height: rowHeight, padding: thick ? "6px 0" : "2px 0" }}
              >
                <span className={`${s.side} ${sel ? s.sideStrong : ""}`}>{thick ? null : b.side}</span>
                <span className={`${s.track} ${isMine ? s.mine : ""}`}>
                  <span className={s.bar} style={{ width: `${width}%` }} />
                  {thick && b.label && <span className={s.barLabel}>{b.label}</span>}
                  {!drag && !readOnly && sel && b.index === selLo && (
                    <span data-handle="top" className={s.handle} style={{ top: -13 }} />
                  )}
                  {!drag && !readOnly && sel && b.index === selHi && (
                    <span data-handle="bottom" className={s.handle} style={{ bottom: -13 }} />
                  )}
                </span>
                {!thick && <span className={s.right} />}
                {thick && (
                  <span className={s.right}>
                    {b.state === "open" && (
                      <>
                        <div className={s.mult}><small>×</small>{fmtMult(multiplierFor(market, Math.max(b.from, market.firstOpenAtom), b.to))}</div>
                        <div className={s.pct}>{pct(b.price)}</div>
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div className={s.divider}>After the window</div>
        <div
          data-bar={END}
          className={`${s.row} ${s.thick} ${endSelected ? s.selected : ""}`}
          style={{ height: 76, padding: "6px 0" }}
        >
          <span className={s.side} />
          <span className={s.track}>
            <span className={s.bar} style={{ width: `${Math.min(100, Math.max(22, (market.prices[market.atoms] / maxPrice) * 100))}%` }} />
            <span className={s.barLabel} style={{ fontSize: 14 }}>NOT BY THE END</span>
          </span>
          <span className={s.right}>
            <div className={s.mult}><small>×</small>{fmtMult(multiplierFor(market, market.atoms, market.atoms))}</div>
            <div className={s.pct}>{pct(market.prices[market.atoms])}</div>
          </span>
        </div>
      </div>
      {drag && <DragTag market={market} range={rangeOf(drag.anchor, drag.current)} y={drag.y} unit={market.atomSeconds >= 86_400 ? "day" : "hour"} />}
    </>
  );
}

function DragTag({ market, range, y, unit }: { market: TimelineMarket; range: Range; y: number; unit: string }) {
  const n = range.to - range.from + 1;
  const p = rangePrice(market.prices, range.from, range.to);
  return (
    <div className={s.tag} style={{ top: Math.min(Math.max(y, 90), window.innerHeight - 160) }}>
      <div className={s.tagTop}>
        {n} {unit}{n === 1 ? "" : "s"} · {pct(p)}
      </div>
      <div className={s.tagMult}><small>×</small>{fmtMult(multiplierFor(market, range.from, range.to))}</div>
    </div>
  );
}

export function fmtMult(m: number): string {
  return m >= 100 ? m.toFixed(0) : m.toFixed(1);
}
