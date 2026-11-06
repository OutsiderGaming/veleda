// Regenerates index.html and compositions/ from the script, voice and footage. Run: node build.mjs
import { execFileSync as X } from "node:child_process";
import { existsSync as has, writeFileSync as W, mkdirSync } from "node:fs";

const PARTS = [
  ["problem", [
    ["p1a", "Prediction markets are exploding. Kalshi and Polymarket combined have increased their trading volume nearly 20 times in the 12 months to September."],
    ["p1b", "But ask them when something will happen, and you get this: a handful of fixed deadlines, each its own yes-or-no bet. Think it lands in the second week of June? There's no button for that."],
    ["p1c", "Veleda has one market for the whole timeline. You buy any stretch of time: an hour, a week, a year. One trade, at one live price."]]],
  ["flow", [
    ["f1", "Here's someone who has never used Solana. They open a link and can browse without an account. This is the launch flow, shown with test money. The market is a fictional one we can run at speed: when will BTC first hit two hundred thousand dollars?"],
    ["f2", "They drag across a stretch of time and make the call. The odds update as they choose how much time to cover: pick a single hour for a lottery ticket, or a wide range for a safer bet. One Google sign-in creates their wallet. There's no seed phrase, and they never need to buy SOL, because Veleda pays the network fees."],
    ["f3", "Then they add money, by card or mobile wallet. The first deposit includes an ID check from our payment partner, which can take a few minutes, and only happens once. The money arrives as USDC in their own wallet, shown simply as dollars."],
    ["f4", "And their call goes straight through, with no second tap: twenty dollars on that window."],
    ["f5", "Now a second call, on a different window. However much time it covers, it's one trade."],
    ["f6", "As time passes, hours drop away, the ones left become more likely, and the cash-out value moves."],
    ["f7", "No waiting for the event, and no waiting for a buyer. The market maker always quotes a price, so they sell and take the profit."],
    ["f8", "Then the event happens. The winning hour is recorded on-chain, and window B contains it, so it pays out to their balance."],
    ["f9", "From there, they can send it to their bank through our payment partner, or send USDC to any wallet."]]],
  ["tree", [
    ["s1", "So how does one market price every hour? On Solana, the whole timeline lives in a single account, as a tree of prices."],
    ["s2", "Five years of hours is about forty-four thousand slots, and that fits too: three and a half megabytes, inside Solana's ten-megabyte limit."],
    ["s3", "Buying a window updates a few branches, not every hour beneath them. On our live three-year market, a day or nearly two years is one atomic trade, at similar cost and low fees."]]],
  ["lp", [
    ["l1", "Today the platform funds every market. Next, we open that to liquidity providers. Their maximum loss is known and funded up front."],
    ["l2", "They'll set the opening odds, so a provider who knows the market better gives away less to the first traders, and they earn two and a half percent of every buy and sell. It isn't guaranteed profit, and the risk is real, but it's capped and it's priced."],
    ["l3", "And that's Veleda, a new form of prediction market where users can buy and sell future time, in any increment they want, whenever they want."],
    ["l4", "Veleda. The market of seers."]]],
];
const GAP = 0.4, PART_GAP = 0.8, TAIL = 1.6;
// Phone footage plays at most this much faster than real time; a beat whose clip is longer than
// its voice grows to fit, and every clip is sped up or slowed to fill its beat exactly.
const MAX_RATE = 1.6, MAX_RATE_OF = { f5: 1.2 }; const RATE = {}; // f5: the second drag should read at near real speed
const spoken = (s) => s.replaceAll("Veleda", "Velleda").replaceAll("SOL", "sol");
const dur = (f) => +X("ffprobe", ["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim();

// ---------- timing
let clock = 0; const T = {}, SC = {}; const audio = [], caps = [];
for (const [part, beats] of PARTS) {
  const sc = clock;
  for (const [id, text] of beats) {
    let f = `voice/final/${id}.wav`;
    if (!has(f)) {
      f = `voice/scratch/${id}.wav`;
      if (!has(f)) { const a = `voice/scratch/${id}.aiff`;
        X("say", ["-v","Daniel","-r","172","-o",a,spoken(text)]);
        X("ffmpeg", ["-y","-loglevel","error","-i",a,"-ar","44100","-ac","1",f]); X("rm",[a]); }
    }
    const d = dur(f);
    const fp = `footage/${id}.mp4`, fd = has(fp) ? dur(fp) : 0;
    const bd = Math.max(d + GAP, fd / (MAX_RATE_OF[id] ?? MAX_RATE));
    if (fd) RATE[id] = +(fd / bd).toFixed(4);
    T[id] = { s: clock - sc, e: clock - sc + bd, d: bd };
    audio.push({ id, f, s: clock, d });
    // captions: split at punctuation, then by length, timed by characters
    const parts = text.match(/[^.,:?]+[.,:?]*/g).map((x) => x.trim()); const lines = [];
    for (const p of parts) { const l = lines[lines.length - 1];
      if (l && (l + " " + p).length <= 70) lines[lines.length - 1] = l + " " + p;
      else if (p.length <= 70) lines.push(p);
      else { let cur = ""; for (const w of p.split(" ")) { if ((cur + " " + w).length > 66) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); } if (cur) lines.push(cur); } }
    const total = lines.reduce((n, l) => n + l.length, 0); let t = clock;
    for (const l of lines) { const cd = (d * l.length) / total; caps.push({ t, d: cd, l }); t += cd; }
    clock += bd;
  }
  clock += PART_GAP - GAP;
  SC[part] = { s: sc, d: clock - sc };
}
SC.lp.d += TAIL; const TOTAL = +(clock + TAIL).toFixed(2);
const n3 = (x) => +x.toFixed(3);

// ---------- shared
const FONT = `@font-face{font-family:"Cinzel";src:url("assets/fonts/Cinzel-Variable.ttf");font-weight:400 900}
@font-face{font-family:"Manrope";src:url("assets/fonts/Manrope-Variable.ttf");font-weight:200 800}`;
const BASE = (id) => `[data-composition-id="${id}"]{position:relative;width:100%;height:100%;background:#0D0F0E;color:#EDE4D6;font-family:"Manrope",sans-serif;overflow:hidden}
[data-composition-id="${id}"] *{box-sizing:border-box}
[data-composition-id="${id}"] .glow{position:absolute;width:1300px;height:1300px;border-radius:50%;background:radial-gradient(circle,rgba(233,168,103,.17),rgba(233,168,103,0) 68%)}
[data-composition-id="${id}"] .serif{font-family:"Cinzel",serif;font-weight:700}
[data-composition-id="${id}"] .g{position:absolute;opacity:0}`;
const HELP = `const tl=gsap.timeline({paused:true});
const IN=(e,t,o={})=>tl.fromTo(e,{opacity:0,y:o.y??26,scale:o.scale??1},{opacity:1,y:0,scale:1,duration:o.d??.55,ease:o.ease??"power3.out",stagger:o.stagger??0,immediateRender:false},t);
const OUT=(e,t,d=.4)=>tl.fromTo(e,{opacity:1},{opacity:0,duration:d,ease:"power2.in",immediateRender:false},t);
const COUNT=(id,a,b,t,d,fmt,ease="power2.out")=>{const el=document.getElementById(id),o={v:a};el.textContent=fmt(a);tl.to(o,{v:b,duration:d,ease,onUpdate:()=>{el.textContent=fmt(o.v)}},t)};`;
const comp = (id, css, html, js) => `<!doctype html>
<html><head><meta charset="UTF-8" /></head><body><template id="${id}-template">
<div data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${n3(SC[id].d)}">
<style>${FONT}${BASE(id)}${css}</style>
${html}
<script>(function(){${HELP}
${js}
tl.to({}, {duration:${n3(SC[id].d)}}, 0);
window.__timelines["${id}"]=tl;})();</script>
</div></template></body></html>`;
const t = (id, k = "s") => n3(T[id][k]);

// ---------- 1. problem
{
  const bars = Array.from({ length: 84 }, (_, i) => { const h = 16 + 78 * Math.exp(-((i - 34) ** 2) / 480) + 7 * Math.sin(i * 1.7) ** 2; return `<i style="height:${h.toFixed(1)}%"></i>`; }).join("");
  const rows = [["30 Jun 2028", 18], ["30 Sep 2028", 24], ["31 Dec 2028", 31], ["30 Jun 2029", 44]].map(([d, y]) => `<div class="row"><b>${d}</b><span class="pct">${y}%</span><span class="yes">Yes ${y}¢</span><span class="no">No ${100 - y}¢</span></div>`).join("");
  W("compositions/problem.html", comp("problem", `
  .a{inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:120px}
  .stats{display:flex;align-items:center;gap:90px}.stat{width:600px}.stat .n{font-size:164px;color:#F6C792;line-height:1.1}.stat .l{font-size:38px;color:#BFB5A5;margin-top:10px}
  .arrow{font-size:90px;color:#E9A867}.h{font-size:64px;margin-bottom:64px}.src{font-size:26px;color:#8E8577;margin-top:60px}
  .b{left:360px;top:70px;width:1200px}.tag{font-size:26px;color:#BFB5A5;margin-bottom:18px}
  .card{background:#151816;border:2px solid #2C2A24;border-radius:18px;padding:34px 44px}.q{font-size:48px;font-weight:800;margin-bottom:20px}
  .row{display:flex;align-items:center;gap:30px;padding:19px 0;border-top:2px solid #2C2A24;font-size:32px}.row b{width:340px;font-weight:600}.pct{width:130px;color:#EDE4D6;font-weight:800}
  .yes,.no{width:230px;text-align:center;padding:12px 0;border-radius:10px;font-size:29px;font-weight:700}.yes{background:#1c2a1d;color:#9CCB8E}.no{background:#2e1c18;color:#E8907A}
  .miss{left:360px;top:735px;width:1200px;border:3px dashed #E9A867;border-radius:18px;padding:26px 44px;display:flex;justify-content:space-between;font-size:38px;font-weight:800;background:#0D0F0E}.miss em{font-style:normal;color:#E8907A}
  .c{left:150px;top:70px;width:1620px}.ch{font-size:78px;margin-bottom:12px}.cs{font-size:36px;color:#BFB5A5;margin-bottom:84px}
  .tl{position:relative;height:430px;display:flex;align-items:flex-end;gap:5px;border-bottom:3px solid #2C2A24}
  .tl i{flex:1;background-color:#A9743F;background-image:radial-gradient(circle,rgba(13,15,14,.55) 1px,transparent 1.3px);background-size:5px 5px}
  .win{position:absolute;top:-8px;bottom:-3px;left:600px;width:18px;background:rgba(246,199,146,.26);border-left:5px solid #F6C792;border-right:5px solid #F6C792}
  .chip{position:absolute;left:600px;top:-66px;opacity:0;background:#2A221A;border:2px solid #E9A867;color:#F6C792;border-radius:10px;padding:8px 20px;font-size:32px;font-weight:800;width:190px;text-align:center}
  .axis{display:flex;justify-content:space-between;font-size:26px;color:#BFB5A5;margin-top:12px}`,
  `<div class="glow" style="left:310px;top:-250px"></div>
  <div class="g a" id="pa"><div class="h serif">Prediction markets are exploding</div>
    <div class="stats"><div class="stat"><div class="n serif" id="n1">$0bn</div><div class="l">in a week, Sept 2025</div></div><div class="arrow">→</div><div class="stat" id="st2"><div class="n serif" id="n2">$0bn</div><div class="l">in a week, Sept 2026</div></div></div>
    <div class="src">Kalshi and Polymarket combined. Sources: Dune via CoinDesk, DeFi Rate.</div></div>
  <div class="g b" id="pb"><div class="tag">What a "when" market looks like today · Illustration, made-up prices</div><div class="card"><div class="q">BTC hits $200K by…?</div>${rows}</div></div>
  <div class="g miss" id="pm"><span>Second week of June 2028?</span><em>No market</em></div>
  <div class="g c" id="pc"><div class="ch serif">One market. The whole timeline.</div><div class="cs">Buy any stretch of time, in one trade, at one live price.</div>
    <div class="tl" id="ptl">${bars}<div class="win" id="pw"></div><div class="chip" id="pch"></div></div>
    <div class="axis"><span>Jun 2028</span><span>Jun 2029</span><span>Jun 2030</span><span>Jun 2031</span></div></div>`,
  `const fm=v=>"$"+v.toFixed(v<6?2:0)+"bn",A=${t("p1a")};
  tl.fromTo(".glow",{scale:.9},{scale:1.12,duration:${n3(SC.problem.d)},ease:"none"},0);
  IN("#pa",A+.1);COUNT("n1",0,1,A+.4,1.6,v=>"~$"+(v<1?v.toFixed(1):"1")+"bn");IN("#st2",A+${n3(T.p1a.d * .5)},{y:0});COUNT("n2",0,19.46,A+${n3(T.p1a.d * .5)},1.8,v=>"$"+v.toFixed(2)+"bn");
  OUT("#pa",${t("p1b")}-.35);
  IN("#pb",${t("p1b")}+.05);IN("#pm",${t("p1b") + T.p1b.d * .6},{scale:.94});
  OUT(["#pb","#pm"],${t("p1c")}-.35);
  const C=${t("p1c")},D=${n3(T.p1c.d)};IN("#pc",C+.05);
  const ch=document.getElementById("pch");
  [["1 hour",18],["1 week",60],["1 year",540]].forEach(([l,w],i)=>{const s=C+D*(.36+i*.11);
    tl.fromTo("#pw",{width:i?[18,60][i-1]:18},{width:w,duration:.5,ease:"power2.inOut",immediateRender:false},s);
    if(i===0)tl.fromTo(ch,{opacity:0},{opacity:1,duration:.2,immediateRender:false},s);
    tl.set(ch,{textContent:l},s);});`));
}

// ---------- 2. flow
{
  const B = {
    f1: ["The market", "Browse first. No account needed.", "Open the Fictional · 2028 BTC market.", "1-timeline-month"],
    f2: ["One sign-in", "", "Drag window A: 14 June, midday to 6pm, stake $20. Tap predict the future. Sign in with Google.", "2-dragging-a-window"],
    f3: ["Add money", "Card or mobile wallet. ID check on the first deposit only.", "Add money opens by itself: $50, then identity, then payment.", null],
    f4: ["The call goes through", "No second tap.", "Tap Done. The call places itself, then the success screen.", "3-buy-sheet"],
    f5: ["A second call", "Narrow pays more. Wide is safer.", "Window B: 15 June, 6am to midday, stake $20. Open Positions.", "3-buy-sheet"],
    f6: ["Time passes", "Two days later. Demo clock, sped up.", "Positions updating after the clock moves.", "4-your-positions"],
    f7: ["Cash out", "A live price, any time.", "Cash out window A.", "4-your-positions"],
    f8: ["It happens", "One day later. Winning hour recorded on-chain.", "Tap Claim on window B.", "4-your-positions"],
    f9: ["Take it out", "To a bank or any wallet.", "Account: Withdrawing, at launch.", null],
  };
  const ids = Object.keys(B); let slots = "", side = "", js = "";
  for (const id of ids) {
    const [h, sub, shot, img] = B[id]; const s = t(id), d = n3(T[id].d);
    const footage = `footage/${id}.mp4`;
    slots += has(footage)
      ? `<video id="v-${id}" class="clip vid" src="${footage}" muted data-start="${s}" data-duration="${d}" data-playback-rate="${RATE[id]}" data-track-index="1"></video>`
      : `<div id="slot-${id}" class="clip slot" data-start="${s}" data-duration="${d}" data-track-index="1">${img ? `<img src="assets/${img}.png" alt="" />` : ""}<div class="ph"><b>Rough cut</b><span>${shot}</span></div></div>`;
    const extra = id === "f2" ? `<ul class="ticks"><li>Wallet created</li><li>No seed phrase</li><li>Network fees paid for them</li></ul>`
      : "";
    side += `<div class="g step" id="st-${id}"><div class="k">${ids.indexOf(id) + 1} of ${ids.length}</div><div class="h serif">${h}</div>${sub ? `<div class="sub">${sub}</div>` : ""}${extra}</div>`;
    js += `IN("#st-${id}",${s}+.05);OUT("#st-${id}",${n3(T[id].e)}-.3,.25);`;
    if (id === "f2") js += `IN("#st-f2 li",${s}+${n3(T.f2.d * .42)},{stagger:${n3(T.f2.d * .1)},y:14});`;
  }
  W("compositions/flow.html", comp("flow", `
  .phone{position:absolute;left:300px;top:40px;width:430px;height:860px;border-radius:52px;border:8px solid #2E2B25;background:#101311;overflow:hidden}
  .slot,.vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.32}
  .ph{position:absolute;left:24px;right:24px;bottom:40px;background:#151816;border:2px solid #E9A867;border-radius:16px;padding:20px;font-size:25px;line-height:1.35;color:#EDE4D6}.ph b{display:block;color:#F6C792;margin-bottom:8px}
  .step{left:860px;top:230px;width:940px}.k{font-size:28px;color:#BFB5A5;font-weight:700;margin-bottom:14px}.h{font-size:92px;line-height:1.1;color:#F6C792}.sub{font-size:42px;color:#EDE4D6;margin-top:24px;line-height:1.3}
  .ticks{list-style:none;padding:0;margin:32px 0 0;font-size:42px;line-height:1.7}.ticks li{opacity:0}.ticks li::before{content:"✓  ";color:#9CCB8E;font-weight:800}
  .term{margin-top:40px;background:#101311;border:2px solid #2C2A24;border-radius:14px;padding:26px 30px;font-family:ui-monospace,Menlo,monospace;font-size:27px;line-height:1.7;color:#EDE4D6}.term span{color:#E9A867}
  .lab{left:860px;top:60px;width:940px;font-size:27px;line-height:1.35;color:#F6C792;background:#2A221A;border:2px solid #E9A867;border-radius:10px;padding:12px 18px}`,
  `<div class="glow" style="left:900px;top:-300px"></div><div class="phone">${slots}</div>${side}
  <div class="g lab" id="lab">How it works at launch. Shown on devnet: test money, simulated payment. Launch depends on licensing.</div>`,
  `tl.fromTo(".glow",{scale:1},{scale:1.15,duration:${n3(SC.flow.d)},ease:"none"},0);
  ${js}
  IN("#lab",${t("f1")}+.1);`));
}

// ---------- 3. tree
{
  const CAP = 256, W0 = 1720, X0 = 100, H0 = 620, Y0 = 30, LV = 8;
  const span = (i) => { const l = Math.floor(Math.log2(i)), w = CAP >> l, a = (i - (1 << l)) * w; return [a, a + w - 1, l]; };
  const pos = (i) => { const [a, b, l] = span(i); return [X0 + (((a + b) / 2) * W0) / (CAP - 1), Y0 + (l * H0) / LV]; };
  const levels = Array.from({ length: LV + 1 }, () => "");
  for (let i = 1; i < 2 * CAP; i++) { const [x, y] = pos(i), l = span(i)[2]; const r = Math.max(2.2, 15 - l * 1.7);
    levels[l] += (i > 1 ? `<line x1="${pos(i >> 1)[0].toFixed(1)}" y1="${pos(i >> 1)[1].toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>` : "") + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`; }
  const cover = (a, b) => { const out = []; let l = a + CAP, r = b + CAP + 1; while (l < r) { if (l & 1) out.push(l++); if (r & 1) out.push(--r); l >>= 1; r >>= 1; } return out; };
  const lit = (id, a, b) => `<g id="${id}" class="lit" opacity="0"><rect x="${(X0 + (a * W0) / (CAP - 1) - 3).toFixed(1)}" y="${Y0 + H0 + 14}" width="${(((b - a) * W0) / (CAP - 1) + 6).toFixed(1)}" height="16"/>${cover(a, b).map((i) => { const [x, y] = pos(i); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(8, 20 - span(i)[2] * 1.5)}"/>`; }).join("")}</g>`;
  const FOCUS = 164, [fx, fy] = pos(CAP + FOCUS);
  // detail layer: 8 hours under one branch
  const dw = 215, dx = (i) => 100 + i * dw + 90; let det = "";
  const dn = (lvl, i) => { const n = 8 >> lvl; const c = ((i + 0.5) * 8) / (1 << (3 - lvl)) - 0.5; return [100 + 90 + c * dw, 24 + (3 - lvl) * 130 + 0]; };
  for (let lvl = 3; lvl > 0; lvl--) for (let i = 0; i < 1 << (3 - lvl); i++) { const [x, y] = dn(lvl, i); for (const k of [0, 1]) { const [cx, cy] = dn(lvl - 1, i * 2 + k); det += `<line x1="${x}" y1="${y}" x2="${cx}" y2="${cy}"/>`; } det += `<circle cx="${x}" cy="${y}" r="18"/>`; }
  const hours = Array.from({ length: 8 }, (_, i) => `<g><rect x="${dx(i) - 96}" y="414" width="192" height="130" rx="10"/><text x="${dx(i)}" y="466" class="tt">${String(9 + i).padStart(2, "0")}:00</text><text x="${dx(i)}" y="512" class="td">13 Jun 2028</text></g>`).join("");
  W("compositions/tree.html", comp("tree", `
  .hd{left:100px;top:56px;width:1720px;display:flex;justify-content:space-between;align-items:center}.hd .serif{font-size:62px;color:#F6C792}
  .frame{position:absolute;left:60px;top:190px;width:1800px;height:720px;border:3px solid #E9A867;border-radius:20px;overflow:hidden;background:#101311;opacity:0}
  .frame svg{position:absolute;left:0;top:0;width:1800px;height:720px}.flabel{position:absolute;left:28px;top:18px;font-size:28px;font-weight:800;color:#F6C792}
  .whole{position:absolute;inset:0}.whole line{stroke:#7A5A36;stroke-width:1.6}.whole circle{fill:#E9A867}.lit circle{fill:#F6C792;stroke:#0D0F0E;stroke-width:3}.lit rect{fill:#F6C792}
  .detail{position:absolute;inset:0;opacity:0}.detail line{stroke:#A9743F;stroke-width:3}.detail circle{fill:#E9A867}.detail rect{fill:#151816;stroke:#E9A867;stroke-width:3}.tt{fill:#F6C792;font:800 36px "Manrope";text-anchor:middle}.td{fill:#EDE4D6;font:600 24px "Manrope";text-anchor:middle}
  .dnote{position:absolute;left:110px;top:640px;font-size:30px;color:#EDE4D6;font-weight:700}
  .stats{left:100px;top:40px;width:1720px;display:flex;justify-content:space-between}.st .n{font-family:"Cinzel",serif;font-weight:700;font-size:62px;color:#F6C792}.st .l{font-size:26px;color:#BFB5A5}.meter{width:360px;height:14px;background:#2C2A24;margin-top:12px}.meter i{display:block;width:35%;height:100%;background:#E9A867}
  .cu{left:100px;top:34px;width:1720px;display:flex;gap:60px;align-items:center}.cu .c{flex:1}.cu .c b{font-size:32px}.bar{height:20px;background:#2C2A24;margin:10px 0 6px}.bar i{display:block;height:100%;background:#E9A867;transform-origin:left}.cu small{font-size:25px;color:#BFB5A5}`,
  `<div class="g hd" id="th"><span class="serif">One account. A tree of prices.</span></div>
  <div class="g stats" id="ts"><div class="st"><div class="n">43,800</div><div class="l">hours in five years</div></div><div class="st"><div class="n">16</div><div class="l">levels in the tree</div></div><div class="st"><div class="n">3.5 MB</div><div class="l">of Solana's 10 MB account limit</div><div class="meter"><i></i></div></div><div class="st" style="align-self:center;width:360px"><div class="l">Five-year size is calculated. It isn't live yet.</div></div></div>
  <div class="g cu" id="tc"><div class="c"><b>Buy 1 day</b><div class="bar"><i id="c1" style="width:35%"></i></div><small>about 70K of 200K compute units</small></div><div class="c"><b>Buy 700 days</b><div class="bar"><i id="c2" style="width:50%"></i></div><small>about 100K of 200K compute units</small></div><div style="width:340px;font-size:26px;color:#BFB5A5">Measured on the live three-year market</div></div>
  <div class="frame" id="tf"><div class="whole" id="tw"><svg viewBox="0 0 1920 768">${levels.map((g, i) => `<g class="lv" id="lv${i}">${g}</g>`).join("")}${lit("la", 118, 125)}${lit("lb", 22, 231)}</svg></div>
    <div class="detail" id="td"><svg viewBox="0 0 1920 768">${det}${hours}</svg><div class="dnote">Every hour is a leaf, priced on its own</div></div>
    <div class="flabel">One market account</div></div>`,
  `const S=${t("s1")},Z=${t("s2")},Zd=${n3(T.s2.d)},W=${t("s3")},Wd=${n3(T.s3.d)};
  tl.fromTo("#tf",{opacity:0,scale:.2},{opacity:1,scale:1,duration:.8,ease:"power3.out",immediateRender:false},S+.1);
  IN("#th",S+.1);
  for(let i=0;i<=${LV};i++)tl.fromTo("#lv"+i,{opacity:0},{opacity:1,duration:.3,immediateRender:false},S+.7+i*.18);
  OUT("#th",Z-.3,.25);IN("#ts",Z);
  const ox=${(fx / 1920 * 100).toFixed(2)}+"%",oy=${(((fy) / 768) * 100).toFixed(2)}+"%";
  gsap.set("#tw",{transformOrigin:ox+" "+oy});gsap.set("#td",{transformOrigin:ox+" "+oy});
  const zi=Z+.4,zo=Z+Math.max(4.2,Zd-2.2);
  tl.fromTo("#tw",{scale:1},{scale:7,duration:1.3,ease:"power2.inOut",immediateRender:false},zi);
  tl.fromTo("#tw",{opacity:1},{opacity:0,duration:.5,immediateRender:false},zi+.8);
  tl.fromTo("#td",{opacity:0,scale:.3},{opacity:1,scale:1,duration:.8,ease:"power2.out",immediateRender:false},zi+.75);
  tl.fromTo("#td",{opacity:1,scale:1},{opacity:0,scale:.3,duration:.6,ease:"power2.in",immediateRender:false},zo);
  tl.fromTo("#tw",{opacity:0},{opacity:1,duration:.4,immediateRender:false},zo+.3);
  tl.fromTo("#tw",{scale:7},{scale:1,duration:1.2,ease:"power2.inOut",immediateRender:false},zo+.1);
  OUT("#ts",W-.3,.25);IN("#tc",W);
  tl.fromTo(".lv",{opacity:1},{opacity:.38,duration:.4,immediateRender:false},W+.3);
  tl.fromTo("#la",{opacity:0},{opacity:1,duration:.3,immediateRender:false},W+.5);
  tl.fromTo("#c1",{scaleX:0},{scaleX:1,duration:.7,ease:"power2.out",immediateRender:false},W+.5);
  tl.fromTo("#la",{opacity:1},{opacity:0,duration:.25,immediateRender:false},W+Wd*.46);
  tl.fromTo("#lb",{opacity:0},{opacity:1,duration:.3,immediateRender:false},W+Wd*.48);
  tl.fromTo("#c2",{scaleX:0},{scaleX:1,duration:.7,ease:"power2.out",immediateRender:false},W+Wd*.48);`));
}

// ---------- 4. lp
{
  const n = 44, flat = 34; const shape = (i) => 10 + 82 * Math.exp(-((i - 17) ** 2) / 70) + 14 * Math.exp(-((i - 36) ** 2) / 40);
  const bars = Array.from({ length: n }, (_, i) => `<i data-h="${shape(i).toFixed(1)}"></i>`).join("");
  const ubars = Array.from({ length: 84 }, (_, i) => { const h = 16 + 78 * Math.exp(-((i - 34) ** 2) / 480) + 7 * Math.sin(i * 1.7) ** 2; return `<i style="height:${h.toFixed(1)}%"></i>`; }).join("");
  const pills = Array.from({ length: 10 }, (_, i) => `<span class="pill">${i % 3 === 2 ? "sell" : "buy"}</span>`).join("");
  W("compositions/lp.html", comp("lp", `
  .road{left:1370px;top:60px;width:450px;text-align:center;border:2px solid #E9A867;border-radius:10px;padding:10px;font-size:28px;font-weight:800;color:#F6C792;background:#2A221A}
  .hd{left:100px;top:52px;font-size:62px;color:#F6C792}
  .chart{left:100px;top:190px;width:920px;height:640px;background:#151816;border:2px solid #2C2A24;border-radius:18px;padding:30px}
  .ct{font-size:30px;font-weight:800}.bars{position:absolute;left:30px;right:30px;bottom:60px;height:470px;display:flex;align-items:flex-end;gap:4px;border-bottom:3px solid #2C2A24}
  .bars i{flex:1;height:100%;transform-origin:bottom;background-color:#C48A50;background-image:radial-gradient(circle,rgba(13,15,14,.55) 1px,transparent 1.3px);background-size:5px 5px}
  .ax{position:absolute;left:30px;right:30px;bottom:18px;display:flex;justify-content:space-between;font-size:25px;color:#BFB5A5}
  .col{left:1090px;width:730px}.col .serif{font-size:54px;color:#F6C792;line-height:1.15}.col p{font-size:35px;margin:12px 0 0;line-height:1.3;color:#EDE4D6}
  .pills{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.pill{font-size:25px;font-weight:800;padding:6px 18px;border-radius:8px;background:#2A221A;color:#F6C792;opacity:0}
  .meter{height:24px;background:#2C2A24;margin-top:18px;position:relative}.meter i{position:absolute;left:0;top:0;bottom:0;width:100%;background:#E9A867;transform-origin:left}
  .usp{inset:0;background:#0D0F0E;padding:80px 150px}.uh{font-size:78px;color:#F6C792}.us{font-size:44px;margin-top:14px}
  .uc{display:flex;gap:22px;margin-top:34px;height:66px}.uchip{background:#2A221A;border:2px solid #E9A867;color:#F6C792;border-radius:10px;padding:10px 26px;font-size:34px;font-weight:800;opacity:0}
  .utl{position:relative;height:440px;margin-top:44px;display:flex;align-items:flex-end;gap:5px;border-bottom:3px solid #2C2A24}
  .utl i{flex:1;background-color:#A9743F;background-image:radial-gradient(circle,rgba(13,15,14,.55) 1px,transparent 1.3px);background-size:5px 5px}
  .uw{position:absolute;top:-8px;bottom:-3px;left:0;width:60px;background:rgba(246,199,146,.26);border-left:5px solid #F6C792;border-right:5px solid #F6C792;opacity:0}
  .end{inset:0;background:#0D0F0E;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:90px}.end img{width:330px;height:330px;border-radius:30px}.end .serif{font-size:112px;color:#F6C792;margin-top:28px}.end div+div{font-size:42px;color:#EDE4D6}`,
  `<div class="glow" style="left:900px;top:-300px"></div>
  <div class="g hd serif" id="lh">Liquidity providers</div><div class="g road" id="lr">Next. Not built yet.</div>
  <div class="g chart" id="lc"><div class="ct" id="lct">Opening odds across the timeline</div><div class="bars">${bars}</div><div class="ax"><span>Sooner</span><span>Later</span></div></div>
  <div class="g col" id="l1" style="top:190px"><div class="serif">Capped</div><p>Maximum loss known and funded up front.</p><div class="meter"><i id="lm"></i></div></div>
  <div class="g col" id="l2" style="top:390px"><div class="serif">Their odds</div><p>A provider sets the opening curve.</p></div>
  <div class="g col" id="l3" style="top:560px"><div class="serif">2.5% fees</div><p>On every buy and sell. Profit isn't guaranteed.</p><div class="pills">${pills}</div></div>
  <div class="g usp" id="lu"><div class="uh serif">A new form of prediction market</div><div class="us">Buy and sell future time.</div>
    <div class="uc"><span class="uchip" id="uc1">Any increment</span><span class="uchip" id="uc2">Whenever they want</span></div>
    <div class="utl">${ubars}<div class="uw" id="uw"></div></div></div>
  <div class="g end" id="le"><img src="assets/logo.png" alt="" /><div class="serif">Veleda</div><div>the market of seers</div></div>`,
  `const A=${t("l1")},B=${t("l2")},Bd=${n3(T.l2.d)},U=${t("l3")},Ud=${n3(T.l3.d)},E=${t("l4")};
  IN(["#lh","#lr"],A+.1);IN("#lc",A+.3);IN("#l1",A+${n3(T.l1.d * .55)});
  tl.fromTo("#lm",{scaleX:0},{scaleX:1,duration:.8,ease:"power2.out",immediateRender:false},A+${n3(T.l1.d * .6)});
  const bs=document.querySelectorAll("[data-composition-id='lp'] .bars i");
  bs.forEach(b=>gsap.set(b,{scaleY:${flat / 100}}));
  IN("#l2",B+.1);
  bs.forEach((b,i)=>tl.fromTo(b,{scaleY:${flat / 100}},{scaleY:+b.dataset.h/100,duration:1.6,ease:"power2.inOut",immediateRender:false},B+.4+i*.012));
  IN("#l3",B+Bd*.38);
  tl.fromTo("[data-composition-id='lp'] .pill",{opacity:0},{opacity:1,duration:.15,stagger:.35,immediateRender:false},B+Bd*.42);
  tl.fromTo("#lu",{opacity:0},{opacity:1,duration:.5,immediateRender:false},U-.25);
  OUT(["#lh","#lr","#lc","#l1","#l2","#l3"],U-.25,.25);
  tl.set(["#lh","#lr","#lc","#l1","#l2","#l3"],{display:"none"},U+.05);
  tl.set(".uchip",{display:"none"},0);tl.set(".uchip",{display:"inline-block"},U+Ud*.6);
  tl.fromTo("#uw",{opacity:0},{opacity:1,duration:.3,immediateRender:false},U+Ud*.42);
  tl.fromTo("#uw",{x:240,width:60},{x:520,width:150,duration:.6,ease:"power2.inOut",immediateRender:false},U+Ud*.48);
  IN("#uc1",U+Ud*.66,{y:10});
  tl.fromTo("#uw",{x:520,width:150},{x:430,width:620,duration:.7,ease:"power2.inOut",immediateRender:false},U+Ud*.68);
  IN("#uc2",U+Ud*.83,{y:10});
  tl.fromTo("#uw",{x:430,width:620},{x:1040,width:240,duration:.7,ease:"power2.inOut",immediateRender:false},U+Ud*.85);
  tl.fromTo("#le",{opacity:0},{opacity:1,duration:.6,immediateRender:false},E-.3);
  tl.set("#lu",{display:"none"},E+.35);`));
}

// ---------- index
const scene = (id, tr) => `<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${n3(SC[id].s)}" data-duration="${n3(SC[id].d)}" data-track-index="${tr}" data-width="1920" data-height="1080"></div>`;
W("index.html", `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>${FONT}*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden;background:#0D0F0E}
#root{position:relative;width:100%;height:100%;background:#0D0F0E;font-family:"Manrope",sans-serif}
.cap{position:absolute;left:210px;width:1500px;bottom:44px;text-align:center;font-size:38px;font-weight:600;color:#EDE4D6;line-height:1.3;z-index:50}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
${PARTS.map(([id], i) => scene(id, i % 2)).join("\n")}
${audio.map((a) => `<audio id="vo-${a.id}" src="${a.f}" data-start="${n3(a.s)}" data-duration="${n3(a.d)}" data-track-index="10" data-volume="1"></audio>`).join("\n")}
${caps.map((c, i) => `<div id="cap-${i}" class="clip cap" data-start="${n3(c.t)}" data-duration="${n3(c.d)}" data-track-index="20">${c.l}</div>`).join("\n")}
</div><script>const tl=gsap.timeline({paused:true});tl.to({}, {duration:${TOTAL}}, 0);window.__timelines["main"]=tl;</script></body></html>`);
W("timing.json", JSON.stringify(T, null, 1));
console.log("total", TOTAL, Object.fromEntries(Object.entries(SC).map(([k, v]) => [k, [+v.s.toFixed(1), +v.d.toFixed(1)]])));
