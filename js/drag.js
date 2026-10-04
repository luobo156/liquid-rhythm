/* ============================================================
   Liquid Rhythm · drag.js
   让所有 UI 卡片都能拖动：拖走之后变成 position:fixed 自由摆放，
   位置按「占视口的比例」存盘，换窗口尺寸也不会跑丢。
   交互控件（按钮/滑杆/开关/拖放区）自动排除，点它们不会误拖。
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

const KEY = 'lr.layout.v1';
const EXCLUDE = 'button,input,a,select,textarea,label,.drop,.kbkey,.switch,[data-nodrag]';
const MIN_VISIBLE = 96;      // 至少留这么多像素在屏幕内

let store = {};
let zTop = 60;
let active = null;

function loadStore() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
function saveStore() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
}

function keyOf(el) {
  if (el.dataset.drag) return el.dataset.drag;
  const wrap = el.closest('.sheetwrap');
  if (wrap && wrap.id) return 'sheet-' + wrap.id;
  if (el.classList.contains('mcard')) return 'mcard-' + (el.dataset.mode || 'x');
  if (el.classList.contains('topbar')) return 'topbar';
  const scr = el.closest('.screen');
  const base = el.classList.contains('hero') ? 'hero'
    : (el.classList.contains('panel') ? 'panel' : (el.className.split(' ')[0] || 'el'));
  return base + (scr ? '-' + scr.id : '');
}

function clampPos(left, top, w, h) {
  const maxL = window.innerWidth - MIN_VISIBLE;
  const maxT = window.innerHeight - 40;
  return {
    left: Math.max(MIN_VISIBLE - w, Math.min(maxL, left)),
    top: Math.max(0, Math.min(maxT, top))
  };
}

function place(el, left, top, w) {
  /* 必须先把宽度定下来再定位：
     position:fixed 的元素宽度会变成 shrink-to-fit（贴合内容），
     flex 布局里那种「宽度由布局决定」的卡片（模式卡就是）会一下塌成内容宽度。
     以前这里只设 position/left/top，宽度只在 resize 时才写回 ——
     所以「拖一次 → 刷新 → 卡片变窄且位置偏移」，缩放一下窗口才恢复正常。 */
  if (w > 0) el.style.width = w + 'px';
  const p = clampPos(left, top, el.offsetWidth, el.offsetHeight);
  el.style.position = 'fixed';
  el.style.margin = '0';
  el.style.left = p.left + 'px';
  el.style.top = p.top + 'px';
  el.style.transform = 'none';
  el.classList.add('is-placed');
}

function free(el) {
  el.style.position = '';
  el.style.left = '';
  el.style.top = '';
  el.style.margin = '';
  el.style.width = '';
  el.style.transform = '';
  el.style.zIndex = '';
  el.classList.remove('is-placed', 'is-dragging');
  delete el.dataset.wr;
}

const Drag = {
  enabled: true,
  els: [],

  init: function (S) {
    store = loadStore();
    this.enabled = S.dragUI !== false;
    document.body.classList.toggle('no-drag', !this.enabled);
    /* 上方控件（顶栏 / 模式菜单）不参与拖动：它们标了 data-nodrag */
    const list = document.querySelectorAll('.glass:not([data-nodrag]), .topbar:not([data-nodrag])');
    this.els = [];
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.classList.contains('glass-lite')) continue;
      const key = keyOf(el);
      el.dataset.dragKey = key;
      el.classList.add('draggable');
      if (!el.querySelector(':scope > .drag-grip')) {
        const grip = document.createElement('span');
        grip.className = 'drag-grip';
        grip.setAttribute('aria-hidden', 'true');
        el.appendChild(grip);
      }
      this.els.push(el);
      if (this.enabled && store[key]) {
        const st = store[key];
        /* 存档里有宽度就用存档的；老存档没有 w 时，用「还没切 fixed 之前」的
           文档流宽度兜底 —— 切了 fixed 再量就只剩内容宽度了。 */
        const flowW = el.offsetWidth || 0;
        const w = st.w > 0 ? st.w * window.innerWidth : flowW;
        place(el, st.x * window.innerWidth, st.y * window.innerHeight, w);
        el.dataset.wr = String(st.w > 0 ? st.w : (flowW / window.innerWidth || 0.2));
      }
    }
    this._bind();
  },

  _bind: function () {
    if (this._bound) return;
    this._bound = true;
    const self = this;

    document.addEventListener('pointerdown', function (e) {
      if (!self.enabled || e.button !== 0 || active) return;
      const el = e.target.closest && e.target.closest('.draggable');
      if (!el || self.els.indexOf(el) < 0) return;
      /* 落在按钮/滑杆/开关上就不拖（但卡片本身就是 button 时不能把自己排除掉） */
      const bad = e.target.closest && e.target.closest(EXCLUDE);
      if (bad && bad !== el) return;
      self._start(el, e);
    }, true);

    window.addEventListener('pointermove', function (e) {
      if (!active) return;
      const dx = e.clientX - active.sx, dy = e.clientY - active.sy;
      if (!active.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!active.moved) {
        active.moved = true;
        self._begin(active);          // 真的开始拖了才脱离文档流
        if (window.LR && LR.Glass && LR.Glass.setLite) LR.Glass.setLite(true);
        document.body.classList.add('is-dragging-ui');
      }
      active.el.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
      e.preventDefault();
    }, { passive: false });

    const end = function (e) {
      if (!active) return;
      const a = active;
      active = null;
      a.el.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-ui');
      if (window.LR && LR.Glass && LR.Glass.setLite) LR.Glass.setLite(false);
      if (!a.moved) return;
      const r = a.el.getBoundingClientRect();
      /* 落点写进 left/top，清掉 transform，避免亚像素模糊 */
      place(a.el, r.left, r.top, parseFloat(a.el.style.width) || r.width);
      a.el.style.zIndex = String(++zTop);
      a.el.dataset.wr = String(a.el.offsetWidth / window.innerWidth);
      store[a.key] = {
        x: parseFloat(a.el.style.left) / window.innerWidth,
        y: parseFloat(a.el.style.top) / window.innerHeight,
        w: parseFloat(a.el.dataset.wr)
      };
      saveStore();
      /* 拖动结束后的那次 click 要吞掉，否则会误触发卡片本身的点击 */
      if (e && e.type === 'pointerup') {
        const swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, true);
        setTimeout(function () { window.removeEventListener('click', swallow, true); }, 60);
      }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('resize', function () {
      for (let i = 0; i < self.els.length; i++) {
        const el = self.els[i];
        if (!el.classList.contains('is-placed')) continue;
        const wr = parseFloat(el.dataset.wr);
        if (wr > 0) el.style.width = (wr * window.innerWidth) + 'px';
        const p = clampPos(parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0, el.offsetWidth, el.offsetHeight);
        el.style.left = p.left + 'px';
        el.style.top = p.top + 'px';
      }
    });
  },

  /* 真正开始拖动那一刻才切到 fixed：单纯点一下不会改变布局 */
  _begin: function (a) {
    const el = a.el;
    const targets = [el].concat(this._peers(el));
    /* 先一次性把所有 rect 读完，再统一改样式：拖动元素脱离文档流会让兄弟元素重新居中
       （margin:auto），那就是「一拖别的控件就跳」的原因。 */
    const rects = [];
    for (let i = 0; i < targets.length; i++) rects.push(targets[i].getBoundingClientRect());
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i], r = rects[i];
      if (r.width < 8 || r.height < 8) continue;
      t.style.position = 'fixed';
      t.style.margin = '0';
      t.style.left = r.left + 'px';
      t.style.top = r.top + 'px';
      t.style.width = r.width + 'px';
      t.style.transform = 'none';
      t.style.zIndex = String(++zTop);
      t.dataset.wr = String(r.width / window.innerWidth);
      t.classList.add('is-placed');
      if (t === el) t.classList.add('is-dragging');
      const key = t.dataset.dragKey;
      if (key) store[key] = { x: r.left / window.innerWidth, y: r.top / window.innerHeight, w: parseFloat(t.dataset.wr) };
    }
    saveStore();
  },

  /* 同一屏里的其他可拖元素：跟着一起脱离文档流，免得重排跳动 */
  _peers: function (el) {
    const scr = el.closest('.screen');
    if (!scr) return [];
    const out = [];
    const list = scr.querySelectorAll('.draggable');
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p === el || p.classList.contains('is-placed')) continue;
      if (!p.offsetWidth || !p.offsetHeight) continue;
      out.push(p);
    }
    return out;
  },

  _start: function (el, e) {
    active = {
      el: el, key: el.dataset.dragKey,
      sx: e.clientX, sy: e.clientY, moved: false
    };
  },

  setEnabled: function (on) {
    this.enabled = !!on;
    document.body.classList.toggle('no-drag', !this.enabled);
    if (!this.enabled) {
      for (let i = 0; i < this.els.length; i++) {
        /* 必须用 free()：place() 写的是内联 position:fixed，只移 class 的话元素会永远钉在屏幕上 */
        free(this.els[i]);
      }
    } else {
      for (let i = 0; i < this.els.length; i++) {
        const el = this.els[i];
        const st = store[el.dataset.dragKey];
        if (st) {
          el.classList.add('is-placed');
          /* 和 init 一样要带上存档宽度，否则重新打开拖动时卡片会塌成内容宽度 */
          const w = st.w > 0 ? st.w * window.innerWidth : (el.offsetWidth || 0);
          place(el, st.x * window.innerWidth, st.y * window.innerHeight, w);
          el.dataset.wr = String(st.w > 0 ? st.w : (el.offsetWidth / window.innerWidth || 0.2));
        }
      }
    }
  },

  reset: function () {
    store = {};
    saveStore();
    for (let i = 0; i < this.els.length; i++) free(this.els[i]);
  },

  count: function () { return Object.keys(store).length; }
};

LR.Drag = Drag;
})(window.LR);
