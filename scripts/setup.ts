// On-chain half of `npm run setup` (scripts/setup.sh runs it; safe to re-run, each step skips
// what's already done).
//
//   node scripts/setup.ts fund [--own]   # keys, then devnet SOL for admin, fee payer and bot payer
//   node scripts/setup.ts chain          # test-money mint, both markets, .env, one bot round
//
// Keys go in keys/ (gitignored). Only the admin is funded from the faucet; it passes SOL on to the
// fee payer and the bot payer, so a faucet limit means funding one address by hand.
// Markets are re-created when markets.json points at a different mint or program than this
// checkout uses (a fresh clone holds the maintainers' markets, which use their mint).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { PROGRAM_ID, TOKEN_PROGRAM } from "./lib/veleda.ts";

try {
  process.loadEnvFile(".env");
} catch {}
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const DEFAULT_MINT = "CjkpwuK5BU8sC4vhAgvnGLFg1QAf4xLNxiRKesMEfXaP";
const FAUCET = "https://faucet.solana.com";
const [step, ...flags] = process.argv.slice(2);
const own = flags.includes("--own");

const KEYS = ["admin", "fee-payer", "mint-authority", "token-mint", "bot-payer", ...(own ? ["veleda-program"] : [])];
const keyPath = (name: string) => `keys/${name}.json`;
const load = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath(name), "utf8"))));
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(2);
const run = (script: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${script} failed`);
};

// Whether markets.json already holds live markets on this checkout's mint and program.
async function marketsReady(mint: PublicKey) {
  const rec = existsSync("markets.json") ? JSON.parse(readFileSync("markets.json", "utf8")) : {};
  const addrs = Object.values(rec.markets ?? {}).map((m) => new PublicKey((m as { address: string }).address));
  if (rec.mint !== mint.toBase58() || rec.programId !== PROGRAM_ID.toBase58() || addrs.length < 2) return false;
  return (await conn.getMultipleAccountsInfo(addrs)).every((a) => a?.owner.equals(PROGRAM_ID));
}

// SOL the admin needs for what's still to do: ~0.85 for both markets' rent and fees, a little for
// the mint and its metadata, and with --own ~2.7 for the program plus as much again for the upload
// buffer (refunded). The fee payer and bot payer are topped up to 0.3 when they fall below 0.15.
async function adminNeeds() {
  const mint = load("token-mint").publicKey;
  let n = 0.05;
  if (!(await conn.getAccountInfo(mint))) n += 0.05;
  if (!(await marketsReady(mint))) n += 0.9;
  if (own && !(await conn.getAccountInfo(load("veleda-program").publicKey))) n += 5.8;
  return n;
}
const TOP_UP = { below: 0.15, to: 0.3 };

async function fund() {
  mkdirSync("keys", { recursive: true });
  for (const name of KEYS) {
    if (existsSync(keyPath(name))) continue;
    writeFileSync(keyPath(name), JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
    console.log(`  created ${keyPath(name)}`);
  }
  const admin = load("admin"), others = [load("fee-payer"), load("bot-payer")];
  const needs = (await adminNeeds()) * LAMPORTS_PER_SOL;
  const topUp = (bal: number) => (bal < TOP_UP.below * LAMPORTS_PER_SOL ? TOP_UP.to * LAMPORTS_PER_SOL - bal : 0);
  const shortfall = async () => {
    const [a, f, b] = await Promise.all([admin.publicKey, ...others.map((k) => k.publicKey)].map((k) => conn.getBalance(k)));
    const needF = topUp(f), needB = topUp(b);
    return { a, needF, needB, needA: Math.max(0, needs + needF + needB - a) };
  };
  let s = await shortfall();
  for (let tries = 0; s.needA > 0 && tries < 8; tries++) {
    try {
      const sig = await conn.requestAirdrop(admin.publicKey, Math.min(2 * LAMPORTS_PER_SOL, Math.ceil(s.needA / LAMPORTS_PER_SOL) * LAMPORTS_PER_SOL));
      const bh = await conn.getLatestBlockhash();
      await conn.confirmTransaction({ signature: sig, ...bh });
      console.log("  devnet airdrop to admin");
    } catch {
      break; // rate-limited: fall through to the manual instructions
    }
    s = await shortfall();
  }
  if (s.needA > 0) {
    console.error(`\nThe devnet faucet is rate-limiting. Send ${sol(s.needA)} SOL (devnet) to the admin key at ${FAUCET}:\n\n  ${admin.publicKey.toBase58()}\n\nthen run the setup again; it carries on from here.`);
    process.exit(2);
  }
  const transfers = [[others[0], s.needF], [others[1], s.needB]] as const;
  const ixs = transfers.filter(([, n]) => n > 0).map(([k, n]) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: k.publicKey, lamports: Math.ceil(n) }));
  if (ixs.length) await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [admin]);
  console.log(`  admin ${admin.publicKey.toBase58()} holds ${sol((await shortfall()).a)} SOL; fee payer and bot payer funded`);
}

function setEnv(mint: string) {
  const lines = existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : [];
  const has = (k: string) => lines.some((l) => l.startsWith(`${k}=`));
  const tokenLine = `TOKEN_MINT=${mint}`;
  const i = lines.findIndex((l) => l.startsWith("TOKEN_MINT="));
  if (mint !== DEFAULT_MINT) i >= 0 ? (lines[i] = tokenLine) : lines.push(tokenLine);
  for (const k of ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"]) if (!has(k)) lines.push(`${k}=`);
  writeFileSync(".env", lines.join("\n").replace(/\n*$/, "\n"));
  return ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"].filter((k) => lines.includes(`${k}=`));
}

async function chain() {
  const admin = load("admin"), mintAuthority = load("mint-authority"), mintKey = load("token-mint");
  const mint = mintKey.publicKey;

  // Test-money mint (6 decimals, classic SPL Token), named "Veleda Credit" (VCR).
  if (!(await conn.getAccountInfo(mint))) {
    const space = 82;
    const data = Buffer.concat([Buffer.from([20, 6]), mintAuthority.publicKey.toBuffer(), Buffer.from([0])]); // InitializeMint2, no freeze authority
    await sendAndConfirmTransaction(conn, new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint, lamports: await conn.getMinimumBalanceForRentExemption(space), space, programId: TOKEN_PROGRAM }),
      new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data }),
    ), [admin, mintKey]);
    console.log(`  created the test-money mint ${mint.toBase58()}`);
    run("scripts/set-token-metadata.ts");
  } else console.log(`  mint ${mint.toBase58()} already exists`);

  // Both markets, unless markets.json already holds live ones on this mint and program.
  if (await marketsReady(mint)) console.log("  markets.json already points at your markets");
  else run("scripts/create-markets.ts", "flagship", "fast");

  const empty = setEnv(mint.toBase58());
  console.log("  one round of trader bots, so the markets have some shape");
  run("scripts/bots.ts", "--rounds", "1", "--interval", "1");

  console.log("\nDone. Start the app with:\n\n  cd app && npm run dev        # http://localhost:3000\n");
  if (empty.length) console.log(`Before that, fill in ${empty.join(" and ")} in .env from a free Privy app (https://dashboard.privy.io),\nwith Solana embedded wallets and email or Google sign-in enabled, and http://localhost:3000 in its allowed origins.\n`);
}

if (step === "fund") await fund();
else if (step === "chain") await chain();
else {
  console.error("usage: node scripts/setup.ts fund [--own] | chain");
  process.exit(1);
}
