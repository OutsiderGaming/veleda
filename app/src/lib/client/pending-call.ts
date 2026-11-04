// A call waiting on sign-in. Google's sign-in can leave the page, so the window and stake are kept in
// sessionStorage to bring the buy sheet back and finish the call. Kept for 10 minutes at most.
const KEY = "veleda.pendingCall";
const MAX_AGE_MS = 10 * 60_000;

export interface PendingCall {
  market: string;
  from: number;
  to: number;
  stake: number;
}

export function savePendingCall(call: PendingCall) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...call, at: Date.now() }));
  } catch {}
}

export function clearPendingCall() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

/** The waiting call for this market (and this window, if given), or null. */
export function readPendingCall(market: string, range?: { from: number; to: number }): PendingCall | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as (PendingCall & { at: number }) | null;
    if (!c || c.market !== market || Date.now() - c.at > MAX_AGE_MS) return null;
    if (range && (c.from !== range.from || c.to !== range.to)) return null;
    return c;
  } catch {
    return null;
  }
}
