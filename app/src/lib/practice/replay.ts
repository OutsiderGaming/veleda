// Replays practice mode's scripted market up to any moment with the
// reference model, so scrubbing backwards and forwards is exact. A full replay
// is a few dozen steps over 11 atoms, so it simply runs from the start each
// time.
import { Market, buildPrior } from "../../../../packages/reference/src/market";
import { SCENARIO as S, STEPS, type Step } from "./scenario";

export type Beat = Extract<Step, { kind: "beat" }>;
export const BEATS = STEPS.filter((s): s is Beat => s.kind === "beat");
/** Where the slider ends: a few hours after it happens. */
export const END_TIME = S.happensAt + 6 * 3_600;

export interface Window {
  from: number;
  to: number;
}

export interface Snapshot {
  t: number;
  beat: Beat;
  prices: number[];
  liveEdge: number;
  firstOpenAtom: number;
  resolved: boolean;
  winner: number | null;
  /** The user's pretend position, once bought. */
  position: {
    shares: number;
    paid: number;
    /** Cash-out value now (null while locked or after cashing out). */
    value: number | null;
    /** What the user got if they cashed out at the choice beat. */
    cashedOut: number | null;
    /** Payout at resolution, if held. */
    payout: number | null;
  } | null;
  windowPrice: number;
}

export function beatAt(t: number): Beat {
  return [...BEATS].reverse().find((b) => b.at <= t) ?? BEATS[0];
}

export const beatById = (id: string) => BEATS.find((b) => b.id === id)!;

/** The market at time `t`, with the user's window bought at the "buy" beat and sold at "choice" if they cashed out. */
export function replay(t: number, window: Window, cashOut: boolean): Snapshot {
  const total = S.shape.reduce((a, b) => a + b, 0);
  const prior = buildPrior({ atoms: S.atoms, endPrice: S.endPrice, shape: (i) => S.shape[i] / total });
  const m = new Market({ b: S.b, atomSeconds: S.atomSeconds, startTime: S.startTime, atoms: S.atoms, lockSeconds: S.lockSeconds, lagSeconds: S.lagSeconds, prior });
  let mine: number | null = null;
  let cashedOut: number | null = null;

  for (const step of STEPS) {
    if (step.at > t) break;
    if (step.at > 0) m.advanceTime(step.at);
    if (step.kind === "trade") {
      const q = m.quoteBuyByStake(step.from, step.to, step.stake);
      m.buy("crowd", step.from, step.to, q.shares, q.stake * 1.000001, step.at);
    } else if (step.id === "buy") {
      const q = m.quoteBuyByStake(window.from, window.to, S.stake);
      mine = m.buy("you", window.from, window.to, q.shares, q.stake * 1.000001, step.at).position.id;
    } else if (step.id === "choice" && cashOut && mine !== null) {
      try {
        const p = m.getPosition(mine);
        cashedOut = m.sell(mine, p.shares, 0, step.at).net;
        mine = null;
      } catch {
        // The chosen window is already locked: the user holds.
      }
    }
  }

  const happened = t >= S.happensAt;
  m.advanceTime(happened ? S.happensAt : Math.max(t, 0));
  const prices = m.prices();
  const p = mine !== null ? m.getPosition(mine) : null;
  let payout: number | null = null;
  if (happened) {
    m.resolve(S.winner);
    if (mine !== null) payout = m.claim(mine);
  }
  const now = Math.min(t, S.happensAt);
  const firstOpenAtom = Math.max(m.liveEdge, Math.ceil((now + S.lockSeconds - S.startTime) / S.atomSeconds));
  const locked = p ? m.atomStart(p.from) < now + S.lockSeconds : true;
  const bought = t >= beatById("buy").at;

  return {
    t,
    beat: beatAt(t),
    prices,
    liveEdge: m.liveEdge,
    firstOpenAtom,
    resolved: happened,
    winner: happened ? S.winner : null,
    position: bought
      ? {
          shares: p?.shares ?? 0,
          paid: S.stake,
          value: p && !locked && !happened ? m.quoteSell(p.from, p.to, p.shares).net : null,
          cashedOut,
          payout,
        }
      : null,
    windowPrice: prices.slice(window.from, window.to + 1).reduce((a, b) => a + b, 0),
  };
}

/** Shares a 20 VCR stake buys on `window` at the "buy" beat (for the pick and buy beats' figures). */
export function quoteAtBuy(window: Window): { shares: number; multiplier: number; price: number } {
  const before = replay(beatById("buy").at - 1, window, false);
  const b = S.b;
  const cost = S.stake * (1 - 0.035);
  const p = before.prices.slice(window.from, window.to + 1).reduce((a, x) => a + x, 0);
  const shares = b * Math.log1p(Math.expm1(cost / b) / p);
  return { shares, multiplier: shares / S.stake, price: p };
}
