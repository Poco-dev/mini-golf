// Игровой цикл, рендер, ввод и интерфейс.
(function () {
  'use strict';

  const P = window.Physics;
  const LEVELS = window.LEVELS;
  const { BALL_R, HOLE_R, MAX_SPEED, DT } = P;
  const W = 1000, H = 640;
  const MAX_DRAG = 190;
  const STROKE_LIMIT_OVER_PAR = 5;
  const BEST_KEY = 'kosmogolf-best';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  let scale = 1, dpr = 1;

  const game = {
    mode: 'title', // title | play | card | end
    idx: 0,
    scores: [],
    strokes: 0,
    world: null,
    aim: null,
    particles: [],
    rings: [],
    shake: 0,
    trail: [],
    ghost: [],
    shotPath: [],
    lostTimer: 0,
    sinkTimer: 0,
    sinkAnim: 0,
    time: 0,
    lastSpinnerSound: 0,
  };

  // ---------- Утилиты ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmtRel = (n) => (n === 0 ? 'E' : n > 0 ? '+' + n : String(n));

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // ---------- Фон: звёзды и туманности ----------
  const stars = (() => {
    const r = seeded(7);
    const out = [];
    for (let i = 0; i < 220; i++) out.push({ x: r() * W, y: r() * H, s: r() * 1.6 + 0.3, p: r() * 6.28, d: r() * 0.6 + 0.2 });
    return out;
  })();

  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0f2e');
    g.addColorStop(1, '#05060f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const neb = [[180, 120, 260, 'rgba(120,60,200,0.16)'], [820, 520, 300, 'rgba(40,120,220,0.14)'], [900, 80, 180, 'rgba(255,90,140,0.08)']];
    for (const [x, y, r, c] of neb) {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const s of stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * s.d + s.p));
      ctx.fillStyle = `rgba(220,230,255,${a})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
  }

  // ---------- Текстуры ----------
  function makePattern(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    return ctx.createPattern(c, 'repeat');
  }
  const grassPattern = makePattern(64, (g, s) => {
    g.fillStyle = '#2f9c57';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#35a95f';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s / 2, 0); g.lineTo(0, s / 2); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(s, 0); g.lineTo(s, s / 2); g.lineTo(s / 2, s); g.lineTo(0, s); g.closePath(); g.fill();
    const r = seeded(3);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(r() * s, r() * s, 1.5, 2.5);
    }
  });
  const sandPattern = makePattern(32, (g, s) => {
    g.fillStyle = '#e6cc86';
    g.fillRect(0, 0, s, s);
    const r = seeded(11);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(150,110,40,0.35)' : 'rgba(255,255,255,0.4)';
      g.fillRect(r() * s, r() * s, 1.3, 1.3);
    }
  });

  // ---------- Геометрия ----------
  function polyPath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  function zonePath(z) {
    ctx.beginPath();
    if (z.rect) ctx.rect(z.rect[0], z.rect[1], z.rect[2], z.rect[3]);
    else if (z.circle) ctx.arc(z.circle[0], z.circle[1], z.circle[2], 0, Math.PI * 2);
    else if (z.poly) {
      ctx.moveTo(z.poly[0][0], z.poly[0][1]);
      for (const p of z.poly.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
    }
  }
  function zoneBounds(z) {
    if (z.rect) return z.rect;
    if (z.circle) return [z.circle[0] - z.circle[2], z.circle[1] - z.circle[2], z.circle[2] * 2, z.circle[2] * 2];
    const xs = z.poly.map((p) => p[0]), ys = z.poly.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }

  // ---------- Рендер уровня ----------
  function drawCourse(w) {
    const lvl = w.level;
    ctx.save();
    ctx.shadowColor = 'rgba(80,255,160,0.25)';
    ctx.shadowBlur = 40;
    for (const poly of lvl.course) {
      polyPath(poly);
      ctx.closePath();
      ctx.fillStyle = grassPattern;
      ctx.fill();
    }
    ctx.restore();
    // Мягкая виньетка внутри газона
    for (const poly of lvl.course) {
      ctx.save();
      polyPath(poly);
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,40,10,0.35)';
      ctx.lineWidth = 34;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawZones(w, t) {
    for (const z of w.zones) {
      ctx.save();
      zonePath(z);
      const [bx, by, bw, bh] = zoneBounds(z);
      if (z.type === 'sand') {
        ctx.fillStyle = sandPattern;
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,85,30,0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (z.type === 'ice') {
        const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
        g.addColorStop(0, '#dff5ff');
        g.addColorStop(0.5, '#b4e2f7');
        g.addColorStop(1, '#d4f0ff');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        const r = seeded(bx + by);
        for (let i = 0; i < bw * bh / 9000; i++) {
          const x = bx + r() * bw, y = by + r() * bh, l = 10 + r() * 30;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y - l * 0.6); ctx.stroke();
        }
        const sx = bx + ((t * 120) % (bw + 400)) - 200;
        const sg = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)');
        sg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(bx, by, bw, bh);
      } else if (z.type === 'water') {
        const g = ctx.createRadialGradient(bx + bw / 2, by + bh / 2, 5, bx + bw / 2, by + bh / 2, Math.max(bw, bh));
        g.addColorStop(0, '#2a8ae0');
        g.addColorStop(1, '#0f4a9c');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,220,255,0.8)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.clip();
        ctx.strokeStyle = 'rgba(200,235,255,0.35)';
        ctx.lineWidth = 2;
        for (let y = by + 10; y < by + bh; y += 14) {
          ctx.beginPath();
          for (let x = bx; x <= bx + bw; x += 6) {
            const yy = y + Math.sin(x * 0.08 + t * 2.4 + y) * 2.5;
            if (x === bx) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
      } else if (z.type === 'boost') {
        ctx.fillStyle = 'rgba(255,190,40,0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,60,0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.clip();
        const a = (z.dir * Math.PI) / 180;
        const cx = bx + bw / 2, cy = by + bh / 2;
        ctx.translate(cx, cy);
        ctx.rotate(a);
        const span = Math.hypot(bw, bh);
        ctx.strokeStyle = '#ffd23d';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        const off = (t * 60) % 22;
        for (let x = -span / 2 + off; x < span / 2; x += 22) {
          const alpha = 1 - Math.abs(x) / (span / 2);
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.beginPath();
          ctx.moveTo(x - 7, -12); ctx.lineTo(x + 3, 0); ctx.lineTo(x - 7, 12);
          ctx.stroke();
        }
      } else if (z.type === 'wind') {
        ctx.fillStyle = 'rgba(170,210,255,0.07)';
        ctx.fill();
        ctx.clip();
        const a = (z.dir * Math.PI) / 180;
        const dx = Math.cos(a), dy = Math.sin(a);
        // Большая полупрозрачная стрелка направления
        ctx.save();
        ctx.translate(bx + bw / 2, by + bh / 2);
        ctx.rotate(a);
        const pulse = 0.08 + 0.04 * Math.sin(t * 3);
        ctx.fillStyle = `rgba(230,245,255,${pulse})`;
        ctx.beginPath();
        ctx.moveTo(60, 0); ctx.lineTo(0, -45); ctx.lineTo(0, -18); ctx.lineTo(-60, -18);
        ctx.lineTo(-60, 18); ctx.lineTo(0, 18); ctx.lineTo(0, 45); ctx.closePath();
        ctx.fill();
        ctx.restore();
        const r = seeded(bx * 3 + by);
        ctx.strokeStyle = 'rgba(230,245,255,0.5)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        const n = Math.floor(bw * bh / 3500);
        for (let i = 0; i < n; i++) {
          const ox = r() * bw, oy = r() * bh, sp = 90 + r() * 90, len = 14 + r() * 26;
          const travel = (t * sp + r() * 1000) % (Math.abs(dx) * bw + Math.abs(dy) * bh + 60);
          let x = bx + ((ox + dx * travel) % bw + bw) % bw;
          let y = by + ((oy + dy * travel) % bh + bh) % bh;
          const wob = Math.sin(t * 3 + i) * 3;
          ctx.globalAlpha = 0.25 + 0.5 * r();
          ctx.beginPath();
          ctx.moveTo(x - dy * wob, y + dx * wob);
          ctx.lineTo(x - dx * len, y - dy * len);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  function drawWalls(w) {
    const segs = w.staticSegs;
    const stroke = (ox, oy, color, width) => {
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s.ax + ox, s.ay + oy);
        ctx.lineTo(s.bx + ox, s.by + oy);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    stroke(3, 5, 'rgba(0,0,0,0.35)', 12);
    stroke(0, 0, '#c9b58c', 12);
    stroke(0, -1.5, '#f4e6c4', 7);
    stroke(0, -2.5, 'rgba(255,255,255,0.6)', 2);
    ctx.restore();
  }

  function drawHole(w, t) {
    const [hx, hy] = P.holePos(w);
    const moving = !!w.level.hole.path;
    ctx.save();
    // Светящийся ореол
    const glow = ctx.createRadialGradient(hx, hy, HOLE_R, hx, hy, HOLE_R + 22);
    glow.addColorStop(0, moving ? 'rgba(255,120,200,0.35)' : 'rgba(255,255,200,0.25)');
    glow.addColorStop(1, 'rgba(255,255,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(hx, hy, HOLE_R + 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d5e33';
    ctx.beginPath(); ctx.arc(hx, hy + 1, HOLE_R + 2.5, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(hx, hy - 4, 2, hx, hy, HOLE_R);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#141414');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hx, hy, HOLE_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx, hy, HOLE_R, 0.2, Math.PI - 0.2); ctx.stroke();

    // Флажок (поднимается, когда мяч рядом)
    const b = w.ball;
    const near = Math.hypot(b.x - hx, b.y - hy) < 70 ? 1 : 0;
    game.flagLift = (game.flagLift || 0) + (near - (game.flagLift || 0)) * 0.1;
    const lift = game.flagLift * 26;
    ctx.globalAlpha = 1 - game.flagLift * 0.5;
    const top = hy - 58 - lift;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hx + 2, hy); ctx.lineTo(hx + 20, hy - 10); ctx.stroke();
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(hx, hy - lift); ctx.lineTo(hx, top); ctx.stroke();
    ctx.fillStyle = moving ? '#ff4fa0' : '#ff3d3d';
    ctx.beginPath();
    ctx.moveTo(hx, top);
    for (let i = 0; i <= 10; i++) {
      const x = hx + i * 3;
      ctx.lineTo(x, top + Math.sin(t * 6 - i * 0.6) * 2 * (i / 10));
    }
    for (let i = 10; i >= 0; i--) {
      const x = hx + i * 3 * (1 - (i / 10) * 0.0);
      const y = top + 18 - (i / 10) * 9 + Math.sin(t * 6 - i * 0.6) * 2 * (i / 10);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawWells(w, t) {
    for (const wl of w.wells) {
      ctx.save();
      ctx.translate(wl.x, wl.y);
      // Поле притяжения
      const fg = ctx.createRadialGradient(0, 0, 10, 0, 0, wl.r);
      fg.addColorStop(0, 'rgba(120,40,200,0.35)');
      fg.addColorStop(1, 'rgba(120,40,200,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, 0, wl.r, 0, Math.PI * 2); ctx.fill();
      // Сходящиеся кольца
      for (let i = 0; i < 4; i++) {
        const k = 1 - ((t * 0.35 + i / 4) % 1);
        ctx.strokeStyle = `rgba(190,140,255,${0.25 * (1 - k) + 0.05})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 8]);
        ctx.beginPath(); ctx.arc(0, 0, 18 + k * (wl.r - 18), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
      // Аккреционный диск
      ctx.rotate(t * 1.7);
      for (let i = 0; i < 3; i++) {
        ctx.rotate(Math.PI * 2 / 3);
        const r = 22 + i * 7;
        ctx.strokeStyle = ['#ffb347', '#ff6a3d', '#ffd98a'][i];
        ctx.lineWidth = 3.5 - i;
        ctx.shadowColor = '#ff8a3d';
        ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 1.1); ctx.stroke();
      }
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#b36bff';
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(0, 0, wl.core || 14, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawPortals(w, t) {
    for (const pr of w.portals) {
      for (const end of ['a', 'b']) {
        const [x, y] = pr[end];
        const col = pr.color || '#c77dff';
        ctx.save();
        ctx.translate(x, y);
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.3, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.rotate(t * (end === 'a' ? 2.5 : -2.5));
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        for (let i = 0; i < 3; i++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.beginPath(); ctx.arc(0, 0, 17, 0, 1.3); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function drawButtons(w, t) {
    for (const bt of w.buttons) {
      ctx.save();
      ctx.translate(bt.x, bt.y);
      const on = bt.pressed;
      const col = on ? '#3dff9e' : '#ff4d6d';
      if (!on) {
        const k = (t * 1.2) % 1;
        ctx.strokeStyle = `rgba(255,77,109,${1 - k})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, bt.r + k * 18, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#444a5c';
      ctx.beginPath(); ctx.arc(0, 0, bt.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, on ? 1 : -2, bt.r - 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawGates(w, t) {
    for (const g of w.gates) {
      ctx.save();
      polyPath(g.pts);
      ctx.lineCap = 'round';
      if (g.open) {
        ctx.strokeStyle = 'rgba(61,255,158,0.25)';
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 10]);
        ctx.stroke();
      } else {
        ctx.shadowColor = '#ff2d55';
        ctx.shadowBlur = 16;
        ctx.strokeStyle = 'rgba(255,45,85,0.35)';
        ctx.lineWidth = 12;
        ctx.stroke();
        ctx.strokeStyle = '#ff7a95';
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 8]);
        ctx.lineDashOffset = -t * 60;
        ctx.stroke();
      }
      ctx.restore();
      for (const p of [g.pts[0], g.pts[g.pts.length - 1]]) {
        ctx.fillStyle = g.open ? '#2a7a55' : '#8a2238';
        ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawBumpers(w) {
    for (const bm of w.bumpers) {
      const s = 1 + bm.flash * 0.18;
      const r = bm.r * s;
      const soft = (bm.kick != null ? bm.kick : 280) < 150;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(bm.x + 3, bm.y + 5, r, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(bm.x - r * 0.3, bm.y - r * 0.4, 2, bm.x, bm.y, r);
      if (soft) {
        g.addColorStop(0, '#d8dcea');
        g.addColorStop(1, '#6c7289');
      } else {
        g.addColorStop(0, bm.flash > 0 ? '#fff' : '#ff9ec0');
        g.addColorStop(1, '#d11a5a');
      }
      ctx.fillStyle = g;
      if (bm.flash > 0) { ctx.shadowColor = '#ff5d8f'; ctx.shadowBlur = 30 * bm.flash; }
      ctx.beginPath(); ctx.arc(bm.x, bm.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = soft ? 'rgba(255,255,255,0.5)' : '#ffe0ec';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(bm.x, bm.y, r * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawSpinners(w) {
    const segs = [];
    for (const sp of w.spinners) {
      const out = [];
      const ang0 = (sp.phase || 0) + sp.speed * w.t;
      for (let i = 0; i < sp.arms; i++) {
        const a = ang0 + (i * 2 * Math.PI) / sp.arms;
        out.push([sp.x + Math.cos(a) * sp.len, sp.y + Math.sin(a) * sp.len]);
      }
      segs.push([sp, out]);
    }
    for (const [sp, tips] of segs) {
      ctx.save();
      ctx.lineCap = 'round';
      for (const [ox, oy, col, lw] of [[3, 5, 'rgba(0,0,0,0.35)', 14], [0, 0, '#7a4a22', 14], [0, -1, '#c98a4b', 8], [0, -2, '#f0c690', 2]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (const [tx, ty] of tips) { ctx.moveTo(sp.x + ox, sp.y + oy); ctx.lineTo(tx + ox, ty + oy); }
        ctx.stroke();
      }
      ctx.fillStyle = '#5b3417';
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffcc3d';
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawMovers(w) {
    for (const m of w.movers) {
      const r = P.moverRect(m, w.t);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 12;
      ctx.strokeRect(r.x + 3, r.y + 5, r.w, r.h);
      ctx.fillRect(r.x + 3, r.y + 5, r.w, r.h);
      const g = ctx.createLinearGradient(r.x, r.y - 6, r.x, r.y + r.h + 6);
      g.addColorStop(0, '#a9adc2');
      g.addColorStop(1, '#5c6078');
      ctx.fillStyle = g;
      ctx.strokeStyle = g;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#ffcc3d';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⇅', r.x + r.w / 2, r.y + r.h / 2);
      ctx.restore();
    }
  }

  function drawGhost() {
    if (game.ghost.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,220,255,0.28)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(game.ghost[0][0], game.ghost[0][1]);
    for (const p of game.ghost) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawBall(w) {
    const b = w.ball;
    // След
    if (game.trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < game.trail.length; i++) {
        const a = i / game.trail.length;
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.35})`;
        ctx.lineWidth = BALL_R * 1.6 * a;
        ctx.beginPath();
        ctx.moveTo(game.trail[i - 1][0], game.trail[i - 1][1]);
        ctx.lineTo(game.trail[i][0], game.trail[i][1]);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (w.state === 'lost') return;
    let s = 1, bx = b.x, by = b.y;
    if (w.state === 'sunk') {
      const [hx, hy] = P.holePos(w);
      const k = Math.min(1, game.sinkAnim / 0.35);
      s = 1 - k * 0.75;
      bx = b.x + (hx - b.x) * k;
      by = b.y + (hy - b.y) * k;
      if (k >= 1) return;
    }
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(bx + 3, by + 5, BALL_R * s, BALL_R * 0.8 * s, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(bx - 3 * s, by - 3 * s, 1, bx, by, BALL_R * s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#e8ecf5');
    g.addColorStop(1, '#a9b2c8');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, BALL_R * s, 0, Math.PI * 2); ctx.fill();
    // Пульсация, когда можно бить
    if (b.resting && w.state === 'play' && game.mode === 'play' && !game.aim) {
      const k = (game.time * 1.3) % 1;
      ctx.strokeStyle = `rgba(255,220,80,${0.7 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, BALL_R + 4 + k * 14, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function aimVector() {
    const a = game.aim;
    if (!a) return null;
    const dx = a.sx - a.cx, dy = a.sy - a.cy;
    const len = Math.hypot(dx, dy);
    if (len < 6) return null;
    const power = Math.min(1, len / MAX_DRAG);
    return { dx: dx / len, dy: dy / len, power };
  }

  function drawAim(w) {
    const v = aimVector();
    if (!v) return;
    const b = w.ball;
    const hue = 130 - v.power * 130;
    const col = `hsl(${hue},95%,58%)`;
    const L = 30 + v.power * 170;
    ctx.save();
    // Линия натяжения от точки касания
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(game.aim.sx, game.aim.sy); ctx.lineTo(game.aim.cx, game.aim.cy); ctx.stroke();
    ctx.setLineDash([]);
    // Точки направления
    ctx.fillStyle = col;
    for (let d = BALL_R + 10; d < L; d += 12) {
      const r = 3.2 * (1 - (d / L) * 0.55);
      ctx.beginPath(); ctx.arc(b.x + v.dx * d, b.y + v.dy * d, r, 0, Math.PI * 2); ctx.fill();
    }
    // Стрелка
    const tx = b.x + v.dx * (L + 6), ty = b.y + v.dy * (L + 6);
    ctx.translate(tx, ty);
    ctx.rotate(Math.atan2(v.dy, v.dx));
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
    // Кольцо силы вокруг мяча
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.power);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(v.power * 100) + '%', b.x, b.y - BALL_R - 18);
    ctx.restore();
  }

  // ---------- Частицы ----------
  function burst(x, y, n, { colors = ['#fff'], speed = [60, 240], life = [0.4, 0.9], size = [2, 4], gravity = 0, drag = 2.5, shape = 'dot' } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed[0], speed[1]);
      const l = rand(life[0], life[1]);
      game.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: l, max: l, size: rand(size[0], size[1]), color: pick(colors),
        gravity, drag, shape, rot: Math.random() * 6, vr: rand(-10, 10),
      });
    }
  }
  function ring(x, y, color, max = 40, life = 0.5) {
    game.rings.push({ x, y, color, max, life, t: 0 });
  }
  function updateFx(dt) {
    for (const p of game.particles) {
      p.life -= dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);
    for (const r of game.rings) r.t += dt;
    game.rings = game.rings.filter((r) => r.t < r.life);
    game.shake = Math.max(0, game.shake - dt * 30);
  }
  function drawFx() {
    for (const p of game.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shape === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const r of game.rings) {
      const k = r.t / r.life;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, 6 + k * r.max, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Комментатор ----------
  const LINES = {
    water: ['Буль.', 'Мяч ушёл в дайвинг', 'Рыбы благодарят за подарок', '+1 за купание'],
    void: ['Мяч покинул нашу Вселенную', 'Спагеттификация!', 'Горизонт событий пройден', 'Хокинг был бы горд'],
    portal: ['Вжух!', 'Телепортация!', 'Сквозь пространство', 'Кротовая нора!'],
    button: ['Щёлк! Поле отключено', 'Путь открыт'],
    buttonOff: ['Щёлк… поле снова включено'],
    bumper: ['Бдыщ!', 'Бомп!', 'Пинбол-мастер'],
    limit: ['Лимит ударов. Мяч конфискован', 'Хватит мучить мяч'],
  };
  let toastTimer = null;
  function toast(text, small = false) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('small', small);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
  }

  function resultName(strokes, par) {
    if (strokes === 1) return 'ЛУНКА С ОДНОГО!';
    const d = strokes - par;
    if (d <= -3) return 'Альбатрос!';
    if (d === -2) return 'Орёл!';
    if (d === -1) return 'Бёрди!';
    if (d === 0) return 'Пар';
    if (d === 1) return 'Богги';
    if (d === 2) return 'Дабл-богги';
    return fmtRel(d);
  }

  // ---------- Игровая логика ----------
  function loadHole(i) {
    game.idx = i;
    const lvl = LEVELS[i];
    game.world = P.createWorld(lvl);
    game.strokes = 0;
    game.aim = null;
    game.trail = [];
    game.ghost = [];
    game.shotPath = [];
    game.particles = [];
    game.rings = [];
    game.lostTimer = 0;
    game.sinkTimer = 0;
    game.mode = 'play';
    $('hud').classList.remove('hidden');
    $('tip').classList.remove('hidden');
    $('tip').textContent = lvl.tip;
    updateHud();
    toast(`Лунка ${i + 1}: ${lvl.name}`, true);
  }

  function totalRel() {
    let rel = 0;
    game.scores.forEach((s, i) => { if (s != null) rel += s - LEVELS[i].par; });
    return rel;
  }

  function updateHud() {
    const lvl = LEVELS[game.idx];
    $('hud-hole').textContent = `${game.idx + 1}/${LEVELS.length}`;
    $('hud-name').textContent = lvl.name;
    $('hud-par').textContent = lvl.par;
    $('hud-strokes').textContent = game.strokes;
    $('hud-total').textContent = fmtRel(totalRel());
  }

  function doShoot(v) {
    const w = game.world;
    P.shoot(w, v.dx * v.power * MAX_SPEED, v.dy * v.power * MAX_SPEED);
    game.strokes++;
    game.shotPath = [[w.ball.x, w.ball.y]];
    Sound.hit(v.power);
    burst(w.ball.x, w.ball.y, 8 + v.power * 10, { colors: ['#9fe8b0', '#dfffe6', '#5cc97d'], speed: [40, 180], size: [1.5, 3] });
    if (v.power > 0.85) game.shake = 3;
    updateHud();
  }

  function finishHole() {
    game.scores[game.idx] = game.strokes;
    updateHud();
    showCard();
  }

  function handleEvents(w) {
    for (const e of w.events) {
      switch (e.type) {
        case 'wall':
          if (e.kind === 'spinner') {
            if (game.time - game.lastSpinnerSound > 0.2) { Sound.spinner(); game.lastSpinnerSound = game.time; }
            burst(e.x, e.y, 6, { colors: ['#c98a4b', '#f0c690'], speed: [60, 200] });
          } else {
            Sound.wall(e.speed);
            if (e.speed > 350) burst(e.x, e.y, 4, { colors: ['#fff6dc'], speed: [30, 120], size: [1, 2.5] });
          }
          if (e.kind === 'gate') ring(e.x, e.y, '#ff4d6d', 25, 0.3);
          break;
        case 'bumper':
          Sound.bumper();
          game.shake = Math.max(game.shake, e.kick > 150 ? 5 : 2);
          burst(e.x, e.y, 14, { colors: ['#ff5d8f', '#ffd1e0', '#fff'], speed: [80, 320], size: [1.5, 3.5] });
          ring(w.bumpers[e.i].x, w.bumpers[e.i].y, '#ff9ec0', 30, 0.35);
          if (e.kick > 150 && Math.random() < 0.18) toast(pick(LINES.bumper), true);
          break;
        case 'portal': {
          const col = w.portals[e.i].color || '#c77dff';
          Sound.portal();
          burst(e.from[0], e.from[1], 16, { colors: [col, '#fff'], speed: [40, 200] });
          burst(e.to[0], e.to[1], 16, { colors: [col, '#fff'], speed: [40, 200] });
          ring(e.from[0], e.from[1], col, 40, 0.5);
          ring(e.to[0], e.to[1], col, 40, 0.5);
          game.trail = [];
          game.shotPath.push(null);
          if (Math.random() < 0.5) toast(pick(LINES.portal), true);
          break;
        }
        case 'button':
          Sound.button(e.pressed);
          ring(e.x, e.y, e.pressed ? '#3dff9e' : '#ff4d6d', 50, 0.6);
          toast(pick(e.pressed ? LINES.button : LINES.buttonOff), true);
          break;
        case 'water':
          Sound.splash();
          burst(e.x, e.y, 30, { colors: ['#9fd8ff', '#ffffff', '#3a9ee8'], speed: [80, 260], gravity: 500, drag: 1.2, size: [2, 4] });
          ring(e.x, e.y, '#bfe6ff', 36, 0.8);
          ring(e.x, e.y, '#bfe6ff', 20, 0.6);
          game.strokes++;
          game.lostTimer = 1.1;
          toast(pick(LINES.water));
          updateHud();
          break;
        case 'void':
          Sound.void();
          game.shake = 8;
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2, r = rand(20, 90);
            const lf = rand(0.5, 1.1);
            const wl = w.wells[0];
            game.particles.push({
              x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r,
              vx: (wl.x - e.x - Math.cos(a) * r) * 1.8 - Math.sin(a) * 120,
              vy: (wl.y - e.y - Math.sin(a) * r) * 1.8 + Math.cos(a) * 120,
              life: lf, max: lf, size: rand(1.5, 3), color: pick(['#c77dff', '#ffb347', '#fff']),
              gravity: 0, drag: 0.5, shape: 'dot', rot: 0, vr: 0,
            });
          }
          game.strokes++;
          game.lostTimer = 1.4;
          toast(pick(LINES.void));
          updateHud();
          break;
        case 'sink': {
          const lvl = LEVELS[game.idx];
          const good = game.strokes <= lvl.par;
          Sound.sink(good);
          if (game.strokes === 1) setTimeout(() => Sound.fanfare(), 500);
          game.sinkAnim = 0;
          game.sinkTimer = game.strokes === 1 ? 2.4 : 1.6;
          const colors = ['#ffcc3d', '#ff5d8f', '#7df9c1', '#6ab8ff', '#c77dff', '#fff'];
          burst(e.x, e.y, good ? 90 : 40, { colors, speed: [150, 520], gravity: 380, drag: 1.4, life: [0.9, 1.8], size: [3, 6], shape: 'confetti' });
          ring(e.x, e.y, '#ffcc3d', 60, 0.7);
          toast(resultName(game.strokes, lvl.par));
          game.ghost = [];
          break;
        }
        case 'rest':
          if (game.strokes >= LEVELS[game.idx].par + STROKE_LIMIT_OVER_PAR && w.state === 'play') {
            game.strokes = LEVELS[game.idx].par + STROKE_LIMIT_OVER_PAR;
            toast(pick(LINES.limit), true);
            w.state = 'done';
            game.sinkTimer = 1.4;
          } else if (game.shotPath.length) {
            game.ghost = game.shotPath.filter(Boolean);
          }
          break;
      }
    }
    w.events.length = 0;
  }

  let trailTick = 0;
  function tick(dt) {
    const w = game.world;
    P.step(w, dt);
    handleEvents(w);
    if (w.state === 'play' && !w.ball.resting) {
      if (++trailTick % 3 === 0) {
        game.trail.push([w.ball.x, w.ball.y]);
        if (game.trail.length > 14) game.trail.shift();
        if (game.shotPath.length) {
          const last = game.shotPath[game.shotPath.length - 1];
          if (!last || Math.hypot(last[0] - w.ball.x, last[1] - w.ball.y) > 6) game.shotPath.push([w.ball.x, w.ball.y]);
        }
      }
    } else if (game.trail.length) {
      game.trail.shift();
    }
    if (w.state === 'lost') {
      game.lostTimer -= dt;
      if (game.lostTimer <= 0) {
        if (game.strokes >= LEVELS[game.idx].par + STROKE_LIMIT_OVER_PAR) {
          game.strokes = LEVELS[game.idx].par + STROKE_LIMIT_OVER_PAR;
          toast(pick(LINES.limit), true);
          w.state = 'done';
          game.sinkTimer = 1.4;
          return;
        }
        P.resetBall(w, w.lastShot.x, w.lastShot.y);
        game.trail = [];
        ring(w.ball.x, w.ball.y, '#fff', 30, 0.5);
      }
    }
    if (w.state === 'sunk' || w.state === 'done') {
      game.sinkAnim += dt;
      game.sinkTimer -= dt;
      if (game.sinkTimer <= 0 && game.mode === 'play') finishHole();
    }
  }

  // ---------- Экраны ----------
  function scorecardHtml(highlight) {
    const cols = LEVELS.map((_, i) => i);
    let h = '<tr><th>#</th>' + cols.map((i) => `<th>${i + 1}</th>`).join('') + '<th>Σ</th></tr>';
    h += '<tr><th>Пар</th>' + cols.map((i) => `<td>${LEVELS[i].par}</td>`).join('') +
      `<td class="tot">${LEVELS.reduce((a, l) => a + l.par, 0)}</td></tr>`;
    let sum = 0;
    h += '<tr><th>Ты</th>' + cols.map((i) => {
      const s = game.scores[i];
      if (s == null) return `<td>·</td>`;
      sum += s;
      const d = s - LEVELS[i].par;
      const cls = [i === highlight ? 'cur' : '', d < 0 ? 'under' : d > 0 ? 'over' : ''].join(' ');
      return `<td class="${cls}">${s}</td>`;
    }).join('') + `<td class="tot">${sum}</td></tr>`;
    return h;
  }

  function showCard() {
    const lvl = LEVELS[game.idx];
    const last = game.idx === LEVELS.length - 1;
    game.mode = last ? 'end' : 'card';
    game.aim = null;
    $('scorecard').innerHTML = scorecardHtml(game.idx);
    if (!last) {
      $('card-hole').textContent = `Лунка ${game.idx + 1} · ${lvl.name} · пар ${lvl.par}`;
      $('card-result').textContent = resultName(game.strokes, lvl.par);
      $('card-sub').textContent = `${game.strokes} ${plural(game.strokes, 'удар', 'удара', 'ударов')} · итог ${fmtRel(totalRel())}`;
      $('btn-next').textContent = 'Дальше →';
    } else {
      const total = game.scores.reduce((a, b) => a + b, 0);
      const rel = totalRel();
      const best = loadBest();
      const full = LEVELS.every((_, i) => game.scores[i] != null);
      const isBest = full && (best == null || total < best);
      if (isBest) saveBest(total);
      $('card-hole').textContent = 'Турнир окончен';
      $('card-result').textContent = `${total} · ${fmtRel(rel)}`;
      $('card-sub').textContent = (rel <= -4 ? 'Ты повелитель гравитации.' : rel <= 0 ? 'Космический профи!' : rel <= 6 ? 'Неплохо для землянина.' : 'Вселенная тебя испытывала.') +
        (isBest ? ' Новый рекорд!' : best != null ? ` Рекорд: ${best}` : '');
      $('btn-next').textContent = 'Сыграть снова';
      if (rel <= 0) Sound.fanfare();
    }
    $('card').classList.remove('hidden');
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function loadBest() {
    try { const v = localStorage.getItem(BEST_KEY); return v == null ? null : +v; } catch (e) { return null; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* приватный режим */ }
  }
  function showBest() {
    const b = loadBest();
    const par = LEVELS.reduce((a, l) => a + l.par, 0);
    $('best').textContent = b == null ? '' : `Рекорд: ${b} (${fmtRel(b - par)})`;
  }

  function startGame() {
    Sound.init();
    game.scores = [];
    $('title').classList.add('hidden');
    $('card').classList.add('hidden');
    loadHole(0);
  }

  function next() {
    Sound.init();
    $('card').classList.add('hidden');
    if (game.mode === 'end') {
      startGame();
    } else {
      loadHole(game.idx + 1);
    }
  }

  // ---------- Ввод ----------
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  function canAim() {
    const w = game.world;
    return game.mode === 'play' && w && w.state === 'play' && w.ball.resting;
  }
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    if (!canAim()) return;
    if (e.button === 2) return;
    const [x, y] = toWorld(e);
    game.aim = { sx: x, sy: y, cx: x, cy: y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!game.aim) return;
    const [x, y] = toWorld(e);
    game.aim.cx = x;
    game.aim.cy = y;
  });
  function release() {
    if (!game.aim) return;
    const v = aimVector();
    game.aim = null;
    if (v && v.power > 0.04 && canAim()) doShoot(v);
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => (game.aim = null));
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); game.aim = null; });

  function restartHole() {
    if (game.mode !== 'play') return;
    loadHole(game.idx);
  }
  function toggleMute() {
    const m = Sound.toggle();
    $('btn-mute').classList.toggle('off', m);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') game.aim = null;
    else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') restartHole();
    else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') toggleMute();
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // иначе сфокусированная кнопка сработает второй раз
      if (game.mode === 'title') startGame();
      else if (game.mode === 'card' || game.mode === 'end') next();
    }
  });
  $('btn-play').addEventListener('click', startGame);
  $('btn-next').addEventListener('click', next);
  $('btn-restart').addEventListener('click', restartHole);
  $('btn-mute').addEventListener('click', toggleMute);

  // ---------- Масштаб и цикл ----------
  function resize() {
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // Демо-мир для титульного экрана
  const demo = P.createWorld(LEVELS[3]);

  function render() {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    drawBackground(game.time);
    const w = game.mode === 'title' ? demo : game.world;
    if (!w) return;
    ctx.save();
    if (game.shake > 0) ctx.translate(rand(-1, 1) * game.shake, rand(-1, 1) * game.shake);
    drawCourse(w);
    drawZones(w, game.time);
    drawGhost();
    drawButtons(w, game.time);
    drawWells(w, game.time);
    drawPortals(w, game.time);
    drawHole(w, game.time);
    drawBall(w);
    drawBumpers(w);
    drawMovers(w);
    drawGates(w, game.time);
    drawWalls(w);
    drawSpinners(w);
    drawAim(w);
    drawFx();
    ctx.restore();
  }

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.time += dt;
    if (game.mode === 'play' && game.world) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 24) { tick(DT); acc -= DT; n++; }
      if (n >= 24) acc = 0;
    } else if (game.mode === 'title') {
      demo.t += dt;
    }
    updateFx(dt);
    render();
    requestAnimationFrame(frame);
  }

  showBest();
  // Быстрый переход к лунке: index.html#hole=5
  const m = location.hash.match(/hole=(\d+)/);
  if (m) {
    startGame();
    loadHole(Math.max(0, Math.min(LEVELS.length - 1, +m[1] - 1)));
  }
  window.__golf = { game, loadHole };
  requestAnimationFrame(frame);
})();
