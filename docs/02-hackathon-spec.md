# Veleda — Hackathon Spec

Oct 9, 2026 · @Outsider Gaming
Source: https://claude.ai/code/artifact/8266dc36-5ef6-4a63-abcd-bec0c6cef449 (exported 12 Oct 2026)

## Goal and pitch

In four weeks, ship a working devnet prototype for the **Best Consumer App on Solana** track that proves four things: a new user can place their first call within 60 seconds with no wallet setup, any time chunk can be bought as one trade on a single on-chain LMSR, positions can be cashed out at any time, and any window can be shared as a link that opens straight onto it.

**Pitch:** Fans already argue about when things will happen: when the album drops, when the baby's due, when the band reunites. Veleda turns those arguments into calls you can stake, share and get credit for. Pick any stretch of the future, from one hour to one year, in a single swipe. Bold, distant calls are cheap and pay big; when the crowd catches up, you can cash out.

**Audience:** pop-culture fans and crypto-native communities. **Need:** bragging rights with something at stake. **Tagline:** Veleda, the market of seers.

Name: Veleda ("VEL-eh-dah"), after the 1st-century Germanic seeress who predicted Rome's defeat in the Batavian revolt. She lived in a tower and answered questions through intermediaries. Before announcing, check the domain (veleda.market, with .xyz or .app as fallbacks), the X handle, DexScreener and pump.fun for a VELEDA token, and UK/US trademarks. Never shorten the brand to "Veda": that's an existing DeFi vault protocol on Solana. Full design rationale lives in the design spec; this doc is only what gets built.

## Scope

Build the core loop end to end; present everything about outside LPs and decentralised resolution as design, not code.

| In (build it) | Out (slide only) |
| --- | --- |
| Email/social login with an embedded wallet | Outside LP deposits and the vault token |
| Platform-paid transaction fees; 100 VCR on sign-up | Depth (b) growing with volume |
| One LMSR per market over a segment tree | Volatility-based and near-term fees |
| Buy and sell any contiguous range | Optimistic oracle and disputes |
| "Not by end date" atom | Daytime-only filter; day/night prior pattern |
| Opening prior from presets + price floor | Mid-market LP exits, capital release, pooled reserves |
| Pruning of elapsed atoms (advance time) | Permissionless market creation |
| Locked zone before now | Separate market list screen |
| Flat 3.5% fee, split recorded LP / platform | Mainnet, KYC, regulatory work |
| Admin resolution + claim | Native iOS/Android apps |
| | Halt on first report; void and refunds; AI halt watcher; AI or multi-model resolution |
| Mobile web app: home, timeline, select, buy, cash out | Partial sells of a sub-range (stretch goal) |
| Share a window as a plain link | One Blink for buying a chunk (stretch goal if week 4 has room) |
| Practice mode: an interactive tutorial with a scripted, simulated market you can scrub forwards and backwards | A time machine over live market data; user-controlled clocks on real markets |

The platform creates every market and is the only LP. Every market is fully funded for its worst case. Everything runs on devnet in **Veleda Credit (VCR)**, our own 6-decimal test mint (`CjkpwuK5BU8sC4vhAgvnGLFg1QAf4xLNxiRKesMEfXaP`; not USDC). The platform holds the mint authority and mints the market subsidies, sign-up airdrops and bot balances. The mint is configurable per market. The program uses Anchor's `token_interface`, so either SPL Token or Token-2022 mints work.

## Demo markets

Run two markets: a flagship that shows the real use case, and a fast one that shows time passing, cash-out and resolution inside the demo.

| Parameter | Flagship | Fast demo |
| --- | --- | --- |
| Question | "When will Taylor Swift's first child be born?" Natural timing, resolving on the reported date of birth | A staged event resolved live during judging |
| Atom size | Day | Hour |
| Window | 3 years (1,096 daily atoms + end-date atom) | 7 days (168 atoms + end-date atom) |
| b | 1,000 VCR | 100 VCR |
| Opening prior | "Not by end date" at 65%. The other 35% over the three years: near zero (the 0.01% floor) for the first ~6 months, then curving up to a peak around the end of year 2, then easing slightly down through year 3 | Flat |
| Locked zone | 72 hours | 1 hour |
| Clock offset | Always 0 | Admin-settable, so time can move forward during the demo |
| Live-edge lag | 24 hours | 10 minutes |
| Resolution | Admin, day precision. The calendar date of birth (local to the place of birth) as reported by at least 5 of 10 named outlets; if they disagree, the date reported by the most outlets. If fewer than 5 report, the bar isn't met and the market stays unresolved. The quorum can be tuned. Draft list: Associated Press, Reuters, BBC News, CNN, The New York Times, People, TMZ, E! News, Billboard, Variety | Admin, hour precision |

All parameters are stored in the market account, so the same program serves both. Seed both markets with simulated traders (a small script with a few wallets) so the band has shape and history when judges open it.

## On-chain program

One Anchor program: each market keeps its prices in a segment tree in one zero-copy account, and every trade costs ~16 tree updates whatever the chunk width.

**Accounts**

| Account | Holds |
| --- | --- |
| Market | Parameters (atom size, window, b, lock, lag, fee, token mint), admin key, clock offset (demo markets only), live-edge atom index, status, resolved atom |
| Tree (zero-copy) | e^(q/b) per atom as leaves; range sums and lazy range-multipliers in internal nodes |
| Vault (token account) | All VCR paid in, including fees not yet withdrawn; backs every payout |
| Fee ledger | LP fees and platform fees accrued separately (the tokens stay in the vault until withdrawn) |
| Position (PDA per user + market + nonce) | Range start, range end, shares |

**Instructions**

| Instruction | Who | Does |
| --- | --- | --- |
| `create_market` | Admin | Sets parameters, writes the opening prior into the tree, funds the vault with the worst-case subsidy |
| `buy_range` | Anyone | Adds x shares to every atom in [start, end]; takes the stake (LMSR cost + 3.5% fee, where the fee is 3.5% of the stake); rejects if cost > `max_cost` or start < now + lock. That rule also blocks elapsed atoms that haven't been pruned yet |
| `sell_range` | Holder | Removes x shares from the position's whole range; pays LMSR proceeds minus 3.5% of those proceeds; rejects if the net proceeds are below `min_proceeds` or start < now + lock |
| `advance_time` | Anyone | Zeroes atoms behind the live edge (now − lag); renormalisation is automatic because prices are leaf ÷ root sum |
| `set_clock_offset` | Admin | Demo markets only: moves the market's "now" forward (it never goes back). Every time check uses chain time + offset. Rejected on markets created with a zero offset |
| `resolve` | Admin | Called once the source quorum is met. Stops trading and records the winning atom |
| `claim` | Holder | Pays shares × 1 VCR if the position's range contains the winner; closes the position |

**Core maths**

```latex
\text{cost} = b \ln\left(1 - p + p\,e^{x/b}\right) \qquad \text{proceeds} = -b \ln\left(1 - p + p\,e^{-x/b}\right)
```

p is the range's current price (range sum ÷ root sum). A trade multiplies the range's leaves by e^(±x/b), which the tree does lazily in O(log n).

- **Fixed point:** Q64.64 in u128, with exp and ln implemented by range reduction plus a short polynomial. Round every cost **up** and every proceeds figure **down**, so rounding can never drain the vault.
- **Tree number format:** tree sums and pending multipliers are small packed floats (64-bit mantissa + power-of-two exponent), not fixed point. An atom squeezed to a tiny share of the market keeps full relative precision, buy prices reach the cost formula without truncation, and nothing can overflow, so no rescaling is needed.
- **Trade size cap:** one trade may add or remove at most 30 × b shares, keeping exp inputs well inside range. That's 30,000 shares on the flagship and 3,000 on the fast market; larger trades are rejected and can be split.
- **Invariant tested on every instruction:** vault balance − accrued fees ≥ the largest payout any single atom could require.
- **Time:** "now" in every check is chain time + the market's clock offset (always 0 on the flagship).

## Fees and liquidity

A flat 3.5% on every buy and sell, always taken out of the gross amount. On a buy, the stake includes the fee: a 20 stake pays 0.70 in fees and 19.30 goes to the LMSR. On a sell, 3.5% comes out of the LMSR proceeds. The platform is the only LP and funds each market's worst case up front.

- **Fee split, recorded separately from day one:** 2.5% to the LP ledger, 1% to the platform ledger. Both belong to the platform for now, but keeping them apart gives you a real LP track record later.
- **Multipliers are shown after fees and price impact** for the chosen stake, everywhere in the app (payout ÷ stake). At flagship b = 1,000, a 20 stake on a 6.1% window buys about 277 shares (×13.9). The mockups' ×15.8 ignores price impact. b = 1,000 keeps the headline multiplier close to the mockups while still letting one person visibly move the band: about 48 tokens takes that window from 6.1% to 10.5%.
- **Subsidy per market** = b × ln(1 / lowest opening atom price). Flagship: 1,000 × ln(10,000) ≈ 9,210 VCR. Fast demo: flat over 169 atoms (168 + end-date), so 100 × ln(169) ≈ 513 VCR. Test tokens, so no real cost.
- **b is fixed** for each market; growth with volume is a roadmap slide.

## Frontend and share link

A mobile-first web app (installable PWA) rather than native apps, built in React with the Solana wallet adapter; screens follow the [mockups](https://claude.ai/artifact/AT3unoJ2sQ7hHadgNZWfih).

1. **Home:** both demo markets as cards with total traded and a mini band; tap one to open it. Replaces a separate market list.
2. **Timeline:** vertical, now at the top, the probability band beside it, elapsed time greyed out, a shaded "Locked" zone below now, your positions as coloured bands, zoom levels year / month / day / hour. Hide the Hour tab on markets with daily atoms.
3. **Select:** long-press and drag (auto-scroll at the edge), tap to select the visible unit, handles to adjust; a live multiplier tag while dragging.
4. **Buy sheet:** range, crowd odds, multiplier after fees and price impact for the chosen stake, stake buttons, payout if it lands, max-price limit, fee line, "Share this window as a link" (copies a plain URL that opens this market with this window selected). If the user isn't signed in, tapping Buy opens sign-in and returns them here with the chunk still selected.
5. **Positions:** live "Cash out now" figure per position; greyed and labelled "Locked · within 72h of now" (fast market: "within 1h") inside the locked zone; claim button after resolution.

**Share link:** `/m/<market>?from=&to=` opens the app on that market with the window selected and the buy sheet open. Signed-out visitors can browse it and sign in when they tap Buy, as in onboarding.

**Blink (roadmap; stretch goal if week 4 has room):** one Solana Action at `/api/actions/chunk?market=&from=&to=`.

- GET returns a card: an image of the timeline with the chunk highlighted, the live multiplier, and 5 / 20 / custom stake buttons.
- POST builds a `buy_range` transaction at request time with `max_cost` set 2% above the quote.
- The same URL opens the normal web app for anyone without the extension.
- Showing the card on X needs approval from Dialect's Actions registry. Without it, demo the Blink in Dialect's own viewer (dial.to).

## Practice mode (interactive tutorial)

A scripted story that shows the whole life of a market in about a minute: pick a window, buy, watch time pass, decide whether to cash out, see it resolve. It runs entirely in the browser. It never touches the chain and uses no real market data, so anyone can use it, signed out, as often as they like.

- **Where:** a "How it works" entry on Home, and offered once to first-time visitors. No sign-in needed.
- **Scrubbing:** a time slider (or swipe) moves freely forwards and backwards through the whole story. Every moment is a precomputed snapshot, so going back is instant and exact.
- **Maths:** the same LMSR, fees, locked zone and pruning as the program, computed with the TypeScript reference model (`packages/reference`), so every price, cash-out figure and payout is what the real market would give. Only the story is scripted: the other traders' moves are fixed, not random, so it looks the same every time.
- **Your pretend window:** the user drags and buys a window with pretend VCR, using the real buy sheet layout. If they pick a different window from the suggested one, the script still plays out and their figures follow the maths.
- **Choices:** at the news beat, "cash out now" or "hold"; scrubbing back undoes the choice.
- **Labelling:** a persistent "Practice · simulated prices" tag and no real balances anywhere on the screen, so it can't be mistaken for a live market. The same goes for the demo video.
- **Screens:** reuses the timeline, select and buy sheet components, plus a caption card for each beat.

**Draft script** (fictional event, edit freely): "When will Luna the cat have her kittens?" A 10-day window with daily atoms, a 1-day locked zone, b = 100, 20 VCR pretend stake.

1. **The timeline.** "Each bar is a day. Its height is the crowd's odds that the kittens arrive then. The bar at the bottom is 'not by day 10'."
2. **Pick a window.** "Drag to choose when you think it happens. Narrow windows are cheap and pay big; wide ones are safer." The suggested window is days 6–7, at about 10%.
3. **Make the call.** "Predict the future │ 20 VCR." The multiplier shows about 5.7x after fees and price impact (114 shares).
4. **Time passes.** Scrub forward two days. "Days that have passed grey out and drop away. The odds on the days left go up, and so does your window's value."
5. **News.** "The vet says 'any day now'. Traders pile into the next few days, and your window jumps." The cash-out figure is at its high.
6. **Your choice.** "Cash out now for 48 VCR, or hold for 114?" Both branches can be scrubbed.
7. **Locked.** "Inside the last day before now, a window can't be bought or sold. That stops anyone trading on what they've just seen."
8. **It happens.** Day 7, 3 a.m. "Windows that contain the moment pay 1 VCR per share. You win 114 VCR." If they cashed out: "You locked in 48 VCR early."

(The figures are placeholders until the script is run through the reference model.)

## Onboarding

A judge should go from opening the link to holding a position in under 60 seconds, without installing anything or seeing the words "seed phrase", "SOL" or "devnet".

1. **Browse first.** Markets, the band and the drag-to-select all work signed out.
2. **Sign in at the moment of buying** with email or Google, via a **Privy** embedded wallet (free Developer tier). The wallet is created silently.
3. **Starting balance.** A server-side job sends 100 VCR to every new wallet on sign-up, minted by the server using the platform's mint authority.
4. **No SOL needed.** The server is the fee payer on every transaction: it builds the transaction, the user's wallet signs it without sending, and the server adds its signature and submits it. The server also pays rent: it is the `payer` when a `Position` account is created and when the user's token account is created during the sign-up airdrop. `claim` returns the position's rent to the fee payer. Use Solana's native fee payer, not Privy's paid gas sponsorship.
5. **First buy.** The buy sheet is already open with their chunk; one tap confirms.

Balances show as plain amounts ("100.00") with a small "test money" label, so judges never wonder whether it's real. Users with an existing Phantom or Solflare wallet can still connect it instead.

**Done when:** a stopwatch test from link to first position takes under 60 seconds on a phone, three times in a row.

## Market integrity (roadmap, not built)

Specced so the design is ready, but none of this is needed for the demo: the flagship won't see a birth during judging, and the fast market is resolved on camera. The prototype's `resolve` simply records the winning atom.

**Halt on first report**

- **`halt` instruction (admin):** called on the first credible report of the event. Market status becomes halted, and buys, sells and `advance_time` are all rejected. That stops the winning atom being pruned while the 5-of-10 quorum is pending, and stops holders selling positions they know are worthless. Records the halt time. Admin can lift it after a false alarm; the market reopens and `advance_time` catches up. `resolve` then runs from open or halted.
- **Market account:** status (open / halted / resolved / void) and halt time.
- **App:** while halted, every position is greyed and the market shows "Event happened, confirming date".

**Void if it already happened**

- **Rule:** if the event happened before the market opened, the market is voided (flagship: the birth; fast market: the staged event).
- **`resolve`** can mark the market void instead of recording a winner.
- **Position account** records the net amount paid (stakes including fees, minus net cash-out proceeds).
- **`claim`** on a void market refunds that amount, never below 0.
- **Fees stay in the vault until the market resolves**, so refunds can include fees. Refunds come from traders' stakes plus the subsidy, which covers anyone who cashed out at a profit before the void.

**AI halt watcher**

A small server script, using one model, that watches for the flagship event around the clock so the market halts promptly. It can only halt.

- **Key:** the market gets a separate halt-authority key that can call `halt` and nothing else, and the watcher holds it. If the watcher is wrong, compromised or prompt-injected, the worst outcome is a pause that admin lifts.
- **Loop:** every few minutes, ask the model to search the 10 resolution outlets for a report that the event has happened. On a credible report, call `halt` and notify admin with the links it found.
- **Low bar on purpose:** one credible report from any of the 10 is enough to halt, because a false halt costs a pause and a missed one costs the LP.
- **Resolution stays manual:** admin checks the 5-of-10 quorum and calls `resolve`.
- **Cost:** must run on a free model API tier (e.g. Gemini's free tier; check its current terms). Poll only as often as the free quota allows.

## Week-by-week plan

The maths comes first and gets the most testing; the frontend is quicker and comes later.

| Week | Build | Done when |
| --- | --- | --- |
| 1 | Off-chain reference model of LMSR, ranges, pruning and fees; fixed-point exp/ln; segment tree with lazy multiply; property tests. Create the VCR mint. Set up Privy (free tier) and prove email sign-in plus a first buy where the server pays fees and rent. Apply to the Actions registry. | On-chain maths matches the reference within rounding on 10,000 random trades; a test user signs in by email and opens a position from a wallet that has never held SOL |
| 2 | Anchor program: all seven instructions, accounts, fee ledger, locked zone, live edge. Devnet deploy. Fee-payer server and sign-up airdrop. Trader-bot script. | Both demo markets live with bot trading; vault invariant holds after every instruction; new sign-ups receive 100 VCR automatically |
| 3 | Web app: home, timeline band, drag-to-select, buy sheet with sign-in at the point of buying, positions with cash-out, claim, share link. Practice mode (scripted, simulated, scrubbable). | Link to first position in under 60 seconds on a phone, three times in a row |
| 4 | One-command setup script and README. Seed markets. Demo video (~2:25). Rehearse. | A stranger can run the repo from the README; the demo script runs end to end twice without intervention |

If anything overruns, cut in this order: sub-range sells (already a stretch goal), then the option to connect an existing wallet. Never cut onboarding: it's a judging criterion.

## Demo script

About 2:25 on one phone, two markets. The submission minimum is 2 minutes and the maximum 4, so this leaves margin either side. If the video uses the news-broadcast framing, these beats become its segments.

1. **The need (20s).** "Fans already argue about when things will happen. Veleda lets you stake your call and get credit for it."
2. **First call in under a minute (25s).** Open the link on a phone, drag to a month two years out (in the flagship's peak), tap Buy, sign in with email, and the position appears. Show a stopwatch on screen.
3. **Any width (15s).** Drag a 20-day chunk and watch the multiplier fall as the chunk widens. Same trade, any width.
4. **Share it (20s).** Tap "Share this window as a link" and open it on a second phone: it lands on the same window, ready to buy.
5. **Time passes (25s).** Switch to the fast market, move its clock offset forward a few hours and call advance time: elapsed hours grey out and the cash-out figure climbs. Cash out for a profit.
6. **Resolution (20s).** Resolve inside the remaining chunk; the marker drops onto the timeline; claim.
7. **Why Solana (20s).** One account holds the whole timeline; every trade costs the same whatever the width; every payout is fully backed on-chain.

Practice mode isn't in the script above. If there's time, a few seconds of it after beat 1 can show the whole flow fast, clearly labelled as practice. The on-chain fast market stays in beats 5–6 as the proof that it's real.

Record a backup video of the full run in week 4 in case devnet is slow on the day.

## Risks

| Risk | Mitigation |
| --- | --- |
| Fixed-point exp/ln is wrong or drains the vault through rounding | Reference model first; round costs up and proceeds down; property tests on random trades; vault invariant checked on every instruction |
| Privy's Solana wallet can't sign without sending, or doesn't work on devnet | Prove both in week 1 before building on it; fall back to standard wallet connect plus the airdrop if needed |
| A paid service creeps in (RPC, hosting, wallet provider) | Free tiers only: Privy Developer, devnet faucet SOL, free RPC and hosting tiers. Check before adding any service |
| First buy fails for a user with no SOL because they're asked to pay rent | Server key is the `payer` on every account the user's actions create; test with a wallet that has never held SOL |
| Compute limit exceeded on wide ranges or deep trees | Measured in week 1 on devnet with 732 atoms: trades 50,000–90,000 CU, market creation ~300,000 (needs a compute-budget request). See the build plan |
| Tree values overflow as shares grow | Periodic rescale of the whole tree by a constant |
| Account size or rent too high | Demo markets are small (≤ ~1,000 atoms); five-year hourly markets are a slide, not a build |
| Judges read it as gambling | Lead with fans and credit for your call; test tokens only; "test money" label in the app |
| Scope creep from the design spec | Anything in the "Out" column stays a slide until week 4 is done |

## Roadmap slide

What the design already answers but the prototype doesn't build, framed for judges' likely questions.

- **"Who provides liquidity?"** A single Veleda LP vault across all markets, with a transferable vault token, so LPs exit by selling the token and the pool never shrinks. Surplus capital is released as the worst case falls.
- **"What stops LPs being picked off?"** Depth grows with volume, so the long-shot phase is shallow and cheap to run; a fee that rises with volatility recovers part of any news jump; a higher fee near now prices late information. All rules depend on market data and time, never on platform judgement.
- **"What about insiders?"** Markets are listed by who controls the timing and resolve on the natural event (date of birth, not the announcement).
- **"Who decides the outcome?"** An optimistic oracle with bonded proposals and a dispute window. Already specced: halt on the first report (an AI watcher can trigger it around the clock) and void-if-already-happened with refunds.
- **"Can people trade where it's shared?"** Blinks: every shared window becomes a tradable card on X, built from one Solana Action.
- **Later features:** a daytime-only filter, permissionless market creation with review, native apps, mainnet after regulatory advice.

## Submission checklist

Track: Best Consumer App on Solana. Each item maps to a stated requirement or judging criterion.

- [ ] **Working demo on devnet:** both markets live and seeded, onboarding working on a phone
- [ ] **Repository** with a README covering what Veleda is, a screenshot, setup instructions and a one-command setup script (deploy the program, create the VCR mint, create and seed both markets, start the bots)
- [ ] **README section "How Solana powers Veleda":** one account holds the whole timeline as a segment tree; every trade costs the same whatever the chunk width; transactions are cheap enough for small, precise bets; embedded wallets and platform-paid fees remove onboarding friction
- [ ] **Demo video, 2–4 minutes** (target ~2:25), plus a backup recording of the live run
- [ ] **Clear user need** stated in the first 20 seconds of the video and the first line of the README
- [ ] **Ease of use:** the 60-second stopwatch test passes on the day
- [ ] **Name checks done:** domain, X handle, DexScreener/pump.fun, trademarks
