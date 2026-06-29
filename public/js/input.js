// ============================================================
//  input.js —— 输入层（联机版）
//  收集键盘鼠标到 input 对象；主循环每帧把它发给服务器。
//  右键扔手雷是"一次性"动作，直接发一条 throw 消息。
//  aimX/aimY 是鼠标对应的"世界坐标"（已处理画布缩放）。
// ============================================================

const input = {
  up: false, down: false, left: false, right: false,
  aimX: 0, aimY: 0, shoot: false,
};

function setKey(key, down) {
  switch (key.toLowerCase()) {
    case 'w': input.up = down; break;
    case 's': input.down = down; break;
    case 'a': input.left = down; break;
    case 'd': input.right = down; break;
  }
}

// 把鼠标屏幕坐标换算成画布内的"世界坐标"（考虑画布被 CSS 缩放的情况）
function toWorld(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  input.aimX = (e.clientX - rect.left) * sx;
  input.aimY = (e.clientY - rect.top) * sy;
}

let inputInstalled = false;
let lastEmoteAt = 0; // 表情冷却计时
function setupInput(canvas) {
  if (inputInstalled) return;
  inputInstalled = true;

  window.addEventListener('keydown', (e) => setKey(e.key, true));
  window.addEventListener('keyup', (e) => setKey(e.key, false));

  // 表情喷漆：数字键 1~6 发对应表情（带 1.2s 冷却防刷屏）。纯社交，不影响战斗。
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 6 && typeof netEmote === 'function') {
      const now = Date.now();
      if (now - lastEmoteAt < 1200) return; // 冷却
      lastEmoteAt = now;
      netEmote(n - 1);
    }
  });

  // 屏蔽右键相关的浏览器默认行为，避免误操作
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('auxclick', (e) => e.preventDefault());
  canvas.addEventListener('dragstart', (e) => e.preventDefault());

  canvas.addEventListener('mousemove', (e) => toWorld(canvas, e));

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    toWorld(canvas, e);
    if (e.button === 0) {
      input.shoot = true;
    } else if (e.button === 2) {
      netThrow(input.aimX, input.aimY); // 右键：立刻发一条扔雷消息
    }
  });

  canvas.addEventListener('mouseup', (e) => { if (e.button === 0) input.shoot = false; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.shoot = false; });
  window.addEventListener('blur', () => {
    input.up = input.down = input.left = input.right = false;
    input.shoot = false;
  });
}
