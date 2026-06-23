/**
 * ttz-sound — tiny Web-Audio sound kit for the 32-0 game. Everything is
 * synthesized on the fly (no audio files to ship/license), tuned to be quiet
 * and tasteful: soft swishes and warm pentatonic "plinks" rather than arcade
 * blare. The placement notes climb a major-pentatonic scale as you fill the
 * five slots, so a completed lineup leaves a little rising motif — the
 * "addictive" hook.
 *
 * Browsers require a user gesture before audio plays; every sound here fires
 * from a click/tap, and we resume the context on first use, so that's covered.
 * Muted state persists in localStorage.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

const MUTE_KEY = "ttz-muted";

function init(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.7; // global ceiling — keeps the whole kit gentle
  master.connect(ctx.destination);
  // Pre-bake a short white-noise buffer for the roll swish.
  const len = Math.floor(ctx.sampleRate * 0.4);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  if (typeof localStorage !== "undefined") muted = localStorage.getItem(MUTE_KEY) === "1";
  return ctx;
}

export function isMuted(): boolean {
  if (typeof localStorage !== "undefined" && ctx === null) {
    return localStorage.getItem(MUTE_KEY) === "1";
  }
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  if (typeof localStorage !== "undefined") localStorage.setItem(MUTE_KEY, v ? "1" : "0");
}

function ready(): { c: AudioContext; m: GainNode } | null {
  if (muted) return null;
  const c = init();
  if (!c || !master) return null;
  if (c.state === "suspended") void c.resume();
  return { c, m: master };
}

// A single enveloped tone. attack/decay in seconds; peak is the gain ceiling.
function tone(
  c: AudioContext, dest: GainNode,
  freq: number, type: OscillatorType, t0: number,
  attack: number, decay: number, peak: number,
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.02);
}

// One soft ratchet "tick" — a tiny bandpassed noise blip at a scheduled time.
function tick(c: AudioContext, dest: GainNode, t: number, vel: number): void {
  if (!noiseBuf) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2200;
  bp.Q.value = 1.3;
  const g = c.createGain();
  const peak = 0.082 * vel;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
  src.connect(bp).connect(g).connect(dest);
  // Random offset into the noise buffer so each tick differs slightly.
  src.start(t, (t * 9301 % 1) * 0.2);
  src.stop(t + 0.03);
}

/**
 * Roll button — an ASMR "slot picker": a run of soft ticks that decelerate as
 * the reels slow (ease-out spacing), like a ratchet/wheel settling. The landing
 * thunk (playLand) caps it when the reels stop.
 */
export function playRoll(): void {
  const r = ready();
  if (!r || !noiseBuf) return;
  const { c, m } = r;
  const t0 = c.currentTime;
  const D = 1.6; // tick run spans most of the spin
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const tf = 1 - Math.pow(1 - x, 3); // ease-out → gaps widen toward the end
    tick(c, m, t0 + tf * D, 0.95 - 0.35 * x);
  }
}

/** Reels settle — a soft low "thunk" gliding down, like the reels seating. */
export function playLand(): void {
  const r = ready();
  if (!r) return;
  const { c, m } = r;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(200, t0);
  osc.frequency.exponentialRampToValueAtTime(100, t0 + 0.16);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  osc.connect(g).connect(m);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}

/**
 * Player dropped into a slot — a soft, tactile "slot-in": a brief lowpassed
 * contact tick followed by a low seated thunk that glides down in pitch. Reads
 * like clicking a piece into place (ASMR) rather than a musical note. `step`
 * (0-based slot index) only nudges the thunk pitch a hair so repeats aren't
 * robotic — it's not a melody.
 */
export function playPlace(step = 0): void {
  const r = ready();
  if (!r) return;
  const { c, m } = r;
  const t0 = c.currentTime;
  void step;

  // Soft "pop" — sine with a fast pitch rise then quick decay (bubble pop).
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(200, t0);
  osc.frequency.exponentialRampToValueAtTime(560, t0 + 0.033);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
  osc.connect(g).connect(m);
  osc.start(t0);
  osc.stop(t0 + 0.2);
}

/** Lineup complete (32-0) — a quick rising major arpeggio flourish. */
export function playComplete(): void {
  const r = ready();
  if (!r) return;
  const { c, m } = r;
  const t0 = c.currentTime;
  const arp = [523.25, 659.25, 783.99, 1046.5]; // C-E-G-C
  arp.forEach((f, i) => tone(c, m, f, "triangle", t0 + i * 0.07, 0.005, 0.22, 0.1));
}
