// Физика 3D-гольфа: мяч на рельефе-функции, стенки и лопасти — капсулы.
// Без DOM и Three.js, поэтому её можно гонять в node (tools/solve3d.js).
(function (root) {
  'use strict';

  const R = 0.22;          // радиус мяча
  const HOLE_R = 0.42;     // радиус лунки
  const G = 16;            // гравитация по умолчанию
  const WALL_R = 0.2;      // полутолщина стенки
  const DT = 1 / 240;

  const CLUBS = {
    putter: { name: 'Паттер', loft: 0, max: 13 },
    wedge: { name: 'Вэдж', loft: (42 * Math.PI) / 180, max: 10.5 },
  };

  const SURF = {
    grass: { k: 0.35, dec: 2.4 },
    sand: { k: 2.6, dec: 9 },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- Помощники для рельефа (используются в уровнях) ----------
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const T = {
    hill: (x, z, cx, cz, r, h) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r)),
    bowl: (x, z, cx, cz, r, depth) => {
      const d2 = (x - cx) ** 2 + (z - cz) ** 2;
      if (d2 >= r * r) return 0;
      const k = 1 - d2 / (r * r);
      return -depth * k * k;
    },
    smooth,
    // Плавный переход высоты от h0 к h1 при изменении координаты от a до b.
    ramp: (v, a, b, h0, h1) => h0 + (h1 - h0) * smooth(a, b, v),
    lin: (v, a, b, h0, h1) => h0 + (h1 - h0) * clamp((v - a) / (b - a), 0, 1),
  };

  function inRect(r, x, z) {
    return x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
  }

  // ---------- Мир ----------
  function createWorld(level) {
    const height = level.height || (() => 0);
    const w = {
      level,
      t: 0,
      g: level.gravity || G,
      height,
      floors: level.floors,
      zones: level.zones || [],
      hole: level.hole,
      state: 'play', // play | sunk | lost | done
      ball: null,
      lastShot: null,
      walls: [],
      windmills: level.windmills || [],
      sweepers: level.sweepers || [],
      events: [],
      minY: Infinity,
    };
    for (const f of w.floors) {
      for (const [x, z] of [[f[0], f[1]], [f[2], f[3]], [f[0], f[3]], [f[2], f[1]]]) w.minY = Math.min(w.minY, height(x, z));
    }
    // Стенки режем на куски ≤ 0.8, чтобы они повторяли рельеф.
    for (const line of level.walls || []) {
      for (let i = 0; i < line.length - 1; i++) {
        const [x0, z0] = line[i], [x1, z1] = line[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.ceil(len / 0.8));
        for (let k = 0; k < n; k++) {
          const ax = x0 + ((x1 - x0) * k) / n, az = z0 + ((z1 - z0) * k) / n;
          const bx = x0 + ((x1 - x0) * (k + 1)) / n, bz = z0 + ((z1 - z0) * (k + 1)) / n;
          w.walls.push({
            a: [ax, height(ax, az) + WALL_R, az],
            b: [bx, height(bx, bz) + WALL_R, bz],
            r: WALL_R,
          });
        }
      }
    }
    for (const c of level.colliders || []) w.walls.push({ a: c.a, b: c.b, r: c.r || WALL_R });
    resetBall(w, level.start[0], level.start[1]);
    w.lastShot = { x: level.start[0], z: level.start[1] };
    return w;
  }

  function floorAt(w, x, z) {
    for (const f of w.floors) if (inRect(f, x, z)) return true;
    return false;
  }

  function surfaceAt(w, x, z) {
    for (const zn of w.zones) if (zn.type === 'sand' && inRect(zn.rect, x, z)) return 'sand';
    return 'grass';
  }

  function groundY(w, x, z) {
    const h = w.hole;
    return w.height(x, z) + (h.bowl ? T.bowl(x, z, h.x, h.z, h.bowl[0], h.bowl[1]) : 0);
  }

  function normalAt(w, x, z) {
    const e = 0.04;
    const hx = (groundY(w, x + e, z) - groundY(w, x - e, z)) / (2 * e);
    const hz = (groundY(w, x, z + e) - groundY(w, x, z - e)) / (2 * e);
    const L = Math.hypot(hx, 1, hz);
    return [-hx / L, 1 / L, -hz / L];
  }

  function resetBall(w, x, z) {
    w.ball = { p: [x, groundY(w, x, z) + R, z], v: [0, 0, 0], resting: true, grounded: true, restT: 0 };
    w.state = 'play';
  }

  function shoot(w, dir, power, club) {
    const c = CLUBS[club];
    const sp = power * c.max;
    const b = w.ball;
    w.lastShot = { x: b.p[0], z: b.p[2] };
    const ch = Math.cos(c.loft), sh = Math.sin(c.loft);
    b.v = [dir[0] * sp * ch, sp * sh, dir[1] * sp * ch];
    b.resting = false;
    b.grounded = false;
    b.restT = 0;
  }

  // ---------- Динамические препятствия ----------
  function windmillBlades(m, t) {
    const out = [];
    const ang0 = (m.phase || 0) + m.speed * t;
    const hub = [m.x, m.hubY, m.z];
    for (let i = 0; i < m.blades; i++) {
      const a = ang0 + (i * 2 * Math.PI) / m.blades;
      out.push({
        a: hub,
        b: [m.x + Math.cos(a) * m.len, m.hubY + Math.sin(a) * m.len, m.z],
        r: 0.16,
        vel: (q) => [-m.speed * (q[1] - m.hubY), m.speed * (q[0] - m.x), 0],
        kind: 'blade',
      });
    }
    return out;
  }

  function sweeperBars(s, w) {
    const out = [];
    const ang0 = (s.phase || 0) + s.speed * w.t;
    const y = w.height(s.x, s.z) + 0.22;
    for (let i = 0; i < s.arms; i++) {
      const a = ang0 + (i * 2 * Math.PI) / s.arms;
      out.push({
        a: [s.x, y, s.z],
        b: [s.x + Math.cos(a) * s.len, y, s.z + Math.sin(a) * s.len],
        r: 0.17,
        vel: (q) => [-s.speed * (q[2] - s.z), 0, s.speed * (q[0] - s.x)],
        kind: 'sweeper',
      });
    }
    return out;
  }

  function dynamicColliders(w) {
    const out = [];
    for (const m of w.windmills) out.push(...windmillBlades(m, w.t));
    for (const s of w.sweepers) out.push(...sweeperBars(s, w));
    return out;
  }

  // Столкновение мяча с капсулой. Возвращает скорость удара.
  function collideCapsule(b, c) {
    const p = b.p;
    const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]];
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    let t = L2 > 0 ? ((p[0] - c.a[0]) * ab[0] + (p[1] - c.a[1]) * ab[1] + (p[2] - c.a[2]) * ab[2]) / L2 : 0;
    t = clamp(t, 0, 1);
    const q = [c.a[0] + ab[0] * t, c.a[1] + ab[1] * t, c.a[2] + ab[2] * t];
    const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    const RR = R + c.r;
    if (dist >= RR || dist < 1e-6) return 0;
    const n = [d[0] / dist, d[1] / dist, d[2] / dist];
    for (let i = 0; i < 3; i++) p[i] = q[i] + n[i] * RR;
    const cv = c.vel ? c.vel(q) : [0, 0, 0];
    const rv = [b.v[0] - cv[0], b.v[1] - cv[1], b.v[2] - cv[2]];
    const vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
    if (vn >= 0) return 0;
    const e = c.kind ? 0.5 : 0.7;
    for (let i = 0; i < 3; i++) b.v[i] = rv[i] - (1 + e) * vn * n[i] + cv[i];
    b.resting = false;
    b.restT = 0;
    return -vn;
  }

  function lose(w, type) {
    w.state = 'lost';
    w.events.push({ type, p: w.ball.p.slice() });
  }

  function step(w, dt) {
    w.t += dt;
    if (w.state !== 'play') return;
    const b = w.ball;
    const p = b.p, v = b.v;
    const dyn = dynamicColliders(w);

    if (b.resting) {
      // Покоящийся мяч может разбудить только движущееся препятствие.
      for (const c of dyn) {
        const hit = collideCapsule(b, c);
        if (hit > 0.3) w.events.push({ type: 'hit', kind: c.kind, speed: hit, p: p.slice() });
      }
      return;
    }

    // Гравитация и ускорители
    v[1] -= w.g * dt;
    if (b.grounded) {
      for (const zn of w.zones) {
        if (zn.type === 'boost' && inRect(zn.rect, p[0], p[2])) {
          v[0] += zn.dir[0] * zn.power * dt;
          v[2] += zn.dir[1] * zn.power * dt;
        }
      }
    }
    // Притяжение лунки
    const hx = w.hole.x - p[0], hz = w.hole.z - p[2];
    const hd = Math.hypot(hx, hz);
    if (b.grounded && hd < HOLE_R + 0.1 && hd > 0.01) {
      v[0] += (hx / hd) * 6 * dt;
      v[2] += (hz / hd) * 6 * dt;
    }

    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;

    // Контакт с землёй
    const wasGrounded = b.grounded;
    b.grounded = false;
    let n = [0, 1, 0];
    if (floorAt(w, p[0], p[2])) {
      const h = groundY(w, p[0], p[2]);
      if (p[1] - R < h && p[1] > h - 0.6) {
        n = normalAt(w, p[0], p[2]);
        p[1] = h + R;
        const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
        if (vn < 0) {
          const e = -vn > 2.2 ? 0.38 : 0;
          for (let i = 0; i < 3; i++) v[i] -= (1 + e) * vn * n[i];
          if (-vn > 2.2) w.events.push({ type: 'bounce', speed: -vn, p: p.slice() });
          else if (!wasGrounded && -vn > 0.8) w.events.push({ type: 'land', speed: -vn, p: p.slice() });
        }
        b.grounded = e0(v, n);
      }
    }

    // Трение качения
    if (b.grounded) {
      const S = SURF[surfaceAt(w, p[0], p[2])];
      const gk = w.g / G; // на Луне трение слабее
      const sp = Math.hypot(v[0], v[1], v[2]);
      if (sp > 0) {
        const ns = Math.max(0, sp * (1 - S.k * dt) - S.dec * gk * dt);
        for (let i = 0; i < 3; i++) v[i] *= ns / sp;
      }
    }

    // Стенки и препятствия (два прохода — на случай углов)
    for (let pass = 0; pass < 2; pass++) {
      for (const c of w.walls) {
        const hit = collideCapsule(b, c);
        if (hit > 0.6 && pass === 0) w.events.push({ type: 'hit', kind: 'wall', speed: hit, p: p.slice() });
      }
      for (const c of dyn) {
        const hit = collideCapsule(b, c);
        if (hit > 0.3 && pass === 0) w.events.push({ type: 'hit', kind: c.kind, speed: hit, p: p.slice() });
      }
    }

    // Лунка
    const hSpeed = Math.hypot(v[0], v[2]);
    if (b.grounded && Math.hypot(w.hole.x - p[0], w.hole.z - p[2]) < HOLE_R - R * 0.4 && hSpeed < 3.4) {
      w.state = 'sunk';
      w.events.push({ type: 'sink', speed: hSpeed });
      return;
    }

    // Падение в пустоту
    if (p[1] < w.minY - 7) { lose(w, 'fall'); return; }

    // Покой
    if (b.grounded) {
      const sp = Math.hypot(v[0], v[1], v[2]);
      const gTan = w.g * Math.sqrt(Math.max(0, 1 - n[1] * n[1]));
      // Трение удерживает мяч, если скатывающая сила меньше торможения.
      const hold = SURF[surfaceAt(w, p[0], p[2])].dec * (w.g / G) + 0.2;
      if (sp < 0.12 && gTan < hold) {
        b.restT += dt;
        if (b.restT > 0.15) {
          b.v = [0, 0, 0];
          b.resting = true;
          w.events.push({ type: 'rest' });
        }
      } else {
        b.restT = 0;
      }
    }
  }

  // Мяч прижат к земле, если после контакта он не отлетает от неё.
  function e0(v, n) {
    return v[0] * n[0] + v[1] * n[1] + v[2] * n[2] < 0.5;
  }

  const api = {
    R, HOLE_R, G, DT, WALL_R, CLUBS, T,
    createWorld, step, shoot, resetBall, groundY, normalAt, floorAt, inRect,
    windmillBlades, sweeperBars, dynamicColliders,
  };
  root.Physics3D = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
