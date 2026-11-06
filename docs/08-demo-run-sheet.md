# Veleda — Demo run sheet

Written 4 Nov 2026. The problem, one new user start to finish, why Solana, and liquidity providers, in about 3:30 to 3:45 (the limit is 2–4 minutes). Live app: https://veleda-veleda1.vercel.app

## Before each take

Run every command from the repo root.

1. **New market if needed.** A market can't be rewound, so a take that moved the clock or resolved needs a new one:
   1. `node scripts/create-markets.ts fast`
   2. Paste the new `markets.json`, compacted to one line, into `MARKETS_JSON` on Vercel (type: config).
   3. Commit and push `markets.json`, which redeploys the app and points the bots at the new market.
   4. Check `/api/markets` shows the new address.
2. **Give it shape.** A new market starts flat. Run `node scripts/bots.ts --rounds 10 --interval 15` (on a slow devnet day, stop it once the market shows a few hundred traded). Then run `node scripts/demo/early-buy.ts`: a bot stakes 70 on the first two days, so those hours carry weight, and when they drop away at f6 window A shows a clear profit. Without it, the bots leave the first two days nearly empty and window A cashes out at a loss.
3. **Pause the scheduled bots** so prices hold still: `gh workflow disable bots.yml`. Turn them back on afterwards with `gh workflow enable bots.yml`.
4. **Check the market:** `node scripts/admin.ts fast status` should say `open`, with a clock on 12 June 2028.
5. **Prepare the phone.** Use a **normal tab, never a private one**, because private tabs can stop the wallet connecting. Sign in with a Google account that's new to Veleda, or delete a throwaway test user in the Privy dashboard so it counts as new.
6. **Open** https://veleda-veleda1.vercel.app/?preview=launch and sign out if needed. A new account starts at $0 here, with no free credits.

## The script

About 3:30 to 3:45 in total at a natural pace (the limit is 4:00). Times in the tables are approximate, and `build.mjs` sets the real ones. The VO column is the narration. Parts 1, 3 and 4 are generated graphics. Part 2 is the phone recording.

### Part 1: the problem (0:00–0:40)

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | Volume figures climbing | Prediction markets are exploding. Kalshi and Polymarket went from about a billion dollars of trading a week in September last year to nearly twenty billion a week this September. |
| 0:12 | Mock of a typical market, labelled "Illustration": "BTC hits $200K by…?" with fixed dates, each with Yes and No | But ask them *when* something will happen, and you get this: a handful of fixed deadlines, each its own yes-or-no bet. Think it lands in the second week of June? There's no button for that. |
| 0:28 | The deadlines dissolve into one continuous timeline. A finger drags a window across it | Veleda has one market for the whole timeline. You buy any stretch of time: an hour, a week, a year. One trade, at one live price. |

### Part 2: the whole flow, as it works at launch

The label "How it works at launch. Shown on devnet: test money, simulated payment. Launch depends on licensing." stays on screen for the whole part. There is no stopwatch: the first deposit includes an ID check that takes minutes, so "under a minute" would not be true of this flow. It still holds for the free-credit path on the normal site.

| Beat | On screen | Do this | Voiceover |
|---|---|---|---|
| f1 | Fast market (tagged Fictional · 2028) | Open https://veleda-veleda1.vercel.app/?preview=launch signed out, and browse | Here's someone who has never used Solana. They open a link and can browse without an account. This is how Veleda will work at launch, shown here on devnet with test money and a simulated payment. The market is a fictional one we can run at speed: when will BTC first hit two hundred thousand dollars? |
| f2 | **Window A: 14 June, midday to 6pm**, stake $20 | Drag, tap "predict the future", sign in with a Google account new to Veleda | They drag across a stretch of time and make the call. One Google sign-in creates their wallet. There's no seed phrase, and they never need to buy SOL, because Veleda pays the network fees. |
| f3 | Add money: $50 → identity → payment | The sheet opens by itself. Go through it | Then they add money, by card or mobile wallet. The first deposit includes an ID check from our payment partner, which can take a few minutes, and only happens once. The money arrives as USDC in their own wallet, shown simply as dollars. |
| f4 | Success screen | Tap Done. The call places itself | And their call goes straight through, with no second tap: twenty dollars on that window. |
| f5 | **Window B: 15 June, 6am to midday**, stake $20 | Buy it, then open Positions | Now a second call. Narrow windows pay more and wide ones are safer, but either way it's one trade. |
| f6 | Terminal, then Positions | Run `node scripts/admin.ts fast clock +2d`, wait for the update | As time passes, hours drop away, the ones left become more likely, and the cash-out value moves. |
| f7 | Positions | Cash out window A | No waiting for the event, and no waiting for a buyer. The market maker always quotes a price, so they sell and take the profit. |
| f8 | Terminal, then Positions | Run `node scripts/admin.ts fast clock +1d`, then `node scripts/admin.ts fast resolve 2028-06-15T09:00Z`, then tap Claim on window B | Then the event happens. The winning hour is recorded on-chain, and window B contains it, so it pays out to their balance. |
| f9 | Account | Show "Withdrawing, at launch" | From there, they can send it to their bank through our payment partner, or send USDC to any wallet. |

### Part 3: why Solana (2:35–3:05)

| Time | On screen | Voiceover |
|---|---|---|
| 2:35 | One block labelled "one account", opening into a tree | So how does one market price every hour? On Solana, the whole timeline lives in a single account, as a tree of prices. |
| 2:43 | Zoom down the tree to individual hours, then back out to the whole market. Counter: 43,800 hours · 16 levels · 3.5 MB of 10 MB | Five years of hours is about forty-four thousand slots, and that fits too: three and a half megabytes, inside Solana's ten-megabyte limit. |
| 2:53 | A window lights up one high branch, not every leaf. Figures: 1 day 70K, 700 days 100K compute units | Buying a window updates a few branches, not every hour beneath them. On our live three-year market, a day or nearly two years is one atomic trade, at similar cost and low fees. |

### Part 4: liquidity providers (3:05–3:30)

| Time | On screen | Voiceover |
|---|---|---|
| 3:05 | Curve with a shaded "maximum loss" floor | Today the platform funds every market. Next, we open that to liquidity providers. Their maximum loss is known and funded up front. |
| 3:13 | LP drags the opening curve. Fees tick up as trades go through | They'll set the opening odds, so a provider who knows the market better gives away less to the first traders, and they earn two and a half percent of every buy and sell. It isn't guaranteed profit, and the risk is real, but it's capped and it's priced. |
| 3:26 | The timeline again, with a window moving and resizing. "A new form of prediction market", "Any increment", "Whenever they want" | And that's Veleda, a new form of prediction market where users can buy and sell future time, in any increment they want, whenever they want. |
| 3:36 | Logo, "the market of seers" | Veleda. The market of seers. |

### Graphics notes

- **Roadmap:** part 4 is not built, and the voiceover says "next". The five-year market in part 3 isn't live either. See below.
- **The mock market** is our own neutral illustration, with no Polymarket or Kalshi branding or logos and with made-up prices. Check it against a live page before recording.

### Checks for part 1 and part 3 claims

- **Volume figures:** Kalshi and Polymarket combined, the same week a year apart. 11–17 Sept 2025: Kalshi over $500M and Polymarket $430M, so about $1bn (Dune data, reported by CoinDesk on 20 Sept 2025). 21–27 Sept 2026: $19.46bn across Kalshi, Polymarket US and Polymarket International (DeFi Rate, updated 18 Oct 2026). The two sources count volume differently, so treat the 20 times as approximate.
- **Five-year account size:** 3,496,520 bytes from `market_account_len` for 43,824 hourly atoms (tree capacity 65,536, so 16 levels). Earlier docs say 1–2 MB, which is out of date. Rent would be about 24 SOL.
- **Five years fits, but doesn't run yet.** `MAX_ATOMS` is 1,500, `create_market` builds prices on the heap, and each trade walks every live atom for its largest-payout check. Trading at that size needs a max-tree for liabilities and staged initialisation, so don't say it's live. The 70K–100K figures are measured on the 3-year daily market only.

## Building the video

The project is `videos/veleda-demo`, and all timing comes from its audio files.

1. Record one continuous take, then run `sh cut-footage.sh <take.mov>`, which cuts it into `footage/f1.mp4` to `f9.mp4` (times are set for the 6 Nov take; it also blurs the Google account chooser). The footage is gitignored. A clip plays sped up, at most 1.6 times, to fit its beat, and a beat grows when its clip needs more time. Save your voice as `voice/final/<beat>.wav`. The beat IDs are in `build.mjs`. Without a final voice file, a beat uses the scratch voice.
2. Run `node build.mjs`, which regenerates the timing, captions and scenes. Don't hand-edit `index.html` or `compositions/`.

## Expected figures

Rehearsed on 6 Nov on market `CYMNhpJi…` after the bots and the early buy: window A about 15.08 right after buying, about 25.61 after +2d; window B pays about 196. The table below is the older estimate from 4 Nov, before bot trading had shaped that market. They ignore window B's effect on window A. **Check them in the rehearsal**, because bots and window choice change them.

| Clock jump | Window A, bought with 20 | Result |
|---|---|---|
| Right after buying | about 18.60 | Below the stake, because of the 3.5% fee on each side |
| +1 day | about 20.95 | Small gain |
| +2 days | about 23.80 | Clear gain, which is why the take uses +2d |

If window A doesn't show a clear profit, make the first jump larger, but keep its start more than an hour ahead of the market clock, or it locks and can't be sold.

## Things to keep right

- **Times:** resolve commands use UTC, while the app shows the viewer's local time. 09:00 UTC falls inside window B in UK summer time too, so the claim still pays.
- **Clock:** a market lasts 7 days at most from creation, and every jump shortens that.
- **Resolving is final.** Don't run it until window A is cashed out.
- **Updates lag:** the market screen updates within about 10 seconds and Positions within about 15. Trim the wait in the edit.
- **Label the simulation:** keep the preview label in shot during the deposit. The voiceover says the market runs at speed, and the video labels the clock "Demo clock, sped up".
- **Clock versus windows:** the market clock runs in real time from creation. Run `node scripts/admin.ts fast status` before the take: window A must still start more than an hour ahead of the clock after the +2d jump. Otherwise re-create the market or pick later windows.

## After recording

1. Upload the main video and keep a backup recording.
2. Create one last clean market (step 1 above) for judges, as close to submission as you can. It expires after about 7 days, so reset it if judging runs longer.
3. Turn the scheduled bots back on.
4. Paste `docs/05-submission-copy.md` and the video link into the submission form by 9 Nov.
