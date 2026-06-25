// ============================================================
//  main.js —— 总指挥（联机版）
//  连接服务器 → 管理大厅界面 → 进入对战后每帧渲染服务器快照、上报输入。
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const landingScreen = document.getElementById('landing-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const arenaDiv = document.querySelector('.arena');

// ---------- 连接服务器 ----------
netConnect();
net.onLobby = onLobby;
net.onStarted = onStarted;
net.onRoomJoined = onRoomJoined;
net.onJoinError = onJoinError;
net.onLeftRoom = onLeftRoom;
net.onRoomList = onRoomList;

// ---------- 进场名字弹窗 → 落地页（创建/加入房间） ----------
function submitNameModal() {
  SFX.unlock(); // 借这次点击解锁音频（浏览器要求音频必须由用户操作触发）
  applyContextMusic();
  net.playerName = document.getElementById('name-modal-input').value.trim(); // 名字随创建/加入房间一并发出
  document.getElementById('name-modal').style.display = 'none';
  showLanding();
}

// 显示落地页（创建/加入房间）
function showLanding() {
  landingScreen.classList.remove('hidden');
  lobbyScreen.classList.add('hidden');
  arenaDiv.classList.add('hidden');
  document.getElementById('join-error').textContent = '';
  renderRoomList(); // 用最近一次收到的列表先渲染一下
}

// 落地页房间列表：点哪一行就加入哪个房间，无需手输房号
function onRoomList(msg) { renderRoomList(); }
function renderRoomList() {
  const box = document.getElementById('room-list');
  if (!box) return;
  const list = net.roomList || [];
  if (list.length === 0) {
    box.innerHTML = '<div class="room-empty">暂无房间，点上面"创建房间"开一桌</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach(function(r) {
    const phase = r.phase === 'playing' ? '进行中' : '等待中';
    const row = document.createElement('div');
    row.className = 'room-item' + (r.phase === 'playing' ? ' playing' : '');
    const modeTag = (MODE_NAMES[r.mode] && r.mode !== 'tdm') ? (MODE_NAMES[r.mode] + ' · ') : '';
    row.innerHTML =
      '<span class="ri-code">' + r.code + '</span>'
      + '<span class="ri-meta">' + escapeHtml(r.host || '玩家') + ' 的房间 · '
      + modeTag + r.count + ' 人 · <span class="ri-phase">' + phase + '</span></span>'
      + '<span class="ri-join">加入 ›</span>';
    row.addEventListener('click', function() { netJoinRoom(r.code); });
    box.appendChild(row);
  });
}
function showJoinError(text) { document.getElementById('join-error').textContent = text || ''; }

// 成功创建/加入房间（含刷新后重连）→ 进大厅
function onRoomJoined(msg) {
  document.getElementById('name-modal').style.display = 'none'; // 重连时名字弹窗可能还开着，关掉
  landingScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  document.getElementById('room-code').textContent = msg.code;
  applyContextMusic();
}
function onJoinError(reason) { showJoinError(reason || '加入失败'); }
function onLeftRoom() { touch.setActive(false); clearKillFeed(); showLanding(); }

// ---------- 落地页按钮 ----------
document.getElementById('create-room-btn').addEventListener('click', function() { netCreateRoom(); });
const joinCodeInput = document.getElementById('join-code-input');
function doJoinRoom() {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length < 4) { showJoinError('请输入 4 位房间号'); return; }
  showJoinError('');
  netJoinRoom(code);
}
document.getElementById('join-room-btn').addEventListener('click', doJoinRoom);
joinCodeInput.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
joinCodeInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doJoinRoom(); });
// ---------- 大厅：离开房间 ----------
document.getElementById('leave-room-btn').addEventListener('click', function() { netLeaveRoom(); });
// ---------- 对战中：非房主主动退出房间 ----------
document.getElementById('leave-room-arena-btn').addEventListener('click', function() { netLeaveRoom(); });

// 根据当前所在界面决定该放哪段背景音乐（战场=battle，大厅=lobby，结算时不放）
function applyContextMusic() {
  if (!SFX.enabled || !SFX.ctx) return; // 未解锁或静音时啥也不做
  const inArena = !arenaDiv.classList.contains('hidden');
  if (inArena) {
    if (net.state && net.state.gameOver) return; // 结算瞬间留白，突出胜负音
    SFX.startMusic('battle');
  } else {
    SFX.startMusic('lobby');
  }
}

// 兜底：任意首次交互也解锁音频，并按当前界面放上背景音乐
document.addEventListener('pointerdown', function() { SFX.unlock(); applyContextMusic(); }, { once: true });

// 静音开关
document.getElementById('mute-btn').addEventListener('click', function() {
  SFX.enabled = !SFX.enabled;
  this.textContent = SFX.enabled ? '🔊' : '🔇';
  if (SFX.enabled) {
    SFX.unlock();
    applyContextMusic(); // 按当前界面把背景音乐接回来
  } else {
    SFX.stopMusic();
  }
});
document.getElementById('name-modal-btn').addEventListener('click', submitNameModal);
document.getElementById('name-modal-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') submitNameModal();
});

// ---------- 大厅：选队 ----------
document.getElementById('team-group').addEventListener('click', function(e) {
  if (e.target.dataset.team) netSetTeam(e.target.dataset.team);
});

// 收到大厅更新
function onLobby(msg) {
  // 阶段切换：在大厅就显示大厅、隐藏战场和落地页
  if (msg.phase === 'lobby') {
    landingScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    arenaDiv.classList.add('hidden');
    touch.setActive(false); // 回大厅隐藏触屏层，别挡住大厅 UI
    clearKillFeed();
    SFX.startMusic('lobby'); // 回到大厅切到舒缓版背景音乐
  }
  renderLobby(msg);
}

function renderLobby(msg) {
  // 房间号显示（每次大厅更新都同步一下，保证刷新/切换后正确）
  if (msg.code) document.getElementById('room-code').textContent = msg.code;

  // 各队当前真人数（含房主，用于选队按钮和房主配人数时参考）
  const humanCount = { green: 0, red: 0 };
  msg.players.forEach(function(p) { if (p.team === 'red') humanCount.red++; else humanCount.green++; });

  // 我的队伍高亮 + 在选队按钮上实时显示真人数
  const me = msg.players.find((p) => p.id === net.youId);
  document.querySelectorAll('#team-group button').forEach(function(b) {
    b.classList.toggle('sel', me && b.dataset.team === me.team);
    const label = b.dataset.team === 'green' ? '绿队' : '红队';
    b.textContent = label + '（' + humanCount[b.dataset.team] + '）';
  });

  // 玩家列表
  const box = document.getElementById('players-box');
  box.innerHTML = '<h3>玩家（' + msg.players.length + '）</h3>';
  msg.players.forEach(function(p) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const dot = p.team === 'green' ? '#4caf50' : '#e05050';
    row.innerHTML =
      '<span class="dot" style="background:' + dot + '"></span>' +
      '<span>' + escapeHtml(p.name) + (p.id === net.youId ? '（你）' : '') + '</span>' +
      (p.isHost ? '<span class="host-tag">房主</span>' : '');
    box.appendChild(row);
  });

  // 房主控制 / 等待提示
  const hostBox = document.getElementById('host-settings');
  const waitNote = document.getElementById('wait-note');
  if (net.isHost) {
    waitNote.classList.add('hidden');
    renderHostSettings(hostBox, msg);
  } else {
    hostBox.innerHTML = '';
    waitNote.classList.remove('hidden');
    waitNote.textContent = '模式：' + (MODE_NAMES[msg.settings.mode] || '团队死斗') +
      ' ｜ 地图：' + msg.maps[msg.settings.mapIndex].name +
      ' ｜ 绿队 ' + msg.settings.teamGreen + ' 人 ｜ 红队 ' + msg.settings.teamRed +
      ' 人 ｜ 等待房主开始游戏…';
  }
}

let mapScrollLeft = 0; // 记住地图轮播的横向滚动位置（大厅每次更新都会重建 DOM）
const MODE_NAMES = { tdm: '团队死斗', gungame: '军备竞赛', koth: '占点', ctf: '夺旗' };

// 按地图面积给一个尺寸档 + 推荐人数角标
function mapSizeTier(w, h) {
  const area = w * h;
  if (area < 600000) return { cls: 'sz-s', label: '小·1~2v2' };
  if (area >= 1050000) return { cls: 'sz-l', label: '大·4~6v6' };
  return { cls: 'sz-m', label: '中·2~3v3' };
}
function renderHostSettings(hostBox, msg) {
  hostBox.innerHTML = '<h3>房主设置</h3>';

  // 模式选择：团队死斗 / 军备竞赛
  const modeRow = document.createElement('div');
  modeRow.className = 'setup-row';
  modeRow.innerHTML = '<span class="setup-label">模式：</span>';
  const modeGroup = document.createElement('span');
  modeGroup.className = 'btn-group';
  ['tdm', 'gungame', 'koth', 'ctf'].forEach(function(mode) {
    const btn = document.createElement('button');
    btn.textContent = MODE_NAMES[mode];
    if ((msg.settings.mode || 'tdm') === mode) btn.classList.add('sel');
    btn.addEventListener('click', function() { netSetSettings({ mode: mode }); });
    modeGroup.appendChild(btn);
  });
  modeRow.appendChild(modeGroup);
  hostBox.appendChild(modeRow);

  // 地图选择：两行网格 + 左右箭头横向滑动（地图多时不挤成一堆）
  const mapBar = document.createElement('div');
  mapBar.id = 'lobby-map-list';
  const leftBtn = document.createElement('button');
  leftBtn.className = 'map-arrow'; leftBtn.textContent = '‹';
  const rightBtn = document.createElement('button');
  rightBtn.className = 'map-arrow'; rightBtn.textContent = '›';
  const viewport = document.createElement('div');
  viewport.className = 'map-viewport';
  const track = document.createElement('div');
  track.className = 'map-track';

  msg.maps.forEach(function(map) {
    const card = document.createElement('div');
    card.className = 'map-card' + (map.index === msg.settings.mapIndex ? ' sel' : '');
    const pv = document.createElement('canvas');
    pv.width = 180; pv.height = 120;
    drawMapPreview(pv, map);
    // 尺寸角标：按面积推荐人数规模（随机图不标，尺寸开局才定）
    if (!map.random) {
      const badge = document.createElement('div');
      const tier = mapSizeTier(map.width, map.height);
      badge.className = 'map-badge ' + tier.cls;
      badge.textContent = tier.label;
      card.appendChild(badge);
    }
    const label = document.createElement('div');
    label.className = 'map-label';
    label.textContent = map.name;
    card.appendChild(pv);
    card.appendChild(label);
    card.addEventListener('click', function() { netSetSettings({ mapIndex: map.index }); });
    track.appendChild(card);
  });

  viewport.appendChild(track);
  viewport.addEventListener('scroll', function() { mapScrollLeft = viewport.scrollLeft; });
  leftBtn.addEventListener('click', function() { viewport.scrollBy({ left: -220, behavior: 'smooth' }); });
  rightBtn.addEventListener('click', function() { viewport.scrollBy({ left: 220, behavior: 'smooth' }); });
  mapBar.appendChild(leftBtn);
  mapBar.appendChild(viewport);
  mapBar.appendChild(rightBtn);
  hostBox.appendChild(mapBar);
  viewport.scrollLeft = mapScrollLeft; // 恢复上次滚动位置

  // 各队当前真人数（房主配人数时参考：设定低于真人数时，服务器会自动顶到真人数）
  const humans = { green: 0, red: 0 };
  msg.players.forEach(function(p) { if (p.team === 'red') humans.red++; else humans.green++; });

  // 两队人数（可不同，含电脑补位）：绿队、红队各一行，上限 6
  function buildSizeRow(teamLabel, teamKey, curVal, dotColor) {
    const row = document.createElement('div');
    row.className = 'setup-row';
    row.innerHTML = '<span class="setup-label">'
      + '<span class="dot" style="background:' + dotColor + ';margin-right:5px"></span>'
      + teamLabel + '人数（真人 ' + humans[teamKey] + '，含电脑补位）：</span>';
    const group = document.createElement('span');
    group.className = 'btn-group';
    [1, 2, 3, 4, 5, 6].forEach(function(n) {
      const btn = document.createElement('button');
      btn.textContent = n;
      if (n === curVal) btn.classList.add('sel');
      if (n < humans[teamKey]) btn.disabled = true; // 比真人还少没意义，禁掉
      btn.addEventListener('click', function() {
        netSetSettings(teamKey === 'green' ? { teamGreen: n } : { teamRed: n });
      });
      group.appendChild(btn);
    });
    row.appendChild(group);
    return row;
  }
  hostBox.appendChild(buildSizeRow('绿队', 'green', msg.settings.teamGreen, '#4caf50'));
  hostBox.appendChild(buildSizeRow('红队', 'red', msg.settings.teamRed, '#e05050'));

  // 随机地图尺寸档：只在选中"随机地图"时显示
  const selMap = msg.maps[msg.settings.mapIndex];
  if (selMap && selMap.random) {
    const szRow = document.createElement('div');
    szRow.className = 'setup-row';
    szRow.innerHTML = '<span class="setup-label">随机地图尺寸：</span>';
    const szGroup = document.createElement('span');
    szGroup.className = 'btn-group';
    [['any', '任意'], ['small', '小'], ['medium', '中'], ['large', '大']].forEach(function(pair) {
      const btn = document.createElement('button');
      btn.textContent = pair[1];
      if ((msg.settings.randomSize || 'any') === pair[0]) btn.classList.add('sel');
      btn.addEventListener('click', function() { netSetSettings({ randomSize: pair[0] }); });
      szGroup.appendChild(btn);
    });
    szRow.appendChild(szGroup);
    hostBox.appendChild(szRow);
  }

  // 开始按钮
  const startBtn = document.createElement('button');
  startBtn.id = 'start-game-btn';
  startBtn.textContent = '开始游戏';
  startBtn.addEventListener('click', function() { netStart(); });
  hostBox.appendChild(startBtn);
}

// ---------- 进入对战 ----------
function onStarted(msg) {
  document.getElementById('name-modal').style.display = 'none'; // 重连进对战时也关掉名字弹窗
  landingScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  arenaDiv.classList.remove('hidden');
  touch.setActive(true); // 对战中显示触屏摇杆/按钮
  clearKillFeed();        // 新一局，清空上一局残留的击杀提示
  // 关键：先隐藏上一局的结算面板（它会撑高右栏），否则 fitArena 会按被撑高的尺寸
  // 算出一个过小的缩放（再来一局后画面缩得特别小就是这个原因）。
  document.getElementById('gameover').classList.add('hidden');
  gameoverBuilt = false;
  canvas.width = net.config.width;
  canvas.height = net.config.height;
  setupInput(canvas);
  SFX.unlock();              // 进场再保险解锁一次
  SFX.startMusic('battle');  // 开场切到对战背景音乐
  requestAnimationFrame(fitArena); // 等布局算好后再缩放适配
}

// 让整个战场（左中右三栏）等比缩放到适配当前屏幕，并正确居中
function fitArena() {
  if (!arenaDiv || arenaDiv.classList.contains('hidden')) return;
  // 先还原，量出自然尺寸
  arenaDiv.style.transform = 'none';
  arenaDiv.style.margin = '0';
  const natW = arenaDiv.offsetWidth;
  const natH = arenaDiv.offsetHeight;
  if (!natW || !natH) return;

  // 可用区域要扣掉 body 两侧 20px 内边距，否则右侧会溢出被裁
  const availW = window.innerWidth - 48;
  const availH = window.innerHeight - 108; // 给标题/提示/静音留点空间
  const scale = Math.min(1, availW / natW, availH / natH);

  // 用左上角为原点缩放，再用负 margin 把缩放后多出来的布局空间收掉。
  // 这样元素的"布局占位"= 缩放后的实际尺寸，body 的居中才会按真实大小生效，
  // 不会因为未缩放的自然宽度过宽而把整体挤偏到右边、裁掉右栏。
  arenaDiv.style.transformOrigin = 'top left';
  arenaDiv.style.transform = 'scale(' + scale + ')';
  arenaDiv.style.marginRight = (-(natW * (1 - scale))) + 'px';
  arenaDiv.style.marginBottom = (-(natH * (1 - scale))) + 'px';
}
window.addEventListener('resize', fitArena);

// ---------- 结束面板按钮（房主） ----------
document.getElementById('restart-btn').addEventListener('click', function() { netRestart(); });
document.getElementById('mapselect-btn').addEventListener('click', function() { netToLobby(); });
// 对战中常驻的"返回大厅"（房主可随时结束本局）
document.getElementById('leave-btn').addEventListener('click', function() { netToLobby(); });

// ============================================================
//  客户端预测：只预测"你自己"的移动，让按键即时响应。
//  服务器仍是权威，每帧把预测位置轻轻拉回服务器位置（校正）。
// ============================================================
const prediction = { x: 0, y: 0, angle: 0, active: false };
// 移动速度/单位半径由服务器随 config 下发，避免写死与服务器不一致导致预测错位。
// 取不到时用默认值兜底（旧值：speed 3 × 30tick = 90 像素/秒，半径 16）。
function moveSpeed() { return (net.config && net.config.moveSpeed) || 90; }
function fighterRadius() { return (net.config && net.config.fighterRadius) || 16; }

// 客户端用的墙体碰撞（和服务器同款"圆 vs 矩形"）
function predHitsWall(x, y) {
  const cfg = net.config;
  if (!cfg) return false;
  const r = fighterRadius();
  for (const w of cfg.walls) {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

function updatePrediction(dt, frozen) {
  const cfg = net.config;
  if (!cfg) return;

  // 找到服务器眼中"我"的最新状态
  const st = net.state;
  const myServer = (st && net.yourFighterId) ? st.fighters.find((f) => f.id === net.yourFighterId) : null;

  // 没单位 / 阵亡：关掉预测（复活后再用服务器位置重新对齐）
  if (!myServer || !myServer.alive) { prediction.active = false; return; }

  if (!prediction.active) {
    prediction.x = myServer.x; prediction.y = myServer.y; prediction.active = true;
  } else {
    // 校正：和服务器差太多就直接对齐（复活/瞬移/严重失步），否则缓慢拉回
    const drift = Math.hypot(myServer.x - prediction.x, myServer.y - prediction.y);
    if (drift > 70) { prediction.x = myServer.x; prediction.y = myServer.y; }
    else { prediction.x += (myServer.x - prediction.x) * 0.1; prediction.y += (myServer.y - prediction.y) * 0.1; }
  }

  // 开局倒计时冻结：原地不动（仍可转向瞄准，纯表现）
  if (frozen) {
    prediction.angle = Math.atan2(input.aimY - prediction.y, input.aimX - prediction.x);
    return;
  }

  // 本地按输入移动（按真实 dt，速度和服务器一致）
  const spd = moveSpeed(), r = fighterRadius();
  let vx = 0, vy = 0;
  if (input.right) vx += spd;
  if (input.left) vx -= spd;
  if (input.down) vy += spd;
  if (input.up) vy -= spd;

  const nx = prediction.x + vx * dt;
  if (!predHitsWall(nx, prediction.y)) prediction.x = Math.max(r, Math.min(cfg.width - r, nx));
  const ny = prediction.y + vy * dt;
  if (!predHitsWall(prediction.x, ny)) prediction.y = Math.max(r, Math.min(cfg.height - r, ny));

  prediction.angle = Math.atan2(input.aimY - prediction.y, input.aimX - prediction.x);
}

// 触屏：把左右摇杆状态翻译成 input（移动布尔 + 世界坐标瞄准 + 开火）
function applyTouchInput() {
  if (!touch.enabled) return;
  const dz = 0.35; // 死区，避免轻触就动
  input.left = touch.move.x < -dz;
  input.right = touch.move.x > dz;
  input.up = touch.move.y < -dz;
  input.down = touch.move.y > dz;
  // 右摇杆方向，基于"我"的预测位置换算成世界坐标瞄准点；按住即开火
  if (touch.aiming && prediction.active) {
    input.aimX = prediction.x + touch.aim.x * 300;
    input.aimY = prediction.y + touch.aim.y * 300;
    input.shoot = true;
  } else {
    input.shoot = false;
  }
}

// ---------- 主循环 ----------
let lastInputSent = 0;
let lastFrame = performance.now();
let lastHud = 0;
const HUD_INTERVAL = 100; // HUD/击杀榜更新间隔（ms）≈ 10Hz，画面仍保持 60fps

// 性能浮层：访问 http://localhost:3000/?fps 时左上角显示实时 FPS 和 JS 堆占用，
// 方便判断"越玩越卡"到底是帧率下降还是内存（堆）持续增长。
const SHOW_FPS = location.search.indexOf('fps') >= 0;
let fpsEma = 60;
function drawPerfOverlay(now) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // 不受战场缩放影响
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(4, 4, 150, performance.memory ? 40 : 22);
  ctx.fillStyle = '#39ff14';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('FPS ' + Math.round(fpsEma), 10, 20);
  if (performance.memory) {
    const mb = performance.memory.usedJSHeapSize / 1048576;
    ctx.fillText('HEAP ' + mb.toFixed(1) + ' MB', 10, 36);
  }
  ctx.restore();
}

function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000); // 秒，封顶防卡顿跳变
  lastFrame = now;
  if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.1; // 平滑后的瞬时帧率

  if (net.config && net.state) {
    const frozen = net.state.countdown > 0; // 开局倒计时期间冻结操作
    applyTouchInput();      // 触屏：把摇杆状态写进 input（要在预测之前）
    updatePrediction(dt, frozen); // 先算自己的预测位置
    drawFrame(ctx);         // 渲染每帧都做，保证丝滑
    if (SHOW_FPS) drawPerfOverlay(now);
    // HUD（比分/存活/击杀榜）降频更新：这些是 DOM 操作，没必要每帧重排，
    // 人一多时每帧重建击杀榜 innerHTML 是主要的掉帧来源。
    if (now - lastHud >= HUD_INTERVAL) {
      updateHud();
      // 房主显示"返回大厅"（结束本局回房间大厅）；非房主显示"退出房间"（直接离开回落地页）
      document.getElementById('leave-btn').classList.toggle('hidden', !net.isHost);
      document.getElementById('leave-room-arena-btn').classList.toggle('hidden', net.isHost);
      lastHud = now;
    }
    // 上报输入：限制到约 30 次/秒，避免外网上行拥堵（倒计时冻结期不发）
    if (net.yourFighterId && !frozen) {
      if (now - lastInputSent >= 33) { netSendInput(input); lastInputSent = now; }
    }
    updateGameOverPanel();
  }
  requestAnimationFrame(loop);
}

let gameoverBuilt = false; // 结算榜只在本局结束时构建一次，避免每帧重排
function updateGameOverPanel() {
  const over = document.getElementById('gameover');
  if (net.state && net.state.gameOver) {
    over.classList.remove('hidden');
    SFX.stopMusic(); // 本局结束停掉背景音乐（stopMusic 幂等，重复调用无害）
    touch.setActive(false); // 触屏：结算时收起摇杆/按钮，让结算按钮可点
    document.getElementById('gameover-text').textContent =
      (myTeamWin()) ? '🎉 你方获胜！' : (net.yourFighterId ? '💀 你方失败！' : '本局结束');
    if (!gameoverBuilt) { renderGameOverBoard(net.state); gameoverBuilt = true; }
    // 只有房主能点按钮
    document.getElementById('restart-btn').style.display = net.isHost ? '' : 'none';
    document.getElementById('mapselect-btn').style.display = net.isHost ? '' : 'none';
  } else {
    over.classList.add('hidden');
    gameoverBuilt = false;
    // 对战进行中（非结算、在战场）→ 显示触屏层
    if (touch.enabled && !arenaDiv.classList.contains('hidden')) touch.setActive(true);
  }
}

// 右上角击杀提示：每次有人被击杀就滚一条"击杀者 ⚔ 受害者"，几秒后淡出
function clearKillFeed() {
  const box = document.getElementById('kill-feed');
  if (box) box.innerHTML = '';
}
function teamTextColor(team) { return team === 'red' ? '#ff8a8a' : '#7fdc7f'; }
function pushKillFeed(killerId, victimId, w) {
  const box = document.getElementById('kill-feed');
  if (!box) return;
  const vr = net.rosterById[victimId];
  const kr = killerId ? net.rosterById[killerId] : null;
  const vName = vr ? (vr.name || '电脑') : '?';
  const row = document.createElement('div');
  row.className = 'kf-row';
  if (kr && killerId !== victimId) {
    const swordColor = w === 3 ? '#c56cff' : '#eee'; // 狙杀用紫色剑
    row.innerHTML = '<span style="color:' + teamTextColor(kr.team) + '">' + escapeHtml(kr.name || '电脑') + '</span>'
      + '<span class="kf-sword" style="color:' + swordColor + '">⚔</span>'
      + '<span style="color:' + teamTextColor(vr ? vr.team : 'green') + '">' + escapeHtml(vName) + '</span>';
  } else {
    // 自爆/环境死亡：没有有效击杀者
    row.innerHTML = '<span class="kf-sword">☠</span><span style="color:' + teamTextColor(vr ? vr.team : 'green') + '">' + escapeHtml(vName) + '</span>';
  }
  box.insertBefore(row, box.firstChild); // 最新的放最上面
  while (box.children.length > 6) box.removeChild(box.lastChild);
  setTimeout(function() { row.classList.add('kf-fade'); }, 3500);
  setTimeout(function() { if (row.parentNode) row.parentNode.removeChild(row); }, 4200);
}

// 连杀播报：在 kill feed 顶部插一条醒目的大字「XX 双杀!/三杀!/...」
const MULTIKILL_CN = { 2: '双杀', 3: '三杀', 4: '四杀', 5: '五杀', 6: '六杀', 7: '七杀', 8: '八杀' };
function pushMultiKillFeed(whoId, n) {
  const box = document.getElementById('kill-feed');
  if (!box) return;
  const kr = net.rosterById[whoId];
  const name = kr ? (kr.name || '电脑') : '?';
  const label = MULTIKILL_CN[n] || (n + ' 连杀');
  const row = document.createElement('div');
  row.className = 'kf-row kf-multi';
  row.innerHTML = '🔥 <span style="color:' + teamTextColor(kr ? kr.team : 'green') + '">' + escapeHtml(name) + '</span> '
    + '<span class="kf-multi-word">' + label + '!</span>';
  box.insertBefore(row, box.firstChild);
  while (box.children.length > 7) box.removeChild(box.lastChild);
  setTimeout(function() { row.classList.add('kf-fade'); }, 3200);
  setTimeout(function() { if (row.parentNode) row.parentNode.removeChild(row); }, 3900);
}

// 综合战力评分：有效伤害 + 击杀×50 − 阵亡×25（侧重贡献，击杀加成、阵亡扣分）
const SCORE_W = { dmg: 1, kill: 50, death: 25 };
function combatScore(f) {
  return Math.round((f.damage || 0) * SCORE_W.dmg + (f.kills || 0) * SCORE_W.kill - (f.deaths || 0) * SCORE_W.death);
}

// 结算页：按综合评分排名（不再重复右侧击杀榜），MVP = 评分最高
function renderGameOverBoard(st) {
  const list = st.fighters.slice().sort(function(a, b) {
    return combatScore(b) - combatScore(a) || (b.kills - a.kills) || ((a.deaths || 0) - (b.deaths || 0)) || a.id.localeCompare(b.id);
  });
  const mvp = list[0];
  const mvpEl = document.getElementById('gameover-mvp');
  if (mvp) {
    const mc = mvp.team === 'green' ? '#4caf50' : '#e05050';
    mvpEl.innerHTML = '🏆 MVP　<b style="color:' + mc + '">' + escapeHtml(mvp.name || '电脑')
      + '</b>　评分 ' + combatScore(mvp);
  }
  let html = '<div class="go-row go-head"><span class="go-rank"></span>'
    + '<span class="go-info">玩家（伤害·杀·亡）</span><span class="go-score">评分</span></div>';
  list.forEach(function(f, i) {
    const isMe = f.id === net.yourFighterId;
    const isHuman = f.controller === 'human';
    const color = f.team === 'green' ? '#4caf50' : '#e05050';
    const label = (f.name || '电脑') + (isMe ? '（你）' : '');
    html += '<div class="go-row' + (isMe ? ' me' : '') + (i === 0 ? ' top' : '') + '">'
      + '<span class="go-rank">' + (i + 1) + '</span>'
      + '<span class="dot" style="background:' + color + '"></span>'
      + (isHuman ? '<span class="kp-human"></span>' : '<span class="kp-human kp-bot"></span>')
      + '<span class="go-info"><span class="go-name">' + escapeHtml(label) + '</span>'
      + '<span class="go-sub">伤 ' + (f.damage || 0) + ' · ' + f.kills + ' 杀 · ' + (f.deaths || 0) + ' 亡</span></span>'
      + '<span class="go-score">' + combatScore(f) + '</span>'
      + '</div>';
  });
  document.getElementById('gameover-board').innerHTML = html;
}
function myTeamWin() {
  const t = myTeamOf(net.state);
  return t && net.state.winner === t;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

loop();
