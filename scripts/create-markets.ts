// Creates the demo markets and records their addresses in markets.json.
//
//   node scripts/create-markets.ts flagship fast   # either or both
//
// One transaction per market: mint the subsidy to the admin, allocate the
// market account (too big to create inside the program), then create_market,
// which moves the exact subsidy into the vault. Admin pays for everything, so
// the user-facing fee payer keeps its SOL. The flagship account costs ~0.75
// SOL in rent, the fast one ~0.1. Re-running replaces that market's entry
// (the old market stays on chain).
//
// Admin: keys/admin.json. Mint authority: keys/mint-authority.json.
// SOLANA_RPC_URL picks the cluster; MARKETS_FILE overrides the output path.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { FAST, FLAGSHIP, PROGRAM_ID, ata, createAtaIdempotent, createMarket, decodeMarket, marketAccountLen, mintTo, subsidyBound, type MarketArgs } from "./lib/veleda.ts";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const OUT = process.env.MARKETS_FILE ?? "markets.json";
const PRESETS: Record<string, { args: MarketArgs; question: string }> = {
  flagship: { args: FLAGSHIP, question: "When will Taylor Swift's first child be born?" },
  fast: { args: FAST, question: "Fast demo market" },
};

const which = process.argv.slice(2);
if (which.length === 0 || which.some((w) => !(w in PRESETS))) {
  console.error("usage: node scripts/create-markets.ts flagship|fast [...]");
  process.exit(1);
}

const load = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
const admin = load("keys/admin.json");
const mintAuthority = load("keys/mint-authority.json");
const mint = load("keys/token-mint.json").publicKey;
const conn = new Connection(RPC, "confirmed");

const mintInfo = await conn.getAccountInfo(mint);
if (!mintInfo) throw new Error(`mint ${mint.toBase58()} not found on ${RPC}`);
const tokenProgram = mintInfo.owner; // SPL Token or Token-2022, whichever owns the mint
const adminToken = ata(admin.publicKey, mint, tokenProgram);

const record = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
record.programId = PROGRAM_ID.toBase58();
record.mint = mint.toBase58();
record.markets ??= {};

for (const name of which) {
  const { args, question } = PRESETS[name];
  const market = Keypair.generate();
  const space = marketAccountLen(args.atoms);
  const rent = await conn.getMinimumBalanceForRentExemption(space);
  const subsidy = subsidyBound(args);
  console.log(`${name}: ${args.atoms} atoms, ${space} bytes, rent ${(rent / 1e9).toFixed(3)} SOL, minting up to ${subsidy / 1_000_000n} VCR`);

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    createAtaIdempotent(admin.publicKey, admin.publicKey, mint, tokenProgram),
    mintTo(mint, adminToken, mintAuthority.publicKey, subsidy, tokenProgram),
    SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: market.publicKey, lamports: rent, space, programId: PROGRAM_ID }),
    createMarket({ admin: admin.publicKey, feePayer: admin.publicKey, market: market.publicKey, mint, adminToken, tokenProgram }, args),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [admin, mintAuthority, market]);

  const h = decodeMarket((await conn.getAccountInfo(market.publicKey))!.data);
  console.log(`  market ${market.publicKey.toBase58()}`);
  console.log(`  subsidy ${Number(h.balance) / 1e6} VCR, atom 0 starts ${new Date(h.startTime * 1000).toISOString()}`);
  console.log(`  tx ${sig}`);
  record.markets[name] = {
    address: market.publicKey.toBase58(),
    question,
    createdAt: new Date().toISOString(),
    startTime: h.startTime,
    ...Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])),
  };
  writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");
}
console.log(`wrote ${OUT}`);
