// 中途加入补位、roster 映射、复活点锁定、连杀
const { describe, test, assert } = require('./harness');
const { game, makeWorld, fighter, killVia, captureEvents, run } = require('./helpers');

describe('补位与名册');
test('assignJoiner 顶替电脑（不增人数）', function () {
  const w = makeWorld({ teamGreen: 2, teamRed: 2, humans: [] }); // 全电脑 2v2
  const before = w.fighters.length;
  const f = game.assignJoiner(w, 'newp', '新人');
  assert.equal(w.fighters.length, before, '有电脑位时顶替，不增人数');
  assert.equal(f.controller, 'human', '变成真人');
  assert.equal(f.id, 'newp', 'id 被认领');
});
test('assignJoiner 无电脑位时新增单位且分配 nid', function () {
  const w = makeWorld({ teamGreen: 1, teamRed: 1,
    humans: [{ id: 'G', team: 'green' }, { id: 'R', team: 'red' }] }); // 全真人，无电脑
  const before = w.fighters.length;
  const f = game.assignJoiner(w, 'newp', '新人');
  assert.equal(w.fighters.length, before + 1, '无电脑位则新增');
  assert.ok(f.nid > 0, '分配了 nid');
  assert.ok(w.fighters.every((x, i, a) => a.findIndex((y) => y.nid === x.nid) === i), 'nid 不重复');
});
test('roster 映射含每个单位的 nid/id/team', function () {
  const w = makeWorld({ teamGreen: 2, teamRed: 2, humans: [] });
  const ros = game.roster(w);
  assert.equal(ros.length, w.fighters.length, 'roster 覆盖所有单位');
  for (const r of ros) { assert.ok(r.nid > 0); assert.ok(r.id); assert.ok(r.team); }
});

describe('复活点锁定（私密预览）');
test('死亡瞬间锁定复活点，复活落点=预览点，且不进广播快照', function () {
  const w = makeWorld();
  killVia(w, 'G', 'R');
  const R = fighter(w, 'R');
  assert.ok(R.respawnX != null && R.respawnY != null, '死亡时记录了复活点');
  const assigns = game.respawnAssignments(w);
  assert.ok(assigns.some((a) => a.id === 'R'), '上报了 R 的复活点');
  const lockX = R.respawnX, lockY = R.respawnY;
  // 复活点不在广播快照里（保密）
  const sj = JSON.stringify(game.snapshot(w));
  assert.notOk(sj.indexOf('respawnX') >= 0, '复活点不应出现在广播快照');
  // 让 R 复活
  for (let i = 0; i < 200 && !R.alive; i++) run(w, 1);
  assert.ok(R.alive, 'R 已复活');
  assert.near(R.x, lockX, 1, '复活 x = 预览点');
  assert.near(R.y, lockY, 1, '复活 y = 预览点');
});

describe('连杀 multikill');
test('窗口内连杀累加、发事件、阵亡清零', function () {
  const w = makeWorld({ teamGreen: 1, teamRed: 3,
    humans: [{ id: 'G', team: 'green' }, { id: 'R1', team: 'red' }, { id: 'R2', team: 'red' }, { id: 'R3', team: 'red' }] });
  const G = fighter(w, 'G');
  killVia(w, 'G', 'R1');
  assert.equal(G.streak, 1, '第1杀 streak=1');
  // 第2杀（窗口内）应发 multikill
  let events = [];
  const R2 = fighter(w, 'R2');
  G.weapon = 'sniper'; G.ammo = 99;
  for (let i = 0; i < 25 && R2.alive; i++) {
    R2.x = G.x + 36; R2.y = G.y; R2.hp = 100; R2.invuln = 0;
    G.fireCooldown = 0; G.invuln = 0; G.angle = 0;
    events = events.concat(captureEvents(w, { G: { aimX: R2.x, aimY: R2.y, shoot: true } }));
  }
  assert.equal(G.streak, 2, '第2杀 streak=2');
  assert.ok(events.some((e) => e.type === 'multikill' && e.who === 'G' && e.n === 2), '发出 multikill n=2');
  // 阵亡清零
  G.streakTimer = 100; killVia(w, 'R3', 'G');
  assert.equal(G.streak, 0, '阵亡后 streak 清零');
});
test('连杀窗口超时清零', function () {
  const w = makeWorld();
  const G = fighter(w, 'G');
  killVia(w, 'G', 'R');
  G.streakTimer = 1;
  run(w, 1);
  assert.equal(G.streak, 0, '窗口超时 streak 清零');
});
