# Veleda — What we've built so far

Written 20 Oct 2026 as source material for the pitch deck; status updated 6 Nov 2026. Weeks 1–3 are done and week 4 is nearly done: the setup script, README, seeded markets and the demo video cut are finished, and the video needs its voiceover and render. Final submissions close 9 Nov 2026; we're submitting by 8 Nov.

> **For the deck writer:** everything below is built and working unless it's under "Not built yet" or "Roadmap". Figures are measured, not estimated, unless marked. Please don't present roadmap items as built.

## The one-liner

**Veleda, the market of seers.** Buy any window of future time in one swipe. Call when it happens, and cash out as the crowd moves.

Pronounced "VEL-eh-dah", after a 1st-century Germanic seeress who predicted Rome's defeat. Never shorten it to "Veda" (that's an existing Solana DeFi protocol).

## Hackathon context

- **Event:** Encode Club Solana Hackathon, **Best Consumer App on Solana** track (12 Oct – 9 Nov 2026). Prize: accelerator places.
- **Judging criteria:** clear user need and adoption potential · ease of use, including onboarding · technical execution and meaningful use of Solana · a working end-to-end experience.
- **Requirements:** working devnet demo · repo with README and setup · 2–4 minute video · a clear explanation of how Solana powers the project.

## The problem and the audience

Fans already argue about *when* things will happen: when the album drops, when the baby's due, when the band reunites, when BTC hits a number. Those arguments have no stakes, no record and no credit for the person who called it early.

Existing prediction markets ask yes/no questions ("Will X happen by date Y?"). A "when" question becomes a pile of separate yes/no markets, each with thin liquidity, and you can't back "sometime in March next year" as one bet.

- **Audience:** pop-culture fans and crypto-native communities.
- **Need:** bragging rights with something at stake.

## The product

- A market is one question about **when** something will happen, shown as a vertical **timeline** of the future (now at the top).
- Bars on the timeline show the crowd's odds for each slot (hour, day or month); wider bar = more likely.
- **Press, hold and drag** to select any contiguous **window**: one hour, one day, a month, a year. Narrow windows are cheap and pay big; wide windows cost more and pay less. A floating tag shows the length, odds and payout multiplier as you drag.
- Release to open the **buy sheet**: multiplier (after fees and price impact), crowd odds, stake chips 5 / 20 / 50 / Other, and one button: **"predict the future │ 20 VCR"**.
- **Cash out at any time** at the live price. No waiting for the event, no counterparty needed.
- As time passes, elapsed slots grey out and drop away, and the remaining slots get more valuable. If your window is still alive, its value climbs.
- **Share a window as a link.** A friend opens it and lands on the same window, ready to back it.
- A **"not by end date"** option at the bottom of the timeline covers "it won't happen in this market's lifetime".

### The two live markets

| | Flagship | Fast demo market |
| --- | --- | --- |
| Question | "When will Taylor Swift's first child be born?" | "When will BTC first hit $200,000?" (tagged "Fictional · 2028") |
| Timeline | 3 years, 1,096 daily slots | 1 week (from 12 June 2028), 168 hourly slots |
| Resolves | On the date of birth (not the announcement), as reported by at least 5 of 10 named outlets (AP, Reuters, BBC, CNN, NYT, People, TMZ, E!, Billboard, Variety) | Live, on camera, by the admin |
| Locked zone | 72 hours | 1 hour |
| Market subsidy | 9,210 VCR | 513 VCR |
| Purpose | Shows a real consumer market with a shaped opening forecast | Lets the demo show time passing, cash-out and resolution in minutes |

Example: on the flagship, a 20 VCR stake on a window the crowd gives 6.1% pays about **×13.9** if it lands (after the 3.5% fee and price impact).

## What's live today

**Live app:** https://veleda-veleda1.vercel.app (mobile web app, installable to the home screen as a PWA)
**Repo:** https://github.com/OutsiderGaming/veleda (going public for judging)

| Built | Detail |
| --- | --- |
| On-chain program (Solana devnet) | Anchor program with all seven instructions: `create_market`, `buy_range`, `sell_range`, `advance_time`, `resolve`, `claim`, `set_clock_offset`. Program ID `7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx` |
| Both markets | Created on devnet and fully funded |
| Our own currency | **Veleda Credit (VCR)**, a devnet test token with on-chain name and symbol. Every new user gets 100 VCR on sign-up. Labelled "test money" in the app |
| Onboarding | Email or Google sign-in via Privy; a Solana wallet is created silently. No seed phrase, no wallet install, no SOL needed: the server pays every network fee and account deposit |
| Web app screens | Home (market cards with total traded and a mini timeline) · Timeline with Year / Month / Day / Hour zoom · drag-to-select · buy sheet · Positions (total value, P&L, Open / Settled tabs, cash-out on every card, claim after resolution) · Account · share links |
| Practice mode | An interactive tutorial ("When will Luna the cat have her kittens?"): a scripted, simulated market you scrub forwards and backwards through time. Same maths as the real thing, no sign-in, clearly labelled "Practice · simulated prices" |
| Trader bots | Five bots trade both markets every 30 minutes on GitHub Actions, so the timelines have real shape and history |
| Admin tools | Scripts to move the fast market's clock forward, prune elapsed time and resolve, for the live demo |

## Proof points (measured)

- **First position in 59 seconds** from page load, sign-in included, from a brand-new account with 0 SOL (13 Oct). The phone stopwatch test (share link → position, three fresh accounts in a row, each under 60 s) passed on 14 Oct. Almost all of that time is typing the email and the one-time code.
- **Maths verified twice:** a TypeScript reference model and the on-chain Rust maths were cross-checked on **26,000 random trades**: same accepts and rejects, prices within 1e-10, the program never charges less or pays out more than the reference.
- **Every trade fits Solana's default compute budget**, whatever the window width: on the 3-year flagship, buying 1 day costs ~70K compute units, 31 days ~81K, 700 days ~100K (limit 200K).
- **Fully backed:** every instruction checks that the vault holds enough to pay the largest possible payout. 17 on-chain tests (LiteSVM) cover every instruction and rejection path, with this check after every step, including a user with zero SOL buying and cashing out.
- **No paid services:** everything runs on free tiers (Privy Developer, Vercel Hobby, GitHub Actions, devnet).

## How Solana powers Veleda

- **One account holds the whole timeline.** Each market is a single on-chain automated market maker (an LMSR, the logarithmic market scoring rule) that prices every slot at once. Prices live in a segment tree inside one account.
- **Any window is one trade at near-constant cost.** Buying a window is a lazy range update on the tree, so a one-hour window and a one-year window are both a single atomic instruction (measured above: ~70K–100K compute units).
- **Always a counterparty.** The market maker is always on the other side, so there's no order book and no waiting: enter early at long-shot odds, cash out whenever you like.
- **Every payout fully backed on-chain.** Each market is funded for its worst case at creation, and the program enforces the vault check on every instruction. Costs round up, proceeds round down, so rounding can never drain the vault.
- **Cheap and fast enough for small, precise calls**, like 5 VCR on a single day.
- **Invisible crypto.** Embedded wallets plus a server fee payer (Solana's native fee-payer field) mean users sign in with email and never see SOL, gas or seed phrases.

## The maths in plain words

- The timeline is cut into slots, plus a "not by end date" slot. Exactly one slot wins; each share in it pays 1 VCR.
- A window is the same number of shares in every slot of a range. Its price is the crowd's combined odds for that range.
- When people buy a window, its price rises and the rest of the timeline falls. Prices always add up to 100%.
- When time passes, elapsed slots are zeroed and the rest renormalise, so a surviving window gains value.
- **Locked zone:** no trading on slots within 72 hours of now (1 hour on the fast market), so nobody can trade on news that's already out.
- **Fees:** a flat 3.5% on buys and sells (2.5% to liquidity, 1% to the platform). The multiplier shown is always after fees and price impact.

## Look and feel

Dark obsidian with copper; logo is a gold engraved seeress on dark green-black. Cinzel for the wordmark, multipliers and the main button; Manrope for body text. Timeline bars are square-ended and stippled copper.

| Role | Colour |
| --- | --- |
| Background | `#0D0F0E` |
| Card / sheet | `#151816` |
| Text | `#EDE4D6` (secondary `#BFB5A5`, muted `#8E8577`) |
| Copper accent | `#E9A867` (light `#F6C792`) |
| Primary button | gradient `#F2BE84 → #D08D4B` |
| Gain / loss | `#9CCB8E` / `#E8907A` |

Screens worth using in the deck: timeline (month view), dragging a window, buy sheet, positions with cash-out, practice mode. Mockups are in `design/screens/`; real-app screenshots still to be taken.

## The demo video (about 3:10)

The script and how it's built are in `docs/08-demo-run-sheet.md`; the video project is `videos/veleda-demo`.

1. **The problem:** prediction market volume is up about 20 times in a year, but "when" questions get a few fixed yes-or-no deadlines. Veleda is one market for the whole timeline.
2. **The whole flow, as it works at launch** (a real phone take, labelled as devnet with test money and a simulated payment): browse signed out, drag a window, sign in with Google, add money, the call places itself, a second call, time passes, cash out at a profit, the event resolves and the claim pays.
3. **Why Solana:** the whole timeline in one account as a tree of prices; five years of hours would fit in 3.5 MB; any window is one atomic trade at similar cost.
4. **Liquidity providers (roadmap):** capped, known maximum loss, opening odds set by the provider, 2.5% of every buy and sell.

The stopwatch beat was dropped: the real-money flow includes an ID check, so "under a minute" holds only for the free-credit path on the normal site. The share link was dropped from the video to save time; it's still in the app.

## Not done yet (before submission)

- The demo video's voiceover and render (the cut is done; the raw phone take is the backup recording).
- A clean fast market for judges, created as close to submission as possible.
- Connecting an existing wallet (Phantom, Solflare) is a stretch goal; the demo uses email/Google sign-in only.

## Roadmap (designed, not built)

Good material for a "what's next" or "judges' questions" slide:

- **Liquidity:** one shared Veleda LP vault across all markets with a transferable vault token; market depth that grows with volume; a fee that rises with volatility; surplus capital released as each market's worst case falls.
- **Resolution:** an optimistic oracle with bonded proposals and a dispute window. Also specced: halt trading on the first credible report (with an AI watcher that can only pause, never resolve), and void-with-refunds if the event happened before the market opened.
- **Insider risk:** markets are listed by who controls the timing, and resolve on the natural event (date of birth, not the announcement).
- **Sharing:** Solana Blinks, so a shared window becomes a tradable card right on X.
- **Later:** permissionless market creation with review, baskets of several windows in one tap, native apps, and mainnet only after regulatory advice.

## Honest caveats

- Devnet only, with test money (VCR). Nothing here is real-money gambling; the app labels every balance "test money".
- The platform is currently the only liquidity provider and resolves markets by hand.
- The BTC market is a fictional 2028 scenario so the demo can resolve on camera.
- The "about 16 tree nodes per trade" figure in earlier drafts is a design estimate, not yet measured. Use the compute-unit figures above instead.

## Team and process

Built by Outsider Gaming over four weeks, spec-first: a reference model and maths in week 1, the on-chain program in week 2, the app in week 3, shipping in week 4. Roughly 80 commits so far.
