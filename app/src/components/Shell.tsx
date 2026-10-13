"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/client/session";
import { vcr } from "@/lib/veleda/timeline";
import s from "./Shell.module.css";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={s.app}>
      <Header />
      {children}
      <BottomNav />
    </div>
  );
}

function Header() {
  const { ready, authenticated, login, balance, airdropping } = useSession();
  return (
    <header className={s.header}>
      <Link href="/" className={s.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-128.png" alt="" className={s.logo} />
        <span className={s.wordmark}>VELEDA</span>
      </Link>
      {!ready ? null : authenticated ? (
        <div className={s.balance}>
          <span className={s.balanceValue}>{airdropping && !balance ? "…" : vcr(balance ?? 0)}</span> <span className={s.unit}>VCR</span>
          <span className={s.testMoney}>test money</span>
        </div>
      ) : (
        <button className={s.signIn} onClick={login}>Sign in</button>
      )}
    </header>
  );
}

const NAV = [
  { href: "/", label: "Markets", icon: <path d="M4 7h16M4 12h12M4 17h8" /> },
  { href: "/positions", label: "Positions", icon: <><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /></> },
  { href: "/account", label: "Account", icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></> },
];

function BottomNav() {
  const path = usePathname();
  return (
    <nav className={s.nav}>
      <div className={s.navInner}>
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" || path.startsWith("/m/") : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`${s.navItem} ${active ? s.active : ""}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{n.icon}</svg>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
