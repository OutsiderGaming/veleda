"use client";

import Link from "next/link";
import { MiniBand } from "@/components/MiniBand";
import { useMarkets } from "@/lib/client/markets";
import { endLabel, pct } from "@/lib/veleda/timeline";
import s from "./home.module.css";

export default function Home() {
  const { markets, error } = useMarkets();
  return (
    <>
      <h1 className={s.title}>Call when it happens.</h1>
      <p className={s.tagline}>Pick any window of time. The narrower it is, the more it pays.</p>
      <Link href="/practice" className={s.practice}>
        <span>
          <strong>New here?</strong> See how it works in a minute, with pretend money.
        </span>
        <span className={s.open}>Try it →</span>
      </Link>
      {error && !markets && <p className={s.error}>Couldn&apos;t load the markets. Retrying…</p>}
      {!markets && !error && [0, 1].map((i) => <div key={i} className={s.skeleton} />)}
      {markets?.map((m) => (
        <Link key={m.name} href={`/m/${m.name}`} className={s.card}>
          <h2 className={s.question}>{m.question}</h2>
          <div className={s.meta}>
            <span>{Math.round(m.volume).toLocaleString("en-GB")} VCR traded</span>
            <span className={s.dot}>·</span>
            <span>{m.resolves}</span>
          </div>
          <div className={s.band}>
            <MiniBand market={m} zoom={m.atomSeconds >= 86_400 ? "month" : "hour"} />
          </div>
          <div className={s.foot}>
            <span className={s.never}>{endLabel(m)}: {pct(m.prices[m.atoms])}</span>
            <span className={s.open}>{m.resolved ? "Resolved" : "Open →"}</span>
          </div>
        </Link>
      ))}
    </>
  );
}
