// Demo prep: the "early" bot stakes 70 VCR on the fast market's first two days (atoms up to 46), so when
// the clock jumps +2d and those hours drop away, window A shows a clear cash-out profit. Run once per new market.

import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { BASE, atomPrices, decodeMarket, firstOpenAtom, quoteBuy, rangePrice } from "../../app/src/lib/veleda/market.ts";
import { ata, buyRange } from "../lib/veleda.ts";
try { process.loadEnvFile(".env"); } catch {}
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const load = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const payer = load("keys/bot-payer.json"), bot = load("keys/bots/early.json");
const rec = JSON.parse(readFileSync("markets.json", "utf8"));
const market = new PublicKey(rec.markets.fast.address), mint = new PublicKey(rec.mint);
const data = (await conn.getAccountInfo(market))!.data;
const h = decodeMarket(data), prices = atomPrices(data);
const from = firstOpenAtom(h) + 1, to = 46, stake = 70 * BASE;
const q = quoteBuy(h, prices, from, to, stake);
console.log(`buying [${from}, ${to}] for 70 at ${(rangePrice(prices, from, to) * 100).toFixed(2)}%, ${q.shares / BASE} shares`);
const ix = buyRange({ market, mint, owner: bot.publicKey, ownerToken: ata(bot.publicKey, mint), feePayer: payer.publicKey }, { nonce: BigInt(Date.now()), from, to, shares: BigInt(q.shares), maxCost: BigInt(q.maxCost) });
console.log(await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer, bot]));
const d2 = (await conn.getAccountInfo(market))!.data;
const p2 = atomPrices(d2);
console.log("early now", (rangePrice(p2, from, to) * 100).toFixed(2) + "%", "A(59-64)", (rangePrice(p2, 59, 64) * 100).toFixed(2) + "%", "B(77-82)", (rangePrice(p2, 77, 82) * 100).toFixed(2) + "%");
