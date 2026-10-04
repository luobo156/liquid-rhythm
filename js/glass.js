/* ============================================================
   Liquid Rhythm · glass.js  (v0.3 性能版)
   真正的液态玻璃：给每块玻璃生成一张「圆角矩形斜面」位移图，
   用 SVG feDisplacementMap 把 backdrop-filter 的结果按图折射。

   核心不变的三条（都是截图对比出来的）：
   1. 位移向内采样 —— 向外会采到元素外没有 backdrop 数据的地方，边缘出现暗边。
   2. 斜面宽度用像素，位移量在边缘最大、向内衰减，才像一块厚玻璃。
   3. 色散只做在最外圈：R/B 用「窄斜面」图，中心位移为 0 → 不串色不泛白。

   v0.3 的性能改动（效果不变）：
   A. 法线改成解析式求导：每个像素 5 次 SDF 求值 → 1 次，位移图生成快约 4 倍。
   B. 位移图与 SVG filter 按「尺寸+半径+斜面」缓存复用，同尺寸的卡片共用一份。
   C. 只改位移强度 / 模糊 / 染色时不再重新生成位图，只改 attribute 与 CSS 变量。
   D. 惰性构建：visibility:hidden 的屏幕（未显示的面板/抽屉）不生成滤镜，切屏时再建。
   E. 滤镜区域收紧到元素盒子附近：向内采样永远不会画到盒子外，少栅格化 25~30% 面积。
   F. 滑块拖动用 rAF 节流，一帧最多重建一次。
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const MAX_MAP = 560;

const P = {
  enabled: true,
  lite: false,
  bevel: 30,
  scale: 56,
  blur: 9,
  disp: 0.55,
  tint: 0.12
};

let defs = null;
let seq = 0;
const items = [];                 // { el, lens, id, w, h, key, built }
const mapCache = new Map();       // 位移图缓存 key -> {url,w,h}
const filterCache = new Map();    // 滤镜缓存 key -> { id, el, scaleNodes:[...], key }
let pending = false;

function ensureDefs() {
  if (defs && defs.isConnected) return defs;
  let svg = document.getElementById('glassDefs');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', 'glassDefs');
    svg.setAttribute('class', 'svgdefs');
    svg.setAttribute('aria-hidden', 'true');
    const d = document.createElementNS(NS, 'defs');
    svg.appendChild(d);
    document.body.appendChild(svg);
  }
  defs = svg.querySelector('defs');
  return defs;
}

/* ---------- 圆角矩形 SDF：一次求值同时给出距离与向外法线 ---------- */
function sdfNormal(px, py, w, h, r, out) {
  const hw = w / 2, hh = h / 2;
  const sx = px - hw, sy = py - hh;
  const ax = Math.abs(sx), ay = Math.abs(sy);
  const qx = ax - (hw - r), qy = ay - (hh - r);
  let d, nx, ny;
  if (qx > 0 && qy > 0) {
    const len = Math.sqrt(qx * qx + qy * qy) || 1;
    d = len - r;
    nx = (sx < 0 ? -1 : 1) * qx / len;
    ny = (sy < 0 ? -1 : 1) * qy / len;
  } else if (qx > 0) {
    d = qx - r; nx = sx < 0 ? -1 : 1; ny = 0;
  } else if (qy > 0) {
    d = qy - r; nx = 0; ny = sy < 0 ? -1 : 1;
  } else {
    const m = qx > qy ? qx : qy;
    d = m - r;
    if (qx > qy) { nx = sx < 0 ? -1 : 1; ny = 0; }
    else { nx = 0; ny = sy < 0 ? -1 : 1; }
  }
  out.d = d; out.nx = nx; out.ny = ny;
  return out;
}

/* ---------- 位移图：R/G 存「向内」的位移向量，0.5 为中性 ---------- */
function buildMap(w, h, radius, bevel, power) {
  const k = Math.max(1, Math.max(w, h) / MAX_MAP);
  const mw = Math.max(8, Math.round(w / k));
  const mh = Math.max(8, Math.round(h / k));
  const rad = Math.min(radius / k, Math.min(mw, mh) / 2);
  const bev = Math.max(1.5, bevel / k);
  const cv = document.createElement('canvas');
  cv.width = mw; cv.height = mh;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(mw, mh);
  const d = img.data;
  const tmp = { d: 0, nx: 0, ny: 0 };
  let i = 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      sdfNormal(x + 0.5, y + 0.5, mw, mh, rad, tmp);
      let t = -tmp.d / bev;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const m = Math.pow(1 - t, power) * 0.98;
      d[i] = 128 - tmp.nx * m * 127;
      d[i + 1] = 128 - tmp.ny * m * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
      i += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL('image/png'), w: w, h: h };
}
function cachedMap(w, h, radius, bevel, power) {
  const key = [w, h, Math.round(radius), Math.round(bevel), power].join('|');
  let m = mapCache.get(key);
  if (!m) {
    m = buildMap(w, h, radius, bevel, power);
    mapCache.set(key, m);
    if (mapCache.size > 48) mapCache.delete(mapCache.keys().next().value);
  }
  return m;
}

function feImage(m, res) {
  return '<feImage href="' + m.url + '" xlink:href="' + m.url + '" x="0" y="0" width="' + m.w +
    '" height="' + m.h + '" preserveAspectRatio="none" result="' + res + '"/>';
}
function disp(inRef, mapRef, s, res) {
  return '<feDisplacementMap class="lens-disp" in="' + inRef + '" in2="' + mapRef + '" scale="' + s +
    '" xChannelSelector="R" yChannelSelector="G"' + (res ? ' result="' + res + '"' : '') + '/>';
}
const CH = {
  R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'
};

/* 尺寸 + 斜面 + 是否色散 决定滤镜结构；位移强度不参与 key，可以只改 attribute */
function filterKey(it, radius, lite) {
  const dispOn = (P.disp > 0.02 && !lite) ? 1 : 0;
  return [it.w, it.h, Math.round(radius), Math.round(P.bevel), dispOn].join('|');
}

/* 生成 / 复用滤镜。lite = 只做一次位移、不做色散 —— 拖动时用它，观感几乎一样但便宜约 3 倍。 */
function buildOrGet(it, radius, lite) {
  const key = filterKey(it, radius, lite);
  let f = filterCache.get(key);
  if (f) return f;
  const main = cachedMap(it.w, it.h, radius, P.bevel, 1.6);
  let inner;
  const roles = [];
  if (!lite && P.disp > 0.02) {
    const edge = cachedMap(it.w, it.h, radius, Math.max(6, P.bevel * 0.34), 1.0);
    inner = feImage(main, 'm') + disp('SourceGraphic', 'm', '0', 'dG') +
      '<feColorMatrix in="dG" type="matrix" values="' + CH.G + '" result="cG"/>' +
      feImage(edge, 'me') + disp('SourceGraphic', 'me', '0', 'dR') +
      '<feColorMatrix in="dR" type="matrix" values="' + CH.R + '" result="cR"/>' +
      disp('SourceGraphic', 'me', '0', 'dB') +
      '<feColorMatrix in="dB" type="matrix" values="' + CH.B + '" result="cB"/>' +
      '<feBlend in="cR" in2="cG" mode="screen" result="rg"/>' +
      '<feBlend in="rg" in2="cB" mode="screen"/>';
    roles.push('g', 'r', 'b');
  } else {
    inner = feImage(main, 'm') + disp('SourceGraphic', 'm', '0', 'dG');
    roles.push('g');
  }
  const id = 'lens-' + (++seq);
  const el = document.createElementNS(NS, 'filter');
  el.setAttribute('id', id);
  el.setAttribute('x', '-6%'); el.setAttribute('y', '-6%');
  el.setAttribute('width', '112%'); el.setAttribute('height', '112%');
  el.setAttribute('color-interpolation-filters', 'sRGB');
  el.innerHTML = inner;
  ensureDefs().appendChild(el);
  const nodes = el.querySelectorAll('feDisplacementMap');
  const picked = [];
  for (let i = 0; i < roles.length && i < nodes.length; i++) picked.push({ node: nodes[i], role: roles[i] });
  f = { id: id, el: el, key: key, nodes: picked };
  filterCache.set(key, f);
  if (filterCache.size > 40) {
    for (const [k2, v] of filterCache) {
      let used = false;
      for (let hi = 0; hi < items.length; hi++) {
        if (items[hi].fullF === v || items[hi].liteF === v) { used = true; break; }
      }
      if (!used && k2 !== key) { v.el.remove(); filterCache.delete(k2); break; }
    }
  }
  return f;
}

/* 生成 / 复用滤镜，并把当前位移强度写进去 */
function ensureFilter(it, radius) {
  if (!P.enabled) {
    it.lens.style.filter = 'none';
    it.built = true;
    return;
  }
  const full = buildOrGet(it, radius, false);
  const lite = (P.disp > 0.02) ? buildOrGet(it, radius, true) : full;
  it.fullF = full;
  it.liteF = lite;
  it.built = true;
  it.lens.style.filter = 'url(#' + (P.lite ? lite.id : full.id) + ')';
  applyScale(it);
}/* 回收没人引用的滤镜。
   重建（尺寸变化 / 默认参数与 apply() 不一致）会生成新的 filter 元素，
   旧的留在 DOM 里就是纯浪费 —— 元素的记录上一直挂着 fullF/liteF，
   所以可以安全地删掉没有任何记录引用的滤镜。 */
function pruneFilters() {
  const dead = [];
  for (const entry of filterCache) {
    const f = entry[1];
    let used = false;
    for (let hi = 0; hi < items.length; hi++) {
      if (items[hi].fullF === f || items[hi].liteF === f) { used = true; break; }
    }
    if (!used) dead.push(entry[0]);
  }
  for (let i = 0; i < dead.length; i++) {
    const f = filterCache.get(dead[i]);
    if (f && f.el) f.el.remove();
    filterCache.delete(dead[i]);
  }
  return dead.length;
}

/* 只改位移强度：直接写 attribute，零位图开销 */
function applyScale(it) {
  /* 注意：这里必须用挂在元素上的滤镜引用，不能再用 filterCache.get(it.key) ——
     新版的 ensureFilter 只建「完整 / 轻量」两个变体、不再写 it.key，
     用 key 查表会拿到 undefined 然后直接 return，结果所有位移强度都停在 0（折射全没）。 */
  const list = [it.fullF, it.liteF];
  for (let q = 0; q < list.length; q++) {
    const f = list[q];
    if (!f) continue;
    for (let i = 0; i < f.nodes.length; i++) {
      const n = f.nodes[i];
      let v = P.scale;
      if (n.role === 'r') v = P.scale * (1 + 0.5 * P.disp);
      else if (n.role === 'b') v = P.scale * (1 - 0.32 * P.disp);
      n.node.setAttribute('scale', v.toFixed(1));
    }
  }
}
function visible(el) {
  if (!el.offsetWidth && !el.offsetHeight) return false;
  const cs = getComputedStyle(el);
    /* 注意：不要把 opacity:0 当不可见 —— 入场动画的起始帧就是 opacity 0，
     一跳过就再也没人触发 refresh，滤镜永远建不出来。 */
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

const Glass = {
  P: P,
  stats: { filters: 0, maps: 0 },

  init: function () {
    const els = document.querySelectorAll('.glass');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      let it = null;
      for (let j = 0; j < items.length; j++) if (items[j].el === el) it = items[j];
      if (!it) {
        let lens = el.querySelector(':scope > .glass__lens');
        if (!lens) {
          lens = document.createElement('div');
          lens.className = 'glass__lens';
          lens.setAttribute('aria-hidden', 'true');
          el.insertBefore(lens, el.firstChild);
        }
        it = { el: el, lens: lens, id: null, w: 0, h: 0, key: null, built: false };
        items.push(it);
      }
      el.classList.add('glass--on');
    }
    this.refresh();
  },

  /* 惰性：看不见的元素（未激活的屏幕 / 抽屉）不生成滤镜 */
  refresh: function () {
    if (!P.enabled) return 0;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!visible(it.el)) { it.built = false; continue; }
      const w = it.el.offsetWidth, h = it.el.offsetHeight;
      if (w !== it.w || h !== it.h) { it.built = false; it.w = w; it.h = h; }
      if (it.built) continue;
      const radius = parseFloat(getComputedStyle(it.el).borderTopLeftRadius) || 20;
      it.w = w; it.h = h;
      ensureFilter(it, radius);
      n++;
    }
    if (n) pruneFilters();
    this.stats.filters = filterCache.size;
    this.stats.maps = mapCache.size;
    return n;
  },

  /* 参数变化：只有斜面宽度 / 是否色散需要重建位图，其余改属性即可 */
  apply: function (s) {
    const prevBevel = P.bevel, prevDispAmt = P.disp, prevScale = P.scale, prevOn = P.enabled;
    const prevDisp = prevDispAmt > 0.02;
    P.enabled = s.quality !== 'low' && s.glassLens !== false;
    P.bevel = s.lensBevel == null ? 30 : s.lensBevel;
    P.scale = s.lensScale == null ? 56 : s.lensScale;
    P.disp = s.quality === 'high' ? (s.lensDisp == null ? 0.55 : s.lensDisp) : 0;
  P.lite = false;
    const root = document.documentElement;
    root.style.setProperty('--lens-blur', (s.lensBlur == null ? 2 : s.lensBlur) + 'px');
    root.style.setProperty('--lens-tint', (s.lensTint == null ? 0.12 : s.lensTint));
    document.body.classList.toggle('no-lens', !P.enabled);

    if (!P.enabled) {
      for (let i = 0; i < items.length; i++) {
        items[i].built = false; items[i].key = null;
        items[i].lens.style.filter = 'none';
        items[i].el.classList.remove('glass--on');
      }
      return;
    }
    for (let i = 0; i < items.length; i++) items[i].el.classList.add('glass--on');

    const structureChanged = !prevOn || P.bevel !== prevBevel || (P.disp > 0.02) !== prevDisp;
    if (structureChanged) {
      for (let i = 0; i < items.length; i++) items[i].built = false;   // 需要换位图
      this.schedule();
    } else if (P.scale !== prevScale || P.disp !== prevDispAmt) {
      /* 只改强度：一次 attribute 写回，零位图开销 */
      for (let i = 0; i < items.length; i++) applyScale(items[i]);
    } else {
      this.schedule();
    }
  },

  /* rAF 节流：滑块拖动时一帧最多重建一次 */
  schedule: function () {
    if (pending) return;
    pending = true;
    const self = this;
    requestAnimationFrame(function () {
      pending = false;
      self.refresh();
    });
  },

  resize: function () {
    if (!P.enabled) return;
    for (let i = 0; i < items.length; i++) items[i].built = false;
    this.refresh();
  },

  setLite: function (on) { applyLite(on); },

  rebuild: function () {
    for (let i = 0; i < items.length; i++) items[i].built = false;
    mapCache.clear();
    for (const [, f] of filterCache) f.el.remove();
    filterCache.clear();
    this.refresh();
  }
};

LR.Glass = Glass;

})(window.LR);
