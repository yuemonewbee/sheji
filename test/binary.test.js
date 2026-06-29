// 二进制快照 ↔ JSON 快照 字段一致（加字段最容易破坏的协议层）
const { describe, test, assert } = require('./harness');
const { game, makeWorld, fighter, run } = require('./helpers');
const { decodeState } = require('../public/js/decode.js');

function rbnOf(w) { const m = {}; for (const r of game.roster(w)) m[r.nid] = r; return m; }

describe('二进制快照往返');

test('单位字段（hp/alive/inv/kills/deaths/w/am/streak）一致', function () {
  const w = makeWorld({ mode: 'tdm', teamGreen: 2, teamRed: 2, humans: [] });
  const rbn = rbnOf(w);
  let mismatch = 0;
  for (let t = 0; t < 300; t++) {
    run(w, 1);
    const j = game.snapshot(w);
    const d = decodeState(game.snapshotBinary(w), rbn);
    for (let i = 0; i < j.fighters.length; i++) {
      const a = j.fighters[i], b = d.fighters.find((x) => x.id === a.id);
      if (!b) { mismatch++; continue; }
      if (a.hp !== b.hp || a.alive !== b.alive || (a.inv || 0) !== (b.inv || 0)) mismatch++;
      if (a.kills !== b.kills || a.deaths !== b.deaths || a.w !== b.w) mismatch++;
      if (a.am !== b.am || (a.streak || 0) !== (b.streak || 0)) mismatch++;
    }
  }
  assert.equal(mismatch, 0, '单位字段往返应全一致');
});

test('子弹 team+武器、坐标一致', function () {
  const w = makeWorld({ mode: 'tdm', teamGreen: 3, teamRed: 3, humans: [] });
  const rbn = rbnOf(w);
  let mismatch = 0, sawBullets = false;
  for (let t = 0; t < 600; t++) {
    run(w, 1);
    const j = game.snapshot(w);
    const d = decodeState(game.snapshotBinary(w), rbn);
    for (let i = 0; i < d.bullets.length; i++) {
      sawBullets = true;
      const code = j.bullets[i * 3 + 2];
      const jteam = (code & 0x10) ? 'red' : 'green';
      if (d.bullets[i].team !== jteam || d.bullets[i].w !== (code & 0x0f)) mismatch++;
      if (d.bullets[i].x !== j.bullets[i * 3] || d.bullets[i].y !== j.bullets[i * 3 + 1]) mismatch++;
    }
  }
  assert.ok(sawBullets, '应出现过子弹');
  assert.equal(mismatch, 0, '子弹字段往返一致');
});

test('头部状态（gameOver/winner/countdown/teamScore/round）一致', function () {
  const w = makeWorld({ mode: 'lastman' });
  const rbn = rbnOf(w);
  // 制造一个回合结算状态
  fighter(w, 'R').alive = false; fighter(w, 'R').hp = 0;
  run(w, 1);
  const j = game.snapshot(w);
  const d = decodeState(game.snapshotBinary(w), rbn);
  assert.equal(d.teamScore.green, j.teamScore.green, '绿队分一致');
  assert.equal(d.teamScore.red, j.teamScore.red, '红队分一致');
  assert.equal(d.countdown, j.countdown, 'countdown 一致');
  assert.equal(!!d.gameOver, !!j.gameOver, 'gameOver 一致');
  assert.equal(d.roundWinner, j.roundWinner, 'roundWinner 一致');
  assert.equal(d.roundOver === 1, (j.roundOver || 0) > 0, 'roundOver 标志一致');
});

test('夺旗的旗状态（位置/state/carrier）一致', function () {
  const w = makeWorld({ mode: 'ctf' });
  const rbn = rbnOf(w);
  // 让绿队扛起红旗，制造非 home 状态
  const G = fighter(w, 'G');
  G.x = w.flags.red.homeX; G.y = w.flags.red.homeY; run(w, 1);
  const j = game.snapshot(w);
  const d = decodeState(game.snapshotBinary(w), rbn);
  assert.equal(d.flags.length, 2, '两面旗');
  for (let i = 0; i < 2; i++) {
    assert.equal(d.flags[i].x, j.flags[i].x, '旗 x 一致');
    assert.equal(d.flags[i].state, j.flags[i].state, '旗 state 一致');
  }
});
