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

- [ ] **Create the Privy app** (you): free Developer tier, enable Solana embedded wallets, email and Google sign-in. Note the app ID.
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
