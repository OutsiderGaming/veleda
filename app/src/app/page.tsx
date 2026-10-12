"use client";

// Week 1 onboarding test: sign in with email or Google, get a Solana wallet
// silently, receive 100 VCR, then sign a transaction (send 1 VCR back) from a
// wallet that has never held SOL. The server pays every fee and rent deposit.

import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase64Decoder, getBase64Encoder } from "@solana/kit";
import { useCallback, useEffect, useState } from "react";

type Step = { text: string; status: "ok" | "err"; signature?: string; seconds: number };
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export default function Home() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0];

  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [balance, setBalance] = useState<{ sol: number; vcr: number } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const res = await fetch(`/api/balance?owner=${wallet.address}`);
    if (res.ok) setBalance(await res.json());
  }, [wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const log = (text: string, status: Step["status"], signature?: string) =>
    setSteps((s) => [...s, { text, status, signature, seconds: (Date.now() - startedAt) / 1000 }]);

  async function api(path: string, body?: unknown) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    return json;
  }

  async function claim() {
    setBusy(true);
    try {
      const r = await api("/api/airdrop");
      if (r.status === "already-claimed") log("Already claimed your 100 VCR", "ok");
      else log("Received 100 VCR (server paid fee and rent)", "ok", r.signature);
    } catch (e) {
      log(`Claim failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function sendBack() {
    if (!wallet) return;
    setBusy(true);
    try {
      const { transaction } = await api("/api/transfer/build");
      const { signedTransaction } = await signTransaction({ transaction: getBase64Encoder().encode(transaction) as Uint8Array, wallet });
      const { signature } = await api("/api/transfer/submit", { transaction: getBase64Decoder().decode(signedTransaction) });
      log("Sent 1 VCR back: you signed, the server paid the fee", "ok", signature);
    } catch (e) {
      log(`Send failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <main>
      <h1>VELEDA</h1>
      <p className="sub">Onboarding test · devnet</p>

      <div className="card row">
        <span className="label">Since page load</span>
        <span className="clock">{((now - startedAt) / 1000).toFixed(1)}s</span>
      </div>

      {!ready ? (
        <div className="card">Loading…</div>
      ) : !authenticated ? (
        <div className="card">
          <p>Sign in with email or Google. A wallet is created for you; no crypto setup.</p>
          <button onClick={login}>Sign in</button>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="label">Your wallet</div>
            <div className="mono">{wallet?.address ?? "Creating…"}</div>
            {balance && (
              <div className="row" style={{ marginTop: 10 }}>
                <span>{balance.vcr.toFixed(2)} VCR <span className="label">· test money</span></span>
                <span className="label">{balance.sol} SOL</span>
              </div>
            )}
          </div>
          <div className="card">
            <button onClick={claim} disabled={busy || !wallet}>1 · Claim 100 VCR</button>
            <button onClick={sendBack} disabled={busy || !wallet || !balance?.vcr}>2 · Send 1 VCR back (you sign, we pay)</button>
            <button className="secondary" onClick={logout} disabled={busy}>Sign out</button>
          </div>
        </>
      )}

      {steps.length > 0 && (
        <div className="card">
          {steps.map((s, i) => (
            <div key={i} className="step">
              <span className="clock">{s.seconds.toFixed(1)}s</span>
              <span className={s.status}>
                {s.text}
                {s.signature && (
                  <>
                    {" · "}
                    <a href={explorer(s.signature)} target="_blank" rel="noreferrer">tx</a>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
