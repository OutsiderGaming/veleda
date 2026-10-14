# Veleda — Build plan

Oct 12, 2026 · Week 1 itemised. Later weeks are planned in detail at the end of the week before, against the week-by-week plan in the hackathon spec.

## Decisions

| Area | Decision |
| --- | --- |
| Repo | One monorepo: npm workspaces for TypeScript, a Cargo workspace for Rust |
| Reference model | TypeScript, plain `number` (f64). The frontend reuses it for quotes; `max_cost` / `min_proceeds` absorb the small gap to on-chain fixed point |
| On-chain maths | Plain Rust crate (`crates/veleda-math`): Q64.64 exp/ln and the segment tree. The Anchor program depends on it, so the same code is tested off-chain and runs on-chain |
| App | Next.js, one project for the web app and the fee-payer server; deploy on Vercel's free tier |
| Tests | TypeScript: Node's built-in test runner (no dependencies). Rust: `cargo test` |

## Repo layout

```
CLAUDE.md, README.md, docs/, design/   specs and mockups
packages/reference/    TS reference model (LMSR, ranges, fees, pruning, vault invariant)
crates/veleda-math/    Rust: fixed-point exp/ln, segment tree with lazy multiply
programs/veleda/       Anchor program (created with `anchor init` once the toolchain is installed)
app/                   Next.js app (created during the Privy spike)
scripts/               setup, mint, bots
keys/                  devnet keypairs (gitignored, never committed)
```

## Week 1

### Day 1: setup and long-lead items

- [x] **Create the Privy app**: free Developer tier, enable Solana embedded wallets, email and Google sign-in. Note the app ID.
- [x] **Install the toolchain**: Rust 1.99.0, Solana CLI 3.1.10 (Agave), Anchor CLI 1.1.2 via avm, Surfpool 1.6.1 (local test network, optional). `cargo test` and `cargo-build-sbf` both work.
- [x] Repo skeleton: workspaces, `.gitignore`, reference-model and math-crate stubs.
- [x] Devnet keypairs in `keys/`: `admin.json` (7dWt…zDiC), `fee-payer.json` (44Rc…VRz2), `mint-authority.json` (GjLz…girp), `token-mint.json`, `veleda-program.json`. Admin and fee payer funded.

### Maths (the critical path)

- [x] **Reference model** (`packages/reference`): market of n atoms + "not by end date"; `quoteBuy` / `quoteSell` for a range; fee taken out of the gross amount; `advanceTime` pruning; `resolve`; `claim`; a vault-invariant check. Property tests on random trade sequences: the vault always covers the largest single-atom payout, buy-then-sell returns at most the stake, prices always sum to 1.
- [x] **Fixed-point exp/ln** (`crates/veleda-math`): Q64.64 in u128; range reduction plus a short polynomial. Tests against f64 across the input range; rounding direction (costs up, proceeds down).
- [x] **Segment tree with lazy range-multiply** (`crates/veleda-math`): range multiply, range sum, point zero (pruning), whole-tree rescale. Tests against a plain array on random operations.
- [x] **Cross-check**: `crates/veleda-math/src/engine.rs` runs the program's instructions in plain Rust; `scripts/cross-check.sh` replays reference-model trading sessions (plain-text logs) through it. 26,000 trades pass: same accepts/rejects, costs never below the reference and within a couple of base units, proceeds never above, prices within 1e-10, balance never below the reference, same claims.
- [x] **Compute-unit spike**: Anchor program `programs/veleda` (devnet `7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx`) with temporary `probe_*` instructions running the real engine on a 732-atom market; `scripts/probe-cu.ts` measures them. Results (12 Oct 2026):

  | Action | Engine CU | Instruction total CU |
  | --- | --- | --- |
  | Create market (732 atoms) | 291,533 | 297,952 |
  | Buy 1 day | 49,827 | 52,903 |
  | Buy 31 days | 61,642 | 64,744 |
  | Buy 696 days | 88,515 | 91,774 |
  | Buy max size (29 × b) | 69,067 | 72,371 |
  | Sell part of a position | 72,964 | 75,773 |
  | Clear 101 elapsed days | 7,988 | 9,963 |

  Every trade fits the default 200,000 CU per instruction with room for the real program's account checks and token transfers. `create_market` needs a compute-budget request (~300,000). Wider ranges cost more because the engine walks every atom in the range (owed shares) and every live atom (largest-payout check): fine at ~1,000 atoms, but a five-year hourly market would need a max-tree for liabilities instead (roadmap). Market account for 732 atoms: 55,072 bytes.

### Onboarding proof

- [x] **Create the VCR mint**: `CjkpwuK5BU8sC4vhAgvnGLFg1QAf4xLNxiRKesMEfXaP` on devnet, 6 decimals, classic SPL Token program, mint authority `keys/mint-authority.json`, no freeze authority.
- [x] **Privy spike** (`app/`, verified 12 Oct 2026 with Google sign-in): Solana embedded wallet created silently at sign-in; `/api/airdrop` creates the user's VCR account and mints 100 VCR with the server paying fee and rent; the user then signs "send 1 VCR back" from a wallet that has never held SOL, with the server as fee payer. The wallet address always comes from the verified Privy session.

### Week 1 is done when

- The Rust maths matches the reference within rounding on 10,000 random trades.
- A new user signs in by email and receives 100 VCR with no SOL in their wallet.
- The compute cost of a range update is measured and fits the budget.

## Week 2: the real program

Goal from the hackathon spec: both demo markets live on devnet with bot trading; the vault invariant holds after every instruction; new sign-ups receive 100 VCR automatically (already done in week 1).

### Decisions

| Area | Decision |
| --- | --- |
| Program | Replace the `probe_*` instructions in `programs/veleda` with the seven real ones; same program ID (upgrade in place). Each instruction is a thin wrapper: load accounts, call `veleda_math::engine`, move tokens |
| Market account | Zero-copy, created by the client with `createAccount` (it's over the 10 KB CPI limit), then initialised by `create_market`. Layout: header (params, admin, mint, vault, live edge, status, winner, balance, LP and platform fees, clock offset, demo flag), then tree sums, tree multipliers, owed shares |
| Positions | PDA `["position", market, owner, nonce]` holding range and shares. The fee payer is the rent payer; `claim` closes it and returns the rent to the fee payer. Nonce chosen by the client |
| Vault | Token account PDA `["vault", market]`, owned by the data-less PDA `["authority", market]`, which signs payouts (the market account itself can't sign). Holds subsidy + stakes + fees |
| Tokens | Anchor `token_interface` with `transfer_checked`, so classic SPL Token (VCR) and Token-2022 both work |
| Fee payer | Every instruction takes a separate `fee_payer` signer for rent; the user signs only as token owner |
| Tests | LiteSVM (Rust, in-process, no validator): every instruction, every rejection path, invariant after each step, a user with zero SOL |

### Steps

- [x] **Account layout + `create_market`**: header struct, size helper shared with scripts, prior from presets, subsidy deposited into the vault from the admin's VCR. LiteSVM harness with the VCR mint and funded test users. Done 13 Oct 2026:
  - Layout in `programs/veleda/src/state.rs`: 8-byte discriminator + 184-byte header, then tree sums, multipliers and owed shares. `market_account_len(atoms)` gives the size (flagship 107,272 bytes, fast 13,832); `scripts/` will mirror it.
  - Prior preset (`prior.rs`): "not by end date" price, per-atom floor and a shape given as a few control points joined by straight lines; each timed atom gets the floor plus its shape share of the rest, so "not by end date" opens at exactly its price. Fits in one instruction at any size. Max 1,500 atoms (the opening prices are built on the 32 KB heap).
  - Atom 0 starts at the current atom boundary (UTC midnight for the flagship, the hour for the fast market).
  - Compute: flagship `create_market` 664K CU (prior ~200K, engine ~450K), fast 117K. Needs a 1.4M compute-budget request. Signed division and overflow-checked u128 multiplies are slow on-chain; the prior avoids both.
  - Tests (`programs/veleda/tests`, LiteSVM, run `anchor build` first): both presets, Token-2022 mint, wrong account size, bad parameters and priors, double initialisation.
  - `scripts/probe-cu.ts` retired with the probe instructions; compute is now measured in the LiteSVM tests.
- [x] **`buy_range` / `sell_range`**: positions, `transfer_checked` in and out of the vault (authority PDA signs), `max_cost` / `min_proceeds`, fee payer pays position rent. Done 13 Oct 2026:
  - Each buy opens a new `Position` (market, owner, rent payer, nonce, range, shares); there are no top-ups. Selling takes shares from the whole range and can be partial; selling the last share closes the position, and its rent goes back to the stored rent payer, so a seller can't redirect it.
  - Every buy and sell emits a `Trade` event (range, shares, stake or net proceeds, fee) for the activity feed and price history.
  - Compute on the flagship: buy 1 day 70K CU, 31 days 81K, 700 days 100K, max size 83K; selling part of 700 days 93K. All fit the default 200K.
  - Tests (`tests/trading.rs`): a trader with 0 SOL buys and cashes out in two steps, fee split, rent refund, compute; locked, slippage, too-large, bad-range and reused-nonce rejections on buy; over-selling, slippage, another user's position and a redirected rent refund on sell; invariant (vault = balance + fees ≥ largest payout) after every step.
- [x] **`advance_time`, `resolve`, `claim`, `set_clock_offset`**: clock offset only on markets created as demo markets, forward only; "now" = chain time + offset everywhere. Done 13 Oct 2026. `advance_time` is permissionless; `resolve` and `set_clock_offset` check the market's admin; `claim` needs the owner's signature, pays the winner 1 VCR per share (losers and pruned positions get 0) and always closes the position, rent to the stored rent payer. Emits `Claimed`.
- [x] **Tests**: full lifecycle per market type; locked/pruned/slippage/too-large/resolved rejections; claim on fully pruned positions; a user with 0 SOL buys and sells; invariant after every instruction. Re-run the compute measurement. Done 13 Oct 2026 (`tests/lifecycle.rs`, `tests/trading.rs`, `tests/create_market.rs`; 17 tests). The engine's `Pruned` error can't fire on-chain: a pruned atom always starts before now + lock, so `Locked` fires first. Compute (LiteSVM, flagship): create 666K, buy 69–100K, sell 82–93K, advance_time 19K for 9 days, claim 12K.
- [x] **Deploy + create markets**: upgrade the devnet program; `scripts/create-markets.ts` creates the flagship (Taylor Swift, 3 years = 1,096 daily atoms, b 1,000, 72h lock, 24h lag, the opening shape from the hackathon spec) and the fast market (168 hourly atoms, b 100, flat, 1h lock, 10 min lag, clock offset enabled), minting each subsidy to its vault. Done 13 Oct 2026: program upgraded on devnet (389,520 bytes), markets created and recorded in `markets.json`: flagship `63fNCmpHJVRE5RduWzzcFT39Tm7PTh1U5v2qjhMdq5Jb` (subsidy 9,210.34 VCR, atom 0 = 13 Oct 2026 00:00 UTC), fast `59dFi4bkexb7oSbCcMA5Z6hZSPyUEtzghHrSC7KXKf6K` (subsidy 512.99 VCR, atom 0 = 13 Oct 2026 10:00 UTC). `scripts/create-markets.ts flagship|fast` (one transaction per market; admin pays) and `scripts/lib/veleda.ts` (PDAs, layout, presets, encoders for all seven instructions). The fast market's 7-day window starts at creation, so re-create it (`fast` only, ~0.07 SOL) before recording the demo.
- [x] **Trade endpoints**: `app/` API routes that build buy/sell/claim transactions with the server as fee payer (same pattern as the week 1 transfer), for the web app in week 3. Done 13 Oct 2026:
  - `POST /api/trade/buy` `{market, from, to, stake}` quotes the stake into shares at the live price (asks 0.2% fewer shares than exact, so ~0.4% room for the price to move; `max_cost` = the stake) and rejects locked windows up front. `POST /api/trade/sell` `{position, shares?}` (default all; `min_proceeds` 1% under the quote). `POST /api/trade/claim` `{position}`. Each returns a fee-payer-signed transaction for the wallet to sign, then `POST /api/submit` (was `/api/transfer/submit`) relays it.
  - `GET /api/positions` (signed in): open positions with cash-out value, `locked`, or payout once resolved. `GET /api/markets` (public): live state and every atom's price.
  - `app/src/lib/veleda/market.ts` reads market and position accounts and quotes trades with no dependencies (browser, server and bots); `program.ts` builds the instructions for `@solana/kit`.
  - Devnet check with a fresh keypair: 20 VCR stakes on both markets cost 19.92 VCR, positions found by owner, cash-out quotes matched the chain within 0.000001 VCR.
  - The onboarding test page has buttons 3 and 4 (20 VCR on each market) and a "Your windows" list with cash-out buttons, for the Privy check below.
  - Bots sign with their own keys, so they use `scripts/lib/veleda.ts` directly rather than these routes.
- [x] **Trader bots**: `scripts/bots.ts` with a few wallets (minted VCR, admin pays fees and rent) trading both markets on a schedule so the band has shape and history. Written and tested 13 Oct 2026; the day-long run is still to do:
  - Five bots, each with a view of each market (peak, spread, "not by end date"). Each round a bot either buys a window it values at more than 1.15x its price (5–40 VCR), or sells the position it thinks most overpriced (above 1.4x its view, or when it holds 4 in that market). Every round also calls `advance_time` on both markets.
  - Keys in `keys/bots/` (gitignored, created on first run); the mint authority tops a bot up with 2,000 VCR when it drops below 200. The admin pays fees and position rent, so the user-facing fee payer's SOL is kept for users.
  - `node scripts/bots.ts` runs a round every ~2 minutes until stopped (`--rounds N --interval S` for tests). Reads `SOLANA_RPC_URL` from `.env`; the public devnet RPC returns 429s under bursts, which web3.js retries.

### Open before starting

- Flagship opening prior: settled (12 Oct 2026). 3-year window, "not by end date" 65%, near zero for ~6 months, curving up to a peak around the end of year 2, easing slightly through year 3.
- 1,097 leaves need a 2,048-slot tree: the market account roughly doubles to ~107 KB (~0.75 devnet SOL rent), and trades cost a little more compute than the 732-atom measurement. Re-measure in the tests step.
- Market start times: settled (12 Oct 2026). Both markets open as soon as they're created; each window starts at creation.

### Week 2 is done when

- Both markets are live on devnet and the bots have been trading for a day.
- LiteSVM tests pass for every instruction and rejection path, with the invariant checked after each.
- A fresh Privy user with 0 SOL can buy and sell through the trade endpoints. Done 13 Oct 2026: a new Privy sign-in on the test page claimed 100 VCR, bought on both markets (flagship 1,584 shares for 20 VCR at 79x; fast 310 shares at 15x) and cashed both out, ending on 94.56 VCR with 0 SOL. First position 59 s after page load, sign-in included.
- Bots started 13 Oct 2026 10:54 UTC (`bots.log`). Agreed 13 Oct: a few hours of trading is enough (the aim is a shaped band with history; gaps while the laptop sleeps don't matter). Re-run a burst before the week 4 recording; where the bots live long term is decided with hosting in week 3.

## Week 3: the web app

Goal from the hackathon spec: the real app on a phone (home, timeline band, drag-to-select, buy sheet with sign-in at the point of buying, positions with cash-out, claim, share link), plus practice mode. Done when a link opens to a first position in under 60 seconds on a phone, three times in a row.

### Decisions

| Area | Decision |
| --- | --- |
| Where | The existing Next.js project in `app/`, deployed to Vercel's free tier. The week 1/2 test page moves to `/dev` and stays out of navigation |
| Routes | `/` Home (market cards) · `/m/[market]` timeline, select and buy sheet · `/positions` · `/account` · `/practice`. Bottom nav: Markets / Positions / Account, as in the mockups |
| Look | Mockup tokens from `design/README.md` as CSS variables; Cinzel and Manrope self-hosted from `design/fonts/` with `next/font/local`; global CSS stays scoped under `main` so Privy's modal keeps its own styles. Mobile first; desktop just centres the phone-width column |
| Live data | `GET /api/markets` (already built: header plus every atom's price) polled every ~10 s on the open market, and straight after each trade. Quotes and multipliers are computed in the browser with `app/src/lib/veleda/market.ts`, so dragging updates instantly with no network |
| Time and dates | The flagship's atoms are UTC days and the fast market's are UTC hours; the app labels them in the viewer's local time. Share links use atom indexes (`/m/flagship?from=300&to=330`): short and exact |
| Sign-up airdrop | Automatic: the app calls `/api/airdrop` once after the first sign-in (it's already idempotent). The 100 VCR is there before the buy sheet asks for it |
| Positions data | Open positions from `/api/positions` (built). "Paid" and entry odds come from the buy's `Trade` event, read once per position from its first transaction and cached server-side; no program change. Settled positions come from the wallet's recent transactions (`Trade` sells and `Claimed` events). Total traded on Home = accrued fees ÷ 3.5% |
| Sparklines | Decided 13 Oct 2026: dropped from position cards for the hackathon (they'd need stored price history). Cards show entry odds → current odds instead |
| External wallets | Decided 13 Oct 2026: email/Google embedded wallets only for the demo; Phantom/Solflare via Privy's connectors is a stretch goal, because the server currently only trusts the embedded wallet |
| Keys on Vercel | Fee payer and mint authority as environment secrets (JSON arrays), read when `keys/` isn't there. Devnet only |
| Bots | Decided 13 Oct 2026: a scheduled GitHub Actions job runs one bot round every 30 minutes. The repo is private (2,000 free minutes a month, at least 1 billed minute per run), so 30 minutes is about 1,440 minutes a month; tighten it if the repo goes public. Admin, mint-authority and bot keys go in as repo secrets, set with `gh secret set` straight from the key files so they're never printed |

### Steps

In build order; each step should leave the app working.

- [x] **Bots on GitHub Actions**: `.github/workflows/bots.yml` runs one round at :07 and :37 past each hour (plus manual runs). Done 13 Oct 2026. Only low-value keys go to GitHub: a dedicated bot payer (`keys/bot-payer.json`, funded with 1 devnet SOL) and the five bot wallets (pre-funded with 50,000 VCR each). The admin key (program upgrade authority, market admin) and the mint authority stay on the laptop; top-ups happen locally when a bot runs low.
- [x] **Shell and design system**: routes, bottom nav, tokens, fonts, Home/Account placeholders; test page moved to `/dev`; PWA manifest and icons from `design/logo.png` so it can be added to a home screen. Done 13 Oct 2026.
- [x] **Data layer**: market polling hook, browser-side quotes, atom ↔ date helpers (local time, locked zone, elapsed), session hook with the automatic airdrop and the VCR balance with its "test money" label. Done 13 Oct 2026.
- [x] **Home**: both markets as cards with question, total traded and a mini band; tap to open. Done 13 Oct 2026, plus a "New here? See how it works" link to practice mode.
- [x] **Timeline**: vertical, now at the top, Year / Month / Day / Hour tabs (Hour hidden on the flagship), bars sized by crowd odds with stippled copper styling, month view with engraved month names and per-month odds and multiplier, elapsed time greyed, shaded "Locked" zone, "not by end date" at the bottom, the user's open positions as coloured bands. Opens on Month for the flagship, Day for the fast market. Done 13 Oct 2026. Timelines of 31 bars or fewer (the fast market's Day view, Year view) use the thick labelled bars; the fast market opens on Hour.
- [x] **Select**: works in every zoom level, selecting whole bars of that level (months in Month view, days in Day view, hours in Hour view). Gestures (agreed 13 Oct 2026): Done 13 Oct 2026 (checked with a mouse in Chrome; touch long-press still to check on a phone).
  - Swipe scrolls the timeline.
  - Press and hold a bar (~0.3 s, haptic tick where supported) anchors a selection there; dragging without lifting extends it up or down from the anchor, with a floating tag (length · % · multiplier for 20 VCR) and auto-scroll near the top and bottom edges.
  - Releasing opens the buy sheet ("Release to see your price"). Swiping the sheet down returns to the timeline with the selection kept.
  - Tapping a bar (or its odds) selects that bar; tapping the blank space beside the bars clears the selection (changed 13 Oct 2026 at the user's request; thin bars get a little slack so they're still easy to hit). Handles on the ends adjust the selection afterwards.
  - A selection stops at the first open bar: it can't extend into the locked zone or elapsed time. Holding on a locked bar shows a short hint instead.
  - Fixing a mistake: while dragging, moving back towards the anchor shrinks the selection and moving past it flips direction (the anchor stays put). After release, swipe the sheet down and drag the start or end handle. To start over, press and hold or tap elsewhere: the new selection replaces the old one. A small × on the floating tag also clears the selection.
- [x] **Buy sheet**: dates and length, multiplier after fees and price impact, crowd odds, stake chips 5 / 20 / 50 / Other, "Wins if it lands", detail line (shares · fee · cancels if the price passes X%), "predict the future │ 20 VCR", "Share this window as a link"; swipe down to close. Signed-out: the button opens Privy sign-in and the sheet is still there afterwards. On a slippage rejection, re-quote and ask once more. Done 13 Oct 2026; a real buy through it still to check with a Privy account.
- [x] **Positions**: hero total value, P&L, paid and count; Open / Settled tabs; cards with window, paid / worth now (after fee) / if it lands, entry vs current odds, "cash out │ amount VCR"; locked state "Locked · within 72h of now" (fast: "within 1h"); claim button after resolution. Needs the `Trade`-event lookup in `/api/positions`. Done 13 Oct 2026: paid and entry odds from each position's buy event, Settled from recent sells and claims (transaction logs, cached, retried on rate limits). Cards with positions still to check with a Privy account.
- [x] **Share link**: `/m/<market>?from=&to=` opens the market with that window selected and the buy sheet open, signed in or not. Done 13 Oct 2026.
- [x] **Deploy**: Vercel free tier, keys and Privy secrets as environment variables, the Vercel domain added to Privy's allowed origins. Check nothing on the way needs a paid plan. Prepared 13 Oct 2026: the server reads `FEE_PAYER_KEY`, `MINT_AUTHORITY_KEY` and `MARKETS_JSON` from the environment when `keys/` and `markets.json` aren't deployed; `next build` passes. Needs the user's Vercel account (Root Directory `app`, with files outside it included, since practice mode imports `packages/reference`). Vercel project `veleda` on the OutsiderGaming account (team `veleda1`, Hobby plan), connected to the GitHub repo so every push to `main` deploys; root directory `app`, Node 24; production variables `FEE_PAYER_KEY`, `MINT_AUTHORITY_KEY`, `MARKETS_JSON`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` (13 Oct 2026). If markets are re-created, update `MARKETS_JSON` too. Live 13 Oct 2026 at https://veleda-veleda1.vercel.app (Vercel Authentication switched off so it's public). Remaining: add that origin to Privy's allowed domains.
- [x] **Practice mode** (hackathon spec, "Practice mode"): a scripted, simulated market that users scrub forwards and backwards, all in the browser. Done 13 Oct 2026 with the draft script and the model's figures; the script still needs the user's sign-off (edit `app/src/lib/practice/scenario.ts`).
  - Run the script through `packages/reference` once per scenario (and per choice: cash out or hold) to produce snapshots of every atom's price, the user's position value and the caption, about one per simulated hour. The slider indexes the snapshots. The reference model is plain TypeScript with no dependencies, so the app can import or copy it.
  - Fixed script, no randomness; the user's own window and stake feed into the same replay.
  - Reuse the timeline, select and buy sheet components; add a caption card and the "Practice · simulated prices" tag.
  - Replace the draft script's placeholder figures with the model's output, and agree the script with the user before building the screens.
  - Built last, on top of the finished timeline, select and buy sheet.
- [x] **Copy audit**: no "SOL", "devnet" or "seed phrase" anywhere a user can see (the `/dev` page excepted); "window", never "chunk"; "test money" beside every balance; VCR, not USDC; the brand is never shortened to "Veda". First pass 13 Oct 2026: clean. Re-run before the stopwatch test.
- [ ] **Stopwatch test**: on a phone, from opening a share link to holding a position, three times in a row, each under 60 seconds, with fresh accounts.

### Open items (13 Oct 2026)

- Fast market (14 Oct 2026): "When will BTC first hit $200,000?", a fictional scenario tagged "Fictional · 2028". `create_market` gained a `clock_offset` argument (demo markets only, never negative) so the market's clock and atom 0 can start in the future; program upgraded on devnet, market re-created at `77g45iFp7ZCsXKcMoJJGu1EuHH3gUiUzMuESKsj47Kq5` (atom 0 = 12 June 2028 00:00 UTC). `scripts/admin.ts fast status | clock +3h | advance | resolve <atom|ISO time|end>` runs it on camera. Re-creating it changes the address: update `MARKETS_JSON` on Vercel each time.
- The public devnet RPC rate-limits bursts (429s). Fine for the demo with retries, but a free RPC tier (e.g. Helius's free plan) in `SOLANA_RPC_URL` would make positions and history snappier. It needs a sign-up, so it's the user's call.
- "Not by end date" is labelled with its cutoff ("Not by 12 October 2029"; hourly markets give the end time), on the timeline, the window text and the Home cards (13 Oct 2026, user request).
- Releasing a drag opens the buy sheet straight away (mockup: "Release to see your price"); the alternative is a tag that needs one more tap.

### Open before starting

- Month view vs day view: decided 13 Oct 2026. The flagship opens on Month, and dragging works in any zoom level, selecting whole bars of that level; no forced jump between levels.
- Practice mode script: agree the 8 beats and their figures before building the screens.
- The fast market's 7-day window ends 20 Oct 2026. Re-create it (`node scripts/create-markets.ts fast`) whenever testing needs a fresh one, and again just before the week 4 recording.

### Week 3 is done when

- Every screen above works on the deployed URL against both devnet markets, on a phone.
- Link to first position in under 60 seconds, three times in a row.
- Practice mode plays the whole story and scrubs both ways.
- The copy audit passes.
