/* ============================================================
   Liquid Rhythm · core.js
   工具 / 音频引擎 / FFT 起音检测 / BPM 估计 / 自动谱面生成 / 示例曲
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

/* ---------------- 工具 ---------------- */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
/* 让出主线程但不吃 setTimeout 的 4ms 夹紧（分析长曲时快很多） */
const nextTick = (function () {
  if (typeof MessageChannel === 'function') {
    const ch = new MessageChannel();
    const queue = [];
    ch.port1.onmessage = function () {
      const fn = queue.shift();
      if (fn) fn();
    };
    return function () {
      return new Promise(function (resolve) {
        queue.push(resolve);
        ch.port2.postMessage(0);
      });
    };
  }
  return function () { return new Promise(function (r) { setTimeout(r, 0); }); };
})();

LR.util = { clamp: clamp, lerp: lerp, fmtTime: fmtTime, rng: rng, nextTick: nextTick };

/* ---------------- 音频引擎 ---------------- */
function AudioEngine() {
  this.ctx = null;
  this.buffer = null;
  this.src = null;
  this.gain = null;
  this.playing = false;
  this.volume = 0.85;
  this._startCtx = 0;
  this._startOffset = 0;
  this._pausedAt = 0;
}
AudioEngine.prototype.ensure = function () {
  if (!this.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
  }
  if (this.ctx.state === 'suspended') this.ctx.resume();
  return this.ctx;
};
AudioEngine.prototype.setVolume = function (v) {
  this.volume = v;
  if (this.gain) this.gain.gain.value = v;
};
AudioEngine.prototype.setBuffer = function (buf) {
  this.stop();
  this.buffer = buf;
  this._pausedAt = 0;
};
AudioEngine.prototype.decode = function (arrayBuffer) {
  const ctx = this.ensure();
  return new Promise(function (resolve, reject) {
    let settled = false;
    const ok = function (b) { if (!settled) { settled = true; resolve(b); } };
    const bad = function (e) { if (!settled) { settled = true; reject(e || new Error('decodeAudioData failed')); } };
    let p = null;
    try { p = ctx.decodeAudioData(arrayBuffer, ok, bad); } catch (e) { bad(e); return; }
    if (p && typeof p.then === 'function') p.then(ok, bad);
  });
};
AudioEngine.prototype._now = function () {
  const c = this.ctx;
  if (c && c.getOutputTimestamp) {
    const ts = c.getOutputTimestamp();
    if (ts && ts.performanceTime) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
  }
  return c ? c.currentTime : performance.now() / 1000;
};
AudioEngine.prototype.currentTime = function () {
  if (!this.buffer) return 0;
  if (!this.playing) return this._pausedAt;
  return this._now() - this._startCtx + this._startOffset;
};
AudioEngine.prototype.play = function (offset) {
  if (!this.buffer) return;
  this.ensure();
  this.stop();
  const off = clamp(offset || 0, 0, Math.max(0, this.buffer.duration - 0.01));
  const s = this.ctx.createBufferSource();
  s.buffer = this.buffer;
  s.connect(this.gain);
  const self = this;
  s.onended = function () {
    if (self.src === s) {
      self.playing = false;
      self._pausedAt = self.buffer ? self.buffer.duration : 0;
    }
  };
  this._startCtx = this._now();
  this._startOffset = off;
  this._pausedAt = off;
  s.start(0, off);
  this.src = s;
  this.playing = true;
};
AudioEngine.prototype.stop = function () {
  if (this.src) {
    try { this.src.onended = null; this.src.stop(); } catch (e) { /* already stopped */ }
    try { this.src.disconnect(); } catch (e) { /* noop */ }
    this.src = null;
  }
  this.playing = false;
};
AudioEngine.prototype.pause = function () {
  if (!this.playing) return;
  this._pausedAt = this.currentTime();
  this.stop();
};
AudioEngine.prototype.resume = function () { this.play(this._pausedAt); };
AudioEngine.prototype.latency = function () {
  if (!this.ctx) return 0;
  return this.ctx.outputLatency || this.ctx.baseLatency || 0;
};

LR.AudioEngine = AudioEngine;

/* ---------------- FFT ---------------- */
function makeFFT(n) {
  const cos = new Float32Array(n >> 1);
  const sin = new Float32Array(n >> 1);
  for (let i = 0; i < (n >> 1); i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = Math.sin(2 * Math.PI * i / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let j = 1; j < n; j <<= 1) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r >>> 0;
  }
  return function (re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cos[k], s = sin[k];
          const tr = re[j + half] * c + im[j + half] * s;
          const ti = -re[j + half] * s + im[j + half] * c;
          re[j + half] = re[j] - tr; im[j + half] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
  };
}

/* ---------------- 主分析：起音检测 + BPM ---------------- */
LR.analyze = async function (buffer, onProgress) {
  const sr = buffer.sampleRate;
  const N = 1024, HOP = 512, BINS = N >> 1;
  const chs = buffer.numberOfChannels;
  const c0 = buffer.getChannelData(0);
  const c1 = chs > 1 ? buffer.getChannelData(1) : null;
  const mix = c1 ? 0.5 : 1;
  const len = buffer.length;
  const frames = Math.max(1, Math.floor((len - N) / HOP) + 1);
  const envRate = sr / HOP;

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

  const fft = makeFFT(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const prev = new Float32Array(BINS);

  const flux = new Float32Array(frames);
  const fluxLo = new Float32Array(frames);
  const fluxMid = new Float32Array(frames);
  const fluxHi = new Float32Array(frames);
  const flat = new Float32Array(frames);
  const pitch = new Float32Array(frames);
  const bands = new Float32Array(frames * 6);
  const cent = new Float32Array(frames);

  const edgeHz = [0, 110, 250, 600, 1500, 4000, 12000];
  /* 默认归到最高的第 6 频段：否则 12kHz 以上的 bin 会被误算进最低频段，导致分轨重心偏低 */
  const bandOfBin = new Uint8Array(BINS).fill(5);
  for (let b = 0; b < 6; b++) {
    const lo = Math.round(edgeHz[b] * N / sr);
    const hi = Math.round(edgeHz[b + 1] * N / sr);
    for (let k = Math.max(1, lo); k < Math.min(BINS, hi); k++) bandOfBin[k] = b;
  }

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) {
      let s = c0[off + i];
      if (c1) s = (s + c1[off + i]) * mix;
      re[i] = s * win[i];
      im[i] = 0;
    }
    fft(re, im);

    let fl = 0, flLo = 0, flMid = 0, flHi = 0;
    const be = [0, 0, 0, 0, 0, 0];
    let logSum = 0, linSum = 0, nBins = 0;
    let peakK = 0, peakV = -1;
    for (let k = 1; k < BINS; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const lm = Math.log1p(m * 45);
      const d = lm - prev[k];
      if (d > 0) {
        fl += d;
        const hz = k * sr / N;
        if (hz < 220) flLo += d; else if (hz < 2200) flMid += d; else flHi += d;
      }
      prev[k] = lm;
      be[bandOfBin[k]] += m;
      /* 谱平坦度：几何均值/算术均值，越小越「有音高」（人声/乐音），越大越像噪声（镲/军鼓） */
      logSum += Math.log(m + 1e-9); linSum += m; nBins++;
      /* 主频：80~1200Hz 内找峰，用于旋律走向（楼梯走向） */
      const hz2 = k * sr / N;
      if (hz2 > 80 && hz2 < 1200 && m > peakV) { peakV = m; peakK = k; }
    }
    flux[f] = fl; fluxLo[f] = flLo; fluxMid[f] = flMid; fluxHi[f] = flHi;
    const gm = Math.exp(logSum / nBins);
    flat[f] = linSum > 1e-9 ? gm / (linSum / nBins) : 1;
    if (peakK > 1 && peakK < BINS - 1) {
      const y0 = Math.hypot(re[peakK - 1], im[peakK - 1]);
      const y1 = peakV;
      const y2 = Math.hypot(re[peakK + 1], im[peakK + 1]);
      const den = y0 - 2 * y1 + y2;
      const off = den !== 0 ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
      pitch[f] = (peakK + off) * sr / N;
    } else pitch[f] = 0;
    const bo = f * 6;
    let tot = 0, cw = 0;
    for (let b = 0; b < 6; b++) { bands[bo + b] = be[b]; tot += be[b]; cw += be[b] * b; }
    cent[f] = tot > 1e-9 ? cw / tot : 2.5;

    if ((f & 127) === 0) {
      if (onProgress) onProgress(f / frames);
      await nextTick();
    }
  }
  if (onProgress) onProgress(1);

  /* --- 自适应阈值 --- */
  const ps = new Float64Array(frames + 1), ps2 = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) { ps[i + 1] = ps[i] + flux[i]; ps2[i + 1] = ps2[i] + flux[i] * flux[i]; }
  const W = Math.max(4, Math.round(0.35 * envRate));
  const thr = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - W), b = Math.min(frames, i + W + 1), n = b - a;
    const m = (ps[b] - ps[a]) / n;
    const m2 = (ps2[b] - ps2[a]) / n;
    const sd = Math.sqrt(Math.max(0, m2 - m * m));
    thr[i] = m + 1.6 * sd + 1e-7;
  }

  /* --- 峰值拾取 + 85ms 非极大值抑制 --- */
  const cand = [];
  for (let i = 2; i < frames - 2; i++) {
    if (flux[i] > thr[i] && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      cand.push({ i: i, s: flux[i] - thr[i], raw: flux[i] });
    }
  }
  cand.sort(function (a, b) { return b.s - a.s; });
  const minGapF = Math.max(1, Math.round(0.085 * envRate));
  const taken = new Uint8Array(frames);
  const kept = [];
  for (let c = 0; c < cand.length; c++) {
    const o = cand[c];
    let ok = true;
    const a = Math.max(0, o.i - minGapF), b = Math.min(frames - 1, o.i + minGapF);
    for (let k = a; k <= b; k++) { if (taken[k]) { ok = false; break; } }
    if (ok) { taken[o.i] = 1; kept.push(o); }
  }
  kept.sort(function (a, b) { return a.i - b.i; });

  /* --- 分频段再各捡一遍起音：人声音节/踩镲未必会在总包络上形成峰 --- */
  function pickPeaks(env, k, minGapSec) {
    const W2 = Math.max(4, Math.round(0.35 * envRate));
    const pa = new Float64Array(frames + 1), pb = new Float64Array(frames + 1);
    for (let i = 0; i < frames; i++) { pa[i + 1] = pa[i] + env[i]; pb[i + 1] = pb[i] + env[i] * env[i]; }
    const th2 = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const a = Math.max(0, i - W2), b = Math.min(frames, i + W2 + 1), n = b - a;
      const m = (pa[b] - pa[a]) / n, m2 = (pb[b] - pb[a]) / n;
      th2[i] = m + k * Math.sqrt(Math.max(0, m2 - m * m)) + 1e-7;
    }
    const cs = [];
    for (let i = 2; i < frames - 2; i++) {
      if (env[i] > th2[i] && env[i] >= env[i - 1] && env[i] > env[i + 1]) cs.push({ i: i, s: env[i] - th2[i] });
    }
    cs.sort(function (a, b) { return b.s - a.s; });
    const gap2 = Math.max(1, Math.round(minGapSec * envRate));
    const tk = new Uint8Array(frames), out = [];
    for (let c = 0; c < cs.length; c++) {
      const o = cs[c];
      let ok = true;
      const a = Math.max(0, o.i - gap2), b = Math.min(frames - 1, o.i + gap2);
      for (let j = a; j <= b; j++) if (tk[j]) { ok = false; break; }
      if (ok) { tk[o.i] = 1; out.push(o); }
    }
    out.sort(function (a, b) { return a.i - b.i; });
    return out;
  }

  const pkBroad = kept;
  const pkMid = pickPeaks(fluxMid, 1.05, 0.11);   // 人声 / 旋律音节
  const pkHi = pickPeaks(fluxHi, 1.35, 0.07);     // 踩镲 / 高频打击
  const pkLo = pickPeaks(fluxLo, 1.4, 0.1);       // 底鼓

  /* 合并 45ms 内的重复峰：同一个打击会在多个频段同时出现 */
  const all = [];
  function addPk(list, tag) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const f2 = flux[o.i] - thr[o.i];
      all.push({ i: o.i, s: tag === 'broad' ? Math.max(o.s, f2) : o.s * 1.15, tag: tag });
    }
  }
  addPk(pkBroad, 'broad'); addPk(pkMid, 'mid'); addPk(pkHi, 'hi'); addPk(pkLo, 'lo');
  all.sort(function (a, b) { return a.i - b.i; });
  const mergeF = Math.max(1, Math.round(0.045 * envRate));
  const mergedPk = [];
  for (let i = 0; i < all.length; i++) {
    const o = all[i];
    const last = mergedPk[mergedPk.length - 1];
    if (last && o.i - last.i <= mergeF) {
      last.tags[o.tag] = 1;
      if (o.s > last.s) last.s = o.s;
    } else {
      const tags = {}; tags[o.tag] = 1;
      mergedPk.push({ i: o.i, s: o.s, tags: tags });
    }
  }

  /* 关键：底鼓在「总包络」上的强度远小于噪声类（实测只有 0.04 vs 1.0），
     如果统一归一化，底鼓会被强度门槛全部滤掉，谱面就只剩镲片了。
     所以每个频段各自归一化，最终强度取四者最大 —— 骨架不会被次要元素淹没。 */
  let maxS = 1e-9, maxLo = 1e-9, maxMid = 1e-9, maxHi = 1e-9;
  for (let i = 0; i < mergedPk.length; i++) {
    const o = mergedPk[i];
    o.sLo = fluxLo[o.i];
    o.sMid = fluxMid[o.i];
    o.sHi = fluxHi[o.i];
    maxS = Math.max(maxS, o.s);
    maxLo = Math.max(maxLo, o.sLo);
    maxMid = Math.max(maxMid, o.sMid);
    maxHi = Math.max(maxHi, o.sHi);
  }
  const onsets = mergedPk.map(function (o) {
    const y0 = flux[o.i - 1], y1 = flux[o.i], y2 = flux[o.i + 1];
    const den = y0 - 2 * y1 + y2;
    const off = den !== 0 ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
    const bo = o.i * 6;
    const low = bands[bo] + bands[bo + 1];
    const mid = bands[bo + 2] + bands[bo + 3] + bands[bo + 4];
    const high = bands[bo + 5];
    const fl2 = flat[o.i];
    const tonal = 1 - clamp(fl2 / 0.6, 0, 1);
    /* 分类：底鼓 / 军鼓 / 踩镲 / 人声（乐音）/ 其它 */
    /* 分类阈值是实测出来的（合成鼓组：
       底鼓 low/(mid+high)=0.82~1.46，踩镲只有 0.02~0.05）——
       原来的判据还要求「低频峰值拾取器也触发」「low > mid*1.12」，
       太脆，力度小一点的底鼓就会被漏成 hat/vocal。改用频段比值。 */
    const lh = low / (mid + high + 1e-9);
    let kind = 'other';
    if (lh > 0.45) kind = 'kick';                                    // 低频主导 = 底鼓
    else if (high > mid * 1.25 && high > low * 1.5) kind = 'hat';     // 高频主导 = 踩镲
    else if (tonal > 0.55 && mid > high * 0.8) kind = 'vocal';        // 有音高 + 中频 = 人声/旋律
    else if (mid > low * 0.7) kind = 'snare';                        // 中频为主 = 军鼓
    return {
      t: Math.max(0, (o.i * HOP + N * 0.5) / sr + off * (HOP / sr)),
      s: Math.max(o.s / maxS, Math.max(o.sLo / maxLo, Math.max(o.sMid / maxMid, o.sHi / maxHi))),
      f: o.i,
      c: clamp(cent[o.i] / 5, 0, 1),
      kind: kind,
      /* 对数化的主频 0~1：给「楼梯走向」用 */
      p: pitch[o.i] > 0 ? clamp((Math.log(pitch[o.i]) - Math.log(80)) / (Math.log(1200) - Math.log(80)), 0, 1) : 0.5,
      tonal: 1 - clamp(fl2 / 0.6, 0, 1),
      low: low, mid: mid, high: high
    };
  });

  /* --- BPM --- */
  let bpm = estimateBPM(flux, envRate);
  let beat = 60 / bpm;
  let offset = estimatePhase(flux, envRate, beat);
  const refined = refineTempo(onsets, bpm);
  if (refined) { bpm = refined.bpm; beat = refined.beat; offset = refined.offset; }
  const duration = buffer.duration;

  const beats = [];
  for (let t = offset; t < duration; t += beat) beats.push(t);

  /* --- 供预览使用的能量包络（下采样到 ~200 点/秒上限） --- */
  const envStep = Math.max(1, Math.round(envRate / 200));
  const env = [];
  for (let i = 0; i < frames; i += envStep) {
    let m = 0;
    for (let k = i; k < Math.min(frames, i + envStep); k++) m = Math.max(m, flux[k]);
    env.push(m);
  }
  let envMax = 1e-9;
  for (let i = 0; i < env.length; i++) envMax = Math.max(envMax, env[i]);
  for (let i = 0; i < env.length; i++) env[i] /= envMax;

  return {
    bpm: bpm, beat: beat, offset: offset, duration: duration,
    onsets: onsets, beats: beats, env: env, envRate: envRate / envStep,
    bands: bands, bandRate: envRate, frames: frames
  };
};

function estimateBPM(flux, rate) {
  const lo = Math.round(0.28 * rate);
  const hi = Math.min(flux.length - 2, Math.round(1.05 * rate));
  if (hi <= lo) return 120;
  let bestLag = lo, best = -1;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0, n = 0;
    for (let i = 0; i + lag < flux.length; i += 2) { s += flux[i] * flux[i + lag]; n++; }
    s /= Math.max(1, n);
    if (s > best) { best = s; bestLag = lag; }
  }
  let bpm = 60 * rate / bestLag;
  while (bpm < 72) bpm *= 2;
  while (bpm > 185) bpm /= 2;
  const r = Math.round(bpm);
  if (Math.abs(bpm - r) < 0.35) bpm = r;
  return Math.round(bpm * 10) / 10;
}

function estimatePhase(flux, rate, beat) {
  const pf = beat * rate;
  if (pf < 2) return 0;
  const steps = Math.max(8, Math.min(96, Math.round(pf)));
  let best = -1, bestPhase = 0;
  for (let s = 0; s < steps; s++) {
    const ph = s * pf / steps;
    let sum = 0, cnt = 0;
    for (let t = ph; t < flux.length; t += pf) {
      const i = Math.round(t);
      if (i >= 0 && i < flux.length) { sum += flux[i]; cnt++; }
    }
    sum /= Math.max(1, cnt);
    if (sum > best) { best = sum; bestPhase = ph; }
  }
  return bestPhase / rate;
}

/* 用起音做相位锁定精修。
   自相关只能给出整数帧的滞后（128 BPM 时 40.4 帧 → ±2.5% 误差），
   这点误差在十几秒后会累积到半个网格，导致对齐节拍时把音符吸到错的位置。
   做法：在粗估 BPM 附近细搜，用复数相位锁定值 |Σ w·e^{i2πt/beat}| / Σw 打分，
   它的幅角同时给出最佳相位，所以一次扫描就能同时定 BPM 和 offset。 */
function refineTempo(onsets, bpm0) {
  if (!onsets || onsets.length < 6) return null;
  const scan = function (center, span, step) {
    let best = null;
    for (let bpm = center * (1 - span); bpm <= center * (1 + span); bpm += step) {
      const beat = 60 / bpm;
      let re = 0, im = 0, wsum = 0;
      for (let i = 0; i < onsets.length; i++) {
        const o = onsets[i];
        const w = 0.3 + 0.7 * o.s;
        const ph = 2 * Math.PI * o.t / beat;
        re += w * Math.cos(ph);
        im += w * Math.sin(ph);
        wsum += w;
      }
      const score = Math.sqrt(re * re + im * im) / (wsum || 1);
      if (!best || score > best.score) {
        let off = Math.atan2(im, re) / (2 * Math.PI) * beat;
        off = ((off % beat) + beat) % beat;
        best = { bpm: bpm, score: score, offset: off, beat: beat };
      }
    }
    return best;
  };
  const coarse = scan(bpm0, 0.06, 0.04);
  if (!coarse) return null;
  const fine = scan(coarse.bpm, 0.01, 0.004);
  const out = fine || coarse;
  const r = Math.round(out.bpm * 2) / 2;   // 真实曲目基本是整数或 .5 BPM
  if (Math.abs(out.bpm - r) < 0.06) { out.bpm = r; out.beat = 60 / r; }
  out.bpm = Math.round(out.bpm * 100) / 100;
  return out;
}

/* ---------------- 谱面生成 ---------------- */
const DIFFS = {
  easy:   { label: '简单', keep: 0.34, sub: 1, thr: 0.36, hold: 0.55, chord: 0.00 },
  normal: { label: '普通', keep: 0.52, sub: 2, thr: 0.25, hold: 0.45, chord: 0.05 },
  hard:   { label: '困难', keep: 0.74, sub: 4, thr: 0.16, hold: 0.40, chord: 0.12 },
  expert: { label: '专家', keep: 0.92, sub: 4, thr: 0.09, hold: 0.34, chord: 0.18 }
};
LR.DIFFS = DIFFS;

/* ============================================================
   节奏医生式 · 独立制谱
   完全不复用下落式那套「跟着起音走」的逻辑 —— 那是密度的来源。
   这里按「拍」制谱：每个拍格最多一颗，整拍是骨架，半拍只在强音上点缀。
   128 BPM 下大约是每秒 2 颗，而不是每秒 4~5 颗。
   ============================================================ */
function nearestOnset(list, t, tol) {
  let best = null, bestD = tol;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i].t - t);
    if (d < bestD) { bestD = d; best = list[i]; }
  }
  return best;
}

LR.buildRDPattern = function (A, opts) {
  const diff = DIFFS[opts.diff] ? opts.diff : 'normal';
  const density = clamp(opts.density == null ? 0.5 : opts.density, 0, 1);
  const beat = A.beat, off = A.offset, dur = A.duration;

  /* Rhythm Doctor 的灵魂是「7 拍一句 + 句内留白」，不是每拍都按。
     每句从下面这组节奏型里挑一个（索引越大越密），按这一句的音乐强度决定挑哪个。
     0 = 这一句的第 1 拍，6 = 第 7 拍（那个标志性的第 7 拍）。 */
  const PATTERNS = {
    easy:   [[0, 6], [0, 6], [0, 3, 6]],
    normal: [[0, 6], [0, 3, 6], [0, 2, 6], [0, 3, 5, 6]],
    hard:   [[0, 3, 6], [0, 2, 6], [0, 2, 4, 6], [0, 2, 3, 5, 6]],
    expert: [[0, 2, 6], [0, 2, 4, 6], [0, 1, 3, 5, 6], [0, 2, 4, 5, 6]]
  }[diff];
  const BAR = 7;
  const notes = [];
  const bars = Math.ceil((dur - off) / (beat * BAR));

  for (let b = 0; b < bars; b++) {
    const t0 = off + b * beat * BAR;
    if (t0 > dur - 0.6) break;
    /* 这一句的平均强度 → 决定用多密的节奏型 */
    let sum = 0, n = 0, loudest = 0, loudKind = 'other';
    for (let i = 0; i < A.onsets.length; i++) {
      const o = A.onsets[i];
      if (o.t < t0 || o.t >= t0 + beat * BAR) continue;
      sum += o.s; n++;
      if (o.s > loudest) { loudest = o.s; loudKind = o.kind; }
    }
    const avg = n ? sum / n : 0;
    let pi = Math.round(avg * 2.2 + density * 1.2 - 0.4);
    pi = Math.max(0, Math.min(PATTERNS.length - 1, pi));
    const pat = PATTERNS[pi];

    for (let k = 0; k < pat.length; k++) {
      const t = t0 + pat[k] * beat;
      if (t < 1.3 || t > dur - 0.4) continue;
      const hit = nearestOnset(A.onsets, t, beat * 0.42);
      /* 第 7 拍是标志位，即使没检到起音也放（RD 就是这么玩的） */
      if (!hit && pat[k] !== BAR - 1) continue;
      notes.push({
        t: t, lane: 0, dur: 0, kind: 'tap',
        s: hit ? hit.s : 0.5, src: hit ? hit.kind : 'other'
      });
    }
  }

  /* 长按：整句末尾的人声拖长 */
  if (opts.holds !== false) {
    const br = A.bandRate, bf = A.bands;
    const power = function (tt) {
      const fr = Math.round(tt * br);
      if (fr < 0 || fr >= A.frames || !bf) return 0;
      const o = fr * 6;
      return bf[o] + bf[o + 1] + bf[o + 2] + bf[o + 3] + bf[o + 4] + bf[o + 5];
    };
    for (let i = 0; i < notes.length; i++) {
      const nt = notes[i];
      if (nt.src !== 'vocal' || i % 2 === 1) continue;
      const next = notes[i + 1] ? notes[i + 1].t : dur;
      const room = Math.min(beat * 2, next - nt.t - 0.2);
      if (room < beat * 0.9) continue;
      const p0 = power(nt.t + 0.02) + 1e-9;
      if (power(nt.t + beat * 0.6) / p0 < 0.45) continue;
      nt.dur = Math.round(room * 100) / 100;
      nt.kind = 'hold';
    }
  }

  notes.sort(function (a, b) { return a.t - b.t; });
  const mix = { kick: 0, snare: 0, hat: 0, vocal: 0, other: 0, hold: 0 };
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].dur > 0.05) mix.hold++;
    mix[notes[i].src || 'other']++;
  }
  return {
    mode: 'rd', diff: diff, lanes: 1, bpm: A.bpm, beat: beat, offset: off,
    duration: dur, notes: notes, mix: mix, density: density
  };
};

function rand01(k) { const x = Math.sin(k * 12.9898) * 43758.5453; return x - Math.floor(x); }
/* ============================================================
   谱面生成（v0.7 重写）
   核心思路：不再「起音来了就放音符」，而是先看音乐的段落结构，
   给每个小节定一个「音符预算」，再在小节内挑最重要的几个起音。

   1. 段落：按小节统计能量，安静的开头几乎不给音符，副歌才密。
   2. 留白：连续几小节都有音符就强制空一拍/一小节 —— 真人不会一直按。
   3. 鼓点：底鼓/军鼓权重最高，人声次之，踩镲最低（低难度直接不收）。
   4. 网格：全部吸附到 1/4 或 1/8 拍，不做「自由落体」。
   ============================================================ */
LR.buildChart = function (A, opts) {
  const mode = opts.mode || 'fall';
  if (mode === 'rd') return LR.buildRDPattern(A, opts);
  const diffName = DIFFS[opts.diff] ? opts.diff : 'normal';
  const d = DIFFS[diffName];
  const lanes = opts.lanes || 4;
  const density = clamp(opts.density == null ? 0.5 : opts.density, 0, 1);
  const useHolds = opts.holds !== false;
  const useSnap = opts.snap !== false;
  const rand = rng(20240501 + diffName.length * 977 + lanes * 31 + Math.round(density * 100));
  const beat = A.beat, off = A.offset, dur = A.duration;
  const gridDiv = d.sub >= 4 ? 4 : 2;            // 1/4 或 1/8 拍
  const grid = beat / gridDiv;

  /* ---------- 1. 每个小节（4 拍）的能量 ---------- */
  const barLen = beat * 4;
  const bars = Math.max(1, Math.ceil((dur - off) / barLen) + 1);
  const eRaw = new Float32Array(bars);
  for (let i = 0; i < A.onsets.length; i++) {
    const o = A.onsets[i];
    const b = Math.floor((o.t - off) / barLen);
    if (b >= 0 && b < bars) eRaw[b] += o.s;
  }
  const eSm = new Float32Array(bars);
  let eMax = 1e-9;
  for (let b = 0; b < bars; b++) {
    let s2 = 0, n = 0;
    for (let k = Math.max(0, b - 1); k <= Math.min(bars - 1, b + 1); k++) { s2 += eRaw[k]; n++; }
    eSm[b] = s2 / n;
    if (eSm[b] > eMax) eMax = eSm[b];
  }
  for (let b = 0; b < bars; b++) eSm[b] /= eMax;

  /* ---------- 2. 每小节的音符预算 ---------- */
  const BASE = {
    easy:   { quiet: 0, light: 1, mid: 2, busy: 3 },
    normal: { quiet: 1, light: 2, mid: 3, busy: 5 },
    hard:   { quiet: 1, light: 3, mid: 5, busy: 7 },
    expert: { quiet: 2, light: 4, mid: 6, busy: 9 }
  }[diffName];
  const kindW = {
    kick: 1.00, snare: 0.95, vocal: d.sub >= 4 ? 0.85 : 0.6,
    other: d.sub >= 4 ? 0.6 : 0.4, hat: d.sub >= 4 ? 0.35 : 0.05
  };
  const scale = 0.7 + density * 0.6;
  const budget = new Int32Array(bars);
  const level = [];
  for (let b = 0; b < bars; b++) {
    const e = eSm[b];
    const lv = e < 0.28 ? 'quiet' : (e < 0.52 ? 'light' : (e < 0.78 ? 'mid' : 'busy'));
    level.push(lv);
    budget[b] = Math.max(0, Math.round(BASE[lv] * scale));
  }
  /* 强制留白：连续 3 小节都在打，第 4 小节必须松一口气（强度没拉满的话直接空） */
  for (let b = 3; b < bars; b++) {
    if (budget[b - 1] > 0 && budget[b - 2] > 0 && budget[b - 3] > 0 && budget[b] > 0) {
      budget[b] = eSm[b] > 0.82 ? Math.max(1, budget[b] - 2) : 0;
    }
  }
  /* 开头：还没进入状态的前两小节，能空就空 */
  for (let b = 0; b < Math.min(2, bars); b++) if (eSm[b] < 0.55) budget[b] = 0;

  /* ---------- 3. 小节内挑音符 ---------- */
  const notes = [];
  const byBar = [];
  for (let b = 0; b < bars; b++) byBar.push([]);
  for (let i = 0; i < A.onsets.length; i++) {
    const o = A.onsets[i];
    const b = Math.floor((o.t - off) / barLen);
    if (b >= 0 && b < bars) byBar[b].push(o);
  }

  const minGap = Math.max(0.09, beat / d.sub * (1 - (density - 0.5) * 0.25) * 0.55);
  for (let b = 0; b < bars; b++) {
    const cap = budget[b];
    if (cap <= 0) continue;
    const pool = byBar[b].slice();
    if (!pool.length) continue;
    /* 打分：强度 × 乐器权重；再吸附网格 */
    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      o._sc = o.s * (kindW[o.kind] == null ? kindW.other : kindW[o.kind]);
      o._t = o.t;
      if (useSnap) {
        const g = Math.round(o.t / grid) * grid;
        if (Math.abs(g - o.t) <= grid * 0.42) o._t = Math.max(0, g);
      }
    }
    pool.sort(function (x, y) { return y._sc - x._sc; });
    const picked = [];
    for (let i = 0; i < pool.length && picked.length < cap; i++) {
      const o = pool[i];
      if (o._sc <= 0.02) continue;
      let clash = false;
      for (let k = 0; k < picked.length; k++) {
        if (Math.abs(picked[k]._t - o._t) < minGap) { clash = true; break; }
      }
      if (clash) continue;
      picked.push(o);
    }
    picked.sort(function (x, y) { return x._t - y._t; });
    for (let i = 0; i < picked.length; i++) {
      notes.push({ t: picked[i]._t, s: picked[i].s, c: picked[i].c, kind: picked[i].kind,
        p: picked[i].p == null ? 0.5 : picked[i].p, src: picked[i].kind });
    }
  }

  /* ---------- 4. 轨道分配：不同乐器不同策略 ---------- */
  const out = [];
  const outerA = 0, outerB = Math.max(0, lanes - 1);
  const innerA = Math.min(1, lanes - 1), innerB = Math.max(0, lanes - 2);
  let prevLane = -1, prevP = 0.5, dir = 1, lastT = -9, alt = 0;
  for (let i = 0; i < notes.length; i++) {
    const o = notes[i];
    let lane = 0;
    if (lanes > 1) {
      if (o.kind === 'kick') lane = (alt++ % 2 === 0) ? outerA : outerB;
      else if (o.kind === 'snare') lane = (alt++ % 2 === 0) ? innerA : innerB;
      else if (o.kind === 'vocal') {
        const up = o.p > prevP + 0.014 ? 1 : (o.p < prevP - 0.014 ? -1 : 0);
        const from = prevLane < 0 ? Math.floor(lanes / 2) : prevLane;
        lane = from + (up === 0 ? dir : up);
        if (lane < 0 || lane > lanes - 1) { dir = -dir; lane = clamp(from - (up || 1), 0, lanes - 1); }
        prevP = o.p;
      } else if (o.kind === 'hat') {
        lane = (alt++ % 2 === 0) ? clamp(outerB - 1, 0, lanes - 1) : clamp(outerA + 1, 0, lanes - 1);
      } else {
        lane = clamp(Math.round(o.c * (lanes - 1)), 0, lanes - 1);
      }
      lane = clamp(lane, 0, lanes - 1);
      if (lane === prevLane && o.t - lastT < 0.07) lane = clamp(lane + (rand() < 0.5 ? -1 : 1), 0, lanes - 1);
      prevLane = lane; lastT = o.t;
    }
    out.push({ t: o.t, lane: lane, dur: 0, kind: 'tap', s: o.s, src: o.kind });
    if (lanes > 1 && d.chord > 0 && o.s > 0.85 && (o.kind === 'kick' || o.kind === 'snare') && rand() < d.chord) {
      let other = clamp(lanes - 1 - lane, 0, lanes - 1);
      if (other === lane) other = clamp(lane + 1, 0, lanes - 1);
      if (other !== lane) out.push({ t: o.t, lane: other, dur: 0, kind: 'tap', s: o.s * 0.9, src: o.kind });
    }
  }

  /* ---------- 5. 长按：人声拖长 / 乐器延音 ---------- */
  if (useHolds && out.length) {
    const br = A.bandRate, bf = A.bands;
    const power = function (time) {
      const fr = Math.round(time * br);
      if (fr < 0 || fr >= A.frames || !bf) return 0;
      const o = fr * 6;
      return bf[o] + bf[o + 1] + bf[o + 2] + bf[o + 3] + bf[o + 4] + bf[o + 5];
    };
    const times = out.map(function (n) { return n.t; }).sort(function (a, b) { return a - b; });
    for (let i = 0; i < out.length; i++) {
      const n = out[i];
      const want = n.src === 'vocal' ? 0.7 : 0.35;
      if (rand() > want) continue;
      let next = Infinity;
      for (let k = 0; k < times.length; k++) { if (times[k] > n.t + 0.05) { next = times[k]; break; } }
      const room = Math.min(beat * 2, next - n.t - 0.16);
      if (room < beat * 0.7) continue;
      const p0 = power(n.t + 0.02) + 1e-9;
      if (power(n.t + beat * 0.5) / p0 < 0.45) continue;
      let dd2 = 0;
      for (let x = beat * 0.7; x <= room; x += beat * 0.25) { if (power(n.t + x) / p0 > 0.3) dd2 = x; else break; }
      if (dd2 > 0) { n.dur = Math.round(dd2 * 100) / 100; n.kind = 'hold'; }
    }
  }

  out.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
  let leadCut = 0;
  while (leadCut < out.length && out[leadCut].t < 1.3) leadCut++;
  if (leadCut > 0 && leadCut < out.length) out.splice(0, leadCut);

  const mix = { kick: 0, snare: 0, hat: 0, vocal: 0, other: 0, hold: 0, restBars: 0 };
  for (let i = 0; i < out.length; i++) {
    if (out[i].dur > 0.05) mix.hold++;
    mix[out[i].src || 'other']++;
  }
  for (let b = 0; b < bars; b++) if (budget[b] <= 0) mix.restBars++;

  return {
    mode: mode, diff: diffName, lanes: lanes, bpm: A.bpm, beat: beat,
    offset: A.offset, duration: A.duration, notes: out, mix: mix,
    density: density, bars: bars, budget: Array.prototype.slice.call(budget)
  };
};

/* ============================================================
   空白谱面：分析结果照常给（BPM / 拍长 / 偏移 / 时长 / 小节数），
   但一个音符都不放，交给编辑器从零手写。
   返回结构和 buildChart 保持一致，游戏那边不用区分对待。
   ============================================================ */
LR.makeEmptyChart = function (A, opts) {
  opts = opts || {};
  const mode = opts.mode || 'fall';
  const diffName = DIFFS[opts.diff] ? opts.diff : 'normal';
  const lanes = mode === 'rd' ? 1 : (mode === 'side' ? 2 : (opts.lanes || 4));
  const beat = A.beat > 0 ? A.beat : 0.5;
  const off = A.offset || 0;
  const barLen = beat * 4;
  return {
    mode: mode,
    diff: diffName,
    lanes: lanes,
    bpm: A.bpm,
    beat: beat,
    offset: off,
    duration: A.duration,
    notes: [],
    mix: { kick: 0, snare: 0, hat: 0, vocal: 0, other: 0, hold: 0, restBars: 0 },
    density: opts.density == null ? 0.5 : opts.density,
    bars: Math.max(1, Math.ceil((A.duration - off) / barLen) + 1),
    budget: [],
    empty: true
  };
};
/* ============================================================
   手机端检测
   判据：主指针是粗的（coarse）+ 真有触摸点，或者窗口本身就很窄。
   触摸屏笔记本的主指针通常是 fine，所以不会被误判成手机。
   ?mobile=1 / ?mobile=0 可以强制，方便测试与截图。
   ============================================================ */
const MOBILE_FORCE = (function () {
  try {
    const q = new URLSearchParams(location.search).get('mobile');
    return q === '1' ? true : (q === '0' ? false : null);
  } catch (e) { return null; }
})();

LR.isMobile = function () {
  if (MOBILE_FORCE !== null) return MOBILE_FORCE;
  try {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const narrow = Math.min(window.innerWidth, window.innerHeight) <= 560;
    return (coarse && touch) || narrow;
  } catch (e) { return false; }
};

/* 把结果写到 html 上，CSS 用它切整套手机样式 */
LR.syncMobile = function () {
  const m = LR.isMobile();
  document.documentElement.classList.toggle('is-mobile', m);
  document.body.classList.toggle('is-mobile', m);
  return m;
};
/* ---------------- 波形峰值（给预览用） ---------------- */
LR.computePeaks = function (buffer, count) {
  const chs = buffer.numberOfChannels;
  const len = buffer.length;
  const data = [];
  for (let c = 0; c < Math.min(2, chs); c++) data.push(buffer.getChannelData(c));
  const block = Math.max(1, Math.floor(len / count));
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const s = i * block, e = Math.min(len, s + block);
    let mn = 1, mx = -1;
    for (let d = 0; d < data.length; d++) {
      const arr = data[d];
      for (let j = s; j < e; j += 2) {
        const v = arr[j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (mx < mn) { mn = 0; mx = 0; }
    out[i * 2] = mn; out[i * 2 + 1] = mx;
  }
  return out;
};

/* ---------------- 示例曲（离线渲染，方便立刻试玩） ---------------- */
LR.makeSampleSong = async function () {
  const sr = 44100;
  const BPM = 128;
  const beat = 60 / BPM;
  const step = beat / 4;
  const dur = 34;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const master = ctx.createGain();
  master.gain.value = 0.82;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 15000;
  master.connect(lp);
  lp.connect(ctx.destination);

  const noiseLen = Math.ceil(sr * 0.6);
  const nb = ctx.createBuffer(1, noiseLen, sr);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

  function env(g, t, a, d, v) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function kick(t, v) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    env(g, t, 0.004, 0.3, v);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.4);
  }
  function snare(t, v) {
    const s = ctx.createBufferSource(); s.buffer = nb;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    env(g, t, 0.002, 0.17, v);
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.25);
  }
  function hat(t, v) {
    const s = ctx.createBufferSource(); s.buffer = nb;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7800;
    const g = ctx.createGain();
    env(g, t, 0.001, 0.045, v);
    s.connect(hp); hp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.1);
  }
  function tone(t, freq, v, d, type, cut) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sawtooth';
    o.frequency.value = freq;
    let node = g;
    if (cut) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 6;
      g.connect(f); node = f;
    }
    env(g, t, 0.008, d, v);
    o.connect(g); node.connect(master);
    o.start(t); o.stop(t + d + 0.2);
  }

  const pent = [0, 3, 5, 7, 10, 12, 15];
  const root = 110;
  const total = Math.floor((dur - 0.4) / step);
  for (let i = 0; i < total; i++) {
    const t = i * step;
    const bar = Math.floor(i / 16), s = i % 16;
    const sec = Math.floor(bar / 4);
    if (s === 0 || s === 8 || (sec >= 2 && s === 14)) kick(t, 0.95);
    if (s === 4 || s === 12) snare(t, 0.46);
    if (sec >= 2 && (s === 7 || s === 15)) snare(t, 0.24);
    if (s % 2 === 0) hat(t, s % 4 === 0 ? 0.16 : 0.085);
    if (s % 4 === 0) tone(t, s === 8 ? root * 1.5 : root, 0.34, beat * 0.85, 'sawtooth', 420);
    if (sec >= 1 && (s === 3 || s === 6 || s === 11)) tone(t, root * 1.5, 0.22, step * 1.6, 'square', 900);
    if (sec >= 1 && (s === 2 || s === 5 || s === 9 || s === 13)) {
      const n = pent[(i * 3) % pent.length];
      tone(t, root * 4 * Math.pow(2, n / 12), 0.10, step * 1.7, 'triangle', 5200);
    }
    if (sec >= 3 && s % 8 === 0) {
      pent.forEach(function (n, k) {
        tone(t + k * 0.012, root * 2 * Math.pow(2, n / 12), 0.055, beat * 1.9, 'triangle', 4000);
      });
    }
  }
  return await ctx.startRendering();
};

})(window.LR);
