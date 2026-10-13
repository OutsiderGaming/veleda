// Trader bots: a few wallets with their own views of each market trade both
// demo markets on a schedule, so the price band has shape and history.
//
//   node scripts/bots.ts                  # run until stopped, a round every 2 minutes
//   node scripts/bots.ts --rounds 3 --interval 20
//
// Each bot believes the event lands around a peak with some spread, plus a
// chance of "not by end date". Each round it either buys a window it thinks
// is underpriced (5-40 VCR) or sells a position that now looks expensive,
// holding at most a few positions per market. Every round also calls
// advance_time on both markets.
//
// Reads SOLANA_RPC_URL from the repo's .env if it's there. Keys: bot wallets
// in keys/bots/ (created on first run) and a dedicated payer, keys/bot-payer.json,
// which pays the bots' fees and position rent so neither the admin nor the
// user-facing fee payer is needed. Without keys/ (GitHub Actions), they come
// from BOT_PAYER_KEY and BOT_KEYS (see .github/workflows/bots.yml). The mint
// authority (keys/mint-authority.json) tops bots up with VCR when it's
// available, i.e. locally; the cloud job never has it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { BASE, atomPrices, decodeMarket, decodePosition, firstOpenAtom, quoteBuy, quoteSell, rangePrice, POSITION_LEN, type MarketHeader } from "../app/src/lib/veleda/market.ts";
import { PROGRAM_ID, advanceTime, ata, buyRange, createAtaIdempotent, mintTo, sellRange } from "./lib/veleda.ts";

try {
  process.loadEnvFile(".env"); // SOLANA_RPC_URL, if set: the public devnet RPC rate-limits a long run
} catch {}
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback; };
const ROUNDS = flag("rounds", Infinity);
const INTERVAL_S = flag("interval", 120);
const MAX_OPEN = 4; // positions per bot per market
// Buy when the bot thinks a window is worth 1.15x its price; sell when the
// price reaches 1.4x what the bot thinks. The gap stops a bot flipping a
// window straight back because its own buy moved the price.
const BUY_BELOW = 1.15, SELL_ABOVE = 1.4;
const TOP_UP_BELOW = 200, TOP_UP = 2_000; // VCR

/** A view of one market: the event lands around `peak` (fraction of the window) with `spread`, or not by the end date with `never`. */
interface View { peak: number; spread: number; never: number }
interface Bot { name: string; views: Record<string, View>; key: Keypair; token: PublicKey }

const BOTS: { name: string; views: Record<string, View> }[] = [
  { name: "early", views: { flagship: { peak: 0.35, spread: 0.12, never: 0.45 }, fast: { peak: 0.25, spread: 0.08, never: 0.03 } } },
  { name: "middle", views: { flagship: { peak: 0.65, spread: 0.18, never: 0.6 }, fast: { peak: 0.45, spread: 0.12, never: 0.05 } } },
  { name: "late", views: { flagship: { peak: 0.85, spread: 0.12, never: 0.7 }, fast: { peak: 0.7, spread: 0.1, never: 0.08 } } },
  { name: "sceptic", views: { flagship: { peak: 0.75, spread: 0.3, never: 0.85 }, fast: { peak: 0.55, spread: 0.3, never: 0.2 } } },
  { name: "drifter", views: { flagship: { peak: 0.6, spread: 0.08, never: 0.55 }, fast: { peak: 0.35, spread: 0.05, never: 0.05 } } },
];
const WIDTHS: Record<string, number[]> = { flagship: [7, 14, 30, 61], fast: [2, 3, 6, 12] };

const fromJson = (json: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
const load = (path: string) => fromJson(readFileSync(path, "utf8"));
/** A key from keys/, or from an environment variable holding the same JSON (GitHub Actions secrets). */
const keyFrom = (path: string, envVar: string) => (existsSync(path) ? load(path) : fromJson(process.env[envVar] ?? ""));
const payer = keyFrom("keys/bot-payer.json", "BOT_PAYER_KEY");
const mintAuthority = existsSync("keys/mint-authority.json") ? load("keys/mint-authority.json") : null;
/** BOT_KEYS: {"early": [...], ...}, used when keys/bots/ isn't there. */
const botKeysEnv: Record<string, number[]> = process.env.BOT_KEYS ? JSON.parse(process.env.BOT_KEYS) : {};
const record = JSON.parse(readFileSync("markets.json", "utf8"));
const mint = new PublicKey(record.mint);
const markets = Object.entries(record.markets as Record<string, { address: string }>).map(([name, m]) => ({ name, address: new PublicKey(m.address) }));
const conn = new Connection(RPC, "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const vcr = (base: number) => (base / BASE).toFixed(2);

function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...signers]);
}

function botKey(name: string): Keypair {
  const path = `keys/bots/${name}.json`;
  if (!existsSync(path) && botKeysEnv[name]) return Keypair.fromSecretKey(Uint8Array.from(botKeysEnv[name]));
  if (!existsSync(path)) {
    mkdirSync("keys/bots", { recursive: true });
    writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey]));
  }
  return load(path);
}

async function balance(token: PublicKey): Promise<number> {
  const info = await conn.getTokenAccountBalance(token).catch(() => null);
  return info ? Number(info.value.amount) : 0;
}

async function topUp(bot: Bot) {
  if ((await balance(bot.token)) >= TOP_UP_BELOW * BASE) return;
  if (!mintAuthority) return console.log(`  ${bot.name}: low on VCR; top it up locally (needs the mint authority)`);
  await send([createAtaIdempotent(payer.publicKey, bot.key.publicKey, mint), mintTo(mint, bot.token, mintAuthority.publicKey, BigInt(TOP_UP) * 1_000_000n)], [mintAuthority]);
  console.log(`  ${bot.name}: topped up with ${TOP_UP} VCR`);
}

/** The bot's probability for each atom: a bell curve over the open timed atoms, plus "not by end date". */
function beliefs(h: MarketHeader, view: View): number[] {
  const first = firstOpenAtom(h);
  const w = Array.from({ length: h.atoms }, (_, i) => (i < first ? 0 : Math.exp(-0.5 * ((i / h.atoms - view.peak) / view.spread) ** 2)));
  const total = w.reduce((s, x) => s + x, 0) || 1;
  return [...w.map((x) => ((1 - view.never) * x) / total), view.never];
}

/** Samples an atom from the bot's beliefs. */
function sample(belief: number[]): number {
  let r = Math.random();
  for (let i = 0; i < belief.length; i++) if ((r -= belief[i]) <= 0) return i;
  return belief.length - 1;
}

async function positionsOf(owner: PublicKey, market: PublicKey) {
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: POSITION_LEN }, { memcmp: { offset: 40, bytes: owner.toBase58() } }, { memcmp: { offset: 8, bytes: market.toBase58() } }],
  });
  return accounts.map((a) => ({ address: a.pubkey, ...decodePosition(a.account.data) }));
}

async function act(bot: Bot, market: { name: string; address: PublicKey }) {
  const data = (await conn.getAccountInfo(market.address))!.data;
  const h = decodeMarket(data);
  if (h.resolved) return;
  const prices = atomPrices(data);
  const belief = beliefs(h, bot.views[market.name]);
  const first = firstOpenAtom(h);
  const accounts = { market: market.address, mint, owner: bot.key.publicKey, ownerToken: bot.token };
  const sellable = (await positionsOf(bot.key.publicKey, market.address)).filter((p) => p.from >= first);

  // Sell the position that looks most overpriced to this bot, if any does (or if it holds too many).
  const ranked = sellable
    .map((p) => ({ p, ratio: rangePrice(prices, p.from, p.to) / Math.max(rangePrice(belief, p.from, p.to), 1e-9) }))
    .sort((a, b) => b.ratio - a.ratio);
  if (ranked.length > 0 && (ranked[0].ratio > SELL_ABOVE || sellable.length >= MAX_OPEN)) {
    const { p } = ranked[0];
    const q = quoteSell(h, prices, p.from, p.to, p.shares);
    await send([sellRange({ ...accounts, position: p.address, rentPayer: new PublicKey(p.rentPayer) }, { shares: BigInt(p.shares), minProceeds: BigInt(q.minProceeds) })], [bot.key]);
    console.log(`  ${bot.name}: sold ${market.name} [${p.from}, ${p.to}] for ${vcr(q.net)} VCR`);
    return;
  }

  // Otherwise buy a window around something it believes in, if the market prices it well below its view.
  const centre = sample(belief);
  const [from, to] = centre === h.atoms
    ? [h.atoms, h.atoms]
    : (() => {
      const width = WIDTHS[market.name][Math.floor(Math.random() * WIDTHS[market.name].length)];
      const from = Math.max(first, centre - Math.floor(width / 2));
      return [from, Math.min(h.atoms - 1, from + width - 1)];
    })();
  const edge = rangePrice(belief, from, to) / rangePrice(prices, from, to);
  if (!(edge > BUY_BELOW)) return;
  const stake = Math.round((5 + Math.min(35, 10 * (edge - 1)) * Math.random()) * BASE);
  const q = quoteBuy(h, prices, from, to, stake);
  const nonce = BigInt(Date.now());
  await send([buyRange({ ...accounts, feePayer: payer.publicKey }, { nonce, from, to, shares: BigInt(q.shares), maxCost: BigInt(q.maxCost) })], [bot.key]);
  console.log(`  ${bot.name}: bought ${market.name} [${from}, ${to}] for ${vcr(stake)} VCR at ${(q.price * 100).toFixed(2)}% (thinks ${(rangePrice(belief, from, to) * 100).toFixed(2)}%)`);
}

const bots: Bot[] = BOTS.map((b) => {
  const key = botKey(b.name);
  return { ...b, key, token: ata(key.publicKey, mint) };
});
console.log(`${bots.length} bots on ${markets.map((m) => m.name).join(", ")}; RPC ${new URL(RPC).host}`);

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`round ${round} · ${new Date().toISOString()}`);
  try {
    await send(markets.map((m) => advanceTime(m.address)));
  } catch (e) {
    console.log(`  advance_time failed: ${(e as Error).message.split("\n")[0]}`);
  }
  for (const bot of bots) {
    try {
      await topUp(bot);
      // Each bot acts on one market per round, the fast one a bit more often.
      const market = Math.random() < 0.45 ? markets.find((m) => m.name === "flagship")! : markets.find((m) => m.name === "fast")!;
      await act(bot, market);
    } catch (e) {
      console.log(`  ${bot.name}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (round < ROUNDS) await sleep(INTERVAL_S * 1000 * (0.75 + Math.random() * 0.5));
}
