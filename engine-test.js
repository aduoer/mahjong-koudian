/* 引擎自检：node engine-test.js */
const KD = require('./engine.js');

const r = KD.selfTest();
for (const c of r.cases) {
  console.log((c.ok ? 'PASS' : 'FAIL') + ' | ' + c.label + ' | ' + c.info);
}
console.log('---- ' + r.passed + '/' + r.total + ' passed');

const demo = KD.recommend(KD.parseNotation('123456789m 234p 55s').counts, 0);
console.log('');
console.log('示例：123456789m 234p 55s 的推荐前5');
demo.discards.slice(0, 5).forEach((d, i) => {
  let extra = '';
  if (d.shanten === 0) {
    extra = d.canDeclare
      ? '  听口: ' + d.waits.map(w => KD.tileName(w.tile) + '(' + w.pts + '点/' + w.mode + ')').join(' ')
      : '  死听';
  }
  console.log('  #' + (i + 1) + ' 打' + KD.tileName(d.tile) +
    '  向听' + d.shanten + '  进张' + d.effTotal + extra);
});

process.exit(r.passed === r.total ? 0 : 1);
