# Veleda — Submission copy (drafts)

Drafted 12 Oct 2026 for the Colosseum "Best Consumer App on Solana" submission form.

## Project description

**Veleda — the market of seers.** Fans argue about *when* things will happen. Veleda turns those arguments into calls you can stake, share and get credit for. Drag across the timeline to buy any window, from a single hour to a whole year, in one trade. Narrow calls pay big, wide calls pay safer, and you can cash out at the live price whenever the crowd moves your way.

**Why Solana:** the whole timeline lives in one account, so every trade costs the same whatever its width. Every payout is fully backed on-chain, and sign-in is by email with no crypto setup.

### One-line version

Veleda: buy any window of future time in one swipe. Call when it happens, cash out as the crowd moves.

## How Solana powers Veleda

Every Veleda market is a single on-chain automated market maker, a logarithmic market scoring rule (LMSR), that prices the whole timeline at once. The timeline is split into hourly or daily slots, and the prices for every slot live in a segment tree inside one zero-copy account. Buying a window means adding shares to every slot in that range. The tree applies this as a lazy range-multiply, so any trade touches about 16 nodes whether the window is one hour or one year. That keeps every trade at the same compute cost and lets a single program instruction quote, buy or sell any contiguous range atomically.

Because the AMM is always on the other side of the trade, there's no order book and no waiting for a counterparty. You can enter early at a long-shot price and cash out at the live price at any time. The maths runs in Q64.64 fixed point, with costs rounded up and proceeds rounded down. Every instruction checks one invariant: the vault always holds enough to pay the largest possible payout, so every position is fully backed on-chain.

Solana's low fees and fast finality make small, precise calls practical, such as 5 VCR on a single day. Embedded wallets plus a platform fee payer let new users sign in with email and place their first call in under 60 seconds, with no SOL, seed phrase or wallet install.

### One-line version

Each market is a single LMSR AMM stored as a segment tree in one Solana account, so buying any window of time, from an hour to a year, is one atomic trade at constant cost and fully backed on-chain.

> Before submitting: "about 16 nodes" is the design figure from the hackathon spec, not yet measured. If the build hasn't confirmed it, say "a fixed, small number of tree updates" instead.
