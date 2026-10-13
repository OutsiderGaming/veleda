# Veleda

**Veleda, the market of seers.** Fans argue about *when* things will happen. Veleda turns those arguments into calls you can stake, share and get credit for: buy any window of future time, from an hour to a year, in one trade, and cash out at the live price whenever the crowd moves your way.

A prototype for the Encode Club Solana hackathon, "Best Consumer App on Solana" track, on devnet. Work in progress.

## Layout

| Path | What it is |
| --- | --- |
| `packages/reference` | TypeScript reference model of the market maths |
| `crates/veleda-math` | Rust maths, segment tree and market engine used on-chain |
| `docs/` | Project brief, specs and build plan |
| `design/` | Mockups, tokens and fonts |

## Development

```
npm test                          # TypeScript reference model (Node 23.6+)
cargo test -p veleda-math         # Rust maths and engine (needs the Rust toolchain)
scripts/cross-check.sh            # replay 15,000 random reference-model actions through the Rust engine
```

Setup instructions, the one-command setup script and "How Solana powers Veleda" come later in the build.
