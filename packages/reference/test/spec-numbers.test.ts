// The worked numbers in the specs, reproduced by the model.
import { test } from "node:test";
import { Market, buildPrior, FEE_RATE } from "../src/index.ts";
import { close } from "./helpers.ts";

const HOUR = 3600;
const DAY = 86400;

function market(b: number, prior: number[], atomSeconds = DAY): Market {
  return new Market({ b, atomSeconds, startTime: 0, atoms: prior.length - 1, lockSeconds: 0, lagSeconds: 0, prior });
}

test("buy sheet: 20 stake on a 6.1% window (hackathon spec, b = 1,000 and 300)", () => {
  const prior = [0.061, 0.5, 0.439];
  const q1000 = market(1000, prior).quoteBuyByStake(0, 0, 20);
  close(q1000.shares, 277, 1, "b=1000 shares");
  close(q1000.multiplier, 13.9, 0.05, "b=1000 multiplier");
  close(q1000.fee, 0.7, 1e-9, "fee is 3.5% of the stake");
  const q300 = market(300, prior).quoteBuyByStake(0, 0, 20);
  close(q300.shares, 221, 1, "b=300 shares");
  // With no price impact, 19.30 at 6.1% would buy ~316 shares (×15.8, the mockup figure).
  close((20 * (1 - FEE_RATE)) / 0.061 / 20, 15.8, 0.05, "mockup multiplier");
});

test("moving a 6.1% window to 10.5% costs about 48 at b = 1,000", () => {
  const m = market(1000, [0.061, 0.5, 0.439]);
  // Cost to move a range from p to p' is b · ln((1 − p) / (1 − p')).
  const k = (0.105 * (1 - 0.061)) / (0.061 * (1 - 0.105));
  const shares = 1000 * Math.log(k);
  const q = m.quoteBuyByShares(0, 0, shares);
  close(q.priceAfter, 0.105, 1e-9);
  close(q.cost, 48, 0.5);
});

test("design spec depth table: atom at 0.2%, b = 1,000", () => {
  const rows = [
    { to: 0.01, cost: 8, shares: 1617 },
    { to: 0.1, cost: 103, shares: 4015 },
    { to: 0.5, cost: 691, shares: 6213 },
  ];
  for (const row of rows) {
    const m = market(1000, [0.002, 0.998]);
    const shares = 1000 * Math.log((row.to * 0.998) / (0.002 * (1 - row.to)));
    const q = m.quoteBuyByShares(0, 0, shares);
    close(q.priceAfter, row.to, 1e-9);
    close(q.cost, row.cost, 0.5, `cost to ${row.to}`);
    close(shares, row.shares, 1, `shares to ${row.to}`);
  }
});

test("design spec cash-out example: 320 shares at 6.1% cost ~22.75; selling at 15% returns ~42 (~40.50 after fee)", () => {
  const buy = market(1000, [0.061, 0.5, 0.439]).quoteBuyByShares(0, 0, 320);
  close(buy.cost, 22.75, 0.01);
  const sell = market(1000, [0.15, 0.5, 0.35]).quoteSell(0, 0, 320);
  close(sell.gross, 42, 0.1); // 41.95
  close(sell.net, 40.5, 0.1); // 40.48
});

test("subsidies: flagship ~9,210 (b = 1,000, 0.01% floor), fast market ~513 (b = 100, flat over 169)", () => {
  const flagship = market(1000, buildPrior({ atoms: 731, endPrice: 0.4, floor: 0.0001, shape: (i) => (i < 60 ? 0.001 : 1) }));
  close(flagship.subsidy, 1000 * Math.log(10000), 1e-6);
  close(flagship.subsidy, 9210, 1);
  const fast = market(100, buildPrior({ atoms: 168, endPrice: 1 / 169 }), HOUR);
  close(fast.subsidy, 513, 0.5);
});
