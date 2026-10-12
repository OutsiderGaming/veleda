// Writes a random trading session through the reference model as a plain-text
// log, for the Rust engine to replay (crates/veleda-math/tests/cross_check.rs).
//
//   node scripts/gen-vectors.ts <fast|flagship> <ops> <seed> <out-file>
//
// Shares are whole base units (6 decimals). Lines:
//   market <b> <atomSeconds> <startTime> <atoms> <lockSeconds> <lagSeconds>
//   prior <p0> <p1> ...
//   buy <from> <to> <shares> <now> ok <cost> <stake> | reject
//   sell <from> <to> <shares> <now> ok <gross> <net> | reject
//   adv <now> <pruned>
//   price <from> <to> <p>
//   state <balance> <maxLiability>
//   resolve <winner>
//   claim <from> <to> <shares> <payout>
// Amounts are in tokens (f64); shares in base units.
import { writeFileSync } from "node:fs";
import { Market, TradeError, buildPrior, type MarketParams } from "../src/index.ts";

const BASE = 1_000_000;
const HOUR = 3600;
const DAY = 86400;

const [kind, opsArg, seedArg, out] = process.argv.slice(2);
if (!kind || !opsArg || !seedArg || !out) {
  console.error("usage: gen-vectors.ts <fast|flagship> <ops> <seed> <out-file>");
  process.exit(1);
}
const ops = Number(opsArg);
const rand = mulberry32(Number(seedArg));

const params: MarketParams =
  kind === "fast"
    ? { b: 100, atomSeconds: HOUR, startTime: 0, atoms: 168, lockSeconds: HOUR, lagSeconds: 600, prior: buildPrior({ atoms: 168, endPrice: 1 / 169 }) }
    : { b: 1000, atomSeconds: DAY, startTime: 0, atoms: 731, lockSeconds: 3 * DAY, lagSeconds: DAY, prior: buildPrior({ atoms: 731, endPrice: 0.4, floor: 0.0001, shape: (i) => (i < 60 ? 0.001 : 1 + Math.sin(i / 40)) }) };

const m = new Market(params);
const lines: string[] = [];
lines.push(`market ${params.b} ${params.atomSeconds} ${params.startTime} ${params.atoms} ${params.lockSeconds} ${params.lagSeconds}`);
lines.push(`prior ${params.prior.join(" ")}`);

interface Held { id: number; from: number; to: number; shares: number } // shares in base units
const held: Held[] = [];
let now = 0;
const maxWidth = kind === "fast" ? 30 : 120;
const maxStake = kind === "fast" ? 50 : 200;
const avgAdvance = (0.8 * params.atoms * params.atomSeconds) / (0.15 * ops);
const firstTradable = () => Math.max(m.liveEdge, Math.ceil((now + params.lockSeconds - params.startTime) / params.atomSeconds));

for (let step = 0; step < ops; step++) {
  const roll = rand();
  if (roll < 0.55) {
    // Mostly valid ranges; 5% anywhere, which may be locked or pruned.
    const lo = rand() < 0.05 ? 0 : Math.min(params.atoms, firstTradable());
    const from = lo + Math.floor(rand() * (params.atoms + 1 - lo));
    const to = Math.min(params.atoms, from + Math.floor(rand() * maxWidth));
    let shares = Math.floor(m.quoteBuyByStake(from, to, 1 + rand() * maxStake).shares * BASE);
    shares = Math.max(1, Math.min(shares, 29 * params.b * BASE));
    try {
      const { position, quote } = m.buy("u", from, to, shares / BASE, Infinity, now);
      held.push({ id: position.id, from, to, shares });
      lines.push(`buy ${from} ${to} ${shares} ${now} ok ${quote.cost} ${quote.stake}`);
    } catch (e) {
      if (!(e instanceof TradeError)) throw e;
      lines.push(`buy ${from} ${to} ${shares} ${now} reject`);
    }
  } else if (roll < 0.85) {
    const open = held.filter((h) => h.shares > 0);
    if (open.length === 0) continue;
    const h = open[Math.floor(rand() * open.length)];
    const shares = rand() < 0.5 ? h.shares : Math.max(1, Math.floor(h.shares * rand()));
    try {
      const q = m.sell(h.id, Math.min(shares / BASE, m.getPosition(h.id).shares), 0, now);
      h.shares -= shares;
      lines.push(`sell ${h.from} ${h.to} ${shares} ${now} ok ${q.gross} ${q.net}`);
    } catch (e) {
      if (!(e instanceof TradeError)) throw e;
      lines.push(`sell ${h.from} ${h.to} ${shares} ${now} reject`);
    }
  } else {
    // Pace time so the session covers ~80% of the window: advances are 15% of actions.
    now += Math.floor(rand() * 2 * avgAdvance);
    lines.push(`adv ${now} ${m.advanceTime(now)}`);
  }
  const lo = m.liveEdge + Math.floor(rand() * (params.atoms + 1 - m.liveEdge));
  const hi = Math.min(params.atoms, lo + Math.floor(rand() * maxWidth));
  lines.push(`price ${lo} ${hi} ${m.rangePrice(lo, hi)}`);
  lines.push(`state ${m.balance} ${m.maxLiability()}`);
}

const winner = m.liveEdge + Math.floor(rand() * (params.atoms + 1 - m.liveEdge));
m.resolve(winner);
lines.push(`resolve ${winner}`);
for (const h of held) {
  if (h.shares <= 0) continue;
  const payout = h.from <= winner && winner <= h.to ? h.shares : 0;
  m.claim(h.id);
  lines.push(`claim ${h.from} ${h.to} ${h.shares} ${payout}`);
}
lines.push(`state ${m.balance} ${m.maxLiability()}`);
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${out}: ${ops} ops, ${held.length} positions, winner ${winner}`);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
