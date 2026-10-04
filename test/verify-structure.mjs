// 一次性自检脚本：不修改任何文件，只读并报告
import fs from 'node:fs';
const base = 'H:/work/liquid-rhythm/';
const html = fs.readFileSync(base + 'index.html', 'utf8');
const css = fs.readFileSync(base + 'styles.css', 'utf8');
const ui = fs.readFileSync(base + 'js/ui.js', 'utf8');
const extra = ['glass.js', 'backdrop.js', 'drag.js']
  .map((f) => fs.readFileSync(base + 'js/' + f, 'utf8')).join('\n');
const game = fs.readFileSync(base + 'js/game.js', 'utf8');
let bad = 0;
const say = (s) => console.log(s);

/* ---- 1. 重复 id ---- */
const ids = {};
for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids[m[1]] = (ids[m[1]] || 0) + 1;
const dup = Object.entries(ids).filter(([, n]) => n > 1);
say('== ids: ' + Object.keys(ids).length + ' unique, duplicates: ' + (dup.length ? JSON.stringify(dup) : 'none'));
bad += dup.length;

/* ---- 2. JS 里用到的 #id 是否都存在 ---- */
const used = new Set();
for (const src of [ui, game, extra]) {
  for (const m of src.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\$\('#' \+ ([A-Za-z0-9_.]+)\)/g)) used.add('<dynamic:' + m[1] + '>');
}
const DYNAMIC = ['glassDefs'];   // 由 glass.js 运行时创建
const missing = [...used].filter((k) => !k.startsWith('<dynamic:') && DYNAMIC.indexOf(k) < 0 && !(k in ids));
say('== selectors referenced in JS: ' + used.size + ', missing in HTML: ' + (missing.length ? missing.join(', ') : 'none'));
bad += missing.length;

/* ---- 3. HTML 标签配对 ---- */
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr','path','rect','circle','ellipse','line','polyline','polygon','stop','use','feTurbulence','feGaussianBlur','feDisplacementMap','feColorMatrix','feBlend']);
const stack = [];
const errs = [];
const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '');
for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
  const close = m[1] === '/', tag = m[2], self = m[4] === '/';
  if (VOID.has(tag) || self) continue;
  if (!close) stack.push(tag);
  else {
    const top = stack.pop();
    if (top !== tag) errs.push('expected </' + top + '> but found </' + tag + '>');
  }
}
if (stack.length) errs.push('never closed: ' + stack.join(', '));
say('== html tag balance: ' + (errs.length ? errs.join(' | ') : 'balanced'));
bad += errs.length;

/* ---- 4. JS 里 toggle 的 class 是否在 CSS 里定义 ---- */
const toggled = new Set();
for (const src of [ui, game, extra]) {
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains)\('([A-Za-z0-9_-]+)'/g)) toggled.add(m[1]);
}
const missClass = [...toggled].filter((c) => !css.includes('.' + c));
say('== classes toggled by JS: ' + [...toggled].join(', '));
say('   not found in CSS: ' + (missClass.length ? missClass.join(', ') : 'none'));

/* ---- 5. CSS 括号 / 注释 ---- */
let depth = 0, line = 1, firstBad = 0;
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
for (let i = 0; i < stripped.length; i++) {
  const ch = stripped[i];
  if (ch === '\n') line++;
  else if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0 && !firstBad) { firstBad = line; depth = 0; } }
}
const openComments = (css.match(/\/\*/g) || []).length - (css.match(/\*\//g) || []).length;
say('== css brace depth at EOF: ' + depth + (firstBad ? ' (extra } at line ' + firstBad + ')' : '') + ', unclosed comments: ' + openComments);
bad += Math.abs(depth) + Math.abs(openComments);

/* ---- 6. 必需的 CSS 类 ---- */
const need = ['.screen', '.glass', '.glass-lite', '.glass__lens', '.chip', '.switch', '.kbkey', '.rbar__fill', '.modes__glider', '.svgdefs', '.draggable', '.bg__img', '.bg__scrim', '.is-hidden', '.is-active', '.is-on', '.is-placed', '.is-dragging', '.in-game', '.perf-game', '.no-lens', '.no-drag'];
const missCss = need.filter((c) => !css.includes(c + '{') && !css.includes(c + ' ') && !css.includes(c + ',') && !css.includes(c + ':'));
say('== required css classes missing: ' + (missCss.length ? missCss.join(', ') : 'none'));
bad += missCss.length;

say(bad === 0 ? '\nVERIFY: ALL CHECKS PASSED' : '\nVERIFY: ' + bad + ' problem(s)');
