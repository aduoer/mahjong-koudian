/* 单机对战引擎自检：node sim-test.js
 * 1) 观战压力测试：150 局全 AI 对局，验证结束/牌数守恒/张数合法/胡牌者已报听
 * 2) 人机混合测试：100 局，人位用引擎代打并随机碰，覆盖 humanDiscard/humanPong 全部路径
 * 3) 定点检查：日志含报听、每条日志带快照
 */
const KD = require('./engine.js');
const SIM = require('./sim.js');

let fails = 0;
function check(cond, msg) { if (!cond) { fails++; console.log('FAIL | ' + msg); } }

/* ---- 1) 观战 ---- */
const N1 = 150;
const out1 = { tsumo: 0, ron: 0, liuju: 0 };
for (let seed = 1; seed <= N1; seed++) {
  const s = SIM.newGame({ seed: seed, humanSeat: -1 });
  SIM.pump(s);
  check(s.over, '观战 seed' + seed + '：没打完');
  check(SIM.tally(s) === 136, '观战 seed' + seed + '：牌数 ' + SIM.tally(s));
  for (const p of s.players) {
    for (let i = 0; i < 34; i++) {
      check(p.hand[i] >= 0 && p.hand[i] <= 4, '观战 seed' + seed + '：非法张数');
    }
  }
  if (s.result && !s.result.liuju) {
    out1[s.result.how]++;
    check(s.players[s.result.seat].declared === true, '观战 seed' + seed + '：胡牌者未报听');
  } else out1.liuju++;
}
console.log('观战 ' + N1 + ' 局：自摸 ' + out1.tsumo + ' · 点炮 ' + out1.ron + ' · 流局 ' + out1.liuju);
check(out1.tsumo + out1.ron + out1.liuju === N1, '观战结果计数异常');
check(out1.tsumo > 0 && out1.ron > 0, '观战 150 局两种胡法都应出现过');

/* ---- 2) 人机混合 ---- */
let rc = 1;
function rnd() { rc = (rc * 9301 + 49297) % 233280; return rc / 233280; }
const N2 = 100;
const out2 = { tsumo: 0, ron: 0, liuju: 0 };
let ponPrompts = 0, stalls = 0;
for (let seed = 1; seed <= N2; seed++) {
  const s = SIM.newGame({ seed: seed * 7 + 1, humanSeat: seed % 4 });
  SIM.pump(s);
  let guard = 1500;
  while (!s.over && guard-- > 0) {
    const aw = s.await;
    if (!aw) { stalls++; check(false, '人机 seed' + seed + '：停滞（无 await 且未结束）'); break; }
    if (aw.kind === 'discard') {
      const p = s.players[aw.seat];
      const r = KD.recommend(p.hand, p.melds);
      check(!r.error, '人机 seed' + seed + '：recommend ' + r.error);
      SIM.humanDiscard(s, r.discards[0].tile);
    } else if (aw.kind === 'pon') {
      ponPrompts++;
      SIM.humanPong(s, rnd() < 0.5);
    } else {
      check(false, '人机 seed' + seed + '：未知 await ' + aw.kind);
      break;
    }
  }
  check(s.over, '人机 seed' + seed + '：没打完（guard 用尽）');
  check(SIM.tally(s) === 136, '人机 seed' + seed + '：牌数 ' + SIM.tally(s));
  if (s.result && !s.result.liuju) out2[s.result.how]++; else out2.liuju++;
}
console.log('人机 ' + N2 + ' 局（' + ponPrompts + ' 次碰的决策点）：自摸 ' + out2.tsumo + ' · 点炮 ' + out2.ron + ' · 流局 ' + out2.liuju);

/* ---- 3) 定点检查 ---- */
const s3 = SIM.newGame({ seed: 42, humanSeat: -1 });
SIM.pump(s3);
const joined = s3.log.map(function (x) { return x.text; }).join('\n');
check(/报听/.test(joined), '观战日志里应出现报听');
check(s3.log.every(function (x) { return x.snap && x.snap.discards && x.snap.handCounts; }), '每条日志都应带快照');
if (s3.result && !s3.result.liuju) {
  const w = s3.players[s3.result.seat];
  check(/报听/.test(joined), 'seed42：胡牌者应有报听记录');
  console.log('seed42 结果：' + s3.log[s3.log.length - 1].text + '（' + w.name + '，' + s3.log.length + ' 条日志）');
}

/* ---- 4) 多风格锦标赛（牌效 / 防守 / 平衡 对打） ---- */
const N3 = 60;
const profSeats = ['eff', 'def', 'bal', 'eff'];
const pf = { eff: { win: 0, deal: 0 }, def: { win: 0, deal: 0 }, bal: { win: 0, deal: 0 } };
let liuju3 = 0, dodgeGames = 0;
for (let seed = 500; seed < 500 + N3; seed++) {
  const s = SIM.newGame({ seed: seed, humanSeat: -1, profiles: profSeats });
  SIM.pump(s);
  check(s.over, '多风格 seed' + seed + '：没打完');
  check(SIM.tally(s) === 136, '多风格 seed' + seed + '：牌数 ' + SIM.tally(s));
  for (const x of s.log) if (/避开报听听口/.test(x.text)) { dodgeGames++; break; }
  if (s.result.liuju) { liuju3++; continue; }
  pf[profSeats[s.result.seat]].win++;
  if (s.result.how === 'ron') pf[profSeats[s.result.from]].deal++;
}
console.log('多风格 ' + N3 + ' 局：牌效 ' + pf.eff.win + '胡/' + pf.eff.deal + '炮 · 防守 ' +
  pf.def.win + '胡/' + pf.def.deal + '炮 · 平衡 ' + pf.bal.win + '胡/' + pf.bal.deal + '炮 · 流局 ' + liuju3 +
  '（有 ' + dodgeGames + ' 局出现避炮出牌）');

console.log('---- ' + (fails ? fails + ' 项失败' : '全部通过') + (stalls ? '（停滞 ' + stalls + '）' : ''));
process.exit(fails ? 1 : 0);
