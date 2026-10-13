// Server-side market access: the market list (repo-root markets.json, written
// by scripts/create-markets.ts) and live market and position state.
import "./env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { address, fetchEncodedAccount, getBase64Encoder, type Address, type Base58EncodedBytes } from "@solana/kit";
import { HttpError } from "./privy";
import { rpc } from "./solana";
import { POSITION_LEN, atomPrices, decodeMarket, decodePosition, type MarketHeader, type Position } from "../veleda/market";
import { PROGRAM_ID } from "../veleda/program";

const MARKETS_FILE = process.env.MARKETS_FILE ?? path.resolve(process.cwd(), "..", "markets.json");

interface MarketsFile { mint: string; markets: Record<string, { address: string; question: string; resolves?: string }> }
const marketsFile = (): MarketsFile => JSON.parse(readFileSync(/*turbopackIgnore: true*/ MARKETS_FILE, "utf8"));

/** The demo markets by name ("flagship", "fast"). */
export function marketList(): { name: string; address: Address; question: string; resolves: string }[] {
  return Object.entries(marketsFile().markets).map(([name, m]) => ({ name, address: address(m.address), question: m.question, resolves: m.resolves ?? "" }));
}

/** Accepts a market name or address, but only markets in markets.json. */
export function marketAddress(nameOrAddress: string): Address {
  const m = marketList().find((m) => m.name === nameOrAddress || m.address === nameOrAddress);
  if (!m) throw new HttpError(404, "Unknown market");
  return m.address;
}

export interface MarketState { address: Address; header: MarketHeader; prices: number[] }

export async function fetchMarket(market: Address): Promise<MarketState> {
  const account = await fetchEncodedAccount(rpc, market);
  if (!account.exists) throw new HttpError(404, "Market not found on chain");
  return { address: market, header: decodeMarket(account.data), prices: atomPrices(account.data) };
}

export async function fetchPosition(position: Address): Promise<Position> {
  const account = await fetchEncodedAccount(rpc, position);
  if (!account.exists || account.programAddress !== PROGRAM_ID) throw new HttpError(404, "Position not found");
  return decodePosition(account.data);
}

/** Every open position `owner` holds, across all markets. */
export async function positionsOf(owner: Address): Promise<(Position & { address: Address })[]> {
  const accounts = await rpc.getProgramAccounts(PROGRAM_ID, {
    encoding: "base64",
    filters: [{ dataSize: BigInt(POSITION_LEN) }, { memcmp: { offset: 40n, bytes: owner as string as Base58EncodedBytes, encoding: "base58" } }],
  }).send();
  const decoder = getBase64Encoder();
  return accounts.map(({ pubkey, account }) => ({ address: pubkey, ...decodePosition(decoder.encode(account.data[0]) as Uint8Array) }));
}
