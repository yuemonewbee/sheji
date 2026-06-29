// ============================================================
//  sound.js —— 音效（用 Web Audio 现场合成，不需要音频文件）
//  其它代码调用 SFX.shoot() / SFX.explode() 等即可。
//  浏览器要求音频必须在"用户操作后"才能播，所以首次点击会 unlock()。
// ============================================================

const SFX = {
  ctx: null,
  master: null,
  noiseBuf: null,
  enabled: true,
  // 用户音量系数（0~1），存 localStorage 下次记住。音效在 master、音乐在 musicGain 上生效。
  sfxVol: 1,
  musVol: 1,
  MASTER_BASE: 0.95, // 音效总音量基准（用户系数在此基础上再乘）

  // 启动时读回上次保存的音量
  loadVolumes() {
    try {
      const s = localStorage.getItem('sfxVol'); if (s != null) this.sfxVol = Math.max(0, Math.min(1, parseFloat(s)));
      const m = localStorage.getItem('musVol'); if (m != null) this.musVol = Math.max(0, Math.min(1, parseFloat(m)));
    } catch (e) {}
  },
  setSfxVol(v) {
    this.sfxVol = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('sfxVol', this.sfxVol); } catch (e) {}
    if (this.master) this.master.gain.value = this.MASTER_BASE * this.sfxVol;
  },
  setMusVol(v) {
    this.musVol = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('musVol', this.musVol); } catch (e) {}
    // 正在播放就实时把音乐音量拉到新值（淡变 0.3s）
    if (this.musicGain && this.ctx && this._MUSIC && this._MUSIC.playing) {
      const now = this.ctx.currentTime;
      const target = Math.max(0.0001, this._musicTargetVol());
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
      this.musicGain.gain.exponentialRampToValueAtTime(target, now + 0.3);
    }
  },
  // 当前情绪下音乐应有的目标音量（含用户系数）
  _musicTargetVol() {
    const M = this._MUSIC;
    const cfg = (M && M.moods[M.mood]) || (M && M.moods.battle);
    return this.MUSIC_VOL * (cfg ? cfg.volMul : 1) * this.musVol;
  },

  // 首次用户交互时调用，创建/恢复音频环境
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      // 限幅器：放大后多个音叠加也不会刺耳爆音（相当于一道保护）
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -8;
      this.comp.knee.value = 6;
      this.comp.ratio.value = 12;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.25;
      this.comp.connect(this.ctx.destination);

      // 音效总音量（整体放大了）。链路：各音效 → master → 限幅器 → 输出
      this.loadVolumes(); // 读回上次保存的音量系数
      this.master = this.ctx.createGain();
      this.master.gain.value = this.MASTER_BASE * this.sfxVol;
      this.master.connect(this.comp);

      // 背景音乐走单独一条链路：各乐音 → musicGain → 限幅器 → 输出。
      // 默认接近静默，startMusic() 时淡入，与音效互不影响地各自调音量。
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0001;
      this.musicGain.connect(this.comp);

      this._makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  _makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  },

  _ok() { return this.ctx && this.enabled; },

  // 一个带音高的音（可滑音）。delay：相对现在延迟多少秒开始
  _tone(freq, dur, type, vol, slideTo, delay) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime + (delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
    osc.onended = function () { osc.disconnect(); g.disconnect(); }; // 播完即断开，及时释放节点
  },

  // 一段噪声（可加滤波），用来做枪声/爆炸
  _noise(dur, vol, filterType, freq, delay) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime + (delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    let f = null;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filterType) {
      f = this.ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq || 1000;
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
    src.onended = function () { src.disconnect(); g.disconnect(); if (f) f.disconnect(); };
  },

  // ---------- 具体音效 ----------
  shoot(vol) {
    const v = vol || 0.3;
    this._noise(0.07, v * 0.6, 'highpass', 900);
    this._tone(240, 0.06, 'square', v * 0.25, 110);
  },
  // 按武器 idx 播不同枪声：0 手枪 / 1 冲锋枪 / 2 霰弹枪 / 3 狙击枪
  shootWeapon(idx, vol) {
    if (idx === 1) {        // 冲锋枪：又快又脆
      const v = vol || 0.3;
      this._noise(0.04, v * 0.5, 'highpass', 1200);
      this._tone(300, 0.04, 'square', v * 0.2, 160);
    } else if (idx === 2) { // 霰弹枪：低沉一大蓬
      const v = vol || 0.3;
      this._noise(0.16, v * 0.9, 'lowpass', 1600);
      this._noise(0.10, v * 0.5, 'highpass', 700);
      this._tone(120, 0.12, 'square', v * 0.3, 60);
    } else if (idx === 3) { // 狙击枪：尖锐一声 + 低频余响
      const v = vol || 0.3;
      this._noise(0.05, v * 0.85, 'highpass', 1500);
      this._tone(700, 0.05, 'square', v * 0.35, 180);
      this._tone(90, 0.18, 'sine', v * 0.4, 50);
    } else {
      this.shoot(vol);      // 手枪
    }
  },
  weaponPickup() {
    // 上扬三连音，和普通拾取区分，更"拿到武器"的感觉
    this._tone(440, 0.08, 'square', 0.22);
    this._tone(660, 0.08, 'square', 0.22, null, 0.07);
    this._tone(990, 0.12, 'square', 0.22, null, 0.14);
  },
  throwNade() {
    // 冲天炮式"啾———"：更低起点、窜得更高更尖、更长
    this._tone(140, 1.0, 'sine', 0.17, 2200);      // 上升哨音（140Hz 一路爬到 2200Hz）
    this._tone(143, 1.0, 'triangle', 0.07, 2215);  // 叠一层略微失谐，更"啸"
    this._noise(1.0, 0.05, 'bandpass', 2200);      // 轻微嘶嘶气流声
  },
  explode() {
    // 咻……砰：先一小段下落哨音，再砸下爆炸
    this._tone(1400, 0.16, 'sine', 0.2, 240);      // 咻（快速下落）
    this._noise(0.55, 0.85, 'lowpass', 820, 0.13); // 砰（延迟一点点，等"咻"落地）
    this._tone(82, 0.55, 'sine', 0.8, 34, 0.13);   // 低频"轰"
  },
  pickup() {
    this._tone(620, 0.08, 'square', 0.22);
    this._tone(930, 0.10, 'square', 0.22, null, 0.08);
  },
  heal() {
    // 柔和的上升和弦，像回血/治疗
    this._tone(523, 0.12, 'sine', 0.22);
    this._tone(659, 0.12, 'sine', 0.22, null, 0.08);
    this._tone(880, 0.16, 'sine', 0.22, null, 0.16);
  },
  hitmarker() { this._tone(1200, 0.05, 'square', 0.16); },      // 你打中了敌人
  hurt() { this._tone(300, 0.18, 'sawtooth', 0.28, 160); },     // 你被打中
  // 开局倒计时滴答：3/2/1 各一声，音高随读秒升高，紧张感渐起
  countTick(n) {
    const freq = n === 1 ? 660 : (n === 2 ? 560 : 480);
    this._tone(freq, 0.12, 'square', 0.3);
    this._tone(freq * 2, 0.08, 'sine', 0.12, null, 0.005);
  },
  // 开打号令：一记上扬号角 + 语音 "Fight!"
  fight() {
    this._tone(523, 0.10, 'square', 0.32);
    this._tone(659, 0.10, 'square', 0.32, null, 0.08);
    this._tone(880, 0.22, 'square', 0.34, null, 0.16);
    this._tone(180, 0.25, 'sine', 0.5, null, 0.02); // 低频垫底
    this._speak('Fight!');
  },
  kill() { this._tone(880, 0.08, 'square', 0.25); this._tone(1320, 0.10, 'square', 0.22, null, 0.08); }, // 你击杀
  snipeKill() { // 狙击一枪毙命：清脆爆头音 + 低频重击
    this._tone(1600, 0.05, 'square', 0.3, 600);
    this._noise(0.06, 0.5, 'highpass', 1800);
    this._tone(1320, 0.12, 'square', 0.28, null, 0.06);
    this._tone(70, 0.22, 'sine', 0.6, 40, 0.04);
  },
  // 连杀播报：合成音效铺底 + 语音念出 Double/Triple/Quad/Penta... Kill
  MULTI_PHRASES: ['', '', 'Double Kill', 'Triple Kill', 'Quadra Kill', 'Penta Kill',
    'Six Kill', 'Seven Kill', 'Eight Kill', 'Nine Kill', 'Ten Kill'],
  multikill(n) {
    if (!this._ok()) return;
    // 等级越高越激昂：上行三连音，音高随 n 升
    const base = 440 + Math.min(n, 8) * 60;
    this._tone(base, 0.10, 'square', 0.26);
    this._tone(base * 1.25, 0.10, 'square', 0.26, null, 0.09);
    this._tone(base * 1.5, 0.16, 'square', 0.28, null, 0.18);
    this._tone(base * 0.5, 0.28, 'sine', 0.4, null, 0.02); // 低频垫一层"燃"
    // 语音（浏览器自带 TTS）：念出对应短语
    this._speak(this.MULTI_PHRASES[Math.min(n, this.MULTI_PHRASES.length - 1)] || (n + ' Kill'));
  },
  _speak(text) {
    if (!text || !this.enabled) return;
    try {
      const ss = window.speechSynthesis;
      if (!ss) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 1.05; u.pitch = 1.0; u.volume = 1.0;
      ss.cancel(); // 打断上一句，避免连杀快时排队堆积
      ss.speak(u);
    } catch (e) {}
  },
  death() { this._tone(420, 0.5, 'sawtooth', 0.35, 70); this._noise(0.4, 0.2, 'lowpass', 400); }, // 你阵亡
  win() {
    this._tone(523, 0.14, 'square', 0.28);
    this._tone(659, 0.14, 'square', 0.28, null, 0.14);
    this._tone(784, 0.22, 'square', 0.28, null, 0.28);
  },
  lose() {
    this._tone(440, 0.16, 'sawtooth', 0.28);
    this._tone(349, 0.16, 'sawtooth', 0.28, null, 0.16);
    this._tone(262, 0.28, 'sawtooth', 0.28, null, 0.32);
  },

  // ============================================================
  //  背景音乐（同样现场合成，无需音频文件，循环播放）
  //  用"提前调度"的手法：定时器每隔一点时间就把接下来 0.2s 内
  //  要响的音符精确排进 Web Audio 的时间轴，循环长度随和弦进行自动算出
  //  （= prog.length 小节 × 每小节 8 个八分音符）。
  // ============================================================
  MUSIC_VOL: 0.22, // 背景音乐总音量旋钮（各情绪在此基础上再乘自己的系数）
  _MUSIC: {
    // 当前生效的参数（startMusic 时按情绪填入）
    bpm: 92,
    prog: null,
    kick: true,
    mood: null,
    // 调度状态
    step: 0,
    nextTime: 0,
    timer: null,
    playing: false,
    // 不同情绪各一套配置：
    //   battle —— 对战中，带底鼓、稍快、稍响
    //   lobby  —— 大厅/等待，去掉底鼓、放慢、更轻柔
    moods: {
      battle: {
        bpm: 92, kick: true, volMul: 1.0,
        // Am → F → C → G
        prog: [
          { bass: 110.00, notes: [220.00, 261.63, 329.63] }, // Am
          { bass: 87.31,  notes: [174.61, 220.00, 261.63] }, // F
          { bass: 130.81, notes: [196.00, 261.63, 329.63] }, // C
          { bass: 98.00,  notes: [196.00, 246.94, 293.66] }, // G
        ],
      },
      lobby: {
        bpm: 74, kick: false, volMul: 0.7,
        // Am → Em → F → C（更舒缓）
        prog: [
          { bass: 110.00, notes: [220.00, 261.63, 329.63] }, // Am
          { bass: 82.41,  notes: [164.81, 196.00, 246.94] }, // Em
          { bass: 87.31,  notes: [174.61, 220.00, 261.63] }, // F
          { bass: 130.81, notes: [196.00, 261.63, 329.63] }, // C
        ],
      },
    },
  },

  // 一个走音乐链路的乐音（带柔和的起音/收音，避免咔哒声）
  _mtone(freq, t, dur, type, vol) {
    if (!this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t); osc.stop(t + dur + 0.02);
    osc.onended = function () { osc.disconnect(); g.disconnect(); }; // 播完即断开，及时释放节点
  },

  // 走音乐链路的底鼓：一个快速下滑的低频正弦 + 极短的包络
  _mkick(t, vol) {
    if (!this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12); // 音高骤降出"咚"
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t); osc.stop(t + 0.2);
    osc.onended = function () { osc.disconnect(); g.disconnect(); };
  },

  // 走音乐链路的轻噪声（hi-hat 打点感）
  _mnoise(t, dur, vol) {
    if (!this.musicGain || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(t); src.stop(t + dur + 0.02);
    src.onended = function () { src.disconnect(); f.disconnect(); g.disconnect(); };
  },

  // 排一个八分音符里该响的所有声部
  _musicStep(step, t, stepDur) {
    const M = this._MUSIC;
    const chord = M.prog[Math.floor(step / 8) % M.prog.length];
    const s = step % 8; // 小节内第几个八分音符

    // 底鼓：每小节第 1、5 拍踩一下，给个稳定的脉冲（大厅情绪关掉）
    if (M.kick && (s === 0 || s === 4)) this._mkick(t, 0.55);

    // 低音：每小节第 1、5 拍踩根音
    if (s === 0 || s === 4) this._mtone(chord.bass, t, stepDur * 3.2, 'triangle', 0.5);

    // 铺底：每小节起始铺一层柔和长和弦
    if (s === 0) for (const n of chord.notes) this._mtone(n, t, stepDur * 7.5, 'sine', 0.16);

    // 琶音：高八度依次点亮和弦音，做出流动旋律
    this._mtone(chord.notes[s % chord.notes.length] * 2, t, stepDur * 0.9, 'triangle', 0.12);

    // hi-hat 打点：正拍轻、反拍稍重
    this._mnoise(t, 0.03, s % 2 === 0 ? 0.05 : 0.08);
  },

  // 调度器：把当前时间后约 0.2s 内的音符都排好
  _musicSched() {
    if (!this.ctx) return;
    const M = this._MUSIC;
    const stepDur = (60 / M.bpm) / 2; // 八分音符时长
    const loopLen = M.prog.length * 8; // 循环步数随和弦进行自动算出
    while (M.nextTime < this.ctx.currentTime + 0.2) {
      this._musicStep(M.step, M.nextTime, stepDur);
      M.step = (M.step + 1) % loopLen;
      M.nextTime += stepDur;
    }
  },

  // 开始/切换背景音乐。mood：'battle'（默认）或 'lobby'
  startMusic(mood) {
    if (!this._ok()) return;          // 没解锁或被静音就不放
    const M = this._MUSIC;
    mood = mood || 'battle';
    const cfg = M.moods[mood] || M.moods.battle;
    if (M.playing && M.mood === mood) return; // 同一情绪已在播，幂等（避免反复拉音量）

    // 切到新情绪的参数（速度/和弦/底鼓下一步自动生效）
    M.mood = mood;
    M.bpm = cfg.bpm;
    M.prog = cfg.prog;
    M.kick = cfg.kick;
    const targetVol = Math.max(0.0001, this.MUSIC_VOL * cfg.volMul * this.musVol); // 含用户系数
    const now = this.ctx.currentTime;

    if (M.playing) {
      // 已在播放，只是换情绪：平滑过渡音量，不重启调度器（无缝衔接）
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.exponentialRampToValueAtTime(targetVol, now + 0.8);
      return;
    }

    // 从静默开始：重置循环并淡入
    M.playing = true;
    M.step = 0;
    M.nextTime = now + 0.1;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(0.0001, now);
    this.musicGain.gain.exponentialRampToValueAtTime(targetVol, now + 1.2);
    const self = this;
    M.timer = setInterval(function() { self._musicSched(); }, 25);
  },

  stopMusic() {
    const M = this._MUSIC;
    if (!M.playing) return;           // 没在播就别再淡出（避免重复调用反复拉音量）
    if (M.timer) { clearInterval(M.timer); M.timer = null; }
    M.playing = false;
    if (this.musicGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4); // 淡出
    }
  },
};
