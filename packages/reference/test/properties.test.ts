// Random trade sequences: after every step, prices sum to 1 and the market
// can pay the largest single-atom payout. At the end, every claim is covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Market, TradeError, buildPrior } from "../src/index.ts";
import { rng, close } from "./helpers.ts";

const HOUR = 3600;
const SEEDS = 20;
const STEPS = 500;

function randomRun(seed: number, flagshipLike: boolean): void {
  const r = rng(seed);
  const atoms = flagshipLike ? 120 : 168;
  const m = new Market({
    b: flagshipLike ? 1000 : 100,
    atomSeconds: HOUR,
    startTime: 0,
    atoms,
    lockSeconds: HOUR,
    lagSeconds: 600,
    prior: flagshipLike
      ? buildPrior({ atoms, endPrice: 0.4, floor: 0.0001, shape: (i) => 1 + Math.sin(i / 7) })
      : buildPrior({ atoms, endPrice: 1 / (atoms + 1) }),
  });
  let now = 0;

  for (let step = 0; step < STEPS; step++) {
    const roll = r();
    try {
      if (roll < 0.55) {
        const first = m.liveEdge + Math.floor(r() * (atoms + 1 - m.liveEdge));
        const from = Math.min(atoms, first);
        const to = Math.min(atoms, from + Math.floor(r() * 30));
        const stake = 1 + r() * (flagshipLike ? 200 : 50);
        const q = m.quoteBuyByStake(from, to, stake);
        m.buy(`u${Math.floor(r() * 5)}`, from, to, q.shares, q.stake * 1.02, now);
      } else if (roll < 0.85) {
        const open = m.openPositions();
        if (open.length) {
          const p = open[Math.floor(r() * open.length)];
          m.sell(p.id, r() < 0.5 ? p.shares : p.shares * r(), 0, now);
        }
      } else {
        now += Math.floor(r() * 3 * HOUR);
        m.advanceTime(now);
      }
    } catch (e) {
      if (!(e instanceof TradeError)) throw e; // rejected trades (locked, pruned) are fine
    }
    close(m.prices().reduce((a, b) => a + b, 0), 1, 1e-9, `seed ${seed} step ${step}: prices sum`);
    assert.ok(m.slack() >= -1e-6, `seed ${seed} step ${step}: balance ${m.balance} < liability ${m.maxLiability()}`);
  }

  const alive = m.liveEdge + Math.floor(r() * (atoms + 1 - m.liveEdge));
  m.resolve(alive);
  for (const p of m.openPositions()) m.claim(p.id);
  assert.ok(m.balance >= -1e-6, `seed ${seed}: vault short after claims by ${-m.balance}`);
}

test("fast-market-like random runs keep the vault invariant", () => {
  for (let seed = 1; seed <= SEEDS; seed++) randomRun(seed, false);
});

test("flagship-like random runs (shaped prior, floor, b = 1,000) keep the vault invariant", () => {
  for (let seed = 101; seed <= 100 + SEEDS; seed++) randomRun(seed, true);
});

test("worst case: everyone piles onto one atom and it wins; the subsidy covers the loss", () => {
  const m = new Market({ b: 100, atomSeconds: HOUR, startTime: 0, atoms: 168, lockSeconds: 0, lagSeconds: 0, prior: buildPrior({ atoms: 168, endPrice: 1 / 169 }) });
  const p = m.buy("whale", 50, 50, 5000, Infinity, 0).position;
  assert.ok(m.price(50) > 0.999);
  m.resolve(50);
  m.claim(p.id);
  // At the limit the market loses exactly its subsidy: the LMSR bound is tight.
  // In f64 that lands within rounding of 0; on-chain, rounding costs up keeps it ≥ 0.
  close(m.balance, 0, 1e-9);
});
