mod common;

use common::*;
use solana_signer::Signer;

/// b · ln(1 / p_min) in base units.
fn expected_subsidy(b: u64, p_min: f64) -> f64 {
    b as f64 * (1.0 / p_min).ln()
}

#[test]
fn flagship() {
    let mut env = Env::new();
    let args = flagship_args();
    let created = env.create_market(args.clone()).unwrap();
    println!("create_market (flagship, 1,096 atoms): {} CU", created.meta.compute_units_consumed);

    let h = env.header(&created.market);
    assert_eq!(h.admin.to_bytes(), env.admin.pubkey().to_bytes());
    assert_eq!(h.mint.to_bytes(), env.mint.to_bytes());
    assert_eq!(h.vault.to_bytes(), created.vault.to_bytes());
    assert_eq!((h.atoms, h.b, h.atom_seconds, h.lock_seconds, h.lag_seconds), (1096, 1_000 * BASE, DAY, 72 * HOUR, 24 * HOUR));
    assert_eq!(h.start_time, START - START.rem_euclid(DAY), "atom 0 starts at UTC midnight");
    assert_eq!((h.live_edge, h.resolved, h.demo, h.clock_offset, h.lp_fees, h.platform_fees), (0, 0, 0, 0, 0, 0));

    // Subsidy b · ln(1 / 0.01%) ≈ 9,210.34 VCR, rounded up, all of it in the vault.
    let subsidy = h.balance;
    let want = expected_subsidy(h.b, 0.0001);
    assert!(subsidy as f64 >= want && subsidy as f64 - want < 10.0, "subsidy {subsidy}, want ~{want}");
    assert_eq!(env.token_balance(&created.vault), subsidy);
    assert_eq!(env.token_balance(&env.admin_token), 1_000_000 * BASE - subsidy);
}

#[test]
fn fast_demo() {
    let mut env = Env::new();
    let created = env.create_market(fast_args()).unwrap();
    println!("create_market (fast, 168 atoms): {} CU", created.meta.compute_units_consumed);

    let h = env.header(&created.market);
    assert_eq!(h.start_time, START - START.rem_euclid(HOUR), "atom 0 starts on the hour");
    assert_eq!(h.demo, 1);
    // Flat over 169 atoms: subsidy 100 · ln 169 ≈ 513 VCR (the end price is a hair under 1/169).
    let want = expected_subsidy(h.b, 1.0 / 169.0);
    assert!((h.balance as f64 - want).abs() < 0.01 * want, "subsidy {}, want ~{want}", h.balance);
    assert_eq!(env.token_balance(&created.vault), h.balance);
}

#[test]
fn works_with_token_2022() {
    // With the token-2022 feature, litesvm_token::spl_token is the Token-2022 interface.
    let mut env = Env::with_token_program(litesvm_token::spl_token::ID);
    let created = env.create_market(fast_args()).unwrap();
    assert_eq!(env.token_balance(&created.vault), env.header(&created.market).balance);
}

#[test]
fn rejects_wrong_account_size() {
    let mut env = Env::new();
    let market = env.alloc_market(veleda::market_account_len(168) + 8);
    let ix = env.create_market_ix(&market.pubkey(), fast_args());
    let admin = env.admin.insecure_clone();
    expect_error(env.send(&[ix], &[&admin]), "BadAccount");
}

#[test]
fn demo_market_can_start_in_the_future() {
    // A fictional scenario set ~2 years ahead: the clock and atom 0 both start there.
    let mut env = Env::new();
    let offset = 730 * DAY + 1_234;
    let created = env.create_market(veleda::CreateMarketArgs { clock_offset: offset, ..fast_args() }).unwrap();
    let market = created.market;
    let h = env.header(&market);
    let now = START + offset;
    assert_eq!((h.clock_offset, h.start_time), (offset, now - now.rem_euclid(HOUR)));

    // Nothing has elapsed on the market's clock, and trading follows it: hour 1 is still
    // inside the 1-hour locked zone, hour 2 is open.
    env.advance_time(&market).unwrap();
    assert_eq!(env.header(&market).live_edge, 0);
    let user = env.new_user(100);
    expect_error(env.buy(&market, &user, 0, 1, 1, BASE, 10 * BASE), "Locked");
    env.buy(&market, &user, 0, 2, 3, BASE, 10 * BASE).unwrap();
    env.check_invariant(&market);

    // The clock still only moves forward from the starting offset.
    expect_error(env.set_clock_offset(&market, offset - 1), "ClockBackwards");
    env.set_clock_offset(&market, offset + 5 * HOUR).unwrap();
}

#[test]
fn only_demo_markets_start_with_a_clock_offset() {
    let mut env = Env::new();
    expect_error(env.create_market(veleda::CreateMarketArgs { clock_offset: DAY, ..flagship_args() }), "NotDemo");
    expect_error(env.create_market(veleda::CreateMarketArgs { clock_offset: -HOUR, ..fast_args() }), "ClockBackwards");
}

#[test]
fn rejects_bad_params_and_priors() {
    let mut env = Env::new();
    expect_error(env.create_market(veleda::CreateMarketArgs { atoms: 0, ..fast_args() }), "BadParams");
    expect_error(env.create_market(veleda::CreateMarketArgs { atoms: veleda::MAX_ATOMS + 1, ..fast_args() }), "BadParams");
    expect_error(env.create_market(veleda::CreateMarketArgs { b: 0, ..fast_args() }), "BadParams");
    expect_error(env.create_market(veleda::CreateMarketArgs { end_price_ppm: 0, ..fast_args() }), "BadPrior");
    expect_error(env.create_market(veleda::CreateMarketArgs { floor_ppm: 10_000, ..fast_args() }), "BadPrior");
}

#[test]
fn cannot_initialise_twice() {
    let mut env = Env::new();
    let created = env.create_market(fast_args()).unwrap();
    let ix = env.create_market_ix(&created.market, fast_args());
    let admin = env.admin.insecure_clone();
    let before = env.svm.get_account(&created.market).unwrap().data;
    // Fails on the existing vault (Anchor creates `init` accounts before checking `zero`) or the discriminator.
    env.send(&[ix], &[&admin]).expect_err("second create_market must fail");
    assert_eq!(env.svm.get_account(&created.market).unwrap().data, before);
}
