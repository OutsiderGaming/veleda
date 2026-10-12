// Veleda reference model: one LMSR over a grid of atoms, in plain f64.
// This is the readable source of truth that the Rust fixed-point maths and the
// on-chain program are tested against. Clarity beats speed here: every
// operation is O(n) over the atoms.
//
// Spec: docs/02-hackathon-spec.md ("On-chain program", "Core maths", "Fees").
//
// Representation: each atom i has a weight w_i = p0_i · e^(q_i / b), where p0
// is the opening prior and q_i the net shares sold on atom i. Prices are
// w_i / Σw. A trade on a range multiplies the range's weights by e^(±x/b);
// its cost is b · ln(Σw_after / Σw_before), which for a range at price p is
// b · ln(1 − p + p · e^(x/b)). Pruning an atom sets its weight to 0. Weights
// are renormalised to sum to 1 after every change; prices and costs only
// depend on ratios, so this changes nothing but keeps the numbers in range.

export const FEE_RATE = 0.035;
export const LP_FEE_RATE = 0.025;
export const PLATFORM_FEE_RATE = 0.01;

export interface MarketParams {
  /** Depth: higher b means prices react less to trades. */
  b: number;
  /** Length of one atom in seconds (3600 hourly, 86400 daily). */
  atomSeconds: number;
  /** Unix time (seconds) at which atom 0 starts. */
  startTime: number;
  /** Number of timed atoms. Index `atoms` is the "not by end date" atom. */
  atoms: number;
  /** Locked zone: trades need range start ≥ now + lockSeconds. */
  lockSeconds: number;
  /** Live edge = now − lagSeconds; atoms that ended before it are pruned. */
  lagSeconds: number;
  /** Opening prices, length atoms + 1, summing to 1, all > 0. */
  prior: number[];
}

export interface Position {
  id: number;
  owner: string;
  /** First atom index, inclusive. */
  from: number;
  /** Last atom index, inclusive. */
  to: number;
  shares: number;
}

export interface BuyQuote {
  shares: number;
  /** Total the buyer pays, fee included. */
  stake: number;
  /** LMSR cost: the part of the stake that goes to the market. */
  cost: number;
  fee: number;
  /** Payout if it lands ÷ stake, after fees and price impact. */
  multiplier: number;
  priceBefore: number;
  priceAfter: number;
}

export interface SellQuote {
  /** LMSR proceeds before the fee. */
  gross: number;
  fee: number;
  /** What the seller receives. */
  net: number;
  priceBefore: number;
  priceAfter: number;
}

export type Status = "open" | "resolved";

export class TradeError extends Error {}

export class Market {
  readonly params: MarketParams;
  readonly endAtom: number;
  /** Worst-case loss b · ln(1 / lowest opening price), deposited at creation. */
  readonly subsidy: number;

  /** Market's tokens, excluding accrued fees. Starts at the subsidy. */
  balance: number;
  lpFees = 0;
  platformFees = 0;
  status: Status = "open";
  winner: number | null = null;
  /** Atoms with index below this are pruned. */
  liveEdge = 0;

  private weights: number[];
  /** Outstanding shares per atom: what the market owes if that atom wins. */
  private owed: number[];
  private positions = new Map<number, Position>();
  private nextId = 1;

  constructor(params: MarketParams) {
    const { b, atoms, prior } = params;
    if (!(b > 0)) throw new RangeError("b must be positive");
    if (!Number.isInteger(atoms) || atoms < 1) throw new RangeError("atoms must be a positive integer");
    if (prior.length !== atoms + 1) throw new RangeError("prior must have atoms + 1 entries");
    if (prior.some((p) => !(p > 0))) throw new RangeError("prior prices must all be positive");
    const total = sum(prior);
    if (Math.abs(total - 1) > 1e-9) throw new RangeError(`prior must sum to 1, got ${total}`);

    this.params = params;
    this.endAtom = atoms;
    this.weights = prior.map((p) => p / total);
    this.owed = new Array<number>(atoms + 1).fill(0);
    this.subsidy = b * Math.log(1 / Math.min(...prior));
    this.balance = this.subsidy;
  }

  // ---- Prices ----

  price(i: number): number {
    return this.weights[i] / sum(this.weights);
  }

  prices(): number[] {
    const total = sum(this.weights);
    return this.weights.map((w) => w / total);
  }

  rangePrice(from: number, to: number): number {
    this.checkRange(from, to);
    let s = 0;
    for (let i = from; i <= to; i++) s += this.weights[i];
    return s / sum(this.weights);
  }

  /** Unix time at which atom i starts. The end atom starts when the window ends. */
  atomStart(i: number): number {
    const { startTime, atomSeconds } = this.params;
    return startTime + i * atomSeconds;
  }

  // ---- Quotes ----

  /** LMSR cost of adding x shares to every atom in [from, to]. */
  costForShares(from: number, to: number, x: number): number {
    const p = this.rangePrice(from, to);
    // b · ln(1 − p + p · e^(x/b)), written with log1p/expm1 for precision.
    return this.params.b * Math.log1p(p * Math.expm1(x / this.params.b));
  }

  /** LMSR proceeds of removing x shares from every atom in [from, to], before the fee. */
  proceedsForShares(from: number, to: number, x: number): number {
    const p = this.rangePrice(from, to);
    return -this.params.b * Math.log1p(p * Math.expm1(-x / this.params.b));
  }

  /** Shares bought for a stake (fee included), as shown on the buy sheet. */
  quoteBuyByStake(from: number, to: number, stake: number): BuyQuote {
    const cost = stake * (1 - FEE_RATE);
    const p = this.rangePrice(from, to);
    // Inverse of costForShares: x = b · ln(1 + (e^(cost/b) − 1) / p).
    const shares = this.params.b * Math.log1p(Math.expm1(cost / this.params.b) / p);
    return this.buyQuote(shares, cost, p);
  }

  quoteBuyByShares(from: number, to: number, shares: number): BuyQuote {
    const p = this.rangePrice(from, to);
    return this.buyQuote(shares, this.costForShares(from, to, shares), p);
  }

  quoteSell(from: number, to: number, shares: number): SellQuote {
    const priceBefore = this.rangePrice(from, to);
    const gross = this.proceedsForShares(from, to, shares);
    const fee = gross * FEE_RATE;
    const k = Math.exp(-shares / this.params.b);
    const priceAfter = (priceBefore * k) / (1 - priceBefore + priceBefore * k);
    return { gross, fee, net: gross - fee, priceBefore, priceAfter };
  }

  private buyQuote(shares: number, cost: number, p: number): BuyQuote {
    const stake = cost / (1 - FEE_RATE);
    const k = Math.exp(shares / this.params.b);
    return {
      shares,
      stake,
      cost,
      fee: stake - cost,
      multiplier: shares / stake,
      priceBefore: p,
      priceAfter: (p * k) / (1 - p + p * k),
    };
  }

  // ---- Instructions ----

  /** buy_range: adds `shares` to every atom in [from, to]. `maxCost` caps the total paid, fee included. */
  buy(owner: string, from: number, to: number, shares: number, maxCost: number, now: number): { position: Position; quote: BuyQuote } {
    this.checkTradable(from, to, now);
    if (!(shares > 0)) throw new TradeError("shares must be positive");
    const quote = this.quoteBuyByShares(from, to, shares);
    if (quote.stake > maxCost) throw new TradeError(`cost ${quote.stake} exceeds max_cost ${maxCost}`);

    this.scaleRange(from, to, Math.exp(shares / this.params.b));
    for (let i = from; i <= to; i++) this.owed[i] += shares;
    this.balance += quote.cost;
    this.addFee(quote.fee);

    const position: Position = { id: this.nextId++, owner, from, to, shares };
    this.positions.set(position.id, position);
    return { position, quote };
  }

  /** sell_range: removes `shares` from a position's whole range. `minProceeds` is the net the seller accepts. */
  sell(positionId: number, shares: number, minProceeds: number, now: number): SellQuote {
    const position = this.getPosition(positionId);
    this.checkTradable(position.from, position.to, now);
    if (!(shares > 0) || shares > position.shares * (1 + 1e-12)) throw new TradeError("invalid share amount");
    const quote = this.quoteSell(position.from, position.to, shares);
    if (quote.net < minProceeds) throw new TradeError(`proceeds ${quote.net} below min_proceeds ${minProceeds}`);

    this.scaleRange(position.from, position.to, Math.exp(-shares / this.params.b));
    for (let i = position.from; i <= position.to; i++) this.owed[i] -= shares;
    this.balance -= quote.gross;
    this.addFee(quote.fee);

    position.shares -= shares;
    if (position.shares < 1e-9) this.positions.delete(positionId);
    return quote;
  }

  /** advance_time: prunes every timed atom that ended before now − lag. Returns the number pruned. */
  advanceTime(now: number): number {
    if (this.status !== "open") throw new TradeError("market is not open");
    const { startTime, atomSeconds, lagSeconds, atoms } = this.params;
    const edge = Math.max(0, Math.min(atoms, Math.floor((now - lagSeconds - startTime) / atomSeconds)));
    let pruned = 0;
    for (let i = this.liveEdge; i < edge; i++) {
      this.weights[i] = 0;
      this.owed[i] = 0;
      pruned++;
    }
    this.liveEdge = Math.max(this.liveEdge, edge);
    this.normalise();
    return pruned;
  }

  resolve(winner: number): void {
    if (this.status !== "open") throw new TradeError("market is not open");
    if (!Number.isInteger(winner) || winner < this.liveEdge || winner > this.endAtom) {
      throw new TradeError("winner must be an unpruned atom");
    }
    this.status = "resolved";
    this.winner = winner;
  }

  /** claim: pays 1 per share if the position's range contains the winner, and closes it. */
  claim(positionId: number): number {
    if (this.status !== "resolved" || this.winner === null) throw new TradeError("market is not resolved");
    const position = this.getPosition(positionId);
    const payout = position.from <= this.winner && this.winner <= position.to ? position.shares : 0;
    for (let i = Math.max(position.from, this.liveEdge); i <= position.to; i++) this.owed[i] -= position.shares;
    this.balance -= payout;
    this.positions.delete(positionId);
    return payout;
  }

  // ---- Invariant ----

  /** Largest payout any single atom could require. */
  maxLiability(): number {
    if (this.status === "resolved" && this.winner !== null) return this.owed[this.winner];
    let max = 0;
    for (let i = this.liveEdge; i <= this.endAtom; i++) max = Math.max(max, this.owed[i]);
    return max;
  }

  /** balance (vault − accrued fees) − max liability. Must never go negative. */
  slack(): number {
    return this.balance - this.maxLiability();
  }

  getPosition(id: number): Position {
    const position = this.positions.get(id);
    if (!position) throw new TradeError(`no position ${id}`);
    return position;
  }

  openPositions(): Position[] {
    return [...this.positions.values()];
  }

  // ---- Internals ----

  private checkRange(from: number, to: number): void {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > this.endAtom || from > to) {
      throw new TradeError(`invalid range [${from}, ${to}]`);
    }
  }

  private checkTradable(from: number, to: number, now: number): void {
    if (this.status !== "open") throw new TradeError("market is not open");
    this.checkRange(from, to);
    // range start ≥ now + lock. This also blocks atoms that have elapsed but
    // aren't pruned yet (between the live edge and now).
    if (this.atomStart(from) < now + this.params.lockSeconds) throw new TradeError("range starts inside the locked zone");
    if (from < this.liveEdge) throw new TradeError("range includes pruned atoms");
  }

  private scaleRange(from: number, to: number, factor: number): void {
    for (let i = from; i <= to; i++) this.weights[i] *= factor;
    this.normalise();
  }

  private normalise(): void {
    const total = sum(this.weights);
    for (let i = 0; i < this.weights.length; i++) this.weights[i] /= total;
  }

  private addFee(fee: number): void {
    this.lpFees += (fee * LP_FEE_RATE) / FEE_RATE;
    this.platformFees += (fee * PLATFORM_FEE_RATE) / FEE_RATE;
  }
}

/**
 * Opening prices: "not by end date" set explicitly, timed atoms shaped by
 * `shape` (flat by default), every atom at least `floor`.
 */
export function buildPrior(opts: { atoms: number; endPrice: number; floor?: number; shape?: (i: number) => number }): number[] {
  const { atoms, endPrice, floor = 0, shape = () => 1 } = opts;
  if (!(endPrice > 0 && endPrice < 1)) throw new RangeError("endPrice must be in (0, 1)");
  if (floor * atoms > 1 - endPrice) throw new RangeError("floor too high for this many atoms");

  const raw = Array.from({ length: atoms }, (_, i) => shape(i));
  const prices = new Array<number>(atoms).fill(0);
  const floored = new Array<boolean>(atoms).fill(false);
  // Distribute the timed mass by shape; pin anything that falls under the
  // floor to the floor and redistribute the rest, until nothing changes.
  for (;;) {
    const free = 1 - endPrice - floor * floored.filter(Boolean).length;
    const freeShape = raw.reduce((s, r, i) => (floored[i] ? s : s + r), 0);
    let changed = false;
    for (let i = 0; i < atoms; i++) {
      if (floored[i]) { prices[i] = floor; continue; }
      prices[i] = (free * raw[i]) / freeShape;
      if (prices[i] < floor) { floored[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  return [...prices, endPrice];
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
