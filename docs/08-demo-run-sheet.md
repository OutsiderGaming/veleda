# Veleda — Demo run sheet

Written 4 Nov 2026. One new user, one market, start to finish, in about 3:10 (the limit is 2–4 minutes). Live app: https://veleda-veleda1.vercel.app

## Before each take

Run every command from the repo root.

1. **New market if needed.** A market can't be rewound, so a take that moved the clock or resolved needs a new one:
   1. `node scripts/create-markets.ts fast`
   2. Paste the new `markets.json`, compacted to one line, into `MARKETS_JSON` on Vercel (type: config).
   3. Commit and push `markets.json`, which redeploys the app and points the bots at the new market.
   4. Check `/api/markets` shows the new address.
2. **Give it shape.** A new market starts flat. Run `node scripts/bots.ts --rounds 10 --interval 15`.
3. **Pause the scheduled bots** so prices hold still: `gh workflow disable bots.yml`. Turn them back on afterwards with `gh workflow enable bots.yml`.
4. **Check the market:** `node scripts/admin.ts fast status` should say `open`, with a clock on 12 June 2028.
5. **Prepare the phone.** Use a **normal tab, never a private one**, because private tabs can stop the wallet connecting. Sign in with a Google account that's new to Veleda, or delete a throwaway test user in the Privy dashboard so it counts as new.
6. **Open** https://veleda-veleda1.vercel.app/?preview=launch and sign out if needed.

## The take

| Time | On screen | Do this | Voiceover |
|---|---|---|---|
| 0:00 | Home, the flagship timeline | Scroll slowly | Fans argue about when things will happen: when the album drops, when the baby's due, when BTC hits a number. Those arguments have no stakes and no record of who called it. Veleda turns them into calls you can stake, share and get credit for. |
| 0:25 | Fast market (tagged Fictional · 2028) | Start the on-screen stopwatch | Here's someone who has never used Solana. They've opened a link, and they can browse without an account. This market is a fictional scenario we can run at speed: when will BTC first hit two hundred thousand dollars? |
| 0:40 | **Window A: 14 June, midday to 6pm**, stake 20 | Drag, tap "predict the future", sign in with Google, wait | They drag across any stretch of time and make the call. One Google sign-in, and that's it. Behind the scenes, Veleda creates their wallet, gives them free test credits and pays the network fee. There's no seed phrase, and they never need to buy SOL. |
| 1:05 | Success screen | Stop the stopwatch | First position, in under a minute. |
| 1:10 | Add money: $50 → identity → payment | Tap "Add real money (preview)" and go through it | This next part is a preview of launch, with the payment simulated. You'd pay by card or mobile wallet, and it arrives as USDC in your own wallet, shown simply as dollars. The first deposit includes a standard ID check from our payment partner, and then you're in. |
| 1:35 | **Window B: 15 June, 6am to midday**, stake $20 | Buy it, then open Positions | Now a second call. Narrow windows pay more and wide ones are safer, but either way it's one trade on one on-chain market maker. |
| 1:50 | Terminal, then Positions | Run `node scripts/admin.ts fast clock +2d`, wait for the update | Now time passes. We're moving this demo market's clock with an admin control, which real markets don't have. Elapsed hours drop off the timeline, the remaining ones become more likely, and the cash-out value moves. |
| 2:10 | Positions | Cash out window A | No waiting for the event, and no waiting for a buyer. The market maker always quotes a price, so they sell and take the profit. |
| 2:20 | Terminal, then Positions | Run `node scripts/admin.ts fast clock +1d`, then `node scripts/admin.ts fast resolve 2028-06-15T09:00Z`, then tap Claim on window B | Then the event happens. The winning hour is recorded on-chain, and window B contains it, so it pays out. Every payout was backed by the market's vault from the start. |
| 2:40 | Window share link on a second device, or a diagram | Open a shared link | Any window can be shared as a link that opens straight onto it, so a friend can back the same call. |
| 2:50 | Diagram of one account holding the timeline | | Here's why Solana. The whole timeline lives in one account, as a tree of prices. Buying a day or nearly two years is one atomic trade, from about 70 to 100 thousand compute units, and fees are low enough for small, precise calls. Veleda: the market of seers. |

## Expected figures

These are estimates from the LMSR formulas using the fast market's prices on 4 Nov, before bot trading had shaped it. They ignore window B's effect on window A. **Check them in the rehearsal**, because bots and window choice change them.

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
- **Label the simulation:** keep the preview label in shot during the deposit, and describe the clock as an admin control, as the voiceover does.

## After recording

1. Upload the main video and keep a backup recording.
2. Create one last clean market (step 1 above) for judges, as close to submission as you can. It expires after about 7 days, so reset it if judging runs longer.
3. Turn the scheduled bots back on.
4. Paste `docs/05-submission-copy.md` and the video link into the submission form by 9 Nov.
