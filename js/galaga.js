/* Galaga-style fixed shooter for griffithee.github.io */
(function () {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = document.createElement('p');
    fallback.className = 'game-fallback';
    fallback.style.marginTop = 'var(--space-4)';
    fallback.style.color = 'var(--text-muted)';
    fallback.style.fontFamily = 'var(--font-mono)';
    fallback.textContent = 'This browser cannot create a 2D canvas context, so Arcade Run cannot start.';
    canvas.replaceWith(fallback);
    return;
  }
  const hud = {
    score: document.getElementById('hud-score'),
    lives: document.getElementById('hud-lives'),
    wave: document.getElementById('hud-wave'),
    best: document.getElementById('hud-best'),
    remaining: document.getElementById('hud-remaining'),
    overlay: document.getElementById('game-overlay'),
    startButton: document.getElementById('start-run'),
    restartButton: document.getElementById('restart-run'),
    soundToggle: document.getElementById('sound-toggle'),
  };

  const DPR = Math.max(1, window.devicePixelRatio || 1);
  const state = {
    score: 0,
    lives: 3,
    wave: 1,
    bestScore: 0,
    started: false,
    gameOver: false,
    paused: false,
    scoreFlash: 0,
    shake: 0,
    waveTransition: 0,
    waveMessage: '',
    waveMessageTimer: 0,
    soundOn: true,
  };

  const view = {
    w: 0,
    h: 0,
    midX: 0,
    midY: 0,
  };

  const input = {
    left: false,
    right: false,
    fire: false,
    fireQueued: false,
    pointerActive: false,
    pointerX: 0,
  };

  const stars = [];
  const bullets = [];
  const enemyBullets = [];
  const enemies = [];
  const particles = [];

  let player = createPlayer();
  let formation = createFormation();
  let spawnDiveClock = 2.2;
  let lastTime = performance.now();
  let rafId = 0;
  let audioCtx = null;
  let resizePending = false;
  const bestScoreKey = 'griffithee.arcade-run.best-score';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = (t) => (t < 0.5)
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function createPlayer() {
    return {
      x: 0,
      y: 0,
      w: 34,
      h: 24,
      speed: 460,
      cooldown: 0,
      invuln: 0,
      blink: 0,
    };
  }

  function createFormation() {
    return {
      cx: 0,
      cy: 0,
      vx: 54,
      dir: 1,
      cellW: 76,
      cellH: 58,
      cols: 4,
      rows: 3,
      settled: false,
      descend: 0,
      shiftClock: 0,
    };
  }

  function init() {
    state.bestScore = loadBestScore();
    resizeCanvas();
    window.addEventListener('resize', queueResize, { passive: true });
    window.addEventListener('orientationchange', queueResize, { passive: true });
    bindKeyboard();
    bindPointer();
    bindButtons();
    resetRun(false);
    rafId = requestAnimationFrame(loop);
  }

  function queueResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      resizeCanvas();
    });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const oldW = view.w || rect.width;
    const oldH = view.h || rect.height;
    view.w = rect.width;
    view.h = rect.height;
    view.midX = view.w / 2;
    view.midY = view.h / 2;

    canvas.width = Math.round(view.w * DPR);
    canvas.height = Math.round(view.h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (stars.length === 0) {
      seedStars();
    } else if (oldW && oldH && (oldW !== view.w || oldH !== view.h)) {
      const sx = view.w / oldW;
      const sy = view.h / oldH;
      player.x *= sx;
      player.y *= sy;
      player.x = clamp(player.x, 24, view.w - 24);
      player.y = view.h - 64;
      bullets.forEach((b) => {
        b.x *= sx;
        b.y *= sy;
      });
      enemyBullets.forEach((b) => {
        b.x *= sx;
        b.y *= sy;
      });
      enemies.forEach((enemy) => {
        enemy.x *= sx;
        enemy.y *= sy;
        enemy.startX *= sx;
        enemy.startY *= sy;
        enemy.targetX *= sx;
        enemy.targetY *= sy;
        enemy.returnStartX *= sx;
        enemy.returnStartY *= sy;
        enemy.returnTargetX *= sx;
        enemy.returnTargetY *= sy;
      });
      particles.forEach((p) => {
        p.x *= sx;
        p.y *= sy;
      });
      formation.cx *= sx;
      formation.cy *= sy;
      formation.cellW *= sx;
      formation.cellH *= sy;
    }
  }

  function seedStars() {
    stars.length = 0;
    const count = 96;
    for (let i = 0; i < count; i += 1) {
      stars.push({
        x: Math.random() * (view.w || 960),
        y: Math.random() * (view.h || 720),
        r: rand(0.8, 2.4),
        speed: rand(18, 76),
        alpha: rand(0.25, 0.9),
      });
    }
  }

  function loadBestScore() {
    try {
      if (!('localStorage' in window)) return 0;
      const raw = window.localStorage.getItem(bestScoreKey);
      const value = raw === null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function saveBestScore(score) {
    try {
      if (!('localStorage' in window)) return;
      window.localStorage.setItem(bestScoreKey, String(Math.max(0, Math.floor(score))));
    } catch {
      // Ignore storage errors. The game still works without persistence.
    }
  }

  function syncBestScore() {
    if (state.score > state.bestScore) {
      state.bestScore = state.score;
      saveBestScore(state.bestScore);
    }
  }

  function bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (['arrowleft', 'arrowright', ' ', 'spacebar', 'a', 'd', 'r', 'p', 'm'].includes(key)) {
        event.preventDefault();
      }

      if (key === 'm') {
        toggleSound();
        return;
      }

      if (key === 'p') {
        if (state.started && !state.gameOver) state.paused = !state.paused;
        return;
      }

      if (key === 'r') {
        resetRun(true);
        return;
      }

      if (['arrowleft', 'arrowright', ' ', 'spacebar', 'a', 'd', 'r'].includes(key)) {
        ensureStartedFromInput();
      }

      if (key === 'arrowleft' || key === 'a') input.left = true;
      if (key === 'arrowright' || key === 'd') input.right = true;
      if (key === ' ' || key === 'spacebar') input.fire = true;
    });

    window.addEventListener('keyup', (event) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') input.left = false;
      if (key === 'arrowright' || key === 'd') input.right = false;
      if (key === ' ' || key === 'spacebar') input.fire = false;
    });
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      ensureStartedFromInput();
      canvas.setPointerCapture?.(event.pointerId);
      input.pointerActive = true;
      input.pointerX = pointerToCanvasX(event.clientX);
      input.fireQueued = true;
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!input.pointerActive) return;
      input.pointerX = pointerToCanvasX(event.clientX);
    });

    const pointerUp = () => {
      input.pointerActive = false;
    };
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('pointerleave', pointerUp);
  }

  function bindButtons() {
    hud.startButton?.addEventListener('click', () => resetRun(true));
    hud.restartButton?.addEventListener('click', () => resetRun(true));
    hud.soundToggle?.addEventListener('click', () => toggleSound());

    document.querySelectorAll('[data-control]').forEach((button) => {
      const control = button.getAttribute('data-control');
      const down = (event) => {
        event.preventDefault();
        ensureStartedFromInput();
        if (control === 'fire') {
          input.fireQueued = true;
          input.fire = true;
          return;
        }
        input[control] = true;
      };
      const up = (event) => {
        event.preventDefault();
        if (control === 'fire') {
          input.fire = false;
          return;
        }
        input[control] = false;
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', up);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  function pointerToCanvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return clamp(clientX - rect.left, 18, rect.width - 18);
  }

  function ensureAudio() {
    if (!state.soundOn) return;
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        state.soundOn = false;
        hud.soundToggle.textContent = 'Sound off';
        return;
      }
      try {
        audioCtx = new AudioCtor();
      } catch {
        state.soundOn = false;
        hud.soundToggle.textContent = 'Sound off';
        return;
      }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function tone({ freq = 440, wave = 'sine', duration = 0.08, gain = 0.04, sweep = 0 }) {
    if (!state.soundOn) return;
    ensureAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, now);
    if (sweep) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(32, freq + sweep), now + duration);
    }

    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.05);

    osc.connect(amp);
    amp.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.08);
  }

  const sfx = {
    shoot() {
      tone({ freq: 720, wave: 'square', duration: 0.05, gain: 0.035, sweep: -160 });
    },
    enemyShoot() {
      tone({ freq: 260, wave: 'triangle', duration: 0.07, gain: 0.03, sweep: -60 });
    },
    dive() {
      tone({ freq: 200, wave: 'triangle', duration: 0.08, gain: 0.025, sweep: 120 });
    },
    hit() {
      tone({ freq: 140, wave: 'sawtooth', duration: 0.12, gain: 0.045, sweep: -40 });
    },
    explosion() {
      tone({ freq: 110, wave: 'square', duration: 0.16, gain: 0.05, sweep: -70 });
    },
    wave() {
      tone({ freq: 520, wave: 'triangle', duration: 0.12, gain: 0.04, sweep: 180 });
    },
    lifeLost() {
      tone({ freq: 92, wave: 'sawtooth', duration: 0.2, gain: 0.05, sweep: -20 });
    },
  };

  function toggleSound(force) {
    const next = typeof force === 'boolean' ? force : !state.soundOn;
    state.soundOn = next;
    hud.soundToggle.textContent = state.soundOn ? 'Sound on' : 'Sound off';
    if (state.soundOn) {
      ensureAudio();
    }
  }

  function resetRun(fromUser) {
    if (fromUser) ensureAudio();
    state.score = 0;
    state.lives = 3;
    state.wave = 1;
    state.waveTransition = 0;
    state.started = !!fromUser;
    state.gameOver = false;
    state.paused = false;
    state.scoreFlash = 0;
    state.shake = 0;
    state.waveMessage = fromUser ? 'Wave 1' : '';
    state.waveMessageTimer = fromUser ? 1.1 : 0;
    input.left = false;
    input.right = false;
    input.fire = false;
    input.fireQueued = false;
    input.pointerActive = false;
    bullets.length = 0;
    enemyBullets.length = 0;
    particles.length = 0;
    player = createPlayer();
    player.x = view.midX || 480;
    player.y = (view.h || 720) - 64;
    formation = createFormation();
    spawnDiveClock = 1.1;
    seedStars();
    enemies.length = 0;
    if (fromUser) {
      spawnWave(1);
      hideOverlay();
      sfx.wave();
    } else if (hud.overlay) {
      hud.overlay.classList.add('visible');
    }
    updateHud();
    if (fromUser && !rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  function showOverlay(title, body, actionText) {
    if (!hud.overlay) return;
    hud.overlay.classList.add('visible');
    hud.overlay.innerHTML = `
      <div class="game-overlay-panel">
        <div class="game-overlay-kicker">${escapeHtml(actionText || 'Arcade run')}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
        <div class="game-overlay-actions">
          <button class="btn btn-primary" id="start-run" type="button">${state.gameOver ? 'Restart run' : 'Start run'}</button>
          <a class="btn btn-secondary" href="#controls">How to play</a>
        </div>
      </div>
    `;
    hud.startButton = document.getElementById('start-run');
    hud.startButton?.addEventListener('click', () => resetRun(true));
  }

  function hideOverlay() {
    hud.overlay?.classList.remove('visible');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function spawnWave(wave) {
    enemies.length = 0;

    const rows = Math.min(3 + Math.floor((wave - 1) / 2), 5);
    const cols = Math.min(4 + Math.floor((wave - 1) / 2), 7);
    const baseY = view.h * 0.15;
    const usableW = Math.max(view.w * 0.6, view.w - 140);
    const cellW = clamp(usableW / Math.max(4, cols - 0.25), view.w * 0.1, 94);
    const cellH = clamp(view.h / 9.4, view.h * 0.09, 70);
    const totalW = (cols - 1) * cellW;

    formation = {
      cx: view.midX || view.w / 2,
      cy: baseY,
      vx: 52 + wave * 5,
      dir: 1,
      cellW,
      cellH,
      cols,
      rows,
      settled: false,
      descend: 0,
      shiftClock: 0,
    };

    const aceRate = clamp(0.12 + wave * 0.06, 0.12, 0.4);
    const startX = view.midX - totalW / 2;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const isAce = row === 0 || (row === 1 && Math.random() < aceRate);
        const enemy = {
          type: isAce ? 'ace' : 'scout',
          hp: isAce ? 2 : 1,
          value: isAce ? 180 : 100,
          row,
          col,
          x: rand(40, Math.max(80, view.w - 40)),
          y: rand(-180, -40) - row * 22,
          startX: 0,
          startY: 0,
          targetX: 0,
          targetY: 0,
          diveTargetX: 0,
          diveTargetY: 0,
          returnStartX: 0,
          returnStartY: 0,
          returnTargetX: 0,
          returnTargetY: 0,
          state: 'entering',
          enterProgress: 0,
          diveProgress: 0,
          returnProgress: 0,
          diveDuration: Math.max(0.55, 0.95 - wave * 0.045 + (isAce ? 0.08 : 0)),
          returnDuration: 0.58 + wave * 0.02,
          shotTimer: rand(0.7, 2.1),
          shotBias: isAce ? 0.8 : 1,
          shotFired: false,
          arc: rand(-96, 96),
          wobble: rand(0, Math.PI * 2),
          dead: false,
        };
        const slot = slotPosition(enemy, startX);
        enemy.startX = enemy.x;
        enemy.startY = enemy.y;
        enemy.targetX = slot.x;
        enemy.targetY = slot.y;
        enemies.push(enemy);
      }
    }

    state.waveMessage = `Wave ${wave}`;
    state.waveMessageTimer = 1.2;
    state.waveTransition = 0;
    spawnDiveClock = rand(0.9, 1.6);
  }

  function slotPosition(enemy, startXOverride) {
    const startX = typeof startXOverride === 'number'
      ? startXOverride
      : (view.midX - ((formation.cols - 1) * formation.cellW) / 2);
    return {
      x: startX + enemy.col * formation.cellW,
      y: formation.cy + enemy.row * formation.cellH,
    };
  }

  function ensureStartedFromInput() {
    if (!state.started || state.gameOver) {
      resetRun(true);
      return;
    }
    ensureAudio();
    if (hud.overlay?.classList.contains('visible')) {
      hideOverlay();
    }
  }

  function firePlayerBullet() {
    if (player.cooldown > 0 || bullets.length >= 3 || state.gameOver || state.paused) return;
    bullets.push({
      x: player.x,
      y: player.y - player.h * 0.6,
      w: 6,
      h: 14,
      vy: -820,
      owner: 'player',
    });
    player.cooldown = 0.16;
    sfx.shoot();
  }

  function fireEnemyBullet(enemy, speedBoost = 0) {
    if (enemyBullets.length >= 12 || enemy.dead) return;
    enemyBullets.push({
      x: enemy.x,
      y: enemy.y + 10,
      w: 5,
      h: 14,
      vy: 340 + state.wave * 28 + speedBoost,
      owner: 'enemy',
    });
    sfx.enemyShoot();
  }

  function killEnemy(enemy, byDive = false) {
    if (enemy.dead) return;
    enemy.dead = true;
    const points = enemy.value + (byDive ? 50 : 0);
    state.score += points;
    syncBestScore();
    state.scoreFlash = 0.35;
    state.shake = Math.max(state.shake, byDive ? 6 : 4);
    sfx.explosion();
    burst(enemy.x, enemy.y, byDive ? '#d29922' : '#58a6ff', byDive ? 18 : 14, byDive ? 110 : 80);
    updateHud();
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * rand(0.35, 1);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: rand(0.28, 0.72),
        size: rand(1.5, 3.8),
        color,
      });
    }
  }

  function loseLife(sourceX, sourceY) {
    if (player.invuln > 0 || state.gameOver) return;
    state.lives -= 1;
    updateHud();
    state.shake = 10;
    state.scoreFlash = 0.18;
    sfx.lifeLost();
    burst(sourceX || player.x, sourceY || player.y, '#f85149', 26, 160);
    player.invuln = 2.1;
    player.x = view.midX;
    player.y = view.h - 64;
    bullets.length = 0;
    enemyBullets.length = 0;
    if (state.lives <= 0) {
      gameOver();
    }
  }

  function gameOver() {
    syncBestScore();
    state.gameOver = true;
    state.started = true;
    state.waveMessage = 'Game over';
    state.waveMessageTimer = 2.0;
    showOverlay('Game over', `You reached wave ${state.wave} with ${formatScore(state.score)} points. Best run: ${formatScore(state.bestScore)}.`, 'Run ended');
  }

  function formatScore(score) {
    return String(Math.max(0, Math.floor(score))).padStart(6, '0');
  }

  function updateHud() {
    hud.score.textContent = formatScore(state.score);
    hud.lives.textContent = String(Math.max(0, state.lives));
    hud.wave.textContent = String(state.wave);
    hud.best.textContent = formatScore(state.bestScore);
    hud.remaining.textContent = String(enemies.filter((enemy) => !enemy.dead).length);
    hud.soundToggle.textContent = state.soundOn ? 'Sound on' : 'Sound off';
  }

  function update(dt) {
    if (!state.started) {
      updateStars(dt);
      updateParticles(dt);
      updateHud();
      return;
    }

    if (state.paused || state.gameOver) {
      updateHud();
      return;
    }

    if (state.waveTransition > 0) {
      updateStars(dt);
      updateParticles(dt);
      if (state.scoreFlash > 0) state.scoreFlash -= dt;
      if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 18);
      if (state.waveMessageTimer > 0) state.waveMessageTimer -= dt;
      state.waveTransition = Math.max(0, state.waveTransition - dt);
      if (state.waveTransition === 0) {
        spawnWave(state.wave);
      }
      updateHud();
      return;
    }

    updateStars(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateParticles(dt);
    resolveCollisions();

    if (state.scoreFlash > 0) state.scoreFlash -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 18);
    if (state.waveMessageTimer > 0) state.waveMessageTimer -= dt;

    if (input.fireQueued) {
      firePlayerBullet();
      input.fireQueued = false;
    }

    if (input.fire) {
      firePlayerBullet();
    }

    if (state.started && !state.gameOver && remainingEnemies() === 0) {
      clearWave();
    }

    updateHud();
  }

  function updateStars(dt) {
    stars.forEach((star) => {
      star.y += star.speed * dt;
      if (star.y > view.h + 5) {
        star.y = -5;
        star.x = Math.random() * view.w;
      }
    });
  }

  function updatePlayer(dt) {
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.blink += dt;

    let move = 0;
    if (input.left) move -= 1;
    if (input.right) move += 1;

    if (input.pointerActive) {
      const delta = input.pointerX - player.x;
      if (Math.abs(delta) > 3) {
        move = clamp(delta / 48, -1, 1);
      } else {
        move = 0;
      }
    }

    player.x += move * player.speed * dt;
    player.x = clamp(player.x, 26, view.w - 26);
    player.y = view.h - 64;

    if (player.invuln > 0 && Math.floor(player.blink * 10) % 2 === 0) {
      player.x += Math.sin(player.blink * 26) * 0.2;
    }
  }

  function updateEnemies(dt) {
    if (remainingEnemies() === 0) return;

    const alive = enemies.filter((enemy) => !enemy.dead);
    const engaged = alive.filter((enemy) => enemy.state === 'formation' || enemy.state === 'returning');

    formation.shiftClock += dt;
    formation.descend = Math.max(0, formation.descend - dt * 10);

    if (engaged.length > 0) {
      formation.cx += formation.vx * formation.dir * dt;
      const halfWidth = ((formation.cols - 1) * formation.cellW) / 2;
      const left = formation.cx - halfWidth;
      const right = formation.cx + halfWidth;
      const margin = 38;
      if (left < margin) {
        formation.cx += margin - left;
        formation.dir = 1;
        formation.descend += 10;
      } else if (right > view.w - margin) {
        formation.cx -= right - (view.w - margin);
        formation.dir = -1;
        formation.descend += 10;
      }
    }

    enemies.forEach((enemy) => {
      if (enemy.dead) return;

      const target = slotPosition(enemy);
      const targetX = target.x;
      const targetY = target.y + formation.descend;

      if (enemy.state === 'entering') {
        enemy.enterProgress = Math.min(1, enemy.enterProgress + dt * (1.45 + state.wave * 0.02));
        const t = easeOutCubic(enemy.enterProgress);
        enemy.x = lerp(enemy.startX, targetX, t);
        enemy.y = lerp(enemy.startY, targetY, t);
        if (enemy.enterProgress >= 1) {
          enemy.state = 'formation';
          enemy.x = targetX;
          enemy.y = targetY;
          burst(enemy.x, enemy.y, enemy.type === 'ace' ? '#d29922' : '#39d353', 3, 35);
        }
      } else if (enemy.state === 'formation') {
        enemy.x = targetX;
        enemy.y = targetY;
        enemy.shotTimer -= dt;
        if (enemy.shotTimer <= 0) {
          const shootChance = clamp(0.18 + state.wave * 0.03 + (enemy.type === 'ace' ? 0.12 : 0), 0.18, 0.72);
          if (Math.random() < shootChance) {
            fireEnemyBullet(enemy, enemy.type === 'ace' ? 26 : 0);
          }
          enemy.shotTimer = rand(0.7, 1.7) * clamp(1.08 - state.wave * 0.04, 0.55, 1.08);
        }
      } else if (enemy.state === 'diving') {
        enemy.diveProgress = Math.min(1, enemy.diveProgress + dt / enemy.diveDuration);
        // Light homing toward current player position (makes dives feel more dangerous)
        const homingStrength = 0.35 + state.wave * 0.04;
        enemy.targetX = lerp(enemy.targetX, clamp(player.x, 40, view.w - 40), dt * homingStrength);
        const t = easeInOutCubic(enemy.diveProgress);
        const arc = Math.sin(enemy.diveProgress * Math.PI) * enemy.arc;
        enemy.x = lerp(enemy.startX, enemy.targetX, t) + arc * 0.22;
        enemy.y = lerp(enemy.startY, enemy.targetY, t) - Math.sin(enemy.diveProgress * Math.PI) * 84;
        if (!enemy.shotFired && enemy.diveProgress > 0.4) {
          enemy.shotFired = true;
          fireEnemyBullet(enemy, enemy.type === 'ace' ? 32 : 0);
        }
        if (enemy.diveProgress >= 1) {
          enemy.state = 'returning';
          enemy.returnProgress = 0;
          enemy.returnStartX = enemy.x;
          enemy.returnStartY = enemy.y;
          enemy.shotTimer = rand(0.4, 1.2);
        }
      } else if (enemy.state === 'returning') {
        enemy.returnProgress = Math.min(1, enemy.returnProgress + dt / enemy.returnDuration);
        const t = easeOutCubic(enemy.returnProgress);
        enemy.x = lerp(enemy.returnStartX, targetX, t);
        enemy.y = lerp(enemy.returnStartY, targetY, t);
        if (enemy.returnProgress >= 1 || Math.hypot(enemy.x - targetX, enemy.y - targetY) < 3) {
          enemy.state = 'formation';
          enemy.x = targetX;
          enemy.y = targetY;
          enemy.shotTimer = rand(0.8, 1.7);
        }
      }
    });

    spawnDiveClock -= dt;
    const maxConcurrentDives = clamp(1 + Math.floor((state.wave - 1) / 2), 1, 3);
    const activeDives = enemies.filter((enemy) => !enemy.dead && enemy.state === 'diving').length;
    if (spawnDiveClock <= 0 && activeDives < maxConcurrentDives) {
      const candidates = enemies.filter((enemy) => !enemy.dead && enemy.state === 'formation');
      if (candidates.length > 0) {
        const viable = candidates.sort((a, b) => b.row - a.row || a.col - b.col);
        const pool = viable.slice(0, Math.max(2, Math.ceil(viable.length * 0.5)));
        const diver = pool[Math.floor(Math.random() * pool.length)];
        if (diver) {
          startDive(diver);
        }
      }
      spawnDiveClock = rand(0.85, 1.75) * clamp(1.08 - state.wave * 0.04, 0.55, 1.08);
    }
  }

  function startDive(enemy) {
    const start = { x: enemy.x, y: enemy.y };
    enemy.state = 'diving';
    enemy.startX = start.x;
    enemy.startY = start.y;
    enemy.targetX = clamp(player.x + rand(-35, 35), 34, view.w - 34);
    enemy.targetY = clamp(view.h * 0.82 + rand(-25, 25), view.h * 0.68, view.h - 55);
    enemy.diveProgress = 0;
    enemy.shotFired = false;
    enemy.diveDuration = Math.max(0.55, 0.95 - state.wave * 0.045 + (enemy.type === 'ace' ? 0.08 : 0));
    enemy.arc = rand(-120, 120);
    sfx.dive();
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i -= 1) {
      const bullet = bullets[i];
      bullet.y += bullet.vy * dt;
      if (bullet.y < -20) {
        bullets.splice(i, 1);
      }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i -= 1) {
      const bullet = enemyBullets[i];
      bullet.y += bullet.vy * dt;
      if (bullet.y > view.h + 24) {
        enemyBullets.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }
  }

  function resolveCollisions() {
    for (let i = bullets.length - 1; i >= 0; i -= 1) {
      const bullet = bullets[i];
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j -= 1) {
        const enemy = enemies[j];
        if (enemy.dead) continue;
        const hitRadius = enemy.type === 'ace' ? 16 : 14;
        if (collides(bullet, bullet.w, bullet.h, enemy, hitRadius * 2, hitRadius * 2)) {
          bullets.splice(i, 1);
          hit = true;
          enemy.hp -= 1;
          if (enemy.hp <= 0) {
            killEnemy(enemy, enemy.state === 'diving');
          } else {
            sfx.hit();
            burst(enemy.x, enemy.y, '#d29922', 8, 70);
          }
          break;
        }
      }
      if (hit) continue;
    }

    for (let i = enemyBullets.length - 1; i >= 0; i -= 1) {
      const bullet = enemyBullets[i];
      if (collides(bullet, bullet.w, bullet.h, player, player.w, player.h)) {
        enemyBullets.splice(i, 1);
        loseLife(bullet.x, bullet.y);
      }
    }

    enemies.forEach((enemy) => {
      if (enemy.dead || player.invuln > 0) return;
      const size = enemy.type === 'ace' ? 32 : 28;
      if (collides(enemy, size, size, player, player.w, player.h)) {
        killEnemy(enemy, enemy.state === 'diving');
        loseLife(enemy.x, enemy.y);
      }
    });
  }

  function collides(a, aw, ah, b, bw, bh) {
    return Math.abs(a.x - b.x) < (aw + bw) / 2 && Math.abs(a.y - b.y) < (ah + bh) / 2;
  }

  function remainingEnemies() {
    return enemies.filter((enemy) => !enemy.dead).length;
  }

  function clearWave() {
    if (state.gameOver) return;
    bullets.length = 0;
    enemyBullets.length = 0;
    const bonus = 500 + state.lives * 80;
    state.score += bonus;
    syncBestScore();
    state.scoreFlash = 0.45;
    state.wave += 1;
    state.waveMessage = `Wave ${state.wave - 1} clear`;
    state.waveMessageTimer = 0.95;
    state.waveTransition = 0.85;
    state.shake = 6;
    sfx.wave();
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) {
      const magnitude = state.shake;
      ctx.translate(rand(-magnitude, magnitude), rand(-magnitude, magnitude));
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, view.h);
    gradient.addColorStop(0, '#0b1220');
    gradient.addColorStop(0.55, '#071019');
    gradient.addColorStop(1, '#04070b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.w, view.h);

    drawNebula();
    drawStars();
    drawGrid();
    drawBullets();
    drawEnemies();
    drawParticles();
    drawPlayer();
    drawHUDBanner();
    drawFlash();

    ctx.restore();
  }

  function drawNebula() {
    const glow = ctx.createRadialGradient(view.w * 0.28, view.h * 0.12, 0, view.w * 0.28, view.h * 0.12, view.w * 0.52);
    glow.addColorStop(0, 'rgba(88, 166, 255, 0.1)');
    glow.addColorStop(0.48, 'rgba(88, 166, 255, 0.03)');
    glow.addColorStop(1, 'rgba(88, 166, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, view.w, view.h);

    const glow2 = ctx.createRadialGradient(view.w * 0.76, view.h * 0.26, 0, view.w * 0.76, view.h * 0.26, view.w * 0.42);
    glow2.addColorStop(0, 'rgba(63, 185, 80, 0.08)');
    glow2.addColorStop(0.5, 'rgba(63, 185, 80, 0.02)');
    glow2.addColorStop(1, 'rgba(63, 185, 80, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  function drawStars() {
    stars.forEach((star, index) => {
      const twinkle = 0.55 + Math.sin((index + star.y) * 0.03 + lastTime * 0.001) * 0.35;
      ctx.fillStyle = `rgba(230, 237, 243, ${star.alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= view.w; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, view.h);
      ctx.stroke();
    }
    for (let y = 0; y <= view.h; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(view.w, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    if (!state.started || state.gameOver) return;
    const blinkVisible = player.invuln <= 0 || Math.floor(player.blink * 14) % 2 === 0;
    if (!blinkVisible) return;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowColor = 'rgba(88, 166, 255, 0.35)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#58a6ff';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(18, 10);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 18);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-18, 10);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(-4, -10, 8, 18);
    ctx.fillStyle = '#39d353';
    ctx.fillRect(-2, 8, 4, 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(-10, 8, 4, 7);
    ctx.fillRect(6, 8, 4, 7);

    // Aim guide — faint vertical line from barrel tip to top of canvas
    if (player.cooldown <= 0 && bullets.length < 3) {
      ctx.strokeStyle = 'rgba(88, 166, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(0, -(player.y - 4));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawEnemy(enemy) {
    const color = enemy.type === 'ace' ? '#d29922' : '#58a6ff';
    const glow = enemy.type === 'ace' ? 'rgba(210, 153, 34, 0.35)' : 'rgba(88, 166, 255, 0.35)';
    const tilt = enemy.state === 'diving'
      ? clamp((enemy.targetX - enemy.startX) / 220, -0.35, 0.35)
      : (formation.dir > 0 ? 0.04 : -0.04);

    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(tilt);
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(14, -2);
    ctx.lineTo(14, 10);
    ctx.lineTo(6, 12);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-6, 12);
    ctx.lineTo(-14, 10);
    ctx.lineTo(-14, -2);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(-3, -4, 6, 7);
    ctx.fillStyle = enemy.type === 'ace' ? '#0d1117' : '#0d1117';
    ctx.fillRect(-1, -2, 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(-10, 8, 4, 4);
    ctx.fillRect(6, 8, 4, 4);
    if (enemy.type === 'ace') {
      ctx.fillStyle = 'rgba(13, 17, 23, 0.5)';
      ctx.fillRect(-1, 6, 2, 9);
    }
    ctx.restore();
  }

  function drawEnemies() {
    enemies.forEach((enemy) => {
      if (!enemy.dead) drawEnemy(enemy);
    });
  }

  function drawBullets() {
    bullets.forEach((bullet) => {
      ctx.save();
      ctx.shadowColor = 'rgba(57, 211, 83, 0.55)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#39d353';
      roundRect(bullet.x - bullet.w / 2, bullet.y - bullet.h / 2, bullet.w, bullet.h, 2);
      ctx.fill();
      ctx.restore();
    });

    enemyBullets.forEach((bullet) => {
      ctx.save();
      ctx.shadowColor = 'rgba(248, 81, 73, 0.55)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#f85149';
      roundRect(bullet.x - bullet.w / 2, bullet.y - bullet.h / 2, bullet.w, bullet.h, 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawParticles() {
    particles.forEach((particle) => {
      const alpha = clamp(particle.life / 0.72, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawHUDBanner() {
    if (state.waveMessageTimer <= 0) return;
    const alpha = clamp(state.waveMessageTimer / 1.0, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e6edf3';
    ctx.font = '700 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(13, 17, 23, 0.75)';
    ctx.shadowBlur = 8;
    ctx.fillText(state.waveMessage, view.midX, view.h * 0.16);
    ctx.restore();
  }

  function drawFlash() {
    if (state.scoreFlash <= 0) return;
    const alpha = clamp(state.scoreFlash / 0.35, 0, 1) * 0.12;
    ctx.save();
    ctx.fillStyle = `rgba(88, 166, 255, ${alpha})`;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0);
    lastTime = now;
    try {
      if (!state.paused) update(dt);
      draw();
    } catch (err) {
      console.error('[galaga] loop error:', err);
    }
    rafId = requestAnimationFrame(loop);
  }

  init();
})();
