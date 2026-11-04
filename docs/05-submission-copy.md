# Veleda — Submission copy (drafts)

Drafted 12 Oct 2026, rewritten 4 Nov 2026 after judge feedback, for the Encode Club Solana Hackathon "Best Consumer App on Solana" submission form.

## Project description

**Veleda, the market of seers.** Fans argue about *when* things will happen: when the album drops, when the baby's due, when BTC hits a number. Those arguments have no stakes and no record of who called it. Veleda turns them into calls you can stake, share and get credit for. It's built for pop-culture fans and crypto communities who want bragging rights with something at stake.

### How a trade works

1. **Pick a window.** A market is a timeline of the future, and its bars show the crowd's odds for each hour, day or month. Press and drag across any stretch, from one hour to a whole year.
2. **Make the call.** The buy sheet shows your multiplier after fees and price impact. Narrow windows pay more, wide windows are safer, and one tap buys the whole window as a single trade.
3. **Cash out or hold.** There's no need to wait for a counterparty, because the on-chain market maker always quotes a price. Sell at the live price whenever the crowd moves your way, or as time passes and your window becomes more likely.
4. **Settle.** Once the event happens, the winning slot is recorded on-chain. Every window containing it pays 1 unit per share, which you claim from Positions.

Every window can also be shared as a link that opens straight onto it, so a friend can back the same call in a couple of taps.

### Onboarding for someone new to Solana

A new user signs in with Google or email, Veleda creates a wallet for them, and they can make their first call with free test credits in under a minute.

Adding real money would be the one slower step: the first card deposit goes through a payment partner's identity check, and funds then arrive as USDC in the user's own wallet, shown simply as dollars. Anyone who already holds USDC can deposit directly. The platform pays network fees, so nobody has to buy SOL or handle a seed phrase.

**This prototype runs on devnet with test money: the deposit is simulated, while every trade, cash-out and payout is real on-chain.** Real-money launch depends on licensing and legal advice. The demo video and the "launch preview" link show this flow, clearly labelled.

### One-line version

Veleda: buy any window of future time in one swipe. Call when it happens, cash out as the crowd moves.

## How Solana powers Veleda

Every Veleda market is a single on-chain automated market maker, a logarithmic market scoring rule (LMSR), that prices the whole timeline at once. The timeline is split into hourly or daily slots, and the prices for every slot live in a segment tree inside one zero-copy account. Buying a window means adding shares to every slot in that range. The tree applies this as a lazy range update, so the work grows with the logarithm of the timeline's length, not with the width of the window.

We measured this on the three-year flagship market: buying 1 day costs about 70K compute units, 31 days about 81K and 700 days about 100K, all within Solana's default 200K budget. One program instruction can quote, buy or sell any contiguous range atomically.

Because the market maker is always on the other side of the trade, there's no order book and no waiting for a counterparty. You can enter early at a long-shot price and cash out at the live price at any time. The maths runs in Q64.64 fixed point, with costs rounded up and proceeds rounded down. Every instruction checks one invariant: the vault always holds enough to pay the largest possible payout, so every position is fully backed on-chain. We cross-checked the maths against a separate reference model on 26,000 random trades.

Solana's low fees and fast finality make small, precise calls practical, such as 5 units on a single day. Embedded wallets plus a platform fee payer mean a new user can hold a position from a wallet that has never held SOL.

### One-line version

Each market is a single LMSR stored as a segment tree in one Solana account, so buying any window of time, from an hour to a year, is one atomic trade at near-constant cost and fully backed on-chain.
