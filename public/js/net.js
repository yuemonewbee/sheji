// ============================================================
//  net.js —— 客户端网络层
//  负责：连接服务器、收消息（大厅/开始/快照）、发消息（输入/手雷/大厅操作）。
//  其它代码通过 net.xxx 读取最新状态，不直接碰 WebSocket。
// ============================================================

const net = {
  ws: null,
  youId: null,        // 服务器分给我的玩家 id
  isHost: false,
  roomCode: null,      // 当前所在房间号（未进房间为 null）
  playerName: null,    // 名字弹窗里填的名字，创建/加入房间时一并发给服务器
  yourFighterId: null, // 我在战场上控制的单位 id（观战时为 null）
  config: null,        // 开局静态信息：地图、墙、常量
  state: null,         // 最新世界快照（HUD 用）
  snapshots: [],       // 最近若干张快照（带到达时间），用于插值平滑
  rosterById: {},      // 单位静态信息（队伍/名字/颜色/控制者/maxHp），按 id 索引，收到快照时合并
  rosterByNid: {},     // 同上，按 nid（数字 id）索引，给二进制快照解码用
  yourNid: null,       // 我的 nid
  myRespawn: null,     // 我本次的复活点 {x,y}（服务器私密下发，仅本人可见）
  lobby: null,         // 大厅信息：玩家列表、设置、地图列表
  _playedEnd: false,   // 是否已播过本局胜负音

  // 外部可设置的回调
  onLobby: null,
  onStarted: null,
  onRoomJoined: null,  // 成功创建/加入房间
  onJoinError: null,   // 加入房间失败（房间号不存在等）
  onLeftRoom: null,    // 离开房间，回到落地页
  onRoomList: null,    // 落地页房间列表更新
  roomList: [],        // 最新房间列表
};

// 持久身份令牌：存在 localStorage，刷新/重连后用它找回原房间与单位
function getToken() {
  let t = null;
  try { t = localStorage.getItem('shooterToken'); } catch (e) {}
  if (!t) {
    t = 'tk_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('shooterToken', t); } catch (e) {}
  }
  return t;
}

function netConnect() {
  // 用当前网页的主机名连同一台服务器。
  // 关键：页面是 https 时必须用 wss（加密 WebSocket），否则浏览器会拦截。
  // 这样 localhost(http→ws)、局域网IP(http→ws)、ngrok外网(https→wss) 都能自动对上。
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const url = proto + location.host;
  net.ws = new WebSocket(url);
  net.ws.binaryType = 'arraybuffer'; // 二进制快照按 ArrayBuffer 收

  net.ws.addEventListener('open', () => {
    // 一连上就报到：带上 token，服务器若发现你有正在进行的房间就直接把你拉回去
    netSend({ type: 'hello', token: getToken() });
  });

  net.ws.addEventListener('message', (ev) => {
    // 二进制帧 = state 快照；其余都是 JSON 文本
    if (ev.data instanceof ArrayBuffer) {
      ingestSnapshot(decodeState(ev.data, net.rosterByNid));
      return;
    }
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleMessage(msg);
  });

  net.ws.addEventListener('close', () => {
    console.log('与服务器断开连接');
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      net.youId = msg.youId;
      break;
    case 'roomJoined':
      net.roomCode = msg.code;
      if (net.onRoomJoined) net.onRoomJoined(msg);
      break;
    case 'joinError':
      if (net.onJoinError) net.onJoinError(msg.reason);
      break;
    case 'roomList':
      net.roomList = msg.rooms || [];
      if (net.onRoomList) net.onRoomList(msg);
      break;
    case 'leftRoom':
      net.roomCode = null;
      net.config = null; net.state = null; net.yourFighterId = null;
      net.snapshots = []; net.rosterById = {};
      if (net.onLeftRoom) net.onLeftRoom();
      break;
    case 'lobby': {
      net.lobby = msg;
      // 关键：每次大厅更新都重新确认自己是不是房主（房主可能因别人掉线而转交给我）
      const me = msg.players.find((p) => p.id === net.youId);
      if (me) net.isHost = me.isHost;
      if (net.onLobby) net.onLobby(msg);
      break;
    }
    case 'started':
      net.config = msg.config;
      net.yourFighterId = msg.yourFighterId;
      net.snapshots = []; // 清空插值缓冲，避免沿用上一局的位置
      net.state = null;
      net.myRespawn = null; // 清掉上一局残留的复活点预览
      if (net.onStarted) net.onStarted(msg);
      break;
    case 'respawnPoint':
      // 服务器私密告知我本次的复活点（对手收不到这条），死亡期间预览用
      net.myRespawn = { x: msg.x, y: msg.y };
      break;
    case 'roster': {
      // 名册更新：重建 id->静态信息 与 nid->静态信息 两张映射，并算出"我"的 nid
      net.rosterById = {};
      net.rosterByNid = {};
      for (const r of msg.roster) {
        net.rosterById[r.id] = r;
        if (r.nid != null) net.rosterByNid[r.nid] = r;
      }
      const mine = net.rosterById[net.yourFighterId];
      net.yourNid = mine ? mine.nid : null;
      break;
    }
    case 'state': {
      // 兜底：万一某帧仍走 JSON（一般不会，state 都走二进制了）
      const snap = msg.snapshot;
      for (const f of snap.fighters) {
        const r = net.rosterById[f.id];
        if (r) { f.team = r.team; f.name = r.name; f.color = r.color; f.controller = r.controller; f.maxHp = r.maxHp; }
      }
      const bf = snap.bullets;
      if (bf && bf.length && typeof bf[0] === 'number') {
        const arr = [];
        for (let i = 0; i < bf.length; i += 3) { const code = bf[i + 2]; arr.push({ x: bf[i], y: bf[i + 1], w: code & 0x0f, team: (code & 0x10) ? 'red' : 'green' }); }
        snap.bullets = arr;
      }
      ingestSnapshot(snap);
      break;
    }
  }
}

// 收到一张（已还原好的）快照：存入插值缓冲、刷新 net.state、触发音效。
// 二进制路径和 JSON 兜底路径都汇到这里。
function ingestSnapshot(snap) {
  net.state = snap;
  net.snapshots.push({ t: performance.now(), snap: snap });
  if (net.snapshots.length > 6) net.snapshots.shift();
  handleSoundEvents(snap);
}

// ---------- 插值：返回"补间后的画面" ----------
const RENDER_DELAY = 160; // 故意落后 160ms 渲染：服务器广播降到 15Hz（约 66ms 一帧），
                          // 留 ~2 帧缓冲来插值平滑、抵消网络抖动（外网越抖可调大）

// 角度按最短路径插值（避免从 +179° 到 -179° 绕一大圈）
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// 计算当前应该渲染的画面：在两张快照间按时间补间
function netGetView() {
  const buf = net.snapshots;
  if (buf.length === 0) return null;
  const latest = buf[buf.length - 1].snap;
  if (buf.length === 1) return latest;

  const renderTime = performance.now() - RENDER_DELAY;

  // 找到时间上"夹住" renderTime 的相邻两张快照 a(早) / b(晚)
  let a = buf[0], b = buf[buf.length - 1];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i].t <= renderTime && renderTime <= buf[i + 1].t) {
      a = buf[i]; b = buf[i + 1]; break;
    }
  }
  let alpha = (b.t - a.t > 0) ? (renderTime - a.t) / (b.t - a.t) : 1;
  alpha = Math.max(0, Math.min(1, alpha));

  // 只对战斗单位的位置/朝向做插值；子弹/手雷/箱子等直接用最新（够快或静止）
  const oldById = {};
  for (const f of a.snap.fighters) oldById[f.id] = f;

  const fighters = b.snap.fighters.map(function(nf) {
    const of = oldById[nf.id];
    // 两帧都活着、且没发生瞬移（复活/重生）才插值，否则直接用新位置
    if (of && of.alive && nf.alive && Math.hypot(nf.x - of.x, nf.y - of.y) < 200) {
      return Object.assign({}, nf, {
        x: of.x + (nf.x - of.x) * alpha,
        y: of.y + (nf.y - of.y) * alpha,
        angle: lerpAngle(of.angle, nf.angle, alpha),
      });
    }
    return nf;
  });

  return {
    fighters: fighters,
    bullets: latest.bullets,
    grenades: latest.grenades,
    crates: latest.crates,
    hearts: latest.hearts,
    weapons: latest.weapons,
    flags: latest.flags,
    effects: latest.effects,
    teamScore: latest.teamScore,
    gameOver: latest.gameOver,
    winner: latest.winner,
    countdown: latest.countdown,
  };
}

// ---------- 发送给服务器的各种动作 ----------
function netSend(obj) {
  if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(obj));
}

// 在受害者位置飘一个伤害/击杀数字（只在"你造成伤害"时调用）
function popDamage(snap, ev, kill) {
  if (typeof spawnDamagePop !== 'function' || !ev.dmg) return;
  const v = snap.fighters.find((f) => f.id === ev.victim);
  if (v) spawnDamagePop(ev.victim, v.x, v.y, ev.dmg, kill);
}

// 根据快照里的事件播放音效
function handleSoundEvents(snap) {
  if (snap.events) {
    let shots = 0;
    for (const ev of snap.events) {
      switch (ev.type) {
        case 'shot':
          // 同帧多人开枪时最多播 3 声，避免嘈杂；自己的枪声更响
          if (shots < 3) { SFX.shootWeapon(ev.w || 0, ev.ownerId === net.yourFighterId ? 0.35 : 0.16); shots++; }
          break;
        case 'weapon': SFX.weaponPickup(); break;
        case 'throw': SFX.throwNade(); break;
        case 'explode': SFX.explode(); break;
        case 'pickup': SFX.pickup(); break;
        case 'heal': SFX.heal(); break;
        case 'hit':
          if (ev.victim === net.yourFighterId) { SFX.hurt(); triggerHurtFlash(0.35); } // 你被打中：小闪
          else if (ev.by === net.yourFighterId) { SFX.hitmarker(); popDamage(snap, ev, false); } // 你打中敌人：飘伤害字
          break;
        case 'death':
          if (ev.victim === net.yourFighterId) {
            SFX.death();
            triggerHurtFlash(ev.w === 3 ? 0.8 : 0.55); // 你阵亡：狙击一枪带走闪得更狠
          } else if (ev.by === net.yourFighterId) {
            if (ev.w === 3) SFX.snipeKill(); else SFX.kill(); // 你击杀：狙杀用更重的音
            popDamage(snap, ev, true); // 你击杀：飘一个更醒目的击杀字
          }
          // 每次有人阵亡都滚一条击杀提示（不只你的）
          if (typeof pushKillFeed === 'function') pushKillFeed(ev.by, ev.victim, ev.w);
          break;
        case 'multikill':
          // 连杀播报：你自己的连杀播语音 + 全员看 kill feed 大字
          if (ev.who === net.yourFighterId) SFX.multikill(ev.n);
          if (typeof pushMultiKillFeed === 'function') pushMultiKillFeed(ev.who, ev.n);
          break;
      }
    }
  }
  // 胜负音：只在刚分出胜负时播一次
  if (snap.gameOver && !net._playedEnd) {
    net._playedEnd = true;
    const me = net.yourFighterId ? snap.fighters.find((f) => f.id === net.yourFighterId) : null;
    if (me && snap.winner === me.team) SFX.win();
    else if (me) SFX.lose();
  }
  if (!snap.gameOver) net._playedEnd = false;
}

function netSendInput(inp) {
  netSend({
    type: 'input',
    up: inp.up, down: inp.down, left: inp.left, right: inp.right,
    aimX: inp.aimX, aimY: inp.aimY, shoot: inp.shoot,
  });
}
function netThrow(x, y) { netSend({ type: 'throw', x: x, y: y }); }

function netCreateRoom() { netSend({ type: 'createRoom', name: net.playerName || '' }); }
function netJoinRoom(code) { netSend({ type: 'joinRoom', code: code, name: net.playerName || '' }); }
function netLeaveRoom() { netSend({ type: 'leaveRoom' }); }

function netSetName(name) { netSend({ type: 'setName', name: name }); }
function netSetTeam(team) { netSend({ type: 'setTeam', team: team }); }
// 部分更新房间设置：只发传入的字段（服务器按字段合并），patch = {mapIndex?,teamGreen?,teamRed?,mode?,randomSize?}
function netSetSettings(patch) { netSend(Object.assign({ type: 'setSettings' }, patch || {})); }
function netStart() { netSend({ type: 'start' }); }
function netRestart() { netSend({ type: 'restart' }); }
function netToLobby() { netSend({ type: 'toLobby' }); }
