/* ============================================================
   Liquid Rhythm · sfx.js
   打击音效：纯 Web Audio 合成，不用任何音频文件。
   音色参考音游的「click / tick」：一个极短的宽频瞬态（噪声过带通）+ 一个快速衰减的音高瞬态。
   两种音色：
     crisp  —— 干脆的「嗒」（默认，像 Phigros 的打击音）
     bright —— 更亮的「叮」，音高更高、尾巴略长
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

function SFX() {
  this.ctx = null;
  this.master = null;
  this.noise = null;
  this.enabled = true;
  this.volume = 0.75;
  this.tone = 'crisp';
}

SFX.prototype.ensure = function (ctx) {
  if (!this.ctx && ctx) this.ctx = ctx;
  if (!this.ctx) return null;
  if (!this.master) {
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }
  if (!this.noise) {
    const len = Math.ceil(this.ctx.sampleRate * 0.05);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }
  return this.ctx;
};

SFX.prototype.setVolume = function (v) {
  this.volume = Math.max(0, Math.min(1, v));
  if (this.master) this.master.gain.value = this.volume;
};

/* when: 相对 ctx.currentTime 的秒偏移（用来贴到音频时钟上，减少抖动） */
SFX.prototype.hit = function (strength, when) {
  const ctx = this.ctx;
  if (!ctx || !this.enabled || this.volume <= 0) return;
  const t = Math.max(ctx.currentTime, when || ctx.currentTime);
  const s = strength == null ? 1 : Math.max(0.35, Math.min(1, strength));
  const bright = this.tone === 'bright';

  /* 1) 宽频瞬态：噪声过带通，5ms 起振、~40ms 衰减 */
  const src = ctx.createBufferSource();
  src.buffer = this.noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = bright ? 2600 : 1500;   // 高通让瞬态更「脆」
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking';
  bp.frequency.value = bright ? 6200 : 4200;   // 在 4~6kHz 抬一下 = 清脆的来源
  bp.Q.value = 1.1;
  bp.gain.value = 9;
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(0.0001, t);
  g1.gain.linearRampToValueAtTime(0.95 * s, t + 0.0012);   // 更响
  g1.gain.exponentialRampToValueAtTime(0.0001, t + (bright ? 0.062 : 0.044)); // 比上一版略长一点，留一点尾巴
  src.connect(hp); hp.connect(bp); bp.connect(g1); g1.connect(this.master);
  src.start(t);
  src.stop(t + 0.08);

  /* 2) 音高瞬态：给「打击」一个明确的音头 */
  const o = ctx.createOscillator();
  o.type = 'square';                            // 方波比三角波更有「哒」的锐利感
  const f0 = bright ? 2400 : 1700;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.028);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = bright ? 7000 : 5000;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.linearRampToValueAtTime(0.5 * s, t + 0.0008);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + (bright ? 0.1 : 0.062));
  o.connect(lp); lp.connect(g2); g2.connect(this.master);
  o.start(t);
  o.stop(t + 0.12);

  /* 3) 一个极短的「咔」：极高频噪声，2ms 内衰完，提供清晰度 */
  const src2 = ctx.createBufferSource();
  src2.buffer = this.noise;
  const hp2 = ctx.createBiquadFilter();
  hp2.type = 'highpass';
  hp2.frequency.value = 7000;
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(0.0001, t);
  g3.gain.linearRampToValueAtTime(0.42 * s, t + 0.0006);
  g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.016);
  src2.connect(hp2); hp2.connect(g3); g3.connect(this.master);
  src2.start(t);
  src2.stop(t + 0.03);
};

/* 长按尾判完成的轻响 */
SFX.prototype.tail = function (when) {
  const ctx = this.ctx;
  if (!ctx || !this.enabled || this.volume <= 0) return;
  const t = Math.max(ctx.currentTime, when || ctx.currentTime);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.14, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g); g.connect(this.master);
  o.start(t); o.stop(t + 0.16);
};

/* 倒计时 / UI 反馈用的短音 */
SFX.prototype.blip = function (freq, when, gain) {
  const ctx = this.ctx;
  if (!ctx || !this.enabled || this.volume <= 0) return;
  const t = Math.max(ctx.currentTime, when || ctx.currentTime);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq || 660;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime((gain || 0.18), t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g); g.connect(this.master);
  o.start(t); o.stop(t + 0.2);
};

LR.SFX = SFX;
LR.sfx = new SFX();

})(window.LR);
