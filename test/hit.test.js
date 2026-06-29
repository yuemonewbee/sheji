// 命中、伤害、出生保护、友军免伤
const { describe, test, assert } = require('./harness');
const { game, makeWorld, fighter, killVia, captureEvents } = require('./helpers');

describe('命中与伤害');

test('子弹命中敌人扣血并记有效伤害', function () {
  const w = makeWorld();
  const G = fighter(w, 'G'), R = fighter(w, 'R');
  G.weapon = 'smg'; G.ammo = 99; G.invuln = 0;
  R.x = G.x + 36; R.y = G.y; R.invuln = 0; R.hp = 100;
  G.fireCooldown = 0; G.angle = 0;
  game.updateWorld(w, { G: { aimX: R.x, aimY: R.y, shoot: true } });
  assert.ok(R.hp < 100, '红队应被扣血');
  assert.ok(G.damage > 0, '绿队应记录有效伤害');
});

test('出生保护期内不被子弹命中', function () {
  const w = makeWorld();
  const G = fighter(w, 'G'), R = fighter(w, 'R');
  G.weapon = 'smg'; G.ammo = 99; G.invuln = 0;
  for (let i = 0; i < 20; i++) {
    R.x = G.x + 36; R.y = G.y; R.invuln = 99; R.hp = 100; R.fireCooldown = 999; // 不开火→保护不解除
    G.fireCooldown = 0; G.invuln = 0; G.angle = 0;
    game.updateWorld(w, { G: { aimX: R.x, aimY: R.y, shoot: true } });
    w.soundEvents = [];
  }
  assert.equal(R.hp, 100, '无敌的红队不应掉血');
});

test('开火即解除自己的出生保护', function () {
  const w = makeWorld();
  const G = fighter(w, 'G');
  G.invuln = 99; G.weapon = 'smg'; G.ammo = 99; G.fireCooldown = 0;
  game.updateWorld(w, { G: { aimX: G.x + 50, aimY: G.y, shoot: true } });
  assert.equal(G.invuln, 0, '开火后 invuln 应清零');
});

test('友军子弹不命中队友', function () {
  const w = makeWorld({ teamGreen: 2, teamRed: 1,
    humans: [{ id: 'G1', team: 'green' }, { id: 'G2', team: 'green' }, { id: 'R', team: 'red' }] });
  const G1 = fighter(w, 'G1'), G2 = fighter(w, 'G2');
  G1.weapon = 'smg'; G1.ammo = 99; G1.invuln = 0;
  for (let i = 0; i < 15; i++) {
    G2.x = G1.x + 36; G2.y = G1.y; G2.invuln = 0; G2.hp = 100;
    G1.fireCooldown = 0; G1.invuln = 0; G1.angle = 0;
    game.updateWorld(w, { G1: { aimX: G2.x, aimY: G2.y, shoot: true } });
    w.soundEvents = [];
  }
  assert.equal(G2.hp, 100, '队友不应被打到');
});

test('击杀产生 death 事件且记 deaths/kills', function () {
  const w = makeWorld();
  const ev = [];
  const G = fighter(w, 'G'), R = fighter(w, 'R');
  G.weapon = 'sniper'; G.ammo = 99;
  for (let i = 0; i < 25 && R.alive; i++) {
    R.x = G.x + 36; R.y = G.y; R.hp = 100; R.invuln = 0;
    G.fireCooldown = 0; G.invuln = 0; G.angle = 0;
    const got = captureEvents(w, { G: { aimX: R.x, aimY: R.y, shoot: true } });
    for (const e of got) ev.push(e);
  }
  assert.ok(!R.alive, '红队应被击杀');
  assert.ok(ev.some((e) => e.type === 'death' && e.victim === 'R' && e.by === 'G'), '应有 death 事件');
  assert.equal(G.kills, 1, '绿队 kills=1');
  assert.equal(R.deaths, 1, '红队 deaths=1');
});
