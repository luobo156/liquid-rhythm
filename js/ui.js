/* ============================================================
   Liquid Rhythm · ui.js
   界面流转 / 导入音乐 / 设置持久化 / 键位改绑 / 波形+谱面预览
   ============================================================ */
(function (LR) {
'use strict';

const $ = function (sel) { return document.querySelector(sel); };
const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
const clamp = LR.util.clamp;
const fmtTime = LR.util.fmtTime;

/* ---------------- 设置（只存可序列化的小数据） ----------------
   下面的默认值来自实际调校出来的一套手感：折射强（87px）、模糊与染色都很低（2px / 4%），
   色散几乎关掉（4%）—— 也就是「一块很清透的厚玻璃」而不是磨砂板。
   变更这些值只会影响首次访问或清空过站点数据的人；已经存过设置的人不受影响。 */
const DEFAULTS = {
  quality: 'high',
  glassLens: true,
  lensBevel: 32,
  lensScale: 87,
  lensDisp: 0.04,
  lensBlur: 2,
  lensTint: 0.04,
  playBg: true,
  autoPlay: false,
  playDim: 0.52,
  fxLine: false,
  fxPower: 1,
  sfxOn: true,
  sfxVolume: 0.94,
  sfxTone: 'crisp',
  bgPreset: 'studio',
  bgUrl: '',
  bgDim: 0.51,
  bgBlur: 0,
  bgAnim: false,
  dragUI: true,
  showFps: false,
  reduceMotion: false,
  volume: 0.85,
  offsetMs: 0,
  speed: 1.0,
  diff: 'expert',
  lanes: 6,
  density: 0.5,
  holds: true,
  snap: true
};
const DEFAULT_KEYS = {
  fall: { '4': ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], '6': ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'] },
  side: { '2': ['KeyF', 'KeyJ'], '4': ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], '6': ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'] },
  rd: { '1': ['Space'] }
};
const LSK = 'lr.settings.v1';
const LKK = 'lr.keys.v1';

function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function hasSavedSettings() {
  try { return !!localStorage.getItem(LSK); } catch (e) { return true; }
}
const S = Object.assign({}, DEFAULTS, loadJSON(LSK) || {});
let KEYS = loadJSON(LKK);
if (!KEYS || typeof KEYS !== 'object') KEYS = JSON.parse(JSON.stringify(DEFAULT_KEYS));
for (const m in DEFAULT_KEYS) {
  if (!KEYS[m] || typeof KEYS[m] !== 'object') KEYS[m] = JSON.parse(JSON.stringify(DEFAULT_KEYS[m]));
  for (const k in DEFAULT_KEYS[m]) {
    const v = KEYS[m][k];
    if (!Array.isArray(v) || !v.length) KEYS[m][k] = DEFAULT_KEYS[m][k].slice();
  }
}
LR.settings = S;

/* 运行时数据与设置分开存放，绝不写进 localStorage */
const RT = { buffer: null, analysis: null, peaks: null, peaksN: 1200, chart: null, songName: '' };

function save() { try { localStorage.setItem(LSK, JSON.stringify(S)); } catch (e) { /* ignore */ } }
function saveKeys() { try { localStorage.setItem(LKK, JSON.stringify(KEYS)); } catch (e) { /* ignore */ } }

const audio = new LR.AudioEngine();
LR.audio = audio;

function applySettings() {
  const b = document.body;
  b.classList.toggle('q-high', S.quality === 'high');
  b.classList.toggle('q-mid', S.quality === 'mid');
  b.classList.toggle('q-low', S.quality === 'low');
  b.classList.toggle('no-bganim', !S.bgAnim || S.quality === 'low');
  b.classList.toggle('reduce-motion', !!S.reduceMotion);
  audio.setVolume(S.volume);
  if (LR.sfx) {
    LR.sfx.enabled = S.sfxOn !== false;
    LR.sfx.tone = S.sfxTone || 'crisp';
    LR.sfx.setVolume(S.sfxVolume == null ? 0.6 : S.sfxVolume);
  }
  if (LR.Glass) LR.Glass.apply(S);
  if (LR.Backdrop) LR.Backdrop.apply(S);
}

/* ---------------- 小件 ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2400);
}

const busy = {
  show: function (text, sub) {
    $('#busyText').textContent = text || '处理中…';
    if (sub != null) $('#busySub').textContent = sub;
    $('#busy').classList.remove('is-hidden');
  },
  prog: function (p) { $('#busyBar').style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; },
  hide: function () { $('#busy').classList.add('is-hidden'); }
};

function showSheet(id) {
  $('#' + id).classList.remove('is-hidden');
  if (LR.Glass) setTimeout(function () { LR.Glass.refresh(); }, 640);
}
function hideSheet(id) { $('#' + id).classList.add('is-hidden'); }

/* ---------------- 屏幕 ---------------- */
let currentScreen = 'menu';
function show(name) {
  if (currentScreen === name) return;
  /* 离开编辑器就把它的键盘/滚轮监听摘掉，否则会跟游戏抢按键 */
  if (currentScreen === 'editor' && name !== 'editor' && LR.Editor) LR.Editor.close();
  $$('.screen').forEach(function (s) { s.classList.remove('is-active'); });
  const el = $('#screen-' + name);
  if (el) el.classList.add('is-active');
  currentScreen = name;
  document.body.classList.toggle('in-game', name === 'game');
  if (LR.Glass) setTimeout(function () { LR.Glass.refresh(); }, 620);
}

/* ---------------- 模式 ---------------- */
let mode = 'fall';
function laneCount() {
  if (mode === 'rd') return 1;
  if (mode === 'side') return 2;      // Muse Dash 只有上/下两条线
  return S.lanes === 6 ? 6 : 4;
}
function currentKeys() {
  const table = KEYS[mode] || DEFAULT_KEYS[mode];
  const arr = table[String(laneCount())];
  if (!arr) return DEFAULT_KEYS[mode][String(laneCount())].slice();
  return arr.slice(0, laneCount());
}
const KEY_LABEL = {
  Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT', Enter: 'ENTER', Backspace: 'BKSP', Tab: 'TAB', CapsLock: 'CAPS',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`'
};
function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABEL[code]) return KEY_LABEL[code];
  if (code.indexOf('Key') === 0) return code.slice(3);
  if (code.indexOf('Digit') === 0) return code.slice(5);
  if (code.indexOf('Numpad') === 0) return 'NUM' + code.slice(6);
  if (code.indexOf('Arrow') === 0) {
    const m = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
    return m[code.slice(5)] || code;
  }
  return code.toUpperCase();
}

function setMode(m, silent) {
  if (currentScreen === 'game' && !silent) { toast('游戏中不能切换玩法'); return; }
  mode = m;
  $$('#modeNav .chip').forEach(function (c) {
    const on = c.dataset.mode === m;
    c.classList.toggle('is-on', on);
    c.setAttribute('aria-pressed', String(on));
  });
  $$('.mcard').forEach(function (c) { c.classList.toggle('is-on', c.dataset.mode === m); });
  moveGlider();
  const lanesRow = $('#optLanes').closest('.opt');
  const holdsRow = $('#optHolds').closest('.opt');
  if (lanesRow) lanesRow.style.display = (m === 'rd' || m === 'side') ? 'none' : '';
  if (holdsRow) holdsRow.style.display = (m === 'rd') ? 'none' : '';
  $('#pillMode').textContent = m === 'fall' ? '下落式' : (m === 'rd' ? '节奏医生式' : '横向');
  if (RT.analysis) buildChart();
  if (!silent) save();
}
function moveGlider() {
  const chip = $('#modeNav .chip.is-on');
  const g = $('#modeGlider');
  if (!chip || !g) return;
  g.style.width = chip.offsetWidth + 'px';
  g.style.transform = 'translateX(' + (chip.offsetLeft - 5) + 'px)';
}

/* ---------------- 预览画布 ---------------- */
let staticCv = null, previewRaf = null;

function drawWaveStatic() {
  const cv = $('#wave');
  if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 800, H = cv.clientHeight || 180;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const chart = RT.chart, A = RT.analysis;
  if (!chart || !A || !RT.peaks) {
    c.fillStyle = 'rgba(255,255,255,.25)';
    c.font = '13px system-ui,sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('导入音乐后，这里会显示波形 + 自动生成的谱面', W / 2, H / 2);
    staticCv = null;
    return;
  }
  const dur = chart.duration || 1;
  const xOf = function (t) { return (t / dur) * W; };

  /* 节拍网格 */
  const beatPx = (chart.beat / dur) * W;
  const skip = beatPx < 5 ? Math.ceil(5 / Math.max(0.01, beatPx)) : 1;
  c.strokeStyle = 'rgba(255,255,255,.07)';
  c.lineWidth = 1;
  for (let i = 0; i < A.beats.length; i += skip) {
    const x = Math.round(xOf(A.beats[i])) + 0.5;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
  }

  /* 波形 */
  const mid = H * 0.72, amp = H * 0.24;
  const pk = RT.peaks, N = RT.peaksN;
  c.beginPath();
  c.moveTo(0, mid);
  for (let i = 0; i < N; i++) c.lineTo((i / N) * W, mid - pk[i * 2 + 1] * amp);
  for (let i = N - 1; i >= 0; i--) c.lineTo((i / N) * W, mid - pk[i * 2] * amp);
  c.closePath();
  const wg = c.createLinearGradient(0, mid - amp, 0, mid + amp);
  wg.addColorStop(0, 'rgba(140,215,255,.55)');
  wg.addColorStop(0.5, 'rgba(150,160,255,.32)');
  wg.addColorStop(1, 'rgba(200,140,255,.5)');
  c.fillStyle = wg;
  c.fill();

  /* 谱面小钢琴卷 */
  const lanes = chart.lanes;
  const top = 8, rollH = H * 0.42, rowH = rollH / lanes;
  c.fillStyle = 'rgba(255,255,255,.045)';
  c.fillRect(0, top, W, rollH);
  const cols = ['#59c8f5', '#f56fb4', '#f0bb45', '#4fdd9d', '#a184f5', '#f5825f'];
  for (let i = 0; i < chart.notes.length; i++) {
    const n = chart.notes[i];
    const x = xOf(n.t);
    const w = Math.max(2, xOf(n.t + Math.max(n.dur, 0.02)) - x);
    const y = top + rowH * (lanes - 1 - Math.min(lanes - 1, n.lane));
    const h = Math.max(2.5, rowH - 3);
    c.fillStyle = cols[n.lane % 6];
    c.globalAlpha = n.dur > 0.05 ? 0.9 : 1;
    c.fillRect(x, y + (rowH - h) / 2, Math.max(2, w), h);
  }
  c.globalAlpha = 1;

  staticCv = document.createElement('canvas');
  staticCv.width = cv.width; staticCv.height = cv.height;
  staticCv.getContext('2d').drawImage(cv, 0, 0);
  paintWave(audio.playing ? audio.currentTime() : 0);
}

function paintWave(t) {
  const cv = $('#wave');
  if (!cv || !staticCv) return;
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.drawImage(staticCv, 0, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cv.width / dpr, H = cv.height / dpr;
  const chart = RT.chart;
  if (!chart) return;
  const x = (t / (chart.duration || 1)) * W;
  c.strokeStyle = 'rgba(255,255,255,.85)';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.9)';
  c.fillRect(x - 3, 0, 6, 4);
}

function startPreview() {
  if (!RT.buffer) { toast('先导入音乐或生成示例曲'); return; }
  if (previewRaf) { stopPreview(); return; }
  audio.play(0);
  const step = function () {
    const ct = audio.currentTime();
    paintWave(ct);
    if (ct > 12 || !audio.playing) { stopPreview(); return; }
    previewRaf = requestAnimationFrame(step);
  };
  previewRaf = requestAnimationFrame(step);
  $('#btnPreview').textContent = '停止试听';
}
function stopPreview() {
  if (previewRaf) cancelAnimationFrame(previewRaf);
  previewRaf = null;
  audio.stop();
  const b = $('#btnPreview');
  if (b) b.textContent = '试听 12 秒';
  paintWave(0);
}

/* ---------------- 谱面构建 ---------------- */
/* 只刷新文案与预览图，不碰音符数据（编辑器保存后要用这个） */
function refreshChartMeta() {
  if (!RT.chart) return;
  const notes = RT.chart.notes;
  const holds = notes.filter(function (x) { return x.dur > 0.05; }).length;
  $('#pillBpm').textContent = 'BPM ' + RT.chart.bpm.toFixed(1);
  $('#pillNotes').textContent = '音符 ' + notes.length + (holds ? ' · 长按 ' + holds : '');
  const nps = RT.chart.duration > 0 ? (notes.length / RT.chart.duration).toFixed(2) : '0';
  $('#songMeta').textContent = RT.songName + ' · ' + fmtTime(RT.chart.duration) + ' · 平均 ' + nps + ' 音符/秒 · ' +
    (mode === 'fall' ? '下落式' : mode === 'rd' ? '节奏医生式' : '横向') + ' · ' +
    RT.chart.lanes + ' 轨 · 难度 ' + LR.DIFFS[RT.chart.diff].label +
    (RT.chart.notes.length ? (RT.chart.edited ? ' · 已手动编辑' : '') : ' · 空白谱面');
  drawWaveStatic();
}

function buildChart() {
  if (!RT.analysis) return;
  if (RT.chart && RT.chart.edited) toast('谱面已重新生成，之前的手动修改被丢弃');
  RT.chart = LR.buildChart(RT.analysis, {
    mode: mode,
    diff: S.diff,
    lanes: laneCount(),
    density: S.density,
    holds: S.holds,
    snap: S.snap
  });
  RT.chart.edited = false;
  refreshChartMeta();
}

/* ---------------- 导入 / 分析 ---------------- */
async function handleFile(file) {
  if (!file) return;
  const okName = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(file.name);
  if (!okName && !/^audio\//i.test(file.type)) { toast('看起来不是音频文件'); return; }
  stopPreview();
  busy.show('正在解码音频…', file.name);
  busy.prog(0.05);
  try {
    const ab = await file.arrayBuffer();
    audio.ensure();
    const buf = await audio.decode(ab);
    RT.buffer = buf;
    RT.songName = file.name.replace(/\.[^.]+$/, '');
    await runAnalysis();
  } catch (e) {
    busy.hide();
    console.error(e);
    toast('解码失败：' + (e && e.message ? e.message : '格式可能不被浏览器支持'));
  }
}

async function loadSample() {
  stopPreview();
  busy.show('正在生成示例曲…', '离线合成 128 BPM 鼓组 + 旋律');
  busy.prog(0.06);
  try {
    audio.ensure();
    const buf = await LR.makeSampleSong();
    RT.buffer = buf;
    RT.songName = '示例曲 · 128 BPM';
    await runAnalysis();
  } catch (e) {
    busy.hide();
    console.error(e);
    toast('生成失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

async function runAnalysis() {
  busy.show('正在分析音频…', 'FFT 频谱通量 + 自适应阈值');
  busy.prog(0);
  await LR.util.nextTick();
  try {
    const A = await LR.analyze(RT.buffer, function (p) {
      busy.prog(p);
      if ((Math.round(p * 100) % 4) === 0) busy.show('正在分析音频… ' + Math.round(p * 100) + '%');
    });
    RT.analysis = A;
    const N = Math.min(1600, Math.max(600, Math.round(($('#wave').clientWidth || 900) * 1.6)));
    RT.peaksN = N;
    RT.peaks = LR.computePeaks(RT.buffer, N);
    audio.setBuffer(RT.buffer);
    if (mode === 'rd') { /* 保持当前模式 */ }
    busy.hide();
    show('setup');
    requestAnimationFrame(drawWaveStatic);
    showChartChoice();
  } catch (e) {
    busy.hide();
    console.error(e);
    toast('分析失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

/* ---------------- 谱面来源选择 ---------------- */
function showChartChoice() {
  const tip = $('#chartTip');
  if (tip) {
    tip.textContent = RT.songName + ' · ' + fmtTime(RT.analysis.duration) +
      ' · BPM ' + RT.analysis.bpm.toFixed(1) + ' · ' +
      (mode === 'fall' ? '下落式' : mode === 'rd' ? '节奏医生式' : '横向') +
      ' · ' + laneCount() + ' 轨 · 难度 ' + LR.DIFFS[S.diff].label;
  }
  const blank = $('#pickBlank');
  if (blank) blank.classList.toggle('pick--primary', false);
  const auto = $('#pickAuto');
  if (auto) auto.classList.add('pick--primary');
  showSheet('sheetChart');
}

function chooseAuto() {
  hideSheet('sheetChart');
  buildChart();
  refreshChartMeta();
  toast('谱面已生成：' + RT.chart.notes.length + ' 音符 · BPM ' + RT.chart.bpm.toFixed(1));
}

function chooseBlank() {
  hideSheet('sheetChart');
  RT.chart = LR.makeEmptyChart(RT.analysis, {
    mode: mode, diff: S.diff, lanes: laneCount(), density: S.density
  });
  RT.chart.edited = true;          // 空白谱面也算「手动」，避免被误当成自动生成的结果
  refreshChartMeta();
  openEditor();
}

/* ---------------- 游戏 ---------------- */
function startGame(auto) {
  if (LR.tryLockLandscape) LR.tryLockLandscape();   // 进游戏时尽量转成横屏
  if (!RT.chart || !RT.chart.notes.length) { toast('这份谱面还没有音符，先点「编辑谱面」放几个'); return; }
  stopPreview();
  const cfg = {
    chart: RT.chart,
    mode: RT.chart.mode,
    lanes: RT.chart.lanes,
    speed: S.speed,
    offsetMs: S.offsetMs,
    bgDim: S.playBg === false ? 0.9 : S.playDim,
    fxLine: S.fxLine !== false,
    fxPower: S.fxPower == null ? 1 : S.fxPower,
    style: S.noteStyle || 'phigros',
    auto: auto === true || S.autoPlay === true,
    audio: audio,
    keyLabels: currentKeys().map(keyLabel),
    title: RT.songName + ' · ' + LR.DIFFS[S.diff].label,
    onFinish: showResult
  };
  $('#gameTitle').textContent = (cfg.auto ? 'AUTO · ' : '') + cfg.title;
  $('#gameKeys').innerHTML = (mode === 'rd')
    ? '<b>' + keyLabel(currentKeys()[0]) + '</b> 单键'
    : currentKeys().map(function (k) { return '<b>' + keyLabel(k) + '</b>'; }).join(' ');
  hidePause();
  show('game');
  LR.Game.setup(cfg);
  LR.Game.start();
}

function hidePause() { $('#pauseOv').classList.add('is-hidden'); }
function showPause() { $('#pauseOv').classList.remove('is-hidden'); }

function showResult(st) {
  document.body.classList.remove('in-game');
  show('result');
  $('#resGrade').textContent = st.grade;
  if (LR.Game && LR.Game.auto) { $('#resTitle').textContent = '自动演示'; }
  else $('#resTitle').textContent = (st.grade === 'S+' || st.grade === 'S') ? '完美演出'
    : (st.grade === 'D' ? '再试一次吧' : '演奏结束');
  $('#resSub').textContent = RT.songName + ' · ' +
    (st.mode === 'fall' ? '下落式' : st.mode === 'rd' ? '节奏医生式' : '横向') + ' · ' + LR.DIFFS[st.diff].label;
  $('#resScore').textContent = String(st.score);
  $('#resAcc').textContent = (st.acc * 100).toFixed(2) + '%';
  $('#resCombo').textContent = String(st.maxCombo);
  $('#resTotal').textContent = String(st.total);
  const c = st.counts, total = Math.max(1, st.total);
  const rows = [['perfect', 'PERFECT', c.perfect], ['great', 'GREAT', c.great], ['good', 'GOOD', c.good], ['miss', 'MISS', c.miss]];
  $('#resBars').innerHTML = rows.map(function (r) {
    return '<div class="rbar rbar--' + r[0] + '"><span>' + r[1] + '</span>' +
      '<span class="rbar__track"><i class="rbar__fill" data-w="' + ((r[2] / total) * 100).toFixed(1) + '"></i></span>' +
      '<b>' + r[2] + '</b></div>';
  }).join('');
  requestAnimationFrame(function () {
    $$('#resBars .rbar__fill').forEach(function (f) { f.style.width = f.dataset.w + '%'; });
  });
}

function exportChart() {
  if (!RT.chart) return;
  const out = {
    game: 'Liquid Rhythm prototype',
    song: RT.songName,
    mode: RT.chart.mode,
    difficulty: RT.chart.diff,
    lanes: RT.chart.lanes,
    bpm: RT.chart.bpm,
    offset: +RT.chart.offset.toFixed(4),
    duration: +RT.chart.duration.toFixed(3),
    notes: RT.chart.notes.map(function (n) { return { t: +n.t.toFixed(4), lane: n.lane, dur: +n.dur.toFixed(3) }; })
  };
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (RT.songName || 'chart') + '-' + RT.chart.mode + '-' + RT.chart.diff + '.json';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  toast('已导出谱面 JSON');
}

/* ---------------- 设置面板同步 ---------------- */
function syncSettingsUI() {
  $$('#setQuality .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.v === S.quality); });
  $('#setRefract').setAttribute('aria-checked', String(!!S.glassLens));
  $('#setBgAnim').setAttribute('aria-checked', String(!!S.bgAnim));
  $('#setFps').setAttribute('aria-checked', String(!!S.showFps));
  $('#setBevel').value = S.lensBevel;
  $('#lblBevel').textContent = S.lensBevel + ' px';
  $('#setScale2').value = S.lensScale;
  $('#lblScale2').textContent = S.lensScale + ' px';
  $('#setDisp').value = Math.round(S.lensDisp * 100);
  $('#lblDisp').textContent = Math.round(S.lensDisp * 100) + '%';
  $('#setLensBlur').value = S.lensBlur;
  $('#lblLensBlur').textContent = S.lensBlur + ' px';
  $('#setTint').value = Math.round(S.lensTint * 100);
  $('#lblTint').textContent = Math.round(S.lensTint * 100) + '%';
  $('#setDrag').setAttribute('aria-checked', String(S.dragUI !== false));
  if ($('#bgUrlInput')) $('#bgUrlInput').value = S.bgUrl || '';
  $('#setBgDim').value = Math.round(S.bgDim * 100);
  $('#lblBgDim').textContent = Math.round(S.bgDim * 100) + '%';
  $('#setBgBlur').value = S.bgBlur;
  $('#lblBgBlur').textContent = S.bgBlur + ' px';
  $$('#setBgPreset .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.v === S.bgPreset); });
  $('#setPlayBg').setAttribute('aria-checked', String(S.playBg !== false));
  $('#setPlayDim').value = Math.round(S.playDim * 100);
  $('#lblPlayDim').textContent = Math.round(S.playDim * 100) + '%';
  $('#setAuto').setAttribute('aria-checked', String(S.autoPlay === true));
  $('#setFxLine').setAttribute('aria-checked', String(S.fxLine !== false));
  $('#setFxPower').value = Math.round(S.fxPower * 100);
  $('#lblFxPower').textContent = Math.round(S.fxPower * 100) + '%';
  $('#setSfx').setAttribute('aria-checked', String(S.sfxOn !== false));
  $('#setSfxVol').value = Math.round((S.sfxVolume == null ? 0.6 : S.sfxVolume) * 100);
  $('#lblSfxVol').textContent = Math.round((S.sfxVolume == null ? 0.6 : S.sfxVolume) * 100) + '%';
  $$('#setSfxTone .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.v === (S.sfxTone || 'crisp')); });
  $('#setVol').value = Math.round(S.volume * 100);
  $('#lblVol').textContent = Math.round(S.volume * 100) + '%';
  $('#setOffset').value = S.offsetMs;
  $('#lblOffset2').textContent = S.offsetMs + ' ms';

  $$('#optDiff .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.v === S.diff); });
  $$('#optLanes .chip').forEach(function (c) { c.classList.toggle('is-on', +c.dataset.v === S.lanes); });
  $('#optDensity').value = Math.round(S.density * 100);
  $('#lblDensity').textContent = Math.round(S.density * 100) + '%';
  $('#optSpeed').value = Math.round(S.speed * 100);
  $('#lblSpeed').textContent = S.speed.toFixed(2) + '×';
  $('#optOffset').value = S.offsetMs;
  $('#lblOffset').textContent = S.offsetMs + ' ms';
  $('#optHolds').setAttribute('aria-checked', String(!!S.holds));
  $('#optSnap').setAttribute('aria-checked', String(!!S.snap));
  $('#fps').hidden = !S.showFps;
}

/* ---------------- 键位面板 ---------------- */
let listening = null;
function renderKeybinds() {
  const modes = [{ k: 'fall', name: '下落式' }, { k: 'side', name: '横向' }, { k: 'rd', name: '节奏医生式' }];
  let html = '';
  modes.forEach(function (m) {
    const counts = m.k === 'rd' ? ['1'] : ['4', '6'];
    counts.forEach(function (cn) {
      const arr = KEYS[m.k][cn] || [];
      html += '<div class="kbmode"><div class="kbmode__title"><b>' + m.name + '</b>' +
        (m.k === 'rd' ? '<span>· 单键</span>' : '<span>· ' + cn + ' 轨</span>') + '</div><div class="kbgrid">';
      for (let i = 0; i < arr.length; i++) {
        html += '<button class="kbkey" data-mode="' + m.k + '" data-count="' + cn + '" data-lane="' + i + '">' +
          '<span>L' + (i + 1) + '</span><b>' + keyLabel(arr[i]) + '</b></button>';
      }
      html += '</div></div>';
    });
  });
  const body = $('#keybindBody');
  body.innerHTML = html;
  $$('#keybindBody .kbkey').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#keybindBody .kbkey').forEach(function (x) { x.classList.remove('is-listen'); });
      b.classList.add('is-listen');
      b.querySelector('b').textContent = '按下…';
      listening = { mode: b.dataset.mode, count: b.dataset.count, lane: +b.dataset.lane };
    });
  });
}
function captureKey(code) {
  if (!listening) return false;
  const L = listening;
  listening = null;
  if (code === 'Escape') { renderKeybinds(); return true; }
  const arr = KEYS[L.mode][L.count];
  for (let i = 0; i < arr.length; i++) {
    if (i !== L.lane && arr[i] === code) {
      toast('这个键已经绑给 L' + (i + 1) + ' 了');
      renderKeybinds();
      return true;
    }
  }
  arr[L.lane] = code;
  saveKeys();
  renderKeybinds();
  toast('已绑定 ' + keyLabel(code) + ' → L' + (L.lane + 1));
  return true;
}

/* ---------------- 输入 ---------------- */
const held = new Map();
function laneForKey(code) {
  const keys = currentKeys();
  for (let i = 0; i < keys.length; i++) if (keys[i] === code) return i;
  return -1;
}
function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
window.addEventListener('keydown', function (e) {
  if (isTypingTarget(e.target)) return;
  if (captureKey(e.code)) { e.preventDefault(); return; }
  if (currentScreen !== 'game' || !LR.Game.running) return;
  if (e.code === 'Escape') {
    e.preventDefault();
    if (LR.Game.paused) { LR.Game.resume(); hidePause(); } else { LR.Game.pause(); showPause(); }
    return;
  }
  if (e.repeat) return;
  if (LR.Game.auto) return;          // 自动演示时不接管敲击
  const lane = laneForKey(e.code);
  if (lane >= 0) {
    e.preventDefault();
    held.set(e.code, lane);
    LR.Game.press(lane);
  }
}, { passive: false });
window.addEventListener('keyup', function (e) {
  const lane = held.get(e.code);
  if (lane != null) { held.delete(e.code); LR.Game.release(lane); }
});
window.addEventListener('blur', function () {
  if (currentScreen === 'game' && LR.Game.running && !LR.Game.paused) { LR.Game.pause(); showPause(); }
  held.clear();
});

/* 指针（移动端 / 触摸也能玩） */
function pointerLane(x, y) {
  const g = LR.Game.geom;
  if (!g) return -1;
  if (g.mode === 'fall') {
    if (y < g.judgeY - 50) return -1;
    const l = Math.floor((x - g.x0) / g.laneW);
    return (l >= 0 && l < g.lanes) ? l : -1;
  }
  if (g.mode === 'side') {
    if (x > g.judgeX + 50) return -1;
    const l = Math.floor((y - g.y0) / g.rowH);
    return (l >= 0 && l < g.lanes) ? l : -1;
  }
  return 0;
}
(function attachPointer() {
  const cv = $('#field');
  const active = new Map();
  cv.addEventListener('pointerdown', function (e) {
    if (currentScreen !== 'game' || !LR.Game.running || LR.Game.paused) return;
    const rect = cv.getBoundingClientRect();
    const lane = pointerLane(e.clientX - rect.left, e.clientY - rect.top);
    if (lane < 0) return;
    active.set(e.pointerId, lane);
    LR.Game.press(lane);
  });
  const up = function (e) {
    const lane = active.get(e.pointerId);
    if (lane != null) { active.delete(e.pointerId); LR.Game.release(lane); }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
})();

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $$('#modeNav .chip').forEach(function (c) {
    c.addEventListener('click', function () { setMode(c.dataset.mode); });
  });
  $$('.mcard').forEach(function (c) {
    c.addEventListener('click', function () { setMode(c.dataset.mode); });
  });

  $('#btnKeys').addEventListener('click', function () { renderKeybinds(); showSheet('sheetKeys'); });
  $('#btnSettings').addEventListener('click', function () { syncSettingsUI(); showSheet('sheetSettings'); });
  $('#btnHelp').addEventListener('click', function () { showSheet('sheetHelp'); });
  $('#btnHelp2').addEventListener('click', function () { showSheet('sheetHelp'); });
  $$('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { hideSheet(b.dataset.close); });
  });
  $$('.sheetback').forEach(function (b) {
    b.addEventListener('click', function () { if (b.parentNode) b.parentNode.classList.add('is-hidden'); });
  });

  /* 文件导入 */
  const drop = $('#drop'), input = $('#fileInput');
  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', function () {
    if (input.files && input.files[0]) handleFile(input.files[0]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (currentScreen === 'menu') drop.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      drop.classList.remove('is-over');
    });
  });
  window.addEventListener('drop', function (e) {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $('#btnSample').addEventListener('click', loadSample);

  $('#btnBackMenu').addEventListener('click', function () { stopPreview(); show('menu'); });
  $('#btnPreview').addEventListener('click', startPreview);
  $('#btnStart').addEventListener('click', startGame);
  $('#rotateSkip').addEventListener('click', function () {
    document.documentElement.classList.add('skip-rotate');
  });
  $('#btnAuto').addEventListener('click', function () { startGame(true); });

  /* ---------------- 谱面编辑器 ---------------- */
  function openEditor() {
    if (!RT.chart) { toast('还没有谱面，先导入一首音乐'); return; }
    if (!LR.Editor) { toast('编辑器没加载成功'); return; }
    stopPreview();
    show('editor');
    $$('#edSnap .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.v === '4'); });
    LR.Editor.setSnap(4);
    LR.Editor.open({
      chart: RT.chart,
      songName: RT.songName,
      analysis: RT.analysis,
      audio: audio,
      onSave: function (c) {
        c.edited = true;
        RT.chart = c;
        show('setup');
        refreshChartMeta();
        if (!c.notes.length) toast('谱面是空的，记得放音符再玩');
      else toast('谱面已更新：' + c.notes.length + ' 个音符');
      },
      onClose: function () { show('setup'); }
    });
    /* 屏幕刚切过来时容器尺寸可能还没稳定，补两次重排 */
    setTimeout(function () { LR.Editor.layout(); }, 80);
    setTimeout(function () { LR.Editor.layout(); }, 700);
  }
  $('#pickAuto').addEventListener('click', chooseAuto);
  $('#pickBlank').addEventListener('click', chooseBlank);
  $('#chartBack').addEventListener('click', function () { hideSheet('sheetChart'); });
  $('#btnEdit').addEventListener('click', openEditor);
  $('#edBack').addEventListener('click', function () { show('setup'); });
  $('#edSave').addEventListener('click', function () { LR.Editor.save(); });
  $('#edExport').addEventListener('click', function () { LR.Editor.exportChart(); });
  $('#edImport').addEventListener('click', function () { LR.Editor.pickFile(); });
  $('#edFile').addEventListener('change', function () {
    const f = $('#edFile').files && $('#edFile').files[0];
    $('#edFile').value = '';
    LR.Editor.importFile(f);
  });
  $('#edPlay').addEventListener('click', function () { LR.Editor.togglePlay(); });
  $('#edZoomIn').addEventListener('click', function () { LR.Editor.setZoom(1.25); });
  $('#edZoomOut').addEventListener('click', function () { LR.Editor.setZoom(0.8); });
  $('#edUndo').addEventListener('click', function () { LR.Editor.undo(); });
  $('#edRedo').addEventListener('click', function () { LR.Editor.redo(); });
  $('#edClear').addEventListener('click', function () { LR.Editor.clearAll(); });
  $$('#edSnap .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('#edSnap .chip').forEach(function (x) { x.classList.toggle('is-on', x === c); });
      LR.Editor.setSnap(+c.dataset.v);
    });
  });

  $$('#optDiff .chip').forEach(function (c) {
    c.addEventListener('click', function () { S.diff = c.dataset.v; save(); syncSettingsUI(); buildChart(); });
  });
  $$('#optLanes .chip').forEach(function (c) {
    c.addEventListener('click', function () { S.lanes = +c.dataset.v; save(); syncSettingsUI(); buildChart(); });
  });

  const bindRange = function (id, key, scale, fmt, after) {
    const el = $(id);
    el.addEventListener('input', function () {
      S[key] = +el.value / scale;
      save();
      fmt();
      if (after) after();
    });
  };
  bindRange('#optDensity', 'density', 100, function () {
    $('#lblDensity').textContent = Math.round(S.density * 100) + '%';
  }, buildChart);
  bindRange('#optSpeed', 'speed', 100, function () {
    $('#lblSpeed').textContent = S.speed.toFixed(2) + '×';
  });
  bindRange('#optOffset', 'offsetMs', 1, function () {
    $('#lblOffset').textContent = S.offsetMs + ' ms';
  });
  $('#optHolds').addEventListener('click', function () {
    S.holds = !S.holds; save(); syncSettingsUI(); buildChart();
  });
  $('#optSnap').addEventListener('click', function () {
    S.snap = !S.snap; save(); syncSettingsUI(); buildChart();
  });

  /* 背景 */
  const presetBox = $('#setBgPreset');
  if (presetBox) {
    presetBox.innerHTML = LR.Backdrop.PRESETS.map(function (p) {
      return '<button class="chip" data-v="' + p.id + '">' + p.name + '</button>';
    }).join('');
    $$('#setBgPreset .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        S.bgPreset = c.dataset.v;
        save(); syncSettingsUI(); applySettings();
      });
    });
  }
  $('#btnBgImport').addEventListener('click', function () { $('#bgFile').click(); });
  $('#bgFile').addEventListener('change', function () {
    const f = $('#bgFile').files && $('#bgFile').files[0];
    $('#bgFile').value = '';
    if (!f) return;
    LR.Backdrop.importFile(f, function (r) {
      if (!r.ok) { toast(r.reason === 'notimage' ? '请选择图片文件' : '这张图片读不出来'); return; }
      /* 图片偏亮就自动压暗，否则白字会看不清 */
      if (r.lum > 0.45) S.bgDim = Math.min(0.6, 0.2 + (r.lum - 0.45) * 1.1);
      save(); syncSettingsUI(); applySettings();
      toast('背景已更换' + (r.saved ? '' : '（图片太大，仅本次会话有效）'));
    });
  });
  /* 壁纸 API / 图片地址 */
  $('#btnBgUrl').addEventListener('click', function () {
    const u = $('#bgUrlInput').value.trim();
    if (!u) { toast('先填一个图片地址'); return; }
    S.bgUrl = u; save();
    if (LR.Backdrop.setUrl(u, S)) { syncSettingsUI(); toast('壁纸已应用'); }
    else toast('地址无效');
  });
  $('#btnBgShuffle').addEventListener('click', function () {
    const u = S.bgUrl || $('#bgUrlInput').value.trim();
    if (!u) { toast('先填一个图片地址（可用 {r} 占位符）'); return; }
    S.bgUrl = u; save();
    LR.Backdrop.setUrl(u, S);
    toast('已换一张');
  });
  /* 配置导出 / 导入 */
  $('#btnExportCfg').addEventListener('click', function () {
    const out = { app: 'Liquid Rhythm', version: 5, settings: S, keys: KEYS };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'liquid-rhythm-config.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('配置已导出');
  });
  $('#btnImportCfg').addEventListener('click', function () { $('#cfgFile').click(); });
  $('#cfgFile').addEventListener('change', function () {
    const f = $('#cfgFile').files && $('#cfgFile').files[0];
    $('#cfgFile').value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = function () {
      try {
        const o = JSON.parse(String(fr.result));
        if (o.settings) Object.assign(S, o.settings);
        if (o.keys) { KEYS = o.keys; saveKeys(); }
        save(); syncSettingsUI(); applySettings(); renderKeybinds();
        if (RT.analysis) buildChart();
        if (o.settings && o.settings.bgUrl) LR.Backdrop.setUrl(o.settings.bgUrl, S);
        toast('配置已导入');
      } catch (err) { toast('这个文件读不出来'); }
    };
    fr.readAsText(f);
  });
  $('#btnBgClear').addEventListener('click', function () {
    LR.Backdrop.clearImage();
    applySettings();
    toast('已清除自定义背景');
  });
  bindRange('#setBgDim', 'bgDim', 100, function () {
    $('#lblBgDim').textContent = Math.round(S.bgDim * 100) + '%';
  }, function () { LR.Backdrop.apply(S); });
  bindRange('#setBgBlur', 'bgBlur', 1, function () {
    $('#lblBgBlur').textContent = S.bgBlur + ' px';
  }, function () { LR.Backdrop.apply(S); });

  $$('#setQuality .chip').forEach(function (c) {
    c.addEventListener('click', function () { S.quality = c.dataset.v; save(); syncSettingsUI(); applySettings(); });
  });
  $('#setRefract').addEventListener('click', function () {
    S.glassLens = !S.glassLens; save(); syncSettingsUI(); applySettings();
  });
  /* 玻璃参数：拖动即时生效（glass.js 会重建滤镜） */
  const bindGlass = function (id, key, scale, fmt) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      S[key] = +el.value / scale;
      save();
      fmt();
      if (LR.Glass) LR.Glass.apply(S);
    });
  };
  bindGlass('#setBevel', 'lensBevel', 1, function () { $('#lblBevel').textContent = S.lensBevel + ' px'; });
  bindGlass('#setScale2', 'lensScale', 1, function () { $('#lblScale2').textContent = S.lensScale + ' px'; });
  bindGlass('#setDisp', 'lensDisp', 100, function () { $('#lblDisp').textContent = Math.round(S.lensDisp * 100) + '%'; });
  bindGlass('#setLensBlur', 'lensBlur', 1, function () { $('#lblLensBlur').textContent = S.lensBlur + ' px'; });
  bindGlass('#setTint', 'lensTint', 100, function () { $('#lblTint').textContent = Math.round(S.lensTint * 100) + '%'; });
  $('#setBgAnim').addEventListener('click', function () {
    S.bgAnim = !S.bgAnim; save(); syncSettingsUI(); applySettings();
  });
  $('#setFps').addEventListener('click', function () {
    S.showFps = !S.showFps; save(); syncSettingsUI();
  });
  $('#setDrag').addEventListener('click', function () {
    S.dragUI = !S.dragUI; save(); syncSettingsUI();
    if (LR.Drag) LR.Drag.setEnabled(S.dragUI && !LR.isMobile());
    toast(S.dragUI ? '现在可以拖动卡片了' : '已锁定布局');
  });
  $('#btnResetLayout').addEventListener('click', function () {
    if (LR.Drag) LR.Drag.reset();
    toast('布局已重置');
  });
  $('#setAuto').addEventListener('click', function () { S.autoPlay = !S.autoPlay; save(); syncSettingsUI(); });
  $('#setPlayBg').addEventListener('click', function () { S.playBg = !(S.playBg !== false); save(); syncSettingsUI(); });
  bindRange('#setPlayDim', 'playDim', 100, function () { $('#lblPlayDim').textContent = Math.round(S.playDim * 100) + '%'; });
  $('#setFxLine').addEventListener('click', function () { S.fxLine = !(S.fxLine !== false); save(); syncSettingsUI(); });
  bindRange('#setFxPower', 'fxPower', 100, function () { $('#lblFxPower').textContent = Math.round(S.fxPower * 100) + '%'; });
  $('#setSfx').addEventListener('click', function () {
    S.sfxOn = !(S.sfxOn !== false); save(); syncSettingsUI(); applySettings();
    if (S.sfxOn && LR.sfx) { LR.sfx.ensure(audio.ensure()); LR.sfx.blip(880); }
  });
  bindRange('#setSfxVol', 'sfxVolume', 100, function () {
    $('#lblSfxVol').textContent = Math.round(S.sfxVolume * 100) + '%';
  }, applySettings);
  $$('#setSfxTone .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      S.sfxTone = c.dataset.v; save(); syncSettingsUI(); applySettings();
      if (LR.sfx) { LR.sfx.ensure(audio.ensure()); LR.sfx.hit(1); }
    });
  });
  bindRange('#setVol', 'volume', 100, function () {
    $('#lblVol').textContent = Math.round(S.volume * 100) + '%';
  }, applySettings);
  bindRange('#setOffset', 'offsetMs', 1, function () {
    $('#lblOffset2').textContent = S.offsetMs + ' ms';
    $('#optOffset').value = S.offsetMs;
    $('#lblOffset').textContent = S.offsetMs + ' ms';
  });
  $('#btnFactory').addEventListener('click', function () {
    Object.assign(S, DEFAULTS);
    KEYS = JSON.parse(JSON.stringify(DEFAULT_KEYS));
    if (LR.Drag) LR.Drag.reset();
    save(); saveKeys(); syncSettingsUI(); applySettings(); renderKeybinds();
    if (RT.analysis) buildChart();
    toast('已恢复默认');
  });
  $('#btnKeyReset').addEventListener('click', function () {
    KEYS = JSON.parse(JSON.stringify(DEFAULT_KEYS));
    saveKeys(); renderKeybinds(); toast('键位已恢复默认');
  });

  $('#btnPause').addEventListener('click', function () {
    if (LR.Game.paused) { LR.Game.resume(); hidePause(); } else { LR.Game.pause(); showPause(); }
  });
  $('#btnResume').addEventListener('click', function () { LR.Game.resume(); hidePause(); });
  $('#btnRestart').addEventListener('click', function () { hidePause(); LR.Game.restart(); });
  $('#btnQuit').addEventListener('click', function () {
    hidePause(); LR.Game.quit(); document.body.classList.remove('in-game'); show('setup');
  });

  $('#btnRetry').addEventListener('click', startGame);
  $('#btnResSetup').addEventListener('click', function () { show('setup'); requestAnimationFrame(drawWaveStatic); });
  $('#btnResBack').addEventListener('click', function () { show('menu'); });
  $('#btnExport').addEventListener('click', exportChart);

  /* 抬起的玻璃：镜面高光跟随指针 */
  const hero = $('#hero'), sheen = $('#heroSheen');
  if (hero && sheen) {
    let pending = false, px = 0, py = 0;
    hero.addEventListener('pointermove', function (e) {
      const r = hero.getBoundingClientRect();
      px = e.clientX - r.left; py = e.clientY - r.top;
      if (!pending) {
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          sheen.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
        });
      }
    });
  }

  let rszTimer = null;
  window.addEventListener('resize', function () {
    moveGlider();
    clearTimeout(rszTimer);
    rszTimer = setTimeout(function () {
      if (LR.Glass) LR.Glass.resize();
      if (currentScreen === 'setup') drawWaveStatic();
    }, 180);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveGlider);
}

/* ---------------- FPS ---------------- */
setInterval(function () {
  const el = $('#fps');
  if (!el) return;
  if (S.showFps && LR.Game.running) {
    el.hidden = false;
    el.textContent = LR.Game.fps.toFixed(0) + ' FPS';
  } else if (!el.hidden) {
    el.hidden = true;
  }
}, 500);

/* ---------------- 启动 ---------------- */
function boot() {
  LR.syncMobile();          // 先判定手机端：CSS 与拖拽都依赖这个结果
  /* 调试/分享用：?bevel=40&scale=90&disp=0.8&lensblur=12&tint=0.15 */
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('bevel')) S.lensBevel = +q.get('bevel');
    if (q.get('scale')) S.lensScale = +q.get('scale');
    if (q.get('disp')) S.lensDisp = +q.get('disp');
    if (q.get('lensblur')) S.lensBlur = +q.get('lensblur');
    if (q.get('tint')) S.lensTint = +q.get('tint');
    if (q.get('noanim')) S.reduceMotion = true;   // 关掉入场动画，用于排查 backdrop root
  } catch (e) { /* ignore */ }
  if (LR.Glass) LR.Glass.init();
  if (LR.Backdrop) LR.Backdrop.init(S);
  bind();
  /* 手机端不挂拖拽：手指拖窗口没有意义，而且会抢走触摸滑动 */
  if (LR.Drag) LR.Drag.init({ dragUI: S.dragUI !== false && !LR.isMobile() });
  applySettings();
  syncSettingsUI();
  setMode('fall', true);
  moveGlider();
  setTimeout(moveGlider, 80);
  setTimeout(moveGlider, 400);
  drawWaveStatic();
  /* 调试/截图用：?sheet=settings 直接打开某个抽屉 */
  try {
    const q = new URLSearchParams(location.search);
    const sh = q.get('sheet');
    if (sh && document.getElementById('sheet' + sh.charAt(0).toUpperCase() + sh.slice(1))) {
      showSheet('sheet' + sh.charAt(0).toUpperCase() + sh.slice(1));
    }
  } catch (e) { /* ignore */ }
  if (!hasSavedSettings()) {
    setTimeout(function () { toast('点「用示例曲立即试玩」可以直接看效果'); }, 1000);
  }
  /* ?diag=1：把每个玻璃层的「计算后」样式写进 title，便于 dump-dom 排查。
     inline style 里有 filter 不代表它真的生效，必须看 computed。 */
  try {
    if (new URLSearchParams(location.search).get('diag')) {
      setTimeout(function () {
        const out = [];
        document.querySelectorAll('.glass').forEach(function (el) {
          const lens = el.querySelector(':scope > .glass__lens');
          const name = el.className.split(' ').slice(0, 2).join('.');
          if (!lens) { out.push(name + '=NO-LENS'); return; }
          const cs = getComputedStyle(lens);
          const pcs = getComputedStyle(el);
          out.push(name + '|bf=' + (cs.backdropFilter || 'none') +
            '|f=' + (cs.filter || 'none') +
            '|pf=' + (pcs.filter || 'none') +
            '|pop=' + pcs.opacity + '|pwi=' + pcs.willChange);
        });
        /* 手机端诊断：是否判定为手机、拖拽是否已禁用、当前屏能不能滚 */
        out.push('mobile=' + LR.isMobile() + ' dragEnabled=' + (LR.Drag ? LR.Drag.enabled : 'n/a'));
        var mc = document.querySelector('.mcard');
        out.push('iw=' + window.innerWidth + ' ih=' + window.innerHeight +
          ' dpr=' + (window.devicePixelRatio || 1));
        if (mc) {
          var mcr = mc.getBoundingClientRect();
          out.push('mcard0=' + Math.round(mcr.width) + 'x' + Math.round(mcr.height) +
            '@' + Math.round(mcr.left) + ',' + Math.round(mcr.top) +
            (mc.classList.contains('is-placed') ? ' 已摆放' : ' 文档流'));
        }
        var sc = document.querySelector('.screen.is-active');
        if (sc) {
          out.push('screen=' + (sc.id || '?') + ' scrollH=' + sc.scrollHeight +
            ' clientH=' + sc.clientHeight +
            ' canScroll=' + (sc.scrollHeight > sc.clientHeight + 1) +
            ' overflowY=' + getComputedStyle(sc).overflowY);
        }
        /* 找出比视口还宽的元素：横向溢出就是这么来的 */
        var vw = document.documentElement.clientWidth;
        var wide = [];
        document.querySelectorAll('body *').forEach(function (el) {
          if (el.closest('.svgdefs')) return;
          var r = el.getBoundingClientRect();
          if (r.width > vw + 1 || r.right > vw + 1 || r.left < -1) {
            if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
            wide.push((el.id || el.className.toString().split(' ').slice(0, 2).join('.')) +
              '[' + Math.round(r.left) + ',' + Math.round(r.right) + ']w' + Math.round(r.width));
          }
        });
        out.push('vw=' + vw + ' overflow=' + (wide.length ? wide.slice(0, 6).join(' | ') : 'none'));
        document.title = 'DIAG ' + out.join(' ;; ');
      }, 1800);
    }
    const fs2 = new URLSearchParams(location.search).get('forcestate');
    if (fs2) {
      setTimeout(function () {
        const h = document.getElementById('hero');
        if (h) h.classList.add(fs2);
      }, 400);
    }
  } catch (e) { /* ignore */ }
}
/* exposed for editor.js */
  /* 调试用：?screen=game 之类可以直接切屏，便于截图验证游戏内布局 */
  try {
    const qs = new URLSearchParams(location.search).get('screen');
    if (qs && document.getElementById('screen-' + qs)) setTimeout(function () { show(qs); }, 500);
  } catch (e) { /* ignore */ }

  LR.ui = { toast: toast, refreshChartMeta: refreshChartMeta };

  /* 旋转屏幕或改窗口尺寸后重新判定：从手机变回桌面要能恢复拖拽 */
  window.addEventListener('resize', function () {
    document.documentElement.classList.remove('skip-rotate');   // 转回去后重新提示
    const was = document.documentElement.classList.contains('is-mobile');
    const now = LR.syncMobile();
    if (now !== was) {
      if (LR.Drag) LR.Drag.setEnabled(S.dragUI && !now);
      if (LR.Glass) LR.Glass.refresh();
      if (RT.chart) requestAnimationFrame(drawWaveStatic);
      if (currentScreen === 'editor' && LR.Editor) LR.Editor.layout();
    }
  });
  window.addEventListener('orientationchange', function () { setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 220); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.LR);
