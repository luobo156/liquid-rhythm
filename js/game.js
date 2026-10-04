/* ============================================================
   Liquid Rhythm · game.js
   判定 + 三种玩法渲染（下落 / 节奏医生式 / 横向）
   渲染全部走 Canvas：谱面区域刻意保持纯色高对比，不使用任何玻璃效果
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

const clamp = LR.util.clamp;
const lerp = LR.util.lerp;

const WIN = { perfect: 0.042, great: 0.085, good: 0.125, miss: 0.19 };
const SCORE = { perfect: 300, great: 200, good: 100, miss: 0 };
const ACCW = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };

const LANE_COLORS = [
  { a: '#a7ecff', b: '#127ea8', g: 'rgba(110,215,255,.55)', solid: '#59c8f5' },
  { a: '#ffc2e2', b: '#b8156c', g: 'rgba(255,120,195,.5)', solid: '#f56fb4' },
  { a: '#ffe6a0', b: '#bd7d12', g: 'rgba(255,200,90,.5)', solid: '#f0bb45' },
  { a: '#b3ffd8', b: '#0f9a5f', g: 'rgba(100,240,175,.5)', solid: '#4fdd9d' },
  { a: '#d3c2ff', b: '#6230cf', g: 'rgba(170,140,255,.5)', solid: '#a184f5' },
  { a: '#ffcdb8', b: '#c03f22', g: 'rgba(255,140,105,.5)', solid: '#f5825f' }
];

const BASE_SPEED = { fall: 470, side: 520, rd: 300 };

function rr(c, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, r); return; }
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* ---------- 音符贴图缓存（避免每帧 shadowBlur） ----------
   Phigros 风格：本体是近白色的圆角条，颜色主要靠「外发光 + 底部渐变色」带出来，
   所以本体走「白 → 极浅 → 轨道色」的竖直渐变，外发光用轨道色且范围更大更柔。 */
function makeSprite(w, h, col, round, noChev) {
  const pad = 26;
  const cv = document.createElement('canvas');
  const dpr = 1;
  cv.width = Math.ceil((w + pad * 2) * dpr);
  cv.height = Math.ceil((h + pad * 2) * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const rad = round == null ? Math.min(8, h / 2) : round;
  /* 外发光：用 shadow 贴着音符自身的形状发光。
     之前用径向渐变，宽音符在竖直方向会被贴图边界裁成方块光晕。 */
  for (let i = 0; i < 3; i++) {
    c.shadowColor = hexA(col.solid, 0.85);
    c.shadowBlur = 12 + i * 10;
    c.fillStyle = hexA(col.b, 0.2);
    rr(c, pad, pad, w, h, rad);
    c.fill();
  }
  c.shadowBlur = 0;
  /* 本体：白 → 极浅 → 轨道色 */
  const lg = c.createLinearGradient(0, pad, 0, pad + h);
  lg.addColorStop(0, '#ffffff');
  lg.addColorStop(0.45, '#eff4ff');
  lg.addColorStop(0.8, col.a);
  lg.addColorStop(1, col.solid);
  c.fillStyle = lg;
  rr(c, pad, pad, w, h, rad); c.fill();
  /* 顶部亮芯 */
  c.fillStyle = 'rgba(255,255,255,.95)';
  rr(c, pad + 1.5, pad + 1.2, w - 3, Math.max(2, h * 0.26), Math.max(1, rad * 0.5)); c.fill();
  /* Phigros 风格箭头端头：两端各两道「》」（Muse Dash 的方形小怪不要） */
  if (!noChev) {
  c.strokeStyle = 'rgba(255,255,255,.92)';
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  if (w >= h) {
    const d = Math.min(8, w * 0.1);
    for (let q = 0; q < 2; q++) {
      const off = q * 3.4;
      c.beginPath();
      c.moveTo(pad - d - 1 + off, pad + h * 0.1);
      c.lineTo(pad - 1.5 + off, pad + h / 2);
      c.lineTo(pad - d - 1 + off, pad + h * 0.9);
      c.stroke();
      c.beginPath();
      c.moveTo(pad + w + d + 1 - off, pad + h * 0.1);
      c.lineTo(pad + w + 1.5 - off, pad + h / 2);
      c.lineTo(pad + w + d + 1 - off, pad + h * 0.9);
      c.stroke();
    }
  } else {
    const d = Math.min(8, h * 0.1);
    for (let q = 0; q < 2; q++) {
      const off = q * 3.4;
      c.beginPath();
      c.moveTo(pad + w * 0.1, pad - d - 1 + off);
      c.lineTo(pad + w / 2, pad - 1.5 + off);
      c.lineTo(pad + w * 0.9, pad - d - 1 + off);
      c.stroke();
      c.beginPath();
      c.moveTo(pad + w * 0.1, pad + h + d + 1 - off);
      c.lineTo(pad + w / 2, pad + h + 1.5 - off);
      c.lineTo(pad + w * 0.9, pad + h + d + 1 - off);
      c.stroke();
    }
  }
  }
  /* 描边 */
  c.strokeStyle = 'rgba(255,255,255,.7)';
  c.lineWidth = 1;
  rr(c, pad + 0.5, pad + 0.5, w - 1, h - 1, rad); c.stroke();
  return { cv: cv, pad: pad, w: w, h: h };
}

const Game = {
  cfg: null, chart: null, lanes: [], cursors: [], dstarts: [],
  counts: null, score: 0, combo: 0, maxCombo: 0, judged: 0,
  time: 0, running: false, paused: false, finished: false,
  particles: [], labels: [], holds: [], laneFlash: [], rings: [], gems: [], shake: 0,
  comboPop: 0, lineFlash: 0, fps: 60, _fpsAcc: 0, _fpsN: 0,
  tilt: 0, tiltTarget: 0, tiltBar: -1, bgDim: 0.52, bgBlur: false,
  hero: { l: 0, r: 0, pop: 0, y: 0 },
  geom: null, sprites: null, firstNote: 0, lastNote: 0,
  offset: 0, pxs: 0, hitPulse: 0,

  setup: function (cfg) {
    this.cfg = cfg;
    this.chart = cfg.chart;
    this.offset = (cfg.offsetMs || 0) / 1000;
    this.pxs = BASE_SPEED[cfg.mode] * (cfg.speed || 1);
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.judged = 0;
    this.particles = []; this.labels = []; this.holds = []; this.shake = 0;
    this.time = 0; this.paused = false; this.finished = false; this.running = false; this.auto = false;
    this.comboPop = 0; this.hitPulse = 0;
    /* 表现相关（可在设置里调） */
    this.bgDim = cfg.bgDim == null ? 0.52 : cfg.bgDim;
    this.fxLine = cfg.fxLine !== false;
    this.fxPower = cfg.fxPower == null ? 1 : cfg.fxPower;
    this.style = cfg.style || 'phigros';
    this.auto = cfg.auto === true;      // 自动演奏：按谱面时间自动打击，用来做演示
    this.tilt = 0; this.tiltTarget = 0; this.tiltBar = -1;

    const n = this.chart.lanes;
    this.lanes = [];
    for (let i = 0; i < n; i++) this.lanes.push([]);
    const notes = this.chart.notes;
    for (let i = 0; i < notes.length; i++) {
      const nt = notes[i];
      nt.state = 0; nt.ht = 0; nt.mt = 0; nt.held = false; nt.tailDone = false;
      this.lanes[Math.min(n - 1, nt.lane)].push(nt);
    }
    for (let i = 0; i < n; i++) {
      this.lanes[i].sort(function (a, b) { return a.t - b.t; });
    }
    this.cursors = new Array(n).fill(0);
    this.dstarts = new Array(n).fill(0);
    this.laneFlash = new Array(n).fill(0);

    this.firstNote = notes.length ? notes[0].t : 0;
    this.lastNote = 0;
    for (let i = 0; i < notes.length; i++) this.lastNote = Math.max(this.lastNote, notes[i].t + notes[i].dur);

    const cvs = document.getElementById('field');
    this.canvas = cvs;
    this.ctx = cvs.getContext('2d', { alpha: true });
    this._resize();
    this._buildSprites();
    this._onResize = this._resize.bind(this);
    this._onResizeSprites = this._buildSprites.bind(this);
    window.addEventListener('resize', this._onResize);
    return this;
  },

  _resize: function () {
    const cvs = this.canvas;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cvs.clientWidth || window.innerWidth;
    const h = cvs.clientHeight || window.innerHeight;
    cvs.width = Math.max(2, Math.round(w * dpr));
    cvs.height = Math.max(2, Math.round(h * dpr));
    this.W = w; this.H = h; this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._geom();
    if (this.sprites) this._buildSprites();
  },

  _geom: function () {
    const W = this.W, H = this.H, mode = this.chart.mode, n = this.chart.lanes;
    const g = { mode: mode, lanes: n, W: W, H: H };
    if (mode === 'fall') {
      g.laneW = clamp((W - 40) / n, 62, 148);
      g.fieldW = g.laneW * n;
      g.x0 = (W - g.fieldW) / 2;
      g.judgeY = H - clamp(H * 0.17, 92, 158);
      g.noteH = clamp(g.laneW * 0.26, 16, 30);
    } else if (mode === 'side') {
      /* Muse Dash：只有上/下两条线，行高要够大 */
      g.rowH = clamp(H * 0.2, 96, 150);
      g.fieldH = g.rowH * n;
      g.y0 = H * 0.5 - g.fieldH / 2 + 30;
      g.judgeX = clamp(W * 0.2, 150, 260);
      g.noteW = clamp(g.rowH * 0.3, 14, 28);
    } else {
      g.cy = H * 0.52;
      g.stripH = clamp(H * 0.28, 146, 236);
      g.judgeX = clamp(W * 0.22, 130, 300);
      g.cellW = Math.max(56, this.chart.beat * this.pxs);
    }
    this.geom = g;
  },

  _buildSprites: function () {
    const g = this.geom, n = this.chart.lanes;
    const sp = { taps: [], holds: [] };
    for (let i = 0; i < n; i++) {
      const col = LANE_COLORS[i % LANE_COLORS.length];
      if (g.mode === 'fall') {
        sp.taps.push(makeSprite(g.laneW - 16, g.noteH, col, g.noteH * 0.42));
        sp.holds.push(makeSprite(g.laneW - 26, g.noteH * 0.9, col, g.noteH * 0.4));
      } else if (g.mode === 'side') {
        const sq = clamp(g.rowH * 0.5, 56, 86);
        sp.taps.push(makeSprite(sq, sq, col, sq * 0.34, true));
        sp.holds.push(makeSprite(sq, sq, col, sq * 0.34, true));
      } else {
        const s = clamp(g.cellW * 0.62, 44, Math.min(112, g.stripH * 0.66));
        sp.taps.push(makeSprite(s, s, col, s * 0.3));
        sp.holds.push(sp.taps[i]);
      }
    }
    this.sprites = sp;
  },

  start: function () {
    if (!this.cfg || !this.chart) return;
    this._applyPerf();
    const audio = this.cfg.audio;
    const startAt = Math.max(0, this.firstNote - 3.4);
    this.time = startAt + this.offset;
    audio.play(startAt);
    this.running = true;
    this.paused = false;
    this._last = performance.now();
    const self = this;
    this._raf = requestAnimationFrame(function (t) { self._loop(t); });
  },

  _applyPerf: function () {
    document.body.classList.add('perf-game');
  },

  pause: function () {
    if (!this.running || this.paused || this.finished) return;
    this.paused = true;
    this.cfg.audio.pause();
  },
  resume: function () {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.cfg.audio.resume();
    this._last = performance.now();
  },
  restart: function () {
    this.teardown();
    this.setup(this.cfg);
    this.start();
  },
  teardown: function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this.cfg) this.cfg.audio.stop();
    document.body.classList.remove('perf-game');
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
  },
  quit: function () {
    this.teardown();
    this.cfg = null;
  },

  _loop: function (now) {
    if (!this.running) return;
    const dtRaw = (now - this._last) / 1000;
    this._last = now;
    const dt = clamp(dtRaw || 0.016, 0, 0.05);

    this._fpsAcc += dtRaw; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }

    if (!this.paused && !this.finished) {
      this.time = this.cfg.audio.currentTime() + this.offset;
      this._update(dt);
    } else {
      this._decay(dt);
    }
    this._draw(dt);
    const self = this;
    this._raf = requestAnimationFrame(function (t) { self._loop(t); });
  },

  _decay: function (dt) {
    for (let i = 0; i < this.laneFlash.length; i++) this.laneFlash[i] = Math.max(0, this.laneFlash[i] - dt * 3.4);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.comboPop = Math.max(0, this.comboPop - dt * 4.2);
    this.lineFlash = Math.max(0, this.lineFlash - dt * 5.5);
    this._stepParticles(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.gems.length - 1; i >= 0; i--) {
      this.gems[i].life -= dt;
      if (this.gems[i].life <= 0) this.gems.splice(i, 1);
    }
    for (let i = this.labels.length - 1; i >= 0; i--) {
      this.labels[i].life -= dt;
      if (this.labels[i].life <= 0) this.labels.splice(i, 1);
    }
  },

  _update: function (dt) {
    const t = this.time;
    const n = this.lanes.length;

    /* 长按尾判 */
    for (let i = this.holds.length - 1; i >= 0; i--) {
      const h = this.holds[i];
      if (h.released) { this.holds.splice(i, 1); continue; }
      if (t >= h.t + h.dur) {
        h.tailDone = true;
        this.score += 60;
        this.holds.splice(i, 1);
        this._label(h.x, h.y, 'HOLD', '#ffe08a', 0.5);
        this._burst(h.x, h.y, LANE_COLORS[h.lane % LANE_COLORS.length], 8, 0.6);
      }
    }

    /* 自动演奏：到点就替玩家按下。因为用的是同一个时钟，
       dt 最多一帧（~16ms），落在 ±42ms 的 PERFECT 窗口内。 */
    if (this.auto && !this.paused && !this.finished) {
      for (let l = 0; l < n; l++) {
        const arr = this.lanes[l];
        let c = this.cursors[l];
        while (c < arr.length && arr[c].state !== 0) c++;
        if (c < arr.length && t >= arr[c].t) this.press(l);
      }
    }

    /* 自动 miss */
    for (let l = 0; l < n; l++) {
      const arr = this.lanes[l];
      let c = this.cursors[l];
      while (c < arr.length && arr[c].state !== 0) c++;
      this.cursors[l] = c;
      if (c < arr.length) {
        const nt = arr[c];
        if (t > nt.t + WIN.miss) {
          nt.state = 2; nt.mt = t;
          this._judgeResult('miss', l, nt, true);
          this.cursors[l] = c + 1;
        }
      }
    }

    /* 判定线特效：每 4 拍换一个倾角，用缓动过渡（Phigros 的判定线会移动/倾斜） */
    if (this.fxLine !== false && this.chart.mode === 'fall') {
      const bar = Math.floor((t - this.chart.offset) / (this.chart.beat * 4));
      if (bar !== this.tiltBar) {
        this.tiltBar = bar;
        const seq = [-14, 12, -20, 6, 18, -8];
        this.tiltTarget = seq[((bar % seq.length) + seq.length) % seq.length] * (this.fxPower == null ? 1 : this.fxPower);
      }
      this.tilt += (this.tiltTarget - this.tilt) * Math.min(1, dt * 2.2);
    } else if (this.tilt !== 0) {
      this.tilt += (0 - this.tilt) * Math.min(1, dt * 3);
    }

    /* 结束判定 */
    if (!this.finished) {
      const done = t > this.lastNote + 1.4;
      const ended = !this.cfg.audio.playing && t > this.firstNote + 1;
      if (done || ended || t > this.chart.duration + 0.6) this._finish();
    }
    this._decay(dt);
  },

  _finish: function () {
    if (this.finished) return;
    this.finished = true;
    const stats = this.stats();
    const self = this;
    setTimeout(function () {
      self.teardown();
      if (self.cfg && self.cfg.onFinish) self.cfg.onFinish(stats);
    }, 700);
  },

  stats: function () {
    const c = this.counts;
    const total = c.perfect + c.great + c.good + c.miss;
    const acc = total ? (c.perfect * ACCW.perfect + c.great * ACCW.great + c.good * ACCW.good) / total : 0;
    let grade = 'D';
    if (acc >= 0.99 && c.miss === 0) grade = 'S+';
    else if (acc >= 0.95) grade = 'S';
    else if (acc >= 0.90) grade = 'A';
    else if (acc >= 0.80) grade = 'B';
    else if (acc >= 0.68) grade = 'C';
    return {
      score: Math.round(this.score), acc: acc, grade: grade, counts: c,
      maxCombo: this.maxCombo, total: total, mode: this.chart.mode, diff: this.chart.diff
    };
  },

  /* ---------- 输入 ---------- */
  press: function (lane) {
    if (!this.running || this.paused || this.finished) return;
    if (lane < 0 || lane >= this.lanes.length) return;
    this.laneFlash[lane] = 1;
    const arr = this.lanes[lane];
    let c = this.cursors[lane];
    while (c < arr.length && arr[c].state !== 0) c++;
    this.cursors[lane] = c;
    if (c >= arr.length) { this._pulse(lane); return; }
    const nt = arr[c];
    const dt = this.time - nt.t;
    const ad = Math.abs(dt);

    if (dt < -WIN.good) { this._pulse(lane); return; }

    let j = 'miss';
    if (ad <= WIN.perfect) j = 'perfect';
    else if (ad <= WIN.great) j = 'great';
    else if (ad <= WIN.good) j = 'good';

    if (j === 'miss') {
      nt.state = 2; nt.mt = this.time;
      this.cursors[lane] = c + 1;
      this._judgeResult('miss', lane, nt, false);
      return;
    }

    const pt = this._notePoint(lane, nt);
    nt.state = 1; nt.ht = this.time;
    this.cursors[lane] = c + 1;
    this._judgeResult(j, lane, nt, false);

    if (nt.dur > 0.05) {
      this.holds.push({ lane: lane, t: nt.t, dur: nt.dur, x: pt.x, y: pt.y, released: false });
      nt.held = true;
    }
    this._burst(pt.x, pt.y, LANE_COLORS[lane % LANE_COLORS.length], j === 'perfect' ? 16 : 10, j === 'perfect' ? 1 : 0.7);
  },

  release: function (lane) {
    for (let i = 0; i < this.holds.length; i++) {
      const h = this.holds[i];
      if (h.lane === lane && this.time < h.t + h.dur - 0.1) { h.released = true; }
    }
  },

  _pulse: function (lane) {
    const g = this.geom;
    let x = this.W / 2, y = this.H / 2;
    if (g.mode === 'fall') { x = g.x0 + g.laneW * (lane + 0.5); y = g.judgeY; }
    else if (g.mode === 'side') { x = g.judgeX; y = g.y0 + g.rowH * (lane + 0.5); }
    else { x = g.judgeX; y = g.cy; }
    this.labels.push({ x: x, y: y, text: '', life: 0.16, max: 0.16, color: 'rgba(255,255,255,.35)', small: true });
  },

  /* 每轨的命中 Y：判定线倾斜后，各轨的命中高度不同（Phigros 的判定线是会动的） */
  _laneY: function (lane) {
    const g = this.geom;
    if (!g || g.mode !== 'fall') return g ? g.judgeY : 0;
    const mid = (g.lanes - 1) / 2;
    return g.judgeY + (lane - mid) * (this.tilt || 0);
  },

  _notePoint: function (lane, nt) {
    const g = this.geom;
    if (g.mode === 'fall') return { x: g.x0 + g.laneW * (lane + 0.5), y: this._laneY(lane) - (nt.t - this.time) * this.pxs };
    if (g.mode === 'side') return { x: g.judgeX + (nt.t - this.time) * this.pxs, y: g.y0 + g.rowH * (lane + 0.5) };
    return { x: g.judgeX + (nt.t - this.time) * this.pxs, y: g.cy };
  },

  _judgeResult: function (j, lane, nt, auto) {
    this.counts[j]++;
    this.judged++;
    if (j === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mult = 1 + Math.min(this.combo, 60) / 120;
      this.score += SCORE[j] * mult;
    }
    this.comboPop = 1;
    if (j === 'miss') this.shake = Math.min(6, this.shake + 2.6);

    const pt = this._notePoint(lane, nt);
    const col = LANE_COLORS[lane % LANE_COLORS.length];

    /* 打击反馈：判定线闪 + 扩散环 + 打击音 */
    if (j !== 'miss') {
      this.lineFlash = Math.min(1, this.lineFlash + (j === 'perfect' ? 0.85 : 0.5));
      if (this.geom && this.geom.mode === 'side') this.hero.pop = 1;
      this._ring(pt.x, pt.y, col, j === 'perfect' ? 1 : 0.72);
      if (this.style !== 'plain') this._gem(pt.x, pt.y, j === 'perfect' ? 1.15 : 0.8);
      if (LR.sfx) {
        const eng = this.cfg && this.cfg.audio;
        if (eng && LR.sfx.ensure) LR.sfx.ensure(eng.ctx);
        LR.sfx.hit(j === 'perfect' ? 1 : (j === 'great' ? 0.82 : 0.62));
      }
    }

    if (j === 'miss') this._label(pt.x, pt.y, 'MISS', '#ff8a8a', 0.55);
    else if (j !== 'good') this._label(pt.x, pt.y, j === 'perfect' ? 'PERFECT' : 'GREAT',
      j === 'perfect' ? '#9fe6ff' : '#a8ffcf', 0.5);
    else this._label(pt.x, pt.y, 'GOOD', '#ffe08a', 0.45);
  },

  /* 命中扩散环 */
  _ring: function (x, y, col, power) {
    if (this.rings.length > 26) return;
    this.rings.push({ x: x, y: y, life: 0.34, max: 0.34, r0: 8, r1: 62 * power, color: col.a });
  },

  /* Phigros 的金色菱形爆点 */
  _gem: function (x, y, power) {
    if (this.gems.length > 22) return;
    this.gems.push({ x: x, y: y, life: 0.42, max: 0.42, r: 30 * power, rot: Math.random() * Math.PI });
  },

  _drawGems: function (c) {
    if (!this.gems.length) return;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.gems.length; i++) {
      const r = this.gems[i];
      const k = 1 - r.life / r.max;
      const s = r.r * (0.45 + 0.95 * (1 - Math.pow(1 - k, 3)));
      c.save();
      c.translate(r.x, r.y);
      c.rotate(r.rot + k * 0.7);
      c.globalAlpha = (1 - k) * 0.95;
      c.fillStyle = '#ffd98a';
      c.beginPath();
      c.moveTo(0, -s); c.lineTo(s * 0.2, -s * 0.2); c.lineTo(s, 0); c.lineTo(s * 0.2, s * 0.2);
      c.lineTo(0, s); c.lineTo(-s * 0.2, s * 0.2); c.lineTo(-s, 0); c.lineTo(-s * 0.2, -s * 0.2);
      c.closePath();
      c.fill();
      c.globalAlpha = 1 - k;
      c.fillStyle = '#fffdf2';
      c.beginPath(); c.arc(0, 0, s * 0.2, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  },

  _drawRings: function (c) {
    if (!this.rings.length) return;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const k = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2.2));
      c.globalAlpha = (1 - k) * 0.75;
      c.strokeStyle = r.color;
      c.lineWidth = 3 * (1 - k) + 0.6;
      c.beginPath();
      c.arc(r.x, r.y, rad, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  },

  _label: function (x, y, text, color, life) {
    this.labels.push({ x: x, y: y, text: text, life: life, max: life, color: color });
    if (this.labels.length > 24) this.labels.shift();
  },

  _burst: function (x, y, col, n, power) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 420) break;
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 210) * power;
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 * power,
        life: 0.34 + Math.random() * 0.42, max: 0.76,
        size: 2 + Math.random() * 3.4,
        color: Math.random() < 0.45 ? '#ffffff' : col.solid
      });
    }
  },

  _stepParticles: function (dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.vy += 620 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.985;
    }
  },

  /* ---------- 绘制 ---------- */
  _draw: function (dt) {
    const c = this.ctx, g = this.geom;
    if (!c || !g) return;
    const W = this.W, H = this.H;

    c.save();
    if (this.shake > 0.1) {
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    /* 背景：不再整块纯黑 —— 让页面壁纸透出来，只盖一层可调暗度以保证读谱对比度 */
    c.clearRect(-20, -20, W + 40, H + 40);
    const dim = this.bgDim == null ? 0.52 : this.bgDim;
    if (dim > 0.001) {
      c.fillStyle = 'rgba(4,6,12,' + dim.toFixed(3) + ')';
      c.fillRect(-20, -20, W + 40, H + 40);
    }
    if (this.bgBlur) c.filter = 'none';

    /* 绘制阶段任何异常都不该让整屏黑掉：单独兜底并打一次日志 */
    try {
      if (g.mode === 'fall') this._drawFall(c);
      else if (g.mode === 'side') this._drawSide(c);
      else this._drawRD(c);
    } catch (err) {
      if (!this._drawErr) { this._drawErr = 1; console.error('draw error', err); }
    }

    this._drawRings(c);
    this._drawGems(c);
    this._drawParticles(c);
    this._drawLabels(c);
    c.restore();

    this._drawHud(c);
  },

  _drawFall: function (c) {
    const g = this.geom, t = this.time, H = this.H;
    const flash = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / this.chart.beat * 0.5);

    /* 轨道底色 */
    for (let l = 0; l < g.lanes; l++) {
      const x = g.x0 + g.laneW * l;
      const jy = this._laneY(l);
      const tint = LANE_COLORS[l % LANE_COLORS.length];
      const grd = c.createLinearGradient(0, jy - 160, 0, H);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(1, hexA(tint.b, 0.16 + 0.1 * this.laneFlash[l]));
      c.fillStyle = (l % 2 === 0) ? 'rgba(255,255,255,.022)' : 'rgba(255,255,255,.045)';
      c.fillRect(x, 0, g.laneW, H);
      c.fillStyle = grd;
      c.fillRect(x, jy - 160, g.laneW, H - jy + 160);
      c.fillStyle = 'rgba(255,255,255,.12)';
      c.fillRect(x, 0, 1, H);
    }
    c.fillStyle = 'rgba(255,255,255,.12)';
    c.fillRect(g.x0 + g.fieldW, 0, 1, H);

    /* 长按尾巴 */
    for (let l = 0; l < g.lanes; l++) {
      const arr = this.lanes[l];
      for (let i = this.dstarts[l]; i < arr.length; i++) {
        const n = arr[i];
        const yHead = this._laneY(l) - (n.t - t) * this.pxs;
        if (yHead < -260) break;
        if (n.dur > 0.05 && n.state !== 2) {
          const yTail = this._laneY(l) - (n.t + n.dur - t) * this.pxs;
          const top = Math.min(yHead, yTail), bot = Math.max(yHead, yTail);
          const col = LANE_COLORS[l % LANE_COLORS.length];
          const cg = c.createLinearGradient(0, top, 0, bot);
          cg.addColorStop(0, hexA(col.b, 0.75));
          cg.addColorStop(1, hexA(col.b, 0.35));
          c.fillStyle = cg;
          rr(c, g.x0 + g.laneW * l + 12, top, g.laneW - 24, Math.max(6, bot - top), 7);
          c.fill();
          c.fillStyle = 'rgba(255,255,255,.35)';
          c.fillRect(g.x0 + g.laneW * l + 16, top, 3, Math.max(6, bot - top));
        }
      }
    }

    /* 判定线：细亮芯 + 上方柔和光晕，命中时整条闪一下（Phigros 的感觉） */
    const lf = this.lineFlash || 0;
    const yA = this._laneY(0), yB = this._laneY(g.lanes - 1);
    const xA = g.x0 + g.laneW * 0.5, xB = g.x0 + g.fieldW - g.laneW * 0.5;
    const ang = Math.atan2(yB - yA, xB - xA);
    const len = Math.hypot(xB - xA, yB - yA) + g.laneW + 120;
    c.save();
    c.translate((xA + xB) / 2, (yA + yB) / 2);
    c.rotate(ang);
    const glowH = 52;
    const gl = c.createLinearGradient(0, -glowH, 0, 8);
    gl.addColorStop(0, 'rgba(190,230,255,0)');
    gl.addColorStop(0.62, 'rgba(190,230,255,' + (0.05 + 0.04 * flash + 0.2 * lf).toFixed(3) + ')');
    gl.addColorStop(1, 'rgba(225,245,255,' + (0.13 + 0.05 * flash + 0.42 * lf).toFixed(3) + ')');
    c.fillStyle = gl;
    c.fillRect(-len / 2, -glowH, len, glowH + 8);
    c.fillStyle = 'rgba(255,255,255,' + (0.72 + 0.28 * lf).toFixed(3) + ')';
    c.fillRect(-len / 2, -1, len, 2);
    c.restore();

    /* 键位踏板 + 音符 */
    const spr = this.sprites;
    for (let l = 0; l < g.lanes; l++) {
      const x = g.x0 + g.laneW * l;
      const jy = this._laneY(l);
      const col = LANE_COLORS[l % LANE_COLORS.length];
      const f = this.laneFlash[l];
      /* Phigros 没有键位踏板：只在判定线下面留一行很淡的键位提示 */
      const lab = this.cfg.keyLabels ? this.cfg.keyLabels[l] : '';
      if (lab) {
        const hy = jy + 40;
        c.globalAlpha = f > 0.02 ? 1 : 0.38;
        c.fillStyle = f > 0.02 ? '#fff' : 'rgba(255,255,255,.8)';
        c.font = '600 12px ui-monospace,Consolas,monospace';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(lab, x + g.laneW / 2, hy);
        c.globalAlpha = 1;
        if (f > 0.02) {
          c.fillStyle = hexA(col.a, f);
          rr(c, x + g.laneW * 0.34, hy + 12, g.laneW * 0.32, 3, 1.5);
          c.fill();
        }
      }

      const arr = this.lanes[l];
      while (this.dstarts[l] < arr.length) {
        const n0 = arr[this.dstarts[l]];
        if ((n0.t + n0.dur) < t - 1.2) this.dstarts[l]++;
        else break;
      }
      const s = spr.taps[l];
      for (let i = this.dstarts[l]; i < arr.length; i++) {
        const n = arr[i];
        const y = jy - (n.t - t) * this.pxs;
        if (y < -140) break;
        if (n.state === 1) { if (t - n.ht < 0.18) c.globalAlpha = 1 - (t - n.ht) / 0.18; else continue; }
        else if (n.state === 2) { if (t - n.mt > 0.5) continue; c.globalAlpha = 0.3; }
        else if (n.state === 3) { c.globalAlpha = 1; }
        if (n.dur > 0.05) {
          c.drawImage(spr.holds[l].cv, x + g.laneW / 2 - spr.holds[l].w / 2 - spr.holds[l].pad,
            y - spr.holds[l].h / 2 - spr.holds[l].pad);
        } else {
          c.drawImage(s.cv, x + g.laneW / 2 - s.w / 2 - s.pad, y - s.h / 2 - s.pad);
        }
        c.globalAlpha = 1;
      }
    }
  },

  /* Muse Dash 风格：只有上/下两条线，角色在最左边，音符是从右边跑过来的「敌人」 */
  _drawSide: function (c) {
    const g = this.geom, t = this.time, W = this.W, H = this.H;
    const beat = this.chart.beat;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / beat);

    /* 地面线（两条轨道之间的分界） */
    const groundY = g.y0 + g.fieldH;
    c.fillStyle = 'rgba(255,255,255,.10)';
    c.fillRect(0, groundY, W, 1);
    for (let l = 0; l < g.lanes; l++) {
      const y = g.y0 + g.rowH * l;
      const tint = LANE_COLORS[l % LANE_COLORS.length];
      const grd = c.createLinearGradient(g.judgeX - 120, 0, g.judgeX + 420, 0);
      grd.addColorStop(0, hexA(tint.b, 0.20 + 0.12 * this.laneFlash[l]));
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = grd;
      c.fillRect(g.judgeX - 120, y, 540, g.rowH);
      c.fillStyle = 'rgba(255,255,255,.07)';
      c.fillRect(0, y, W, 1);
    }

    /* 判定线（竖的，带节奏脉冲） */
    const jx = g.judgeX;
    const gr2 = c.createLinearGradient(jx - 6, 0, jx + 46, 0);
    gr2.addColorStop(0, 'rgba(255,255,255,' + (0.5 + 0.3 * pulse).toFixed(3) + ')');
    gr2.addColorStop(1, 'rgba(160,225,255,0)');
    c.fillStyle = gr2;
    c.fillRect(jx - 4, g.y0 - 26, 52, g.fieldH + 52);
    c.fillStyle = 'rgba(255,255,255,' + (0.75 + 0.25 * pulse).toFixed(3) + ')';
    c.fillRect(jx - 1.5, g.y0 - 26, 3, g.fieldH + 52);

    /* 角色（在判定线左边，命中时上下弹一下） */
    const hx = jx - 84, hy = groundY;
    const hp = this.hero;
    hp.pop = Math.max(0, hp.pop - 0.06);
    const bob = -hp.pop * 16;
    const bodyW = 46, bodyH = 62;
    for (let l = 0; l < g.lanes; l++) {
      const cy = g.y0 + g.rowH * (l + 0.5);
      const col = LANE_COLORS[l % LANE_COLORS.length];
      const f = this.laneFlash[l] || 0;
      c.save();
      c.translate(hx, cy + bob);
      c.scale(1 + hp.pop * 0.12, 1 - hp.pop * 0.1);
      c.fillStyle = 'rgba(0,0,0,.35)';
      rr(c, -bodyW / 2 + 2, -bodyH / 2 + 4, bodyW, bodyH, 16); c.fill();
      const bg = c.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(1, col.a);
      c.fillStyle = bg;
      rr(c, -bodyW / 2, -bodyH / 2, bodyW, bodyH, 16); c.fill();
      c.fillStyle = 'rgba(20,20,30,.85)';
      c.beginPath(); c.arc(-9, -6, 4.2, 0, 6.2832); c.fill();
      c.beginPath(); c.arc(9, -6, 4.2, 0, 6.2832); c.fill();
      c.strokeStyle = 'rgba(20,20,30,.7)'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 6, 8, 0.25, Math.PI - 0.25); c.stroke();
      if (f > 0.02) {
        c.strokeStyle = hexA(col.solid, f);
        c.lineWidth = 3;
        rr(c, -bodyW / 2 - 5, -bodyH / 2 - 5, bodyW + 10, bodyH + 10, 20); c.stroke();
      }
      c.restore();
    }

    /* 音符：从右边跑过来的「敌人」 */
    const spr = this.sprites;
    for (let l = 0; l < g.lanes; l++) {
      const y = g.y0 + g.rowH * l;
      const arr = this.lanes[l];
      const col = LANE_COLORS[l % LANE_COLORS.length];
      while (this.dstarts[l] < arr.length) {
        const n0 = arr[this.dstarts[l]];
        if ((n0.t + n0.dur) < t - 1.2) this.dstarts[l]++;
        else break;
      }
      const sp = spr.taps[l];
      for (let i = this.dstarts[l]; i < arr.length; i++) {
        const n = arr[i];
        const x = g.judgeX + (n.t - t) * this.pxs;
        if (x > W + 200) break;
        if (n.state === 1) { if (t - n.ht < 0.18) c.globalAlpha = 1 - (t - n.ht) / 0.18; else continue; }
        else if (n.state === 2) { if (t - n.mt > 0.5) continue; c.globalAlpha = 0.28; }
        const cy = y + g.rowH / 2;
        if (n.dur > 0.05) {
          const xTail = g.judgeX + (n.t + n.dur - t) * this.pxs;
          const a = Math.min(x, xTail), b2 = Math.max(x, xTail);
          const cg = c.createLinearGradient(a, 0, b2, 0);
          cg.addColorStop(0, hexA(col.b, 0.5));
          cg.addColorStop(1, hexA(col.b, 0.9));
          c.fillStyle = cg;
          rr(c, a, cy - g.rowH * 0.26, Math.max(8, b2 - a), g.rowH * 0.52, 14); c.fill();
        }
        /* 敌人本体：圆角块 + 两只眼睛 */
        const ew = Math.min(sp.w, g.rowH * 0.72), eh = ew;
        c.drawImage(sp.cv, x - ew / 2 - sp.pad * (ew / sp.w), cy - eh / 2 - sp.pad * (eh / sp.w),
          (sp.w + sp.pad * 2) * (ew / sp.w), (sp.h + sp.pad * 2) * (eh / sp.w));
        c.fillStyle = 'rgba(24,24,34,.82)';
        c.beginPath(); c.arc(x - ew * 0.16, cy - eh * 0.06, ew * 0.07, 0, 6.2832); c.fill();
        c.beginPath(); c.arc(x + ew * 0.16, cy - eh * 0.06, ew * 0.07, 0, 6.2832); c.fill();
        c.globalAlpha = 1;
      }
    }
  },

  _drawRD: function (c) {
    const g = this.geom, t = this.time, W = this.W;
    const cy = g.cy, half = g.stripH / 2, cellW = g.cellW, beat = this.chart.beat;
    const off = this.chart.offset;

    /* 长条底 */
    c.fillStyle = 'rgba(255,255,255,.035)';
    rr(c, 0, cy - half, W, g.stripH, 18); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.1)'; c.lineWidth = 1;
    rr(c, 0.5, cy - half + 0.5, W - 1, g.stripH - 1, 18); c.stroke();

    /* 拍格 */
    const kMin = Math.floor((t - off) / beat) - 3;
    const kMax = Math.ceil((t - off) / beat + (W - g.judgeX) / cellW) + 2;
    for (let k = kMin; k <= kMax; k++) {
      const x = g.judgeX + (off + k * beat - t) * this.pxs;
      if (x < -cellW - 20 || x > W + 20) continue;
      const bar = ((k % 7) + 7) % 7;
      const is7 = bar === 6;
      c.fillStyle = is7 ? 'rgba(255,150,210,.13)' : (k % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)');
      rr(c, x + 3, cy - half + 8, cellW - 6, g.stripH - 16, 13);
      c.fill();
      c.strokeStyle = is7 ? 'rgba(255,170,220,.4)' : 'rgba(255,255,255,.09)';
      c.lineWidth = 1;
      rr(c, x + 3.5, cy - half + 8.5, cellW - 7, g.stripH - 17, 13);
      c.stroke();
      c.fillStyle = is7 ? 'rgba(255,190,230,.75)' : 'rgba(255,255,255,.3)';
      c.font = '700 12px ui-monospace,Consolas,monospace';
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(String(bar + 1), Math.max(6, x + 12), cy - half + 16);
    }

    /* 判定线 */
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / beat);
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.fillRect(g.judgeX - 2, cy - half - 10, 3, g.stripH + 20);
    c.strokeStyle = 'rgba(180,235,255,' + (0.35 + 0.4 * pulse) + ')';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(g.judgeX, cy, Math.min(52, half * 0.5) * (1 + 0.06 * pulse), 0, Math.PI * 2);
    c.stroke();

    /* 踏板 */
    const f = this.laneFlash[0] || 0;
    c.fillStyle = f > 0.02 ? 'rgba(160,230,255,' + (0.2 + 0.35 * f) + ')' : 'rgba(255,255,255,.06)';
    rr(c, g.judgeX - 78, cy - 30, 46, 60, 12); c.fill();
    c.strokeStyle = f > 0.02 ? 'rgba(200,240,255,.95)' : 'rgba(255,255,255,.28)';
    c.lineWidth = 1.5;
    rr(c, g.judgeX - 77.5, cy - 29.5, 45, 59, 12); c.stroke();
    const lab = this.cfg.keyLabels ? this.cfg.keyLabels[0] : '';
    if (lab) {
      c.fillStyle = f > 0.02 ? '#fff' : 'rgba(255,255,255,.66)';
      c.font = '600 12px ui-monospace,Consolas,monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(lab, g.judgeX - 55, cy);
    }

    /* 音符 */
    const arr = this.lanes[0], s = this.sprites.taps[0];
    while (this.dstarts[0] < arr.length && (arr[this.dstarts[0]].t + arr[this.dstarts[0]].dur) < t - 1.2) this.dstarts[0]++;
    for (let i = this.dstarts[0]; i < arr.length; i++) {
      const n = arr[i];
      const x = g.judgeX + (n.t - t) * this.pxs;
      if (x > W + 200) break;
      if (n.state === 1) { if (t - n.ht < 0.2) c.globalAlpha = 1 - (t - n.ht) / 0.2; else continue; }
      else if (n.state === 2) { if (t - n.mt > 0.5) continue; c.globalAlpha = 0.28; }
      /* 按到下一颗音符的间距缩放，密集段落也不会糊成一条 */
      const gapT = (i + 1 < arr.length) ? (arr[i + 1].t - n.t) : beat;
      const k = Math.min(1, Math.max(0.34, (gapT * this.pxs * 0.84) / s.w));
      const dw = (s.w + s.pad * 2) * k, dh = (s.h + s.pad * 2) * k;
      c.drawImage(s.cv, x - dw / 2, cy - dh / 2, dw, dh);
      c.globalAlpha = 1;
    }
  },

  _drawParticles: function (c) {
    const ps = this.particles;
    if (!ps.length) return;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const a = clamp(p.life / p.max, 0, 1);
      c.globalAlpha = a * 0.85;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size * (0.4 + a * 0.8), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  },

  _drawLabels: function (c) {
    for (let i = 0; i < this.labels.length; i++) {
      const L = this.labels[i];
      const k = 1 - L.life / L.max;
      const a = 1 - k;
      const rise = -34 * (1 - Math.pow(1 - k, 3));
      c.globalAlpha = clamp(a * 1.2, 0, 1);
      if (L.small) {
        c.fillStyle = L.color;
        c.beginPath();
        c.arc(L.x, L.y, 10 + 22 * k, 0, Math.PI * 2);
        c.globalAlpha *= 0.35;
        c.fill();
        c.globalAlpha = 1;
        continue;
      }
      c.fillStyle = L.color;
      c.font = '700 ' + (16 + 4 * (1 - k)) + 'px "SF Pro Display",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(L.text, L.x, L.y + rise);
      c.globalAlpha = 1;
    }
  },

  _drawHud: function (c) {
    const W = this.W, H = this.H, g = this.geom;
    const t = this.time;
    const prog = this.chart.duration > 0 ? clamp(t / this.chart.duration, 0, 1) : 0;

    /* 顶部进度条 */
    c.fillStyle = 'rgba(255,255,255,.08)';
    c.fillRect(0, 0, W, 3);
    const pg = c.createLinearGradient(0, 0, W, 0);
    pg.addColorStop(0, '#6fd4ff');
    pg.addColorStop(0.5, '#b78bff');
    pg.addColorStop(1, '#ff7ac0');
    c.fillStyle = pg;
    c.fillRect(0, 0, W * prog, 3);

    /* ---- Phigros 布局：右上分数（7 位补零）/ 中上连击 + RECORD / 左下曲名 / 右下等级 ---- */
    const st = this.stats();
    c.textAlign = 'right'; c.textBaseline = 'top';
    c.font = '600 30px ui-monospace,Consolas,monospace';
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.fillText(String(st.score).padStart(7, '0'), W - 26, 14);
    c.font = '600 12px ui-monospace,Consolas,monospace';
    c.fillStyle = 'rgba(200,225,255,.6)';
    c.fillText((st.acc * 100).toFixed(2) + '%', W - 26, 50);

    if (this.combo >= 2) {
      const pop = 1 + this.comboPop * 0.24;
      c.save();
      c.translate(W / 2, 52);
      c.scale(pop, pop);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '700 46px "SF Pro Display",system-ui,sans-serif';
      c.shadowColor = 'rgba(180,225,255,.9)';
      c.shadowBlur = 22;
      c.fillStyle = '#ffffff';
      c.fillText(String(this.combo), 0, 0);
      c.shadowBlur = 0;
      c.font = '600 12px ui-monospace,Consolas,monospace';
      c.fillStyle = 'rgba(210,232,255,.62)';
      c.fillText('RECORD', 0, 32);
      c.restore();
    }

    if (this.auto) {
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.font = '700 13px ui-monospace,Consolas,monospace';
      const bw = 54, bh = 22;
      c.fillStyle = 'rgba(255,214,120,.22)';
      rr(c, 26, 18, bw, bh, 7); c.fill();
      c.strokeStyle = 'rgba(255,214,120,.8)'; c.lineWidth = 1;
      rr(c, 26.5, 18.5, bw - 1, bh - 1, 7); c.stroke();
      c.fillStyle = '#ffd98a';
      c.fillText('AUTO', 26 + bw / 2 - 15, 18 + bh / 2 - 7);
    }

    const lv = { easy: 'Lv.5', normal: 'Lv.9', hard: 'Lv.13', expert: 'Lv.15' }[this.chart.diff] || 'Lv.?';
    c.font = '600 14px system-ui,"PingFang SC",sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillStyle = 'rgba(255,255,255,.78)';
    c.fillText(this.cfg.title || '', 26, H - 18);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(255,255,255,.66)';
    c.fillText(lv, W - 26, H - 18);

    /* 开场倒计时 */
    const cd = this.firstNote - t;
    if (cd > 0 && cd < 3.6) {
      const n = Math.ceil(cd);
      const frac = 1 - (cd - Math.floor(cd));
      c.save();
      c.translate(W / 2, H * 0.42);
      c.scale(1 + (1 - frac) * 0.35, 1 + (1 - frac) * 0.35);
      c.globalAlpha = clamp(frac * 1.4, 0, 1);
      c.font = '700 76px "SF Pro Display",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#dff0ff';
      c.fillText(n > 0 ? String(n) : 'GO', 0, 0);
      c.restore();
      c.globalAlpha = 1;
    }

    /* 帧率 */
    if (LR.settings && LR.settings.showFps) {
      c.font = '600 12px ui-monospace,Consolas,monospace';
      c.textAlign = 'right'; c.textBaseline = 'bottom';
      c.fillStyle = 'rgba(150,240,190,.8)';
      c.fillText(this.fps.toFixed(0) + ' FPS · ' + this.particles.length + ' p', W - 12, H - 10);
    }
  }
};

LR.Game = Game;
})(window.LR);
