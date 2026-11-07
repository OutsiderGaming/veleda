# Veleda — Project copy

Final as of 7 Nov 2026. Drafted 12 Oct 2026, checked against the build and the demo video on 6 Nov 2026, and organised around three questions: who the user is, how a trade works, and how Solana powers it.

## Project description

**Veleda, the market of seers.** A prediction market for *when* something will happen. Instead of betting yes or no on a fixed deadline, you buy any stretch of future time, from an hour to a year, in one swipe and one trade, and cash out at the live price whenever you like.

Demo video: https://youtu.be/XSCJWLiuu-g · Live app: https://veleda-veleda1.vercel.app · Repo: https://github.com/OutsiderGaming/veleda

### The user

**Who they are.** The explosion of prediction markets in recent years is testament to a large public appetite for prediction, on subjects as diverse as celebrity news and crypto prices. Veleda is for the people who argue about *when*: pop-culture fans (when will Taylor Swift's first child be born?) and crypto communities (when will BTC hit $200K?). They follow the story every day, live on their phones, and many have never used a crypto wallet.

**What they're missing today.**
- **Only yes or no, on fixed deadlines.** Existing platforms only offer binary yes/no bets on predetermined timeframes ("by 30 June?"). A fan who thinks "the second week of June" has no button to press.
- **Capped long shots.** The narrowest bet is the gap between two deadlines, so the odds can only get so long. People love long shots, both for the payout and for the flex.
- **Their debates have no stakes and no record.** Group chats argue about timing endlessly, but nobody can prove they called it.
- **Crypto apps lose them at the door.** A seed phrase and "buy SOL first" are where most newcomers give up.

**What Veleda gives them.**
- **Their exact call.** One market covers the whole timeline, and they buy precisely the window they believe in, as narrow or as wide as they like.
- **Real long shots.** Narrow the window to a single day and the odds go as long as the crowd says: on our Taylor Swift market, $20 on one day currently pays about $5,400 (270×).
- **Something to share.** Every window is a link that opens straight onto it, so a friend can back the same call in a couple of taps, and the call is on record.
- **A normal app.** Google or email sign-in creates their wallet. There's no seed phrase and no SOL, and their first call takes under a minute.
- **A reason to come back.** A window's price moves as news breaks and as time passes, so there's always something to check, cash out or add to, not one bet and a months-long wait.

### How a trade works

Using our flagship market, "When will Taylor Swift's first child be born?", which covers every day from October 2026 to October 2029 (figures are live quotes from 7 Nov 2026, in test credits):

1. **Browse.** No account needed. The market is a timeline, and each bar shows the crowd's odds for that day, week or month.
2. **Drag a window.** Press and drag across the time you believe in, and the buy sheet updates as you drag, after the 3.5% fee and price impact. The crowd puts 0.67% on June 2027, so $20 on that month pays $1,358 if the birth lands in it (68×). Widen it to all of 2028, at 16.9%, and the same $20 pays $109 (5.4×). A narrow window is a long shot; a wide one is a safer bet.
3. **Make the call.** Tap "predict the future". The first time, a Google sign-in creates the wallet and the call goes straight through. The whole window, a day or a year, is bought in one transaction.
4. **Hold or cash out.** There's no order book and no waiting for a buyer: the market maker always quotes a price. If a pregnancy is announced with a spring due date, spring windows jump and their holders can sell at the new price in one tap. And as each day passes without a birth, it drops off the timeline and the days left become more likely.
5. **Settle.** The market resolves on the date of birth, as reported by at least 5 of 10 named news outlets. The winning day is recorded on-chain, and every share in a window containing it pays $1, claimed from Positions.

To keep it fair, trading on a day closes 72 hours before it starts, so nobody can trade on news that's already out. The demo video shows the full cycle, including settlement, on a fictional BTC market whose clock we can run at speed.

### Status

**This prototype runs on devnet with test money: new users get 100 free test credits, and every trade, cash-out and payout is real on-chain.** The "launch preview" link shows the planned real-money flow, clearly labelled: the first card deposit goes through a payment partner's ID check, and funds arrive as USDC in the user's own wallet, shown as dollars. Real-money launch depends on licensing and legal advice.

Two markets are live: "When will Taylor Swift's first child be born?" (three years of daily slots, open for anyone to trade) and the fictional BTC market from the video, whose clock we can run at speed to show settlement.

### What's next

Today the platform funds every market. Next, we open that to liquidity providers: their maximum loss is known and funded up front, they set the opening odds, and they earn 2.5% of every buy and sell. The risk is real but capped and priced.

### One-line version

Veleda: buy any window of future time in one swipe. Call when it happens, cash out as the crowd moves.

## How Solana powers Veleda

**One market, one account, one instruction.** Every market is a single on-chain market maker (a logarithmic market scoring rule, LMSR) that prices the whole timeline at once. The prices for every slot live in a segment tree inside one zero-copy account. Buying a window is a lazy range update on that tree, so repricing grows with the logarithm of the timeline's length, not with the window's width. The program also keeps a plain per-slot record of what each slot would owe, updated with one addition per slot, so a wide window costs a little more, not hundreds of times more. On the three-year flagship market, buying 1 day costs about 70K compute units and 700 days about 100K, both within Solana's default 200K budget. Any window is quoted, bought or sold in one atomic instruction.

**Always a price, always backed.** Because the market maker is on the other side of every trade, there's no order book and no waiting for a counterparty: you can cash out at the live price at any time. The maths runs in Q64.64 fixed point, rounding costs up and proceeds down, and every instruction checks that the vault holds enough for the largest possible payout, so every position is fully backed on-chain. We cross-checked the maths against a separate reference model on 26,000 random trades.

**A consumer app on top.** Privy embedded wallets give every user a Solana wallet from a Google or email sign-in. Our server builds each transaction, the user's wallet signs it, and the server adds its signature as fee payer and submits it, paying the network fee and the rent for the new position account. Solana's low fees and fast confirmation are what make this work: the network fee on a $5 call or an instant cash-out is a fraction of a cent, and it confirms in about a second, so it feels like an app, not a blockchain.

**Room to grow.** Five years of hourly slots (43,824) fits in one 3.5 MB account, inside Solana's 10 MB limit. Trading at that size needs one more change, keeping the per-slot record in a tree too; that's on the roadmap, and the live markets run at 1,096 days and 168 hours. Creating a market is permissionless and works with any SPL Token or Token-2022 mint.

### One-line version

Each market is a single LMSR stored as a segment tree in one Solana account, so buying any window of time, from an hour to a year, is one atomic, fully backed trade, made from a wallet that never needs SOL.
