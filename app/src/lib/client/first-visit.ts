"use client";

import { useEffect, useState } from "react";

const KEY = "veleda.visited";

// True only on this browser's first visit (after mount, so server and client renders agree).
// Remembered in localStorage: a per-viewer convenience, so a blocked or cleared store just shows it again.
export function useFirstVisit() {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return;
      localStorage.setItem(KEY, "1");
    } catch {}
    setFirst(true);
  }, []);
  return first;
}
