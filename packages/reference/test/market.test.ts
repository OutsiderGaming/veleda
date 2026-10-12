import { test } from "node:test";
import assert from "node:assert/strict";
import { Market, TradeError, buildPrior } from "../src/index.ts";
import { close } from "./helpers.ts";

const HOUR = 3600;

/** Fast-demo market: hourly atoms over 7 days, b = 100, flat, 1h lock, 10 min lag. */
function fastMarket(): Market {
  return new Market({ b: 100, atomSeconds: HOUR, startTime: 0, atoms: 168, lockSeconds: HOUR, lagSeconds: 600, prior: buildPrior({ atoms: 168, endPrice: 1 / 169 }) });
}

test("buildPrior sums to 1, respects the floor and the end price", () => {
  const prior = buildPrior({ atoms: 731, endPrice: 0.4, floor: 0.0001, shape: (i) => (i < 60 ? 0.001 : 1) });
  close(prior.reduce((a, b) => a + b, 0), 1, 1e-12);
  assert.equal(prior[731], 0.4);
  assert.ok(prior.every((p) => p >= 0.0001 - 1e-15));
  close(Math.min(...prior), 0.0001, 1e-15);
});

test("cost matches b · ln(Σw_after / Σw_before) computed from the full price vector", () => {
  const m = fastMarket();
  const before = m.prices();
  const x = 37;
  const cost = m.costForShares(10, 30, x);
  let after = 0;
  before.forEach((p, i) => (after += i >= 10 && i <= 30 ? p * Math.exp(x / 100) : p));
  close(cost, 100 * Math.log(after), 1e-9);
});

test("quote by stake and by shares agree", () => {
  const m = fastMarket();
  const byStake = m.quoteBuyByStake(5, 40, 20);
  const byShares = m.quoteBuyByShares(5, 40, byStake.shares);
  close(byShares.stake, 20, 1e-9);
});

test("buying moves the price up and the quote's priceAfter matches the market", () => {
  const m = fastMarket();
  const { quote } = m.buy("alice", 10, 20, 50, Infinity, 0);
  close(m.rangePrice(10, 20), quote.priceAfter, 1e-12);
  assert.ok(quote.priceAfter > quote.priceBefore);
});

test("buy then immediate sell returns the LMSR cost (path independence); seller gets back less than the stake", () => {
  const m = fastMarket();
  const balance0 = m.balance;
  const { position, quote } = m.buy("alice", 10, 20, 50, Infinity, 0);
  const sell = m.sell(position.id, position.shares, 0, 0);
  close(sell.gross, quote.cost, 1e-9);
  close(m.balance, balance0, 1e-9);
  assert.ok(sell.net < quote.stake);
  close(m.lpFees + m.platformFees, quote.fee + sell.fee, 1e-12);
  close(m.lpFees / m.platformFees, 2.5, 1e-9);
});

test("max_cost and min_proceeds reject trades when the price has moved", () => {
  const m = fastMarket();
  const q = m.quoteBuyByShares(10, 20, 50);
  assert.throws(() => m.buy("alice", 10, 20, 50, q.stake * 0.99, 0), TradeError);
  const { position } = m.buy("alice", 10, 20, 50, q.stake, 0);
  const s = m.quoteSell(10, 20, 50);
  assert.throws(() => m.sell(position.id, 50, s.net * 1.01, 0), TradeError);
});

test("locked zone: no trades on ranges starting within lockSeconds of now", () => {
  const m = fastMarket();
  assert.throws(() => m.buy("alice", 0, 5, 10, Infinity, 0), /locked zone/);
  m.buy("alice", 1, 5, 10, Infinity, 0); // atom 1 starts exactly at now + 1h
});

test("elapsed but unpruned atoms can't be bought (the lag-window exploit)", () => {
  const m = fastMarket();
  const now = 2 * HOUR + 300; // atom 2 in progress; lag is 10 min
  m.advanceTime(now);
  assert.equal(m.liveEdge, 1); // atom 0 pruned, atom 1 ended but still inside the lag
  assert.ok(m.price(1) > 0);
  assert.throws(() => m.buy("eve", 1, 1, 10, Infinity, now), /locked zone/);
});

test("pruning renormalises survivors to p / (1 − p_dead) and adds headroom", () => {
  const m = fastMarket();
  m.buy("alice", 2, 2, 40, Infinity, 0);
  const before = m.prices();
  const slackBefore = m.slack();
  m.advanceTime(3 * HOUR + 600); // prunes atoms 0, 1, 2
  const dead = before[0] + before[1] + before[2];
  for (const i of [3, 50, 168]) close(m.price(i), before[i] / (1 - dead), 1e-12);
  assert.ok(m.slack() > slackBefore);
});

test("resolve and claim: winners paid 1 per share, losers 0", () => {
  const m = fastMarket();
  const a = m.buy("alice", 10, 20, 50, Infinity, 0).position;
  const b = m.buy("bob", 30, 40, 80, Infinity, 0).position;
  m.resolve(15);
  assert.equal(m.claim(a.id), 50);
  assert.equal(m.claim(b.id), 0);
  assert.ok(m.balance >= 0);
  assert.throws(() => m.buy("carol", 50, 60, 10, Infinity, 0), /not open/);
});
