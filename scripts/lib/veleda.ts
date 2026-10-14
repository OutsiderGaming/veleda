// Client helpers for the Veleda program: PDAs, account layout, market
// presets and instruction encoders. Mirrors programs/veleda/src (lib.rs,
// state.rs); the LiteSVM tests use the same presets.
import { createHash } from "node:crypto";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const BASE = 1_000_000n;
export const HOUR = 3_600;
export const DAY = 86_400;

// ---- Layout (state.rs) ----

/** 8-byte discriminator + 184-byte header. */
export const HEADER_LEN = 192;

/** Market account size for `atoms` timed atoms: header, tree sums, tree multipliers, owed shares. */
export function marketAccountLen(atoms: number): number {
  const n = atoms + 1;
  const cap = 2 ** Math.ceil(Math.log2(n));
  return HEADER_LEN + 3 * cap * 16 + n * 8;
}

export interface MarketHeader {
  admin: PublicKey; mint: PublicKey; vault: PublicKey;
  b: bigint; atomSeconds: number; startTime: number; lockSeconds: number; lagSeconds: number; clockOffset: number;
  balance: bigint; lpFees: bigint; platformFees: bigint;
  atoms: number; liveEdge: number; winner: number; resolved: boolean; demo: boolean;
}

export function decodeMarket(data: Buffer): MarketHeader {
  const h = data.subarray(8, HEADER_LEN);
  const key = (o: number) => new PublicKey(h.subarray(o, o + 32));
  const i64 = (o: number) => Number(h.readBigInt64LE(o));
  return {
    admin: key(0), mint: key(32), vault: key(64),
    b: h.readBigUInt64LE(96), atomSeconds: i64(104), startTime: i64(112), lockSeconds: i64(120), lagSeconds: i64(128), clockOffset: i64(136),
    balance: h.readBigUInt64LE(144), lpFees: h.readBigUInt64LE(152), platformFees: h.readBigUInt64LE(160),
    atoms: h.readUInt32LE(168), liveEdge: h.readUInt32LE(172), winner: h.readUInt32LE(176), resolved: h[180] !== 0, demo: h[181] !== 0,
  };
}

// ---- PDAs ----

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const vaultPda = (market: PublicKey) => pda(Buffer.from("vault"), market.toBuffer());
export const authorityPda = (market: PublicKey) => pda(Buffer.from("authority"), market.toBuffer());
export const positionPda = (market: PublicKey, owner: PublicKey, nonce: bigint) =>
  pda(Buffer.from("position"), market.toBuffer(), owner.toBuffer(), u64(nonce));

export function ata(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

/** Creates `owner`'s associated token account if it doesn't exist yet. */
export function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      w(payer, true), w(ata(owner, mint, tokenProgram)), r(owner), r(mint), r(SystemProgram.programId), r(tokenProgram),
    ],
    data: Buffer.from([1]),
  });
}

// ---- Presets ----

export interface MarketArgs {
  atoms: number; atomSeconds: number; b: bigint; lockSeconds: number; lagSeconds: number; demo: boolean;
  endPricePpm: number; floorPpm: number; shape: [atom: number, weight: number][];
  /** Demo markets only: start the market's clock (and atom 0) this many seconds ahead of chain time. */
  clockOffset?: number;
}

/**
 * Flagship: 3 years of days, "not by end date" 65%, 0.01% floor; nothing
 * above the floor for ~6 months, curving up to a peak at the end of year 2,
 * easing slightly through year 3.
 */
export const FLAGSHIP: MarketArgs = {
  atoms: 1096, atomSeconds: DAY, b: 1_000n * BASE, lockSeconds: 72 * HOUR, lagSeconds: 24 * HOUR, demo: false,
  endPricePpm: 650_000, floorPpm: 100,
  shape: [[182, 0], [300, 15], [420, 40], [550, 70], [650, 90], [730, 100], [1095, 85]],
};

/** Fast demo: a week of hours, flat, "not by end date" at the same price as each hour; clock can move forward. */
export const FAST: MarketArgs = {
  atoms: 168, atomSeconds: HOUR, b: 100n * BASE, lockSeconds: HOUR, lagSeconds: 10 * 60, demo: true,
  endPricePpm: Math.floor(1_000_000 / 169), floorPpm: 0, shape: [],
};

/** Upper bound on the subsidy create_market will take: b · ln(1 / lowest opening price), plus a margin. */
export function subsidyBound(a: MarketArgs): bigint {
  const rest = 1 - a.endPricePpm / 1e6 - (a.atoms * a.floorPpm) / 1e6;
  const lowestTimed = a.floorPpm > 0 ? a.floorPpm / 1e6 : rest / a.atoms; // flat if there's no floor
  const pMin = Math.min(a.endPricePpm / 1e6, lowestTimed);
  const tokens = (Number(a.b) / 1e6) * Math.log(1 / pMin);
  return BigInt(Math.ceil(tokens * 1.001 + 1)) * BASE;
}

// ---- Instructions ----

const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });
const ix = (name: string, keys: AccountMeta[], args: Buffer[] = []) =>
  new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), ...args]) });

export const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
export const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
export const i64 = (v: number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };

function encodeArgs(a: MarketArgs): Buffer {
  return Buffer.concat([
    u32(a.atoms), i64(a.atomSeconds), u64(a.b), i64(a.lockSeconds), i64(a.lagSeconds), Buffer.from([a.demo ? 1 : 0]),
    u32(a.endPricePpm), u32(a.floorPpm), u32(a.shape.length), ...a.shape.flatMap(([atom, weight]) => [u32(atom), u32(weight)]),
    i64(a.clockOffset ?? 0),
  ]);
}

export interface MarketAccounts { market: PublicKey; mint: PublicKey; tokenProgram?: PublicKey }

export function createMarket(p: MarketAccounts & { admin: PublicKey; feePayer: PublicKey; adminToken: PublicKey }, args: MarketArgs) {
  return ix("create_market", [
    r(p.admin, true), w(p.feePayer, true), w(p.market), r(p.mint), r(authorityPda(p.market)), w(vaultPda(p.market)),
    w(p.adminToken), r(p.tokenProgram ?? TOKEN_PROGRAM), r(SystemProgram.programId),
  ], [encodeArgs(args)]);
}

export function buyRange(p: MarketAccounts & { owner: PublicKey; feePayer: PublicKey; ownerToken: PublicKey },
  a: { nonce: bigint; from: number; to: number; shares: bigint; maxCost: bigint }) {
  return ix("buy_range", [
    r(p.owner, true), w(p.feePayer, true), w(p.market), w(positionPda(p.market, p.owner, a.nonce)), r(p.mint),
    w(vaultPda(p.market)), w(p.ownerToken), r(p.tokenProgram ?? TOKEN_PROGRAM), r(SystemProgram.programId),
  ], [u64(a.nonce), u32(a.from), u32(a.to), u64(a.shares), u64(a.maxCost)]);
}

type PositionAccounts = MarketAccounts & { owner: PublicKey; position: PublicKey; rentPayer: PublicKey; ownerToken: PublicKey };
const positionKeys = (p: PositionAccounts) => [
  r(p.owner, true), w(p.market), w(p.position), w(p.rentPayer), r(p.mint), w(vaultPda(p.market)),
  r(authorityPda(p.market)), w(p.ownerToken), r(p.tokenProgram ?? TOKEN_PROGRAM),
];

export const sellRange = (p: PositionAccounts, a: { shares: bigint; minProceeds: bigint }) =>
  ix("sell_range", positionKeys(p), [u64(a.shares), u64(a.minProceeds)]);
export const claim = (p: PositionAccounts) => ix("claim", positionKeys(p));
export const advanceTime = (market: PublicKey) => ix("advance_time", [w(market)]);
export const setClockOffset = (admin: PublicKey, market: PublicKey, offset: number) => ix("set_clock_offset", [r(admin, true), w(market)], [i64(offset)]);
export const resolve = (admin: PublicKey, market: PublicKey, winner: number) => ix("resolve", [r(admin, true), w(market)], [u32(winner)]);

/** SPL Token MintTo (instruction 7). */
export function mintTo(mint: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint, tokenProgram = TOKEN_PROGRAM) {
  return new TransactionInstruction({ programId: tokenProgram, keys: [w(mint), w(dest), r(authority, true)], data: Buffer.concat([Buffer.from([7]), u64(amount)]) });
}
