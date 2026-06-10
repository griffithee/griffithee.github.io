/* Neuroevolution Arena — griffithee.github.io
   40 agents navigate via tiny neural networks.
   Genetic algorithm: top-30% selection, crossover, mutation each generation.
   Zero dependencies. Runs entirely in the browser.

   Neural net layout (8 inputs → 8 hidden tanh → 2 outputs):
     w[0..63]  input→hidden weights  (8×8 = 64)
     w[64..71] hidden biases         (8)
     w[72..87] hidden→output weights (8×2 = 16)
     w[88..89] output biases         (2)
*/
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const POP           = 40;
  const FOOD_N        = 15;
  const GEN_SECS      = 12;
  const CREATURE_R    = 8;
  const EAT_R         = 14;
  const FOOD_R        = 7;
  const ELITE_N       = 2;
  const PARENT_FRAC   = 0.30;
  const MUTATE_RATE   = 0.12;
  const MUTATE_MAG    = 0.35;
  const SPEEDS        = [1, 5, 20];

  // Weight layout offsets
  const W_SIZE = 90;
  const W_IH   = 0;   // input→hidden: 64 weights
  const W_HB   = 64;  // hidden biases: 8
  const W_HO   = 72;  // hidden→output: 16 weights
  const W_OB   = 88;  // output biases: 2

  // ── Neural Network ────────────────────────────────────────────────────────
  function randomWeights() {
    const w = new Float32Array(W_SIZE);
    for (let i = 0; i < W_SIZE; i++) w[i] = (Math.random() * 2 - 1) * 0.6;
    return w;
  }

  function safeTanh(x) {
    if (x >  7) return  1;
    if (x < -7) return -1;
    const e2 = Math.exp(2 * x);
    return (e2 - 1) / (e2 + 1);
  }

  function netForward(w, inp) {
    const h = new Float32Array(8);
    for (let j = 0; j < 8; j++) {
      let s = w[W_HB + j];
      for (let i = 0; i < 8; i++) s += inp[i] * w[W_IH + j * 8 + i];
      h[j] = safeTanh(s);
    }
    const out = new Float32Array(2);
    for (let k = 0; k < 2; k++) {
      let s = w[W_OB + k];
      for (let j = 0; j < 8; j++) s += h[j] * w[W_HO + k * 8 + j];
      out[k] = safeTanh(s);
    }
    return out;
  }

  // ── Creatures ──────────────────────────────────────────────────────────────
  function makeCreature(W, H, weights) {
    const m = 40;
    return {
      x:     m + Math.random() * (W - 2 * m),
      y:     m + Math.random() * (H - 2 * m),
      ang:   Math.random() * Math.PI * 2,
      spd:   0,
      w:     weights || randomWeights(),
      food:  0,
      time:  0,
      trail: [],
    };
  }

  // Returns normalized closeness to wall in direction `ang` (0 = far, 1 = right there)
  function wallSensor(cx, cy, ang, W, H) {
    const maxD = Math.max(W, H) * 1.1;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    let t = maxD;
    if (cos >  1e-6) t = Math.min(t, (W - cx) / cos);
    if (cos < -1e-6) t = Math.min(t, cx / (-cos));
    if (sin >  1e-6) t = Math.min(t, (H - cy) / sin);
    if (sin < -1e-6) t = Math.min(t, cy / (-sin));
    return Math.max(0, 1 - t / (maxD * 0.65));
  }

  function sense(c, foods, W, H) {
    let minD = 1e9, relAng = 0;
    for (const f of foods) {
      const d = Math.hypot(f.x - c.x, f.y - c.y);
      if (d < minD) { minD = d; relAng = Math.atan2(f.y - c.y, f.x - c.x) - c.ang; }
    }
    return new Float32Array([
      wallSensor(c.x, c.y, c.ang,               W, H), // forward wall
      wallSensor(c.x, c.y, c.ang - Math.PI / 3, W, H), // left-60° wall
      wallSensor(c.x, c.y, c.ang + Math.PI / 3, W, H), // right-60° wall
      wallSensor(c.x, c.y, c.ang + Math.PI,     W, H), // rear wall
      Math.sin(relAng),                                  // food direction sin
      Math.cos(relAng),                                  // food direction cos
      Math.min(1, minD / Math.max(W, H)),                // food distance
      Math.min(1, c.spd / 2.5),                          // own speed
    ]);
  }

  // Returns true if food was eaten this step
  function stepCreature(c, dt, foods, W, H) {
    c.time += dt;
    const out = netForward(c.w, sense(c, foods, W, H));

    // out[0] → turn rate (−1..1), out[1] → thrust (tanh, mapped to 0..1)
    c.ang += out[0] * 0.10;
    const thrust = (out[1] + 1) * 0.5;
    c.spd += (thrust * 2.2 - c.spd) * 0.12;

    c.x += Math.cos(c.ang) * c.spd;
    c.y += Math.sin(c.ang) * c.spd;

    // Bounce off walls
    const M = 6;
    if (c.x <     M) { c.x = M;     c.ang = Math.PI - c.ang; }
    if (c.x > W - M) { c.x = W - M; c.ang = Math.PI - c.ang; }
    if (c.y <     M) { c.y = M;     c.ang = -c.ang; }
    if (c.y > H - M) { c.y = H - M; c.ang = -c.ang; }

    // Trail (sparse points)
    const last = c.trail[c.trail.length - 1];
    if (!last || Math.hypot(c.x - last.x, c.y - last.y) > 5) {
      c.trail.push({ x: c.x, y: c.y });
      if (c.trail.length > 16) c.trail.shift();
    }

    // Eat food
    for (let i = foods.length - 1; i >= 0; i--) {
      if (Math.hypot(foods[i].x - c.x, foods[i].y - c.y) < EAT_R) {
        foods.splice(i, 1);
        c.food++;
        return true;
      }
    }
    return false;
  }

  function fitness(c) {
    return c.food * 200 + c.time; // time is a tie-breaker; food dominates
  }

  // ── Genetics ──────────────────────────────────────────────────────────────
  function crossover(wa, wb) {
    const child = new Float32Array(W_SIZE);
    for (let i = 0; i < W_SIZE; i++) child[i] = Math.random() < 0.5 ? wa[i] : wb[i];
    return child;
  }

  function mutate(w) {
    const m = new Float32Array(w);
    for (let i = 0; i < W_SIZE; i++) {
      if (Math.random() < MUTATE_RATE) m[i] += (Math.random() * 2 - 1) * MUTATE_MAG;
    }
    return m;
  }

  function evolve(prev, W, H) {
    prev.sort((a, b) => fitness(b) - fitness(a));
    const nParents = Math.max(ELITE_N, Math.floor(POP * PARENT_FRAC));
    const parents  = prev.slice(0, nParents);
    const next     = [];

    // Elites carry over unchanged
    for (let i = 0; i < ELITE_N && i < parents.length; i++) {
      next.push(makeCreature(W, H, new Float32Array(parents[i].w)));
    }

    // Fill rest with mutated children of parent pairs
    while (next.length < POP) {
      const p1 = parents[Math.floor(Math.random() * parents.length)];
      const p2 = parents[Math.floor(Math.random() * parents.length)];
      next.push(makeCreature(W, H, mutate(crossover(p1.w, p2.w))));
    }
    return next;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function drawFood(ctx, f) {
    ctx.fillStyle = '#3fb950';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(f.x, f.y, FOOD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(f.x, f.y, FOOD_R * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawCreature(ctx, c, rankFrac, isLeader) {
    const alpha = isLeader ? 1.0 : Math.max(0.18, 0.9 - rankFrac * 0.72);
    const color = isLeader   ? '#58a6ff'
                : rankFrac < 0.25 ? '#39d353'
                : rankFrac < 0.60 ? '#8b949e'
                : '#484f58';

    // Trail
    if (c.trail.length > 2) {
      ctx.globalAlpha = alpha * 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(c.trail[0].x, c.trail[0].y);
      for (let i = 1; i < c.trail.length; i++) ctx.lineTo(c.trail[i].x, c.trail[i].y);
      ctx.stroke();
    }

    // Triangle pointing in direction of movement
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.ang);
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.moveTo( CREATURE_R,         0);
    ctx.lineTo(-CREATURE_R * 0.6, -CREATURE_R * 0.55);
    ctx.lineTo(-CREATURE_R * 0.6,  CREATURE_R * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let W = 0, H = 0;

  function resize() {
    const shell = canvas.parentElement;
    W = shell.clientWidth;
    H = Math.max(320, Math.min(520, Math.round(W * 0.58)));
    canvas.width  = W;
    canvas.height = H;
  }

  let creatures = [];
  let foods     = [];
  let gen       = 0;
  let bestEver  = 0;
  let bestGen   = 0;
  let genTime   = 0;
  let speedIdx  = 0;

  function randomFood() {
    const m = 28;
    return { x: m + Math.random() * (W - 2 * m), y: m + Math.random() * (H - 2 * m) };
  }

  function startGen() {
    foods     = Array.from({ length: FOOD_N }, randomFood);
    genTime   = 0;
    bestGen   = 0;
    creatures = gen === 0
      ? Array.from({ length: POP }, () => makeCreature(W, H))
      : evolve(creatures, W, H);
    gen++;
  }

  // HUD
  const elGen      = document.getElementById('hud-gen');
  const elBest     = document.getElementById('hud-best');
  const elBestEver = document.getElementById('hud-best-ever');
  const elTimer    = document.getElementById('hud-timer');

  function updateHUD() {
    const topFood = creatures.reduce((m, c) => Math.max(m, c.food), 0);
    if (topFood > bestGen)  bestGen  = topFood;
    if (topFood > bestEver) bestEver = topFood;
    const remaining = Math.max(0, GEN_SECS - genTime);
    if (elGen)      elGen.textContent      = gen;
    if (elBest)     elBest.textContent     = bestGen;
    if (elBestEver) elBestEver.textContent = bestEver;
    if (elTimer)    elTimer.textContent    = remaining.toFixed(1) + 's';
  }

  // Speed buttons
  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      speedIdx = parseInt(btn.dataset.speed, 10);
      document.querySelectorAll('.speed-btn').forEach((b, i) => {
        b.classList.toggle('active', i === speedIdx);
      });
    });
  });

  window.addEventListener('resize', () => {
    resize();
    foods = foods.map(() => randomFood());
    creatures.forEach(c => { c.x = Math.min(c.x, W - 10); c.y = Math.min(c.y, H - 10); });
  });

  let lastTs = null;

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const rawDt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    const steps = SPEEDS[speedIdx];
    const dt    = rawDt / steps;

    for (let s = 0; s < steps; s++) {
      genTime += dt;
      for (const c of creatures) {
        if (stepCreature(c, dt, foods, W, H)) foods.push(randomFood());
      }
      if (genTime >= GEN_SECS) { startGen(); break; }
    }

    // Render
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#21262d';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    for (const f of foods) drawFood(ctx, f);

    // Sort ascending so leader draws on top
    const sorted = creatures.slice().sort((a, b) => fitness(a) - fitness(b));
    for (let i = 0; i < sorted.length; i++) {
      drawCreature(ctx, sorted[i], i / sorted.length, i === sorted.length - 1);
    }

    updateHUD();
    requestAnimationFrame(loop);
  }

  resize();
  startGen();
  requestAnimationFrame(loop);
}());
