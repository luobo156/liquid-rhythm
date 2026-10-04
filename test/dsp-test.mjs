/* 一次性功能测试：在 Node 里直接跑 core.js 的 DSP 与谱面生成（不需要浏览器）
   core.js 里只有 makeSampleSong/AudioEngine.ensure 依赖浏览器 API，本测试不触碰它们。 */
import fs from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
const src = fs.readFileSync('H:/work/liquid-rhythm/js/core.js', 'utf8');
vm.runInThisContext(src, { filename: 'core.js' });
const LR = globalThis.LR;

let fail = 0;
const ok = (cond, label, extra) => {
  if (!cond) fail++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined ? '   ' + extra : ''));
};

/* ---------- 合成测试信号：128 BPM，每拍一个起音，频谱内容交替 ---------- */
const SR = 44100, DUR = 24, BPM = 128;
const beat = 60 / BPM;
const L = Math.round(SR * DUR);
const pcm = new Float32Array(L);
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
for (let i = 0; i < L; i++) pcm[i] = rnd() * 0.0016;            // 底噪
for (let k = 0; k * beat < DUR - 0.2; k++) {
  const start = Math.floor(k * beat * SR);
  const kind = k % 4;                                            // 0 低频 / 2 高频 / 1,3 中频
  const len = Math.round(SR * 0.22);
  for (let i = 0; i < len && start + i < L; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 22);
    let v;
    if (kind === 0) v = Math.sin(2 * Math.PI * 58 * t) * env;                       // 低频
    else if (kind === 2) v = rnd() * env * 0.9;                                     // 宽带噪声 → 高频重心
    else v = (Math.sin(2 * Math.PI * 620 * t) + 0.5 * Math.sin(2 * Math.PI * 1240 * t)) * env * 0.7;
    pcm[start + i] += v * 0.7;
  }
}
const buffer = {
  sampleRate: SR, numberOfChannels: 1, length: L, duration: DUR,
  getChannelData: () => pcm
};

console.log('=== 1. analyze() 起音检测 + BPM ===');
let progressHits = 0;
const A = await LR.analyze(buffer, () => { progressHits++; });
console.log('  bpm=' + A.bpm + ' beat=' + A.beat.toFixed(4) + ' offset=' + A.offset.toFixed(3) +
  ' onsets=' + A.onsets.length + ' beats=' + A.beats.length + ' progress callbacks=' + progressHits);
ok(Math.abs(A.bpm - BPM) <= 4, 'BPM 接近 128', '(得到 ' + A.bpm + ')');
ok(A.onsets.length >= 35 && A.onsets.length <= 90, '起音数量落在合理区间 35~90', '(得到 ' + A.onsets.length + ')');
ok(progressHits > 1, '进度回调被触发');
ok(A.onsets.every((o, i, a) => i === 0 || o.t > a[i - 1].t), '起音时间严格递增');
ok(A.onsets.every((o) => o.t >= 0 && o.t <= DUR && o.s >= 0 && o.s <= 1.0001), '起音时间/强度合法');
const cents = A.onsets.map((o) => o.c);
const cMin = Math.min(...cents), cMax = Math.max(...cents), cAvg = cents.reduce((a, b) => a + b, 0) / cents.length;
console.log('  频谱重心 c: min=' + cMin.toFixed(3) + ' max=' + cMax.toFixed(3) + ' avg=' + cAvg.toFixed(3));
ok(cMax - cMin > 0.25, '频谱重心有区分度（分轨才有变化）', '(跨度 ' + (cMax - cMin).toFixed(3) + ')');

/* 拍相位是否真的对齐起音 */
const near = A.onsets.filter((o) => {
  const ph = ((o.t - A.offset) % A.beat + A.beat) % A.beat;
  return Math.min(ph, A.beat - ph) < 0.055;
}).length;
ok(near / A.onsets.length > 0.75, '>75% 的起音落在节拍网格上', '(' + near + '/' + A.onsets.length + ')');

console.log('\n=== 2. buildChart() 三种玩法 × 四档难度 ===');
const modes = ['fall', 'rd', 'side'];
const diffs = ['easy', 'normal', 'hard', 'expert'];
for (const mode of modes) {
  for (const diff of diffs) {
    let chart;
    try {
      chart = LR.buildChart(A, { mode, diff, lanes: mode === 'rd' ? 1 : 4, density: 0.5, holds: true, snap: true });
    } catch (e) {
      ok(false, mode + '/' + diff + ' 不抛异常', String(e && e.message));
      continue;
    }
    const n = chart.notes;
    const holds = n.filter((x) => x.dur > 0.05).length;
    const lanesUsed = new Set(n.map((x) => x.lane)).size;
    const sorted = n.every((x, i) => i === 0 || x.t >= n[i - 1].t);
    const inRange = n.every((x) => x.t >= 0 && x.t <= DUR + 0.01 && x.lane >= 0 && x.lane < chart.lanes && x.dur >= 0);
    const holdsOk = n.every((x) => x.dur === 0 || x.dur >= 0.3);
    const noLead = n.every((x) => x.t >= 1.29);
    console.log('  ' + mode.padEnd(5) + ' ' + diff.padEnd(7) + ' notes=' + String(n.length).padStart(4) +
      ' holds=' + String(holds).padStart(3) + ' lanes↓' + lanesUsed + '/' + chart.lanes +
      ' 首音@' + (n.length ? n[0].t.toFixed(2) : '-') + 's nps=' + (n.length / DUR).toFixed(2));
    ok(n.length > 8, mode + '/' + diff + ' 生成了足够音符', '(' + n.length + ')');
    ok(sorted, mode + '/' + diff + ' 音符按时间排序');
    ok(inRange, mode + '/' + diff + ' 音符时间/轨道/时长合法');
    ok(holdsOk, mode + '/' + diff + ' 长按时长合理');
    ok(noLead, mode + '/' + diff + ' 开头留出了准备时间');
    ok(chart.lanes === (mode === 'rd' ? 1 : 4), mode + '/' + diff + ' 轨道数正确');
    if (mode !== 'rd') ok(lanesUsed >= 2, mode + '/' + diff + ' 用到了多个轨道', '(' + lanesUsed + ')');
  }
}

console.log('\n=== 3. 难度递增性（同模式音符数应单调不减）===');
for (const mode of ['fall', 'side']) {
  const counts = diffs.map((d) => LR.buildChart(A, { mode, diff: d, lanes: 4, density: 0.5, holds: true, snap: true }).notes.length);
  console.log('  ' + mode + ': ' + diffs.map((d, i) => d + '=' + counts[i]).join('  '));
  ok(counts[0] < counts[3], mode + ' 简单 < 专家', '(' + counts[0] + ' vs ' + counts[3] + ')');
  ok(counts.every((c, i) => i === 0 || c >= counts[i - 1] * 0.85), mode + ' 大致单调递增');
}

console.log('\n=== 4. 边界情况 ===');
const silent = { sampleRate: SR, numberOfChannels: 1, length: SR * 3, duration: 3, getChannelData: () => new Float32Array(SR * 3) };
const As = await LR.analyze(silent, () => {});
const cs = LR.buildChart(As, { mode: 'fall', diff: 'normal', lanes: 4, density: 0.5, holds: true, snap: true });
console.log('  纯静音: onsets=' + As.onsets.length + ' notes=' + cs.notes.length + ' bpm=' + As.bpm);
ok(As.onsets.length === 0, '静音不产生起音');
ok(cs.notes.length === 0, '静音谱面为空（游戏里会被拦截）');

const short = { sampleRate: SR, numberOfChannels: 2, length: Math.round(SR * 0.3), duration: 0.3, getChannelData: () => new Float32Array(Math.round(SR * 0.3)) };
try {
  const Ash = await LR.analyze(short, () => {});
  ok(true, '0.3 秒的极短音频不崩溃', '(onsets=' + Ash.onsets.length + ')');
} catch (e) { ok(false, '0.3 秒极短音频不崩溃', String(e && e.message)); }

console.log('\n=== 5. 确定性（同输入同参数应生成完全一样的谱面）===');
const p = { mode: 'fall', diff: 'hard', lanes: 6, density: 0.6, holds: true, snap: true };
const c1 = LR.buildChart(A, p).notes.map((n) => n.t + ':' + n.lane + ':' + n.dur).join('|');
const c2 = LR.buildChart(A, p).notes.map((n) => n.t + ':' + n.lane + ':' + n.dur).join('|');
ok(c1 === c2, '两次生成的谱面完全一致');

console.log('\n=== 6. 六轨 + 高密度压力 ===');
const t0 = Date.now();
const heavy = LR.buildChart(A, { mode: 'fall', diff: 'expert', lanes: 6, density: 1, holds: true, snap: false });
const ms = Date.now() - t0;
console.log('  notes=' + heavy.notes.length + ' 生成耗时=' + ms + 'ms');
ok(ms < 1500, 'buildChart 耗时可接受', '(' + ms + 'ms)');

console.log(fail === 0 ? '\nDSP TEST: ALL PASSED' : '\nDSP TEST: ' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
