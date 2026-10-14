// Runs a demo market by hand: move its clock, prune passed hours, resolve it.
//
//   node scripts/admin.ts fast status
//   node scripts/admin.ts fast clock +3h        # move the market's clock forward (+90m, +1d, …), then prune
//   node scripts/admin.ts fast advance          # prune passed atoms (anyone can; the bots do it every 30 min)
//   node scripts/admin.ts fast resolve 2028-06-14T15:00Z   # the atom containing that moment wins
//   node scripts/admin.ts fast resolve 62       # or by atom index; "end" for "not by end date"
//
// The clock only moves forward and only on demo markets (set_clock_offset). Resolving is final:
// re-create the market (scripts/create-markets.ts fast) for another take, then update MARKETS_JSON on Vercel.
// Admin: keys/admin.json. SOLANA_RPC_URL picks the cluster.
import { existsSync, readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { advanceTime, decodeMarket, resolve, setClockOffset, type MarketHeader } from "./lib/veleda.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const [name, cmd, arg] = process.argv.slice(2);
const usage = () => {
  console.error("usage: node scripts/admin.ts <market> status | clock +<n>(m|h|d) | advance | resolve <atom|ISO time|end>");
  process.exit(1);
};
if (!name || !cmd) usage();

const entry = JSON.parse(readFileSync("markets.json", "utf8")).markets[name];
if (!entry) throw new Error(`no market "${name}" in markets.json`);
const market = new PublicKey(entry.address);
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync("keys/admin.json", "utf8"))));
const conn = new Connection(RPC, "confirmed");

const header = async () => decodeMarket((await conn.getAccountInfo(market))!.data);
const chainNow = async () => (await conn.getBlockTime(await conn.getSlot()))!;
const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");
const atomStart = (h: MarketHeader, i: number) => h.startTime + i * h.atomSeconds;
const send = (...ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [admin]);

async function status() {
  const h = await header();
  const now = (await chainNow()) + h.clockOffset;
  console.log(`${name}: ${entry.question}`);
  console.log(`  market clock ${iso(now)} (offset ${h.clockOffset}s)`);
  console.log(`  atoms 0–${h.atoms - 1}: ${iso(atomStart(h, 0))} → ${iso(atomStart(h, h.atoms))}; atom ${h.atoms} = "not by end date"`);
  console.log(`  live edge ${h.liveEdge} (atoms before it are pruned); trading opens at ${iso(now + h.lockSeconds)}`);
  console.log(h.resolved ? `  RESOLVED: atom ${h.winner}${h.winner < h.atoms ? ` (${iso(atomStart(h, h.winner))})` : ' ("not by end date")'}` : "  open");
}

switch (cmd) {
  case "status":
    break;
  case "clock": {
    const m = /^\+(\d+)(m|h|d)$/.exec(arg ?? "");
    if (!m) usage();
    const seconds = Number(m![1]) * { m: 60, h: 3_600, d: 86_400 }[m![2] as "m" | "h" | "d"];
    const h = await header();
    console.log(`clock +${arg!.slice(1)}: tx ${await send(setClockOffset(admin.publicKey, market, h.clockOffset + seconds), advanceTime(market))}`);
    break;
  }
  case "advance":
    console.log(`advance_time: tx ${await send(advanceTime(market))}`);
    break;
  case "resolve": {
    if (!arg) usage();
    const h = await header();
    const winner = arg === "end" ? h.atoms : /^\d+$/.test(arg) ? Number(arg) : Math.floor((Date.parse(arg) / 1000 - h.startTime) / h.atomSeconds);
    if (!(winner >= 0 && winner <= h.atoms)) throw new Error(`"${arg}" is outside the market (atoms 0–${h.atoms})`);
    console.log(`resolve to atom ${winner}${winner < h.atoms ? ` (${iso(atomStart(h, winner))})` : ' ("not by end date")'}: tx ${await send(resolve(admin.publicKey, market, winner))}`);
    break;
  }
  default:
    usage();
}
await status();
