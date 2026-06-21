// ============================================================
//  server.js —— 游戏服务器
//   1) 把 public/ 里的网页发给浏览器（静态服务）
//   2) WebSocket：单个共享房间 + 大厅 + 30tick 权威模拟 + 广播快照
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const game = require('./world');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// ---------- 静态网页服务 ----------
const server = http.createServer((req, res) => {
  // 只取路径部分、并解码（%2e 之类），畸形编码直接 400
  let reqPath;
  try { reqPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 错误的请求');
    return;
  }
  const urlPath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));

  // 防路径穿越：解析后必须仍落在 PUBLIC_DIR 内，否则拒绝
  // （否则 /../server/world.js 之类能把服务器源码读走）
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 禁止访问');
    return;
  }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 找不到文件: ' + urlPath);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============================================================
//  多房间管理：每个房间有独立的 4 位房间号、玩家、世界与模拟
// ============================================================
const rooms = new Map();   // code -> room
const wsRoom = new Map();  // ws -> 它所在的 room（方便反查）
const sessions = new Map();// token -> { pid, name, team, roomCode }，用于刷新/掉线后重连保持身份
const GRACE_MS = 45000;    // 房间因掉线变空后保留多久，等原玩家重连回来
let nextId = 1;

// 记录/更新某 ws 的会话（用它的持久 token 作键）
function saveSession(ws, room, client) {
  if (!ws._token) return;
  sessions.set(ws._token, { pid: client.id, name: client.name, team: client.team, roomCode: room.code });
}

// 生成一个不重复的 4 位房间号（去掉易混淆字符）
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 I O 0 1
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: genCode(),
    phase: 'lobby',           // 'lobby' 或 'playing'
    settings: { mapIndex: 0, teamGreen: 2, teamRed: 2, mode: 'tdm', randomSize: 'any' }, // 两队人数可不同 + 模式 + 随机图尺寸档
    clients: new Map(),       // ws -> { id, name, team, isHost }
    hostId: null,
    world: null,
    inputs: {},               // fighterId -> 输入对象（仅真人）
    tickCount: 0,
  };
  rooms.set(room.code, room);
  return room;
}

// 给某房间内所有客户端发消息
function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}
function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
// 给某房间所有客户端发二进制帧（高频 state 快照用）
function broadcastBinary(room, buf) {
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf, { binary: true });
  }
}

// 在某房间里给新玩家分队：哪队人少进哪队
function assignTeam(room) {
  let green = 0, red = 0;
  for (const c of room.clients.values()) {
    if (c.team === 'green') green++; else red++;
  }
  return green <= red ? 'green' : 'red';
}

// 房间内所有玩家的简表（发给大厅显示）
function playerList(room) {
  return Array.from(room.clients.values()).map((c) => ({
    id: c.id, name: c.name, team: c.team, isHost: c.isHost,
  }));
}

// 广播某房间的大厅状态（带上房间号，客户端用来显示）
function sendLobby(room) {
  broadcast(room, {
    type: 'lobby',
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    maps: game.mapList(),
    players: playerList(room),
  });
}

// 广播某房间的单位静态名册（开局/有人加入/改名/掉线变电脑时才发，不必每帧）
function broadcastRoster(room) {
  if (room.world) broadcast(room, { type: 'roster', roster: game.roster(room.world) });
}

// ---------- 房间列表（发给还在落地页、没进任何房间的客户端）----------
function hostName(room) {
  for (const c of room.clients.values()) if (c.id === room.hostId) return c.name;
  return '';
}
function roomSummaries() {
  return Array.from(rooms.values())
    .filter((r) => r.clients.size > 0) // 宽限期里的空房先不显示
    .map((r) => ({
      code: r.code,
      count: r.clients.size,
      phase: r.phase,
      host: hostName(r),
      teamGreen: r.settings.teamGreen,
      teamRed: r.settings.teamRed,
      mode: r.settings.mode,
    }));
}
function sendRoomList(ws) {
  sendTo(ws, { type: 'roomList', rooms: roomSummaries() });
}
// 房间有任何增删/人数/状态变化时，推给所有落地页客户端
function broadcastRoomList() {
  const text = JSON.stringify({ type: 'roomList', rooms: roomSummaries() });
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && !wsRoom.has(ws)) ws.send(text);
  }
}

// ---------- 开始一局 ----------
function startGame(room) {
  // 收集所有真人，按各自队伍组成 humans 列表
  const humans = Array.from(room.clients.values()).map((c) => ({ id: c.id, team: c.team, name: c.name }));
  const greenH = humans.filter((h) => h.team === 'green').length;
  const redH = humans.filter((h) => h.team === 'red').length;
  // 两队人数可不同；每队至少要能装下该队真人（不足的名额用电脑补满）
  const teamGreen = Math.max(room.settings.teamGreen, greenH, 1);
  const teamRed = Math.max(room.settings.teamRed, redH, 1);

  const randomSize = ['small', 'medium', 'large'].indexOf(room.settings.randomSize) >= 0 ? room.settings.randomSize : undefined;
  room.world = game.createWorld({ mapIndex: room.settings.mapIndex, teamGreen: teamGreen, teamRed: teamRed, mode: room.settings.mode, randomSize: randomSize, humans: humans });
  room.inputs = {};
  for (const f of room.world.fighters) {
    if (f.controller === 'human') room.inputs[f.id] = Object.assign({}, game.EMPTY_INPUT);
  }
  room.phase = 'playing';

  // 给每个客户端发"开始"：地图配置 + 你控制哪个单位（用自己的 id）
  const config = game.mapConfig(room.world);
  for (const [ws, c] of room.clients) {
    const myFighter = room.world.fighters.find((f) => f.id === c.id);
    sendTo(ws, { type: 'started', config: config, yourFighterId: myFighter ? c.id : null });
  }
  broadcastRoster(room); // 开局先发一次名册，客户端拿到后才能合并出完整单位
  broadcastRoomList();   // 该房进入"进行中"，更新落地页列表
}

// 某房间回到大厅
function toLobby(room) {
  room.phase = 'lobby';
  room.world = null;
  room.inputs = {};
  sendLobby(room);
  broadcastRoomList(); // 状态变回"等待中"，更新列表
}

// ---------- 进出房间 ----------
// code 为 null = 新建房间；否则加入指定房间号。name 是玩家在名字弹窗里填的名字。
function joinFlow(ws, code, name) {
  if (wsRoom.has(ws)) removeFromRoom(ws); // 已在别的房间则先退出

  let room;
  if (code == null) {
    room = createRoom();
  } else {
    code = String(code).trim().toUpperCase();
    room = rooms.get(code);
    if (!room) { sendTo(ws, { type: 'joinError', reason: '房间号不存在：' + code }); return; }
  }

  if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; } // 有人进来，取消空房销毁

  const isHost = room.clients.size === 0;
  if (isHost) room.hostId = ws._pid;
  const cleanName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 12) : '玩家' + ws._pid.slice(1);
  const client = { id: ws._pid, name: cleanName, team: assignTeam(room), isHost: isHost };
  room.clients.set(ws, client);
  wsRoom.set(ws, room);

  sendTo(ws, { type: 'roomJoined', code: room.code });

  // 中途加入正在进行的对战：直接安排进人少的一队，绝不观战
  if (room.phase === 'playing' && room.world) {
    const f = game.assignJoiner(room.world, client.id, client.name);
    client.team = f.team;
    room.inputs[client.id] = Object.assign({}, game.EMPTY_INPUT);
    sendTo(ws, { type: 'started', config: game.mapConfig(room.world), yourFighterId: client.id });
    broadcastRoster(room);
  }

  saveSession(ws, room, client); // 记下会话，便于刷新后重连
  sendLobby(room);
  broadcastRoomList(); // 新房创建 / 人数变化，更新落地页列表
}

// ---------- 重连：用旧会话回到原房间、认领回原来的单位 ----------
function resumeIntoRoom(ws, room, s) {
  if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
  ws._pid = s.pid; // 复用旧 id，战场单位才能对上
  sendTo(ws, { type: 'welcome', youId: ws._pid }); // 纠正 youId 为旧 id

  if (room.hostId == null) room.hostId = s.pid; // 你掉线时是独自一人、房主置空了，回来就还当房主
  const isHost = room.hostId === s.pid;
  const client = { id: s.pid, name: s.name, team: s.team || assignTeam(room), isHost: isHost };
  room.clients.set(ws, client);
  wsRoom.set(ws, room);

  sendTo(ws, { type: 'roomJoined', code: room.code, resumed: true });

  if (room.world) {
    let f = room.world.fighters.find((x) => x.id === s.pid);
    if (f) {
      // 找回你的单位（掉线时变成了电脑），改回真人
      f.controller = 'human';
      f.name = s.name;
      f.color = f.team === 'green' ? '#5fd35f' : '#ff7a7a';
      client.team = f.team;
    } else {
      // 你原来的单位已不在（掉线期间重开了一局）：当作中途加入安排一个
      f = game.assignJoiner(room.world, s.pid, s.name);
      client.team = f.team;
    }
    room.inputs[s.pid] = Object.assign({}, game.EMPTY_INPUT);
    sendTo(ws, { type: 'started', config: game.mapConfig(room.world), yourFighterId: s.pid });
    broadcastRoster(room);
  }

  saveSession(ws, room, client);
  sendLobby(room);
  broadcastRoomList();
}

// 把一个 ws 从它所在房间移除。
//   keepSession=true（掉线）：保留会话，房间若变空给一段宽限期等重连
//   keepSession=false（主动退出）：清掉会话，房间变空立即销毁
function removeFromRoom(ws, keepSession) {
  const room = wsRoom.get(ws);
  wsRoom.delete(ws);
  if (!room) return;
  const c = room.clients.get(ws);
  if (!c) return;
  room.clients.delete(ws);
  delete room.inputs[c.id];

  // 对战中离开：单位交给电脑接管
  if (room.world) {
    const f = room.world.fighters.find((x) => x.id === c.id);
    if (f) { f.controller = 'bot'; f.name = '电脑'; f.color = c.team === 'green' ? '#2f8f3f' : '#e05050'; }
    broadcastRoster(room);
  }

  // 房主走了，转交给下一个人
  if (c.id === room.hostId) {
    const next = room.clients.values().next().value;
    if (next) { next.isHost = true; room.hostId = next.id; }
    else room.hostId = null;
  }

  // 房间空了
  if (room.clients.size === 0) {
    if (keepSession) {
      // 掉线导致空房：保留 GRACE_MS，等原玩家重连；超时再销毁
      room.emptyTimer = setTimeout(() => { rooms.delete(room.code); broadcastRoomList(); }, GRACE_MS);
    } else {
      rooms.delete(room.code); // 主动退出且空了：直接销毁
    }
    broadcastRoomList();
    return;
  }
  sendLobby(room);
  broadcastRoomList(); // 人数/房主变化，更新落地页列表
}

// ---------- 游戏主循环 ----------
// 模拟仍固定 30 次/秒（手感、命中判定不变），但广播降到 15 次/秒（每 2 个 tick 发一次）。
// 下行带宽 ≈ 快照 × 客户端数 × 频率，这是"人一多就卡"的主因，减半频率直接省一半带宽；
// 客户端本来就用插值平滑，15Hz 完全够看。
const TICK_MS = 1000 / 30;

// 跑一帧：遍历所有进行中的房间，各自独立模拟 + 该发就发
function stepAllRooms() {
  for (const room of rooms.values()) {
    if (room.phase !== 'playing' || !room.world) continue;
    // 兜底：任何一帧模拟/打包出错，只跳过这一帧并记录，绝不让整服崩、全员掉线
    try {
      game.updateWorld(room.world, room.inputs);
      // 私密下发：谁本帧刚死、锁定了复活点，就只发给他本人（对手收不到，无法预知你的复活点）
      const assigns = game.respawnAssignments(room.world);
      if (assigns.length) {
        for (const a of assigns) {
          for (const [ws, c] of room.clients) {
            if (c.id === a.id) { sendTo(ws, { type: 'respawnPoint', x: a.x, y: a.y }); break; }
          }
        }
      }
      if (++room.tickCount % 2 === 0) {
        broadcastBinary(room, game.snapshotBinary(room.world)); // 高频快照走二进制，省带宽
        room.world.soundEvents = []; // 发完即清空；不发的那一 tick 事件会累积到下次一起发，不丢音效
      }
    } catch (e) {
      console.error('[tick] 房间', room.code, '本帧出错，已跳过：', e);
    }
  }
}

// 抗漂移循环：定时器跑得比一帧快，靠"真实经过的时间"决定补几帧，
// 长期把模拟频率精确锁在 30Hz（不随每帧耗时/系统繁忙而越跑越慢）。
const MAX_CATCHUP = 5; // 一次最多补 5 帧，防止机器极卡时补帧雪崩（"死亡螺旋"）
let lastTickAt = Date.now();
let tickAcc = 0;
setInterval(() => {
  const now = Date.now();
  tickAcc += now - lastTickAt;
  lastTickAt = now;
  let steps = 0;
  while (tickAcc >= TICK_MS && steps < MAX_CATCHUP) {
    stepAllRooms();
    tickAcc -= TICK_MS;
    steps++;
  }
  // 落后太多（进程被挂起/长时间极卡）就丢弃积压，从当下重新对齐，避免一口气补几百帧
  if (tickAcc > TICK_MS * MAX_CATCHUP) tickAcc = 0;
}, 8); // 8ms < 33.33ms，确保时间分辨率足够，真正的节奏由累加器决定

// ============================================================
//  WebSocket 连接处理
// ============================================================
// 开启 WebSocket 压缩：状态快照是 JSON 文本，压缩率高，进一步降下行带宽。
// threshold 以下的小消息不压缩（压缩反而不划算）。浏览器原生支持，自动协商。
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: { threshold: 256 },
});

wss.on('connection', (ws) => {
  ws._pid = 'p' + (nextId++);                  // 全局唯一玩家 id（跨房间）
  sendTo(ws, { type: 'welcome', youId: ws._pid }); // 此时还没进任何房间，客户端去落地页创建/加入
  sendRoomList(ws);                            // 落地页立刻看到当前房间列表

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    handleMessage(ws, msg);
  });

  ws.on('close', () => { removeFromRoom(ws, true); }); // 掉线：保留会话，给重连机会
});

function handleMessage(ws, msg) {
  // 重连握手：带着上次的 token 报到，能找回原房间就直接回去
  if (msg.type === 'hello') {
    ws._token = (typeof msg.token === 'string' && msg.token) ? msg.token : null;
    const s = ws._token ? sessions.get(ws._token) : null;
    if (s && rooms.has(s.roomCode) && !wsRoom.has(ws)) {
      resumeIntoRoom(ws, rooms.get(s.roomCode), s);
    }
    return;
  }

  // 进出房间：这几条不要求已经在房间里
  if (msg.type === 'createRoom') { joinFlow(ws, null, msg.name); return; }
  if (msg.type === 'joinRoom') { joinFlow(ws, msg.code, msg.name); return; }
  if (msg.type === 'leaveRoom') {
    if (ws._token) sessions.delete(ws._token); // 主动退出：清掉会话，刷新不再自动回房
    removeFromRoom(ws, false);
    sendTo(ws, { type: 'leftRoom' });
    return;
  }

  // 其余消息都作用在"当前所在房间"上
  const room = wsRoom.get(ws);
  if (!room) return;
  const c = room.clients.get(ws);
  if (!c) return;

  switch (msg.type) {
    case 'setName':
      if (typeof msg.name === 'string' && msg.name.trim()) {
        c.name = msg.name.trim().slice(0, 12);
        // 对战中也同步更新战场上单位的名字
        if (room.world) {
          const f = room.world.fighters.find((x) => x.id === c.id);
          if (f) f.name = c.name;
          broadcastRoster(room); // 名字在名册里，改名要同步
        }
        saveSession(ws, room, c); // 会话里的名字也更新，重连后保持
        sendLobby(room);
      }
      break;

    case 'setTeam': // 玩家自选队伍
      if (msg.team === 'green' || msg.team === 'red') {
        c.team = msg.team;
        saveSession(ws, room, c); // 会话里的队伍也更新
        sendLobby(room);
      }
      break;

    case 'setSettings': // 房主设置地图/人数
      if (c.id === room.hostId && room.phase === 'lobby') {
        if (Number.isInteger(msg.mapIndex)) room.settings.mapIndex = msg.mapIndex;
        if (Number.isInteger(msg.teamGreen)) room.settings.teamGreen = Math.max(1, Math.min(6, msg.teamGreen));
        if (Number.isInteger(msg.teamRed)) room.settings.teamRed = Math.max(1, Math.min(6, msg.teamRed));
        if (['tdm', 'gungame', 'koth', 'ctf'].indexOf(msg.mode) >= 0) room.settings.mode = msg.mode;
        if (['any', 'small', 'medium', 'large'].indexOf(msg.randomSize) >= 0) room.settings.randomSize = msg.randomSize;
        sendLobby(room);
        broadcastRoomList(); // 人数上限变了，更新落地页列表
      }
      break;

    case 'start': // 房主开始
      if (c.id === room.hostId && room.phase === 'lobby') startGame(room);
      break;

    case 'restart': // 房主：同设置再来一局
      if (c.id === room.hostId && room.phase === 'playing') startGame(room);
      break;

    case 'toLobby': // 房主：回大厅
      if (c.id === room.hostId) toLobby(room);
      break;

    case 'input': // 真人的持续输入
      if (room.inputs[c.id]) {
        const inp = room.inputs[c.id];
        inp.up = !!msg.up; inp.down = !!msg.down; inp.left = !!msg.left; inp.right = !!msg.right;
        inp.aimX = msg.aimX; inp.aimY = msg.aimY; inp.shoot = !!msg.shoot;
      }
      break;

    case 'throw': // 真人扔手雷（一次性）
      if (room.inputs[c.id]) room.inputs[c.id].throw = { x: msg.x, y: msg.y };
      break;
  }
}

server.listen(PORT, () => {
  console.log('=========================================================');
  console.log(' 联机服务器已启动！');
  console.log(' 本机浏览器:  http://localhost:' + PORT);
  console.log(' 局域网朋友:  http://你的内网IP:' + PORT + '   (ipconfig 查 IPv4 地址)');
  console.log('---------------------------------------------------------');
  console.log(' 外网联机：另开一个终端，运行下面任一条（选延迟低的）：');
  console.log('   日本节点:   ngrok http ' + PORT + ' --region=jp');
  console.log('   新加坡节点: ngrok http ' + PORT + ' --region=ap');
  console.log('   然后把 ngrok 给的 https 网址发给朋友即可。');
  console.log('---------------------------------------------------------');
  console.log(' 按 Ctrl + C 停止');
  console.log('=========================================================');
});
