# Veleda — onboarding for Claude Code

Veleda ("VEL-eh-dah", tagline "the market of seers") is a "when will it happen" prediction market on Solana. Users buy any contiguous window of future time — an hour, a day, a month, a year — as a single trade against an on-chain LMSR market maker, and can cash out at the live price at any time. It's a four-week prototype for the **Colosseum hackathon, "Best Consumer App on Solana" track** (October 2026), deployed on devnet.

**Status: week 2 in progress (13 Oct 2026); `create_market`, `buy_range` and `sell_range` done.** Reference model, Rust maths and engine (cross-checked on 26,000 trades), devnet program probe with compute measurements, VCR mint, and the Privy onboarding proof are all in. Next: `advance_time`, `resolve`, `claim`, `set_clock_offset`; work from `docs/06-build-plan.md`.

## Read in this order

1. `docs/04-track-brief.md` — the hackathon track: judging criteria and submission requirements. Everything is judged against this.
2. `docs/01-project-brief.md` — one-page summary of every decision made so far, plus open questions. **Newest; wins on conflicts.**
3. `docs/02-hackathon-spec.md` — **what to build**: scope (in/out), demo markets and parameters, accounts, instructions, maths, fees, frontend screens, share link, onboarding, week plan, demo script, risks, submission checklist. This is the build spec.
4. `docs/03-design-spec.md` — **why**: full rationale for pricing, prior, pruning, trading, fees/LPs, listing policy, resolution, UX. Use it for reasoning; don't build its roadmap items.
5. `design/README.md` + `design/screens/*.png` — the four mockups, colour/type tokens and screen notes.
6. `docs/05-submission-copy.md` — draft submission text and the "How Solana powers Veleda" explanation.
7. `docs/06-build-plan.md` — **current work**: repo layout, build decisions and the itemised week 1 checklist.

## Source-of-truth rules

- **Lean:** this is a proof of concept. Build the smallest thing that makes the demo work; spec ideas fully, but put anything the demo doesn't need on the roadmap.

- **Scope:** only items in the hackathon spec's "In (build it)" column get built. Anything in "Out (slide only)" or the design spec's roadmap stays a slide until week 4 is done.
- **Conflicts:** project brief > hackathon spec > design spec. Mockups are authoritative for UI layout and copy.
- **Units:** the design spec's worked examples use £; the prototype uses a 6-decimal devnet test token. Treat £1 as 1 token unit.
- **Currency: Veleda Credit (VCR).** Our own 6-decimal devnet mint, `CjkpwuK5BU8sC4vhAgvnGLFg1QAf4xLNxiRKesMEfXaP`, with on-chain name and symbol (Metaplex metadata, `scripts/set-token-metadata.ts`). The platform holds the mint authority and mints market subsidies, sign-up airdrops and bot balances. Keep the mint configurable per market; don't hard-code a name. It is not USDC, and "USDXII" is a retired name from the old Twelvescore brand. The mockups show "USDC" only as a placeholder.

## Core model (short version)

- A market is a grid of mutually exclusive **atoms** (hourly or daily slots) plus a **"not by end date"** atom. Exactly one wins; each share pays 1 unit.
- A **window** (the specs call it a "chunk") = x shares in every atom of a contiguous range.
- One **LMSR** per market. Range cost `b·ln(1 − p + p·e^(x/b))`, sell proceeds `−b·ln(1 − p + p·e^(−x/b))`, where p = range sum ÷ root sum.
- Prices live in a **segment tree** in one zero-copy account: leaves are e^(q/b), internal nodes hold range sums and lazy range-multipliers. A trade is a lazy range-multiply, O(log n). Tree values are small packed floats (64-bit mantissa + exponent), so tiny weights keep full precision and nothing overflows.
- **b (depth):** flagship 1,000, fast demo 100. It's fixed per market. Higher b means prices react less to trades and the subsidy is larger.
- **Fixed point Q64.64 in u128** for exp/ln and pricing. Round costs **up**, proceeds **down**; amounts are u64 base units (6 decimals). Invariant on every instruction: vault balance − accrued fees ≥ largest payout any single atom could require. One trade moves at most 30 × b shares.
- **Fees:** flat 3.5%, always taken out of the gross amount: on a buy, the stake includes the fee (stake 20 → 0.70 fee, 19.30 goes to the LMSR); on a sell, the fee comes out of the LMSR proceeds. Recorded separately as 2.5% LP / 1% platform. Multipliers are always shown after fees **and** price impact for the chosen stake.
- **Time:** `advance_time` (permissionless) zeroes atoms behind a live edge = now − lag; prices renormalise automatically. **Locked zone** (72h flagship / 1h fast demo): no buys or sells on atoms inside it. Every trade requires `range start ≥ now + lock`. This also blocks atoms that have elapsed but aren't yet pruned (between the live edge and now), which could otherwise be bought after the event is known.
- **Instructions:** `create_market`, `buy_range` (with `max_cost`), `sell_range` (with `min_proceeds`), `advance_time`, `resolve` (admin; records the winning atom), `claim` (pays winners), `set_clock_offset` (admin, demo markets only: lets the fast market's time move forward on camera).
- **Token program:** use Anchor's `token_interface`, so the market works with either SPL Token or Token-2022, whichever program the mint uses (VCR is classic SPL Token).
- Platform is the only LP; each market is fully funded for its worst case `b·ln(1 / lowest opening price)`.

## Repo

- `packages/reference`: TypeScript f64 reference model. `npm test` (Node's built-in runner, no dependencies; Node runs `.ts` directly).
- `crates/veleda-math`: Rust maths (`fixed`, `float`, `lmsr`, `tree`) and `engine` (the program's instructions as plain Rust over borrowed state), `no_std`, used by the Anchor program. `cargo test -p veleda-math`; `scripts/cross-check.sh` replays 15,000 random reference-model actions through the engine.
- `programs/veleda`: Anchor 1.x program, deployed on devnet at `7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx` (devnet still runs the week 1 probe build until the week 2 deploy). Instructions so far: `create_market`, `buy_range`, `sell_range`; layout in `src/state.rs`, opening-price presets in `src/prior.rs`. Tests are LiteSVM in `tests/`: `anchor build && cargo test -p veleda` (they load `target/deploy/veleda.so`).
- `app/`: standalone Next.js 16 project (own `node_modules`, outside the root workspace because Privy's server SDK pins `@solana/kit` 5.x). Privy sign-in, sign-up airdrop and a fee-payer-signed transfer; `cd app && npm run dev`. Reads the root `.env` and `keys/`. Privy draws its modal inside the page, so keep global CSS scoped (e.g. under `main`).
- Devnet VCR mint: `CjkpwuK5BU8sC4vhAgvnGLFg1QAf4xLNxiRKesMEfXaP` (6 decimals, classic SPL Token).
- `keys/`: devnet keypairs, gitignored. Never commit or print private keys.

## Stack (from the spec)

Anchor program on devnet · React mobile-first PWA with the Solana wallet adapter · **Privy** embedded wallets (Solana; free Developer tier) · server fee payer + 100-token sign-up airdrop · plain share links at `/m/<market>?from=&to=` (Blinks are roadmap only) · trader-bot script to seed markets.

## Terminology and copy

- App copy says **"window"**, not "chunk" (code and specs may still say chunk).
- Primary button: **"predict the future │ 20 VCR"**. Cash-out button: **"cash out │ <amount> VCR"**. Show a small "test money" label next to balances.
- Never shorten the brand to "Veda" (an existing Solana DeFi protocol).
- Onboarding must never show "seed phrase", "SOL" or "devnet" to the user.

## Open decisions (don't guess — ask)

- Whether 5 of 10 is the right quorum (it can be tuned).
- Final list of the 10 flagship resolution sources (a draft is in the hackathon spec).
- Month view (screen 1) vs day view (screen 2) sequencing in the flow.

## Flagship resolution

- **Question:** "When will Taylor Swift's first child be born?" It resolves on the date of birth, not the announcement.
- **Source rule:** the calendar date of birth (local to the place of birth) as reported by **at least 5 of 10 named outlets**. If they disagree, the date reported by the most outlets wins. If fewer than 5 report, the bar isn't met and the market stays unresolved, however long that takes. Admin resolves by hand once the quorum is met. Draft list: Associated Press, Reuters, BBC News, CNN, The New York Times, People, TMZ, E! News, Billboard, Variety.
- **Roadmap only (don't build):** halt on first report, void-if-already-happened with refunds, and an AI halt watcher. All three are specced in the hackathon spec's "Market integrity" section.

## Wallets and fees

- **Privy** handles sign-in and embedded wallets. Use email/Google sign-in, with existing wallets (Phantom, Solflare, Backpack) connected through Privy's Solana wallet connectors.
- **No paid services.** Everything must run on free tiers: Privy Developer (free up to 499 MAU and 50K signatures a month), devnet SOL from a faucet, and free RPC and hosting tiers. Don't use Privy's paid gas sponsorship. Flag anything that would need a paid plan before using it.
- **Server is the fee payer** (Solana's native `feePayer`). The server builds the transaction, the user's embedded wallet signs it without sending, then the server adds its signature and submits it.
- **Server also pays rent.** In Anchor `init`, set `payer` to the fee-payer key, not the user, for `Position` accounts. The server also creates the user's token account when it sends the sign-up airdrop. A user with no SOL must be able to complete a first buy.
- When `claim` closes a position, its rent refund goes back to the fee payer.

## Definition of done (from the track brief and spec)

Working devnet demo with both markets seeded · repo with README, screenshot, one-command setup script, and a "How Solana powers Veleda" section · link-to-first-position under 60 seconds on a phone, three times in a row · 2–4 minute demo video (target ~2:25) plus a backup recording.
