"use client";

// Developer test page (/dev, not linked from the app): sign in with email or
// Google, get a Solana wallet silently, receive 100 VCR, sign a transfer, then
// buy windows on both demo markets and cash them out, all from a wallet that
// has never held SOL. The server pays every fee and rent deposit.

import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase64Decoder, getBase64Encoder } from "@solana/kit";
import { useCallback, useEffect, useState } from "react";

type Step = { text: string; status: "ok" | "err"; signature?: string; seconds: number };
type Market = { name: string; firstOpenAtom: number; atoms: number; resolved: boolean };
type Position = { address: string; market: string; from: number; to: number; shares: number; value: number | null; status: string };
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
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const res = await fetch(`/api/balance?owner=${wallet.address}`);
    if (res.ok) setBalance(await res.json());
    const pos = await fetch("/api/positions", { headers: { authorization: `Bearer ${await getAccessToken()}` } });
    if (pos.ok) setPositions((await pos.json()).positions);
  }, [wallet, getAccessToken]);

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

  /** Builds on the server, signs in the wallet, relays through the server. */
  async function signAndSubmit(path: string, body: unknown, describe: (built: Record<string, unknown>) => string) {
    if (!wallet) return;
    setBusy(true);
    try {
      const built = await api(path, body);
      const { signedTransaction } = await signTransaction({ transaction: getBase64Encoder().encode(built.transaction) as Uint8Array, wallet });
      const { signature } = await api("/api/submit", { transaction: getBase64Decoder().decode(signedTransaction) });
      log(describe(built), "ok", signature);
    } catch (e) {
      log(`Failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const sendBack = () => signAndSubmit("/api/transfer/build", {}, () => "Sent 1 VCR back: you signed, the server paid the fee");

  async function buy(name: string, offset: number, width: number) {
    const { markets } = (await (await fetch("/api/markets")).json()) as { markets: Market[] };
    const m = markets.find((x) => x.name === name)!;
    const from = Math.min(m.firstOpenAtom + offset, m.atoms - 1);
    const to = Math.min(from + width - 1, m.atoms - 1);
    await signAndSubmit("/api/trade/buy", { market: name, from, to, stake: 20 }, (b) => {
      const q = b.quote as { shares: number; multiplier: number };
      return `Bought ${name} [${from}, ${to}]: ${q.shares.toFixed(2)} shares for 20 VCR (${q.multiplier.toFixed(2)}x)`;
    });
  }

  const cashOut = (p: Position) =>
    signAndSubmit("/api/trade/sell", { position: p.address }, (b) => `Cashed out ${p.market} [${p.from}, ${p.to}] for ~${(b.quote as { proceeds: number }).proceeds.toFixed(2)} VCR`);

  return (
    <main className="dev">
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
          {positions.length > 0 && (
            <div className="card">
              <div className="label">Your windows</div>
              {positions.map((p) => (
                <div key={p.address} className="row" style={{ marginTop: 8 }}>
                  <span>{p.market} [{p.from}, {p.to}] · {p.shares.toFixed(2)} shares</span>
                  {p.status === "open" && p.value !== null ? (
                    <button className="secondary" onClick={() => cashOut(p)} disabled={busy}>cash out │ {p.value.toFixed(2)} VCR</button>
                  ) : (
                    <span className="label">{p.status}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <button onClick={claim} disabled={busy || !wallet}>1 · Claim 100 VCR</button>
            <button onClick={sendBack} disabled={busy || !wallet || !balance?.vcr}>2 · Send 1 VCR back (you sign, we pay)</button>
            <button onClick={() => buy("flagship", 296, 31)} disabled={busy || !wallet || (balance?.vcr ?? 0) < 20}>3 · Predict the future │ 20 VCR (flagship, ~day 300)</button>
            <button onClick={() => buy("fast", 2, 6)} disabled={busy || !wallet || (balance?.vcr ?? 0) < 20}>4 · Predict the future │ 20 VCR (fast, 6 hours)</button>
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
