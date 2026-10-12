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
- [ ] Devnet keypairs in `keys/`: `admin.json`, `fee-payer.json`, `mint-authority.json`. Fund admin and fee payer from the faucet.

### Maths (the critical path)

- [x] **Reference model** (`packages/reference`): market of n atoms + "not by end date"; `quoteBuy` / `quoteSell` for a range; fee taken out of the gross amount; `advanceTime` pruning; `resolve`; `claim`; a vault-invariant check. Property tests on random trade sequences: the vault always covers the largest single-atom payout, buy-then-sell returns at most the stake, prices always sum to 1.
- [ ] **Fixed-point exp/ln** (`crates/veleda-math`): Q64.64 in u128; range reduction plus a short polynomial. Tests against f64 across the input range; rounding direction (costs up, proceeds down).
- [ ] **Segment tree with lazy range-multiply** (`crates/veleda-math`): range multiply, range sum, point zero (pruning), whole-tree rescale. Tests against a plain array on random operations.
- [ ] **Cross-check**: Rust maths vs the TS reference on 10,000 random trades, within rounding. Shared test vectors as JSON.
- [ ] **Compute-unit spike**: a throwaway Anchor instruction doing one range update on a 732-leaf tree on devnet. Record the compute units used.

### Onboarding proof

- [ ] **Create the `[TOKEN]` mint** (6 decimals) with `mint-authority.json`.
- [ ] **Privy spike** in `app/`: email sign-in, embedded Solana wallet, then one transaction from a wallet that has never held SOL, with the server as fee payer and rent payer: create the user's token account and mint 100 `[TOKEN]` to it.

### Week 1 is done when

- The Rust maths matches the reference within rounding on 10,000 random trades.
- A new user signs in by email and receives 100 `[TOKEN]` with no SOL in their wallet.
- The compute cost of a range update is measured and fits the budget.
