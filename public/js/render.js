// ============================================================
//  render.js —— 渲染层（联机版）
//  从 net.config（地图/常量）+ net.state（每帧快照）把画面画出来。
//  不做任何游戏逻辑，纯粹"照着服务器发来的数据画"。
// ============================================================

// 开局倒计时 / GO 状态
let lastCountdown = -1;
let goFlashUntil = 0;
function drawBigCenterText(ctx, cfg, text, color) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 120px sans-serif';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, cfg.width / 2, cfg.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, cfg.width / 2, cfg.height / 2);
  ctx.restore();
}

// 受击/阵亡红色闪屏：被打中闪一下，被一枪带走闪得更狠。每帧衰减。
let hurtFlash = 0;
function triggerHurtFlash(amount) { hurtFlash = Math.min(0.8, Math.max(hurtFlash, amount)); }

// 伤害飘字：只显示"你自己造成的"伤害，同一目标短时累加成一个数字，小字上飘快淡出。
const dmgPops = [];
function spawnDamagePop(victimId, x, y, amount, kill) {
  for (const p of dmgPops) {
    // 同一目标 280ms 内的多次命中合并到同一个数字，避免连射刷屏
    if (p.victim === victimId && !p.kill && (performance.now() - p.t0) < 280) {
      p.amount += amount; p.t0 = performance.now(); p.x = x; p.y0 = y;
      if (kill) { p.kill = true; p.ttl = 1100; }
      return;
    }
  }
  dmgPops.push({ victim: victimId, x: x, y0: y, amount: amount, t0: performance.now(), ttl: kill ? 1100 : 750, kill: kill });
}

// 武器外观表（下标 = 服务器 WEAPONS 里的 idx）：名字 / 颜色 / 拾取物上的字
const WEAPON_VIS = [
  { name: '手枪',   color: '#ffffff', label: '' },   // 0 手枪
  { name: '冲锋枪', color: '#7fb3ff', label: '冲' }, // 1 冲锋枪
  { name: '霰弹枪', color: '#ff9f43', label: '霰' }, // 2 霰弹枪
  { name: '狙击枪', color: '#c56cff', label: '狙' }, // 3 狙击枪
];

// 画一帧。读取 net.config / net.state / net.yourFighterId。
function drawFrame(ctx) {
  const cfg = net.config;
  const st = netGetView(); // 插值后的平滑画面
  if (!cfg || !st) return;

  // 1) 清屏
  ctx.clearRect(0, 0, cfg.width, cfg.height);

  // 2) 墙
  ctx.fillStyle = '#6b6b80';
  for (const w of cfg.walls) ctx.fillRect(w.x, w.y, w.w, w.h);

  // 2.5) 占点圈（仅 koth）：颜色随控制方变化——绿/红/争夺(黄)/无人(灰)
  if (cfg.zone) drawZone(ctx, cfg.zone, st);

  // 2.6) 夺旗：基地旗座（家的位置）
  if (cfg.mode === 'ctf') drawFlagBases(ctx, cfg);

  // 3) 子弹：按敌我上色——敌方=醒目警示色，友方(含自己)=低调冷色。
  //    一眼区分"会打到我的"和"友军的"。观战时我没队伍，退化为绿/红队伍色。
  const myTeam = myTeamOf(st); // null = 观战
  for (const b of st.bullets) {
    const isSniper = b.w === 3;
    let isEnemy;
    if (myTeam) isEnemy = (b.team !== myTeam);       // 有队伍：敌我相对我自己
    else isEnemy = (b.team === 'red');                // 观战：红队当"敌方色"，绿队"友方色"
    // 敌方：暖色警示（狙击更红更亮）；友方：冷色低调
    let color, r;
    if (isEnemy) {
      color = isSniper ? '#ff3b6b' : '#ff7a3a';       // 红粉(狙) / 橙(普通)
      r = isSniper ? cfg.bulletRadius + 2.5 : cfg.bulletRadius + 0.5;
    } else {
      color = isSniper ? '#7fd0ff' : '#7fe0c0';       // 浅蓝(狙) / 青绿(普通)
      r = isSniper ? cfg.bulletRadius + 2 : cfg.bulletRadius;
    }
    // 威胁最大的敌方狙击弹加一圈光晕
    if (isEnemy && isSniper) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,59,107,0.28)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // 4) 道具箱
  for (const c of st.crates) {
    const s = cfg.crateHalf;
    ctx.fillStyle = '#d9a23b';
    ctx.fillRect(c.x - s, c.y - s, s * 2, s * 2);
    ctx.strokeStyle = '#7a5310';
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x - s, c.y - s, s * 2, s * 2);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3a2a08';
    ctx.fill();
  }

  // 4.5) 回血心心
  for (const h of (st.hearts || [])) drawHeart(ctx, h.x, h.y, cfg.heartHalf || 11);

  // 4.6) 武器拾取物（中央争夺点带高亮环）
  for (const wp of (st.weapons || [])) drawWeaponPickup(ctx, wp.x, wp.y, wp.k, cfg.weaponHalf || 13, wp.c);

  // 5) 手雷（影子 + 上浮本体）
  for (const g of st.grenades) {
    const shadowScale = Math.max(0.4, 1 - g.z / 120);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 6 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(g.x, g.y - g.z, 5 + g.z * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#3c5a2a';
    ctx.fill();
    ctx.strokeStyle = '#1c2a14';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 5.5) 我的复活点预览：死亡等待期间显示（只有我自己能看到），方便提前规划走位
  const meF = net.yourFighterId ? st.fighters.find((f) => f.id === net.yourFighterId) : null;
  if (meF && !meF.alive && net.myRespawn) {
    drawRespawnMarker(ctx, net.myRespawn.x, net.myRespawn.y, meF.team, meF.respawnTimer);
  }

  // 6) 战斗单位
  for (const f of st.fighters) drawFighter(ctx, f);

  // 6.5) 夺旗：旗（家/被扛/掉落都画在当前位置）+ 我扛旗时的回家提示
  if (st.flags && st.flags.length) {
    for (const fl of st.flags) drawFlag(ctx, fl.x, fl.y, fl.team === 'green' ? '#5fd35f' : '#ff7a7a', fl.state);
    if (st.flags.some((fl) => fl.carrier === net.yourFighterId)) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText('带敌旗回家！', cfg.width / 2, 42);
      ctx.fillStyle = '#ffd54a';
      ctx.fillText('带敌旗回家！', cfg.width / 2, 42);
      ctx.restore();
    }
  }

  // 7) 爆炸特效
  for (const e of st.effects) {
    const p = 1 - e.life / e.maxLife;
    const radius = cfg.explosionRadius * (0.3 + 0.7 * p);
    ctx.beginPath();
    ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,160,40,' + (0.55 * (1 - p)) + ')';
    ctx.fill();
  }

  // 7.4) 伤害飘字（只有你造成的伤害）：小字向上飘 + 淡出；击杀用更大的红字
  if (dmgPops.length) {
    const dnow = performance.now();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    for (let i = dmgPops.length - 1; i >= 0; i--) {
      const p = dmgPops[i];
      const age = dnow - p.t0;
      if (age >= p.ttl) { dmgPops.splice(i, 1); continue; }
      const k = age / p.ttl;
      const y = p.y0 - 16 - k * 26;
      ctx.globalAlpha = Math.max(0, 1 - k);
      const txt = p.kill ? ('☠' + p.amount) : ('-' + p.amount);
      ctx.font = p.kill ? 'bold 21px sans-serif' : 'bold 15px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(txt, p.x, y);
      ctx.fillStyle = p.kill ? '#ff5a5a' : '#ffe08a';
      ctx.fillText(txt, p.x, y);
    }
    ctx.restore();
  }

  // 7.5) 受击/阵亡红色闪屏（整屏淡红 + 四周更浓的红晕），随帧衰减
  if (hurtFlash > 0.02) {
    ctx.fillStyle = 'rgba(220,30,30,' + (hurtFlash * 0.45) + ')';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    const grad = ctx.createRadialGradient(
      cfg.width / 2, cfg.height / 2, Math.min(cfg.width, cfg.height) * 0.25,
      cfg.width / 2, cfg.height / 2, Math.max(cfg.width, cfg.height) * 0.62);
    grad.addColorStop(0, 'rgba(220,30,30,0)');
    grad.addColorStop(1, 'rgba(200,0,0,' + Math.min(0.85, hurtFlash) + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    hurtFlash *= 0.85;
  } else {
    hurtFlash = 0;
  }

  // 7.8) 开局倒计时 3-2-1-GO
  if (st.countdown !== undefined) {
    const now = performance.now();
    if (lastCountdown > 0 && st.countdown === 0) goFlashUntil = now + 700; // 刚结束 → 闪 GO
    lastCountdown = st.countdown;
    if (st.countdown > 0) drawBigCenterText(ctx, cfg, '' + Math.ceil(st.countdown / 30), 'rgba(255,255,255,0.95)');
    else if (now < goFlashUntil) drawBigCenterText(ctx, cfg, 'GO!', '#5fd35f');
  }

  // 7.9) 最后存活：回合结算展示（半透明遮罩 + 本回合赢家）
  if (st.roundOver && !st.gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    let txt, col;
    if (st.roundWinner === 'draw') { txt = '本回合平局'; col = '#ddd'; }
    else if (st.roundWinner) {
      const myTeam = myTeamOf(st);
      if (!myTeam) { txt = (st.roundWinner === 'green' ? '绿队' : '红队') + ' 赢得本回合'; col = st.roundWinner === 'green' ? '#5fd35f' : '#ff6b6b'; }
      else { txt = (st.roundWinner === myTeam) ? '🏆 你方赢得本回合' : '本回合落败'; col = (st.roundWinner === myTeam) ? '#5fd35f' : '#ff6b6b'; }
    }
    if (txt) {
      ctx.save();
      ctx.textAlign = 'center'; ctx.font = 'bold 40px sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(txt, cfg.width / 2, cfg.height / 2 - 16);
      ctx.fillStyle = col; ctx.fillText(txt, cfg.width / 2, cfg.height / 2 - 16);
      // 当前回合比分
      ctx.font = 'bold 22px sans-serif';
      const sc = '回合比分  绿 ' + st.teamScore.green + ' : ' + st.teamScore.red + ' 红';
      ctx.strokeText(sc, cfg.width / 2, cfg.height / 2 + 28);
      ctx.fillStyle = '#fff'; ctx.fillText(sc, cfg.width / 2, cfg.height / 2 + 28);
      ctx.restore();
    }
  }

  // 8) 胜负遮罩
  if (st.gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    const myTeam = myTeamOf(st);
    let text;
    if (!myTeam) text = (st.winner === 'green' ? '绿队' : '红队') + ' 获胜！';
    else text = (st.winner === myTeam) ? '🎉 你方获胜！' : '💀 你方失败！';
    ctx.fillStyle = (myTeam && st.winner === myTeam) ? '#5fd35f' : '#ff6b6b';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, cfg.width / 2, cfg.height / 2);
    ctx.textAlign = 'left';
  }
}

// 找出"我"控制的单位的队伍（观战时返回 null）
function myTeamOf(st) {
  if (!net.yourFighterId) return null;
  const me = st.fighters.find((f) => f.id === net.yourFighterId);
  return me ? me.team : null;
}

// 头顶火焰：几簇上窜的火舌，随时间跳动；level 越高越大越亮
function drawHeadFire(ctx, cx, cy, level) {
  const t = performance.now() / 1000;
  const big = Math.min(level, 6);
  const scale = 0.8 + big * 0.18;          // 等级越高火越大
  const tongues = 3 + Math.min(level - 1, 4); // 火舌数量随等级增加
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // 叠加发光
  for (let i = 0; i < tongues; i++) {
    const phase = t * 9 + i * 1.7;
    const sway = Math.sin(phase) * 3.2;
    const h = (10 + Math.sin(phase * 1.3) * 5) * scale;   // 火舌高度跳动
    const w = (5 + Math.cos(phase) * 1.5) * scale;        // 火舌宽度
    const bx = cx + (i - (tongues - 1) / 2) * 5 * scale;
    const grad = ctx.createLinearGradient(bx, cy, bx, cy - h);
    grad.addColorStop(0, 'rgba(255,80,20,0.0)');
    grad.addColorStop(0.3, 'rgba(255,110,30,0.65)');
    grad.addColorStop(0.7, 'rgba(255,190,60,0.8)');
    grad.addColorStop(1, 'rgba(255,240,160,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(bx - w, cy);
    ctx.quadraticCurveTo(bx - w * 0.5 + sway, cy - h * 0.6, bx + sway, cy - h);
    ctx.quadraticCurveTo(bx + w * 0.5 + sway, cy - h * 0.6, bx + w, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFighter(ctx, f) {
  if (!f.alive) return;

  // 我自己：用本地预测的位置/朝向（丝滑、即时），其他人用插值后的服务器位置
  const isMe = (f.id === net.yourFighterId);
  let fx = f.x, fy = f.y, fang = f.angle;
  if (isMe && prediction.active) {
    fx = prediction.x; fy = prediction.y; fang = prediction.angle;
  }

  // 出生保护：身体闪烁（半透明脉动）+ 一圈青色护盾环
  const protect = f.inv ? (0.45 + 0.4 * Math.sin(performance.now() / 70)) : 1;
  ctx.save();
  ctx.globalAlpha = protect;
  ctx.beginPath();
  ctx.arc(fx, fy, 16, 0, Math.PI * 2);
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.restore();
  if (f.inv) {
    ctx.beginPath();
    ctx.arc(fx, fy, 21, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,220,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 人类玩家加一圈光环，一眼区分人/电脑（队伍色仍是填充色，用来分敌我）：
  //   你自己 = 白环；其他真人 = 蓝环；电脑 = 无环
  if (isMe || f.controller === 'human') {
    ctx.beginPath();
    ctx.arc(fx, fy, 19, 0, Math.PI * 2);
    // 先描一圈深色衬底，保证在任何底色上都看得清
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fx, fy, 19, 0, Math.PI * 2);
    ctx.strokeStyle = isMe ? '#ffffff' : '#4fc3ff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // 连杀中的单位头顶燃烧火焰（streak>=2 才有；等级越高火越大）
  if (f.streak >= 2) drawHeadFire(ctx, fx, fy - 22, f.streak);

  // 枪口（颜色随当前武器，手枪为白）
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx + Math.cos(fang) * 30, fy + Math.sin(fang) * 30);
  ctx.strokeStyle = (WEAPON_VIS[f.w] || WEAPON_VIS[0]).color;
  ctx.lineWidth = 4;
  ctx.stroke();

  // 血条
  const barW = 36, barH = 5;
  const x = fx - barW / 2, y = fy - 28;
  ctx.fillStyle = '#5a2a2a';
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = '#5fd35f';
  ctx.fillRect(x, y, barW * Math.max(0, f.hp / f.maxHp), barH);

  // 名字（真人才显示）
  if (f.name) {
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.name, fx, fy - 32);
    ctx.textAlign = 'left';
  }
}

// 画一个回血小心心（两个圆瓣 + 下方三角，拼成心形）
function drawHeart(ctx, x, y, s) {
  ctx.fillStyle = '#ff5a7a';
  // 两个圆瓣
  ctx.beginPath();
  ctx.arc(x - s * 0.45, y - s * 0.2, s * 0.5, 0, Math.PI * 2);
  ctx.arc(x + s * 0.45, y - s * 0.2, s * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // 下方三角尖
  ctx.beginPath();
  ctx.moveTo(x - s * 0.92, y - s * 0.05);
  ctx.lineTo(x + s * 0.92, y - s * 0.05);
  ctx.lineTo(x, y + s * 0.9);
  ctx.closePath();
  ctx.fill();
  // 描边
  ctx.strokeStyle = '#a8243f';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// 画一个武器拾取物：彩色方块 + 武器汉字；中央争夺点额外套一圈脉动金环
function drawWeaponPickup(ctx, x, y, k, s, central) {
  if (central) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 4);
    ctx.beginPath();
    ctx.arc(x, y, s * 2 + 5 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,213,74,' + (0.45 + 0.45 * pulse) + ')';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const vis = WEAPON_VIS[k] || WEAPON_VIS[1];
  ctx.fillStyle = vis.color;
  ctx.fillRect(x - s, y - s, s * 2, s * 2);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  ctx.fillStyle = '#15151c';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(vis.label, x, y + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ---------- 左侧个人击杀榜 ----------
function escapeHtmlR(s) {
  return String(s).replace(/[&<>"]/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

let _killBoardSig = null; // 上次渲染击杀榜时的内容签名，没变就不重排 DOM
function updateKillBoard(st) {
  // 按击杀数降序排名（同分先看谁阵亡少，再按名字稳定排序）
  const list = st.fighters.slice().sort(function(a, b) {
    return (b.kills - a.kills) || ((a.deaths || 0) - (b.deaths || 0)) || a.id.localeCompare(b.id);
  });

  // 先算内容签名：排名/击杀/阵亡/名字/队伍/控制者/"是不是我"都没变，就直接跳过整段 innerHTML 重写
  let sig = net.yourFighterId || '';
  for (const f of list) sig += '|' + f.id + ',' + f.kills + ',' + (f.deaths || 0) + ',' + f.team + ',' + f.controller + ',' + (f.name || '');
  if (sig === _killBoardSig) return;
  _killBoardSig = sig;

  // 表头：击杀 / 阵亡 两列说明
  let html = '<div class="kill-head">'
    + '<span class="krank"></span>'
    + '<span class="kname"></span>'
    + '<span class="kcount" title="击杀">击</span>'
    + '<span class="kd-sep"></span>'
    + '<span class="dcount" title="阵亡">阵</span>'
    + '</div>';
  list.forEach(function(f, idx) {
    const isMe = f.id === net.yourFighterId;
    const isHuman = f.controller === 'human';
    const color = f.team === 'green' ? '#4caf50' : '#e05050';
    const label = (f.name || '电脑') + (isMe ? '（你）' : '');
    // 真人加个蓝点（和战场上的蓝色光环呼应）；电脑放等宽占位保持对齐
    const humanMark = isHuman
      ? '<span class="kp-human" title="真人玩家"></span>'
      : '<span class="kp-human kp-bot"></span>';
    html += '<div class="kill-row' + (isMe ? ' me' : '') + '">'
      + '<span class="krank">' + (idx + 1) + '</span>'
      + '<span class="dot" style="background:' + color + '"></span>'
      + humanMark
      + '<span class="kname">' + escapeHtmlR(label) + '</span>'
      + '<span class="kcount">' + f.kills + '</span>'
      + '<span class="kd-sep">/</span>'
      + '<span class="dcount">' + (f.deaths || 0) + '</span>'
      + '</div>';
  });
  document.getElementById('kill-list').innerHTML = html;
}

// ---------- 右侧面板 ----------
function teamColor(team) { return team === 'green' ? '#4caf50' : '#e05050'; }

function updateHud() {
  const st = net.state;
  if (!st) return;

  // "你方/敌方"相对于你实际所在的队伍；观战时退化为"绿队/红队"
  const myTeam = myTeamOf(st);
  const mine = myTeam || 'green';
  const enemy = mine === 'green' ? 'red' : 'green';
  const spectating = !myTeam;
  const nameOf = (team, isMine) => spectating ? (team === 'green' ? '绿队' : '红队') : (isMine ? '你方' : '敌方');

  // 比分行
  document.getElementById('dot-score-mine').style.background = teamColor(mine);
  document.getElementById('dot-score-enemy').style.background = teamColor(enemy);
  document.getElementById('label-score-mine').textContent = nameOf(mine, true);
  document.getElementById('label-score-enemy').textContent = nameOf(enemy, false);
  // 比分显示成「当前 / 目标」；军备竞赛胜负看个人进度，不显示队伍目标分
  const isGun = net.config && net.config.mode === 'gungame';
  const tgt = (!isGun && net.config && net.config.targetScore) ? ' / ' + net.config.targetScore : '';
  document.getElementById('score-mine').textContent = st.teamScore[mine] + tgt;
  document.getElementById('score-enemy').textContent = st.teamScore[enemy] + tgt;

  // 存活人数行
  const aliveStr = (team) => {
    const arr = st.fighters.filter((f) => f.team === team);
    return arr.filter((f) => f.alive).length + '/' + arr.length;
  };
  document.getElementById('dot-alive-mine').style.background = teamColor(mine);
  document.getElementById('dot-alive-enemy').style.background = teamColor(enemy);
  document.getElementById('label-alive-mine').textContent = nameOf(mine, true);
  document.getElementById('label-alive-enemy').textContent = nameOf(enemy, false);
  document.getElementById('alive-mine').textContent = aliveStr(mine);
  document.getElementById('alive-enemy').textContent = aliveStr(enemy);

  updateKillBoard(st); // 左侧个人击杀榜

  const me = net.yourFighterId ? st.fighters.find((f) => f.id === net.yourFighterId) : null;
  const statusEl = document.getElementById('status-me');
  const nadeEl = document.getElementById('nade-me');
  const weaponEl = document.getElementById('weapon-me');
  const isLastman = net.config && net.config.mode === 'lastman';
  if (me) {
    if (me.alive) { statusEl.textContent = '存活'; statusEl.className = 'state alive'; }
    else if (isLastman) { statusEl.textContent = '阵亡（观战本回合）'; statusEl.className = 'state dead'; }
    else { statusEl.textContent = '复活中 ' + Math.ceil(me.respawnTimer / 60) + 's'; statusEl.className = 'state dead'; }
    nadeEl.textContent = isGun ? '—' : me.grenades; // 军备竞赛无手雷
    // 武器：军备竞赛显示当前枪 + 进度；其它显示弹药
    const vis = WEAPON_VIS[me.w] || WEAPON_VIS[0];
    if (weaponEl) {
      if (isGun) {
        const lv = Math.min(me.kills, net.config.ladderLen);
        weaponEl.textContent = vis.name + '　军备 ' + lv + '/' + net.config.ladderLen;
      } else {
        weaponEl.textContent = vis.name + (me.am >= 0 ? ' ×' + me.am : ' ∞');
      }
      weaponEl.style.color = (me.w ? vis.color : '#ddd');
    }
  } else {
    statusEl.textContent = '观战'; statusEl.className = 'state';
    nadeEl.textContent = '—';
    if (weaponEl) { weaponEl.textContent = '—'; weaponEl.style.color = '#ddd'; }
  }
}

// 占点圈：按圈内双方人数判断控制方，给不同的填充/描边颜色
function drawZone(ctx, z, st) {
  let gIn = 0, rIn = 0;
  for (const f of st.fighters) {
    if (!f.alive) continue;
    const dx = f.x - z.x, dy = f.y - z.y;
    if (dx * dx + dy * dy < z.radius * z.radius) { if (f.team === 'green') gIn++; else rIn++; }
  }
  let fill = 'rgba(150,150,160,0.10)', stroke = 'rgba(180,180,190,0.55)', label = '占点', lc = '#aab';
  if (gIn > 0 && rIn === 0) { fill = 'rgba(76,175,80,0.20)'; stroke = 'rgba(95,211,95,0.9)'; label = '绿队占领'; lc = '#5fd35f'; }
  else if (rIn > 0 && gIn === 0) { fill = 'rgba(224,80,80,0.20)'; stroke = 'rgba(255,120,120,0.9)'; label = '红队占领'; lc = '#ff7a7a'; }
  else if (gIn > 0 && rIn > 0) { fill = 'rgba(255,213,74,0.22)'; stroke = 'rgba(255,213,74,0.95)'; label = '争夺中'; lc = '#ffd54a'; }
  ctx.save();
  ctx.beginPath();
  ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.strokeStyle = stroke; ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = lc; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, z.x, z.y - z.radius - 8);
  ctx.textAlign = 'left';
  ctx.restore();
}

// 我的复活点标记：脉动的队伍色光环 + 向下箭头 + "复活 Xs" 倒计时（仅本人可见）
function drawRespawnMarker(ctx, x, y, team, respawnTimer) {
  const col = team === 'red' ? '#ff7a7a' : '#5fd35f';
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.save();
  // 脉动的扩散光环（两层）
  for (let i = 0; i < 2; i++) {
    const rr = 16 + i * 9 + pulse * 6;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.globalAlpha = (0.7 - i * 0.3) * (0.6 + 0.4 * pulse);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 实心小圆心
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  // 上方下坠的箭头（指向落点）
  const ay = y - 40 - pulse * 6;
  ctx.beginPath();
  ctx.moveTo(x - 7, ay); ctx.lineTo(x + 7, ay); ctx.lineTo(x, ay + 11); ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  // 倒计时文字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const secs = Math.max(0, Math.ceil((respawnTimer || 0) / 60));
  const label = '复活 ' + secs + 's';
  ctx.strokeText(label, x, y - 48);
  ctx.fillText(label, x, y - 48);
  ctx.textAlign = 'left';
  ctx.restore();
}

// 夺旗：基地旗座（home 位置）虚线圈
function drawFlagBases(ctx, cfg) {
  if (!cfg.greenBase) return;
  [[cfg.greenBase, '#5fd35f'], [cfg.redBase, '#ff7a7a']].forEach(function(b) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(b[0].x, b[0].y, 28, 0, Math.PI * 2);
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = b[1];
    ctx.stroke();
    ctx.restore();
  });
}

// 画一面旗：旗杆 + 三角旗；掉落(state=2)时闪烁
function drawFlag(ctx, x, y, color, state) {
  ctx.save();
  if (state === 2) ctx.globalAlpha = 0.55 + 0.35 * Math.sin(performance.now() / 120);
  ctx.strokeStyle = '#15151c';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x, y + 13); ctx.lineTo(x, y - 15); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 15); ctx.lineTo(x + 17, y - 9); ctx.lineTo(x, y - 3); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

// ---------- 大厅地图缩略图 ----------
function drawMapPreview(canvas, map) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2b3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 随机地图：没有固定布局，画一个占位提示（每局现场生成）
  if (map.random) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cdd';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('🎲', canvas.width / 2, canvas.height / 2 - 12);
    ctx.fillStyle = '#9aa';
    ctx.font = '13px sans-serif';
    ctx.fillText('每局现场生成', canvas.width / 2, canvas.height / 2 + 20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return;
  }
  const sx = canvas.width / map.width;
  const sy = canvas.height / map.height;
  ctx.fillStyle = '#6b6b80';
  for (const w of map.walls) ctx.fillRect(w.x * sx, w.y * sy, w.w * sx, w.h * sy);
}
