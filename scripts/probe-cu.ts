// Week 1 compute-unit probe: runs the program's temporary probe_* instructions
// on devnet against a 732-atom market and reports compute units per action.
//
//   node scripts/probe-cu.ts
//
// Uses keys/admin.json as payer. Leaves the probe market account behind (~0.4 devnet SOL).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx");
const ATOMS = 731;
const BASE = 1_000_000n;
const DAY = 86_400;

const conn = new Connection(RPC, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync("keys/admin.json", "utf8"))));
const market = Keypair.generate();

function accountLen(atoms: number): number {
  const n = atoms + 1;
  const cap = 2 ** Math.ceil(Math.log2(n));
  return 64 + 3 * cap * 16 + n * 8;
}

function ix(name: string, args: Buffer): TransactionInstruction {
  const disc = createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: market.publicKey, isSigner: false, isWritable: true }],
    data: Buffer.concat([disc, args]),
  });
}

const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };

const rows: { action: string; engine: number; total: number; note: string }[] = [];

async function run(action: string, instructions: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...instructions);
  const sig = await sendAndConfirmTransaction(conn, tx, [admin, ...signers], { commitment: "confirmed" });
  const got = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const logs = got?.meta?.logMessages ?? [];
  const remaining = logs.filter((l) => l.includes("Program consumption:")).map((l) => Number(l.match(/(\d+) units remaining/)?.[1]));
  const consumed = logs.map((l) => l.match(new RegExp(`Program ${PROGRAM_ID} consumed (\\d+) of`))).find(Boolean);
  const note = logs.filter((l) => l.startsWith("Program log: ") && !l.includes("Instruction:")).map((l) => l.slice(13)).join("; ");
  rows.push({ action, engine: remaining.length >= 2 ? remaining[0] - remaining[1] : NaN, total: consumed ? Number(consumed[1]) : NaN, note });
  console.log(`${action}: ${sig}`);
}

const space = accountLen(ATOMS);
const rent = await conn.getMinimumBalanceForRentExemption(space);
console.log(`market account: ${space} bytes, rent ${(rent / 1e9).toFixed(4)} SOL`);

await run("create market (732 atoms)", [
  SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: market.publicKey, lamports: rent, space, programId: PROGRAM_ID }),
  ix("probe_init", u32(ATOMS)),
], [market]);
await run("buy 1 day", [ix("probe_buy", Buffer.concat([u32(10), u32(10), u64(100n * BASE)]))]);
await run("buy 31 days", [ix("probe_buy", Buffer.concat([u32(40), u32(70), u64(500n * BASE)]))]);
await run("buy 696 days", [ix("probe_buy", Buffer.concat([u32(5), u32(700), u64(2000n * BASE)]))]);
await run("buy max size (29 × b)", [ix("probe_buy", Buffer.concat([u32(100), u32(100), u64(29_000n * BASE)]))]);
await run("sell half of 31 days", [ix("probe_sell", Buffer.concat([u32(40), u32(70), u64(250n * BASE)]))]);
const now = BigInt(Math.floor(Date.now() / 1000));
await run("prune ~102 days", [ix("probe_advance", i64(now + 103n * BigInt(DAY)))]);
await run("buy 31 days after pruning", [ix("probe_buy", Buffer.concat([u32(200), u32(230), u64(500n * BASE)]))]);

console.log("\n| Action | Engine CU | Instruction total CU |\n|---|---|---|");
for (const r of rows) console.log(`| ${r.action} | ${r.engine.toLocaleString()} | ${r.total.toLocaleString()} |`);
console.log("\nLogs:");
for (const r of rows) console.log(`- ${r.action}: ${r.note}`);
