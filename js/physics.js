// Физика мини-гольфа. Никакого DOM — работает и в браузере, и в node (для тестов).
(function (root) {
  'use strict';

  const BALL_R = 9;
  const HOLE_R = 15;
  const WALL_HALF = 6;
  const MAX_SPEED = 1150;
  const SPEED_CAP = 1700;
  const DT = 1 / 240;

  // k — вязкое трение (доля скорости в секунду), dec — постоянное торможение (px/s²),
  // hold — сила, которую удерживает трение покоя.
  const SURFACES = {
    grass: { k: 0.45, dec: 150, hold: 150 },
    sand: { k: 3.4, dec: 520, hold: 400 },
    ice: { k: 0.05, dec: 10, hold: 20 },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function osc(path, t) {
    if (!path) return [0, 0, 0, 0];
    const w = (2 * Math.PI) / path.period;
    const ph = path.phase || 0;
    const fy = path.fy || 1;
    const dx = path.dx || 0;
    const dy = path.dy || 0;
    return [
      dx * Math.sin(w * t + ph),
      dy * Math.sin(w * fy * t + ph),
      dx * w * Math.cos(w * t + ph),
      dy * w * fy * Math.cos(w * fy * t + ph),
    ];
  }

  function pushPoly(pts, closed, out, extra) {
    const n = pts.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push(Object.assign({ ax: a[0], ay: a[1], bx: b[0], by: b[1] }, extra));
    }
  }

  function inZone(z, x, y) {
    if (z.rect) {
      const [rx, ry, rw, rh] = z.rect;
      return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    }
    if (z.circle) {
      const [cx, cy, r] = z.circle;
      return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
    }
    if (z.poly) {
      let inside = false;
      const p = z.poly;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    return false;
  }

  function createWorld(level) {
    const staticSegs = [];
    for (const poly of level.course) pushPoly(poly, true, staticSegs, {});
    for (const wall of level.walls || []) pushPoly(wall, false, staticSegs, {});

    const w = {
      level,
      t: 0,
      state: 'play', // play | sunk | lost
      ball: { x: level.start[0], y: level.start[1], vx: 0, vy: 0, resting: true, restT: 0 },
      lastShot: { x: level.start[0], y: level.start[1] },
      staticSegs,
      gates: (level.gates || []).map((g) => ({ id: g.id, pts: g.pts, open: !!g.open })),
      buttons: (level.buttons || []).map((b) => ({ ...b, r: b.r || 17, pressed: false, inside: false })),
      bumpers: (level.bumpers || []).map((b) => ({ ...b, flash: 0 })),
      portals: level.portals || [],
      portalLock: null,
      spinners: level.spinners || [],
      movers: level.movers || [],
      wells: level.wells || [],
      zones: level.zones || [],
      surface: 'grass',
      events: [],
    };
    return w;
  }

  function holePos(w) {
    const h = w.level.hole;
    const o = osc(h.path, w.t);
    return [h.x + o[0], h.y + o[1]];
  }

  function spinnerSegs(sp, t, out) {
    const ang0 = (sp.phase || 0) + sp.speed * t;
    const vel = (px, py) => [-sp.speed * (py - sp.y), sp.speed * (px - sp.x)];
    for (let i = 0; i < sp.arms; i++) {
      const a = ang0 + (i * 2 * Math.PI) / sp.arms;
      out.push({
        ax: sp.x, ay: sp.y,
        bx: sp.x + Math.cos(a) * sp.len, by: sp.y + Math.sin(a) * sp.len,
        half: 7, vel, bounce: 0.55, kind: 'spinner',
      });
    }
  }

  function moverRect(m, t) {
    const o = osc(m.path, t);
    return { x: m.x + o[0], y: m.y + o[1], w: m.w, h: m.h, vx: o[2], vy: o[3] };
  }

  function dynamicSegs(w) {
    const out = [];
    for (const sp of w.spinners) spinnerSegs(sp, w.t, out);
    for (const m of w.movers) {
      const r = moverRect(m, w.t);
      const v = [r.vx, r.vy];
      pushPoly(
        [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]],
        true, out, { vel: () => v, kind: 'mover' }
      );
    }
    for (const g of w.gates) if (!g.open) pushPoly(g.pts, false, out, { kind: 'gate', bounce: 0.6 });
    return out;
  }

  // Возвращает скорость удара по нормали (0 если касания нет).
  function collideSeg(b, s) {
    const ex = s.bx - s.ax, ey = s.by - s.ay;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / L2 : 0;
    t = clamp(t, 0, 1);
    const px = s.ax + ex * t, py = s.ay + ey * t;
    const dx = b.x - px, dy = b.y - py;
    const R = BALL_R + (s.half || WALL_HALF);
    const d2 = dx * dx + dy * dy;
    if (d2 >= R * R) return 0;
    const d = Math.sqrt(d2);
    let nx, ny;
    if (d < 1e-6) {
      const L = Math.sqrt(L2) || 1;
      nx = -ey / L; ny = ex / L;
    } else {
      nx = dx / d; ny = dy / d;
    }
    b.x += nx * (R - d);
    b.y += ny * (R - d);
    let cvx = 0, cvy = 0;
    if (s.vel) [cvx, cvy] = s.vel(px, py);
    const rvx = b.vx - cvx, rvy = b.vy - cvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const e = s.bounce != null ? s.bounce : 0.72;
    // Лёгкое трение по касательной, чтобы скользящие касания гасили скорость.
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const nvn = -e * vn;
    const nvt = vt * 0.97;
    b.vx = nx * nvn + tx * nvt + cvx;
    b.vy = ny * nvn + ty * nvt + cvy;
    b.resting = false;
    b.restT = 0;
    return -vn;
  }

  function resetBall(w, x, y) {
    const b = w.ball;
    b.x = x; b.y = y; b.vx = 0; b.vy = 0; b.resting = true; b.restT = 0;
    w.state = 'play';
    w.portalLock = null;
  }

  function shoot(w, vx, vy) {
    const b = w.ball;
    w.lastShot = { x: b.x, y: b.y };
    b.vx = vx; b.vy = vy; b.resting = false; b.restT = 0;
  }

  function lose(w, type) {
    w.state = 'lost';
    w.events.push({ type, x: w.ball.x, y: w.ball.y });
    w.ball.vx = 0; w.ball.vy = 0;
  }

  function step(w, dt) {
    w.t += dt;
    for (const bm of w.bumpers) bm.flash = Math.max(0, bm.flash - dt * 4);
    if (w.state !== 'play') return;
    const b = w.ball;

    // --- Поверхности и силы ---
    let ax = 0, ay = 0;
    let surface = 'grass';
    for (const z of w.zones) {
      if (!inZone(z, b.x, b.y)) continue;
      if (z.type === 'water') { lose(w, 'water'); return; }
      if (z.type === 'sand' || z.type === 'ice') surface = z.type;
      if (z.type === 'boost' || z.type === 'wind') {
        const a = (z.dir * Math.PI) / 180;
        ax += Math.cos(a) * z.power;
        ay += Math.sin(a) * z.power;
      }
    }
    w.surface = surface;
    for (const wl of w.wells) {
      const dx = wl.x - b.x, dy = wl.y - b.y;
      const d = Math.hypot(dx, dy);
      if (wl.power > 0 && d < (wl.core || 13)) { lose(w, 'void'); return; }
      if (d < wl.r && d > 0.001) {
        const f = wl.power * Math.pow(1 - d / wl.r, 1.4);
        ax += (dx / d) * f;
        ay += (dy / d) * f;
      }
    }
    const [hx, hy] = holePos(w);
    {
      const dx = hx - b.x, dy = hy - b.y;
      const d = Math.hypot(dx, dy);
      if (d < HOLE_R + 5 && d > 0.5) {
        ax += (dx / d) * 500;
        ay += (dy / d) * 500;
      }
    }

    const S = SURFACES[surface];
    let sp = Math.hypot(b.vx, b.vy);
    const aMag = Math.hypot(ax, ay);
    if (sp < 6 && aMag < S.hold) { ax = 0; ay = 0; }

    b.vx += ax * dt;
    b.vy += ay * dt;
    sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      let ns = Math.max(0, sp * (1 - S.k * dt) - S.dec * dt);
      ns = Math.min(ns, SPEED_CAP);
      b.vx *= ns / sp;
      b.vy *= ns / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // --- Столкновения ---
    const segs = w.staticSegs.concat(dynamicSegs(w));
    for (let pass = 0; pass < 2; pass++) {
      for (const s of segs) {
        const hit = collideSeg(b, s);
        if (hit > 40 && pass === 0) w.events.push({ type: 'wall', speed: hit, kind: s.kind, x: b.x, y: b.y });
      }
    }
    for (let i = 0; i < w.bumpers.length; i++) {
      const bm = w.bumpers[i];
      const dx = b.x - bm.x, dy = b.y - bm.y;
      const R = bm.r + BALL_R;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1;
        const nx = dx / d, ny = dy / d;
        b.x = bm.x + nx * R;
        b.y = bm.y + ny * R;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          const kick = bm.kick != null ? bm.kick : 280;
          const e = bm.bounce != null ? bm.bounce : 0.95;
          b.vx -= (1 + e) * vn * nx;
          b.vy -= (1 + e) * vn * ny;
          b.vx += nx * kick;
          b.vy += ny * kick;
          bm.flash = 1;
          b.resting = false;
          w.events.push({ type: 'bumper', i, x: b.x, y: b.y, kick });
        }
      }
    }

    // --- Кнопки ---
    for (const bt of w.buttons) {
      const inside = Math.hypot(b.x - bt.x, b.y - bt.y) < bt.r;
      if (inside && !bt.inside) {
        bt.pressed = !bt.pressed;
        for (const g of w.gates) if (bt.toggles.includes(g.id)) g.open = !g.open;
        w.events.push({ type: 'button', x: bt.x, y: bt.y, pressed: bt.pressed });
      }
      bt.inside = inside;
    }

    // --- Порталы ---
    if (w.portalLock) {
      const [pi, end] = w.portalLock;
      const p = w.portals[pi][end];
      if (Math.hypot(b.x - p[0], b.y - p[1]) > 28) w.portalLock = null;
    }
    for (let i = 0; i < w.portals.length && w.state === 'play'; i++) {
      const pr = w.portals[i];
      for (const end of ['a', 'b']) {
        if (w.portalLock && w.portalLock[0] === i && w.portalLock[1] === end) continue;
        const p = pr[end];
        if (Math.hypot(b.x - p[0], b.y - p[1]) < 15) {
          const other = end === 'a' ? 'b' : 'a';
          const q = pr[other];
          const turn = (((pr.turn || 0) * Math.PI) / 180) * (end === 'a' ? 1 : -1);
          const c = Math.cos(turn), s = Math.sin(turn);
          const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
          w.events.push({ type: 'portal', i, from: [b.x, b.y], to: [q[0], q[1]] });
          b.x = q[0]; b.y = q[1]; b.vx = vx; b.vy = vy;
          w.portalLock = [i, other];
          break;
        }
      }
      if (w.portalLock && w.portalLock[0] === i) break;
    }

    // --- Лунка ---
    sp = Math.hypot(b.vx, b.vy);
    const dh = Math.hypot(hx - b.x, hy - b.y);
    if (dh < HOLE_R - 3 && sp < 560) {
      w.state = 'sunk';
      w.events.push({ type: 'sink', x: hx, y: hy, speed: sp });
      return;
    }

    // --- Покой ---
    if (sp < 6) {
      b.restT += dt;
      if (b.restT > 0.2 || sp === 0) {
        b.vx = 0; b.vy = 0;
        if (!b.resting) w.events.push({ type: 'rest' });
        b.resting = true;
      }
    } else {
      b.restT = 0;
      b.resting = false;
    }
  }

  const api = {
    BALL_R, HOLE_R, WALL_HALF, MAX_SPEED, DT, SURFACES,
    osc, inZone, createWorld, holePos, dynamicSegs, moverRect, step, shoot, resetBall,
  };
  root.Physics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
