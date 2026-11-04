"use client";

// Launch preview (/?preview=launch; /?preview=off leaves it): shows how real-money onboarding would
// work, with a simulated payment. The credit that follows is real test VCR, so every trade after it
// is still on-chain. The normal site is unchanged. Remembered in localStorage: a per-viewer
// convenience, so a blocked or cleared store just drops back to the normal site on the next load.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "./session";
import { vcr } from "@/lib/veleda/timeline";
import { launchPreviewOn } from "./preview-mode";

const depositKey = (address: string) => `veleda.preview.deposited.${address}`;

interface Preview {
  active: boolean;
  /** This wallet has made a simulated deposit, so the next one skips the identity step. */
  deposited: boolean;
  markDeposited: () => void;
  adding: boolean;
  openAddMoney: () => void;
  closeAddMoney: () => void;
}

const Ctx = createContext<Preview | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const { address } = useSession();
  const [active, setActive] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setActive(launchPreviewOn());
  }, []);

  useEffect(() => {
    if (!address) return setDeposited(false);
    try {
      setDeposited(localStorage.getItem(depositKey(address)) === "1");
    } catch {}
  }, [address]);

  const markDeposited = useCallback(() => {
    setDeposited(true);
    try {
      if (address) localStorage.setItem(depositKey(address), "1");
    } catch {}
  }, [address]);
  const openAddMoney = useCallback(() => setAdding(true), []);
  const closeAddMoney = useCallback(() => setAdding(false), []);

  const value = useMemo(
    () => ({ active, deposited: active && deposited, markDeposited, adding, openAddMoney, closeAddMoney }),
    [active, deposited, markDeposited, adding, openAddMoney, closeAddMoney],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreview(): Preview {
  const p = useContext(Ctx);
  if (!p) throw new Error("usePreview outside PreviewProvider");
  return p;
}

/** Formats amounts as VCR, or as dollars throughout the launch preview (1 VCR stands in for $1). */
export function useMoney() {
  const { active: dollars } = usePreview();
  return useMemo(
    () => ({
      dollars,
      /** "12.50", or "$12.50" in dollars. */
      amount: (v: number) => (dollars ? `$${vcr(v)}` : vcr(v)),
      /** The unit shown after amount(): "VCR", or nothing in dollars. */
      unit: dollars ? "" : "VCR",
      /** "12.50 VCR", or "$12.50" in dollars. */
      full: (v: number) => (dollars ? `$${vcr(v)}` : `${vcr(v)} VCR`),
      /** Rounded, for market volume: "1,234 VCR", or "$1,234" in dollars. */
      rounded: (v: number) => {
        const n = Math.round(v).toLocaleString("en-GB");
        return dollars ? `$${n}` : `${n} VCR`;
      },
      /** A whole-or-two-decimals stake: "20 VCR", or "$20" in dollars. */
      stake: (v: number) => {
        const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
        return dollars ? `$${n}` : `${n} VCR`;
      },
    }),
    [dollars],
  );
}
