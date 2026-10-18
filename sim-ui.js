/* 对战页 UI（本地人机/观战）—— 依赖 window.KD（engine.js）与 window.SIM（sim.js）
 * 页面只做展示与转发：对局推演在 sim.js，牌理计算在 engine.js。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var NAMES = ['东', '南', '西', '北'];
  var PROFILE = { eff: '牌效型', def: '防守型', bal: '平衡型' };
  var sim = null, replayIdx = 0, timer = null, speed = 650;
  var hintHtml = '', hintFor = null;
  var stat = { games: 0, win: 0, deal: 0, liuju: 0, pf: { eff: { win: 0, deal: 0 }, def: { win: 0, deal: 0 }, bal: { win: 0, deal: 0 } } };

  function suitOf(i) { return i < 27 ? 'mps'[(i / 9) | 0] : 'z'; }
  function tileSmall(i) { return '<span class="tile ' + suitOf(i) + '">' + KD.tileName(i) + '</span>'; }
  function handChips(counts, interactive, danger) {
    var h = '';
    for (var i = 0; i < 34; i++) {
      for (var k = 0; k < counts[i]; k++) {
        var dg = danger && danger[i];
        h += '<span class="chip ' + suitOf(i) + (interactive ? ' pickable' : '') + (dg ? ' danger' : '') +
          '" data-t="' + i + '" title="' + (dg ? '⚠ ' + dg + ' 报听听这口，打了就点炮' : interactive ? '点它 = 打出这张' : '') + '">' +
          KD.tileName(i) + '</span>';
      }
    }
    return h;
  }

  function statusOf(d) { // recommend 的候选 → 一句话
    if (d.shanten === 0) {
      return d.canDeclare
        ? '直接听牌，听 ' + d.waits.map(function (w) { return KD.tileName(w.tile); }).join('、')
        : '死听形（暂时胡不了）';
    }
    return d.shanten + '向听，进张 ' + d.effTotal + ' 张';
  }
  function statusText(state, seat) { // 某家当前（13 等价钱）牌情
    var p = state.players[seat];
    var s = KD.shanten(p.hand, p.melds);
    if (s === 0) {
      var w = KD.winTiles(p.hand, p.melds);
      return w.some(function (x) { return x.pts >= 6; })
        ? '已听牌（听 ' + w.map(function (x) { return KD.tileName(x.tile); }).join('、') + '）'
        : '死听（暂时胡不了）';
    }
    var e = KD.effectiveTiles(p.hand, p.melds);
    return s + '向听（有效进张 ' + e.total + ' 张）';
  }
  function ponPreview(state, aw) { // 碰 vs 不碰 的简要比对
    var p = state.players[aw.seat];
    var keep = '不碰：' + statusText(state, aw.seat);
    var h2 = p.hand.slice(); h2[aw.tile] -= 2;
    var r = KD.recommend(h2, p.melds + 1);
    var top = r.discards && r.discards[0];
    return keep + ' ｜ 碰后打 ' + (top ? KD.tileName(top.tile) + '：' + statusOf(top) : '—');
  }

  /* ---------- 渲染 ---------- */
  function caught() { return sim && replayIdx >= sim.log.length; }

  function playerRow(state, view, s, interactive, danger) {
    var isYou = s === state.humanSeat;
    var p = state.players[s];
    var h = '<div class="prow' + (isYou ? ' you' : '') + '">';
    h += '<div class="plabel">' + (isYou ? '你（' + NAMES[s] + '家）'
      : p.name + (PROFILE[p.profile] ? '·' + PROFILE[p.profile] : '')) +
      (view.declared[s] ? ' <span class="badge">报听</span>' : '') + '</div>';
    h += '<div class="small">手牌 ' + view.handCounts[s] + ' 张';
    if (view.melds[s]) h += ' · 碰 ' + view.meldTiles[s].map(function (t) { return KD.tileName(t); }).join('、');
    if (view.declared[s] && view.waits[s]) h += ' · 听 ' + view.waits[s].join('、');
    h += '</div>';
    if (isYou && view.hand) h += '<div class="hand">' + handChips(view.hand, interactive, danger) + '</div>';
    h += '<div class="river">' + (view.discards[s].length
      ? view.discards[s].map(tileSmall).join('')
      : '<span class="small">河：空</span>') + '</div>';
    return h + '</div>';
  }

  function renderInner() {
    var at = Math.min(replayIdx, sim.log.length);
    var view = at > 0 && sim.log.length ? sim.log[at - 1].snap : SIM.snapshot(sim);
    var isCaught = caught();
    var aw = isCaught && !sim.over ? sim.await : null;
    var interactive = !!(aw && aw.kind === 'discard');
    var danger = isCaught && !sim.over && sim.humanSeat >= 0 ? SIM.dangerSet(sim, sim.humanSeat) : null;
    var who = [];
    if (danger) {
      for (var di = 0; di < 34; di++) {
        if (!danger[di]) continue;
        danger[di].split('、').forEach(function (n) { if (who.indexOf(n) < 0) who.push(n); });
      }
    }
    var h = '<div class="card"><div class="small">牌墙剩余 <b>' + view.wallLeft + '</b> 张 ｜ ' +
      (sim.over ? '本局结束' : interactive ? '轮到你出牌' : aw ? '等你决定是否碰' : '对局进行中…') + '</div>';

    for (var s = 0; s < 4; s++) h += playerRow(sim, view, s, interactive, danger);
    h += '</div>';

    if (interactive) {
      h += '<div class="prompt"><b>轮到你了</b>：点你手牌里想打的那张。' +
        '<button class="ghost" id="simHintBtn" style="margin-left:8px">看看提示</button>' +
        (who.length ? '<div class="small warn">注意：' + who.join('、') + ' 已报听——红框的牌是他们的听口，打出去就点炮。</div>' : '') +
        (hintHtml ? '<div>' + hintHtml + '</div>' : '') + '</div>';
    }
    if (aw && aw.kind === 'pon') {
      h += '<div class="prompt"><b>' + sim.players[aw.discarder].name + ' 打出 ' + KD.tileName(aw.tile) +
        '</b>，你手里有 ' + (view.hand ? view.hand[aw.tile] : 0) + ' 张。' +
        '<div class="small">' + ponPreview(sim, aw) + '</div>' +
        '<div class="btnrow"><button class="ghost" id="simPonYes">碰</button><button class="ghost" id="simPonNo">过</button></div></div>';
    }

    var lines = sim.log.slice(0, at).slice(-12);
    h += '<div class="logbox" id="simLog">' + lines.map(function (x) {
      return '<div class="logline">' + x.text + '</div>';
    }).join('') + '</div>';

    if (isCaught && sim.over) h += resultHtml();
    $('simBoard').innerHTML = h;
    $('simStat').textContent = statText();
    bind();
    var lb = $('simLog');
    if (lb) lb.scrollTop = lb.scrollHeight;
  }

  function resultHtml() {
    var res = sim.result || {};
    if (!sim._counted) { // 每局只统计一次
      sim._counted = true;
      stat.games++;
      if (res.liuju) stat.liuju++;
      else {
        if (sim.humanSeat >= 0 && res.seat === sim.humanSeat) stat.win++;
        if (sim.humanSeat >= 0 && res.how === 'ron' && res.from === sim.humanSeat) stat.deal++;
        var wp = sim.players[res.seat].profile;
        if (wp && stat.pf[wp]) stat.pf[wp].win++;
        if (res.how === 'ron') {
          var dp = sim.players[res.from].profile;
          if (dp && stat.pf[dp]) stat.pf[dp].deal++;
        }
      }
    }
    var title = res.liuju
      ? '流局（牌墙摸完）'
      : sim.players[res.seat].name + (res.how === 'tsumo' ? ' 自摸 ' : ' 接点炮 ') + KD.tileName(res.tile) + '（' + KD.tilePoints(res.tile) + '点）—— 胡了！';
    var h = '<div class="rescard best"><h3>' + title + '</h3>';
    for (var s = 0; s < 4; s++) {
      var p = sim.players[s];
      var txt = KD.formatHand(p.hand);
      if (!res.liuju && res.seat === s && res.how === 'ron') txt += ' + ' + KD.tileName(res.tile);
      h += '<div class="small"><b>' + p.name + '</b>：' + txt + (p.declared ? '（报听）' : '') + '</div>';
    }
    return h + '<div class="btnrow"><button class="primary" id="simAgain">再来一局</button></div></div>';
  }

  function statText() {
    if (!stat.games) return '';
    var base = sim && sim.humanSeat >= 0
      ? '本次对局 ' + stat.games + ' 局 · 你胡 ' + stat.win + ' · 你点炮 ' + stat.deal + ' · 流局 ' + stat.liuju
      : '本次观战 ' + stat.games + ' 局 · 流局 ' + stat.liuju;
    var anyPf = stat.pf.eff.win + stat.pf.def.win + stat.pf.bal.win +
      stat.pf.eff.deal + stat.pf.def.deal + stat.pf.bal.deal;
    if (anyPf) {
      base += ' ｜ 风格战绩：牌效 ' + stat.pf.eff.win + '胡' + stat.pf.eff.deal + '炮 · 防守 ' +
        stat.pf.def.win + '胡' + stat.pf.def.deal + '炮 · 平衡 ' + stat.pf.bal.win + '胡' + stat.pf.bal.deal + '炮';
    }
    return base;
  }

  function bind() {
    var board = $('simBoard');
    board.querySelectorAll('.chip.pickable').forEach(function (c) {
      c.onclick = function () {
        if (!(caught() && sim.await && sim.await.kind === 'discard')) return;
        if (!SIM.humanDiscard(sim, +c.getAttribute('data-t'))) return;
        hintHtml = ''; hintFor = null;
        render();
      };
    });
    var hb = $('simHintBtn');
    if (hb) hb.onclick = function () {
      var aw = sim.await;
      if (!aw || aw.kind !== 'discard' || hintFor === aw) return;
      hintFor = aw;
      var p = sim.players[aw.seat];
      var r = KD.recommend(p.hand, p.melds);
      hintHtml = r.error ? '<span class="warn">' + r.error + '</span>'
        : '<div class="small">' + r.discards.slice(0, 3).map(function (d) {
            return '打 <b>' + KD.tileName(d.tile) + '</b> — ' + statusOf(d);
          }).join('<br>') + '<br>（AI 对手也会选第一名）</div>';
      render();
    };
    var py = $('simPonYes');
    if (py) py.onclick = function () { SIM.humanPong(sim, true); hintHtml = ''; hintFor = null; render(); };
    var pn = $('simPonNo');
    if (pn) pn.onclick = function () { SIM.humanPong(sim, false); hintHtml = ''; hintFor = null; render(); };
    var ag = $('simAgain');
    if (ag) ag.onclick = newGame;
  }

  function render() {
    if (!sim) return;
    try { renderInner(); } catch (e) {
      $('simBoard').innerHTML = '<p class="warn">对战渲染出错：' + e.message + '</p>';
      if (window.console && console.error) console.error(e);
    }
  }

  /* ---------- 对局驱动 ---------- */
  function newGame() {
    var watch = $('simMode').value === 'watch';
    sim = SIM.newGame({ humanSeat: watch ? -1 : 0, profiles: watch ? ['eff', 'def', 'bal', 'eff'] : ['eff', 'eff', 'def', 'bal'] });
    SIM.pump(sim);
    replayIdx = Math.min(1, sim.log.length);
    hintHtml = ''; hintFor = null;
    render();
  }

  function tick() {
    if (!sim) return;
    if (replayIdx < sim.log.length) { replayIdx++; render(); }
  }
  function setSpeed(fast) {
    speed = fast ? 180 : 650;
    $('simSpeed').textContent = fast ? '速度：快' : '速度：正常';
    if (timer) clearInterval(timer);
    timer = setInterval(tick, speed);
  }

  /* ---------- 连跑 20 局（比较各风格 AI 的长期战绩） ---------- */
  function runBatch() {
    var btn = $('simBatchBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    var out = { eff: { win: 0, deal: 0 }, def: { win: 0, deal: 0 }, bal: { win: 0, deal: 0 }, liuju: 0 };
    var profSeats = ['eff', 'def', 'bal', 'eff'];
    var left = 20;
    function step() {
      if (left <= 0) {
        $('simBatch').innerHTML = '连跑 20 局：牌效型(东/北) 胡 ' + out.eff.win + '·点炮 ' + out.eff.deal +
          ' ｜ 防守型(南) 胡 ' + out.def.win + '·点炮 ' + out.def.deal +
          ' ｜ 平衡型(西) 胡 ' + out.bal.win + '·点炮 ' + out.bal.deal + ' ｜ 流局 ' + out.liuju;
        btn.disabled = false;
        return;
      }
      var s = SIM.newGame({ humanSeat: -1, profiles: profSeats });
      SIM.pump(s);
      if (s.result.liuju) out.liuju++;
      else {
        out[profSeats[s.result.seat]].win++;
        if (s.result.how === 'ron') out[profSeats[s.result.from]].deal++;
      }
      left--;
      $('simBatch').textContent = '连跑中…还剩 ' + left + ' 局';
      setTimeout(step, 0);
    }
    step();
  }

  /* ---------- 初始化 ---------- */
  $('simNew').onclick = newGame;
  $('simSpeed').onclick = function () { setSpeed(speed !== 180); };
  $('simBatchBtn').onclick = runBatch;
  setSpeed(false);

  /* 控制台调试用：__simUI.s() 查看当前对局内部状态 */
  window.__simUI = { s: function () { return sim; } };
})();
