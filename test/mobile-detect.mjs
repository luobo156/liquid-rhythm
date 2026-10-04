/* ============================================================
   Liquid Rhythm · 手机端检测测试
   真实加载 js/mobile.js，在一个模拟的浏览器环境里跑各种设备组合。

   跑法：node test/mobile-detect.mjs
   ============================================================ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'js', 'mobile.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}

/* 造一个刚好够 mobile.js 用的浏览器环境 */
function makeEnv(opt) {
  const rootCls = new Set();
  const list = function () {
    return {
      add: function (c) { rootCls.add(c); },
      remove: function (c) { rootCls.delete(c); },
      contains: function (c) { return rootCls.has(c); },
      toggle: function (c, force) {
        const on = force === undefined ? !rootCls.has(c) : !!force;
        if (on) rootCls.add(c); else rootCls.delete(c);
        return on;
      }
    };
  };
  const win = {
    innerWidth: opt.w,
    innerHeight: opt.h,
    matchMedia: function (q) {
      return { matches: q.indexOf('coarse') >= 0 ? !!opt.coarse : false };
    },
    LR: {},
    location: { search: opt.search || '' },
    screen: { orientation: { lock: function () { return { catch: function () {} }; } } }
  };
  win.document = { documentElement: { classList: list() }, body: { classList: list() } };
  win.navigator = { userAgent: opt.ua || '', maxTouchPoints: opt.touch ? 5 : 0 };
  if (typeof opt.chMobile === 'boolean') win.navigator.userAgentData = { mobile: opt.chMobile };
  win.window = win;
  win.URLSearchParams = URLSearchParams;
  win.classes = rootCls;
  return win;
}

function detect(opt) {
  const env = makeEnv(opt);
  const ctx = vm.createContext(env);
  vm.runInContext(SRC, ctx, { filename: 'mobile.js' });
  return { mobile: env.LR.isMobile(), classes: env.classes, LR: env.LR };
}

/* ---------------- 真实 UA 字符串 ---------------- */
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ipadDesktopUA: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0'
};

console.log('=== 1. 真机尺寸 + 真实 UA ===');
const cases = [
  ['iPhone 竖屏',                   { w: 393, h: 852, coarse: 1, touch: 1, ua: UA.iphone }, true],
  ['iPhone 横屏',                   { w: 852, h: 393, coarse: 1, touch: 1, ua: UA.iphone }, true],
  ['安卓手机横屏（pointer 报 fine）', { w: 915, h: 412, coarse: 0, touch: 1, ua: UA.androidPhone }, true],
  ['安卓手机 桌面版视口 980',        { w: 980, h: 400, coarse: 0, touch: 1, ua: UA.androidPhone }, true],
  ['Firefox 安卓',                  { w: 412, h: 915, coarse: 1, touch: 1, ua: UA.firefox }, true],
  ['iPad 竖屏（iPadOS 桌面 UA）',    { w: 768, h: 1024, coarse: 1, touch: 1, ua: UA.ipadDesktopUA }, false],
  ['iPad 横屏',                     { w: 1024, h: 768, coarse: 1, touch: 1, ua: UA.ipadDesktopUA }, false],
  ['安卓平板（UA 无 Mobile）',       { w: 800, h: 1280, coarse: 1, touch: 1, ua: UA.androidTablet }, false],
  ['三星 DeX 外接 1920x1080',       { w: 1920, h: 1080, coarse: 1, touch: 1, ua: UA.androidPhone }, false],
  ['桌面 1440x900',                 { w: 1440, h: 900, coarse: 0, touch: 0, ua: UA.windows }, false],
  ['桌面窄窗 500x900',              { w: 500, h: 900, coarse: 0, touch: 0, ua: UA.windows }, true],
  ['桌面压扁 1600x500',             { w: 1600, h: 500, coarse: 0, touch: 0, ua: UA.windows }, false],
  ['触屏笔记本压扁 1600x500',        { w: 1600, h: 500, coarse: 0, touch: 1, ua: UA.windows }, false],
  ['Surface 平板模式 1280x800',     { w: 1280, h: 800, coarse: 1, touch: 1, ua: UA.windows }, false]
];
for (const [name, opt, want] of cases) {
  const got = detect(opt).mobile;
  ok(got === want, name, got ? '手机' : '桌面');
}

console.log('\n=== 2. Client Hints（Chromium 的权威值）===');
ok(detect({ w: 393, h: 852, coarse: 0, touch: 0, ua: UA.windows, chMobile: true }).mobile === true,
   'CH 报 mobile 就认手机（哪怕 UA 是桌面、也没有触摸点）');
ok(detect({ w: 1440, h: 900, coarse: 0, touch: 0, ua: UA.androidPhone, chMobile: false }).mobile === false,
   'CH 报非 mobile 时不被 UA 带偏');
ok(detect({ w: 1920, h: 1080, coarse: 1, touch: 1, ua: UA.androidPhone, chMobile: true }).mobile === false,
   'CH 说是手机但尺寸到外接显示器级别 → 仍算桌面');

console.log('\n=== 3. 强制参数 ?mobile= ===');
ok(detect({ w: 1440, h: 900, coarse: 0, touch: 0, ua: UA.windows, search: '?mobile=1' }).mobile === true, '?mobile=1 强制手机');
ok(detect({ w: 393, h: 852, coarse: 1, touch: 1, ua: UA.iphone, search: '?mobile=0' }).mobile === false, '?mobile=0 强制桌面');

console.log('\n=== 4. class 写入 ===');
const portrait = detect({ w: 393, h: 852, coarse: 1, touch: 1, ua: UA.iphone });
ok(portrait.classes.has('is-mobile'), '竖屏手机加 is-mobile');
ok(portrait.classes.has('is-portrait'), '竖屏手机加 is-portrait');
const land = detect({ w: 852, h: 393, coarse: 1, touch: 1, ua: UA.iphone });
ok(land.classes.has('is-mobile'), '横屏手机加 is-mobile');
ok(!land.classes.has('is-portrait'), '横屏手机不加 is-portrait');
const desk = detect({ w: 1440, h: 900, coarse: 0, touch: 0, ua: UA.windows });
ok(!desk.classes.has('is-mobile') && !desk.classes.has('is-portrait'), '桌面两个 class 都不加');

console.log('\n=== 5. 接口完整性 ===');
const e5 = detect({ w: 1440, h: 900, coarse: 0, touch: 0, ua: UA.windows });
ok(typeof e5.LR.isMobile === 'function', 'LR.isMobile 存在');
ok(typeof e5.LR.syncMobile === 'function', 'LR.syncMobile 存在');
ok(typeof e5.LR.tryLockLandscape === 'function', 'LR.tryLockLandscape 存在');
let threw = false;
try { e5.LR.tryLockLandscape(); } catch (err) { threw = true; }
ok(!threw, 'tryLockLandscape 在桌面端不抛错');
let threw2 = false;
try { detect({ w: 852, h: 393, coarse: 1, touch: 1, ua: UA.iphone }).LR.tryLockLandscape(); } catch (err) { threw2 = true; }
ok(!threw2, 'tryLockLandscape 在手机端不抛错（浏览器拒绝锁定也不该崩）');

console.log('\n总: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
