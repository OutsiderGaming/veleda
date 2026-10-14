"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTRO_KEY } from "./intro-key";
import s from "./Intro.module.css";

// Full-screen intro clip, once per browser session (each time the app is opened); a tap skips it.
// The root layout's inline script marks <html data-intro="seen"> before first paint on later loads
// in the session, or when the viewer prefers reduced motion, so the overlay never flashes up.
// Source: design/source/VeledaIntro.mov →
//   ffmpeg -i VeledaIntro.mov -map 0:v:0 -an -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 24 -preset slow -movflags +faststart app/public/intro.mp4

export function Intro() {
  const [state, setState] = useState<"on" | "leaving" | "gone">("on");
  const video = useRef<HTMLVideoElement>(null);

  const leave = useCallback(() => setState((st) => (st === "on" ? "leaving" : st)), []);

  // Unmount after the 400ms fade. A timer, not animationend, which never fires in a background tab.
  useEffect(() => {
    if (state !== "leaving") return;
    const t = setTimeout(() => {
      document.documentElement.dataset.intro = "seen"; // so a remount (e.g. a new Shell) doesn't replay it
      setState("gone");
    }, 400);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (document.documentElement.dataset.intro === "seen") { setState("gone"); return; }
    try { sessionStorage.setItem(INTRO_KEY, "1"); } catch {}
    const v = video.current!;
    v.muted = true; // iOS only autoplays muted video
    v.play().catch(leave); // autoplay refused (e.g. iOS Low Power Mode): straight to the app
    const stalled = setTimeout(() => { if (v.currentTime === 0) leave(); }, 3_000); // too slow to load
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") leave(); };
    addEventListener("keydown", onKey);
    return () => { clearTimeout(stalled); removeEventListener("keydown", onKey); };
  }, [leave]);

  if (state === "gone") return null;
  return (
    <div className={`${s.intro} ${state === "leaving" ? s.leaving : ""}`} onClick={leave} role="button" aria-label="Skip intro">
      <video ref={video} className={s.video} src="/intro.mp4" muted playsInline preload="auto" onEnded={leave} aria-hidden />
    </div>
  );
}
