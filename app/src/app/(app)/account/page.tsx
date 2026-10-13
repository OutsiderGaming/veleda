"use client";

import Link from "next/link";
import { useSession } from "@/lib/client/session";
import { vcr } from "@/lib/veleda/timeline";
import s from "./account.module.css";

export default function Account() {
  const { ready, authenticated, login, logout, address, balance } = useSession();
  if (!ready) return null;
  return (
    <>
      <h1 className={s.title}>Account</h1>
      {authenticated ? (
        <>
          <div className={s.card}>
            <div className={s.label}>Balance</div>
            <div className={s.balance}>
              {vcr(balance ?? 0)} <span>VCR</span>
            </div>
            <div className={s.note}>Test money: Veleda Credit has no cash value. Every account starts with 100.</div>
          </div>
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
          <p className={s.text}>Sign in with email or Google. We set up everything else, and you start with 100 VCR of test money.</p>
          <button className={s.primary} onClick={login}>Sign in</button>
          <Link href="/practice" className={s.link}>How it works →</Link>
        </>
      )}
    </>
  );
}
