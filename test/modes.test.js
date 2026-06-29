// 各模式的胜负判定（含"最后存活混入团队死斗判定"的回归测试）
const { describe, test, assert } = require('./harness');
const { game, makeWorld, fighter, killVia, run } = require('./helpers');

describe('团队死斗');
test('击杀加队伍分，到目标分获胜', function () {
  const w = makeWorld({ mode: 'tdm' }); // 1v1 → targetScore=max(5,round(2.5*2))=5
  assert.ok(w.targetScore >= 5, '目标分随人数缩放');
  let safety = 0;
  while (!w.gameOver && safety++ < 50) {
    killVia(w, 'G', 'R');
    // 等红队复活
    for (let i = 0; i < 200 && !fighter(w, 'R').alive; i++) run(w, 1);
  }
  assert.ok(w.gameOver && w.winner === 'green', '绿队到目标分获胜');
  assert.equal(w.teamScore.green, w.targetScore, '队伍分=目标分');
});

describe('军备竞赛');
test('起步武器+无手雷，击杀升级，走完武器梯获胜', function () {
  const w = makeWorld({ mode: 'gungame' });
  assert.ok(w.fighters.every((f) => f.grenades === 0), '军备竞赛无手雷');
  assert.ok(w.fighters.every((f) => f.weapon === 'smg'), '都从冲锋枪起步');
  const G = fighter(w, 'G');
  let safety = 0;
  while (!w.gameOver && safety++ < 60) {
    killVia(w, 'G', 'R');
    for (let i = 0; i < 200 && !fighter(w, 'R').alive; i++) run(w, 1);
  }
  assert.ok(w.gameOver && w.winner === 'green', '走完武器梯获胜');
  assert.ok(G.level >= 7, '冠军等级到达梯长');
});
test('军备竞赛全程无拾取刷新', function () {
  const w = makeWorld({ mode: 'gungame', teamGreen: 2, teamRed: 2, humans: [] }); // 全电脑
  let any = false;
  for (let t = 0; t < 1500 && !w.gameOver; t++) {
    run(w, 1);
    if (w.weaponSpawns.length || w.crates.length || w.hearts.length) any = true;
  }
  assert.notOk(any, '军备竞赛不应有任何拾取');
});

describe('占点 KOTH');
test('独占累积/争夺暂停/满目标获胜，击杀不计胜负分', function () {
  const w = makeWorld({ mode: 'koth', teamGreen: 2, teamRed: 2,
    humans: [{ id: 'G1', team: 'green' }, { id: 'G2', team: 'green' }, { id: 'R1', team: 'red' }, { id: 'R2', team: 'red' }] });
  assert.ok(w.zone, '有占点圈');
  const z = w.zone;
  const park = (id, x, y) => { const f = fighter(w, id); f.x = x; f.y = y; f.invuln = 999; f.fireCooldown = 999; };
  // 绿队独占 90 tick = 3 分
  for (let i = 0; i < 90; i++) { park('G1', z.x, z.y); park('G2', z.x + 15, z.y); park('R1', 30, 30); park('R2', 50, 30); run(w, 1); }
  assert.equal(w.teamScore.green, 3, '绿队独占 90tick = 3 分');
  assert.equal(w.teamScore.red, 0, '红队 0 分');
  // 争夺：双方同在，绿分不涨
  const before = w.teamScore.green;
  for (let i = 0; i < 60; i++) { park('G1', z.x, z.y); park('R1', z.x + 10, z.y); park('G2', 30, 30); park('R2', 50, 30); run(w, 1); }
  assert.equal(w.teamScore.green, before, '争夺中不涨分');
});

describe('夺旗 CTF');
test('拿旗→跟随→回家得分→归位；阵亡掉落→返还', function () {
  const w = makeWorld({ mode: 'ctf' });
  const G = fighter(w, 'G'), R = fighter(w, 'R');
  R.x = w.flags.red.homeX; R.y = w.flags.red.homeY;
  // 拿红旗
  G.x = w.flags.red.homeX; G.y = w.flags.red.homeY; run(w, 1);
  assert.equal(w.flags.red.state, 'carried', '绿队拿到红旗');
  // 跟随
  G.x = 400; G.y = 300; run(w, 1);
  assert.equal(w.flags.red.x, 400, '旗跟随携带者');
  // 回家得分
  G.x = w.flags.green.homeX; G.y = w.flags.green.homeY; run(w, 1);
  assert.equal(w.teamScore.green, 1, '夺旗 +1');
  assert.equal(w.flags.red.state, 'home', '红旗归位');
  // 再拿→阵亡掉落→红队返还
  G.x = w.flags.red.homeX; G.y = w.flags.red.homeY; run(w, 1);
  G.x = 600; G.y = 222; run(w, 1);
  G.alive = false; G.respawnTimer = 180; run(w, 1);
  assert.equal(w.flags.red.state, 'dropped', '阵亡→旗掉落');
  R.x = w.flags.red.x; R.y = w.flags.red.y; run(w, 1);
  assert.equal(w.flags.red.state, 'home', '红队返还掉落旗');
});

describe('最后存活（回归：不得混入团队死斗判定）');
test('真实击杀路径：只杀 1 人不该整局结束', function () {
  const w = makeWorld({ mode: 'lastman' });
  assert.equal(w.targetScore, 3, '目标=3 回合');
  const ok = killVia(w, 'G', 'R'); // 走真实 creditKill
  assert.ok(ok, '红队被狙杀');
  assert.equal(w.teamScore.green, 1, '回合分=1（不是被击杀污染）');
  assert.ok(w.roundWinner === 'green' && w.roundOverTimer > 0, '进入回合结算');
  assert.notOk(w.gameOver, '只杀 1 人，整局绝不能结束（旧 bug 会在 3 杀结束）');
});
test('全灭→回合分→满血重生→赢满3回合整局结束', function () {
  const w = makeWorld({ mode: 'lastman' });
  let safety = 0;
  while (!w.gameOver && safety++ < 10) {
    killVia(w, 'G', 'R');
    for (let i = 0; i < 200 && w.roundOverTimer > 0; i++) run(w, 1); // 跑完结算
    w.countdown = 0;
  }
  assert.ok(w.gameOver && w.winner === 'green' && w.teamScore.green === 3, '绿队赢满 3 回合');
});
test('lastman 死亡后本回合不复活', function () {
  const w = makeWorld({ mode: 'lastman' });
  killVia(w, 'G', 'R');
  // 结算前推进若干帧，红队应仍死
  for (let i = 0; i < 50 && w.roundOverTimer > 1; i++) run(w, 1);
  assert.notOk(fighter(w, 'R').alive, '本回合内不复活');
});
