"use client";

import { useEffect } from "react";
import type { Rules } from "@/lib/veleda/rules";
import s from "./RulesSheet.module.css";

/** Bottom sheet with a market's full resolution criteria. Closes on the button, a backdrop tap or Escape. */
export function RulesSheet({ question, rules, onClose }: { question: string; rules: Rules; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <h2 id="rules-title" className={s.title}>Resolution criteria</h2>
        <p className={s.question}>{question}</p>
        {rules.body.map((p) => <p key={p} className={s.text}>{p}</p>)}
        {rules.sources && (
          <>
            <p className={s.text}>{rules.sources.quorum}</p>
            <ol className={s.sources}>
              {rules.sources.outlets.map((o) => <li key={o}>{o}</li>)}
            </ol>
          </>
        )}
        {rules.after?.map((p) => <p key={p} className={s.text}>{p}</p>)}
        <button className={s.close} onClick={onClose}>Close</button>
      </div>
    </>
  );
}
