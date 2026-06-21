// ============================================================
//  server/world.js —— 游戏逻辑（服务器版，Node 模块）
//  由单机的 public/js/world.js 改造而来：
//   - 每个战斗单位有 controller: 'human'（真人）或 'bot'（电脑）
//   - updateWorld(world, inputs) 按"输入表"驱动每个真人
//   - 导出 createWorld / updateWorld / snapshot / 常量，供 server.js 使用
//  这一层仍然只管"算"，不碰任何网络/界面代码。
// ============================================================

// ---------- 多张预制地图 ----------
const MAPS = [
  {
    id: 'arena', name: '对称竞技场', width: 1040, height: 700,
    greenBase: { x: 90, y: 350 }, redBase: { x: 950, y: 350 },
    walls: [
      { x: 480, y: 300, w: 80, h: 100 },
      { x: 250, y: 170, w: 24, h: 150 }, { x: 766, y: 170, w: 24, h: 150 },
      { x: 250, y: 380, w: 24, h: 150 }, { x: 766, y: 380, w: 24, h: 150 },
      { x: 430, y: 120, w: 180, h: 24 }, { x: 430, y: 556, w: 180, h: 24 },
    ],
  },
  {
    id: 'cross', name: '中央十字', width: 1040, height: 700,
    greenBase: { x: 90, y: 350 }, redBase: { x: 950, y: 350 },
    walls: [
      { x: 508, y: 150, w: 24, h: 400 }, { x: 320, y: 338, w: 400, h: 24 },
      { x: 170, y: 170, w: 110, h: 24 }, { x: 760, y: 170, w: 110, h: 24 },
      { x: 170, y: 506, w: 110, h: 24 }, { x: 760, y: 506, w: 110, h: 24 },
    ],
  },
  {
    id: 'corridors', name: '走廊交错', width: 1040, height: 700,
    greenBase: { x: 90, y: 350 }, redBase: { x: 950, y: 350 },
    walls: [
      { x: 300, y: 110, w: 24, h: 320 }, { x: 520, y: 270, w: 24, h: 320 },
      { x: 740, y: 110, w: 24, h: 320 }, { x: 110, y: 470, w: 300, h: 24 },
      { x: 630, y: 230, w: 300, h: 24 },
    ],
  },
  {
    id: 'bases', name: '四角据点', width: 1040, height: 700,
    greenBase: { x: 90, y: 350 }, redBase: { x: 950, y: 350 },
    walls: [
      { x: 180, y: 150, w: 170, h: 24 }, { x: 180, y: 150, w: 24, h: 130 },
      { x: 690, y: 150, w: 170, h: 24 }, { x: 836, y: 150, w: 24, h: 130 },
      { x: 180, y: 526, w: 24, h: 130 }, { x: 180, y: 632, w: 170, h: 24 },
      { x: 836, y: 526, w: 24, h: 130 }, { x: 690, y: 632, w: 170, h: 24 },
      { x: 492, y: 326, w: 56, h: 56 },
    ],
  },
  {
    // 小图：快节奏，适合 1v1 / 2v2（左右镜像对称，中心 x=380）
    id: 'alley', name: '狭巷（小）', width: 760, height: 520,
    greenBase: { x: 64, y: 260 }, redBase: { x: 696, y: 260 },
    walls: [
      { x: 364, y: 200, w: 32, h: 120 },
      { x: 170, y: 120, w: 24, h: 130 }, { x: 566, y: 120, w: 24, h: 130 },
      { x: 170, y: 270, w: 24, h: 130 }, { x: 566, y: 270, w: 24, h: 130 },
      { x: 300, y: 96, w: 160, h: 22 }, { x: 300, y: 402, w: 160, h: 22 },
    ],
  },
  {
    // 大图：大团战，适合 4v4~6v6（中心 x=640, y=420）
    id: 'fortress', name: '环形要塞（大）', width: 1280, height: 840,
    greenBase: { x: 90, y: 420 }, redBase: { x: 1190, y: 420 },
    walls: [
      { x: 600, y: 340, w: 80, h: 160 },
      { x: 340, y: 180, w: 28, h: 180 }, { x: 912, y: 180, w: 28, h: 180 },
      { x: 340, y: 480, w: 28, h: 180 }, { x: 912, y: 480, w: 28, h: 180 },
      { x: 520, y: 150, w: 240, h: 24 }, { x: 520, y: 666, w: 240, h: 24 },
      { x: 200, y: 360, w: 24, h: 120 }, { x: 1056, y: 360, w: 24, h: 120 },
    ],
  },
  {
    // 大图：双子堡垒，适合 4v4~6v6（中心 x=700, y=440）
    id: 'twin', name: '双子堡垒（大）', width: 1400, height: 880,
    greenBase: { x: 100, y: 440 }, redBase: { x: 1300, y: 440 },
    walls: [
      // 中央双柱
      { x: 660, y: 250, w: 28, h: 160 }, { x: 712, y: 470, w: 28, h: 160 },
      // 上下横墙
      { x: 560, y: 180, w: 280, h: 24 }, { x: 560, y: 676, w: 280, h: 24 },
      // 左右内堡（对称）
      { x: 340, y: 300, w: 24, h: 280 }, { x: 1036, y: 300, w: 24, h: 280 },
      { x: 340, y: 300, w: 150, h: 24 }, { x: 910, y: 300, w: 150, h: 24 },
      { x: 340, y: 556, w: 150, h: 24 }, { x: 910, y: 556, w: 150, h: 24 },
      // 四角小掩体
      { x: 200, y: 140, w: 120, h: 24 }, { x: 1080, y: 140, w: 120, h: 24 },
      { x: 200, y: 716, w: 120, h: 24 }, { x: 1080, y: 716, w: 120, h: 24 },
    ],
  },
  {
    // 超大图：开阔战场，适合 6v6（中心 x=760, y=480）
    id: 'expanse', name: '辽阔战场（超大）', width: 1520, height: 960,
    greenBase: { x: 100, y: 480 }, redBase: { x: 1420, y: 480 },
    walls: [
      { x: 736, y: 360, w: 48, h: 240 },                                  // 中央长柱
      { x: 480, y: 220, w: 24, h: 200 }, { x: 1016, y: 220, w: 24, h: 200 },
      { x: 480, y: 540, w: 24, h: 200 }, { x: 1016, y: 540, w: 24, h: 200 },
      { x: 600, y: 200, w: 200, h: 24 }, { x: 720, y: 736, w: 200, h: 24 },
      { x: 260, y: 300, w: 160, h: 24 }, { x: 1100, y: 300, w: 160, h: 24 },
      { x: 260, y: 636, w: 160, h: 24 }, { x: 1100, y: 636, w: 160, h: 24 },
      { x: 300, y: 460, w: 24, h: 120 }, { x: 1196, y: 460, w: 24, h: 120 },
    ],
  },
  {
    // 中图：之字走廊（中心 x=520, y=350）
    id: 'zigzag', name: '之字走廊', width: 1040, height: 700,
    greenBase: { x: 90, y: 350 }, redBase: { x: 950, y: 350 },
    walls: [
      { x: 340, y: 120, w: 24, h: 200 }, { x: 676, y: 120, w: 24, h: 200 },
      { x: 340, y: 380, w: 24, h: 200 }, { x: 676, y: 380, w: 24, h: 200 },
      { x: 470, y: 120, w: 100, h: 22 }, { x: 470, y: 558, w: 100, h: 22 },
      { x: 496, y: 320, w: 48, h: 60 },
    ],
  },
  {
    // 占位：选它开局会现场生成一张全新的对称随机地图（见 generateRandomMap）
    id: 'random', name: '🎲 随机地图', width: 1040, height: 700,
    greenBase: { x: 90, y: 350 }, redBase: { x: 950, y: 350 },
    walls: [], random: true,
  },
];

// ---------- 战斗 / 手感参数 ----------
const MAX_HP = 100;
const BULLET_DAMAGE = 25;
const BULLET_SPEED = 9;
const BULLET_RADIUS = 4;
const FIRE_COOLDOWN = 12;
const RESPAWN_TIME = 180;
const SPAWN_PROTECT = 45; // 出生/复活后的无敌帧数（约 1.5 秒），开火即解除
const COUNTDOWN_TICKS = 90; // 开局冻结倒计时帧数（约 3 秒：3-2-1-GO）
const MULTIKILL_WINDOW = 135; // 连杀计时窗口（约 4.5 秒）：窗口内再杀人就累加连杀等级
// 胜利分上限随总人数缩放：人越多，目标分越高，避免一开局就秒到。
// 每名玩家约贡献 2.5 分，下限 5。这样默认 2v2(=4人) 仍是 10 分，4v4 是 20，6v6 是 30。
const TARGET_SCORE_PER_PLAYER = 2.5;
const TARGET_SCORE_MIN = 5;
function computeTargetScore(totalPlayers) {
  return Math.max(TARGET_SCORE_MIN, Math.round(TARGET_SCORE_PER_PLAYER * totalPlayers));
}

const GRENADE_MAX_RANGE = 300;
const GRENADE_COOLDOWN = 90;
const GRENADE_DAMAGE = 80;
const EXPLOSION_RADIUS = 75;
const GRENADE_FLIGHT_SPEED = 4;

const START_GRENADES = 1;
const MAX_GRENADES = 3;
const CRATE_HALF = 13;
const CRATE_MIN_GRENADES = 1;
const CRATE_MAX_GRENADES = 2;
const MAX_CRATES = 2;
const CRATE_RESPAWN_TIME = 300;

// ---------- 回血小心心参数 ----------
const HEART_HEAL = 30;          // 每个心心回多少血
const HEART_HALF = 11;          // 心心大小/拾取半径
const MAX_HEARTS = 1;           // 地图上同时最多 1 个（比箱子稀有）
const HEART_RESPAWN_TIME = 420; // 约 14 秒补刷一个

// ---------- 武器表 ----------
// idx：用于网络快照里压成一个小整数，客户端按 idx 找名字/颜色/音效。
// 手枪是默认武器、无限子弹；其余三种靠地图拾取，弹药打光自动回手枪。
const WEAPONS = {
  pistol:  { idx: 0, name: '手枪',   damage: 22, speed: 9,  cooldown: 12, pellets: 1, spread: 0,    ammo: Infinity },
  smg:     { idx: 1, name: '冲锋枪', damage: 22, speed: 10, cooldown: 4,  pellets: 1, spread: 0.08, ammo: 100 },
  shotgun: { idx: 2, name: '霰弹枪', damage: 17, speed: 8,  cooldown: 21, pellets: 7, spread: 0.26, ammo: 20 },
  sniper:  { idx: 3, name: '狙击枪', damage: 120,           speed: 18,           cooldown: 42,            pellets: 1, spread: 0,    ammo: 8 },
};
const WEAPON_KINDS = ['smg', 'shotgun', 'sniper']; // 可在地图上刷出的拾取武器
const WEAPON_HALF = 13;                            // 武器拾取物大小/拾取半径
const MAX_WEAPON_PICKUPS = 2;                      // 同时最多 2 个（不含中央争夺点）
const WEAPON_RESPAWN_TIME = 360;                   // 约 12 秒补刷一个
const CENTER_WEAPON = 'sniper';                    // 中央争夺点固定刷的强力武器
const CENTER_RESPAWN_TIME = 540;                   // 中央被抢走后约 18 秒再刷

// 军备竞赛（Gun Game）武器梯：每击杀升一级换下一把，走完即获胜（可调长度/顺序）
const GUNGAME_LADDER = ['smg', 'shotgun', 'sniper', 'smg', 'shotgun', 'sniper', 'pistol'];

// 占点（KOTH）：中央占领圈，单独占住每 30 tick(=1秒) 累积 1 分，先到目标分获胜
const ZONE_RADIUS = 95;
const ZONE_CAPTURE_TARGET = 60; // 累计控制 60 秒获胜（可调）

// 夺旗（CTF）：各队基地一面旗
const FLAG_HALF = 12;             // 旗的触碰半径
const FLAG_RETURN_TIME = 240;     // 掉落后约 8 秒自动归位
const FLAG_CAPTURE_RADIUS = 46;   // 扛敌旗回到己方旗位多近算夺旗成功
const FLAG_TARGET = 3;            // 夺旗 3 次获胜（可调）
const FLAG_STATE_NUM = { home: 0, carried: 1, dropped: 2 };

const SPAWN_MARGIN = 40;
const SPAWN_SAFE_DIST = 240;

const BOT_SIGHT_RANGE = 460;
const BOT_PREF_MIN = 160;
const BOT_PREF_MAX = 320;
const BOT_AIM_JITTER = 0.09;
const BOT_STRAFE_FLIP_CHANCE = 0.02;

// 空输入（真人还没发输入时用）
const EMPTY_INPUT = { up: false, down: false, left: false, right: false, aimX: 0, aimY: 0, shoot: false, throw: null };

// ---------- 颜色 ----------
function fighterColor(team, controller) {
  if (team === 'green') return controller === 'human' ? '#5fd35f' : '#2f8f3f';
  return controller === 'human' ? '#ff7a7a' : '#e05050';
}

// ---------- 创建对象 ----------
function createFighter(id, x, y, team, controller, name) {
  return {
    id: id, team: team, controller: controller, name: name || '',
    color: fighterColor(team, controller),
    x: x, y: y, radius: 16, angle: 0, speed: 3,
    hp: MAX_HP, maxHp: MAX_HP, alive: true,
    respawnTimer: 0, fireCooldown: 0, strafeDir: 1,
    grenadeCooldown: 0, grenades: START_GRENADES,
    weapon: 'pistol', ammo: Infinity, // 当前武器与剩余弹药（手枪无限）
    invuln: SPAWN_PROTECT, // 出生无敌帧（开局/复活有保护）
    respawnX: null, respawnY: null, // 死亡时锁定的复活点（仅本人可见）
    level: 0,   // 军备竞赛进度（仅 gungame 用）
    kills: 0,   // 本场个人击杀数
    deaths: 0,  // 本场个人阵亡数
    damage: 0,  // 本场对敌人造成的有效伤害总和（结算综合评分用）
    streak: 0,        // 当前连杀（multikill）等级，阵亡或窗口超时清零
    streakTimer: 0,   // 连杀窗口剩余帧数
  };
}

// 碰撞：圆 vs 矩形
function circleHitsRect(cx, cy, r, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX, dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}
function hitsAnyWall(world, cx, cy, r) {
  for (const wall of world.walls) if (circleHitsRect(cx, cy, r, wall)) return true;
  return false;
}

// ============================================================
//  电脑寻路：网格 A*
//  地图墙体固定，开局把场地切成格子、按单位半径给墙"膨胀"标出不可走格，
//  电脑被墙挡住视线时就沿 A* 路径绕墙走，而不是直直顶在墙上。
// ============================================================
const NAV_CELL = 20;     // 格子边长（略大于单位半径 16，分辨率足够又不浪费）
const SQRT2 = 1.4142135623730951;

// 预计算导航网格：blocked[i]=1 表示该格中心放一个单位会撞墙/出界，不可走
function buildNavGrid(world) {
  const cols = Math.ceil(world.width / NAV_CELL);
  const rows = Math.ceil(world.height / NAV_CELL);
  const blocked = new Uint8Array(cols * rows);
  const r = 16; // 战斗单位半径
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * NAV_CELL, y = (cy + 0.5) * NAV_CELL;
      const oob = x < r || y < r || x > world.width - r || y > world.height - r;
      blocked[cy * cols + cx] = (oob || hitsAnyWall(world, x, y, r)) ? 1 : 0;
    }
  }
  return { cell: NAV_CELL, cols: cols, rows: rows, blocked: blocked };
}

function navCellOf(nav, x, y) {
  const cx = Math.max(0, Math.min(nav.cols - 1, Math.floor(x / nav.cell)));
  const cy = Math.max(0, Math.min(nav.rows - 1, Math.floor(y / nav.cell)));
  return { cx: cx, cy: cy };
}
function navCellCenter(nav, cx, cy) {
  return { x: (cx + 0.5) * nav.cell, y: (cy + 0.5) * nav.cell };
}
// 若该格不可走（比如紧贴墙），向外一圈圈找最近的可走格
function navNearestFree(nav, cx, cy) {
  if (!nav.blocked[cy * nav.cols + cx]) return { cx: cx, cy: cy };
  for (let rad = 1; rad < 10; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue; // 只看最外圈
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= nav.cols || ny >= nav.rows) continue;
        if (!nav.blocked[ny * nav.cols + nx]) return { cx: nx, cy: ny };
      }
    }
  }
  return { cx: cx, cy: cy };
}

function navOctile(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
}

// 极简二叉最小堆（存 {i: 格索引, p: 优先级}）
function NavHeap() { this.a = []; }
NavHeap.prototype.size = function () { return this.a.length; };
NavHeap.prototype.push = function (i, p) {
  const a = this.a; a.push({ i: i, p: p });
  let c = a.length - 1;
  while (c > 0) {
    const par = (c - 1) >> 1;
    if (a[par].p <= a[c].p) break;
    const t = a[par]; a[par] = a[c]; a[c] = t; c = par;
  }
};
NavHeap.prototype.pop = function () {
  const a = this.a, top = a[0], last = a.pop();
  if (a.length) {
    a[0] = last;
    let c = 0;
    for (;;) {
      const l = 2 * c + 1, rr = 2 * c + 2; let m = c;
      if (l < a.length && a[l].p < a[m].p) m = l;
      if (rr < a.length && a[rr].p < a[m].p) m = rr;
      if (m === c) break;
      const t = a[m]; a[m] = a[c]; a[c] = t; c = m;
    }
  }
  return top.i;
};

const NAV_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A* 求路径，返回世界坐标拐点数组（含目标格中心），找不到返回 null
function navFindPath(world, nav, sx, sy, gx, gy) {
  const cols = nav.cols, rows = nav.rows, blocked = nav.blocked;
  const s = navNearestFree(nav, navCellOf(nav, sx, sy).cx, navCellOf(nav, sx, sy).cy);
  const g = navNearestFree(nav, navCellOf(nav, gx, gy).cx, navCellOf(nav, gx, gy).cy);
  const startIdx = s.cy * cols + s.cx;
  const goalIdx = g.cy * cols + g.cx;
  if (startIdx === goalIdx) return [navCellCenter(nav, g.cx, g.cy)];

  const N = cols * rows;
  const came = new Int32Array(N).fill(-1);
  const gScore = new Float64Array(N).fill(Infinity);
  const closed = new Uint8Array(N);
  const open = new NavHeap();
  gScore[startIdx] = 0;
  open.push(startIdx, navOctile(s.cx, s.cy, g.cx, g.cy));

  let found = false;
  while (open.size()) {
    const cur = open.pop();
    if (closed[cur]) continue;          // 跳过堆里的旧副本
    if (cur === goalIdx) { found = true; break; }
    closed[cur] = 1;
    const ccx = cur % cols, ccy = (cur / cols) | 0;
    for (let d = 0; d < NAV_DIRS.length; d++) {
      const dx = NAV_DIRS[d][0], dy = NAV_DIRS[d][1];
      const nx = ccx + dx, ny = ccy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (blocked[nIdx]) continue;
      if (dx !== 0 && dy !== 0) { // 防止从墙角斜穿
        if (blocked[ccy * cols + nx] || blocked[ny * cols + ccx]) continue;
      }
      const step = (dx !== 0 && dy !== 0) ? SQRT2 : 1;
      const ng = gScore[cur] + step;
      if (ng < gScore[nIdx]) {
        gScore[nIdx] = ng;
        came[nIdx] = cur;
        open.push(nIdx, ng + navOctile(nx, ny, g.cx, g.cy));
      }
    }
  }
  if (!found) return null;

  const path = [];
  let c = goalIdx;
  while (c !== -1) {
    path.push(navCellCenter(nav, c % cols, (c / cols) | 0));
    if (c === startIdx) break;
    c = came[c];
  }
  path.reverse();
  return path;
}

// 给电脑算"下一步往哪走"的点：能直达就直冲，否则沿缓存的 A* 路径绕墙
function navWaypoint(world, bot, gx, gy) {
  const nav = world.nav;
  if (!nav) return { x: gx, y: gy };
  // 目标按单位半径可直达，就别绕路
  if (!segmentBlocked(world, bot.x, bot.y, gx, gy, bot.radius)) { bot._path = null; return { x: gx, y: gy }; }

  const gc = navCellOf(nav, gx, gy);
  const goalKey = gc.cx + ',' + gc.cy;
  if (bot._repath > 0) bot._repath--;
  if (!bot._path || bot._pathGoal !== goalKey || bot._repath <= 0) {
    bot._path = navFindPath(world, nav, bot.x, bot.y, gx, gy);
    bot._pathGoal = goalKey;
    bot._repath = 12; // 约 0.4s 重算一次，避免每帧都跑 A*
  }
  if (!bot._path || bot._path.length === 0) return { x: gx, y: gy }; // 没路就退化直冲

  // 拐点平滑：丢掉已到达 / 能直达下一个的中间点
  while (bot._path.length > 1) {
    const w0 = bot._path[0];
    const reached = Math.hypot(w0.x - bot.x, w0.y - bot.y) < nav.cell * 0.8;
    const skip = !segmentBlocked(world, bot.x, bot.y, bot._path[1].x, bot._path[1].y, bot.radius);
    if (reached || skip) bot._path.shift(); else break;
  }
  return bot._path[0];
}

// 在基地附近散开生成 count 个出生点
function spreadSpawns(world, base, count) {
  const points = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ox = (Math.random() * 2 - 1) * 45;
      const oy = (i - (count - 1) / 2) * 55 + (Math.random() * 2 - 1) * 20;
      const x = Math.max(30, Math.min(world.width - 30, base.x + ox));
      const y = Math.max(30, Math.min(world.height - 30, base.y + oy));
      if (hitsAnyWall(world, x, y, 20)) continue;
      let overlap = false;
      for (const p of points) if (Math.hypot(x - p.x, y - p.y) < 38) { overlap = true; break; }
      if (overlap) continue;
      points.push({ x: x, y: y }); placed = true; break;
    }
    if (!placed) {
      const y = Math.max(30, Math.min(world.height - 30, base.y + (i - (count - 1) / 2) * 42));
      points.push({ x: base.x, y: y });
    }
  }
  return points;
}

// ---------- 程序化随机地图 ----------
// 用导航网格 BFS 验证两队基地连通（不能被墙堵死）
function mapConnected(map) {
  const tmp = { width: map.width, height: map.height, walls: map.walls };
  const nav = buildNavGrid(tmp);
  const sc = navCellOf(nav, map.greenBase.x, map.greenBase.y);
  const gc = navCellOf(nav, map.redBase.x, map.redBase.y);
  const s = navNearestFree(nav, sc.cx, sc.cy);
  const g = navNearestFree(nav, gc.cx, gc.cy);
  const cols = nav.cols, rows = nav.rows;
  const startIdx = s.cy * cols + s.cx, goalIdx = g.cy * cols + g.cx;
  const seen = new Uint8Array(cols * rows);
  const queue = [startIdx]; seen[startIdx] = 1;
  let head = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goalIdx) return true;
    const ccx = cur % cols, ccy = (cur / cols) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = ccx + dirs[d][0], ny = ccy + dirs[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (seen[ni] || nav.blocked[ni]) continue;
      seen[ni] = 1; queue.push(ni);
    }
  }
  return false;
}

// 现场生成一张左右镜像对称的随机地图（保证公平 + 连通），失败兜底用第 0 张
// sizeClass: 'small' | 'medium' | 'large' | undefined(随机，含大图)
function generateRandomMap(sizeClass) {
  // 三档尺寸，随机时大图也会出现（不再封顶 1120×760）
  const SIZES = {
    small:  { W: [800, 900],         H: [560, 620] },
    medium: { W: [1000, 1080, 1160], H: [680, 720] },
    large:  { W: [1280, 1400, 1520], H: [820, 900, 960] },
  };
  const pickArr = (a) => a[Math.floor(Math.random() * a.length)];
  const fixed = SIZES[sizeClass] ? sizeClass : null; // 只认 small/medium/large，其余当"任意"
  for (let attempt = 0; attempt < 50; attempt++) {
    const cls = fixed || pickArr(['small', 'medium', 'large', 'large']); // 任意时偏向出大图
    const S = SIZES[cls];
    const width = pickArr(S.W);
    const height = pickArr(S.H);
    const cx = width / 2;
    const greenBase = { x: 90, y: Math.round(height / 2) };
    const redBase = { x: width - 90, y: Math.round(height / 2) };
    const walls = [];

    // 可选：中轴上一道自身对称的中心墙
    if (Math.random() < 0.6) {
      const cw = 24 + Math.floor(Math.random() * 64);
      const ch = 60 + Math.floor(Math.random() * 220);
      walls.push({ x: Math.round(cx - cw / 2), y: Math.round(height / 2 - ch / 2), w: cw, h: ch });
    }

    // 墙数随场地面积缩放：大图多放墙，避免空旷（基准 1040×700 ≈ 4 道）
    const area = width * height;
    const baseN = Math.round(area / 182000); // 每 ~18.2万像素一道墙
    const n = Math.max(3, baseN - 1) + Math.floor(Math.random() * 4); // baseN 附近 +0..3
    for (let i = 0; i < n; i++) {
      const horizontal = Math.random() < 0.5;
      const w = horizontal ? (60 + Math.floor(Math.random() * 180)) : (20 + Math.floor(Math.random() * 16));
      const h = horizontal ? (20 + Math.floor(Math.random() * 16)) : (60 + Math.floor(Math.random() * 180));
      const minX = 150;                 // 远离绿队基地(x=90)
      const maxX = cx - 80 - w;          // 中轴附近留通道
      if (maxX <= minX) continue;
      const x = minX + Math.floor(Math.random() * (maxX - minX));
      const y = 70 + Math.floor(Math.random() * Math.max(1, height - 140 - h));
      // 别盖住基地
      if (Math.hypot((x + w / 2) - greenBase.x, (y + h / 2) - greenBase.y) < 120) continue;
      walls.push({ x: x, y: y, w: w, h: h });
      walls.push({ x: width - (x + w), y: y, w: w, h: h }); // 镜像
    }

    const map = { id: 'random', name: '随机地图', width: width, height: height, greenBase: greenBase, redBase: redBase, walls: walls };
    if (mapConnected(map)) return map;
  }
  return MAPS[0]; // 极端情况下兜底
}

// ---------- 创建世界 ----------
// spec = { mapIndex, teamGreen, teamRed, humans: [{id, team, name}] }
// 真人按 spec 放入对应队伍，其余用电脑补到各队设定人数（两队可不同）。
function createWorld(spec) {
  let map = MAPS[spec.mapIndex] || MAPS[0];
  if (map.random) map = generateRandomMap(spec.randomSize); // 选了"随机地图"就现场生成（可指定尺寸档）
  const teamGreen = Math.max(1, spec.teamGreen || 2);
  const teamRed = Math.max(1, spec.teamRed || 2);

  const world = {
    mapIndex: spec.mapIndex || 0,
    mapName: map.name,
    mode: ['gungame', 'koth', 'ctf'].indexOf(spec.mode) >= 0 ? spec.mode : 'tdm', // 游戏模式
    width: map.width, height: map.height, walls: map.walls,
    greenBase: map.greenBase, redBase: map.redBase,
    teamGreen: teamGreen, teamRed: teamRed,
    targetScore: computeTargetScore(teamGreen + teamRed), // 胜利分上限随总人数缩放
    countdown: COUNTDOWN_TICKS, // 开局倒计时（冻结期）
    fighters: [],
    bullets: [], grenades: [], crates: [], effects: [],
    crateSpawnTimer: 90,
    hearts: [], heartSpawnTimer: 180, // 回血心心
    weaponSpawns: [], weaponSpawnTimer: 150, // 武器拾取物
    centerSpawnTimer: 150,                   // 中央争夺点刷新计时
    teamScore: { green: 0, red: 0 },
    soundEvents: [], // 本帧发生的事件（开枪/爆炸/拾取/命中/死亡），发给客户端播音效
    gameOver: false, winner: null,
  };

  world.nav = buildNavGrid(world); // 预计算导航网格（墙体随地图固定，建一次即可）

  const humans = spec.humans || [];
  const greenHumans = humans.filter((h) => h.team === 'green');
  const redHumans = humans.filter((h) => h.team === 'red');

  const greenSpawns = spreadSpawns(world, map.greenBase, teamGreen);
  const redSpawns = spreadSpawns(world, map.redBase, teamRed);

  let botNum = 0; // 给电脑顺序编号（电脑1、电脑2…），方便击杀榜区分
  // 绿队：先放真人，再用电脑补满
  for (let i = 0; i < teamGreen; i++) {
    const s = greenSpawns[i];
    if (i < greenHumans.length) {
      const h = greenHumans[i];
      world.fighters.push(createFighter(h.id, s.x, s.y, 'green', 'human', h.name));
    } else {
      world.fighters.push(createFighter('green-bot-' + i, s.x, s.y, 'green', 'bot', '电脑' + (++botNum)));
    }
  }
  // 红队同理
  for (let i = 0; i < teamRed; i++) {
    const s = redSpawns[i];
    if (i < redHumans.length) {
      const h = redHumans[i];
      world.fighters.push(createFighter(h.id, s.x, s.y, 'red', 'human', h.name));
    } else {
      world.fighters.push(createFighter('red-bot-' + i, s.x, s.y, 'red', 'bot', '电脑' + (++botNum)));
    }
  }

  // 给每个单位分配一个小数字 id（nid，1..255），二进制快照里用它引用单位（省字节）。
  // 字符串 id ↔ nid 的映射放在 roster（JSON）里发，客户端据此还原。
  world.fighters.forEach((f, i) => { f.nid = i + 1; });
  world._nextNid = world.fighters.length + 1;

  // 军备竞赛：所有人从武器梯第 0 级起步、无限弹、无手雷（无拾取）
  if (world.mode === 'gungame') {
    for (const f of world.fighters) { f.level = 0; f.weapon = GUNGAME_LADDER[0]; f.ammo = Infinity; f.grenades = 0; }
  }

  // 占点：中央占领圈（保留全部拾取，胜负看占点累计秒数）
  if (world.mode === 'koth') {
    world.zone = { x: Math.round(world.width / 2), y: Math.round(world.height / 2), radius: ZONE_RADIUS };
    world.zoneTicks = { green: 0, red: 0 };
    world.targetScore = ZONE_CAPTURE_TARGET; // 比分行显示"占点秒数 / 目标"
  }

  // 夺旗：各队基地一面旗（保留全部拾取，胜负看夺旗次数）
  if (world.mode === 'ctf') {
    const mkFlag = (team, base) => ({ team: team, homeX: base.x, homeY: base.y, x: base.x, y: base.y, state: 'home', carrier: null, returnTimer: 0 });
    world.flags = { green: mkFlag('green', world.greenBase), red: mkFlag('red', world.redBase) };
    world.flagTarget = FLAG_TARGET;
    world.targetScore = FLAG_TARGET; // 比分行显示"夺旗数 / 目标"
  }

  return world;
}

function nearestEnemy(world, f) {
  let best = null, bestDist = Infinity;
  for (const o of world.fighters) {
    if (!o.alive || o.team === f.team) continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < bestDist) { bestDist = d; best = o; }
  }
  return best;
}

function moveFighter(world, f, dx, dy) {
  const tryX = f.x + dx;
  if (!hitsAnyWall(world, tryX, f.y, f.radius)) f.x = tryX;
  const tryY = f.y + dy;
  if (!hitsAnyWall(world, f.x, tryY, f.radius)) f.y = tryY;
  f.x = Math.max(f.radius, Math.min(world.width - f.radius, f.x));
  f.y = Math.max(f.radius, Math.min(world.height - f.radius, f.y));
}

function fire(world, shooter) {
  if (!shooter.alive || shooter.fireCooldown > 0) return;
  shooter.invuln = 0; // 一开火就放弃出生保护（防止无敌还能输出）
  // 防御：弹药已空但没切回手枪时，先切回
  if (shooter.ammo <= 0) { shooter.weapon = 'pistol'; shooter.ammo = Infinity; }
  const w = WEAPONS[shooter.weapon] || WEAPONS.pistol;

  shooter.fireCooldown = w.cooldown;
  world.soundEvents.push({ type: 'shot', ownerId: shooter.id, w: w.idx });

  // 按武器一次打出 pellets 颗子弹，带散布；伤害/速度记在子弹上
  for (let i = 0; i < w.pellets; i++) {
    const ang = shooter.angle + (Math.random() - 0.5) * w.spread;
    world.bullets.push({
      x: shooter.x + Math.cos(ang) * (shooter.radius + 6),
      y: shooter.y + Math.sin(ang) * (shooter.radius + 6),
      dx: Math.cos(ang) * w.speed,
      dy: Math.sin(ang) * w.speed,
      ownerId: shooter.id, team: shooter.team, alive: true, damage: w.damage, wpn: w.idx,
    });
  }

  // 消耗弹药；打光自动回到无限子弹的手枪
  if (w.ammo !== Infinity) {
    shooter.ammo--;
    if (shooter.ammo <= 0) { shooter.weapon = 'pistol'; shooter.ammo = Infinity; }
  }
}

function pickSpawnPoint(world, f) {
  const enemies = world.fighters.filter((o) => o.alive && o.team !== f.team);
  function nearestDist(x, y) {
    let m = Infinity;
    for (const e of enemies) m = Math.min(m, Math.hypot(x - e.x, y - e.y));
    return m;
  }
  let best = null, bestDist = -1;
  for (let i = 0; i < 60; i++) {
    const x = SPAWN_MARGIN + Math.random() * (world.width - 2 * SPAWN_MARGIN);
    const y = SPAWN_MARGIN + Math.random() * (world.height - 2 * SPAWN_MARGIN);
    if (hitsAnyWall(world, x, y, f.radius + 6)) continue;
    const dist = enemies.length ? nearestDist(x, y) : Infinity;
    if (dist >= SPAWN_SAFE_DIST) return { x: x, y: y };
    if (dist > bestDist) { bestDist = dist; best = { x: x, y: y }; }
  }
  return best || { x: world.width / 2, y: world.height / 2 };
}

function killFighter(world, f) {
  f.hp = 0; f.alive = false; f.respawnTimer = RESPAWN_TIME;
  f.deaths++; // 不管被子弹还是手雷打死，统一在这里记一次阵亡
  f.streak = 0; f.streakTimer = 0; // 阵亡清空连杀
  // 死亡瞬间就锁定复活点，供本人提前预览（服务器私密发给本人，对手收不到、无法预知）
  const spot = pickSpawnPoint(world, f);
  f.respawnX = spot.x; f.respawnY = spot.y;
  if (!world.respawnAssigned) world.respawnAssigned = [];
  world.respawnAssigned.push({ id: f.id, x: Math.round(spot.x), y: Math.round(spot.y) });
}

function creditKill(world, killerId, victim) {
  if (killerId === victim.id) return;
  const killer = world.fighters.find((x) => x.id === killerId);
  if (!killer || killer.team === victim.team) return;
  killer.kills++;
  world.teamScore[killer.team]++;

  // 连杀（multikill）：窗口内连续击杀累加等级，发事件给客户端播报/上特效
  if (killer.streakTimer > 0) killer.streak++; else killer.streak = 1;
  killer.streakTimer = MULTIKILL_WINDOW;
  if (killer.streak >= 2) {
    world.soundEvents.push({ type: 'multikill', who: killer.id, n: Math.min(255, killer.streak) });
  }

  // 军备竞赛：每杀一个升一级换下一把枪，走完整条武器梯即获胜
  if (world.mode === 'gungame') {
    killer.level++;
    if (killer.level >= GUNGAME_LADDER.length) {
      killer.level = GUNGAME_LADDER.length;
      world.gameOver = true; world.winner = killer.team;
    } else {
      killer.weapon = GUNGAME_LADDER[killer.level];
      killer.ammo = Infinity;
      killer.grenades = 0;
    }
    return;
  }

  // 占点/夺旗：击杀只计个人战绩，不直接决定胜负。把刚加的队伍分回退（teamScore 另作占点/夺旗分）。
  if (world.mode === 'koth' || world.mode === 'ctf') { world.teamScore[killer.team]--; return; }

  // 团队死斗：到达目标分获胜
  if (world.teamScore[killer.team] >= world.targetScore) {
    world.gameOver = true; world.winner = killer.team;
  }
}

// 占点：统计圈内人数，单队独占则累积控制；敌我同在或无人则暂停
function inZone(zone, f) {
  const dx = f.x - zone.x, dy = f.y - zone.y;
  return dx * dx + dy * dy < zone.radius * zone.radius;
}
function updateZone(world) {
  const z = world.zone;
  let greenIn = 0, redIn = 0;
  for (const f of world.fighters) {
    if (!f.alive) continue;
    if (inZone(z, f)) { if (f.team === 'green') greenIn++; else redIn++; }
  }
  let controlling = null;
  if (greenIn > 0 && redIn === 0) controlling = 'green';
  else if (redIn > 0 && greenIn === 0) controlling = 'red';
  if (controlling) {
    world.zoneTicks[controlling]++;
    world.teamScore[controlling] = Math.floor(world.zoneTicks[controlling] / 30);
    if (world.teamScore[controlling] >= world.targetScore) {
      world.gameOver = true; world.winner = controlling;
    }
  }
}

// 夺旗：旗跟随携带者 / 掉落计时归位 / 触碰拾取·返还·得分
function updateFlags(world) {
  const teams = ['green', 'red'];
  // 1) 更新每面旗的跟随/掉落状态
  for (const t of teams) {
    const flag = world.flags[t];
    if (flag.state === 'carried') {
      const c = world.fighters.find((x) => x.id === flag.carrier);
      if (!c || !c.alive) {
        // 携带者阵亡/消失 → 在其位置掉落，开始归位倒计时
        flag.state = 'dropped';
        if (c) { flag.x = c.x; flag.y = c.y; }
        flag.carrier = null;
        flag.returnTimer = FLAG_RETURN_TIME;
      } else {
        flag.x = c.x; flag.y = c.y; // 跟随
      }
    } else if (flag.state === 'dropped') {
      flag.returnTimer--;
      if (flag.returnTimer <= 0) { flag.state = 'home'; flag.x = flag.homeX; flag.y = flag.homeY; flag.carrier = null; }
    }
  }
  // 2) 触碰处理
  for (const f of world.fighters) {
    if (!f.alive) continue;
    const enemyTeam = f.team === 'green' ? 'red' : 'green';
    const enemyFlag = world.flags[enemyTeam];
    const ownFlag = world.flags[f.team];

    // 拿敌方旗（在家或掉落、无人携带，且贴近）
    if (enemyFlag.state !== 'carried') {
      const dx = f.x - enemyFlag.x, dy = f.y - enemyFlag.y;
      if (dx * dx + dy * dy < (f.radius + FLAG_HALF) * (f.radius + FLAG_HALF)) {
        enemyFlag.state = 'carried'; enemyFlag.carrier = f.id;
        world.soundEvents.push({ type: 'pickup', who: f.id });
      }
    }
    // 返还己方掉落的旗
    if (ownFlag.state === 'dropped') {
      const dx = f.x - ownFlag.x, dy = f.y - ownFlag.y;
      if (dx * dx + dy * dy < (f.radius + FLAG_HALF) * (f.radius + FLAG_HALF)) {
        ownFlag.state = 'home'; ownFlag.x = ownFlag.homeX; ownFlag.y = ownFlag.homeY; ownFlag.carrier = null;
        world.soundEvents.push({ type: 'pickup', who: f.id });
      }
    }
    // 夺旗得分：我正扛着敌旗 + 己方旗在家 + 回到己方旗位附近
    if (enemyFlag.carrier === f.id && ownFlag.state === 'home') {
      const dx = f.x - ownFlag.homeX, dy = f.y - ownFlag.homeY;
      if (dx * dx + dy * dy < FLAG_CAPTURE_RADIUS * FLAG_CAPTURE_RADIUS) {
        world.teamScore[f.team]++;
        enemyFlag.state = 'home'; enemyFlag.x = enemyFlag.homeX; enemyFlag.y = enemyFlag.homeY; enemyFlag.carrier = null;
        world.soundEvents.push({ type: 'heal', who: f.id }); // 复用一个上扬正反馈音
        if (world.teamScore[f.team] >= world.flagTarget) { world.gameOver = true; world.winner = f.team; }
      }
    }
  }
}

// 把对敌人造成的有效伤害累加到攻击者名下（自伤/友伤不计）
function creditDamage(world, attackerId, victim, amount) {
  if (amount <= 0 || attackerId === victim.id) return;
  const a = world.fighters.find((x) => x.id === attackerId);
  if (a && a.team !== victim.team) a.damage = Math.min(65535, a.damage + amount);
}

function respawnFighter(world, f) {
  // 用死亡时锁定的复活点（和本人预览的一致）；万一没有就现选一个兜底
  const x = (f.respawnX != null) ? f.respawnX : pickSpawnPoint(world, f).x;
  const y = (f.respawnY != null) ? f.respawnY : pickSpawnPoint(world, f).y;
  f.x = x; f.y = y; f.alive = true; f.hp = f.maxHp;
  f.respawnX = null; f.respawnY = null;
  f.invuln = SPAWN_PROTECT; // 复活给一段出生保护
  if (world.mode === 'gungame') {
    f.weapon = GUNGAME_LADDER[f.level]; f.ammo = Infinity; f.grenades = 0; // 复活回到当前军备等级的枪
  } else {
    f.weapon = 'pistol'; f.ammo = Infinity; // 复活回到默认手枪（特殊武器随死亡丢失）
  }
}

function tickFighter(world, f) {
  if (f.fireCooldown > 0) f.fireCooldown--;
  if (f.grenadeCooldown > 0) f.grenadeCooldown--;
  if (f.invuln > 0) f.invuln--; // 出生保护倒计时
  if (f.streakTimer > 0) { f.streakTimer--; if (f.streakTimer === 0) f.streak = 0; } // 连杀窗口超时清零
  if (!f.alive) {
    f.respawnTimer--;
    if (f.respawnTimer <= 0) respawnFighter(world, f);
  }
}

// 真人：按它发来的输入控制
function controlHuman(world, p, input) {
  if (!p.alive) return;
  let dx = 0, dy = 0;
  if (input.up) dy -= p.speed;
  if (input.down) dy += p.speed;
  if (input.left) dx -= p.speed;
  if (input.right) dx += p.speed;
  moveFighter(world, p, dx, dy);
  p.angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
  if (input.shoot) fire(world, p);
  if (input.throw) {
    throwGrenade(world, p, input.throw.x, input.throw.y);
    input.throw = null; // 一次性，消费后清掉
  }
}

// 两点之间是否被墙挡住。r 默认用子弹半径（射线/视线）；走位检测时传入单位半径。
function segmentBlocked(world, x1, y1, x2, y2, r) {
  const rad = r || BULLET_RADIUS;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / 8);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (hitsAnyWall(world, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, rad)) return true;
  }
  return false;
}

function nearestCrate(world, f) {
  let best = null, bestDist = Infinity;
  for (const c of world.crates) {
    const d = Math.hypot(f.x - c.x, f.y - c.y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}
function nearestHeart(world, f) {
  let best = null, bestDist = Infinity;
  for (const h of world.hearts) {
    const d = Math.hypot(f.x - h.x, f.y - h.y);
    if (d < bestDist) { bestDist = d; best = h; }
  }
  return best;
}
function nearestWeaponPickup(world, f) {
  let best = null, bestDist = Infinity;
  for (const wp of world.weaponSpawns) {
    const d = Math.hypot(f.x - wp.x, f.y - wp.y);
    if (d < bestDist) { bestDist = d; best = wp; }
  }
  return best;
}

// 按模式给电脑一个"战术目标点"：{x,y,holdDist}。holdDist 内就切换到正常交火走位。
// 返回 null 表示没有特殊目标（团队死斗/军备竞赛 → 纯打人）。
function botObjective(world, bot) {
  // 占点：没在圈里就往圈中心挤；进圈后在圈内交火（holdDist=圈半径）
  if (world.mode === 'koth' && world.zone) {
    return { x: world.zone.x, y: world.zone.y, holdDist: world.zone.radius - 10 };
  }
  // 夺旗：按当前旗局势决定意图
  if (world.mode === 'ctf' && world.flags) {
    const enemyTeam = bot.team === 'green' ? 'red' : 'green';
    const enemyFlag = world.flags[enemyTeam];
    const ownFlag = world.flags[bot.team];
    // 1) 我正扛着敌旗 → 不顾一切冲回家得分
    if (enemyFlag.carrier === bot.id) return { x: ownFlag.homeX, y: ownFlag.homeY, holdDist: FLAG_CAPTURE_RADIUS * 0.6 };
    // 2) 敌人偷了我方旗 → 去追那个携带者把旗打掉
    if (ownFlag.state === 'carried') {
      const carrier = world.fighters.find((x) => x.id === ownFlag.carrier);
      if (carrier) return { x: carrier.x, y: carrier.y, holdDist: 40 };
    }
    // 3) 我方旗掉在外面 → 一半概率的人去返还（按 nid 奇偶分工，避免全队都去）
    if (ownFlag.state === 'dropped' && (bot.nid % 2 === 0)) {
      return { x: ownFlag.x, y: ownFlag.y, holdDist: 20 };
    }
    // 4) 敌旗可拿（在家或掉落、无人扛）→ 去抢旗
    if (enemyFlag.state !== 'carried') return { x: enemyFlag.x, y: enemyFlag.y, holdDist: 20 };
    // 5) 敌旗已被我方队友扛着 → 没有专门目标，去打人（护送靠交火自然发生）
  }
  return null;
}

// 电脑 AI
function controlBot(world, bot) {
  if (!bot.alive) return;
  const target = nearestEnemy(world, bot);
  const objective = botObjective(world, bot);
  if (!target && !objective) return; // 没人可打也没目标
  // 朝向：有敌人优先瞄敌人，否则朝目标点
  let dx, dy, dist, toTarget, canSee = false;
  if (target) {
    dx = target.x - bot.x; dy = target.y - bot.y;
    dist = Math.hypot(dx, dy);
    toTarget = Math.atan2(dy, dx);
    bot.angle = toTarget + (Math.random() - 0.5) * BOT_AIM_JITTER;
    canSee = !segmentBlocked(world, bot.x, bot.y, target.x, target.y);
  } else {
    bot.angle = Math.atan2(objective.y - bot.y, objective.x - bot.x);
    dist = Infinity; toTarget = bot.angle;
  }

  // 取物目标优先级：低血回心心 > 弱武器(手枪/弹将尽)就近捡枪 > 没手雷捡箱子。
  // 注意：移动去取物的同时，下面照样会瞄准/开火可见的敌人，不会变成靶子。
  let goal = null;
  if (bot.hp < bot.maxHp * 0.55) {
    const h = nearestHeart(world, bot);
    if (h) goal = h; // 心心稀有，受伤就值得去
  }
  if (!goal && (bot.weapon === 'pistol' || bot.ammo <= 4)) {
    const wp = nearestWeaponPickup(world, bot);
    if (wp && Math.hypot(wp.x - bot.x, wp.y - bot.y) < 460) goal = wp; // 武器就近才去，别横跨全图
  }
  if (!goal && bot.grenades <= 0) {
    const c = nearestCrate(world, bot);
    if (c) goal = c;
  }

  // 模式目标优先：占点/夺旗时，别为了捡箱子满图乱跑。
  // 只保留"基本顺路"的捡取（离自己近 + 几乎不偏离目标）；扛旗者绝不绕路。
  if (goal && objective) {
    const carryingFlag = world.mode === 'ctf' && world.flags &&
      (world.flags.green.carrier === bot.id || world.flags.red.carrier === bot.id);
    if (carryingFlag) {
      goal = null; // 扛着敌旗，直奔回家得分，不捡任何东西
    } else {
      const dBotGoal = Math.hypot(goal.x - bot.x, goal.y - bot.y);
      const dGoalObj = Math.hypot(objective.x - goal.x, objective.y - goal.y);
      const dBotObj = Math.hypot(objective.x - bot.x, objective.y - bot.y);
      const detour = (dBotGoal + dGoalObj) - dBotObj; // 为捡它多走的弯路
      if (dBotGoal > 150 || detour > 120) goal = null; // 太远或绕太多 → 放弃，专注目标
    }
  }

  // 战术目标：还没到目标点就往那走（用寻路绕墙）。已到目标点就交给下面的交火走位。
  let objActive = false;
  if (objective) {
    const od = Math.hypot(objective.x - bot.x, objective.y - bot.y);
    if (od > objective.holdDist) objActive = true;
  }

  let mx, my;
  if (goal) {
    // 去取物：目标可能在墙后，用寻路绕过去
    const wp = navWaypoint(world, bot, goal.x, goal.y);
    const ang = Math.atan2(wp.y - bot.y, wp.x - bot.x);
    mx = Math.cos(ang); my = Math.sin(ang);
  } else if (objActive) {
    // 奔向战术目标（占点圈 / 抢旗 / 扛旗回家 / 追旗）
    const wp = navWaypoint(world, bot, objective.x, objective.y);
    const ang = Math.atan2(wp.y - bot.y, wp.x - bot.x);
    mx = Math.cos(ang); my = Math.sin(ang);
  } else if (target && !canSee) {
    // 看不见敌人（被墙挡）：A* 绕墙靠近
    const wp = navWaypoint(world, bot, target.x, target.y);
    const ang = Math.atan2(wp.y - bot.y, wp.x - bot.x);
    mx = Math.cos(ang); my = Math.sin(ang);
  } else if (target) {
    // 看得见：开阔地带，保持距离 + 横向走位
    bot._path = null;
    let radial = 0;
    if (dist > BOT_PREF_MAX) radial = 1;
    else if (dist < BOT_PREF_MIN) radial = -1;
    if (Math.random() < BOT_STRAFE_FLIP_CHANCE) bot.strafeDir *= -1;
    const perp = toTarget + Math.PI / 2;
    mx = Math.cos(toTarget) * radial + Math.cos(perp) * bot.strafeDir * 0.8;
    my = Math.sin(toTarget) * radial + Math.sin(perp) * bot.strafeDir * 0.8;
  } else {
    mx = 0; my = 0; // 到达目标点且无敌人：原地守着
  }
  const len = Math.hypot(mx, my) || 1;
  if (mx || my) moveFighter(world, bot, (mx / len) * bot.speed, (my / len) * bot.speed);

  // 交火照常：看得见敌人就开火/扔雷（即便在奔向目标的路上）
  if (target && canSee && dist < BOT_SIGHT_RANGE) fire(world, bot);
  if (target && bot.grenades > 0 && !canSee && dist < GRENADE_MAX_RANGE + 40) throwGrenade(world, bot, target.x, target.y);
}

function updateBullets(world) {
  for (const b of world.bullets) {
    if (!b.alive) continue;
    b.x += b.dx; b.y += b.dy;
    if (b.x < 0 || b.x > world.width || b.y < 0 || b.y > world.height) { b.alive = false; continue; }
    if (hitsAnyWall(world, b.x, b.y, BULLET_RADIUS)) { b.alive = false; continue; }
    for (const f of world.fighters) {
      if (!f.alive || f.team === b.team || f.invuln > 0) continue; // 出生保护期内不被命中
      const ddx = f.x - b.x, ddy = f.y - b.y;
      if (ddx * ddx + ddy * ddy < f.radius * f.radius) {
        const dmg = (b.damage || BULLET_DAMAGE);
        creditDamage(world, b.ownerId, f, Math.min(dmg, f.hp)); // 有效伤害（不计溢出击杀）
        f.hp -= dmg; b.alive = false;
        if (f.hp <= 0) {
          killFighter(world, f); creditKill(world, b.ownerId, f);
          world.soundEvents.push({ type: 'death', victim: f.id, by: b.ownerId, w: b.wpn, dmg: dmg });
        } else {
          world.soundEvents.push({ type: 'hit', victim: f.id, by: b.ownerId, w: b.wpn, dmg: dmg });
        }
        break;
      }
    }
  }
  world.bullets = world.bullets.filter((b) => b.alive);
}

function throwGrenade(world, thrower, targetX, targetY) {
  if (!thrower.alive || thrower.grenades <= 0 || thrower.grenadeCooldown > 0) return;
  thrower.grenadeCooldown = GRENADE_COOLDOWN;
  thrower.grenades--;
  world.soundEvents.push({ type: 'throw', ownerId: thrower.id });
  const dx = targetX - thrower.x, dy = targetY - thrower.y;
  const dist = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, GRENADE_MAX_RANGE);
  const ang = Math.atan2(dy, dx);
  world.grenades.push({
    startX: thrower.x, startY: thrower.y, x: thrower.x, y: thrower.y, z: 0,
    landX: thrower.x + Math.cos(ang) * d, landY: thrower.y + Math.sin(ang) * d,
    t: 0, duration: Math.max(24, Math.round(d / GRENADE_FLIGHT_SPEED)),
    peak: Math.min(70, d * 0.45), ownerId: thrower.id, team: thrower.team,
  });
}

function updateGrenades(world) {
  const remaining = [];
  for (const g of world.grenades) {
    g.t += 1 / g.duration;
    if (g.t >= 1) { g.x = g.landX; g.y = g.landY; g.z = 0; explode(world, g); continue; }
    g.x = g.startX + (g.landX - g.startX) * g.t;
    g.y = g.startY + (g.landY - g.startY) * g.t;
    g.z = g.peak * 4 * g.t * (1 - g.t);
    remaining.push(g);
  }
  world.grenades = remaining;
}

function explode(world, g) {
  for (const f of world.fighters) {
    if (!f.alive || f.invuln > 0) continue; // 出生保护期内不受爆炸伤害
    const isEnemy = f.team !== g.team;
    const isThrower = f.id === g.ownerId;
    if (!isEnemy && !isThrower) continue;
    const dist = Math.hypot(f.x - g.x, f.y - g.y);
    if (dist < EXPLOSION_RADIUS) {
      const dmg = Math.round(GRENADE_DAMAGE * (1 - dist / EXPLOSION_RADIUS));
      if (isEnemy) creditDamage(world, g.ownerId, f, Math.min(dmg, f.hp)); // 只算对敌人的有效伤害
      f.hp -= dmg;
      if (f.hp <= 0) {
        killFighter(world, f); creditKill(world, g.ownerId, f);
        world.soundEvents.push({ type: 'death', victim: f.id, by: g.ownerId, dmg: dmg });
      } else {
        world.soundEvents.push({ type: 'hit', victim: f.id, by: g.ownerId, dmg: dmg });
      }
    }
  }
  world.soundEvents.push({ type: 'explode' });
  world.effects.push({ x: g.x, y: g.y, life: 18, maxLife: 18 });
}

function updateEffects(world) {
  for (const e of world.effects) e.life--;
  world.effects = world.effects.filter((e) => e.life > 0);
}

function pickFreePoint(world) {
  for (let i = 0; i < 60; i++) {
    const x = 50 + Math.random() * (world.width - 100);
    const y = 50 + Math.random() * (world.height - 100);
    if (hitsAnyWall(world, x, y, CRATE_HALF + 6)) continue;
    let bad = false;
    for (const f of world.fighters) if (Math.hypot(x - f.x, y - f.y) < 90) { bad = true; break; }
    if (bad) continue;
    for (const c of world.crates) if (Math.hypot(x - c.x, y - c.y) < 80) { bad = true; break; }
    if (bad) continue;
    return { x: x, y: y };
  }
  return null;
}

// 从 (cx,cy) 向外螺旋找一个不撞墙、不出界的落点（中央争夺点用，地图中心常有墙）
function pickPointNear(world, cx, cy) {
  if (!hitsAnyWall(world, cx, cy, WEAPON_HALF + 6)) return { x: cx, y: cy };
  for (let r = 30; r <= 240; r += 26) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      if (x < 40 || y < 40 || x > world.width - 40 || y > world.height - 40) continue;
      if (!hitsAnyWall(world, x, y, WEAPON_HALF + 6)) return { x: x, y: y };
    }
  }
  return null;
}

function tryPickupCrate(world, f) {
  if (!f.alive) return;
  const reach = f.radius + CRATE_HALF;
  for (const c of world.crates) {
    if (c.taken) continue;
    if (Math.hypot(f.x - c.x, f.y - c.y) < reach) {
      const gain = CRATE_MIN_GRENADES + Math.floor(Math.random() * (CRATE_MAX_GRENADES - CRATE_MIN_GRENADES + 1));
      f.grenades = Math.min(MAX_GRENADES, f.grenades + gain);
      c.taken = true;
      world.soundEvents.push({ type: 'pickup', who: f.id });
    }
  }
}

function updateCrates(world) {
  if (world.mode === 'gungame') return; // 军备竞赛无拾取
  for (const f of world.fighters) tryPickupCrate(world, f);
  world.crates = world.crates.filter((c) => !c.taken);
  if (world.crates.length < MAX_CRATES) {
    world.crateSpawnTimer--;
    if (world.crateSpawnTimer <= 0) {
      const spot = pickFreePoint(world);
      if (spot) world.crates.push({ x: spot.x, y: spot.y, taken: false });
      world.crateSpawnTimer = CRATE_RESPAWN_TIME;
    }
  }
}

// 回血心心：踩到且未满血才捡（满血的人走过不浪费）
function updateHearts(world) {
  if (world.mode === 'gungame') return; // 军备竞赛无拾取
  for (const f of world.fighters) {
    if (!f.alive || f.hp >= f.maxHp) continue;
    for (const h of world.hearts) {
      if (h.taken) continue;
      if (Math.hypot(f.x - h.x, f.y - h.y) < f.radius + HEART_HALF) {
        f.hp = Math.min(f.maxHp, f.hp + HEART_HEAL);
        h.taken = true;
        world.soundEvents.push({ type: 'heal', who: f.id });
      }
    }
  }
  world.hearts = world.hearts.filter((h) => !h.taken);
  if (world.hearts.length < MAX_HEARTS) {
    world.heartSpawnTimer--;
    if (world.heartSpawnTimer <= 0) {
      const spot = pickFreePoint(world);
      if (spot) world.hearts.push({ x: spot.x, y: spot.y, taken: false });
      world.heartSpawnTimer = HEART_RESPAWN_TIME;
    }
  }
}

// 武器拾取：踩到就换枪、补满该武器弹药（任何人都能捡，含电脑）
function tryPickupWeapon(world, f) {
  if (!f.alive) return;
  const reach = f.radius + WEAPON_HALF;
  for (const wp of world.weaponSpawns) {
    if (wp.taken) continue;
    if (Math.hypot(f.x - wp.x, f.y - wp.y) < reach) {
      f.weapon = wp.kind;
      f.ammo = WEAPONS[wp.kind].ammo;
      wp.taken = true;
      world.soundEvents.push({ type: 'weapon', who: f.id, w: WEAPONS[wp.kind].idx });
    }
  }
}

function updateWeaponPickups(world) {
  if (world.mode === 'gungame') return; // 军备竞赛武器由等级决定，无拾取
  for (const f of world.fighters) tryPickupWeapon(world, f);
  world.weaponSpawns = world.weaponSpawns.filter((wp) => !wp.taken);

  // 中央争夺点：地图正中固定刷一把强力武器（被抢走后过一段时间再刷），逼两队抢中路
  if (!world.weaponSpawns.some((wp) => wp.central)) {
    world.centerSpawnTimer--;
    if (world.centerSpawnTimer <= 0) {
      const spot = pickPointNear(world, world.width / 2, world.height / 2);
      if (spot) world.weaponSpawns.push({ x: spot.x, y: spot.y, kind: CENTER_WEAPON, taken: false, central: true });
      world.centerSpawnTimer = CENTER_RESPAWN_TIME;
    }
  }

  // 常规随机拾取（不计中央那个）
  const regular = world.weaponSpawns.filter((wp) => !wp.central).length;
  if (regular < MAX_WEAPON_PICKUPS) {
    world.weaponSpawnTimer--;
    if (world.weaponSpawnTimer <= 0) {
      const spot = pickFreePoint(world);
      if (spot) {
        const kind = WEAPON_KINDS[Math.floor(Math.random() * WEAPON_KINDS.length)];
        world.weaponSpawns.push({ x: spot.x, y: spot.y, kind: kind, taken: false });
      }
      world.weaponSpawnTimer = WEAPON_RESPAWN_TIME;
    }
  }
}

// ---------- 每帧总更新（inputs：fighterId -> 输入对象） ----------
function updateWorld(world, inputs) {
  // 注意：soundEvents 不在这里清空，改由服务器"广播后"清空。
  // 因为现在每 2 个模拟 tick 才广播一次，中间那一 tick 产生的开枪/爆炸等
  // 事件必须保留累积，等下次广播一起发出去，否则会丢音效。
  if (world.gameOver) return;
  // 开局倒计时：冻结全场（不移动/不开火/不刷新），只递减计时；结束后正常开打。
  // 期间也不递减出生保护，所以"开打瞬间"大家仍有完整 1.5s 保护。
  if (world.countdown > 0) { world.countdown--; return; }
  world.respawnAssigned = []; // 本帧新锁定的复活点（供服务器私密下发给本人）
  for (const f of world.fighters) tickFighter(world, f);
  for (const f of world.fighters) {
    if (f.controller === 'human') {
      controlHuman(world, f, inputs[f.id] || EMPTY_INPUT);
    } else {
      controlBot(world, f);
    }
  }
  updateBullets(world);
  updateGrenades(world);
  updateCrates(world);
  updateHearts(world);
  updateWeaponPickups(world);
  updateEffects(world);
  if (world.mode === 'koth' && world.zone) updateZone(world); // 占点累积
  if (world.mode === 'ctf' && world.flags) updateFlags(world); // 夺旗
}

// ---------- 单位的"静态名册"：只在开局/有人加入/改名/掉线时才发，不必每帧重复 ----------
// 带上 nid（数字 id），二进制快照用它引用单位，客户端据此映射回字符串 id。
function roster(world) {
  return world.fighters.map((f) => ({
    nid: f.nid, id: f.id, team: f.team, controller: f.controller,
    name: f.name, color: f.color, maxHp: f.maxHp,
  }));
}

// ---------- 把世界打包成发给客户端的"快照"（每帧只含会变的动态字段） ----------
function snapshot(world) {
  // 子弹扁平成 [x,y,w, x,y,w…]：x、y 加上武器序号 w（客户端按 w 给弹丸上色）。
  // w 多是 0/1（手枪/冲锋枪），重复值多，配合 WebSocket 压缩几乎不增带宽。
  const bullets = [];
  // 第三值编码：低 4 位 = 武器序号，bit4(0x10) = 红队子弹（绿队为 0）。客户端据此判敌我上色。
  for (const b of world.bullets) bullets.push(Math.round(b.x), Math.round(b.y), (b.wpn || 0) | (b.team === 'red' ? 0x10 : 0));
  return {
    // 注意：不再每帧重发 team/controller/name/color/maxHp，这些在 roster 里，客户端按 id 合并
    fighters: world.fighters.map((f) => ({
      id: f.id, x: Math.round(f.x), y: Math.round(f.y),
      angle: Math.round(f.angle * 1000) / 1000, hp: f.hp, alive: f.alive, inv: f.invuln > 0 ? 1 : 0,
      respawnTimer: f.respawnTimer, grenades: f.grenades, kills: f.kills, deaths: f.deaths,
      w: (WEAPONS[f.weapon] || WEAPONS.pistol).idx, am: (f.ammo === Infinity ? -1 : f.ammo),
      damage: f.damage, streak: f.streak,
    })),
    bullets: bullets,
    grenades: world.grenades.map((g) => ({ x: Math.round(g.x), y: Math.round(g.y), z: Math.round(g.z) })),
    crates: world.crates.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) })),
    hearts: world.hearts.map((h) => ({ x: Math.round(h.x), y: Math.round(h.y) })),
    weapons: world.weaponSpawns.map((wp) => ({ x: Math.round(wp.x), y: Math.round(wp.y), k: WEAPONS[wp.kind].idx, c: wp.central ? 1 : 0 })),
    effects: world.effects.map((e) => ({ x: e.x, y: e.y, life: e.life, maxLife: e.maxLife })),
    flags: flagList(world),
    events: world.soundEvents,
    teamScore: world.teamScore,
    gameOver: world.gameOver, winner: world.winner, countdown: world.countdown,
  };
}

// 旗列表（绿、红 两面；非夺旗模式为空）。state: 0家 1被扛 2掉落；carrier 为携带者 nid。
function flagList(world) {
  if (!world.flags) return [];
  return ['green', 'red'].map((t) => {
    const fl = world.flags[t];
    return { x: Math.round(fl.x), y: Math.round(fl.y), state: FLAG_STATE_NUM[fl.state], carrier: nidOf(world, fl.carrier) };
  });
}

// ============================================================
//  二进制快照（高频 state 用，比 JSON 更省带宽、省 parse 开销）
//  布局见下方注释；客户端 public/js/decode.js 按相同布局解码。
//  单位/事件里引用单位都用 nid（数字 id），客户端再据 roster 还原字符串 id。
// ============================================================
const BIN_VERSION = 1;
// 事件类型枚举（和 decode.js 保持一致）
const EV_CODE = { shot: 1, throw: 2, explode: 3, pickup: 4, heal: 5, hit: 6, death: 7, weapon: 8, multikill: 9 };

function angleToU16(a) {
  // 先归一化到 [-π, π)，避免电脑瞄准抖动让角度略微越界被截断（会丢精度）
  a = a % (2 * Math.PI);
  if (a >= Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  let v = Math.round((a + Math.PI) / (2 * Math.PI) * 65535);
  if (v < 0) v = 0; else if (v > 65535) v = 65535;
  return v;
}
function eventSize(ev) {
  switch (ev.type) {
    case 'shot': return 3;     // type + ownerNid + w
    case 'throw': return 2;    // type + ownerNid
    case 'explode': return 1;  // type
    case 'pickup': return 2;   // type + whoNid
    case 'heal': return 2;     // type + whoNid
    case 'hit': return 5;      // type + victimNid + byNid + w + dmg
    case 'death': return 5;    // type + victimNid + byNid + w + dmg
    case 'weapon': return 3;   // type + whoNid + w
    case 'multikill': return 3; // type + whoNid + n
    default: return 0;
  }
}
// 把 owner/victim/by 这些字符串 id 映射成 nid（找不到给 0）
function nidOf(world, id) {
  if (id == null) return 0;
  const f = world.fighters.find((x) => x.id === id);
  return f ? f.nid : 0;
}

function snapshotBinary(world) {
  const F = world.fighters, B = world.bullets, G = world.grenades;
  const C = world.crates, H = world.hearts, WP = world.weaponSpawns;
  const E = world.effects, EV = world.soundEvents;

  // 先算总长度，精确分配
  let len = 1 + 1 + 1 + 1 + 2 + 2;      // ver + flags + winner + countdown + greenScore + redScore
  len += 1 + F.length * 18;             // 单位（每个 18 字节）
  len += 2 + B.length * 5;              // 子弹 (u16 count)
  len += 1 + G.length * 5;              // 手雷
  len += 1 + C.length * 4;              // 箱子
  len += 1 + H.length * 4;              // 心心
  len += 1 + WP.length * 6;             // 武器拾取（每个 6 字节：x,y,k,central）
  len += 1 + E.length * 6;              // 特效
  const FL = world.flags ? ['green', 'red'].map((t) => world.flags[t]) : [];
  len += 1 + FL.length * 6;             // 旗（每面 6 字节：x,y,state,carrierNid）
  const evList = EV.length > 255 ? EV.slice(0, 255) : EV; // 计数用 u8，最多 255（实际每帧远不到）
  len += 1;                             // 事件 count
  for (const ev of evList) len += eventSize(ev);

  const buf = Buffer.allocUnsafe(len);
  let o = 0;
  buf.writeUInt8(BIN_VERSION, o); o += 1;
  buf.writeUInt8(world.gameOver ? 1 : 0, o); o += 1;
  buf.writeUInt8(world.winner === 'green' ? 1 : (world.winner === 'red' ? 2 : 0), o); o += 1;
  buf.writeUInt8(Math.min(255, world.countdown || 0), o); o += 1;
  buf.writeUInt16LE(Math.min(65535, world.teamScore.green), o); o += 2;
  buf.writeUInt16LE(Math.min(65535, world.teamScore.red), o); o += 2;

  // 单位
  buf.writeUInt8(F.length, o); o += 1;
  for (const f of F) {
    buf.writeUInt8(f.nid & 255, o); o += 1;
    buf.writeUInt16LE(Math.round(f.x) & 65535, o); o += 2;
    buf.writeUInt16LE(Math.round(f.y) & 65535, o); o += 2;
    buf.writeUInt16LE(angleToU16(f.angle), o); o += 2;
    buf.writeUInt8(Math.max(0, Math.min(255, f.hp)), o); o += 1;
    buf.writeUInt8((f.alive ? 1 : 0) | (f.invuln > 0 ? 2 : 0), o); o += 1; // flags：bit0 alive, bit1 出生保护
    buf.writeUInt8(Math.max(0, Math.min(255, f.respawnTimer)), o); o += 1;
    buf.writeUInt8(Math.min(255, f.grenades), o); o += 1;
    buf.writeUInt8(Math.min(255, f.kills), o); o += 1;
    buf.writeUInt8(Math.min(255, f.deaths), o); o += 1;
    buf.writeUInt8((WEAPONS[f.weapon] || WEAPONS.pistol).idx, o); o += 1;
    buf.writeUInt8(f.ammo === Infinity ? 255 : Math.min(254, f.ammo), o); o += 1;
    buf.writeUInt16LE(Math.min(65535, f.damage || 0), o); o += 2;
    buf.writeUInt8(Math.min(255, f.streak || 0), o); o += 1; // 连杀等级（头顶燃特效用）
  }

  // 子弹
  buf.writeUInt16LE(B.length, o); o += 2;
  for (const b of B) {
    buf.writeUInt16LE(Math.round(b.x) & 65535, o); o += 2;
    buf.writeUInt16LE(Math.round(b.y) & 65535, o); o += 2;
    buf.writeUInt8((b.wpn || 0) | (b.team === 'red' ? 0x10 : 0), o); o += 1; // 低4位武器，bit4=红队
  }
  // 手雷
  buf.writeUInt8(G.length, o); o += 1;
  for (const g of G) {
    buf.writeUInt16LE(Math.round(g.x) & 65535, o); o += 2;
    buf.writeUInt16LE(Math.round(g.y) & 65535, o); o += 2;
    buf.writeUInt8(Math.min(255, Math.round(g.z)), o); o += 1;
  }
  // 箱子
  buf.writeUInt8(C.length, o); o += 1;
  for (const c of C) { buf.writeUInt16LE(Math.round(c.x) & 65535, o); o += 2; buf.writeUInt16LE(Math.round(c.y) & 65535, o); o += 2; }
  // 心心
  buf.writeUInt8(H.length, o); o += 1;
  for (const h of H) { buf.writeUInt16LE(Math.round(h.x) & 65535, o); o += 2; buf.writeUInt16LE(Math.round(h.y) & 65535, o); o += 2; }
  // 武器拾取
  buf.writeUInt8(WP.length, o); o += 1;
  for (const wp of WP) { buf.writeUInt16LE(Math.round(wp.x) & 65535, o); o += 2; buf.writeUInt16LE(Math.round(wp.y) & 65535, o); o += 2; buf.writeUInt8(WEAPONS[wp.kind].idx, o); o += 1; buf.writeUInt8(wp.central ? 1 : 0, o); o += 1; }
  // 特效
  buf.writeUInt8(E.length, o); o += 1;
  for (const e of E) { buf.writeUInt16LE(Math.round(e.x) & 65535, o); o += 2; buf.writeUInt16LE(Math.round(e.y) & 65535, o); o += 2; buf.writeUInt8(Math.min(255, e.life), o); o += 1; buf.writeUInt8(Math.min(255, e.maxLife), o); o += 1; }

  // 旗（绿、红）
  buf.writeUInt8(FL.length, o); o += 1;
  for (const fl of FL) {
    buf.writeUInt16LE(Math.round(fl.x) & 65535, o); o += 2;
    buf.writeUInt16LE(Math.round(fl.y) & 65535, o); o += 2;
    buf.writeUInt8(FLAG_STATE_NUM[fl.state], o); o += 1;
    buf.writeUInt8(nidOf(world, fl.carrier), o); o += 1;
  }

  // 事件
  buf.writeUInt8(evList.length, o); o += 1;
  for (const ev of evList) {
    const code = EV_CODE[ev.type] || 0;
    if (!code) continue;
    buf.writeUInt8(code, o); o += 1;
    switch (ev.type) {
      case 'shot': buf.writeUInt8(nidOf(world, ev.ownerId), o); o += 1; buf.writeUInt8(ev.w || 0, o); o += 1; break;
      case 'throw': buf.writeUInt8(nidOf(world, ev.ownerId), o); o += 1; break;
      case 'explode': break;
      case 'pickup': buf.writeUInt8(nidOf(world, ev.who), o); o += 1; break;
      case 'heal': buf.writeUInt8(nidOf(world, ev.who), o); o += 1; break;
      case 'hit': buf.writeUInt8(nidOf(world, ev.victim), o); o += 1; buf.writeUInt8(nidOf(world, ev.by), o); o += 1; buf.writeUInt8(ev.w || 0, o); o += 1; buf.writeUInt8(Math.min(255, ev.dmg || 0), o); o += 1; break;
      case 'death': buf.writeUInt8(nidOf(world, ev.victim), o); o += 1; buf.writeUInt8(nidOf(world, ev.by), o); o += 1; buf.writeUInt8(ev.w || 0, o); o += 1; buf.writeUInt8(Math.min(255, ev.dmg || 0), o); o += 1; break;
      case 'weapon': buf.writeUInt8(nidOf(world, ev.who), o); o += 1; buf.writeUInt8(ev.w || 0, o); o += 1; break;
      case 'multikill': buf.writeUInt8(nidOf(world, ev.who), o); o += 1; buf.writeUInt8(Math.min(255, ev.n || 0), o); o += 1; break;
    }
  }

  return buf.subarray(0, o);
}

// 开局发给客户端的静态信息（地图 + 渲染用常量）
function mapConfig(world) {
  return {
    width: world.width, height: world.height, walls: world.walls,
    mapName: world.mapName, teamGreen: world.teamGreen, teamRed: world.teamRed,
    bulletRadius: BULLET_RADIUS, crateHalf: CRATE_HALF, heartHalf: HEART_HALF, explosionRadius: EXPLOSION_RADIUS,
    weaponHalf: WEAPON_HALF,
    targetScore: world.targetScore,
    mode: world.mode, ladderLen: GUNGAME_LADDER.length, // 游戏模式 + 军备梯长度（客户端显示进度）
    zone: world.zone || null, // 占点圈（仅 koth）
    greenBase: world.greenBase, redBase: world.redBase, // 基地位置（夺旗画旗座）
  };
}

// 大厅用：地图列表（带墙体，方便客户端画缩略预览）
function mapList() {
  return MAPS.map((m, i) => ({
    index: i, name: m.name, width: m.width, height: m.height, walls: m.walls, random: !!m.random,
  }));
}

// ---------- 中途加入：把新玩家安排进对战 ----------
// 在某队基地附近找个出生点
function spawnNearBase(world, team) {
  const base = team === 'green' ? world.greenBase : world.redBase;
  for (let i = 0; i < 30; i++) {
    const x = Math.max(30, Math.min(world.width - 30, base.x + (Math.random() * 2 - 1) * 60));
    const y = Math.max(30, Math.min(world.height - 30, base.y + (Math.random() * 2 - 1) * 130));
    if (!hitsAnyWall(world, x, y, 20)) return { x: x, y: y };
  }
  return { x: base.x, y: base.y };
}

// 把一个中途加入的真人安排进对战：
//  1) 选人少的一队（先看总人数，再看真人数）
//  2) 那队有电脑就顶替电脑；没有就新增一个真人单位（队伍因此变大）
// 返回他控制的单位。这样新人永远不用观战。
function assignJoiner(world, id, name) {
  const green = world.fighters.filter((f) => f.team === 'green');
  const red = world.fighters.filter((f) => f.team === 'red');

  let team;
  if (green.length !== red.length) {
    team = green.length < red.length ? 'green' : 'red';
  } else {
    const gh = green.filter((f) => f.controller === 'human').length;
    const rh = red.filter((f) => f.controller === 'human').length;
    team = gh <= rh ? 'green' : 'red';
  }

  // 那队有电脑就顶替（不增加人数）
  const bot = world.fighters.find((f) => f.controller === 'bot' && f.team === team);
  if (bot) {
    bot.controller = 'human';
    bot.id = id;
    bot.name = name;
    bot.color = team === 'green' ? '#5fd35f' : '#ff7a7a';
    return bot;
  }

  // 没电脑位：新增一个真人单位到这队（分配新的 nid）
  const spot = spawnNearBase(world, team);
  const f = createFighter(id, spot.x, spot.y, team, 'human', name);
  f.nid = world._nextNid++;
  world.fighters.push(f);
  return f;
}

// 本帧新锁定的复活点列表（server 用来私密下发给各自本人）
function respawnAssignments(world) {
  return world.respawnAssigned || [];
}

module.exports = {
  createWorld, updateWorld, snapshot, snapshotBinary, roster, mapConfig, mapList, MAPS,
  EMPTY_INPUT, assignJoiner, respawnAssignments,
};
