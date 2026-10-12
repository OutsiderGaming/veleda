# Veleda — Design Spec

Oct 9, 2026 · @Outsider Gaming
Source: https://claude.ai/code/artifact/3672ca32-6da5-42de-b3cf-74fc3a82e672 (exported 12 Oct 2026)

> Note: this spec uses £ in its worked examples. The prototype runs in a USD-pegged test token (see the hackathon spec), so read £ as "1 unit of the market's currency".

## Overview

Veleda is a "when will it happen" prediction market for distant calls rather than resolution races: the timeline is split into hourly atoms, one LMSR prices them all, and any contiguous chunk is a single bundled trade that can be bought, partly sold or cashed out at any time.

It replaces the earlier pin-and-distance design, which needed a tuned multiplier to reward early calls. Here the entry price already records how bold a call was: a month bought two years out costs pennies; the same month the week before costs far more. No scoring curve is needed.

The narrower the chunk, the cheaper it is and the higher the multiplier. A single hour is the maximum-leverage bet; a month is broad coverage with less upside. At fair prices both have the same expected value per pound; narrow chunks only add variance.

## Market structure

Each market is a fixed grid of mutually exclusive atoms, exactly one of which wins. Every share pays £1 if its atom wins.

- **Atoms.** Hourly by default. Atom size is a per-market setting and must be no finer than the resolution source can reliably settle (a birth date reported to the day → daily atoms).
- **Chunks.** A chunk is x shares in every atom of a contiguous range, so it pays the same wherever in the window the event lands. A month is about 720 hourly atoms bought in one trade; its price is the sum of their prices, so months, days and hours can never contradict each other.
- **Equivalence.** Because LMSR cost depends only on final share totals, buying x shares of 720 hours one by one costs the same as one month-sized trade (ignoring fees and others trading in between). This holds for equal shares, not equal money.
- **"Not by end date" atom.** A final atom for the event not happening inside the market window. It is priced explicitly at creation, never left to a flat prior.
- **Positions** are stored as (range, amount), so holders can sell a sub-range and split the position.

Scale: five years of hourly atoms is about 43,800 atoms; a 90-day hourly market is about 2,160.

## Pricing (LMSR)

One LMSR quotes every atom from the first second. It tracks shares sold per atom (qᵢ) and charges by a cost function; b sets liquidity.

```latex
C(q) = b \ln \sum_i e^{q_i / b} \qquad p_i = \frac{e^{q_i/b}}{\sum_j e^{q_j/b}}
```

Prices are always positive and sum to £1. A trade costs C(after) − C(before). Buying x shares of a range currently priced at p:

```latex
\text{cost} = b \ln\left(1 - p + p\,e^{x/b}\right)
```

**There is no fixed supply.** Nobody can buy out an atom; each extra share costs more and the price approaches £1 without reaching it. Depth is the slope, set by b. Example at b = £1,000 for an atom opening at 0.2%:

| Push price to | Cost | Shares | Payout if it wins |
| --- | --- | --- | --- |
| 1% | £8 | 1,617 | £1,617 |
| 10% | £103 | 4,015 | £4,015 |
| 50% | £691 | 6,213 | £6,213 |

- **Atom size doesn't thin liquidity.** Cost depends only on the range's total probability and b, not how many atoms it contains.
- **Thin parts of the band give higher multipliers, not better odds.** Cheap atoms move fast in money terms, so the multiplier decays quickly with stake size. The buy sheet shows the effective multiplier for the user's stake.
- **Cheap atoms are cheap to manipulate visually** (about £100 takes 0.2% to 10%). Mitigations: allow selling/shorting so anyone can push back, and show the money behind a price next to it.
- **Worst-case house loss** is b · ln(1/p₀) for the winning atom; with a flat prior that is b · ln(n) ≈ £10.7k at b = £1,000 for 43,800 atoms. No per-atom supply caps are needed.
- **b over time.** Fixed per market for the hackathon. Later: step increases by volume milestones or LP deposits (scale all q with b so prices don't move). Liquidity-sensitive LMSR is not recommended until its margin bound is checked at this atom count (Othman et al.).

## Opening prior

Set three things and let the market shape the rest. A market maker must quote every atom from the start, so "no prior" means a flat prior.

If the market corrects a prior p₀ to the true distribution p*, the market maker's expected loss is b · KL(p* ‖ p₀), paid to the first traders who correct it. For a pregnancy-style market at b = £1,000 over five years:

| Wrong part of a flat prior | Approx. cost |
| --- | --- |
| "Not by end date" at 0.002% when it's ~40% | ~£3,900 |
| Night hours priced like daytime hours | ~£400 |
| First 3 months priced like any other 3 months | ~£100 |

Set at creation:

1. **"Not by end date"** priced explicitly.
2. **Daily pattern** applied automatically (night hours cheaper). The market won't fix this on its own: the edge is spread over every day and there's no single trade for "daytime, every day".
3. **Earliest plausible date** (optional, one number), so early casual users don't overpay for impossible windows.

Also apply a minimum opening price per atom; it caps the house's worst case. Leave the rest flat: the visible correction bounty draws sharp traders on day one and the band forming live is a good demo. Label the band "Opening estimate" until enough has traded.

Roadmap: copy priors from existing Polymarket/Kalshi markets; creator-funded priors (creator sets the shape and funds b); a 24–48h opening auction.

## Time passing

Elapsed hours are pruned from the market; their shares go to zero, their buyers' money stays in the vault as LP/house margin, and surviving prices renormalise.

- **Counterparty is the vault, not other bettors.** Every share is a fixed promise of £1 if its atom wins. When an hour dies, the vault simply owes nothing on it. Nobody's payout grows; there is no pot being shared.
- **Renormalisation is revaluation, not transfer.** Survivors move from p to p / (1 − p_dead): the probability given the event hasn't happened. The vault can afford holders selling at the higher prices; pruning leaves it with about b · ln(1 / (1 − p_dead)) more headroom than before.
- **Pruning is mandatory.** Unpruned, surviving prices sum to less than £1 and anyone can buy a full set for under £1 with a guaranteed £1 back. Pruning keeps that slack for the house instead of arbitrage bots.
- **Advance-time instruction.** Permissionless and called often; reward the caller. It only prunes up to a live edge that lags real time by a dispute window, so an event that happened but hasn't been reported isn't pruned away.

For LPs: they gain as heavily bought hours pass empty and lose when the event lands on an hour with many outstanding shares.

## Trading

The market maker always buys back as well as sells, so any position can be cashed out before resolution. Selling removes x shares from every atom in the range:

```latex
\text{proceeds} = -b \ln\left(1 - p + p\,e^{-x/b}\right)
```

Example (b = £1,000): 320 shares of 14 Mar – 2 Apr bought at 6.1% for about £22.75 before fees. The chunk later trades at 15%. Selling all 320 returns about £42 (about £40.50 after a 3.5% fee), not the £48 the screen price suggests. The cash-out button shows the real amount.

**How a chunk gains value:** news or crowd buying; time passing with no event (renormalisation), until the window itself starts elapsing and value collapses towards zero; or the market correcting an underpriced prior.

**Design consequences**

- **Partial sells.** Selling a sub-range splits the position.
- **Early-to-consensus is rewarded.** Someone who called March can lock in profit when the crowd catches up, even if the event lands in June. Add a separate badge for anyone still holding when the event lands, to keep the "I called it" layer.
- **Pump-and-dump.** LMSR is path-independent, so buy-then-sell with nobody in between returns your money minus fees. Profit only comes from followers buying in between. Fees on both sides dampen it; a short minimum hold or a higher fee on quick flips is the fallback.
- **Max-cost / min-proceeds argument** on every trade so the program rejects it if the price moved since the quote.

**72-hour locked zone**

- Buys and sells are rejected unless the range starts at or after now + 72h. This also covers atoms that have elapsed but aren't yet pruned (between the lagged live edge and now). Without it, someone could buy the winning atom after the event. Ranges overlapping the zone are clipped to start at T+72h in the UI.
- Selling is frozen too: otherwise holders who learn "not this weekend" sell to the vault before anyone else knows. Show positions as "Locked · within 72h of now" with the cash-out figure greyed out.
- The cutoff is stored per market (72h default). It filters short-notice information only; insiders who know weeks ahead are handled by the listing policy and the near-term fee.

## Fees and LPs

Charge a flat 3.5% of stake on buys and sells: 2.5% to LPs and 1% to the platform. Multipliers are shown after fees. LPs are the market maker and lose to informed traders before fees; the multiplier change is barely visible to users (×16.4 → ×15.8 on a 6.1% chunk) but cuts the volume LPs need to break even by more than half compared with 2%. The platform creates and curates every market at launch, so there is no creator share.

| Recipient | Share of 3.5% | Why |
| --- | --- | --- |
| LPs | 2.5% | Covers losses to informed traders; must be the largest share |
| Platform | 1.0% | Revenue; creates and curates all markets; funds a first-loss layer for LPs later |

Effect of the fee on a 6.1% chunk, and the volume needed to cover a £2,303 LP loss (b = £1,000, crowd nails the window):

| Fee | Multiplier shown | LP share | Break-even volume |
| --- | --- | --- | --- |
| 0% | ×16.4 | – | never |
| 2% | ×16.1 | 1.2% | £192k |
| **3.5%** | **×15.8** | **2.5%** | **£92k** |
| 6% | ×15.4 | 3.6% | £64k |

- **Percentage of stake, never per atom.** A per-atom spread is multiplied by the number of atoms a chunk covers, making wide chunks terrible value; a per-share fee would exceed the price of cheap atoms.
- **Show the multiplier after fees** as the headline on the buy sheet (×15.7), with the fee as a small detail line.
- **Same fee on buys and sells.** A higher sell fee would penalise cash-out, a core feature; use a short minimum hold if pumping becomes a problem.
- **Flat, not tilted against long shots.** A fee that rises as price falls would protect LPs most but taxes exactly the bold calls Veleda is built around. Revisit only if data shows LPs are hurt mainly by long shots winning.
- **Near-term fee (roadmap).** A higher fee on atoms between 72h and ~14 days out, sent mostly to LPs, compensating them for the riskiest trades.
- **Fixed fees.** None at launch, since the platform creates all markets. A creation fee and creator share return only if market creation is opened up later.
- **Not used:** commission on winnings (no LP income while the market runs; harsh on long-shot winners); fee curves peaking at 50% (most atoms sit near 0); margin hidden in the market maker (LS-LMSR).

**LP mechanics**

- **Deposit** raises b; every q scales by the same ratio so prices don't move. LP receives pool tokens.
- **At resolution**, money remaining after winners are paid, plus accumulated fees, is distributed by pool tokens.
- **Withdrawals.** Locked until resolution for the hackathon; fees claimable as they accrue. Mid-market exits need a fair value for open risk (roadmap).
- **Late LPs** take on risk only from the moment they join, priced then.

## Insider risk and listing policy

List markets by who controls the timing, and resolve on the natural event rather than an announcement wherever possible.

Some insider trading is tolerable: insider buying is itself a public signal, and LMSR is by design a subsidised bounty for information. Natural timing also limits what insiders can know (births spread over weeks around a due date). The real danger is when a party can **choose** the date and then trade on it.

| Timing type | Examples | Policy |
| --- | --- | --- |
| Natural | Births, discoveries, records broken | List freely; hourly or daily atoms |
| Scheduled by an institution | Court rulings, big-company launches | Daily or weekly atoms; longer cutoff |
| Controlled by one person or small group | Creator drops, founder announcements, celebrity posts | Avoid, or weekly atoms only |

**Resolve on the event, not the announcement.** "Date of birth as later reported" rather than "timestamp of the first post": the birth is natural, the post is timed by a publicist. Birth dates are usually reported to the day, so those markets use daily atoms.

Classifying each market is a judgment call; fine while markets are curated, but permissionless creation needs a review step.

## Resolution

Each market names its resolution source and precision up front; the hackathon resolves manually and presents the optimistic-oracle design.

- **Source and precision** fixed at creation, e.g. "date of birth as reported by at least 5 of 10 named outlets, to the day". A quorum of several outlets means no single outlet's error or early report decides the market. Atom size never finer than this.
- **Void if it already happened.** If the event turns out to have happened before the market opened, the market is voided. Each position is refunded its net amount paid (stakes including fees, minus cash-out proceeds, never below 0). Nobody should profit from information the market couldn't have priced.
- **Target design.** Optimistic oracle: anyone proposes the timestamp with a bond; a dispute window follows; disputes escalate. There is no UMA-style oracle on Solana, so this needs building or sourcing.
- **Halt on occurrence.** Once the event is believed to have happened, all trading (buys and sells) halts until resolution. Pruning halts too, so the winning atom can't be pruned away while the source quorum is pending. In the prototype, admin triggers this with a `halt` instruction, which can be lifted after a false alarm. Later, the oracle design takes it over.
- **Delayed or missing reports.** If the source quorum (e.g. 5 of 10 outlets) isn't met, the market doesn't resolve and stays unresolved until it is. There is no deadline, fallback date or automatic void.
- **Status in the app.** Between the event and confirmation, show "Event happened, confirming date" rather than nothing.
- **Payout.** £1 per share on the winning atom, claimed by holders.

## UX (phone app)

A continuous vertical timeline, not a calendar grid: now at the top, the future scrolling down, with the crowd's odds drawn as a band beside it. Mockups: [Veleda mockups](https://claude.ai/artifact/AT3unoJ2sQ7hHadgNZWfih).

- **Band = price.** Wide where the crowd thinks the event is likely, thin where not. A chunk's price is the area selected, so leverage is visible without explanation.
- **Pinch to zoom** across years, months, days and hours; selection snaps to the visible unit. A toggle offers the same levels for fast selection.
- **Selecting.** Long-press to start (haptic), drag to extend, auto-scroll at the screen edge, handles to adjust afterwards. A tap selects the visible unit.
- **Buy sheet.** Range, crowd odds, multiplier (shown first, e.g. ×16), price per share, stake buttons, payout if it lands, max-price limit, fee line, and "Share this chunk as a link".
- **Positions.** Coloured bands on the timeline with a live "Cash out now: £41 (+£21)" figure; drag a band's edge to buy or sell the difference.
- **Time.** Elapsed time greys out above the NOW line; a shaded "Locked · 72h" band sits below it.
- **Activity.** Recent buys pulse on the band; at resolution a marker drops onto the timeline.
- **Opening estimate** label on the band until enough has traded. Test that the band reads well when nearly flat.
- **Daytime-only filter** on a chunk (roadmap): higher multiplier, one trade for "this month, US daytime only".

## Solana and hackathon scope

Pitch: a fully on-chain AMM over thousands of mutually exclusive outcomes, where every trade costs the same whatever the chunk width, and every prediction is a shareable, tradable link.

**Why Solana**

- **Large accounts.** The whole market's segment tree fits in one zero-copy account (tens of KB for 90 days hourly; ~1–2MB for five years). A range update touches ~16 nodes, within the compute budget.
- **Cheap transactions** make 50p single-hour bets viable.
- **Blinks.** A chunk is fully described by a URL; the Action returns a card (chunk highlighted on the band, live multiplier, stake buttons) and builds the buy transaction at POST time with a max-cost argument. Phantom renders Blinks on X only with an opt-in setting and for Actions in Dialect's registry, so register early, demo it in your own browser, and make sure the URL also opens a normal web page. Tools: `@solana/actions`, Dialect's Blinks Inspector.
- **Honest limits.** One write-heavy account per market serialises trades within a market (markets run in parallel); rent of several SOL per MB; no native optimistic oracle.

**Four-week scope**

- [ ] On-chain program: one market type, ~2,000 atoms, LMSR on a segment tree, buy/sell of arbitrary ranges, "not by end date" atom, manual resolution, claim
- [ ] Fixed-point exp/ln with overflow, rounding and drain-by-rounding tests (largest time sink; test hardest)
- [ ] Permissionless advance-time instruction that prunes elapsed atoms
- [ ] 72h locked zone and max-cost / min-proceeds checks
- [ ] Flat 3.5% fee split LP 2.5% / platform 1%, multipliers shown after fees; LPs locked to resolution
- [ ] Prior presets: "not by end date" slider, optional earliest date (the daily pattern is out of scope for the hackathon)
- [ ] Phone frontend: timeline band, drag-to-select, buy sheet, positions with cash-out
- [ ] Share a chunk as a plain link (the Blink moved to the roadmap)

**Roadmap slides:** optimistic oracle and dispute flow; near-term fee; step increases in b and open LP deposits; opening auction; daytime-only filter; mid-market LP exits; permissionless market creation with review.

## Open questions

- [ ] Value of b for the demo market, and who funds it
- [x] Demo market: "When will Taylor Swift's first child be born?", daily atoms, at least 5 of 10 named outlets (see the hackathon spec)
- [x] Rule for unreported or delayed resolution: no quorum, no resolution; the market stays unresolved
- [x] Is the 72h zone frozen for sells as well as buys? **Yes: both are frozen (decided in the project brief).**
- [ ] Liquidity-sensitive LMSR: check the Othman et al. margin bound at this atom count before considering it
- [ ] Regulatory position (UK Gambling Commission) before anything beyond the demo
- [ ] Daytime-only filter: compute cost of periodic range updates on-chain
