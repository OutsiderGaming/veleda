// Reads Veleda accounts and quotes trades. No dependencies, so it runs on the
// server, in the browser and in the bot scripts. Mirrors
// programs/veleda/src/state.rs and crates/veleda-math (f64 here: quotes only;
// the program does the exact maths and enforces max_cost / min_proceeds).

export const BASE = 1_000_000;
/** Fee on buys and sells: 3.5% of the stake (buy) or of the proceeds (sell). */
export const FEE = 0.035;
/** Largest x/b one trade may use (the program rejects larger trades). */
const MAX_TRADE_EXPONENT = 30;
const HEADER_LEN = 192;
export const POSITION_LEN = 129;

export interface MarketHeader {
  admin: string; mint: string; vault: string;
  b: number; atomSeconds: number; startTime: number; lockSeconds: number; lagSeconds: number; clockOffset: number;
  balance: number; lpFees: number; platformFees: number;
  atoms: number; liveEdge: number; winner: number; resolved: boolean; demo: boolean;
}

export interface Position {
  market: string; owner: string; rentPayer: string; nonce: bigint; from: number; to: number; shares: number;
}

export function decodeMarket(data: Uint8Array): MarketHeader {
  const v = view(data);
  const at = (o: number) => 8 + o;
  const num = (o: number) => Number(v.getBigInt64(at(o), true));
  return {
    admin: base58(data.subarray(at(0), at(32))), mint: base58(data.subarray(at(32), at(64))), vault: base58(data.subarray(at(64), at(96))),
    b: num(96), atomSeconds: num(104), startTime: num(112), lockSeconds: num(120), lagSeconds: num(128), clockOffset: num(136),
    balance: num(144), lpFees: num(152), platformFees: num(160),
    atoms: v.getUint32(at(168), true), liveEdge: v.getUint32(at(172), true), winner: v.getUint32(at(176), true),
    resolved: data[at(180)] !== 0, demo: data[at(181)] !== 0,
  };
}

export function decodePosition(data: Uint8Array): Position {
  const v = view(data);
  return {
    market: base58(data.subarray(8, 40)), owner: base58(data.subarray(40, 72)), rentPayer: base58(data.subarray(72, 104)),
    nonce: v.getBigUint64(104, true), from: v.getUint32(112, true), to: v.getUint32(116, true), shares: Number(v.getBigUint64(120, true)),
  };
}

/**
 * Every atom's current price (index `atoms` is "not by end date"); pruned atoms are 0.
 * Leaf weights are the leaf sums times every pending multiplier above them.
 */
export function atomPrices(data: Uint8Array): number[] {
  const { atoms } = decodeMarket(data);
  const n = atoms + 1;
  const cap = 2 ** Math.ceil(Math.log2(n));
  const v = view(data);
  const float = (offset: number) => {
    // Packed float: Q64.64 mantissa in the low 65 bits, i32 exponent in bits 96..128.
    const lo = v.getBigUint64(offset, true);
    const hi = v.getBigUint64(offset + 8, true);
    const mantissa = Number(lo) / 2 ** 64 + Number(hi & 1n);
    const exponent = Number(BigInt.asIntN(32, hi >> 32n));
    return mantissa * 2 ** exponent;
  };
  const sumAt = (i: number) => float(HEADER_LEN + i * 16);
  const lazyAt = (i: number) => float(HEADER_LEN + 2 * cap * 16 + i * 16);

  // pending[i]: product of the multipliers waiting at i's ancestors.
  const pending = new Float64Array(2 * cap);
  pending[1] = 1;
  for (let i = 2; i < 2 * cap; i++) {
    const parent = i >> 1;
    pending[i] = pending[parent] * lazyAt(parent);
  }
  const weights = Array.from({ length: n }, (_, j) => sumAt(cap + j) * pending[cap + j]);
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => w / total);
}

export const rangePrice = (prices: number[], from: number, to: number) => prices.slice(from, to + 1).reduce((s, p) => s + p, 0);

/** The market's "now", in unix seconds. */
export const marketNow = (h: MarketHeader, nowMs = Date.now()) => Math.floor(nowMs / 1000) + h.clockOffset;

/** First atom that can still be traded (its start is at least now + lock). */
export function firstOpenAtom(h: MarketHeader, nowMs = Date.now()): number {
  return Math.max(h.liveEdge, Math.ceil((marketNow(h, nowMs) + h.lockSeconds - h.startTime) / h.atomSeconds));
}

export interface BuyQuote {
  /** Shares to request (base units); 1 share pays 1 VCR if the window wins. */
  shares: number;
  /** Most the buyer can pay: the stake they chose (base units). */
  maxCost: number;
  /** Price of the window now, 0..1. */
  price: number;
  /** Payout if it wins ÷ stake: after fees and price impact. */
  multiplier: number;
}

/**
 * Shares a stake buys in [from, to]. The LMSR gets stake × (1 − fee), and
 * cost(x) = b·ln(1 − p + p·e^(x/b)), so x = b·ln((e^(c/b) − 1 + p) / p).
 * Asks for slightly fewer shares than the exact answer (`margin`), so the
 * on-chain cost, which rounds up, stays within the stake.
 */
export function quoteBuy(h: Pick<MarketHeader, "b">, prices: number[], from: number, to: number, stake: number, margin = 0.002): BuyQuote {
  const p = rangePrice(prices, from, to);
  const b = h.b / BASE;
  const cost = (stake / BASE) * (1 - FEE);
  let x = b * Math.log((Math.expm1(cost / b) + p) / p);
  x = Math.min(x * (1 - margin), b * (MAX_TRADE_EXPONENT - 0.1));
  const shares = Math.floor(x * BASE);
  return { shares, maxCost: stake, price: p, multiplier: shares / stake };
}

/**
 * The window price at which buying `shares` costs exactly `cost` (LMSR part,
 * before the fee): p = (e^(c/b) − 1) / (e^(x/b) − 1). Used for "cancels if the
 * price passes X%" (cost = the stake less the fee) and for the entry odds of a
 * past buy (cost = what the LMSR actually took).
 */
export function priceForCost(h: Pick<MarketHeader, "b">, cost: number, shares: number): number {
  const b = h.b / BASE;
  return Math.expm1(cost / BASE / b) / Math.expm1(shares / BASE / b);
}

export interface SellQuote {
  /** Expected net proceeds (base units). */
  net: number;
  /** Least accepted: the expected net less `slippage`. */
  minProceeds: number;
}

/** Proceeds of selling `shares` from [from, to]: −b·ln(1 − p + p·e^(−x/b)), less the fee. */
export function quoteSell(h: Pick<MarketHeader, "b">, prices: number[], from: number, to: number, shares: number, slippage = 0.01): SellQuote {
  const p = rangePrice(prices, from, to);
  const b = h.b / BASE;
  const gross = -b * Math.log1p(-p * -Math.expm1(-(shares / BASE) / b));
  const net = Math.floor(gross * (1 - FEE) * BASE);
  return { net, minProceeds: Math.floor(net * (1 - slippage)) };
}

function view(data: Uint8Array) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
