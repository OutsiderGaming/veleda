mod common;

use common::*;
use solana_signer::Signer;

/// A flagship market with a funded trader who has no SOL.
fn setup() -> (Env, solana_address::Address, User) {
    let mut env = Env::new();
    let market = env.create_market(flagship_args()).unwrap().market;
    let user = env.new_user(1_000);
    (env, market, user)
}

#[test]
fn buy_then_cash_out_in_two_steps() {
    let (mut env, market, user) = setup();
    let me = user.key.pubkey();
    assert_eq!(env.lamports(&me), 0, "the trader has no SOL");

    // Buy 1,000 shares in each of days 300..=330.
    let vault_before = env.token_balance(&vault(&market));
    let meta = env.buy(&market, &user, 7, 300, 330, 1_000 * BASE, 50 * BASE).unwrap();
    println!("buy_range (31 days): {} CU", meta.compute_units_consumed);
    env.check_invariant(&market);

    let stake = 1_000 * BASE - env.token_balance(&user.token);
    assert_eq!(env.token_balance(&vault(&market)) - vault_before, stake);
    let h = env.header(&market);
    let fee = h.lp_fees + h.platform_fees;
    // Fee is 3.5% of the stake, rounded up; split 2.5% LP / 1% platform.
    assert_eq!(fee, (stake * 350).div_ceil(10_000));
    assert_eq!(h.lp_fees, fee * 250 / 350);
    let p = env.position(&market, &me, 7).unwrap();
    assert_eq!((p.from, p.to, p.shares, p.nonce), (300, 330, 1_000 * BASE, 7));
    assert_eq!(p.owner.to_bytes(), me.to_bytes());
    assert_eq!(p.rent_payer.to_bytes(), env.fee_payer.pubkey().to_bytes());
    assert_eq!(env.owed(&market)[300], 1_000 * BASE);

    // Cash out half: proceeds land in the trader's token account.
    let meta = env.sell(&market, &user, 7, 500 * BASE, 1).unwrap();
    println!("sell_range (31 days, half): {} CU", meta.compute_units_consumed);
    env.check_invariant(&market);
    let after_half = env.token_balance(&user.token);
    assert!(after_half > 1_000 * BASE - stake, "received proceeds");
    assert_eq!(env.position(&market, &me, 7).unwrap().shares, 500 * BASE);

    // Cash out the rest: the position closes and its rent goes back to the fee payer.
    let rent = env.lamports(&position(&market, &me, 7));
    let payer_before = env.lamports(&env.fee_payer.pubkey());
    let meta = env.sell(&market, &user, 7, 500 * BASE, 1).unwrap();
    env.check_invariant(&market);
    assert!(env.position(&market, &me, 7).is_none());
    assert_eq!(env.lamports(&env.fee_payer.pubkey()), payer_before + rent - meta.fee);
    assert_eq!(env.owed(&market)[300], 0);
    // A round trip loses the fees (and a little rounding), never more than it paid.
    let back = env.token_balance(&user.token);
    assert!(back < 1_000 * BASE && back > 1_000 * BASE - stake);
    assert_eq!(env.lamports(&me), 0, "still no SOL");
}

#[test]
fn compute_units() {
    let (mut env, market, _) = setup();
    let user = env.new_user(100_000);
    let cases = [("1 day", 400, 400, 100), ("31 days", 600, 630, 500), ("700 days", 5, 704, 2_000), ("not by end date", 1096, 1096, 100), ("max size (29 × b)", 900, 900, 29_000)];
    for (nonce, (name, from, to, shares)) in cases.into_iter().enumerate() {
        let meta = env.buy(&market, &user, nonce as u64, from, to, shares * BASE, u64::MAX).unwrap();
        println!("buy {name}: {} CU", meta.compute_units_consumed);
        assert!(meta.compute_units_consumed < 200_000, "fits the default budget");
        env.check_invariant(&market);
    }
    let meta = env.sell(&market, &user, 2, 1_000 * BASE, 0).unwrap();
    println!("sell part of 700 days: {} CU", meta.compute_units_consumed);
    assert!(meta.compute_units_consumed < 200_000);
}

#[test]
fn buy_rejections() {
    let (mut env, market, user) = setup();
    // Atom 0 is today, inside the 72-hour locked zone.
    expect_error(env.buy(&market, &user, 0, 0, 10, BASE, 100 * BASE), "Locked");
    expect_error(env.buy(&market, &user, 0, 3, 10, BASE, 100 * BASE), "Locked");
    expect_error(env.buy(&market, &user, 0, 300, 330, 1_000 * BASE, BASE), "Slippage");
    expect_error(env.buy(&market, &user, 0, 300, 300, 31_000 * BASE, u64::MAX), "TooLarge");
    expect_error(env.buy(&market, &user, 0, 300, 1097, BASE, 100 * BASE), "BadRange");
    expect_error(env.buy(&market, &user, 0, 330, 300, BASE, 100 * BASE), "BadRange");
    expect_error(env.buy(&market, &user, 0, 300, 330, 0, 100 * BASE), "BadRange");
    // Nothing above changed the market.
    let h = env.header(&market);
    assert_eq!(h.lp_fees + h.platform_fees, 0);
    env.check_invariant(&market);

    // The first atom outside the locked zone is tradable; a nonce can't be reused.
    let first_open = 4;
    env.buy(&market, &user, 0, first_open, first_open, BASE, 100 * BASE).unwrap();
    assert!(env.buy(&market, &user, 0, 300, 330, BASE, 100 * BASE).is_err());
}

#[test]
fn sell_rejections() {
    let (mut env, market, user) = setup();
    let me = user.key.pubkey();
    env.buy(&market, &user, 1, 300, 330, 1_000 * BASE, 50 * BASE).unwrap();

    expect_error(env.sell(&market, &user, 1, 1_001 * BASE, 0), "NotEnoughShares");
    expect_error(env.sell(&market, &user, 1, 500 * BASE, 1_000 * BASE), "Slippage");

    // Someone else can't sell my position, even into their own token account.
    let thief = env.new_user(1);
    let pos = position(&market, &me, 1);
    let ix = env.sell_ix(&market, &thief, &pos, &env.fee_payer.pubkey(), BASE, 0);
    expect_error(env.send(&[ix], &[&thief.key]), "ConstraintHasOne");

    // The rent refund can't be redirected to the seller.
    let ix = env.sell_ix(&market, &user, &pos, &me, 1_000 * BASE, 0);
    expect_error(env.send(&[ix], &[&user.key]), "ConstraintHasOne");

    assert_eq!(env.position(&market, &me, 1).unwrap().shares, 1_000 * BASE);
    env.check_invariant(&market);
}

#[test]
fn fast_market_trades() {
    let mut env = Env::new();
    let market = env.create_market(fast_args()).unwrap().market;
    let user = env.new_user(100);
    // 100 shares on a 6-hour window two days out.
    env.buy(&market, &user, 0, 48, 53, 100 * BASE, 20 * BASE).unwrap();
    env.check_invariant(&market);
    let stake = 100 * BASE - env.token_balance(&user.token);
    println!("fast: 100 shares over 6 hours cost {:.2} VCR", stake as f64 / BASE as f64);
    env.sell(&market, &user, 0, 100 * BASE, 0).unwrap();
    env.check_invariant(&market);
}
