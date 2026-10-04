/* ============================================================
   Liquid Rhythm · mobile.js
   手机端检测。

   为什么单独一个文件、而且要放在 <head> 里、styles.css 之前：
   class 必须在样式生效前就加到 <html> 上，否则手机上会先按桌面布局
   渲染一两帧再跳成手机布局（首屏闪一下）。

   为什么不做成内联脚本：独立文件才能被自动化测试覆盖，
   见 test/mobile-detect.mjs。
   ============================================================ */
window.LR = window.LR || {};
(function (LR) {
'use strict';

/* ?mobile=1 / ?mobile=0 可强制，方便测试与截图 */
var FORCED = (function () {
  try {
    var q = new URLSearchParams(location.search).get('mobile');
    return q === '1' ? true : (q === '0' ? false : null);
  } catch (e) { return null; }
})();

/* UA / Client Hints 佐证。
   优先 navigator.userAgentData.mobile（Chromium 的布尔值，最准），
   没有这个接口的浏览器（Safari / Firefox）再退回 UA 字符串。

   Android 这条必须写成 /Android.*Mobile/ 而不是光看 "Android"：
   手机的 UA 带 "Mobile" 标记，平板不带 —— 正好和「平板不套手机布局」的目标一致。
   （是 .* 而不是 [^)]*，真实 UA 里 "SM-S911B)" 的右括号会把后者挡断。）

   iPadOS 13+ 默认上报桌面版 UA（Macintosh），所以这条对 iPad 帮不上忙，
   但也没关系：iPad 本来就不该被当成手机。 */
function uaLooksPhone() {
  try {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      return navigator.userAgentData.mobile;
    }
  } catch (e) { /* 老浏览器没有这个接口 */ }
  var ua = navigator.userAgent || '';
  if (/iPhone|iPod|Windows Phone/i.test(ua)) return true;
  return /Android.*Mobile/i.test(ua);
}

/* 三层判据，从上到下依次放宽：
   ① 触屏 + 手机级别的短边 —— 最可靠
   ② UA / Client Hints 说是手机，且尺寸没到外接显示器的程度
      （三星 DeX 外接 1920x1080 时 UA 仍说是手机，所以这里要有尺寸上限）
   ③ 窗口本身就很窄（桌面把窗口拖窄也套手机布局）

   短边设上限的原因：iPad / 安卓平板的 pointer 也是 coarse、也有触摸点，
   只看「是不是触屏」会把平板判成手机 —— 结果 iPad 竖屏会弹「请横屏」，
   而竖屏用平板是完全正常的用法。

   窄只看宽度的原因：一开始写的是 Math.min(w,h) <= 560，于是「宽而矮」的
   桌面窗口（比如压扁成 1600x500 放在屏幕下方）会被误判成手机。 */
LR.isMobile = function () {
  if (FORCED !== null) return FORCED;
  try {
    var w = window.innerWidth, h = window.innerHeight;
    var shortSide = Math.min(w, h);
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var touch = (navigator.maxTouchPoints || 0) > 0;
    if (coarse && touch && shortSide <= 600) return true;
    if (uaLooksPhone() && shortSide <= 820) return true;
    if (w <= 600) return true;
    return false;
  } catch (e) { return false; }
};

/* 把结果写到 <html> 上，CSS 用它切整套手机样式 */
LR.syncMobile = function () {
  var m = LR.isMobile();
  var portrait = window.innerHeight > window.innerWidth;
  var el = document.documentElement;
  el.classList.toggle('is-mobile', m);
  if (document.body) document.body.classList.toggle('is-mobile', m);
  /* 竖屏标记：手机端建议全程横屏，用它决定要不要显示「请横屏」遮罩 */
  el.classList.toggle('is-portrait', m && portrait);
  return m;
};

/* 尽量让浏览器自己转过去（多数浏览器要求先进全屏，失败就算了，靠遮罩提示） */
LR.tryLockLandscape = function () {
  try {
    if (!LR.isMobile()) return;
    if (screen.orientation && screen.orientation.lock) {
      var p = screen.orientation.lock('landscape');
      if (p && p.catch) p.catch(function () { });
    }
  } catch (e) { /* ignore */ }
};

/* 立刻生效，早于首次绘制 */
LR.syncMobile();

})(window.LR);
