/* ============================================================
   Liquid Rhythm · backdrop.js
   可更换背景：内置预设 + 导入本地图片 + 暗度/模糊调节。
   背景的「结构感」直接决定液态玻璃好不好看 —— 平滑渐变后面没有东西可折射。
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

const IMG_KEY = 'lr.bgimg.v1';
const MAXW = 1600, MAXH = 1200;

const PRESETS = [
  { id: 'space', name: '深空' },
  { id: 'aurora', name: '极光' },
  { id: 'sunset', name: '暖霞' },
  { id: 'neon', name: '霓虹' },
  { id: 'graphite', name: '石墨' },
  { id: 'studio', name: '影棚 · 细节最多' }
];

let el = null, imgEl = null, scrimEl = null;

function bgs() {
  if (!el) {
    el = document.querySelector('.bg');
    imgEl = document.querySelector('.bg__img');
    scrimEl = document.querySelector('.bg__scrim');
  }
  return el;
}

function loadStoredImage() {
  try { return localStorage.getItem(IMG_KEY) || null; } catch (e) { return null; }
}
function storeImage(data) {
  try {
    if (data) localStorage.setItem(IMG_KEY, data);
    else localStorage.removeItem(IMG_KEY);
    return true;
  } catch (e) { return false; }   // 配额不够就只在本次会话里生效
}

/* 把用户图片压到合理尺寸再存，顺便算出平均亮度用于自动压暗 */
function processImage(file, cb) {
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = function () {
    const k = Math.min(1, MAXW / im.width, MAXH / im.height);
    const w = Math.max(2, Math.round(im.width * k));
    const h = Math.max(2, Math.round(im.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.drawImage(im, 0, 0, w, h);
    /* 平均亮度 */
    let lum = 0;
    try {
      const sm = document.createElement('canvas');
      sm.width = 24; sm.height = 24;
      const sc = sm.getContext('2d');
      sc.drawImage(im, 0, 0, 24, 24);
      const d = sc.getImageData(0, 0, 24, 24).data;
      for (let i = 0; i < d.length; i += 4) lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      lum /= (d.length / 4);
    } catch (e) { lum = 0.3; }
    let data = null;
    try { data = cv.toDataURL('image/jpeg', 0.72); } catch (e) { data = null; }
    URL.revokeObjectURL(url);
    cb(data, lum, w, h);
  };
  im.onerror = function () { URL.revokeObjectURL(url); cb(null, 0, 0, 0); };
  im.src = url;
}

const Backdrop = {
  PRESETS: PRESETS,
  image: null,          // 只存在这里，不进设置对象（否则会被塞进 localStorage 的设置项里爆配额）

  init: function (S) {
    bgs();
    this.image = loadStoredImage();
    /* 方便分享/调试：?bg=studio&dim=0.4&blur=8 直接指定背景，不写入存储 */
    try {
      const q = new URLSearchParams(location.search);
      const p = q.get('bg');
      if (p === 'test' || PRESETS.some(function (x) { return x.id === p; })) S.bgPreset = p;
      if (q.get('dim') != null) S.bgDim = Math.max(0, Math.min(0.85, parseFloat(q.get('dim'))));
      if (q.get('blur') != null) S.bgBlur = Math.max(0, Math.min(30, parseFloat(q.get('blur'))));
      const bi = q.get('bgimg');
      if (bi) this.image = bi;      // 直接指定图片背景，不写存储
    } catch (e) { /* ignore */ }
    this.apply(S);
  },

  apply: function (S) {
    const b = bgs();
    if (!b) return;
    const preset = S.bgPreset || 'space';
    for (let i = 0; i < PRESETS.length; i++) b.classList.toggle('bg--' + PRESETS[i].id, PRESETS[i].id === preset);
    b.classList.toggle('bg--test', preset === 'test');
    b.classList.toggle('bg--custom', !!this.image);
    if (imgEl) {
      if (this.image) {
        imgEl.style.backgroundImage = 'url("' + this.image + '")';
        imgEl.style.filter = (S.bgBlur > 0 ? 'blur(' + S.bgBlur + 'px)' : 'none');
        imgEl.style.transform = S.bgBlur > 0 ? 'scale(1.06)' : 'none';
      } else {
        imgEl.style.backgroundImage = 'none';
        imgEl.style.filter = 'none';
        imgEl.style.transform = 'none';
      }
    }
    if (scrimEl) scrimEl.style.background = 'rgba(0,0,0,' + (S.bgDim == null ? 0.2 : S.bgDim) + ')';
  },

  /* 导入图片；回调里给出是否成功持久化 */
  importFile: function (file, cb) {
    if (!file || !/^image\//i.test(file.type)) { cb({ ok: false, reason: 'notimage' }); return; }
    const self = this;
    processImage(file, function (data, lum, w, h) {
      if (!data) { cb({ ok: false, reason: 'decode' }); return; }
      self.image = data;
      const saved = storeImage(data);
      cb({ ok: true, lum: lum, w: w, h: h, saved: saved });
    });
  },

  /* 直接用图片地址 / API 模板（支持 {w} {h} {r} 占位符，{r} 是随机数，用来「换一张」） */
  setUrl: function (tpl, S) {
    const u = String(tpl || '').trim();
    if (!u) return false;
    const w = Math.max(1280, screen.width || 1280);
    const h = Math.max(800, screen.height || 800);
    this.image = u
      .replace(/\{w\}/g, w).replace(/\{h\}/g, h)
      .replace(/\{r\}/g, String(Math.floor(Math.random() * 1e6)));
    this.apply(S);
    return true;
  },

  clearImage: function () { this.image = null; storeImage(null); }
};

LR.Backdrop = Backdrop;
})(window.LR);
