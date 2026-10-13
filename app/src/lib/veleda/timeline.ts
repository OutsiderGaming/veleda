// Turns a market's atoms into timeline bars for each zoom level, and formats
// windows. Daily markets are labelled in UTC (each atom is a UTC calendar
// day, and the flagship resolves on a calendar date); hourly markets in the
// viewer's local time.
import { FEE, quoteBuy } from "./market";

export interface TimelineMarket {
  atoms: number;
  atomSeconds: number;
  startTime: number;
  liveEdge: number;
  firstOpenAtom: number;
  prices: number[];
  /** Market clock, unix seconds. */
  now: number;
  /** Depth, base units. */
  b: number;
  /** Bar labels by atom, replacing dates (practice mode's "DAY 1"…). */
  labels?: string[];
}

export type Zoom = "year" | "month" | "day" | "hour";
export const ZOOMS: Zoom[] = ["year", "month", "day", "hour"];
export const ZOOM_LABEL: Record<Zoom, string> = { year: "Year", month: "Month", day: "Day", hour: "Hour" };
const UNIT_SECONDS: Record<Zoom, number> = { year: 365 * 86_400, month: 28 * 86_400, day: 86_400, hour: 3_600 };

export interface Bar {
  index: number;
  /** First and last atom. */
  from: number;
  to: number;
  /** Text engraved on the bar (thick bars). */
  label?: string;
  /** Text beside the bar (thin bars), shown only on some bars. */
  side?: string;
  /** A divider above this bar (a new year, month or day). */
  divider?: string;
  state: "elapsed" | "locked" | "open";
  price: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const isDaily = (m: Pick<TimelineMarket, "atomSeconds">) => m.atomSeconds >= 86_400;
export const atomStart = (m: Pick<TimelineMarket, "startTime" | "atomSeconds">, i: number) => m.startTime + i * m.atomSeconds;

function parts(m: Pick<TimelineMarket, "atomSeconds">, unix: number) {
  const d = new Date(unix * 1000);
  return isDaily(m)
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), dow: d.getUTCDay() }
    : { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), dow: d.getDay() };
}

function unitKey(m: TimelineMarket, zoom: Zoom, i: number): string {
  const p = parts(m, atomStart(m, i));
  if (zoom === "year") return `${p.y}`;
  if (zoom === "month") return `${p.y}-${p.mo}`;
  if (zoom === "day") return `${p.y}-${p.mo}-${p.d}`;
  return `${p.y}-${p.mo}-${p.d}-${p.h}`;
}

/** Zoom levels that make sense for this market: no finer than one atom, and at least two bars. */
export function zoomsFor(m: TimelineMarket): Zoom[] {
  return ZOOMS.filter((z) => {
    if (UNIT_SECONDS[z] < m.atomSeconds) return false;
    return unitKey(m, z, 0) !== unitKey(m, z, m.atoms - 1);
  });
}

export const defaultZoom = (m: TimelineMarket): Zoom => (isDaily(m) ? "month" : "hour");

/** Short timelines get the thick, labelled bars of Month view, whatever the zoom level. */
export const isThick = (zoom: Zoom, bars: number) => zoom === "year" || zoom === "month" || bars <= 31;

/** The timeline's bars at one zoom level, timed atoms only ("not by end date" is drawn separately). */
export function buildBars(m: TimelineMarket, zoom: Zoom): Bar[] {
  const bars: Bar[] = [];
  let from = 0;
  for (let i = 1; i <= m.atoms; i++) {
    if (i < m.atoms && unitKey(m, zoom, i) === unitKey(m, zoom, from)) continue;
    const to = i - 1;
    let price = 0;
    for (let a = from; a <= to; a++) price += m.prices[a];
    const end = atomStart(m, to + 1);
    const state = end <= m.now ? "elapsed" : to < m.firstOpenAtom ? "locked" : "open";
    const text = m.labels ? { label: m.labels[from] } : decorate(m, zoom, from, bars.length === 0);
    bars.push({ index: bars.length, from, to, state, price, ...text });
    from = i;
  }
  return bars;
}

function decorate(m: TimelineMarket, zoom: Zoom, from: number, first: boolean): Pick<Bar, "label" | "side" | "divider"> {
  const p = parts(m, atomStart(m, from));
  const prev = from > 0 ? parts(m, atomStart(m, from - 1)) : null;
  if (zoom === "year") return { label: `${p.y}` };
  if (zoom === "month") return { label: MONTHS[p.mo].toUpperCase(), divider: first || prev?.y !== p.y ? `${p.y}` : undefined };
  if (zoom === "day") {
    return {
      label: `${DAYS[p.dow].toUpperCase()} ${p.d}`,
      side: p.dow === 1 || first ? `${p.d} ${MONTHS[p.mo]}` : undefined,
      divider: first || prev?.mo !== p.mo ? `${MONTHS[p.mo]} ${p.y}` : undefined,
    };
  }
  return {
    side: p.h % 3 === 0 || first ? `${String(p.h).padStart(2, "0")}:00` : undefined,
    divider: first || prev?.d !== p.d ? `${DAYS[p.dow]} ${p.d} ${MONTHS[p.mo]}` : undefined,
  };
}

/**
 * Atom range for a selection from bar `a` to bar `b` (either order). It never
 * starts before the first open atom: a bar that's partly locked is clipped,
 * and bars wholly in the locked zone or the past are skipped.
 */
export function selectionRange(bars: Bar[], a: number, b: number, firstOpenAtom: number): { from: number; to: number } | null {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (bars[hi].to < firstOpenAtom) return null;
  return { from: Math.max(bars[lo].from, firstOpenAtom), to: bars[hi].to };
}

/** "14 Mar – 2 Apr 2028 · 20 days", "Tue 14 Oct, 15:00–21:00 · 6 hours", or "Not by 12 Oct 2029". */
export function formatWindow(m: Pick<TimelineMarket, "atoms" | "atomSeconds" | "startTime">, from: number, to: number): string {
  if (from === m.atoms) return `Not by ${formatDate(m, m.atoms - 1)}`;
  const n = to - from + 1;
  if (isDaily(m)) {
    const a = parts(m, atomStart(m, from)), b = parts(m, atomStart(m, to));
    const start = a.y === b.y ? `${a.d} ${MONTHS[a.mo]}` : `${a.d} ${MONTHS[a.mo]} ${a.y}`;
    const range = from === to ? `${b.d} ${MONTHS[b.mo]} ${b.y}` : `${start} – ${b.d} ${MONTHS[b.mo]} ${b.y}`;
    return `${range} · ${n} day${n === 1 ? "" : "s"}`;
  }
  const a = parts(m, atomStart(m, from)), b = parts(m, atomStart(m, to + 1));
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const day = (p: typeof a) => `${DAYS[p.dow]} ${p.d} ${MONTHS[p.mo]}`;
  const range = a.d === b.d || (b.h === 0 && to - from < 24) ? `${day(a)}, ${hh(a.h)}–${hh(b.h)}` : `${day(a)} ${hh(a.h)} – ${day(b)} ${hh(b.h)}`;
  return `${range} · ${n} hour${n === 1 ? "" : "s"}`;
}

/** Calendar date of an atom, "12 Oct 2029" (with the hour on hourly markets). */
export function formatDate(m: Pick<TimelineMarket, "atomSeconds" | "startTime">, atom: number): string {
  const p = parts(m, atomStart(m, atom));
  return isDaily(m) ? `${p.d} ${MONTHS[p.mo]} ${p.y}` : `${DAYS[p.dow]} ${p.d} ${MONTHS[p.mo]}, ${String(p.h).padStart(2, "0")}:00`;
}

/** Multiplier for a stake on [from, to], after the fee and price impact. */
export const multiplierFor = (m: TimelineMarket, from: number, to: number, stake = 20) =>
  quoteBuy(m, m.prices, from, to, stake * 1_000_000).multiplier;

/** Odds as a percentage with sensible precision. */
export function pct(p: number): string {
  const v = p * 100;
  return `${v.toFixed(v >= 1 ? 1 : v >= 0.1 ? 2 : 3)}%`;
}

export const vcr = (v: number) => v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export { FEE };
