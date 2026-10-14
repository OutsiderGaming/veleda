"use client";

import Link from "next/link";
import { MiniBand } from "@/components/MiniBand";
import { Seer } from "@/components/Seer";
import { useFirstVisit } from "@/lib/client/first-visit";
import { useMarkets } from "@/lib/client/markets";
import { endLabel, pct } from "@/lib/veleda/timeline";
import s from "./home.module.css";

export default function Home() {
  const { markets, error } = useMarkets();
  // The tutorial link only shows on a first visit; after that it lives under Account → How it works.
  const firstVisit = useFirstVisit();
  return (
    <>
      <Seer />
      <div className={s.below}>
        <h1 className={s.title}>Predict the future</h1>
        {firstVisit && <Link href="/practice" className={s.practice}>View the tutorial</Link>}
        <h2 className={s.section}>Top markets</h2>
        {error && !markets && <p className={s.error}>Couldn&apos;t load the markets. Retrying…</p>}
        {!markets && !error && [0, 1].map((i) => <div key={i} className={s.skeleton} />)}
        {markets?.map((m) => (
          <Link key={m.name} href={`/m/${m.name}`} className={s.card}>
            {m.tag && <span className={s.tag}>{m.tag}</span>}
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
      </div>
    </>
  );
}
