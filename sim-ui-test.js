/* 对战页 UI 冒烟测试：node sim-ui-test.js
 * 用最小 DOM 桩加载 sim-ui.js，自动跑通：新开一局 → 出牌 → 看提示 → 碰提示 → 结束 → 再来一局。
 * 每次 innerHTML 写入都会检查是否出现"渲染出错"。真实浏览器手测仍建议做一次。
 */
'use strict';

let renderErrors = 0;
function El(id) {
  this.id = id; this.textContent = ''; this.value = 'play';
  this.hidden = false; this.scrollTop = 0; this.onclick = null;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
El.prototype.querySelectorAll = function () { return []; };
El.prototype.getAttribute = function () { return null; };
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html || ''; },
  set: function (v) {
    if (String(v).indexOf('渲染出错') >= 0) renderErrors++;
    this._html = v;
  }
});

const els = {};
global.document = { getElementById: function (id) { if (!els[id]) els[id] = new El(id); return els[id]; } };
global.window = global;
let savedTick = null;
global.setInterval = function (fn) { savedTick = fn; return 1; };
global.clearInterval = function () {};
global.setTimeout = function (fn) { fn(); return 0; }; // 连跑功能用：同步执行便于测试

global.KD = require('./engine.js');
global.SIM = require('./sim.js');
require('./sim-ui.js');

let fails = 0;
function check(cond, msg) { if (!cond) { fails++; console.log('FAIL | ' + msg); } }
function flush(n) { for (let i = 0; i < (n || 400); i++) savedTick(); }

/* ---- 人机模式全流程 ---- */
els.simNew.onclick();
let s = window.__simUI.s();
check(!!s, '新开一局后应有对局状态');
check(s.humanSeat === 0, '人机模式应坐东家');
flush();
check(els.simBoard.innerHTML.indexOf('轮到你了') >= 0, '应渲染出"轮到你"提示');

let hintUsed = false, ponSeen = false, guard = 800, stalls = 0;
while (!s.over && guard-- > 0) {
  const aw = s.await;
  if (!aw) { stalls++; break; }
  if (aw.kind === 'discard') {
    if (!hintUsed) { els.simHintBtn.onclick(); hintUsed = true; }
    const p = s.players[aw.seat];
    const r = KD.recommend(p.hand, p.melds);
    SIM.humanDiscard(s, r.discards[0].tile);
  } else if (aw.kind === 'pon') {
    flush();
    check(els.simBoard.innerHTML.indexOf('simPonYes') >= 0, '碰提示应包含"碰"按钮');
    check(els.simBoard.innerHTML.indexOf('不碰：') >= 0, '碰提示应包含比对信息');
    ponSeen = true;
    SIM.humanPong(s, true); // 接受一次，覆盖"碰后出牌"路径
  } else {
    check(false, '未知 await 类型：' + aw.kind);
    break;
  }
  flush();
}
check(!stalls, '不应停滞（无 await 且未结束）');
check(s.over, '人机对局应能结束');
flush(800);
check(els.simBoard.innerHTML.indexOf('胡了') >= 0 || els.simBoard.innerHTML.indexOf('流局') >= 0, '结束时应渲染结果');
check(els.simStat.textContent.indexOf('本次对局') === 0, '应更新对局统计（当前："' + els.simStat.textContent + '"）');
check(hintUsed, '应触发过一次提示');
console.log('人机流程：' + (s.result.liuju ? '流局' : s.players[s.result.seat].name + ' ' + s.result.how) +
  '｜日志 ' + s.log.length + ' 条｜提示用过 ' + hintUsed + '｜碰提示出现 ' + ponSeen);

/* ---- 观战模式（通过结果卡的"再来一局"触发） ---- */
els.simMode.value = 'watch';
els.simAgain.onclick();
flush(3000);
const s2 = window.__simUI.s();
check(s2 && s2.humanSeat === -1, '观战模式 humanSeat 应为 -1');
check(s2.over, '观战局应已结束');
check(els.simStat.textContent.indexOf('观战') >= 0, '观战统计应更新（当前："' + els.simStat.textContent + '"）');
check(els.simBoard.innerHTML.indexOf('胡了') >= 0 || els.simBoard.innerHTML.indexOf('流局') >= 0, '观战结束应渲染结果');
console.log('观战流程：' + (s2.result.liuju ? '流局' : '胡了') + '｜日志 ' + s2.log.length + ' 条');
check(els.simBoard.innerHTML.indexOf('牌效型') >= 0, '对战行应显示 AI 风格标签');

/* ---- 连跑 20 局 ---- */
els.simBatchBtn.onclick();
check(els.simBatch.innerHTML.indexOf('连跑 20 局') >= 0, '连跑应输出战绩');
check(els.simBatch.innerHTML.indexOf('防守型') >= 0 && els.simBatch.innerHTML.indexOf('平衡型') >= 0, '连跑战绩应含各风格');
console.log('连跑输出：' + els.simBatch.innerHTML);

check(renderErrors === 0, '渲染不应报错（' + renderErrors + ' 次）');
console.log('---- ' + (fails ? fails + ' 项失败' : '全部通过'));
process.exit(fails ? 1 : 0);
