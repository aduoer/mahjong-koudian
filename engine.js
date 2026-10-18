/* 山西扣点 · 牌理引擎 v1
 * 纯逻辑、无依赖；浏览器（挂到全局 KD）与 Node（module.exports）均可运行。
 *
 * 牌索引：0-8 = 一~九万 | 9-17 = 一~九筒 | 18-26 = 一~九条 | 27-33 = 东 南 西 北 中 发 白
 *
 * 已实现的规则（山西扣点 / 扣点点）：
 *  - 136 张、无花；可碰、可杠、不可吃（吃不吃不影响纯牌型计算）
 *  - 点数：数牌 = 面值（1~9）；风、字牌 = 10 点
 *  - 胡牌限制：1~2 点不能胡；3~5 点只能自摸；6 点及以上可自摸、可点炮
 *  - 报听：必须报听才能胡；报听要求听口包含 6 点及以上的牌
 *  - 和牌牌型：4 面子 + 1 将 或 七小对
 *
 * 未实现：耗子（万能牌）、风嘴子、摸五胡六等房间开关；对手信息（弃牌/安全度）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KD = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const T = 34;
  const SUIT1 = ['m', 'p', 's'];
  const HONORS = ['东', '南', '西', '北', '中', '发', '白'];

  function tileName(i) {
    if (i < 27) return (i % 9 + 1) + ['万', '筒', '条'][(i / 9) | 0];
    return HONORS[i - 27];
  }
  function tilePoints(i) { return i < 27 ? (i % 9) + 1 : 10; }
  function winMode(pts) { return pts >= 6 ? 'ron' : pts >= 3 ? 'tsumo' : 'dead'; }

  /* ---------------- 向听（通用牌型） ---------------- */
  // 预算 budget = 剩余的"块"数上限（面子+搭子）。返回可达到的最大 2*面子 + 搭子。
  const memo = new Map();
  function bestProgress(c, budget) {
    if (budget <= 0) return 0;
    let i = 0; while (i < T && c[i] === 0) i++;
    if (i === T) return 0;
    const key = c.join('') + budget;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    c[i]--; // 该牌先当孤张（不参与组块）
    best = Math.max(best, bestProgress(c, budget)); c[i]++;
    if (c[i] >= 3) { // 刻子
      c[i] -= 3; best = Math.max(best, 2 + bestProgress(c, budget - 1)); c[i] += 3;
    }
    if (i < 27) {
      const p = i % 9;
      if (p <= 6 && c[i + 1] > 0 && c[i + 2] > 0) { // 顺子
        c[i]--; c[i + 1]--; c[i + 2]--;
        best = Math.max(best, 2 + bestProgress(c, budget - 1));
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (p <= 7 && c[i + 1] > 0) { // 两面 / 边张
        c[i]--; c[i + 1]--;
        best = Math.max(best, 1 + bestProgress(c, budget - 1));
        c[i]++; c[i + 1]++;
      }
      if (p <= 6 && c[i + 2] > 0) { // 嵌张
        c[i]--; c[i + 2]--;
        best = Math.max(best, 1 + bestProgress(c, budget - 1));
        c[i]++; c[i + 2]++;
      }
    }
    if (c[i] >= 2) { // 对子当搭子
      c[i] -= 2; best = Math.max(best, 1 + bestProgress(c, budget - 1)); c[i] += 2;
    }
    if (memo.size >= 250000) memo.clear(); // 上限保护：连打多局时防止内存无限增长
    memo.set(key, best);
    return best;
  }

  // melds = 已副露（碰/杠）副数；10张/11张…手牌自动减去 3*melds 的约束
  function shantenStd(c0, melds) {
    const budget = 4 - (melds | 0);
    const base = 2 * budget;
    const c = c0.slice();
    let best = base - bestProgress(c, budget); // 无将
    for (let i = 0; i < T; i++) {
      if (c[i] >= 2) { // 取一对当将
        c[i] -= 2;
        best = Math.min(best, base - bestProgress(c, budget) - 1);
        c[i] += 2;
      }
    }
    return best;
  }

  /* ---------------- 七小对 ---------------- */
  function shantenChiitoi(c) {
    let pairs = 0, kinds = 0;
    for (let i = 0; i < T; i++) {
      if (c[i] > 0) kinds++;
      if (c[i] >= 2) pairs++;
    }
    return 6 - Math.min(pairs, 7) + Math.max(0, 7 - kinds);
  }

  function shanten(c, melds) {
    melds = melds | 0;
    let s = shantenStd(c, melds);
    if (melds === 0) s = Math.min(s, shantenChiitoi(c));
    return s;
  }
  function isWin(c, melds) { return shanten(c, melds) === -1; }

  /* ---------------- 听口 / 进张 ---------------- */
  // 13 张（或副露后的等价钱）的听口；每张带点数与胡法（ron=可点炮, tsumo=仅自摸, dead=不能胡）
  function winTiles(c13, melds) {
    const out = [];
    for (let t = 0; t < T; t++) {
      if (c13[t] >= 4) continue;
      const c2 = c13.slice(); c2[t]++;
      if (isWin(c2, melds)) {
        const pts = tilePoints(t);
        out.push({ tile: t, pts: pts, mode: winMode(pts), remain: 4 - c13[t] });
      }
    }
    return out;
  }

  // 有效进张：能让向听数下降的牌（向听=0 时即听口本身）
  function effectiveTiles(c, melds) {
    const base = shanten(c, melds);
    const list = [];
    for (let t = 0; t < T; t++) {
      if (c[t] >= 4) continue;
      const c2 = c.slice(); c2[t]++;
      if (shanten(c2, melds) < base) list.push({ tile: t, remain: 4 - c[t] });
    }
    const total = list.reduce(function (a, x) { return a + x.remain; }, 0);
    return { base: base, list: list, total: total };
  }

  /* ---------------- 牌情（13 张） ---------------- */
  function analyze(c, melds) {
    melds = melds | 0;
    const size = c.reduce(function (a, b) { return a + b; }, 0);
    const s = shanten(c, melds);
    const res = { size: size, melds: melds, shanten: s };
    if (s === 0) {
      res.waits = winTiles(c, melds);
      res.canDeclare = res.waits.some(function (w) { return w.pts >= 6; });
      res.effTotal = res.waits.reduce(function (a, w) { return a + (w.mode === 'dead' ? 0 : w.remain); }, 0); // 1~2点听口永远胡不了，不计入
    } else {
      res.eff = effectiveTiles(c, melds);
    }
    return res;
  }

  /* ---------------- 推荐打哪张（14 张） ---------------- */
  function recommend(c14, melds) {
    melds = melds | 0;
    const size = c14.reduce(function (a, b) { return a + b; }, 0);
    const expect = 14 - 3 * melds;
    if (size !== expect) {
      return { error: '张数不对：副露 ' + melds + ' 副时，应为 ' + expect + ' 张（当前 ' + size + ' 张）' };
    }
    const items = [];
    for (let t = 0; t < T; t++) {
      if (c14[t] === 0) continue;
      const c13 = c14.slice(); c13[t]--;
      const s = shanten(c13, melds);
      const it = { tile: t, shanten: s, tier: s, effTotal: 0, ronCount: 0 };
      if (s === 0) {
        it.waits = winTiles(c13, melds);
        it.canDeclare = it.waits.some(function (w) { return w.pts >= 6; });
        it.effTotal = it.waits.reduce(function (a, w) { return a + (w.mode === 'dead' ? 0 : w.remain); }, 0); // 1~2点听口永远胡不了，不计入
        it.ronCount = it.waits.filter(function (w) { return w.mode === 'ron'; }).length;
        it.tier = it.canDeclare ? 0 : 0.5; // "死听"排在有效听牌之后、一向听之前：离换成可报听听口只差一次换张
      } else {
        it.eff = effectiveTiles(c13, melds);
        it.effTotal = it.eff.total;
        it.tier = s;
      }
      items.push(it);
    }
    if (!items.length) return { error: '手牌为空' };
    items.sort(function (a, b) {
      return a.tier - b.tier || b.effTotal - a.effTotal || b.ronCount - a.ronCount || a.tile - b.tile;
    });
    return { size: size, melds: melds, discards: items };
  }

  /* ---------------- 记法解析 ---------------- */
  // 支持 "123m 456p 55s 123z" 以及 "3万 5筒 东" 等写法
  function parseNotation(str) {
    let s = String(str).trim().toLowerCase();
    s = s.replace(/([1-9])万/g, '$1m').replace(/([1-9])筒/g, '$1p').replace(/([1-9])条/g, '$1s');
    s = s.replace(/东/g, '1z').replace(/南/g, '2z').replace(/西/g, '3z').replace(/北/g, '4z')
         .replace(/中/g, '5z').replace(/发/g, '6z').replace(/白/g, '7z');
    const c = new Array(T).fill(0);
    const re = /(\d+)([mpsz])/g;
    let m, n = 0;
    while ((m = re.exec(s)) !== null) {
      const suit = m[2];
      for (let k = 0; k < m[1].length; k++) {
        const d = +m[1][k];
        if (suit === 'z' ? (d < 1 || d > 7) : (d < 1 || d > 9)) {
          return { error: '记法有误：' + m[0] + '（z 只能 1~7，m/p/s 只能 1~9）' };
        }
        const idx = suit === 'm' ? d - 1 : suit === 'p' ? 8 + d : suit === 's' ? 17 + d : 26 + d;
        c[idx]++; n++;
        if (c[idx] > 4) return { error: '同一种牌超过 4 张：' + tileName(idx) };
      }
    }
    const leftover = s.replace(/(\d+)[mpsz]/g, '').replace(/[\s,，、;；]/g, '');
    if (leftover.length) return { error: '无法识别："' + leftover + '"' };
    if (!n) return { error: '没有识别到牌' };
    return { counts: c, size: n };
  }

  function formatHand(c) {
    const parts = [];
    for (let s2 = 0; s2 < 3; s2++) {
      let ds = '';
      for (let d = 0; d < 9; d++) {
        const i = s2 * 9 + d;
        for (let k = 0; k < c[i]; k++) ds += (d + 1);
      }
      if (ds) parts.push(ds + SUIT1[s2]);
    }
    let z = '';
    for (let d = 0; d < 7; d++) {
      const i = 27 + d;
      for (let k = 0; k < c[i]; k++) z += (d + 1);
    }
    if (z) parts.push(z + 'z');
    return parts.join(' ') || '(空)';
  }

  /* ---------------- 自检 ---------------- */
  function selfTest() {
    const cases = [];
    function t(notation, melds, expected, label) {
      const p = parseNotation(notation);
      if (p.error) { cases.push({ ok: false, label: label, info: p.error }); return; }
      const s = shanten(p.counts, melds);
      cases.push({ ok: s === expected, label: label, info: notation + ' 期望' + expected + ' 实得' + s });
    }
    t('11122233344455m', 0, -1, '14张和牌·标准');
    t('11223344556677m', 0, -1, '14张和牌·七小对');
    t('123456789m 234p 55s', 0, -1, '14张和牌·混色');
    t('1112223334456m', 0, 0, '13张听牌');
    t('1112223334578m', 0, 0, '13张听牌·多解（易错例）');
    t('1122334455667m', 0, 0, '13张听牌·七小对');
    t('123456789m 12p 34z', 0, 1, '13张一向听');
    t('123m 123p 123s 789m 1s', 0, 0, '13张听1条');
    t('1112223334m', 1, 0, '副露1副·10张听牌');

    const dead = analyze(parseNotation('123m 123p 123s 789m 1s').counts, 0);
    cases.push({
      ok: dead.shanten === 0 && dead.canDeclare === false,
      label: '死听识别：1条（1点）听口不能报听',
      info: JSON.stringify({ shanten: dead.shanten, canDeclare: dead.canDeclare })
    });
    const rec = recommend(parseNotation('123456789m 234p 55s').counts, 0);
    const top = rec.discards && rec.discards[0];
    cases.push({
      ok: !!top && tileName(top.tile) === '9万',
      label: '推荐打9万（牌效最优）',
      info: top ? '实际：打' + tileName(top.tile) : '无结果'
    });
    const pass = cases.filter(function (x) { return x.ok; }).length;
    return { passed: pass, total: cases.length, cases: cases };
  }

  return {
    tileName: tileName,
    tilePoints: tilePoints,
    winMode: winMode,
    parseNotation: parseNotation,
    formatHand: formatHand,
    shanten: shanten,
    isWin: isWin,
    winTiles: winTiles,
    effectiveTiles: effectiveTiles,
    analyze: analyze,
    recommend: recommend,
    selfTest: selfTest
  };
});
