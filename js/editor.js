/* ============================================================
   Liquid Rhythm · editor.js
   谱面图形编辑器：横向时间轴（X = 时间，Y = 轨道）
   - 左键空白处 = 加音符；左键音符拖动 = 改时间/轨道
   - 右键 / Alt+左键音符 = 删除；双击 = 切换长按
   - 长按右脚拖动 = 改时长
   - 空格播放/暂停，滚轮横向滚动，Ctrl+滚轮缩放，Ctrl+Z/Y 撤销重做
   谱面可导出/导入 JSON。
   ============================================================ */
(function (LR) {
'use strict';

const clamp = LR.util.clamp;
const fmtTime = LR.util.fmtTime;

const FORMAT = 'liquid-rhythm-chart';
const VERSION = 1;

let ctx = null;          // { chart, songName, analysis, audio, onSave, onClose }
let chart = null;
let notes = [];
let sel = null;
let snapDiv = 4;         // 吸附：1/1 1/2 1/4 1/8 拍
let pps = 150;           // 每秒像素
let scrollT = 0;
let playhead = 0;
let playing = false;
let raf = 0;
let drag = null;
let hover = null;
let undoStack = [];
let redoStack = [];
let ready = false;

const $ = function (s) { return document.querySelector(s); };
const cv = function () { return $('#edCanvas'); };

/* ---------------- 几何 ---------------- */
function rulerH() { return 28; }

function geom() {
  const c = cv();
  const w = c.width / (window.devicePixelRatio || 1);
  const h = c.height / (window.devicePixelRatio || 1);
  const lanes = chart ? chart.lanes : 4;
  const top = rulerH();
  return { w: w, h: h, top: top, laneH: (h - top) / lanes, lanes: lanes };
}

function tToX(t) { return (t - scrollT) * pps; }
function xToT(x) { return scrollT + x / pps; }
function yOfLane(l) { const g = geom(); return g.top + g.laneH * l; }
function laneAtY(y) {
  const g = geom();
  const l = Math.floor((y - g.top) / g.laneH);
  return l < 0 || l >= g.lanes ? -1 : l;
}
function beatLen() { return chart && chart.beat > 0 ? chart.beat : 0.5; }
function snapT(t) {
  const g = beatLen() / snapDiv;
  return Math.max(0, Math.round(t / g) * g);
}
/* 让视图跟着播放头走 */
function follow() {
  const g = geom();
  const x = tToX(playhead);
  if (x > g.w * 0.72) scrollT = playhead - g.w * 0.28 / pps;
  else if (x < 0) scrollT = Math.max(0, playhead - g.w * 0.15 / pps);
  scrollT = Math.max(0, scrollT);
}

/* ---------------- 撤销 / 重做 ---------------- */
function snapshot() { return JSON.stringify(notes.map(function (n) { return [n.t, n.lane, n.dur || 0]; })); }
function restore(str) {
  const a = JSON.parse(str);
  notes = a.map(function (x) { return { t: x[0], lane: x[1], dur: x[2], kind: x[2] > 0.05 ? 'hold' : 'tap' }; });
  sel = null;
}
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  refreshStats();
}
function undo() {
  if (!undoStack.length) { toast('没有可撤销的操作'); return; }
  redoStack.push(snapshot());
  restore(undoStack.pop());
  draw(); refreshStats();
}
function redo() {
  if (!redoStack.length) { toast('没有可重做的操作'); return; }
  undoStack.push(snapshot());
  restore(redoStack.pop());
  draw(); refreshStats();
}

/* ---------------- 编辑操作 ---------------- */
function addNote(t, lane) {
  pushUndo();
  const n = { t: snapT(t), lane: lane, dur: 0, kind: 'tap' };
  notes.push(n);
  sortNotes();
  sel = n;
  return n;
}
function removeNote(n) {
  const i = notes.indexOf(n);
  if (i < 0) return;
  pushUndo();
  notes.splice(i, 1);
  if (sel === n) sel = null;
}
function sortNotes() {
  notes.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
}
function toggleHold(n) {
  pushUndo();
  if (n.dur > 0.05) { n.dur = 0; n.kind = 'tap'; }
  else { n.dur = beatLen() * 2; n.kind = 'hold'; }
}
/* 命中测试：长按的尾巴优先（方便拖拽），再从后往前找（上层优先） */
function hitTest(x, y) {
  const g = geom();
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const x0 = tToX(n.t);
    const x1 = n.dur > 0.05 ? tToX(n.t + n.dur) : x0 + Math.max(10, pps * 0.09);
    if (y < yOfLane(n.lane) + 2 || y > yOfLane(n.lane + 1) - 2) continue;
    if (n.dur > 0.05) {
      if (x >= x0 - 3 && x <= x1 + 3) return { n: n, edge: Math.abs(x - x1) <= 7 ? 'tail' : 'body' };
    } else if (x >= x0 - 3 && x <= x1 + 3) {
      return { n: n, edge: 'body' };
    }
  }
  return null;
}

/* ---------------- 绘制 ---------------- */
function draw() {
  const c = cv();
  if (!c || !chart) return;
  const g = geom();
  const dpr = window.devicePixelRatio || 1;
  const x2 = c.getContext('2d');
  x2.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = g.w, H = g.h;
  const beat = beatLen();
  const bar = beat * 4;
  const colors = ['#4fc3f7', '#ff7ab8', '#ffc861', '#5ce6a8', '#b388ff', '#ff8a65'];

  x2.clearRect(0, 0, W, H);
  x2.fillStyle = '#0a0d14';
  x2.fillRect(0, 0, W, H);

  /* 轨道底色 */
  for (let l = 0; l < g.lanes; l++) {
    const y = yOfLane(l);
    x2.fillStyle = l % 2 ? 'rgba(255,255,255,.022)' : 'rgba(255,255,255,.045)';
    x2.fillRect(0, y, W, g.laneH);
    x2.fillStyle = 'rgba(255,255,255,.05)';
    x2.fillRect(0, y, W, 1);
  }
  x2.fillStyle = 'rgba(255,255,255,.05)';
  x2.fillRect(0, H - 1, W, 1);

  /* 时间网格：小节线 > 拍线 > 细分线 */
  const t0 = scrollT, t1 = xToT(W);
  const firstBar = Math.floor(t0 / bar);
  const lastBar = Math.ceil(t1 / bar) + 1;
  for (let b = firstBar; b <= lastBar; b++) {
    const bx = tToX(b * bar);
    if (bx < -2 || bx > W + 2) continue;
    x2.fillStyle = 'rgba(255,255,255,.20)';
    x2.fillRect(Math.round(bx), g.top, 1, H - g.top);
    x2.fillStyle = 'rgba(190,225,255,.55)';
    x2.font = '600 11px ui-monospace,Consolas,monospace';
    x2.textAlign = 'left'; x2.textBaseline = 'middle';
    x2.fillText(String(b + 1), Math.round(bx) + 4, rulerH() / 2);
    for (let k = 1; k < 4; k++) {
      const px = tToX(b * bar + k * beat);
      if (px < 0 || px > W) continue;
      x2.fillStyle = 'rgba(255,255,255,.10)';
      x2.fillRect(Math.round(px), g.top, 1, H - g.top);
    }
    if (snapDiv > 4) {
      const sub = beat / (snapDiv / 4);
      for (let k = 0; k < 4; k++) {
        for (let q = 1; q < snapDiv / 4; q++) {
          const px = tToX(b * bar + k * beat + q * sub);
          if (px < 0 || px > W) continue;
          x2.fillStyle = 'rgba(255,255,255,.045)';
          x2.fillRect(Math.round(px), g.top, 1, H - g.top);
        }
      }
    }
  }
  /* 标尺底边 */
  x2.fillStyle = 'rgba(255,255,255,.10)';
  x2.fillRect(0, rulerH() - 1, W, 1);

  /* 音符 */
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const y = yOfLane(n.lane);
    const x0 = tToX(n.t);
    if (x0 > W + 40 || (n.dur > 0 && tToX(n.t + n.dur) < -40)) continue;
    const col = colors[n.lane % colors.length];
    /* 音符画成居中的方块，而不是撑满轨道 —— 撑满会像钢琴卷帘，读起来不像音游谱面。
       宽度按「一拍的比例」算，这样缩放时音符形态稳定。 */
    const h = Math.min(g.laneH * 0.58, 44);
    const yy = y + (g.laneH - h) / 2;
    const w = Math.max(11, Math.min(pps * beat * 0.24, 48));
    const isSel = sel === n;
    const isHover = hover && hover.n === n;

    if (n.dur > 0.05) {
      const wt = Math.max(6, tToX(n.t + n.dur) - x0);
      x2.fillStyle = col;
      x2.globalAlpha = isSel ? 0.4 : 0.24;
      rr(x2, x0, yy + h * 0.28, wt, h * 0.44, 4); x2.fill();
      x2.globalAlpha = 1;
      x2.fillStyle = isSel ? '#fff' : col;
      rr(x2, x0, yy, h * 0.34, h * 0.72, 4); x2.fill();
      /* 尾巴抓手 */
      x2.fillStyle = isSel ? '#fff' : col;
      rr(x2, x0 + wt - 4, yy + h * 0.16, 4, h * 0.68, 2); x2.fill();
    } else {
      x2.fillStyle = isSel ? '#fff' : (isHover ? '#e8f3ff' : col);
      rr(x2, x0, yy, w, h, 5); x2.fill();
    }
    if (isSel) {
      x2.strokeStyle = '#fff';
      x2.lineWidth = 1.5;
      const wt = n.dur > 0.05 ? Math.max(6, tToX(n.t + n.dur) - x0) : w;
      rr(x2, x0 - 1.5, yy - 1.5, wt + 3, h + 3, 6); x2.stroke();
    }
  }

  /* 播放头 */
  const px = tToX(playhead);
  if (px >= -2 && px <= W + 2) {
    x2.fillStyle = 'rgba(255,255,255,.9)';
    x2.fillRect(Math.round(px), 0, 2, H);
    x2.beginPath();
    x2.moveTo(px - 6, 0); x2.lineTo(px + 6, 0); x2.lineTo(px, 9);
    x2.closePath(); x2.fill();
  }

  /* 判定的准备线 */
  x2.fillStyle = 'rgba(255,120,120,.5)';
  x2.fillRect(Math.round(tToX(1.3)), g.top, 1, H - g.top);
}

function rr(c, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}

/* ---------------- 尺寸 ---------------- */
function layout() {
  const c = cv();
  if (!c) return;
  const box = c.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(320, Math.round(box.width * dpr));
  c.height = Math.max(200, Math.round(box.height * dpr));
  c.style.width = box.width + 'px';
  c.style.height = box.height + 'px';
  if (!ready) { pps = Math.max(60, box.width / 12); ready = true; }
  draw();
}

/* ---------------- 播放 ---------------- */
function togglePlay() {
  if (!ctx || !ctx.audio || !ctx.audio.buffer) { toast('没有音频可以播放'); return; }
  if (playing) { ctx.audio.pause(); playing = false; }
  else { ctx.audio.play(playhead); playing = true; }
  syncPlayBtn();
}
function syncPlayBtn() {
  const b = $('#edPlay');
  if (b) b.textContent = playing ? '暂停' : '播放';
}
function tick() {
  raf = requestAnimationFrame(tick);
  if (playing && ctx && ctx.audio) {
    playhead = ctx.audio.currentTime();
    if (!ctx.audio.playing) { playing = false; syncPlayBtn(); }
    follow();
    draw();
    updateTimeLabel();
  }
}

/* ---------------- 统计 ---------------- */
function refreshStats() {
  const holds = notes.filter(function (n) { return n.dur > 0.05; }).length;
  const el = $('#edCount');
  if (el) el.textContent = notes.length + ' 个音符' + (holds ? ' · 长按 ' + holds : '');
  const warn = $('#edDirty');
  if (warn) warn.textContent = '已修改';
}
function updateTimeLabel() {
  const el = $('#edTime');
  if (el) el.textContent = fmtTime(playhead) + ' / ' + fmtTime(chart ? chart.duration : 0);
}

/* ---------------- 导出 / 导入 ---------------- */
function buildFile() {
  return {
    format: FORMAT,
    version: VERSION,
    song: ctx ? ctx.songName : '',
    mode: chart.mode,
    diff: chart.diff,
    lanes: chart.lanes,
    bpm: +chart.bpm.toFixed(3),
    beat: +chart.beat.toFixed(5),
    offset: +(chart.offset || 0).toFixed(3),
    duration: +(chart.duration || 0).toFixed(2),
    notes: notes.map(function (n) {
      return { t: +n.t.toFixed(3), lane: n.lane, dur: +(n.dur || 0).toFixed(3) };
    })
  };
}

function exportChart() {
  const data = buildFile();
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  const safe = String(ctx && ctx.songName ? ctx.songName : 'chart').replace(/[\\/:*?"<>|]/g, '_');
  a.href = URL.createObjectURL(blob);
  a.download = safe + ' · ' + LR.DIFFS[data.diff].label + '.lrchart.json';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  toast('谱面已导出（' + notes.length + ' 个音符）');
}

/* 校验导入的文件，坏数据要被挡住而不是把编辑器搞崩 */
function validate(obj) {
  if (!obj || typeof obj !== 'object') return '不是合法的 JSON 对象';
  if (obj.format && obj.format !== FORMAT) return '不是 Liquid Rhythm 谱面文件';
  if (!Array.isArray(obj.notes)) return '缺少 notes 数组';
  /* 空谱面是合法的工作中状态：自己导出的空白谱面要能读回来 */
  const lanes = Math.max(1, Math.min(8, parseInt(obj.lanes, 10) || (chart ? chart.lanes : 4)));
  const out = [];
  for (let i = 0; i < obj.notes.length; i++) {
    const n = obj.notes[i];
    if (!n || typeof n !== 'object') return '第 ' + (i + 1) + ' 个音符格式不对';
    const t = Number(n.t);
    if (!isFinite(t) || t < 0) return '第 ' + (i + 1) + ' 个音符时间非法';
    const lane = parseInt(n.lane, 10);
    if (!isFinite(lane) || lane < 0 || lane >= lanes) return '第 ' + (i + 1) + ' 个音符轨道超出范围';
    let dur = Number(n.dur || 0);
    if (!isFinite(dur) || dur < 0) dur = 0;
    out.push({ t: t, lane: lane, dur: dur, kind: dur > 0.05 ? 'hold' : 'tap' });
  }
  out.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
  return { notes: out, lanes: lanes, meta: obj };
}

function applyImport(obj) {
  const res = validate(obj);
  if (typeof res === 'string') { toast('导入失败：' + res); return false; }
  pushUndo();
  notes = res.notes;
  if (chart && res.lanes !== chart.lanes) {
    chart.lanes = res.lanes;
    toast('轨数按文件改为 ' + res.lanes);
  }
  if (chart) {
    if (isFinite(obj.bpm) && obj.bpm > 0) chart.bpm = obj.bpm;
    if (isFinite(obj.beat) && obj.beat > 0) chart.beat = obj.beat;
    if (isFinite(obj.offset)) chart.offset = obj.offset;
    if (isFinite(obj.duration) && obj.duration > 0) chart.duration = obj.duration;
  }
  sel = null;
  sortNotes();
  draw(); refreshStats();
  toast('已导入 ' + notes.length + ' 个音符');
  return true;
}

function pickFile() {
  const inp = $('#edFile');
  if (inp) inp.click();
}

/* ---------------- 保存回游戏 ---------------- */
function save() {
  if (!chart) return;
  sortNotes();
  chart.notes = notes.map(function (n) {
    return { t: n.t, lane: n.lane, dur: n.dur || 0, kind: n.dur > 0.05 ? 'hold' : 'tap', s: 1, src: 'edit' };
  });
  chart.edited = true;
  if (ctx && ctx.onSave) ctx.onSave(chart);
}

/* ---------------- 打开 / 关闭 ---------------- */
function open(options) {
  ctx = options;
  chart = options.chart;
  notes = chart.notes.map(function (n) {
    return { t: n.t, lane: n.lane, dur: n.dur || 0, kind: (n.dur || 0) > 0.05 ? 'hold' : 'tap' };
  });
  sortNotes();
  sel = null; hover = null; drag = null;
  undoStack = []; redoStack = [];
  playing = false; ready = false;
  playhead = 0;
  scrollT = 0;
  syncPlayBtn();
  bind();
  layout();
  refreshStats();
  updateTimeLabel();
  const t = $('#edTitle');
  if (t) t.textContent = (options.songName || '未命名') + ' · ' + LR.DIFFS[chart.diff].label + ' · ' + chart.lanes + ' 轨';
  const d = $('#edDirty');
  if (d) d.textContent = '';
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function close() {
  if (playing && ctx && ctx.audio) { ctx.audio.pause(); playing = false; }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  unbind();
  sel = null; drag = null; ctx = null; ready = false;
}

/* ---------------- 事件 ---------------- */
let bound = false;
function evPos(e) {
  const r = cv().getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e) {
  const p = evPos(e);
  const g = geom();
  cv().setPointerCapture && cv().setPointerCapture(e.pointerId);

  if (p.y < rulerH()) {          // 标尺 = 拖动播放头
    drag = { mode: 'scrub' };
    setPlayhead(xToT(p.x));
    return;
  }
  const hit = hitTest(p.x, p.y);
  const alt = e.altKey || e.button === 2;
  if (hit) {
    if (alt) { removeNote(hit.n); draw(); return; }
    sel = hit.n;
    pushUndo();
    drag = {
      mode: hit.edge === 'tail' ? 'resize' : 'move',
      n: hit.n,
      grabT: xToT(p.x) - hit.n.t,
      startT: hit.n.t,
      startLane: hit.n.lane
    };
    draw();
    return;
  }
  const lane = laneAtY(p.y);
  if (lane < 0) return;
  const n = addNote(xToT(p.x), lane);
  drag = { mode: 'move', n: n, grabT: 0, startT: n.t, startLane: n.lane };
  draw();
}

function onMove(e) {
  const p = evPos(e);
  if (!drag) {
    const h = hitTest(p.x, p.y);
    const changed = (h && h.n) !== (hover && hover.n);
    hover = h;
    cv().style.cursor = h ? (h.edge === 'tail' ? 'ew-resize' : 'pointer') : 'crosshair';
    if (changed) draw();
    return;
  }
  /* 拖动标尺时让视图跟着播放头走：手机上（没有滚轮）这是唯一能横向平移的手势 */
  if (drag.mode === 'scrub') { setPlayhead(xToT(p.x)); follow(); draw(); return; }
  const n = drag.n;
  if (drag.mode === 'move') {
    const t = snapT(xToT(p.x) - drag.grabT);
    const lane = laneAtY(p.y);
    n.t = Math.max(0, t);
    if (lane >= 0) n.lane = lane;
  } else if (drag.mode === 'resize') {
    const end = snapT(xToT(p.x) / (beatLen() / snapDiv)) * (beatLen() / snapDiv);
    n.dur = Math.max(beatLen() / snapDiv, end - n.t);
    n.kind = 'hold';
  }
  draw(); refreshStats();
}

function onUp() { if (drag) { drag = null; sortNotes(); draw(); } }

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const p = evPos(e);
    const tAt = xToT(p.x);
    pps = clamp(pps * (e.deltaY < 0 ? 1.12 : 0.89), 18, 900);
    scrollT = Math.max(0, tAt - p.x / pps);
  } else {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    scrollT = Math.max(0, scrollT + d / pps);
  }
  draw();
}

function setPlayhead(t) {
  playhead = clamp(t, 0, chart ? chart.duration : 0);
  if (playing && ctx && ctx.audio) { ctx.audio.play(playhead); }
  draw(); updateTimeLabel();
}

function onKey(e) {
  const tag = (e.target && e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel) { e.preventDefault(); removeNote(sel); draw(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); setPlayhead(playhead - (e.shiftKey ? 1 : beatLen())); }
  if (e.key === 'ArrowRight') { e.preventDefault(); setPlayhead(playhead + (e.shiftKey ? 1 : beatLen())); }
  if (e.key === 'Escape') { if (ctx && ctx.onClose) ctx.onClose(); }
}

function bind() {
  if (bound) return;
  bound = true;
  const c = cv();
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointercancel', onUp);
  c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  c.addEventListener('dblclick', function (e) {
    const p = evPos(e);
    const h = hitTest(p.x, p.y);
    if (h) { toggleHold(h.n); sel = h.n; draw(); refreshStats(); }
  });
  c.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', layout);
  window.addEventListener('keydown', onKey);
}
function unbind() {
  if (!bound) return;
  bound = false;
  const c = cv();
  if (c) {
    c.removeEventListener('pointerdown', onDown);
    c.removeEventListener('pointermove', onMove);
    c.removeEventListener('pointerup', onUp);
    c.removeEventListener('pointercancel', onUp);
    c.removeEventListener('wheel', onWheel);
  }
  window.removeEventListener('resize', layout);
  window.removeEventListener('keydown', onKey);
}

function toast(msg) { if (LR.ui && LR.ui.toast) LR.ui.toast(msg); }

/* ---------------- 对外接口 ---------------- */
LR.Editor = {
  open: open,
  close: close,
  save: save,
  layout: layout,
  redraw: draw,
  exportChart: exportChart,
  importFile: function (file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = function () {
      let obj = null;
      try { obj = JSON.parse(String(fr.result)); }
      catch (err) { toast('导入失败：不是合法的 JSON 文件'); return; }
      applyImport(obj);
    };
    fr.readAsText(file);
  },
  pickFile: pickFile,
  setSnap: function (d) { snapDiv = d; draw(); },
  getSnap: function () { return snapDiv; },
  setZoom: function (f) { pps = clamp(pps * f, 18, 900); draw(); },
  undo: undo,
  redo: redo,
  togglePlay: togglePlay,
  setPlayhead: setPlayhead,
  addNote: addNote,
  removeSelected: function () { if (sel) { removeNote(sel); draw(); } },
  clearAll: function () {
    if (!notes.length) return;
    if (!window.confirm('确定清空全部 ' + notes.length + ' 个音符？')) return;
    pushUndo();
    notes = []; sel = null;
    draw(); refreshStats();
  },
  /* 供自动化测试用 */
  _state: function () { return { notes: notes, sel: sel, snap: snapDiv, pps: pps, playhead: playhead }; },
  _setNotes: function (arr) { notes = arr; sortNotes(); draw(); refreshStats(); },
  _validate: validate
};
})(window.LR);
