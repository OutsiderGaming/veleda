// Trade history from the program's events, read out of transaction logs: what
// a position cost when it was bought (for "paid" and entry odds), and the
// user's settled positions (sold or claimed). Transactions never change, so
// every parsed transaction is cached for the life of the server process.
import "./env";
import { createHash } from "node:crypto";
import { getBase58Decoder, type Address, type Signature } from "@solana/kit";
import { rpc } from "./solana";

const disc = (name: string) => createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
const TRADE = disc("Trade");
const CLAIMED = disc("Claimed");
const b58 = getBase58Decoder();

export interface TradeEvent { kind: "trade"; market: string; owner: string; position: string; from: number; to: number; shares: number; isBuy: boolean; amount: number; fee: number; time: number; signature: string }
export interface ClaimedEvent { kind: "claimed"; market: string; owner: string; position: string; payout: number; time: number; signature: string }
export type VeledaEvent = TradeEvent | ClaimedEvent;

const txCache = new Map<string, VeledaEvent[]>();

/** Retries rate-limited RPC calls (the public devnet RPC answers bursts with 429). */
async function withRetry<T>(call: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await call();
    } catch (e) {
      const status = (e as { context?: { statusCode?: number } }).context?.statusCode;
      if (status !== 429 || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

function decode(data: Buffer, time: number, signature: string): VeledaEvent | null {
  const key = (o: number) => b58.decode(data.subarray(o, o + 32));
  const u64 = (o: number) => Number(data.readBigUInt64LE(o));
  if (data.length >= 137 && data.subarray(0, 8).equals(TRADE)) {
    return {
      kind: "trade", market: key(8), owner: key(40), position: key(72), from: data.readUInt32LE(104), to: data.readUInt32LE(108),
      shares: u64(112), isBuy: data[120] !== 0, amount: u64(121), fee: u64(129), time, signature,
    };
  }
  if (data.length >= 112 && data.subarray(0, 8).equals(CLAIMED)) {
    return { kind: "claimed", market: key(8), owner: key(40), position: key(72), payout: u64(104), time, signature };
  }
  return null;
}

/** The program events emitted by one transaction. */
async function eventsOf(signature: string): Promise<VeledaEvent[]> {
  const cached = txCache.get(signature);
  if (cached) return cached;
  const tx = await withRetry(() => rpc.getTransaction(signature as Signature, { maxSupportedTransactionVersion: 0, encoding: "json", commitment: "confirmed" }).send());
  if (!tx) return [];
  const time = Number(tx.blockTime ?? 0);
  const events = (tx.meta?.logMessages ?? [])
    .filter((l) => l.startsWith("Program data: "))
    .map((l) => decode(Buffer.from(l.slice("Program data: ".length), "base64"), time, signature))
    .filter((e): e is VeledaEvent => e !== null);
  if (!tx.meta?.err) txCache.set(signature, events);
  return tx.meta?.err ? [] : events;
}

const buyCache = new Map<string, TradeEvent | null>();

/** The buy that opened a position: its first transaction's Trade event. */
export async function buyOf(position: Address): Promise<TradeEvent | null> {
  if (buyCache.has(position)) return buyCache.get(position)!;
  const sigs = await withRetry(() => rpc.getSignaturesForAddress(position, { limit: 50, commitment: "confirmed" }).send());
  const ok = sigs.filter((s) => !s.err);
  if (ok.length === 0) return null;
  const first = ok[ok.length - 1];
  const buy = (await eventsOf(first.signature)).find((e): e is TradeEvent => e.kind === "trade" && e.isBuy && e.position === position) ?? null;
  if (buy) buyCache.set(position, buy);
  return buy;
}

/** Program events from the owner's recent transactions (newest first). */
export async function recentEvents(owner: Address, limit = 40): Promise<VeledaEvent[]> {
  const sigs = await withRetry(() => rpc.getSignaturesForAddress(owner, { limit, commitment: "confirmed" }).send());
  const out: VeledaEvent[] = [];
  for (const s of sigs) {
    if (s.err) continue;
    out.push(...(await eventsOf(s.signature)).filter((e) => e.owner === owner));
  }
  return out;
}
