"use client";

import Link from "next/link";
import { useMoney, usePreview } from "@/lib/client/preview";
import { useSession } from "@/lib/client/session";
import s from "./account.module.css";

export default function Account() {
  const { ready, authenticated, login, logout, address, balance } = useSession();
  const preview = usePreview();
  const money = useMoney();
  if (!ready) return null;
  return (
    <>
      <h1 className={s.title}>Account</h1>
      {authenticated ? (
        <>
          <div className={s.card}>
            <div className={s.label}>Balance</div>
            <div className={s.balance}>
              {money.amount(balance ?? 0)}
            </div>
            <div className={s.note}>
              {preview.active
                ? "Test money: this preview shows how real deposits would work, and the balance has no cash value."
                : "Test money: your balance has no cash value. Every account starts with $100."}
            </div>
            {preview.active && <button className={s.addMoney} onClick={preview.openAddMoney}>Add money</button>}
          </div>
          {preview.active && (
            <div className={s.card}>
              <div className={s.label}>Withdrawing, at launch</div>
              <div className={s.note} style={{ marginTop: 0 }}>Send your balance to your bank through our payment partner, or send USDC to any wallet you choose.</div>
            </div>
          )}
          <div className={s.card}>
            <div className={s.label}>Your wallet</div>
            <div className={s.mono}>{address ?? "Setting up…"}</div>
            <div className={s.note}>Created for you when you signed in. We pay every network fee.</div>
          </div>
          <Link href="/practice" className={s.link}>How it works →</Link>
          <button className={s.button} onClick={() => void logout()}>Sign out</button>
        </>
      ) : (
        <>
          <p className={s.text}>{preview.active ? "Sign in with Google or email. We set up everything else, then you add money." : <>Sign in with Google or email. We set up everything else, and you start with $100 of test money.</>}</p>
          <button className={s.primary} onClick={login}>Sign in</button>
          <Link href="/practice" className={s.link}>How it works →</Link>
        </>
      )}
    </>
  );
}
