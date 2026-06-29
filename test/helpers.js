// 测试辅助：通过公开接口（createWorld/updateWorld）搭场景，用"真实游戏路径"操控。
// 关键：killVia 走真实子弹→命中→creditKill 路径，不绕过，才能抓出模式判定串味等 bug。
const game = require('../server/world');

// 建一个世界。默认放两个真人占位（G=绿、R=红）：真人不发输入就原地不动，便于精确控制。
function makeWorld(opts) {
  opts = opts || {};
  const humans = opts.humans || [{ id: 'G', team: 'green', name: 'G' }, { id: 'R', team: 'red', name: 'R' }];
  const w = game.createWorld({
    mapIndex: opts.mapIndex || 0,
    teamGreen: opts.teamGreen || 1,
    teamRed: opts.teamRed || 1,
    mode: opts.mode,
    randomSize: opts.randomSize,
    humans: humans,
  });
  w.countdown = 0; // 跳过开局倒计时，直接可操作
  return w;
}

function fighter(w, id) { return w.fighters.find((f) => f.id === id); }

// 用"真实子弹路径"让 killer 狙杀 victim（走 updateWorld→updateBullets→killFighter→creditKill）。
// 每帧把 victim 拉到 killer 面前并清出生保护，确保稳定命中。返回是否成功击杀。
function killVia(w, killerId, victimId) {
  const killer = fighter(w, killerId), victim = fighter(w, victimId);
  killer.weapon = 'sniper'; killer.ammo = 99;
  for (let i = 0; i < 25 && victim.alive; i++) {
    victim.x = killer.x + 36; victim.y = killer.y; victim.hp = victim.maxHp; victim.invuln = 0;
    killer.fireCooldown = 0; killer.invuln = 0; killer.angle = 0;
    const inputs = {};
    inputs[killerId] = { aimX: victim.x, aimY: victim.y, shoot: true };
    game.updateWorld(w, inputs);
    w.soundEvents = [];
  }
  return !victim.alive;
}

// 收集某次 updateWorld 期间产生的 soundEvents（先清空，跑一帧/给定操作，再返回）。
function captureEvents(w, inputs) {
  w.soundEvents = [];
  game.updateWorld(w, inputs || {});
  return w.soundEvents.slice();
}

function run(w, n, inputs) { for (let i = 0; i < n; i++) { game.updateWorld(w, inputs || {}); w.soundEvents = []; } }

module.exports = { game, makeWorld, fighter, killVia, captureEvents, run };
