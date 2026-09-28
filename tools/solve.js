// Проверка проходимости лунок перебором ударов: node tools/solve.js [номер]
const P = require('../js/physics.js');
const LEVELS = require('../js/levels.js');

function clone(w) {
  const c = P.createWorld(w.level);
  c.t = w.t;
  c.ball = { ...w.ball };
  c.gates.forEach((g, i) => (g.open = w.gates[i].open));
  c.buttons.forEach((b, i) => Object.assign(b, { pressed: w.buttons[i].pressed, inside: w.buttons[i].inside }));
  return c;
}

function simulate(w0, ang, pow) {
  const w = clone(w0);
  P.shoot(w, Math.cos(ang) * pow * P.MAX_SPEED, Math.sin(ang) * pow * P.MAX_SPEED);
  for (let i = 0; i < 240 * 20; i++) {
    w.events.length = 0;
    P.step(w, P.DT);
    if (w.state !== 'play') break;
    if (w.ball.resting && i > 10) break;
  }
  const [hx, hy] = P.holePos(w);
  return { w, sunk: w.state === 'sunk', lost: w.state === 'lost', d: Math.hypot(hx - w.ball.x, hy - w.ball.y) };
}

function search(w0, beam) {
  const res = [];
  for (let a = 0; a < 360; a += 3) {
    for (let p = 0.1; p <= 1.001; p += 0.075) {
      const r = simulate(w0, (a * Math.PI) / 180, p);
      r.shot = [a, +p.toFixed(2)];
      if (r.sunk) return { sunk: r };
      if (!r.lost) res.push(r);
    }
  }
  // Разнообразие: предпочитаем открытые ворота и близость к лунке.
  const score = (r) => r.d - r.w.gates.filter((g) => g.open).length * 400;
  res.sort((x, y) => score(x) - score(y));
  const picked = [];
  for (const r of res) {
    if (picked.every((q) => Math.hypot(q.w.ball.x - r.w.ball.x, q.w.ball.y - r.w.ball.y) > 40)) picked.push(r);
    if (picked.length >= beam) break;
  }
  return { next: picked };
}

function solve(idx, maxStrokes = 4, beam = 4) {
  const lvl = LEVELS[idx];
  let frontier = [{ w: P.createWorld(lvl), path: [] }];
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
  return { strokes: null, best: frontier[0] && frontier[0].d };
}

const only = process.argv[2] ? [+process.argv[2] - 1] : LEVELS.map((_, i) => i);
for (const i of only) {
  const t = Date.now();
  const r = solve(i);
  console.log(`#${i + 1} ${LEVELS[i].name} (пар ${LEVELS[i].par}):`,
    r.strokes ? `решено за ${r.strokes} ${JSON.stringify(r.path)}` : `НЕ РЕШЕНО, ближе всего ${r.best && r.best.toFixed(0)}`,
    `${((Date.now() - t) / 1000).toFixed(1)}s`);
}
