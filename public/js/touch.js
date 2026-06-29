// ============================================================
//  touch.js —— 手机触屏控制（双摇杆）
//   左半屏：移动摇杆（按住拖动 → 8 向移动）
//   右半屏：瞄准摇杆（按住拖动 → 朝该方向瞄准并自动开火）
//   手雷按钮 / 退出按钮 / 竖屏提示
//  只在"粗指针"（触屏为主）的设备上启用，桌面端完全不动。
//  对外暴露全局 touch 对象，main.js 每帧据此写入 input。
// ============================================================

const touch = {
  enabled: false,
  move: { x: 0, y: 0 }, // 移动摇杆向量（-1..1）
  aim: { x: 0, y: 0 },  // 瞄准摇杆单位向量
  aiming: false,        // 右摇杆是否在用（按住=瞄准并开火）
  setActive: function () {}, // 由下面赋值：显示/隐藏触屏层
};

(function () {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const isTouch = coarse || (('ontouchstart' in window) && navigator.maxTouchPoints > 0);
  if (!isTouch) return;
  touch.enabled = true;
  document.body.classList.add('touch');

  const JOY_R = 58; // 摇杆基座半径（px）

  // ---------- 创建 DOM ----------
  function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }

  const overlay = div('touch-overlay');
  overlay.style.display = 'none';

  function makeJoy() {
    const base = div('touch-joy');
    const thumb = div('touch-thumb');
    base.appendChild(thumb);
    base.style.display = 'none';
    overlay.appendChild(base);
    return { base: base, thumb: thumb };
  }
  const moveJoy = makeJoy();
  const aimJoy = makeJoy();

  const nadeBtn = div('touch-btn touch-nade');
  nadeBtn.textContent = '雷';
  overlay.appendChild(nadeBtn);

  const exitBtn = div('touch-btn touch-exit');
  exitBtn.textContent = '退出';
  overlay.appendChild(exitBtn);

  // 表情按钮 + 弹出表情条（触屏的表情喷漆入口）
  const emoteBtn = div('touch-btn touch-emote');
  emoteBtn.textContent = '😎';
  overlay.appendChild(emoteBtn);
  const emoteBar = div('touch-emote-bar');
  emoteBar.style.display = 'none';
  const EMOJIS = ['👍', '😎', '😂', '😡', '💀', '❤️'];
  EMOJIS.forEach(function (emo, idx) {
    const b = div('touch-emote-item');
    b.textContent = emo;
    b.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof netEmote === 'function') netEmote(idx);
      emoteBar.style.display = 'none';
    }, { passive: false });
    emoteBar.appendChild(b);
  });
  overlay.appendChild(emoteBar);
  emoteBtn.addEventListener('touchstart', function (e) {
    e.preventDefault(); e.stopPropagation();
    emoteBar.style.display = emoteBar.style.display === 'none' ? 'flex' : 'none';
  }, { passive: false });

  const rotate = div('rotate-hint');
  rotate.innerHTML = '<div>请把手机横过来 🔄<br><span>横屏体验更好</span></div>';

  document.body.appendChild(overlay);
  document.body.appendChild(rotate);

  // ---------- 摇杆显示 ----------
  function showJoy(joy, x, y) {
    joy.base.style.left = (x - JOY_R) + 'px';
    joy.base.style.top = (y - JOY_R) + 'px';
    joy.base.style.display = 'block';
    joy.thumb.style.transform = 'translate(0px,0px)';
  }
  function moveThumb(joy, dx, dy, len) {
    const cl = Math.min(len, JOY_R);
    const ux = len ? dx / len : 0, uy = len ? dy / len : 0;
    joy.thumb.style.transform = 'translate(' + (ux * cl) + 'px,' + (uy * cl) + 'px)';
  }
  function hideJoy(joy) { joy.base.style.display = 'none'; }

  // ---------- 触摸处理 ----------
  let moveId = null, aimId = null;
  let moveBase = { x: 0, y: 0 }, aimBase = { x: 0, y: 0 };

  function startMove(t) {
    moveId = t.identifier; moveBase = { x: t.clientX, y: t.clientY };
    showJoy(moveJoy, t.clientX, t.clientY); updateMove(t);
  }
  function startAim(t) {
    aimId = t.identifier; aimBase = { x: t.clientX, y: t.clientY };
    showJoy(aimJoy, t.clientX, t.clientY); updateAim(t);
  }
  function updateMove(t) {
    const dx = t.clientX - moveBase.x, dy = t.clientY - moveBase.y;
    const len = Math.hypot(dx, dy);
    const cl = Math.min(len, JOY_R);
    touch.move.x = len ? (dx / len) * (cl / JOY_R) : 0;
    touch.move.y = len ? (dy / len) * (cl / JOY_R) : 0;
    moveThumb(moveJoy, dx, dy, len);
  }
  function updateAim(t) {
    const dx = t.clientX - aimBase.x, dy = t.clientY - aimBase.y;
    const len = Math.hypot(dx, dy);
    if (len > 12) { touch.aim.x = dx / len; touch.aim.y = dy / len; touch.aiming = true; }
    else { touch.aiming = false; }
    moveThumb(aimJoy, dx, dy, len);
  }
  function endMove() { moveId = null; touch.move.x = 0; touch.move.y = 0; hideJoy(moveJoy); }
  function endAim() { aimId = null; touch.aim.x = 0; touch.aim.y = 0; touch.aiming = false; hideJoy(aimJoy); }

  overlay.addEventListener('touchstart', function (e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      // 触点落在左半屏 → 移动；右半屏 → 瞄准（按钮有自己的处理并阻止冒泡）
      if (t.clientX < window.innerWidth / 2) { if (moveId === null) startMove(t); }
      else { if (aimId === null) startAim(t); }
    }
  }, { passive: false });

  overlay.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) updateMove(t);
      else if (t.identifier === aimId) updateAim(t);
    }
  }, { passive: false });

  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) endMove();
      else if (t.identifier === aimId) endAim();
    }
  }
  overlay.addEventListener('touchend', onEnd);
  overlay.addEventListener('touchcancel', onEnd);

  // 手雷按钮：朝当前瞄准方向扔（input.aimX/aimY 由 main 每帧更新）
  nadeBtn.addEventListener('touchstart', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (typeof netThrow === 'function') netThrow(input.aimX, input.aimY);
  }, { passive: false });

  // 退出按钮：直接离开房间回落地页
  exitBtn.addEventListener('touchstart', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (typeof netLeaveRoom === 'function') netLeaveRoom();
  }, { passive: false });

  // ---------- 显示/隐藏整层（只在对战中显示，避免挡住大厅/落地页/结算）----------
  let active = false;
  touch.setActive = function (on) {
    on = !!on;
    if (on === active) return; // 幂等，避免每帧反复重置
    active = on;
    overlay.style.display = on ? 'block' : 'none';
    if (!on) { endMove(); endAim(); }
  };
})();
