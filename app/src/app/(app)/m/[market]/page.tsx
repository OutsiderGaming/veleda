"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BuySheet } from "@/components/BuySheet";
import { Timeline, fmtMult, type Range } from "@/components/Timeline";
import { marketNowSec, useMarket, type MarketView } from "@/lib/client/markets";
import { useSession } from "@/lib/client/session";
import { defaultZoom, formatDate, formatWindow, multiplierFor, ZOOM_LABEL, zoomsFor, type Zoom } from "@/lib/veleda/timeline";
import s from "./market.module.css";

export default function MarketPage() {
  return (
    <Suspense>
      <MarketScreen />
    </Suspense>
  );
}

function MarketScreen() {
  const { market: name } = useParams<{ market: string }>();
  const market = useMarket(name);
  if (market === undefined) return null;
  if (market === null) return <p className={s.missing}>There&apos;s no market here.</p>;
  return <Loaded market={market} />;
}

function Loaded({ market: m }: { market: MarketView }) {
  const router = useRouter();
  const params = useSearchParams();
  const { positions } = useSession();
  // The timeline uses the market's clock, advanced locally between fetches.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const market = useMemo(() => ({ ...m, now: marketNowSec(m) }), [m, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const zooms = useMemo(() => zoomsFor(market), [market]);
  const [zoom, setZoom] = useState<Zoom>(() => defaultZoom(market));
  const [selection, setSelection] = useState<Range | null>(null);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Share links: /m/<market>?from=&to= opens with that window selected and the sheet up.
  useEffect(() => {
    const from = Number(params.get("from")), to = Number(params.get("to"));
    if (!params.has("from") || !Number.isInteger(from) || !Number.isInteger(to) || from > to || to > market.atoms) return;
    if (from < market.firstOpenAtom && from !== market.atoms) {
      setToast("That window is now in the locked zone. Pick a later one.");
      return;
    }
    setSelection({ from, to });
    setSheet(true);
    if (to < market.atoms) setZoom(to - from + 1 >= 28 && zooms.includes("month") ? "month" : zooms.includes("day") ? "day" : zooms[0]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const lock = `${market.lockSeconds / 3600}h`;
  const mine = (positions ?? []).filter((p) => p.market === market.name).map((p) => ({ from: p.from, to: p.to }));
  const unit = zoom === "month" ? "month" : zoom === "year" ? "year" : zoom === "day" ? "day" : "hour";

  const closeSheet = () => {
    setSheet(false);
    if (params.has("from")) router.replace(`/m/${market.name}`, { scroll: false });
  };

  return (
    <>
      <h1 className={s.question}>{market.question}</h1>
      <div className={s.meta}>
        <span>{Math.round(market.volume).toLocaleString("en-GB")} VCR traded</span>
        <span>{market.resolves}</span>
      </div>
      {market.resolved && market.winner !== null && (
        <div className={s.resolved}>
          Resolved: {market.winner === market.atoms ? `not by ${formatDate(market, market.atoms - 1)}` : formatDate(market, market.winner)}
        </div>
      )}
      <div className={s.tabsWrap}>
        <div className={s.tabs}>
          {zooms.map((z) => (
            <button key={z} className={`${s.tab} ${z === zoom ? s.tabOn : ""}`} onClick={() => setZoom(z)}>
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
      </div>
      <Timeline
        market={market}
        zoom={zoom}
        selection={selection}
        mine={mine}
        lockLabel={lock}
        readOnly={market.resolved}
        onSelect={(r, done) => {
          setSelection(r);
          if (done) setSheet(true);
        }}
        onLocked={() => setToast(`Windows must start at least ${lock} from now, so this one is locked.`)}
      />

      {toast ? (
        <div className={s.toast}>{toast}</div>
      ) : sheet || market.resolved ? null : selection ? (
        <div className={s.pill}>
          <span className={s.pillText}>{formatWindow(market, selection.from, selection.to).split(" · ")[1] ?? "Not by the end"}</span>
          <span className={s.pillMult}>×{fmtMult(multiplierFor(market, selection.from, selection.to))}</span>
          <button className={s.pillOpen} onClick={() => setSheet(true)}>PRICE</button>
          <button className={s.pillClear} aria-label="Clear selection" onClick={() => setSelection(null)}>×</button>
        </div>
      ) : (
        <div className={s.hint}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v5" /><path d="M12 10V4a1.5 1.5 0 0 1 3 0v6" /><path d="M15 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 13a1.5 1.5 0 0 1 2.5-1.7L9 14" /></svg>
          Tap a {unit}, or hold and drag across several
        </div>
      )}

      {sheet && selection && <BuySheet market={market} range={selection} onClose={closeSheet} />}
    </>
  );
}
