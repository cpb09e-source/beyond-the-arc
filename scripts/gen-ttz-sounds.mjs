/**
 * gen-ttz-sounds.mjs — render candidate "fill a slot" sounds to WAV so they can
 * be auditioned in the browser before wiring one into the game. Pure Node, no
 * deps. Output: public/ttz-sound-previews/place-{1..4}.wav + an index.html.
 *
 * Run: node scripts/gen-ttz-sounds.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FS = 44100;
const OUT = path.resolve("public/ttz-sound-previews");
fs.mkdirSync(OUT, { recursive: true });

// ---- DSP helpers ----------------------------------------------------------
function noise(n) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; return a; }

// RBJ biquad, recomputed per sample so center freq can sweep. kind: "bp" | "lp".
function biquad(x, freqAt, Q, kind) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const f = freqAt(i / x.length);
    const w0 = (2 * Math.PI * f) / FS;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    let b0, b1, b2;
    const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    if (kind === "bp") { b0 = alpha; b1 = 0; b2 = -alpha; }
    else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; } // lp
    const xn = x[i];
    const yn = (b0 / a0) * xn + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn; y[i] = yn;
  }
  return y;
}

// Exponential-segment envelope (mirrors Web Audio exponentialRampToValueAtTime).
function env(n, pts) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    let v = pts[0][1];
    for (let s = 0; s < pts.length - 1; s++) {
      const [t0, v0] = pts[s], [t1, v1] = pts[s + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / Math.max(1e-9, t1 - t0);
        v = Math.max(1e-4, v0) * Math.pow(Math.max(1e-4, v1) / Math.max(1e-4, v0), f);
        break;
      }
      if (t > t1) v = v1;
    }
    a[i] = v;
  }
  return a;
}

function osc(n, freqAt, type) {
  const a = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = freqAt(i / n);
    ph += (2 * Math.PI * f) / FS;
    a[i] = type === "tri" ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
  }
  return a;
}

const mix = (...buf) => { const n = Math.max(...buf.map((b) => b.length)); const o = new Float32Array(n); for (const b of buf) for (let i = 0; i < b.length; i++) o[i] += b[i]; return o; };
const mul = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * (b[i] ?? b); return o; };
const expSweep = (f0, f1) => (x) => f0 * Math.pow(f1 / f0, x);

function writeWav(name, sig) {
  // soft-clip + normalize headroom, 16-bit PCM mono.
  let peak = 0; for (const v of sig) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? Math.min(1, 0.9 / peak) : 1;
  const buf = Buffer.alloc(44 + sig.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + sig.length * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(sig.length * 2, 40);
  for (let i = 0; i < sig.length; i++) {
    let s = Math.tanh(sig[i] * g * 1.1); // gentle soft-clip
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
}

const dur = (s) => Math.floor(FS * s);

// ---- 4 candidates ---------------------------------------------------------
// 1) Airy whoosh slide-in — noise bandpass sweeping down, long airy fade.
{
  const n = dur(0.5);
  const sig = mul(biquad(noise(n), expSweep(3600, 1200), 0.55, "bp"),
    env(n, [[0, 0.0001], [0.1, 0.5], [0.46, 0.0001]]));
  writeWav("place-1.wav", sig);
}
// 2) Swish + click — quick rising noise swish, lands on a soft tick.
{
  const n = dur(0.28);
  const swish = mul(biquad(noise(n), expSweep(1400, 3400), 0.7, "bp"),
    env(n, [[0, 0.0001], [0.05, 0.45], [0.2, 0.0001]]));
  const click = new Float32Array(n);
  const cn = mul(biquad(noise(dur(0.04)), () => 2400, 1.0, "lp"),
    env(dur(0.04), [[0, 0.0001], [0.003, 0.5], [0.035, 0.0001]]));
  const off = dur(0.15); for (let i = 0; i < cn.length && off + i < n; i++) click[off + i] = cn[i];
  writeWav("place-2.wav", mix(swish, click));
}
// 3) Tonal swoop — clean triangle pitch-glide up, no noise (UI "whoop").
{
  const n = dur(0.34);
  const body = mul(osc(n, expSweep(300, 880), "tri"), env(n, [[0, 0.0001], [0.02, 0.32], [0.3, 0.0001]]));
  const shimmer = mul(osc(n, expSweep(600, 1760), "sine"), env(n, [[0, 0.0001], [0.02, 0.1], [0.22, 0.0001]]));
  writeWav("place-3.wav", mix(body, shimmer));
}
// 4) Soft pop — sine with fast pitch rise then quick decay (bubble pop).
{
  const n = dur(0.2);
  const sig = mul(osc(n, (x) => 200 + 360 * Math.min(1, x * 6), "sine"),
    env(n, [[0, 0.0001], [0.008, 0.55], [0.16, 0.0001]]));
  writeWav("place-4.wav", sig);
}

const LABELS = [
  ["place-1.wav", "Airy whoosh", "Soft noise sweeping down, long airy fade — the current direction."],
  ["place-2.wav", "Swish + click", "Quick rising swish that lands on a soft tick."],
  ["place-3.wav", "Tonal swoop", "Clean pitch-glide whoop, no noise — brighter/UI."],
  ["place-4.wav", "Soft pop", "Tiny bubble pop, very subtle."],
];
const html = `<!doctype html><meta charset=utf8><title>32-0 slot sounds</title>
<style>body{font:16px system-ui;background:#0e1626;color:#e8edf6;max-width:640px;margin:40px auto;padding:0 20px}
h1{font-weight:700}.s{border:1px solid #25324a;border-radius:12px;padding:16px 18px;margin:14px 0;background:#13203a}
.s b{color:#07f49e}.s p{color:#9fb0c8;margin:.3em 0 .7em;font-size:14px}audio{width:100%}</style>
<h1>32-0 — slot-fill sound options</h1>
<p style="color:#9fb0c8">Tap each. Tell me which number (or mix-and-match: e.g. "3 but shorter").</p>
${LABELS.map(([f, t, d], i) => `<div class=s><b>${i + 1}. ${t}</b><p>${d}</p><audio controls preload=auto src="./${f}"></audio></div>`).join("\n")}`;
fs.writeFileSync(path.join(OUT, "index.html"), html);

// ---- Roll-END (reels settle) candidates -----------------------------------
// current — soft high sine tick @1320Hz (what plays today).
{
  const n = dur(0.1);
  writeWav("land-current.wav", mul(osc(n, () => 1320, "sine"), env(n, [[0, 0.0001], [0.004, 0.45], [0.084, 0.0001]])));
}
// 1) Thunk — low sine gliding down, soft weight/settle.
{
  const n = dur(0.18);
  writeWav("land-1.wav", mul(osc(n, expSweep(200, 100), "sine"), env(n, [[0, 0.0001], [0.006, 0.5], [0.16, 0.0001]])));
}
// 2) Ding — clean bell-ish fundamental + octave.
{
  const n = dur(0.32);
  const f = mul(osc(n, () => 880, "sine"), env(n, [[0, 0.0001], [0.003, 0.45], [0.3, 0.0001]]));
  const o = mul(osc(n, () => 1760, "sine"), env(n, [[0, 0.0001], [0.003, 0.16], [0.18, 0.0001]]));
  writeWav("land-2.wav", mix(f, o));
}
// 3) Click-clack — two quick lowpassed ticks, mechanical reel stop.
{
  const n = dur(0.16);
  const out = new Float32Array(n);
  for (const off of [0, 0.05]) {
    const tk = mul(biquad(noise(dur(0.04)), () => 2200, 1.0, "lp"), env(dur(0.04), [[0, 0.0001], [0.003, 0.5], [0.035, 0.0001]]));
    const o = dur(off); for (let i = 0; i < tk.length && o + i < n; i++) out[o + i] += tk[i];
  }
  writeWav("land-3.wav", out);
}
// 4) Soft chime — warm triangle with a faint detuned partner.
{
  const n = dur(0.38);
  const a = mul(osc(n, () => 660, "tri"), env(n, [[0, 0.0001], [0.005, 0.4], [0.36, 0.0001]]));
  const b = mul(osc(n, () => 661.5, "sine"), env(n, [[0, 0.0001], [0.005, 0.2], [0.3, 0.0001]]));
  writeWav("land-4.wav", mix(a, b));
}

const LAND = [
  ["land-current.wav", "Current — high tick", "Soft high sine tick @1320Hz. What plays today when the reels stop."],
  ["land-1.wav", "Thunk", "Low sine gliding down — soft weight/settle."],
  ["land-2.wav", "Ding", "Clean bell-ish fundamental + octave."],
  ["land-3.wav", "Click-clack", "Two quick ticks — mechanical reel stop."],
  ["land-4.wav", "Soft chime", "Warm triangle with a faint detuned partner."],
];
const landHtml = `<!doctype html><meta charset=utf8><title>32-0 roll-end sounds</title>
<style>body{font:16px system-ui;background:#0e1626;color:#e8edf6;max-width:640px;margin:40px auto;padding:0 20px}
h1{font-weight:700}.s{border:1px solid #25324a;border-radius:12px;padding:16px 18px;margin:14px 0;background:#13203a}
.s b{color:#07f49e}.s p{color:#9fb0c8;margin:.3em 0 .7em;font-size:14px}audio{width:100%}</style>
<h1>32-0 — roll-END (reels settle) options</h1>
<p style="color:#9fb0c8">First one is what plays now. Tell me which number, or tweak.</p>
${LAND.map(([f, t, d], i) => `<div class=s><b>${i === 0 ? "" : i + ". "}${t}</b><p>${d}</p><audio controls preload=auto src="./${f}"></audio></div>`).join("\n")}`;
fs.writeFileSync(path.join(OUT, "land.html"), landHtml);

console.log("✓ wrote place + land WAVs + index.html/land.html to public/ttz-sound-previews/");
