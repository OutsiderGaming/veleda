"use client";

import { useEffect, useRef } from "react";
import meta from "./seer-frames.json";
import s from "./Seer.module.css";

// Home page hero: Veleda at the parapet. Three clips that share their end frames
// (built by scripts/seer-frames.sh):
//   idle.mp4    breeze loop in her opening pose (still S at both ends)
//   turn-*.jpg  the turn S -> E as frames, scrubbed by scroll on a canvas
//   end.mp4     breeze loop once she's looking over the parapet (still E at both ends)
// The canvas always shows the current turn frame; the loops sit above it and fade in
// only at either end of the turn, so fading one out reveals the matching frame beneath.
// The hero is sticky: the page content after it (its next sibling, which has an opaque
// background) slides up over her, so her head stays in view for the whole turn.

const TURN_SPAN = 0.5; // the turn completes after scrolling this fraction of the hero's height (or less on a short page)
const src = (i: number) => `/seer/turn-${String(i + 1).padStart(3, "0")}.jpg`;

type Phase = "idle" | "turn" | "end";

export function Seer() {
  const hero = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const idle = useRef<HTMLVideoElement>(null);
  const end = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; // poster only
    const box = hero.current!, ctx = canvas.current!.getContext("2d")!;
    const loops = { idle: idle.current!, end: end.current! };
    const frames: (HTMLImageElement | null)[] = Array(meta.frames).fill(null);
    let drawn = -1, want = 0, phase: Phase | null = null, raf = 0, gone = false;

    const draw = () => {
      // Nearest frame that has loaded, so fast scrolling during preload never blanks.
      for (let d = 0; d < meta.frames; d++) {
        const i = [want - d, want + d].find((j) => frames[j]);
        if (i === undefined) continue;
        if (i !== drawn) { ctx.drawImage(frames[i]!, 0, 0, meta.width, meta.height); drawn = i; }
        return;
      }
    };

    const setPhase = (next: Phase) => {
      if (next === phase) return;
      phase = next;
      box.dataset.phase = next;
      for (const [name, v] of Object.entries(loops)) {
        if (name === next) { v.currentTime = 0; v.play().catch(() => {}); } // restart on its shared end frame
        else v.pause();
      }
    };

    const update = () => {
      raf = 0;
      const h = box.offsetHeight, y = Math.max(0, scrollY);
      // On a short page, finish the turn within the scroll the page actually has.
      const span = Math.min(h * TURN_SPAN, document.documentElement.scrollHeight - innerHeight) || 1;
      want = Math.round(Math.min(1, y / span) * (meta.frames - 1));
      draw();
      const covered = (box.nextElementSibling?.getBoundingClientRect().top ?? Infinity) <= 0;
      setPhase(covered ? "turn" : want === 0 ? "idle" : want === meta.frames - 1 ? "end" : "turn"); // "turn" pauses both loops
    };
    const onScroll = () => { raf ||= requestAnimationFrame(update); };

    // Load in order, so the start of the turn is ready first.
    (async () => {
      for (let i = 0; i < meta.frames && !gone; i++) {
        const img = new Image();
        // onload rather than decode(): decode() stalls in background tabs.
        const ok = await new Promise<boolean>((done) => { img.onload = () => done(true); img.onerror = () => done(false); img.src = src(i); });
        if (!ok) continue;
        frames[i] = img;
        if (Math.abs(i - want) < Math.abs(drawn - want) || drawn < 0) draw();
      }
    })();

    for (const v of Object.values(loops)) v.muted = true; // iOS only autoplays muted video
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={hero} className={s.hero} role="img" aria-label="Veleda, the seer, at the parapet">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/seer/poster.jpg" alt="" className={s.layer} fetchPriority="high" />
      <canvas ref={canvas} width={meta.width} height={meta.height} className={s.layer} />
      <video ref={idle} className={`${s.layer} ${s.idle}`} src="/seer/idle.mp4" muted loop playsInline preload="auto" aria-hidden />
      <video ref={end} className={`${s.layer} ${s.end}`} src="/seer/end.mp4" muted loop playsInline preload="auto" aria-hidden />
    </div>
  );
}
