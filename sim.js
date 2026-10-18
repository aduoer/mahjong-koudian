/* 山西扣点 · 单机对战引擎 v1（本地练习/观战，不连接任何真实游戏）
 * 浏览器挂 window.SIM；Node 用 require('./sim.js')；依赖 engine.js（KD）。
 *
 * v1 简化（相对真实对局）：
 *  - 到"可报听的听牌"自动报听；报听后锁手——摸啥打啥、不能再碰
 *  - 不实现杠；不能吃（扣点本来不能吃）
 *  - 多家可点炮时按出牌者下家顺序最近一家胡（无一炮多响）
 *  - 不算番/点；流局 = 牌墙摸完
 *  - 死听（听口全在 6 点以下）不报听，保持自由换牌
 *  - AI 决策 = KD 牌效引擎；三种风格：'eff' 牌效 / 'def' 防守（躲公开报听听口，最多降一档）/ 'bal' 平衡（只在同档内躲）
 *    防守只用公开信息：报听听口是明示的；未报听玩家的手牌不偷看
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.SIM = factory(root.KD);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (KD) {
  'use strict';

  const T = 34;
  const SEATS = ['东', '南', '西', '北'];

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function handSize(c) { let n = 0; for (let i = 0; i < T; i++) n += c[i]; return n; }

  /* 牌数守恒：手牌 + 明牌(每副露3张) + 牌河 + 牌墙 = 136 */
  function tally(state) {
    let n = state.wallLeft;
    for (const p of state.players) n += handSize(p.hand) + 3 * p.melds + p.discards.length;
    return n;
  }

  function snapshot(state) {
    return {
      wallLeft: state.wallLeft,
      discards: state.players.map(function (p) { return p.discards.slice(); }),
      melds: state.players.map(function (p) { return p.melds; }),
      meldTiles: state.players.map(function (p) { return p.meldTiles.slice(); }),
      declared: state.players.map(function (p) { return p.declared; }),
      waits: state.players.map(function (p) {
        return p.waits ? p.waits.map(function (w) { return KD.tileName(w.tile); }) : null;
      }),
      handCounts: state.players.map(function (p) { return handSize(p.hand); }),
      hand: state.humanSeat >= 0 ? state.players[state.humanSeat].hand.slice() : null
    };
  }

  function say(state, seat, text) {
    state.log.push({ seat: seat, text: text, snap: snapshot(state) });
    if (state.log.length > 2000) state.log.shift();
  }

  /* ---------------- 开局 ---------------- */
  function newGame(opts) {
    opts = opts || {};
    const state = {
      humanSeat: opts.humanSeat === undefined ? -1 : opts.humanSeat,
      players: [], wall: [], wallLeft: 0, turn: 0,
      await: null, log: [], result: null, over: false
    };
    const rand = rng(opts.seed === undefined ? (Date.now() & 0x7fffffff) : opts.seed);
    const profs = opts.profiles || null;
    for (let s = 0; s < 4; s++) {
      state.players.push({
        seat: s,
        name: s === state.humanSeat ? '你' : SEATS[s] + '家',
        profile: profs ? profs[s] : 'eff',
        hand: new Array(T).fill(0),
        melds: 0, meldTiles: [], declared: false, waits: null, discards: []
      });
    }
    const wall = [];
    for (let t = 0; t < T; t++) for (let k = 0; k < 4; k++) wall.push(t);
    for (let j = wall.length - 1; j > 0; j--) {
      const r = Math.floor(rand() * (j + 1));
      const tmp = wall[j]; wall[j] = wall[r]; wall[r] = tmp;
    }
    for (let s = 0; s < 4; s++) for (let k = 0; k < 13; k++) state.players[s].hand[wall.pop()]++;
    state.wall = wall;
    state.wallLeft = wall.length;
    say(state, null, '开局：每家 13 张。' +
      (state.humanSeat >= 0 ? '你坐东家，先摸牌。' : '观战模式：四个 AI 对局。'));
    return state;
  }

  /* ---------------- 结束 / 报听 ---------------- */
  function finish(state, seat, tile, how, fromSeat) {
    state.result = { seat: seat, tile: tile, how: how, from: fromSeat };
    state.over = true;
    state.await = null;
    const p = state.players[seat];
    const pts = KD.tilePoints(tile);
    say(state, seat, how === 'tsumo'
      ? p.name + ' 自摸 ' + KD.tileName(tile) + '（' + pts + '点）—— 胡了！'
      : p.name + ' 接 ' + state.players[fromSeat].name + ' 点炮 ' + KD.tileName(tile) + '（' + pts + '点）—— 胡了！');
  }

  // 每次出牌后检查：够"可报听的听牌"就自动报听（报听才可能胡）
  function maybeDeclare(state, p) {
    if (p.declared || state.over) return;
    if (KD.shanten(p.hand, p.melds) !== 0) return;
    const waits = KD.winTiles(p.hand, p.melds);
    if (!waits.some(function (w) { return w.pts >= 6; })) return; // 死听：没法报
    p.declared = true;
    p.waits = waits.map(function (w) { return { tile: w.tile, pts: w.pts, mode: w.mode }; });
    say(state, p.seat, p.name + ' 报听（听口：' +
      waits.map(function (w) { return KD.tileName(w.tile); }).join('、') + '）');
  }

  /* ---------------- 出牌与响应 ---------------- */
  function doDiscard(state, p, tile, why) {
    p.hand[tile]--;
    p.discards.push(tile);
    say(state, p.seat, p.name + ' 打出 ' + KD.tileName(tile) + (why ? '（' + why + '）' : ''));
    afterDiscard(state, p, tile);
  }

  function afterDiscard(state, p, tile) {
    maybeDeclare(state, p);
    for (let k = 1; k <= 3; k++) { // 点炮：须已报听、且胡牌张是可点炮的点数
      const q = state.players[(p.seat + k) % 4];
      if (!q.declared) continue;
      const w = q.waits.find(function (x) { return x.tile === tile; });
      if (w && w.mode === 'ron') { finish(state, q.seat, tile, 'ron', p.seat); return; }
    }
    resolvePon(state, p, 1);
  }

  function resolvePon(state, discarder, k) {
    if (state.over) return;
    if (k > 3) { nextTurn(state, discarder.seat); return; }
    const q = state.players[(discarder.seat + k) % 4];
    const tile = discarder.discards[discarder.discards.length - 1];
    if (q.declared || q.hand[tile] < 2) { resolvePon(state, discarder, k + 1); return; }
    if (q.seat === state.humanSeat) {
      state.await = { kind: 'pon', seat: q.seat, tile: tile, discarder: discarder.seat, k: k };
      return;
    }
    if (aiPong(state, q, tile)) applyPon(state, q, discarder, tile);
    else resolvePon(state, discarder, k + 1);
  }

  // AI 碰的规则：碰后向听数变好才碰；碰成死听不碰；碰成和牌形（只能再拆）不碰
  function aiPong(state, q, tile) {
    const sNow = KD.shanten(q.hand, q.melds);
    const h2 = q.hand.slice(); h2[tile] -= 2;
    const sPon = KD.shanten(h2, q.melds + 1);
    if (sPon < 0 || sPon >= sNow) return false;
    if (sPon === 0) {
      const r = KD.recommend(h2, q.melds + 1);
      const top = r.discards && r.discards[0];
      if (!top || top.shanten !== 0 || !top.canDeclare) return false;
    }
    return true;
  }

  function applyPon(state, q, discarder, tile) {
    discarder.discards.pop();
    q.hand[tile] -= 2;
    q.melds++;
    q.meldTiles.push(tile);
    say(state, q.seat, q.name + ' 碰 ' + discarder.name + ' 的 ' + KD.tileName(tile));
    state.turn = q.seat;
    if (q.seat === state.humanSeat) {
      state.await = { kind: 'discard', seat: q.seat, drawn: null, fromPon: true };
      return;
    }
    aiDiscard(state, q);
  }

  function nextTurn(state, fromSeat) {
    if (state.over) return;
    state.turn = (fromSeat + 1) % 4;
    beginTurn(state);
  }

  // 危险张：已报听玩家的"可点炮"听口（报听在扣点里是公开信息；3~5 点听口只能自摸，打出去不点炮）
  function dangerSet(state, excludeSeat) {
    const d = new Array(T).fill(false);
    for (let q = 0; q < 4; q++) {
      const pl = state.players[q];
      if (q === excludeSeat || !pl.declared || !pl.waits) continue;
      for (const w of pl.waits) {
        if (w.mode !== 'ron') continue;
        d[w.tile] = d[w.tile] ? d[w.tile] + '、' + pl.name : pl.name;
      }
    }
    return d;
  }

  function aiDiscard(state, p) {
    const r = KD.recommend(p.hand, p.melds);
    if (r.error) { // 理论到不了；保底随机打一张，避免卡死
      for (let i = 0; i < T; i++) if (p.hand[i] > 0) { doDiscard(state, p, i, '保底出牌'); return; }
      return;
    }
    let top = r.discards[0];
    let dodged = false;
    if (p.profile === 'def' || p.profile === 'bal') { // 防守：避开已报听玩家的点炮听口
      const danger = dangerSet(state, p.seat);
      if (danger[top.tile]) {
        const limit = p.profile === 'def' ? top.tier + 1 : top.tier; // 防守型最多降一档
        for (let i = 1; i < r.discards.length; i++) {
          const c = r.discards[i];
          if (!danger[c.tile] && c.tier <= limit) { top = c; dodged = true; break; }
        }
      }
    }
    let why;
    if (top.shanten === 0 && top.canDeclare) {
      why = '直接听牌，听 ' + top.waits.map(function (w) { return KD.tileName(w.tile); }).join('、');
    } else if (top.shanten === 0) {
      why = '死听形（暂时胡不了）';
    } else {
      why = top.shanten + '向听，最优进张 ' + top.effTotal + ' 张';
    }
    if (dodged) why += '，避开报听听口';
    doDiscard(state, p, top.tile, why);
  }

  /* ---------------- 摸牌 / 回合推进 ---------------- */
  function tryTsumo(state, p, drawn) {
    if (!p.declared) return false;
    const w = p.waits.find(function (x) { return x.tile === drawn; });
    if (!w || w.mode === 'dead') return false; // 1~2点胡不了；3~5点可自摸
    finish(state, p.seat, drawn, 'tsumo', p.seat);
    return true;
  }

  function beginTurn(state) {
    if (state.over) return;
    const p = state.players[state.turn];
    if (!state.wall.length) {
      state.over = true;
      state.await = null;
      state.result = { liuju: true };
      say(state, null, '牌墙摸完了 —— 流局。');
      return;
    }
    const t = state.wall.pop();
    state.wallLeft = state.wall.length;
    p.hand[t]++;
    if (tryTsumo(state, p, t)) return;
    if (p.declared) { // 报听锁手：摸啥打啥
      if (p.seat === state.humanSeat) say(state, p.seat, '你摸到 ' + KD.tileName(t) + '（已报听，摸啥打啥）');
      doDiscard(state, p, t, p.seat === state.humanSeat ? '' : '已报听，摸啥打啥');
      return;
    }
    if (p.seat === state.humanSeat) {
      say(state, p.seat, '你摸到 ' + KD.tileName(t) + '，点一张出牌');
      state.await = { kind: 'discard', seat: p.seat, drawn: t };
      return;
    }
    aiDiscard(state, p);
  }

  /* ---------------- 玩家操作 ---------------- */
  function humanDiscard(state, tile) {
    const aw = state.await;
    if (!aw || aw.kind !== 'discard') return false;
    const p = state.players[aw.seat];
    if (p.seat !== state.humanSeat || !(p.hand[tile] > 0)) return false;
    state.await = null;
    doDiscard(state, p, tile, '');
    return true;
  }

  function humanPong(state, yes) {
    const aw = state.await;
    if (!aw || aw.kind !== 'pon') return false;
    state.await = null;
    const q = state.players[aw.seat];
    const discarder = state.players[aw.discarder];
    if (yes) applyPon(state, q, discarder, aw.tile);
    else resolvePon(state, discarder, aw.k + 1);
    return true;
  }

  /* 推进到下一个需要等待的状态（玩家操作或结束）。一局全 AI 时可一次推完。 */
  function pump(state) {
    if (state.over || state.await) return state;
    beginTurn(state);
    return state;
  }

  return {
    newGame: newGame,
    pump: pump,
    humanDiscard: humanDiscard,
    humanPong: humanPong,
    tally: tally,
    snapshot: snapshot,
    dangerSet: dangerSet,
    handSize: handSize
  };
});
