// A small preview of a market's band: odds over time as a soft copper area,
// left to right from now to the end of the window.
import { buildBars, type TimelineMarket, type Zoom } from "@/lib/veleda/timeline";

export function MiniBand({ market, zoom, height = 56 }: { market: TimelineMarket; zoom: Zoom; height?: number }) {
  const bars = buildBars(market, zoom).filter((b) => b.state !== "elapsed");
  const max = Math.max(...bars.map((b) => b.price), 1e-9);
  const w = 300;
  const step = w / Math.max(bars.length - 1, 1);
  const pts = bars.map((b, i) => `${(i * step).toFixed(1)},${(height - 4 - (b.price / max) * (height - 10)).toFixed(1)}`);
  const id = `band-${zoom}-${market.atoms}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#E9A867" stopOpacity="0.55" />
          <stop offset="1" stopColor="#E9A867" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke="#F6C792" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
