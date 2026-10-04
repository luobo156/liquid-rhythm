/* ============================================================
   Liquid Rhythm · backdrop.js
   可更换背景：内置预设 + 导入本地图片 + API 模板 + 暗度/模糊调节。
   支持在「预设 / 本地图片 / API 图片」三种来源间随时切换。
   API 图片拉下来后缓存为 base64，刷新页面不再发网络请求。
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

const IMG_KEY     = 'lr.bgimg.v1';     // 本地图片（base64）
const URL_KEY     = 'lr.bgurl.v1';     // API 模板
const MODE_KEY    = 'lr.bgmode.v1';    // 当前来源：'preset' | 'local' | 'api'
const CUR_KEY     = 'lr.bgcururl.v1';  // 上次解析后的 API URL
const API_IMG_KEY = 'lr.bgapiimg.v1';  // 上次拉到的 API 图片数据（base64）
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

function lsGet(k) {
  try { return localStorage.getItem(k) || null; } catch (e) { return null; }
}
function lsSet(k, v) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
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

/* 从 URL 拉图片并转成 data URL，用来持久化 API 图片 */
function fetchImageAsDataUrl(url, cb) {
  if (!url) { cb(null); return; }
  const im = new Image();
  im.crossOrigin = 'anonymous';
  let done = false;
  const finish = function (d) { if (done) return; done = true; cb(d); };
  const t = setTimeout(function () { finish(null); }, 12000);
  im.onload = function () {
    clearTimeout(t);
    try {
      const w = im.naturalWidth || im.width || 800;
      const h = im.naturalHeight || im.height || 600;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(im, 0, 0, w, h);
      finish(cv.toDataURL('image/jpeg', 0.85));
    } catch (e) { finish(null); }   // CORS 污染画布 → 放弃缓存
  };
  im.onerror = function () { clearTimeout(t); finish(null); };
  im.src = url;
}

const Backdrop = {
  PRESETS: PRESETS,
  image: null,
  mode: 'preset',

  _localImage: null,
  _apiTpl: null,
  _apiUrl: null,
  _apiImgData: null,

  init: function (S) {
    bgs();
    this._localImage = lsGet(IMG_KEY);
    this._apiTpl     = lsGet(URL_KEY);
    this._apiUrl     = lsGet(CUR_KEY);
    this._apiImgData = lsGet(API_IMG_KEY);

    /* 兼容旧数据：没有 mode 记录时，按「本地优先」推断 */
    const saved = lsGet(MODE_KEY);
    if (saved === 'preset' || saved === 'local' || saved === 'api') {
      this.mode = saved;
    } else {
      this.mode = this._localImage ? 'local' : (this._apiTpl ? 'api' : 'preset');
    }
    if (this.mode === 'local' && !this._localImage) this.mode = this._apiTpl ? 'api' : 'preset';
    if (this.mode === 'api'   && !this._apiTpl)     this.mode = this._localImage ? 'local' : 'preset';

    /* 从缓存同步 image（不涉及网络） */
    if (this.mode === 'local')      this.image = this._localImage;
    else if (this.mode === 'api')   this.image = this._apiImgData || null;  // 没数据就留空，稍后异步拉
    else                            this.image = null;

    /* URL 参数覆盖（调试/分享用，不写存储） */
    let hasBgImgOverride = false;
    try {
      const q = new URLSearchParams(location.search);
      const p = q.get('bg');
      if (p === 'test' || PRESETS.some(function (x) { return x.id === p; })) S.bgPreset = p;
      if (q.get('dim')  != null) S.bgDim  = Math.max(0, Math.min(0.85, parseFloat(q.get('dim'))));
      if (q.get('blur') != null) S.bgBlur = Math.max(0, Math.min(30, parseFloat(q.get('blur'))));
      const bi = q.get('bgimg');
      if (bi) { this.image = bi; hasBgImgOverride = true; }
    } catch (e) { /* ignore */ }

    this.apply(S);

    /* 有 API 模式但没缓存数据 → 只 fetch 一次 */
    if (!hasBgImgOverride && this.mode === 'api' && !this._apiImgData) {
      this._loadApiImage(S);
    }
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

  /* 把模板解析成真实 URL；没有 {r} 占位符时自动补时间戳破缓存 */
  _resolveUrl: function (tpl) {
    const u = String(tpl || '').trim();
    if (!u) return '';
    const w = Math.max(1280, screen.width || 1280);
    const h = Math.max(800, screen.height || 800);
    let url = u
      .replace(/\{w\}/g, w).replace(/\{h\}/g, h)
      .replace(/\{r\}/g, String(Math.floor(Math.random() * 1e6)));
    if (u.indexOf('{r}') < 0) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
    }
    return url;
  },

  /* ★ 唯一的 API 图片加载入口：有缓存直接用，没缓存只 fetch 一次 */
  _loadApiImage: function (S) {
    const self = this;

    /* 1. 有图片数据 → 零请求 */
    if (this._apiImgData) {
      this.image = this._apiImgData;
      if (S) this.apply(S);
      return;
    }
    /* 2. 确定 URL */
    if (!this._apiUrl && this._apiTpl) {
      this._apiUrl = this._resolveUrl(this._apiTpl);
      lsSet(CUR_KEY, this._apiUrl);
    }
    if (!this._apiUrl) {
      this.image = null;
      if (S) this.apply(S);
      return;
    }
    /* 3. 只 fetch 一次；成功后写缓存 */
    const url = this._apiUrl;
    fetchImageAsDataUrl(url, function (data) {
      if (self.mode !== 'api') return;
      if (data) {
        self._apiImgData = data;
        lsSet(API_IMG_KEY, data);
        self.image = data;
      } else {
        /* CORS 被拒 / 拉取失败 → 退回 URL（浏览器会自己发一次请求） */
        self.image = url;
      }
      if (S) self.apply(S);
    });
  },

  /* ---------- 查询 ---------- */
  hasLocal: function () { return !!this._localImage; },
  hasApi:   function () { return !!this._apiTpl; },
  getMode:  function () { return this.mode; },

  /* ---------- 模式切换 ---------- */
  setMode: function (mode, S) {
    if (mode !== 'preset' && mode !== 'local' && mode !== 'api') return false;
    if (mode === 'local' && !this._localImage) return false;
    if (mode === 'api'   && !this._apiTpl)     return false;
    this.mode = mode;
    lsSet(MODE_KEY, mode);

    if (mode === 'local') {
      this.image = this._localImage;
      if (S) this.apply(S);
    } else if (mode === 'api') {
      this._loadApiImage(S);          // 有缓存零请求，无缓存只 fetch 一次
    } else {
      this.image = null;
      if (S) this.apply(S);
    }
    return true;
  },

  /* ---------- 导入本地图片 ---------- */
  importFile: function (file, cb) {
    if (!file || !/^image\//i.test(file.type)) { cb({ ok: false, reason: 'notimage' }); return; }
    const self = this;
    processImage(file, function (data, lum, w, h) {
      if (!data) { cb({ ok: false, reason: 'decode' }); return; }
      self._localImage = data;
      const saved = lsSet(IMG_KEY, data);
      self.mode = 'local';
      lsSet(MODE_KEY, 'local');
      self.image = data;
      cb({ ok: true, lum: lum, w: w, h: h, saved: saved });
    });
  },

  /* ---------- 设置 API 模板（清缓存 → 只 fetch 一次 → 显示） ---------- */
  setUrl: function (tpl, S) {
    const u = String(tpl || '').trim();
    if (!u) return false;
    this._apiTpl = u;
    lsSet(URL_KEY, u);
    this.mode = 'api';
    lsSet(MODE_KEY, 'api');

    /* 生成新 URL，清掉旧缓存（关键：换一张就清一次） */
    this._apiUrl = this._resolveUrl(u);
    lsSet(CUR_KEY, this._apiUrl);
    this._apiImgData = null;
    lsSet(API_IMG_KEY, null);

    /* 只调用一次 _loadApiImage，内部只 fetch 一次 */
    this._loadApiImage(S);
    return true;
  },

  refreshApi: function (S) {
    if (!this._apiTpl) return false;
    return this.setUrl(this._apiTpl, S);
  },

  /* ---------- 清除 ---------- */
  clearLocal: function (S) {
    this._localImage = null;
    lsSet(IMG_KEY, null);
    if (this.mode === 'local') {
      this.mode = this._apiTpl ? 'api' : 'preset';
      lsSet(MODE_KEY, this.mode);
    }
    if (this.mode === 'api')       this._loadApiImage(S);
    else if (this.mode === 'local') this.image = this._localImage;
    else { this.image = null; if (S) this.apply(S); }
  },

  clearApi: function (S) {
    this._apiTpl = null;
    this._apiUrl = null;
    this._apiImgData = null;
    lsSet(URL_KEY, null);
    lsSet(CUR_KEY, null);
    lsSet(API_IMG_KEY, null);
    if (this.mode === 'api') {
      this.mode = this._localImage ? 'local' : 'preset';
      lsSet(MODE_KEY, this.mode);
    }
    if (this.mode === 'local') { this.image = this._localImage; if (S) this.apply(S); }
    else                       { this.image = null;           if (S) this.apply(S); }
  },

  clearAll: function (S) {
    this._localImage = null;
    this._apiTpl = null;
    this._apiUrl = null;
    this._apiImgData = null;
    lsSet(IMG_KEY, null);
    lsSet(URL_KEY, null);
    lsSet(CUR_KEY, null);
    lsSet(API_IMG_KEY, null);
    this.mode = 'preset';
    lsSet(MODE_KEY, null);
    this.image = null;
    if (S) this.apply(S);
  },

  /* 兼容旧接口 */
  clearImage: function (S) { this.clearAll(S); }
};

LR.Backdrop = Backdrop;
})(window.LR);