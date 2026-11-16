// audio.js — every sound is synthesized with WebAudio at play time: no files,
// no network. Short noise/oscillator envelopes shaped per event.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  } catch { ctx = null; }
}

function noiseBuffer(dur) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ dur = 0.12, freq = 1200, q = 0.8, gain = 0.5, type = 'lowpass', slideTo = null, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur + 0.02);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.03);
}

function tone({ freq = 440, dur = 0.1, gain = 0.2, type = 'square', slideTo = null, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}

export const sfx = {
  shot(kind = 'rifle', distant = false) {
    const v = distant ? 0.16 : 0.5;
    if (kind === 'pistol') { burst({ dur: 0.09, freq: 2600, gain: v, slideTo: 500 }); tone({ freq: 190, dur: 0.05, gain: v * 0.5, slideTo: 70 }); }
    else if (kind === 'smg') { burst({ dur: 0.07, freq: 3000, gain: v * 0.85, slideTo: 700 }); }
    else if (kind === 'dmr') { burst({ dur: 0.22, freq: 1800, gain: v * 1.15, slideTo: 220 }); tone({ freq: 120, dur: 0.14, gain: v * 0.7, slideTo: 45 }); }
    else { burst({ dur: 0.13, freq: 2200, gain: v, slideTo: 380 }); tone({ freq: 150, dur: 0.07, gain: v * 0.55, slideTo: 60 }); }
  },
  dryFire() { tone({ freq: 1400, dur: 0.03, gain: 0.12, type: 'square' }); },
  reload() { tone({ freq: 700, dur: 0.04, gain: 0.16 }); tone({ freq: 480, dur: 0.04, gain: 0.16, delay: 0.16 }); tone({ freq: 950, dur: 0.05, gain: 0.2, delay: 0.34 }); },
  hit() { tone({ freq: 1900, dur: 0.045, gain: 0.22, type: 'sine' }); },
  kill() { tone({ freq: 880, dur: 0.07, gain: 0.22, type: 'sine' }); tone({ freq: 1318, dur: 0.1, gain: 0.22, type: 'sine', delay: 0.07 }); },
  hurt() { burst({ dur: 0.1, freq: 500, gain: 0.3 }); },
  buy() { tone({ freq: 1180, dur: 0.05, gain: 0.16, type: 'sine' }); tone({ freq: 1560, dur: 0.07, gain: 0.16, type: 'sine', delay: 0.05 }); },
  denied() { tone({ freq: 220, dur: 0.09, gain: 0.16, type: 'sawtooth' }); },
  beep(final = false) { tone({ freq: final ? 1560 : 1040, dur: final ? 0.22 : 0.07, gain: 0.2, type: 'sine' }); },
  plantDone() { tone({ freq: 780, dur: 0.08, gain: 0.2, type: 'sine' }); tone({ freq: 1170, dur: 0.12, gain: 0.2, type: 'sine', delay: 0.08 }); },
  explosion() {
    burst({ dur: 1.1, freq: 900, gain: 0.95, slideTo: 60 });
    tone({ freq: 90, dur: 0.9, gain: 0.7, type: 'sine', slideTo: 30 });
  },
  roundWin() { [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.16, gain: 0.18, type: 'triangle', delay: i * 0.11 })); },
  roundLose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.18, gain: 0.18, type: 'triangle', delay: i * 0.12 })); },
  step() { burst({ dur: 0.045, freq: 700, gain: 0.06 }); },
};
