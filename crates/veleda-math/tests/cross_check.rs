//! Replays trade logs written by the TypeScript reference
//! (packages/reference/scripts/gen-vectors.ts) through the Rust engine.
//!
//! For every action: the same trades succeed or are rejected; Rust costs are at
//! least the reference's and within a base unit or two of it; Rust proceeds are
//! at most the reference's and close to it; prices agree to ~1e-12; the
//! market's balance never falls below the reference's (rounding always favours
//! the vault) and stays solvent; claims pay the same.
//!
//! Always replays tests/vectors/*.txt. Set VELEDA_VECTORS to a directory to
//! replay more (scripts/cross-check.sh generates 10,000+ trades there).

mod common;

use common::{f, q};
use std::path::Path;
use veleda_math::engine::{Market, Params, State, BASE};
use veleda_math::fixed::Rounding;
use veleda_math::tree::{storage_len, Tree};

fn tokens(base: u64) -> f64 {
    base as f64 / BASE as f64
}

fn replay(path: &Path) -> usize {
    let text = std::fs::read_to_string(path).unwrap();
    let mut lines = text.lines();
    let name = path.display();

    let h: Vec<f64> = lines.next().unwrap().split(' ').skip(1).map(|x| x.parse().unwrap()).collect();
    let params = Params {
        b: (h[0] * BASE as f64).round() as u64,
        atom_seconds: h[1] as i64,
        start_time: h[2] as i64,
        atoms: h[3] as u32,
        lock_seconds: h[4] as i64,
        lag_seconds: h[5] as i64,
    };
    let prior: Vec<u128> = lines.next().unwrap().split(' ').skip(1).map(|x| q(x.parse().unwrap())).collect();
    let n = params.atoms as usize + 1;
    let (s, l) = storage_len(n);
    let (mut sums, mut lazy, mut owed) = (vec![0u128; s], vec![0u128; l], vec![0u64; n]);
    let mut state = State::default();
    let tree = Tree::new(&mut sums, &mut lazy, n).unwrap();
    let mut m = Market::new(&params, &mut state, tree, &mut owed).unwrap();
    m.create(&prior).unwrap();

    let mut actions = 0usize;
    for (ln, line) in lines.enumerate() {
        let w: Vec<&str> = line.split(' ').collect();
        let at = |i: usize| -> f64 { w[i].parse().unwrap() };
        let ctx = format!("{name} line {}: {line}", ln + 3);
        match w[0] {
            "buy" | "sell" => {
                actions += 1;
                let (from, to, shares, now) = (at(1) as u32, at(2) as u32, at(3) as u64, at(4) as i64);
                let ok = w[5] == "ok";
                if w[0] == "buy" {
                    let got = m.buy(from, to, shares, u64::MAX, now);
                    assert_eq!(got.is_ok(), ok, "{ctx}: Rust {got:?}");
                    if let Ok(r) = got {
                        let (cost, stake) = (at(6), at(7));
                        // At least the reference (rounded up to a base unit), at most ~2 base units above.
                        assert!(tokens(r.cost) >= cost * (1.0 - 1e-12) - 1e-12, "{ctx}: cost {} < {cost}", tokens(r.cost));
                        assert!(tokens(r.cost) <= cost * (1.0 + 1e-9) + 2e-6, "{ctx}: cost {} >> {cost}", tokens(r.cost));
                        assert!(tokens(r.stake) >= stake * (1.0 - 1e-12) - 1e-12, "{ctx}: stake {} < {stake}", tokens(r.stake));
                        assert!(tokens(r.stake) <= stake * (1.0 + 1e-9) + 3e-6, "{ctx}: stake {} >> {stake}", tokens(r.stake));
                    }
                } else {
                    let got = m.sell(from, to, shares, 0, now);
                    assert_eq!(got.is_ok(), ok, "{ctx}: Rust {got:?}");
                    if let Ok(r) = got {
                        let (gross, net) = (at(6), at(7));
                        assert!(tokens(r.gross) <= gross * (1.0 + 1e-12) + 1e-12, "{ctx}: gross {} > {gross}", tokens(r.gross));
                        assert!(tokens(r.gross) >= gross * (1.0 - 1e-9) - 2e-6, "{ctx}: gross {} << {gross}", tokens(r.gross));
                        assert!(tokens(r.net) <= net * (1.0 + 1e-12) + 1e-12, "{ctx}: net {} > {net}", tokens(r.net));
                        assert!(tokens(r.net) >= net * (1.0 - 1e-9) - 3e-6, "{ctx}: net {} << {net}", tokens(r.net));
                    }
                }
            }
            "adv" => {
                let pruned = m.advance_time(at(1) as i64).unwrap();
                assert_eq!(pruned, at(2) as u32, "{ctx}");
            }
            "price" => {
                let p = f(m.price(at(1) as u32, at(2) as u32, Rounding::Down).unwrap());
                let want = at(3);
                assert!((p - want).abs() <= want * 1e-10 + 1e-12, "{ctx}: price {p}");
            }
            "state" => {
                let (balance, liability) = (at(1), at(2));
                // Rust charges at least as much and pays at most as much, so its balance is never lower;
                // each action rounds by at most a few base units.
                let ours = tokens(m.state.balance);
                assert!(ours >= balance * (1.0 - 1e-12) - 1e-9, "{ctx}: balance {ours} < {balance}");
                assert!(ours <= balance * (1.0 + 1e-9) + 3e-6 * (actions as f64 + 1.0), "{ctx}: balance {ours} >> {balance}");
                assert_eq!(m.max_liability(), (liability * BASE as f64).round() as u64, "{ctx}: liability");
                assert!(m.state.balance >= m.max_liability(), "{ctx}: insolvent");
            }
            "resolve" => m.resolve(at(1) as u32).unwrap(),
            "claim" => {
                let payout = m.claim(at(1) as u32, at(2) as u32, at(3) as u64).unwrap();
                assert_eq!(payout, at(4) as u64, "{ctx}");
            }
            other => panic!("{ctx}: unknown line type {other}"),
        }
    }
    actions
}

fn replay_dir(dir: &Path) -> usize {
    let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|e| e == "txt")).collect();
    files.sort();
    assert!(!files.is_empty(), "no vectors in {}", dir.display());
    files.iter().map(|p| replay(p)).sum()
}

#[test]
fn replays_reference_trade_logs() {
    let mut trades = replay_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/vectors"));
    if let Ok(dir) = std::env::var("VELEDA_VECTORS") {
        trades += replay_dir(Path::new(&dir));
    }
    println!("replayed {trades} trades");
}
