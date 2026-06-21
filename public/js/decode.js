// ============================================================
//  decode.js —— 解码服务器发来的二进制 state 快照
//  布局必须和 server/world.js 的 snapshotBinary 完全一致。
//  解码结果与 JSON 路径"合并 roster 之后"的快照对象同形，
//  所以 render / hud / 插值代码完全不用改。
//  双模：浏览器里是全局函数 decodeState；Node 里 module.exports（给测试用）。
// ============================================================
(function (root) {
  var EV_NAME = { 1: 'shot', 2: 'throw', 3: 'explode', 4: 'pickup', 5: 'heal', 6: 'hit', 7: 'death', 8: 'weapon', 9: 'multikill' };

  // data: ArrayBuffer 或 类型化数组/Buffer；rosterByNid: nid -> 静态信息（含字符串 id）
  function decodeState(data, rosterByNid) {
    var dv;
    if (data instanceof ArrayBuffer) dv = new DataView(data);
    else dv = new DataView(data.buffer, data.byteOffset || 0, data.byteLength); // 兼容 Buffer/TypedArray
    var o = 0;
    var u8 = function () { var v = dv.getUint8(o); o += 1; return v; };
    var u16 = function () { var v = dv.getUint16(o, true); o += 2; return v; };

    function idOf(nid) {
      if (!nid) return null;
      var r = rosterByNid && rosterByNid[nid];
      return r ? r.id : nid;
    }

    u8(); // version（暂未用）
    var gameOver = u8() === 1;
    var winCode = u8();
    var winner = winCode === 1 ? 'green' : (winCode === 2 ? 'red' : null);
    var countdown = u8();
    var greenScore = u16();
    var redScore = u16();

    // 单位
    var fighters = [];
    var fn = u8();
    for (var i = 0; i < fn; i++) {
      var nid = u8();
      var x = u16(), y = u16();
      var angle = (u16() / 65535) * (2 * Math.PI) - Math.PI;
      var hp = u8();
      var flags = u8();
      var alive = (flags & 1) === 1;
      var inv = (flags & 2) !== 0 ? 1 : 0;
      var respawnTimer = u8();
      var grenades = u8();
      var kills = u8();
      var deaths = u8();
      var w = u8();
      var rawAm = u8();
      var am = rawAm === 255 ? -1 : rawAm;
      var damage = u16();
      var streak = u8();
      var r = rosterByNid ? rosterByNid[nid] : null;
      fighters.push({
        id: r ? r.id : nid,
        x: x, y: y, angle: angle, hp: hp, alive: alive, inv: inv,
        respawnTimer: respawnTimer, grenades: grenades, kills: kills, deaths: deaths,
        w: w, am: am, damage: damage, streak: streak,
        team: r ? r.team : undefined,
        name: r ? r.name : undefined,
        color: r ? r.color : undefined,
        controller: r ? r.controller : undefined,
        maxHp: r ? r.maxHp : 100,
      });
    }

    // 子弹
    var bullets = [];
    var bn = u16();
    for (var b = 0; b < bn; b++) { var bx = u16(), by = u16(), bcode = u8(); bullets.push({ x: bx, y: by, w: bcode & 0x0f, team: (bcode & 0x10) ? 'red' : 'green' }); }
    // 手雷
    var grenades2 = [];
    var gn = u8();
    for (var gi = 0; gi < gn; gi++) { var gx = u16(), gy = u16(), gz = u8(); grenades2.push({ x: gx, y: gy, z: gz }); }
    // 箱子
    var crates = [];
    var cn = u8();
    for (var ci = 0; ci < cn; ci++) { var cx = u16(), cy = u16(); crates.push({ x: cx, y: cy }); }
    // 心心
    var hearts = [];
    var hn = u8();
    for (var hi = 0; hi < hn; hi++) { var hx = u16(), hy = u16(); hearts.push({ x: hx, y: hy }); }
    // 武器拾取
    var weapons = [];
    var wn = u8();
    for (var wi = 0; wi < wn; wi++) { var wx = u16(), wy = u16(), wk = u8(), wc = u8(); weapons.push({ x: wx, y: wy, k: wk, c: wc }); }
    // 特效
    var effects = [];
    var en = u8();
    for (var ei = 0; ei < en; ei++) { var ex = u16(), ey = u16(), el = u8(), em = u8(); effects.push({ x: ex, y: ey, life: el, maxLife: em }); }

    // 旗（绿、红）：state 0家 1被扛 2掉落；carrier 还原成字符串 id
    var flags = [];
    var fn = u8();
    for (var fi = 0; fi < fn; fi++) {
      var flx = u16(), fly = u16(), fstate = u8(), fcar = u8();
      flags.push({ team: fi === 0 ? 'green' : 'red', x: flx, y: fly, state: fstate, carrier: idOf(fcar) });
    }

    // 事件
    var events = [];
    var vn = u8();
    for (var vi = 0; vi < vn; vi++) {
      var type = EV_NAME[u8()];
      if (type === 'shot') events.push({ type: type, ownerId: idOf(u8()), w: u8() });
      else if (type === 'throw') events.push({ type: type, ownerId: idOf(u8()) });
      else if (type === 'explode') events.push({ type: type });
      else if (type === 'pickup') events.push({ type: type, who: idOf(u8()) });
      else if (type === 'heal') events.push({ type: type, who: idOf(u8()) });
      else if (type === 'hit') events.push({ type: type, victim: idOf(u8()), by: idOf(u8()), w: u8(), dmg: u8() });
      else if (type === 'death') events.push({ type: type, victim: idOf(u8()), by: idOf(u8()), w: u8(), dmg: u8() });
      else if (type === 'weapon') events.push({ type: type, who: idOf(u8()), w: u8() });
      else if (type === 'multikill') events.push({ type: type, who: idOf(u8()), n: u8() });
    }

    return {
      fighters: fighters, bullets: bullets, grenades: grenades2,
      crates: crates, hearts: hearts, weapons: weapons, effects: effects,
      flags: flags,
      events: events,
      teamScore: { green: greenScore, red: redScore },
      gameOver: gameOver, winner: winner, countdown: countdown,
    };
  }

  root.decodeState = decodeState;
  if (typeof module !== 'undefined' && module.exports) module.exports = { decodeState: decodeState };
})(typeof window !== 'undefined' ? window : this);
