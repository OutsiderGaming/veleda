"use client";

// Launch preview: how adding real money would work, one step at a time. The payment is simulated and
// nothing is collected: no card fields, no ID upload. The identity step is shown, not hidden, because
// it's the one slow part of a real first deposit, and it only appears the first time.
import { useEffect, useState } from "react";
import { usePreview } from "@/lib/client/preview";
import { useSession } from "@/lib/client/session";
import { vcr } from "@/lib/veleda/timeline";
import s from "./AddMoneySheet.module.css";

const AMOUNTS = [20, 50, 100];
type Step = "amount" | "verify" | "pay" | "done";

export function AddMoneySheet() {
  const session = useSession();
  const { deposited, markDeposited, closeAddMoney } = usePreview();
  const [firstDeposit] = useState(!deposited);
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && closeAddMoney();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [busy, closeAddMoney]);

  async function simulatePayment() {
    setBusy(true);
    setError(null);
    try {
      await session.request("/api/preview/deposit", { amount });
      await session.refresh();
      markDeposited();
      setStep("done");
    } catch (e) {
      const m = (e as Error).message;
      setError(m.length > 120 ? "That didn't go through. Try again." : m);
    } finally {
      setBusy(false);
    }
  }

  const balance = session.balance ?? 0;
  return (
    <>
      <div className={s.backdrop} onClick={() => !busy && closeAddMoney()} />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="add-money-title">
        <div className={s.tag}>Launch preview · simulated payment</div>

        {step === "amount" && (
          <>
            <h2 id="add-money-title" className={s.title}>Add money</h2>
            <div className={s.chips}>
              {AMOUNTS.map((a) => (
                <button key={a} className={`${s.chip} ${a === amount ? s.chipOn : ""}`} onClick={() => setAmount(a)}>${a}</button>
              ))}
            </div>
            <p className={s.text}>At launch you&apos;d pay by card or mobile wallet. A payment partner converts it to USDC in your own wallet, shown here as dollars.</p>
            <p className={s.note}>Already hold USDC? At launch you could deposit it directly.</p>
            <button className={s.primary} onClick={() => setStep(firstDeposit ? "verify" : "pay")}>CONTINUE</button>
          </>
        )}

        {step === "verify" && (
          <>
            <h2 id="add-money-title" className={s.title}>Verify your identity</h2>
            <p className={s.lead}>First deposit only.</p>
            <p className={s.text}>At launch you&apos;d confirm your country and age, and our payment partner would ask for ID. It&apos;s the one slower step, and it can take a few minutes.</p>
            <p className={s.note}>In this preview we skip it. Nothing is collected.</p>
            <button className={s.primary} onClick={() => setStep("pay")}>CONTINUE</button>
          </>
        )}

        {step === "pay" && (
          <>
            <h2 id="add-money-title" className={s.title}>Pay ${amount}</h2>
            <dl className={s.rows}>
              <div><dt>You add</dt><dd>${amount}.00</dd></div>
              <div><dt>Payment partner&apos;s fee</dt><dd>Shown here at launch</dd></div>
              <div><dt>Network fees</dt><dd>Paid by Veleda</dd></div>
            </dl>
            <p className={s.note}>Simulated: no money moves and nothing is charged. You get ${amount} of test money.</p>
            {error && <p className={s.error}>{error}</p>}
            <button className={s.primary} disabled={busy} onClick={simulatePayment}>{busy ? "ADDING…" : "SIMULATE PAYMENT"}</button>
          </>
        )}

        {step === "done" && (
          <>
            <div className={s.tick}>✓</div>
            <h2 id="add-money-title" className={s.title}>${amount} added</h2>
            <p className={s.text}>
              Your balance is ${vcr(balance)}{balance > amount + 0.005 ? ", including your remaining free credits" : ""}. It&apos;s all still test money.
            </p>
            <button className={s.primary} onClick={closeAddMoney}>DONE</button>
          </>
        )}

        {step !== "done" && <button className={s.cancel} disabled={busy} onClick={closeAddMoney}>Cancel</button>}
      </div>
    </>
  );
}
