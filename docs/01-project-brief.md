# Veleda — Project Brief

Oct 12, 2026 · @Outsider Gaming

## What Veleda is

Veleda is a "when will it happen" prediction market on Solana, being built as a four-week prototype for the Colosseum hackathon's Best Consumer App track. Users buy any contiguous window of future time (an hour, a day, a month) as one trade; narrow windows are cheap and pay big, wide ones cost more and pay less. Positions can be cashed out at any time as the crowd moves. Named after a 1st-century Germanic seeress who predicted Rome's defeat ("VEL-eh-dah"); tagline "the market of seers". Earlier working names, now retired: Longshot, Twelvescore, Vatum.

## Decisions made

| Area | Decision |
| --- | --- |
| Market structure | Timeline split into atoms (hourly by default, daily where resolution is only day-precise); a window is equal shares in every atom of a range; plus a "not by end date" atom |
| Pricing | One LMSR per market; any range costs b · ln(1 − p + p·e^(x/b)); AMM chosen over parimutuel because entry price must reward early calls and cash-out must work |
| Trading | Buy and sell any time; positions cash out at live price; 72h locked zone after now (no buys or sells; every trade needs range start ≥ now + lock); max-cost / min-proceeds on every trade; roadmap only: admin halt on the first credible report (stops trading and pruning until the source quorum is met), and an AI watcher that triggers it |
| Time passing | Elapsed atoms pruned behind a lagged live edge; survivors renormalise; dead stakes become LP surplus |
| Opening prior | Set "not by end date" explicitly, optional earliest date; minimum price floor per atom; rest left flat for the market to shape |
| Fees | Flat 3.5% on buys and sells, taken out of the gross amount (the stake includes the fee; on a sell, the fee comes out of the proceeds): 2.5% LP, 1% platform; multipliers shown after fees and price impact; no creator share while markets are curated |
| Liquidity | Platform is the only LP and creates every market at launch; each market fully funded for its worst case b · ln(1 / lowest opening price); fixed b in the prototype: flagship 1,000 (subsidy ≈ 9,210), fast demo 100 (≈ 513) |
| Later liquidity design | Depth grows with volume; volatility-based fee; transferable LP vault token; capital release as exposure falls; pooled reserve with per-market cap (~5% of pool) and loss waterfall. No platform halts or reprices on news |
| Insider risk / listing | List by who controls timing (natural / institutional / one party); resolve on the natural event (date of birth, not the announcement); void the market if the event happened before it opened (refund each position's net amount paid, including fees; specced, not built for the demo) |
| Hackathon | Devnet, our own 6-decimal devnet mint `[TOKEN]` (name not chosen yet; configurable per market; not USDC); email sign-in with a Privy embedded wallet (free Developer tier; no paid services for the demo), platform-paid fees and rent, 100 test funds on sign-up; plain share links (Blinks are roadmap); ~2:25 demo video |
| Brand and UI | Name Veleda; logo is a gold engraved seeress on dark green-black; UI style is dark obsidian with copper (final — reskin options retired), Cinzel for wordmark, multiplier and main button, Manrope for body; square stippled timeline bars; button text "predict the future │ 20 [TOKEN]"; mockups show "USDC" as a placeholder for `[TOKEN]`; app copy says "window" not "chunk" |
| Timeline zoom levels | Year / Month / Day / Hour tabs. Month view uses thick, individually tappable bars (about 8 months on screen) with the month name on each bar and a per-month multiplier and percentage; Day and Hour use thin stippled bars |
| Buy sheet | No edit-window button; swipe the sheet down to return to the timeline and adjust the window |
| Positions screen | Total current value in `[TOKEN]` is the hero figure at the top (no label, no glow), with overall P&L, amount paid and count beneath; Open / Settled tabs; one card per position with live P&L, sparkline, paid / worth now (after fee) / if it lands, entry vs current odds, and a full-width copper "cash out │ amount" button; locked state for windows inside the 72h zone; bottom nav Markets / Positions / Account |

## Working documents

| Document | What it holds |
| --- | --- |
| Veleda — Hackathon Spec (`02-hackathon-spec.md`) | What gets built in four weeks: scope, demo markets, on-chain program, onboarding, week plan, demo script, risks, submission checklist |
| Veleda — Design Spec (`03-design-spec.md`) | Full design rationale: pricing maths, prior, pruning, trading, fees and LPs, listing policy, resolution, UX |
| Veleda App mockups (`../design/`) | Core flow in the final style: 1 · timeline (month view), 2 · dragging a window, 3 · buy sheet, 4 · your positions |

**Submission description** (latest draft): Veleda, the market of seers. Fans argue about when things will happen; Veleda turns those arguments into calls you can stake, share and get credit for. Buy any window from an hour to a year in one swipe; hold or cash out early. Solana points: the whole timeline lives in one account; every trade costs the same whatever the width; every payout fully backed on-chain; email sign-in with no crypto setup.

## Open questions and next steps

- [ ] Name checks: veleda.market (or .xyz / .app), X handle, DexScreener and pump.fun, UK/US trademarks
- [x] Flagship question: **"When will Taylor Swift's first child be born?"** Kept deliberately: she's the most recognisable celebrity, a birth is a clear natural-timing event, and it's the likely leading market on mainnet
- [x] Embedded-wallet provider: **Privy** (free Developer tier). Week 1: prove email sign-in on devnet and a first buy where the server pays both fees and rent, from a wallet that has never held SOL
- [x] Token: **our own devnet mint** (platform holds the mint authority); display name still to choose
- [x] Flagship b = **1,000**: a 20-token stake on a 6.1% window gives about ×13.9 (the mockups show ×15.8 without price impact), and about 48 tokens moves that window to 10.5%. Check by trading against the week 1 reference model
- [x] Flagship resolution source: date of birth as reported by **at least 5 of 10 credible outlets** (draft list: Associated Press, Reuters, BBC News, CNN, The New York Times, People, TMZ, E! News, Billboard, Variety). Finalise the list
- [x] Void-if-already-happened rule added to both specs
- [x] Late or missing reports: if fewer than 5 of 10 report a date, the bar isn't met and the market stays unresolved. No deadline, no fallback
- [ ] Tune the quorum: is 5 of 10 too strict or too loose?
- [ ] Confirm the remaining demo-market parameters (atom size, window)
- [ ] Mockups: board 1 is month view but board 2 is day view — align them or frame month as a separate zoom level; show the 72h locked state on a positions card again; off-screen "1 more position" marker; how held positions show in month view
- [ ] Pitch video (~2:25, news-broadcast framing) built around the demo script in the hackathon spec; show the swipe-down gesture on the buy sheet early
- [ ] Regulatory advice before anything beyond devnet (gambling, LP tokens)
