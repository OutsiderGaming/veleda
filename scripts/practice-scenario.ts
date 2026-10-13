// Runs practice mode's scripted market through the reference model and
// prints the figures at each beat, for both choices (cash out at "choice", or
// hold to the end).
//
//   node scripts/practice-scenario.ts
import { Market, buildPrior } from "../packages/reference/src/market.ts";
import { SCENARIO as S, STEPS } from "../app/src/lib/practice/scenario.ts";

const sum = S.shape.reduce((a, b) => a + b, 0);
const prior = buildPrior({ atoms: S.atoms, endPrice: S.endPrice, shape: (i) => S.shape[i] / sum });
const m = new Market({ b: S.b, atomSeconds: S.atomSeconds, startTime: S.startTime, atoms: S.atoms, lockSeconds: S.lockSeconds, lagSeconds: S.lagSeconds, prior });
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const day = (t: number) => `day ${Math.floor(t / 86_400) + 1} ${String(Math.floor((t % 86_400) / 3_600)).padStart(2, "0")}:00`;
console.log(`Opening prices: ${m.prices().map(pct).join(" ")}`);

let mine: number | null = null;
let cashedOut: number | null = null;
for (const step of STEPS) {
  if (step.at > 0) m.advanceTime(step.at);
  if (step.kind === "trade") {
    const q = m.quoteBuyByStake(step.from, step.to, step.stake);
    m.buy("crowd", step.from, step.to, q.shares, q.stake * 1.000001, step.at);
    continue;
  }
  if (step.id === "buy") {
    // Buy at the "buy" beat, so the figures shown at "pick" are the pre-trade quote.
    const q = m.quoteBuyByStake(S.window.from, S.window.to, S.stake);
    console.log(`  quote: ${pct(q.priceBefore)} → ${q.shares.toFixed(1)} shares, ×${q.multiplier.toFixed(2)} after fees and price impact`);
    mine = m.buy("you", S.window.from, S.window.to, q.shares, q.stake * 1.000001, step.at).position.id;
  }
  const p = mine === null ? null : m.getPosition(mine);
  const price = m.rangePrice(S.window.from, S.window.to);
  const locked = m.atomStart(S.window.from) < step.at + S.lockSeconds;
  const value = p && !locked ? m.quoteSell(p.from, p.to, p.shares).net : null;
  if (step.id === "choice" && value !== null) cashedOut = value;
  console.log(
    `${step.id.padEnd(9)} ${day(step.at).padEnd(13)} window ${pct(price).padStart(6)}` +
      (p ? ` · ${p.shares.toFixed(1)} shares · ${value === null ? "locked" : `cash out ${value.toFixed(2)} VCR`}` : ""),
  );
}
m.advanceTime(S.happensAt);
m.resolve(S.winner);
const payout = m.claim(mine!);
console.log(`\nHold: wins ${payout.toFixed(2)} VCR on a 20 VCR stake (×${(payout / S.stake).toFixed(2)}).`);
console.log(`Cash out at "choice": ${cashedOut?.toFixed(2)} VCR (×${((cashedOut ?? 0) / S.stake).toFixed(2)}).`);
console.log(`Vault check: ${m.slack() >= -1e-9 ? "solvent" : "INSOLVENT"} (slack ${m.slack().toFixed(4)})`);
