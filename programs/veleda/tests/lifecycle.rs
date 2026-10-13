mod common;

use common::*;
use solana_signer::Signer;

/// The fast market end to end: trade, move the clock, prune, resolve, claim.
/// Atom 0 starts at 13:00 and the chain clock reads 13:17.
#[test]
fn fast_market_lifecycle() {
    let mut env = Env::new();
    let market = env.create_market(fast_args()).unwrap().market;
    let [a, b, c, d] = [0; 4].map(|_| env.new_user(100));
    let shares = 100 * BASE;
    env.buy(&market, &a, 0, 30, 35, shares, 50 * BASE).unwrap(); // the winning window
    env.buy(&market, &b, 0, 40, 50, shares, 50 * BASE).unwrap();
    env.buy(&market, &c, 0, 5, 10, shares, 50 * BASE).unwrap(); // will be pruned
    env.buy(&market, &d, 0, 168, 168, shares, 50 * BASE).unwrap(); // "not by end date"
    env.check_invariant(&market);
    expect_error(env.claim(&market, &a, 0), "NotOpen");

    // A day later on the market's clock: hours before 13:07 are pruned (10-minute lag).
    env.set_clock_offset(&market, 24 * HOUR).unwrap();
    env.advance_time(&market).unwrap();
    let h = env.header(&market);
    assert_eq!((h.clock_offset, h.live_edge), (24 * HOUR, 24));
    assert!(env.owed(&market)[5..=10].iter().all(|&o| o == 0), "pruned atoms owe nothing");
    env.check_invariant(&market);

    // The locked zone moved with the clock: hour 25 starts before now + 1h, hour 26 after.
    expect_error(env.sell(&market, &c, 0, shares, 0), "Locked");
    expect_error(env.buy(&market, &b, 1, 25, 26, BASE, 10 * BASE), "Locked");
    env.buy(&market, &b, 1, 26, 26, BASE, 10 * BASE).unwrap();
    env.check_invariant(&market);

    // Resolve at hour 32.
    env.set_clock_offset(&market, 33 * HOUR).unwrap();
    env.resolve(&market, 32).unwrap();
    expect_error(env.buy(&market, &b, 2, 100, 110, BASE, 10 * BASE), "NotOpen");
    expect_error(env.sell(&market, &b, 0, shares, 0), "NotOpen");
    expect_error(env.advance_time(&market), "NotOpen");
    expect_error(env.resolve(&market, 40), "NotOpen");
    env.check_invariant(&market);

    // Someone else can't claim A's winnings.
    let pos_a = position(&market, &a.key.pubkey(), 0);
    let ix = env.claim_ix(&market, &b, &pos_a);
    expect_error(env.send(&[ix], &[&b.key]), "ConstraintHasOne");

    // Winner gets 1 VCR per share; everyone's position closes, rent back to the fee payer.
    let before = env.token_balance(&a.token);
    let rent = env.lamports(&pos_a);
    let payer = env.lamports(&env.fee_payer.pubkey());
    let meta = env.claim(&market, &a, 0).unwrap();
    println!("claim (winner): {} CU", meta.compute_units_consumed);
    assert_eq!(env.token_balance(&a.token), before + shares);
    assert_eq!(env.lamports(&env.fee_payer.pubkey()), payer + rent - meta.fee);
    env.check_invariant(&market);
    for (user, nonce) in [(&b, 0), (&b, 1), (&c, 0), (&d, 0)] {
        let before = env.token_balance(&user.token);
        env.claim(&market, user, nonce).unwrap();
        assert_eq!(env.token_balance(&user.token), before, "losers and pruned positions get nothing");
        assert!(env.position(&market, &user.key.pubkey(), nonce).is_none());
        env.check_invariant(&market);
    }
    assert!(env.claim(&market, &a, 0).is_err(), "can't claim twice");
    assert!(env.owed(&market).iter().all(|&o| o == 0));
    let h = env.header(&market);
    assert_eq!(env.token_balance(&vault(&market)), h.balance + h.lp_fees + h.platform_fees);
}

#[test]
fn clock_offset_rules() {
    let mut env = Env::new();
    let fast = env.create_market(fast_args()).unwrap().market;
    let flagship = env.create_market(flagship_args()).unwrap().market;
    expect_error(env.set_clock_offset(&flagship, HOUR), "NotDemo");
    env.set_clock_offset(&fast, 2 * HOUR).unwrap();
    expect_error(env.set_clock_offset(&fast, HOUR), "ClockBackwards");
    let stranger = env.new_user(0);
    expect_error(env.set_clock_offset_as(&stranger.key, &fast, 3 * HOUR), "ConstraintHasOne");
    expect_error(env.resolve_as(&stranger.key, &fast, 50), "ConstraintHasOne");
    assert_eq!(env.header(&fast).clock_offset, 2 * HOUR);
}

/// The flagship runs on chain time only. Atom 0 starts at midnight; the clock reads 13:17.
#[test]
fn flagship_time_passing() {
    let mut env = Env::new();
    let market = env.create_market(flagship_args()).unwrap().market;
    let user = env.new_user(1_000);
    env.buy(&market, &user, 0, 8, 20, 100 * BASE, 50 * BASE).unwrap();

    // Ten days on: days before day 9 are pruned (24-hour lag).
    env.warp(10 * DAY);
    let meta = env.advance_time(&market).unwrap();
    println!("advance_time (9 days): {} CU", meta.compute_units_consumed);
    assert_eq!(env.header(&market).live_edge, 9);
    env.check_invariant(&market);
    assert_eq!(env.advance_time(&market).unwrap().logs.iter().filter(|l| l.contains("pruned 0 atoms")).count(), 1);

    // Day 13 starts before now + 72h; day 14 after.
    expect_error(env.buy(&market, &user, 1, 13, 20, BASE, 10 * BASE), "Locked");
    env.buy(&market, &user, 1, 14, 20, BASE, 10 * BASE).unwrap();

    // A pruned day can't win; "not by end date" can.
    expect_error(env.resolve(&market, 8), "BadRange");
    expect_error(env.resolve(&market, 1097), "BadRange");
    env.resolve(&market, 1096).unwrap();
    env.claim(&market, &user, 0).unwrap();
    env.claim(&market, &user, 1).unwrap();
    env.check_invariant(&market);
}
