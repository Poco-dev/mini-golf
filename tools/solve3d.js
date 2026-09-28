// Проверка проходимости 3D-лунок перебором ударов: node tools/solve3d.js [номер]
const P = require('../3d/js/physics3d.js');
const LEVELS = require('../3d/js/levels3d.js');

function clone(w) {
  const c = P.createWorld(w.level);
  c.t = w.t;
  c.ball = JSON.parse(JSON.stringify(w.ball));
  return c;
}

function simulate(w0, yaw, pow, club) {
  const w = clone(w0);
  P.shoot(w, [Math.sin(yaw), -Math.cos(yaw)], pow, club);
  for (let i = 0; i < 240 * 14; i++) {
    w.events.length = 0;
    P.step(w, P.DT);
    if (w.state !== 'play' || w.ball.resting) break;
  }
  const b = w.ball.p;
  return { w, sunk: w.state === 'sunk', lost: w.state !== 'play' && w.state !== 'sunk', d: Math.hypot(w.hole.x - b[0], w.hole.z - b[2]) };
}

function search(w0, beam) {
  const res = [];
  for (const club of ['putter', 'wedge']) {
    for (let a = -180; a < 180; a += 3) {
      for (let p = 0.1; p <= 1.001; p += 0.075) {
        const r = simulate(w0, (a * Math.PI) / 180, p, club);
        r.shot = [club[0], a, +p.toFixed(2)];
        if (r.sunk) return { sunk: r };
        if (!r.lost && r.w.ball.resting) res.push(r);
      }
    }
  }
  res.sort((x, y) => x.d - y.d);
  const picked = [];
  for (const r of res) {
    if (picked.every((q) => Math.hypot(q.w.ball.p[0] - r.w.ball.p[0], q.w.ball.p[2] - r.w.ball.p[2]) > 1)) picked.push(r);
    if (picked.length >= beam) break;
  }
  return { next: picked };
}

function solve(idx, maxStrokes = 4, beam = 3) {
  let frontier = [{ w: P.createWorld(LEVELS[idx]), path: [] }];
  for (let s = 1; s <= maxStrokes; s++) {
    const nf = [];
    for (const node of frontier) {
      const r = search(node.w, beam);
      if (r.sunk) return { strokes: s, path: node.path.concat([r.sunk.shot]) };
      for (const n of r.next) nf.push({ w: n.w, path: node.path.concat([n.shot]), d: n.d });
    }
    nf.sort((a, b) => a.d - b.d);
    frontier = nf.slice(0, beam);
    if (!frontier.length) break;
  }
  return { strokes: null, best: frontier[0] && frontier[0].d, path: frontier[0] && frontier[0].path };
}

const only = process.argv[2] ? [+process.argv[2] - 1] : LEVELS.map((_, i) => i);
for (const i of only) {
  const t = Date.now();
  const r = solve(i);
  console.log(`#${i + 1} ${LEVELS[i].name} (пар ${LEVELS[i].par}):`,
    r.strokes ? `решено за ${r.strokes} ${JSON.stringify(r.path)}` : `НЕ РЕШЕНО, ближе всего ${r.best && r.best.toFixed(2)} ${JSON.stringify(r.path)}`,
    `${((Date.now() - t) / 1000).toFixed(1)}s`);
}
