// 3D-версия: сцена Three.js, клюшка, камера, ввод и интерфейс.
(function () {
  'use strict';

  const P = window.Physics3D;
  const LEVELS = window.LEVELS3D;
  const { R, HOLE_R, DT, CLUBS } = P;
  const STROKE_LIMIT_OVER_PAR = 5;
  const BEST_KEY = 'kosmogolf3d-best';
  const CLUB_LEN = 1.1;

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmtRel = (n) => (n === 0 ? 'E' : n > 0 ? '+' + n : String(n));

  // ---------- Рендерер и сцена ----------
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0d26, 45, 140);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 600);

  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Небо: градиент с туманностями
  const skyTex = canvasTexture(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#05061a');
    gr.addColorStop(0.5, '#141a4a');
    gr.addColorStop(0.62, '#2a1f5c');
    gr.addColorStop(1, '#05060f');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const blobs = [[200, 230, 160, 'rgba(160,70,220,0.35)'], [700, 260, 220, 'rgba(40,140,255,0.28)'], [900, 200, 120, 'rgba(255,90,150,0.2)'], [450, 300, 140, 'rgba(80,220,200,0.15)']];
    for (const [x, y, r, c] of blobs) {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }
  });
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = skyTex;

  // Звёзды
  {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 250 + Math.random() * 50;
      pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.2, 0.6, 0.75 + Math.random() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, fog: false, sizeAttenuation: true }));
    scene.add(stars);
  }

  // Планета с кольцом на горизонте
  {
    const tex = canvasTexture(512, 256, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const k = y / h;
        const hue = 20 + Math.sin(k * 30) * 8 + Math.sin(k * 7) * 10;
        g.fillStyle = `hsl(${hue},70%,${45 + Math.sin(k * 50) * 8}%)`;
        g.fillRect(0, y, w, 1);
      }
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, fog: false }));
    planet.position.set(-120, 25, -220);
    planet.rotation.z = 0.3;
    scene.add(planet);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(52, 75, 96),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false })
    );
    ring.position.copy(planet.position);
    ring.rotation.x = Math.PI / 2.4;
    ring.rotation.y = 0.3;
    scene.add(ring);
  }

  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x2a1d3a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  // ---------- Материалы ----------
  const grassTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2f9c57';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#38ad62';
    g.fillRect(0, 0, w, h / 2);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 3);
    }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  const sandTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#e6cc86';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(150,110,40,0.35)' : 'rgba(255,255,255,0.4)';
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  });
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  const boostTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = 'rgba(255,190,40,0.35)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd23d';
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(30, 20); g.lineTo(80, 64); g.lineTo(30, 108);
    g.stroke();
  });
  boostTex.wrapS = boostTex.wrapT = THREE.RepeatWrapping;
  const ballTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcc3d';
    g.fillRect(0, h * 0.44, w, h * 0.12);
    g.fillStyle = '#ff5d8f';
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.arc(w * (i / 4 + 0.125), h * 0.22, 7, 0, Math.PI * 2); g.fill();
    }
  });

  const MAT = {
    grass: new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x5b4d73, roughness: 1, flatShading: true }),
    rockDark: new THREE.MeshStandardMaterial({ color: 0x2d2540, roughness: 1, flatShading: true }),
    wall: new THREE.MeshStandardMaterial({ color: 0xe8d6a8, roughness: 0.6 }),
    wallTop: new THREE.MeshStandardMaterial({ color: 0xfff4d8, roughness: 0.5 }),
    sand: new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
    boost: new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }),
    cup: new THREE.MeshBasicMaterial({ color: 0x050505, polygonOffset: true, polygonOffsetFactor: -4 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.4, roughness: 0.3 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xff3d3d, side: THREE.DoubleSide, emissive: 0x551010 }),
    ball: new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.3 }),
    houseWall: new THREE.MeshStandardMaterial({ color: 0xf2e6cc, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7, flatShading: true }),
    blade: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 }),
    sail: new THREE.MeshStandardMaterial({ color: 0xfff6e0, side: THREE.DoubleSide, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8c0d8, metalness: 0.7, roughness: 0.3 }),
    sweeper: new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0x551020, roughness: 0.4 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffcc3d, metalness: 0.8, roughness: 0.25 }),
  };

  // ---------- Состояние ----------
  const game = {
    mode: 'title', // title | play | card | end
    idx: 0,
    scores: [],
    strokes: 0,
    world: null,
    club: 'putter',
    yaw: 0,
    power: 0,
    drag: null,
    charging: false,
    chargeT: 0,
    swing: null,
    zoom: 1,
    overview: false,
    introT: 0,
    lostTimer: 0,
    sinkTimer: 0,
    sinkAnim: 0,
    shake: 0,
    time: 0,
    keys: {},
    lastBladeSound: 0,
  };

  const levelGroup = new THREE.Group();
  scene.add(levelGroup);
  const dyn = { windmills: [], sweepers: [], flag: null, flagPole: null, flagBase: null, boost: [] };

  // ---------- Построение уровня ----------
  function clearLevel() {
    levelGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    levelGroup.clear();
    dyn.windmills = [];
    dyn.sweepers = [];
    dyn.boost = [];
  }

  function terrainGrid(w, x0, z0, x1, z1, lift, uvFn) {
    const step = 0.2;
    const nx = Math.max(2, Math.round((x1 - x0) / step));
    const nz = Math.max(2, Math.round((z1 - z0) / step));
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, P.groundY(w, x, z) + lift);
      const [u, v] = uvFn(x, z);
      uv.setXY(i, u, v);
    }
    geo.computeVertexNormals();
    return geo;
  }

  function skirt(w, f) {
    const [x0, z0, x1, z1] = f;
    const bottom = w.minY - 1.4;
    const verts = [];
    const edge = (ax, az, bx, bz) => {
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const px = ax + (bx - ax) * t0, pz = az + (bz - az) * t0;
        const qx = ax + (bx - ax) * t1, qz = az + (bz - az) * t1;
        const py = P.groundY(w, px, pz), qy = P.groundY(w, qx, qz);
        const jb = bottom + Math.sin(px * 3.1 + pz * 2.3) * 0.25;
        const jq = bottom + Math.sin(qx * 3.1 + qz * 2.3) * 0.25;
        verts.push(px, py, pz, qx, qy, qz, qx, jq, qz, px, py, pz, qx, jq, qz, px, jb, pz);
      }
    };
    edge(x0, z0, x1, z0);
    edge(x1, z0, x1, z1);
    edge(x1, z1, x0, z1);
    edge(x0, z1, x0, z0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mat = MAT.rock.clone();
    mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    return m;
  }

  function buildLevel(w) {
    clearLevel();
    const lvl = w.level;

    for (const f of w.floors) {
      const geo = terrainGrid(w, f[0], f[1], f[2], f[3], 0, (x, z) => [x / 4, z / 4]);
      const m = new THREE.Mesh(geo, MAT.grass);
      m.receiveShadow = true;
      levelGroup.add(m);
      levelGroup.add(skirt(w, f));
      // Нижний камень-«астероид» под островом
      const cx = (f[0] + f[2]) / 2, cz = (f[1] + f[3]) / 2;
      const rad = Math.min(f[2] - f[0], f[3] - f[1]) * 0.55;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(rad, rad * 2.2, 7), MAT.rockDark);
      rock.rotation.x = Math.PI;
      rock.position.set(cx, w.minY - 1.4 - rad * 1.1, cz);
      levelGroup.add(rock);
    }

    for (const zn of w.zones) {
      const [x0, z0, x1, z1] = zn.rect;
      if (zn.type === 'sand') {
        levelGroup.add(Object.assign(new THREE.Mesh(terrainGrid(w, x0, z0, x1, z1, 0.01, (x, z) => [x / 1.5, z / 1.5]), MAT.sand), { receiveShadow: true }));
      } else if (zn.type === 'boost') {
        const [dx, dz] = zn.dir;
        const tex = boostTex.clone();
        tex.needsUpdate = true;
        const mat = MAT.boost.clone();
        mat.map = tex;
        const geo = terrainGrid(w, x0, z0, x1, z1, 0.015, (x, z) => [(x * dx + z * dz) / 0.8, (x * dz - z * dx) / 0.8]);
        levelGroup.add(new THREE.Mesh(geo, mat));
        dyn.boost.push(tex);
      }
    }

    // Стенки: брусок на каждый кусок + столбик на стыках
    const postGeo = new THREE.CylinderGeometry(P.WALL_R + 0.03, P.WALL_R + 0.03, 0.54, 16);
    const posts = new Set();
    for (const c of w.walls) {
      const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b);
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(P.WALL_R * 2, 0.5, len), MAT.wall);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.lookAt(b);
      m.castShadow = true;
      m.receiveShadow = true;
      levelGroup.add(m);
    }
    for (const line of lvl.walls || []) {
      for (const [x, z] of line) {
        const key = `${x},${z}`;
        if (posts.has(key)) continue;
        posts.add(key);
        const post = new THREE.Mesh(postGeo, MAT.wallTop);
        post.position.set(x, P.groundY(w, x, z) + P.WALL_R + 0.01, z);
        post.castShadow = true;
        levelGroup.add(post);
      }
    }

    // Лунка: чёрный диск и белый ободок по рельефу
    const hole = w.hole;
    const conform = (geo, lift) => {
      geo.rotateX(-Math.PI / 2);
      geo.translate(hole.x, 0, hole.z);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, P.groundY(w, pos.getX(i), pos.getZ(i)) + lift);
      geo.computeVertexNormals();
      return geo;
    };
    levelGroup.add(new THREE.Mesh(conform(new THREE.CircleGeometry(HOLE_R, 40), 0.012), MAT.cup));
    levelGroup.add(new THREE.Mesh(conform(new THREE.RingGeometry(HOLE_R, HOLE_R + 0.05, 40), 0.014), MAT.rim));
    const glow = new THREE.PointLight(0xffe7a0, 1.5, 4);
    glow.position.set(hole.x, P.groundY(w, hole.x, hole.z) + 0.6, hole.z);
    levelGroup.add(glow);

    // Флажок
    const base = new THREE.Group();
    base.position.set(hole.x, P.groundY(w, hole.x, hole.z), hole.z);
    const pole = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8), MAT.pole);
    stick.position.y = 1.1;
    stick.castShadow = true;
    pole.add(stick);
    const flagGeo = new THREE.PlaneGeometry(0.7, 0.45, 12, 4);
    flagGeo.translate(0.35, 0, 0);
    const flag = new THREE.Mesh(flagGeo, MAT.flag);
    flag.position.y = 1.95;
    flag.castShadow = true;
    flag.userData.base = Float32Array.from(flagGeo.attributes.position.array);
    pole.add(flag);
    base.add(pole);
    levelGroup.add(base);
    dyn.flag = flag;
    dyn.flagPole = pole;

    // Мельницы
    for (const m of w.windmills) {
      const [hx0, hx1, hz0, hz1, gap] = m.house;
      const H = 1.7;
      const house = new THREE.Group();
      const mk = (geo, mat, x, y, z) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        house.add(mesh);
        return mesh;
      };
      const zc = (hz0 + hz1) / 2, dz = hz1 - hz0 + 0.4;
      const leftW = m.x - gap - hx0, rightW = hx1 - (m.x + gap);
      mk(new THREE.BoxGeometry(leftW, H, dz), MAT.houseWall, hx0 + leftW / 2, H / 2, zc);
      mk(new THREE.BoxGeometry(rightW, H, dz), MAT.houseWall, hx1 - rightW / 2, H / 2, zc);
      mk(new THREE.BoxGeometry(gap * 2, H - 0.75, dz), MAT.houseWall, m.x, 0.75 + (H - 0.75) / 2, zc);
      const roof = mk(new THREE.ConeGeometry((hx1 - hx0) * 0.78, 1.5, 4), MAT.roof, m.x, H + 0.75, zc);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = dz / (hx1 - hx0) + 0.25;
      const hub = mk(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 16), MAT.metal, m.x, m.hubY, m.z + 0.1);
      hub.rotation.x = Math.PI / 2;
      levelGroup.add(house);

      const rotor = new THREE.Group();
      rotor.position.set(m.x, m.hubY, m.z);
      for (let i = 0; i < m.blades; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i * 2 * Math.PI) / m.blades;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(m.len, 0.12, 0.1), MAT.blade);
        beam.position.x = m.len / 2;
        beam.castShadow = true;
        arm.add(beam);
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(m.len * 0.7, 0.42), MAT.sail);
        sail.position.set(m.len * 0.6, 0.25, 0.02);
        sail.castShadow = true;
        arm.add(sail);
        rotor.add(arm);
      }
      levelGroup.add(rotor);
      dyn.windmills.push({ m, rotor });
    }

    // Вращающиеся балки
    for (const s of w.sweepers) {
      const g = new THREE.Group();
      const y = w.height(s.x, s.z) + 0.22;
      g.position.set(s.x, y, s.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.7, 16), MAT.metal);
      post.position.y = 0.1;
      post.castShadow = true;
      g.add(post);
      for (let i = 0; i < s.arms; i++) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, s.len, 12), MAT.sweeper);
        const holder = new THREE.Group();
        holder.rotation.y = -(i * 2 * Math.PI) / s.arms;
        arm.rotation.z = Math.PI / 2;
        arm.position.x = s.len / 2;
        arm.castShadow = true;
        holder.add(arm);
        g.add(holder);
      }
      levelGroup.add(g);
      dyn.sweepers.push({ s, g });
    }
  }

  // ---------- Мяч, клюшка, прицел ----------
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), MAT.ball);
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  const CLUB_LEAN = 0.32; // клюшка наклонена влево, чтобы не закрывать мяч
  const club = new THREE.Group();
  const leanGroup = new THREE.Group();
  leanGroup.rotation.z = CLUB_LEAN;
  const swingGroup = new THREE.Group();
  club.add(leanGroup);
  leanGroup.add(swingGroup);
  {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, CLUB_LEN, 8), MAT.metal);
    shaft.position.y = -CLUB_LEN / 2;
    swingGroup.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.32, 10), MAT.grip);
    grip.position.y = -0.14;
    swingGroup.add(grip);
    club.userData.shaft = shaft;
  }
  const putterHead = new THREE.Group();
  {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), MAT.metal);
    putterHead.add(head);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.102, 0.102), MAT.gold);
    putterHead.add(stripe);
    putterHead.position.y = -CLUB_LEN;
    putterHead.rotation.z = -CLUB_LEAN;
    putterHead.traverse((o) => (o.castShadow = true));
  }
  const wedgeHead = new THREE.Group();
  {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.04), MAT.gold);
    head.rotation.x = CLUBS.wedge.loft;
    head.position.y = 0.04;
    wedgeHead.add(head);
    wedgeHead.position.y = -CLUB_LEN;
    wedgeHead.rotation.z = -CLUB_LEAN;
    wedgeHead.traverse((o) => (o.castShadow = true));
  }
  swingGroup.add(putterHead, wedgeHead);
  scene.add(club);

  const aimLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 60 }, () => new THREE.Vector3())),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.85 })
  );
  aimLine.frustumCulled = false;
  scene.add(aimLine);
  const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  aimRing.geometry.rotateX(-Math.PI / 2);
  scene.add(aimRing);

  function aimDir() {
    return [Math.sin(game.yaw), -Math.cos(game.yaw)];
  }

  function updateAim() {
    const w = game.world;
    const show = canAct() && !game.overview;
    aimLine.visible = aimRing.visible = show;
    if (!show) return;
    const b = w.ball.p;
    const [dx, dz] = aimDir();
    const c = CLUBS[game.club];
    const pw = Math.max(game.power, 0.18);
    const pts = [];
    let end = null;
    if (game.club === 'putter') {
      const L = 0.6 + pw * 7;
      for (let i = 0; i < 60; i++) {
        const t = (i / 59) * L;
        const x = b[0] + dx * t, z = b[2] + dz * t;
        const y = P.floorAt(w, x, z) ? P.groundY(w, x, z) + 0.04 : b[1] - R;
        pts.push(new THREE.Vector3(x, y, z));
      }
      end = pts[pts.length - 1];
    } else {
      const sp = pw * c.max;
      const vh = sp * Math.cos(c.loft), vy = sp * Math.sin(c.loft);
      let x = b[0], y = b[1], z = b[2], vY = vy;
      const dt = 0.03;
      for (let i = 0; i < 60; i++) {
        pts.push(new THREE.Vector3(x, y, z));
        if (i > 3 && P.floorAt(w, x, z) && y < P.groundY(w, x, z) + R) {
          end = new THREE.Vector3(x, P.groundY(w, x, z) + 0.03, z);
          for (let k = i + 1; k < 60; k++) pts.push(end.clone());
          break;
        }
        x += dx * vh * dt;
        z += dz * vh * dt;
        y += vY * dt;
        vY -= w.g * dt;
      }
      if (!end) end = pts[pts.length - 1];
    }
    aimLine.geometry.setFromPoints(pts);
    aimLine.computeLineDistances();
    const hue = (130 - game.power * 130) / 360;
    aimLine.material.color.setHSL(hue, 0.9, 0.65);
    aimRing.material.color.setHSL(hue, 0.9, 0.65);
    aimRing.position.copy(end);
    aimRing.position.y += 0.02;
    aimRing.visible = !!end && P.floorAt(w, end.x, end.z);
  }

  function updateClub(dt) {
    const w = game.world;
    const b = w.ball.p;
    const visible = !!game.swing || (canAct() && !game.overview);
    club.visible = visible;
    if (!visible) return;
    putterHead.visible = game.club === 'putter';
    wedgeHead.visible = game.club === 'wedge';
    const yaw = game.swing ? game.swing.yaw : game.yaw;
    const dx = Math.sin(yaw), dz = -Math.cos(yaw);
    const back = R + 0.09;
    const ox = game.swing ? game.swing.origin[0] : b[0];
    const oy = game.swing ? game.swing.origin[1] : b[1];
    const oz = game.swing ? game.swing.origin[2] : b[2];
    // Хват смещён влево от линии удара: локальная ось x — «вправо» от прицела.
    const side = -CLUB_LEN * Math.sin(CLUB_LEAN);
    const rx = Math.cos(yaw), rz = Math.sin(yaw);
    club.position.set(
      ox - dx * back + rx * side,
      oy - R + 0.06 + CLUB_LEN * Math.cos(CLUB_LEAN),
      oz - dz * back + rz * side
    );
    club.rotation.set(0, -yaw, 0);
    // Угол замаха: отрицательный — клюшка отведена назад.
    let angle;
    if (game.swing) {
      angle = game.swing.angle;
    } else {
      const target = -game.power * 1.15;
      club.userData.angle = (club.userData.angle || 0) + (target - (club.userData.angle || 0)) * Math.min(1, dt * 18);
      angle = club.userData.angle;
      // Лёгкое покачивание в режиме прицеливания
      if (game.power < 0.02) angle += Math.sin(game.time * 2) * 0.03;
    }
    swingGroup.rotation.x = angle;
  }

  function startSwing() {
    if (!canAct() || game.power < 0.03) {
      game.power = 0;
      return;
    }
    const b = game.world.ball.p;
    game.swing = {
      angle: club.userData.angle || -game.power * 1.15,
      power: game.power,
      yaw: game.yaw,
      club: game.club,
      origin: b.slice(),
      launched: false,
      follow: 0,
    };
    game.charging = false;
  }

  function updateSwing(dt) {
    const s = game.swing;
    if (!s) return;
    if (!s.launched) {
      s.angle += dt * (4 + s.power * 16);
      if (s.angle >= 0) {
        s.launched = true;
        s.angle = 0;
        doShoot(s);
      }
    } else {
      s.follow += dt;
      s.angle = Math.min(0.6, s.angle + dt * (3 + s.power * 8));
      if (s.follow > 0.45) {
        game.swing = null;
        club.userData.angle = 0;
      }
    }
  }

  function doShoot(s) {
    const w = game.world;
    const [dx, dz] = [Math.sin(s.yaw), -Math.cos(s.yaw)];
    P.shoot(w, [dx, dz], s.power, s.club);
    game.strokes++;
    game.power = 0;
    Sound.hit(s.power);
    if (s.club === 'wedge') Sound.tone(700, 0.08, { type: 'triangle', vol: 0.12, to: 1400 });
    const b = w.ball.p;
    burst(b[0], b[1] - R, b[2], 10 + s.power * 10, [0x9fe8b0, 0xdfffe6, 0x5cc97d], 1.5, 0.5);
    updateHud();
  }

  // ---------- Частицы ----------
  const particles = [];
  const partGeo = new THREE.BoxGeometry(1, 1, 1);
  const partMats = new Map();
  function partMat(color) {
    if (!partMats.has(color)) partMats.set(color, new THREE.MeshBasicMaterial({ color }));
    return partMats.get(color);
  }
  function burst(x, y, z, n, colors, speed = 3, life = 0.8, gravity = 6, size = 0.05) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(partGeo, partMat(pick(colors)));
      m.position.set(x, y, z);
      const s = size * rand(0.6, 1.4);
      m.scale.set(s, s, s);
      const th = Math.random() * Math.PI * 2, u = Math.random();
      const sp = speed * rand(0.4, 1);
      m.userData = {
        v: new THREE.Vector3(Math.cos(th) * sp * (1 - u * 0.5), sp * (0.4 + u), Math.sin(th) * sp * (1 - u * 0.5)),
        life: life * rand(0.6, 1.3), gravity, size: s, spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
      };
      m.userData.max = m.userData.life;
      scene.add(m);
      particles.push(m);
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const m = particles[i];
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) {
        scene.remove(m);
        particles.splice(i, 1);
        continue;
      }
      u.v.y -= u.gravity * dt;
      u.v.multiplyScalar(1 - dt * 0.8);
      m.position.addScaledVector(u.v, dt);
      m.rotation.x += u.spin.x * dt;
      m.rotation.y += u.spin.y * dt;
      m.scale.setScalar(Math.max(0.001, u.size * Math.min(1, (u.life / u.max) * 2)));
    }
  }

  // ---------- Комментатор ----------
  const LINES = {
    fall: ['Мяч ушёл в открытый космос', 'Хьюстон, у нас проблема', 'Прощай, мячик!', 'Орбита не рассчитана'],
    blade: ['Лопасть!', 'Бдыщ!', 'Мельница победила'],
    sweeper: ['Сдуло!', 'Балка не дремлет'],
    limit: ['Лимит ударов. Мяч конфискован', 'Хватит мучить мяч'],
    air: ['В полёте!', 'Взлёт!', 'Полетели!'],
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

  // ---------- Логика лунки ----------
  function yawToHole(w) {
    const b = w.ball.p;
    return Math.atan2(w.hole.x - b[0], -(w.hole.z - b[2]));
  }

  function loadHole(i) {
    game.idx = i;
    const lvl = LEVELS[i];
    game.world = P.createWorld(lvl);
    buildLevel(game.world);
    game.strokes = 0;
    game.power = 0;
    game.swing = null;
    game.drag = null;
    game.charging = false;
    game.lostTimer = 0;
    game.sinkTimer = 0;
    game.overview = false;
    game.introT = 2.2;
    game.airborne = false;
    game.yaw = yawToHole(game.world);
    game.mode = 'play';
    setClub('putter');
    $('hud').classList.remove('hidden');
    $('tip').classList.remove('hidden');
    $('clubs').classList.remove('hidden');
    $('power').classList.remove('hidden');
    $('tip').textContent = lvl.tip;
    placeCameraOverview(true);
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
    $('hud-name').textContent = lvl.name + (lvl.gravity ? ' · 🌙' : '');
    $('hud-par').textContent = lvl.par;
    $('hud-strokes').textContent = game.strokes;
    $('hud-total').textContent = fmtRel(totalRel());
  }

  function setClub(c) {
    game.club = c;
    document.querySelectorAll('.club').forEach((b) => b.classList.toggle('active', b.dataset.club === c));
  }

  function canAct() {
    const w = game.world;
    return game.mode === 'play' && w && w.state === 'play' && w.ball.resting && !game.swing && game.introT <= 0;
  }

  function handleEvents(w) {
    for (const e of w.events) {
      switch (e.type) {
        case 'hit':
          if (e.kind === 'wall') {
            Sound.wall(e.speed * 90);
          } else {
            if (game.time - game.lastBladeSound > 0.25) {
              Sound.spinner();
              game.lastBladeSound = game.time;
              if (Math.random() < 0.4) toast(pick(e.kind === 'blade' ? LINES.blade : LINES.sweeper), true);
            }
            game.shake = Math.max(game.shake, 0.08);
            burst(e.p[0], e.p[1], e.p[2], 8, [0xc98a4b, 0xf0c690, 0xff4d6d], 2.5, 0.5);
          }
          break;
        case 'bounce':
          Sound.tone(110 + e.speed * 10, 0.12, { type: 'sine', vol: Math.min(0.35, 0.08 + e.speed * 0.03), to: 60 });
          burst(e.p[0], e.p[1] - R, e.p[2], 6, [0x9fe8b0, 0x5cc97d], 1.5, 0.5);
          break;
        case 'land':
          Sound.tone(90, 0.08, { type: 'sine', vol: 0.12, to: 60 });
          break;
        case 'fall':
          Sound.void();
          game.strokes++;
          game.lostTimer = 1.3;
          toast(pick(LINES.fall));
          updateHud();
          break;
        case 'sink': {
          const lvl = LEVELS[game.idx];
          const good = game.strokes <= lvl.par;
          Sound.sink(good);
          if (game.strokes === 1) setTimeout(() => Sound.fanfare(), 500);
          game.sinkAnim = 0;
          game.sinkTimer = game.strokes === 1 ? 2.6 : 1.9;
          const hy = P.groundY(w, w.hole.x, w.hole.z);
          const cols = [0xffcc3d, 0xff5d8f, 0x7df9c1, 0x6ab8ff, 0xc77dff, 0xffffff];
          burst(w.hole.x, hy + 0.1, w.hole.z, good ? 110 : 50, cols, 5.5, 1.8, 7, 0.08);
          toast(resultName(game.strokes, lvl.par));
          break;
        }
        case 'rest':
          game.airborne = false;
          if (game.strokes >= LEVELS[game.idx].par + STROKE_LIMIT_OVER_PAR && w.state === 'play') {
            game.strokes = LEVELS[game.idx].par + STROKE_LIMIT_OVER_PAR;
            toast(pick(LINES.limit), true);
            w.state = 'done';
            game.sinkTimer = 1.4;
          } else {
            game.yaw = yawToHole(w);
          }
          break;
      }
    }
    w.events.length = 0;
  }

  function tick(dt) {
    const w = game.world;
    P.step(w, dt);
    if (w.state === 'play' && !w.ball.resting && !w.ball.grounded) {
      const b = w.ball.p;
      const gy = P.floorAt(w, b[0], b[2]) ? P.groundY(w, b[0], b[2]) : -Infinity;
      if (!game.airborne && b[1] - gy > 0.9) {
        game.airborne = true;
        if (Math.random() < 0.5) toast(pick(LINES.air), true);
      }
    }
    handleEvents(w);
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
        P.resetBall(w, w.lastShot.x, w.lastShot.z);
        game.airborne = false;
        game.yaw = yawToHole(w);
        const b = w.ball.p;
        burst(b[0], b[1], b[2], 16, [0xffffff, 0x7df9c1], 2, 0.6, 0);
      }
    }
    if (w.state === 'sunk' || w.state === 'done') {
      game.sinkAnim += dt;
      game.sinkTimer -= dt;
      if (game.sinkTimer <= 0 && game.mode === 'play') finishHole();
    }
  }

  function finishHole() {
    game.scores[game.idx] = game.strokes;
    updateHud();
    showCard();
  }

  // ---------- Камера ----------
  const camPos = new THREE.Vector3(0, 10, 10);
  const camLook = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();

  function levelBounds(w) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const f of w.floors) {
      x0 = Math.min(x0, f[0]); z0 = Math.min(z0, f[1]); x1 = Math.max(x1, f[2]); z1 = Math.max(z1, f[3]);
    }
    return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, size: Math.max(x1 - x0, z1 - z0) };
  }

  function overviewTarget(w, pos, look) {
    const bb = levelBounds(w);
    look.set(bb.cx, 0, bb.cz);
    pos.set(bb.cx + bb.size * 0.12, bb.size * 0.7 + 3, bb.cz + bb.size * 0.5 + 3);
  }

  function placeCameraOverview(snap) {
    overviewTarget(game.world, tmpPos, tmpLook);
    if (snap) {
      // Начинаем с облёта от лунки
      const h = game.world.hole;
      camPos.set(h.x + 3, P.groundY(game.world, h.x, h.z) + 3.5, h.z - 4);
      camLook.set(h.x, P.groundY(game.world, h.x, h.z), h.z);
    }
  }

  function updateCamera(dt) {
    const w = game.mode === 'title' ? demo : game.world;
    if (!w) return;
    let k = 1 - Math.exp(-dt * 4);
    if (game.mode === 'title') {
      const bb = levelBounds(w);
      const a = game.time * 0.12;
      tmpLook.set(bb.cx, 0, bb.cz);
      tmpPos.set(bb.cx + Math.sin(a) * 16, 9, bb.cz + Math.cos(a) * 16);
      k = 1;
    } else if (game.introT > 0) {
      overviewTarget(w, tmpPos, tmpLook);
      k = 1 - Math.exp(-dt * 1.6);
    } else if (game.overview) {
      overviewTarget(w, tmpPos, tmpLook);
      k = 1 - Math.exp(-dt * 3);
    } else {
      const b = w.ball.p;
      let yaw = game.swing ? game.swing.yaw : game.yaw;
      const moving = !w.ball.resting || game.swing;
      const dist = (moving ? 5.2 : 4.0) * game.zoom;
      const height = (moving ? 2.6 : 1.8) * game.zoom;
      const dx = Math.sin(yaw), dz = -Math.cos(yaw);
      // Во время полёта/падения держим камеру не ниже острова
      const by = w.state === 'lost' ? Math.max(b[1], w.minY - 1) : b[1];
      tmpPos.set(b[0] - dx * dist, by + height, b[2] - dz * dist);
      tmpLook.set(b[0] + dx * 1.6, by + 0.1, b[2] + dz * 1.6);
      if (w.state === 'sunk') tmpLook.set(w.hole.x, P.groundY(w, w.hole.x, w.hole.z), w.hole.z);
    }
    camPos.lerp(tmpPos, k);
    camLook.lerp(tmpLook, k);
    camera.position.copy(camPos);
    if (game.shake > 0) {
      camera.position.x += rand(-1, 1) * game.shake;
      camera.position.y += rand(-1, 1) * game.shake;
    }
    camera.lookAt(camLook);
    // Тень следует за камерой
    sun.position.set(camLook.x + 7, camLook.y + 16, camLook.z + 5);
    sun.target.position.copy(camLook);
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
      if (s == null) return '<td>·</td>';
      sum += s;
      const d = s - LEVELS[i].par;
      const cls = [i === highlight ? 'cur' : '', d < 0 ? 'under' : d > 0 ? 'over' : ''].join(' ');
      return `<td class="${cls}">${s}</td>`;
    }).join('') + `<td class="tot">${sum}</td></tr>`;
    return h;
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

  function showCard() {
    const lvl = LEVELS[game.idx];
    const last = game.idx === LEVELS.length - 1;
    game.mode = last ? 'end' : 'card';
    $('scorecard').innerHTML = scorecardHtml(game.idx);
    if (!last) {
      $('card-hole').textContent = `Лунка ${game.idx + 1} · ${lvl.name} · пар ${lvl.par}`;
      $('card-result').textContent = resultName(game.strokes, lvl.par);
      $('card-sub').textContent = `${game.strokes} ${plural(game.strokes, 'удар', 'удара', 'ударов')} · итог ${fmtRel(totalRel())}`;
      $('btn-next').textContent = 'Дальше →';
    } else {
      const total = game.scores.reduce((a, b) => a + (b || 0), 0);
      const rel = totalRel();
      const best = loadBest();
      const full = LEVELS.every((_, i) => game.scores[i] != null);
      const isBest = full && (best == null || total < best);
      if (isBest) saveBest(total);
      $('card-hole').textContent = 'Турнир окончен';
      $('card-result').textContent = `${total} · ${fmtRel(rel)}`;
      $('card-sub').textContent = (rel <= -3 ? 'Ты повелитель гравитации.' : rel <= 0 ? 'Космический профи!' : rel <= 5 ? 'Неплохо для землянина.' : 'Вселенная тебя испытывала.') +
        (isBest ? ' Новый рекорд!' : best != null ? ` Рекорд: ${best}` : '');
      $('btn-next').textContent = 'Сыграть снова';
      if (rel <= 0) Sound.fanfare();
    }
    $('card').classList.remove('hidden');
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
    if (game.mode === 'end') startGame();
    else loadHole(game.idx + 1);
  }

  // ---------- Ввод ----------
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    if (game.introT > 0 && game.mode === 'play') { game.introT = 0; return; }
    if (!canAct() || e.button !== 0) return;
    game.overview = false;
    game.drag = { y0: e.clientY, lastX: e.clientX };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const d = game.drag;
    if (!d) return;
    const dx = e.clientX - d.lastX;
    d.lastX = e.clientX;
    game.power = clamp((e.clientY - d.y0) / (window.innerHeight * 0.32), 0, 1);
    // Когда клюшка отведена, прицел становится точнее
    const sens = game.power > 0.05 ? 0.0015 : 0.006;
    game.yaw += dx * sens;
  });
  const endDrag = () => {
    if (!game.drag) return;
    game.drag = null;
    startSwing();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { game.drag = null; game.power = 0; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.zoom = clamp(game.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.6, 2.2);
  }, { passive: false });

  function restartHole() {
    if (game.mode === 'play') loadHole(game.idx);
  }
  function toggleMute() {
    $('btn-mute').classList.toggle('off', Sound.toggle());
  }
  function toggleClub() {
    if (game.swing) return;
    setClub(game.club === 'putter' ? 'wedge' : 'putter');
    Sound.init();
    Sound.tone(520, 0.06, { type: 'square', vol: 0.06 });
  }

  const KEYMAP = { a: 'left', arrowleft: 'left', ф: 'left', d: 'right', arrowright: 'right', в: 'right' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) { game.keys[KEYMAP[k]] = true; e.preventDefault(); }
    if (k === 'shift') game.keys.fine = true;
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (game.mode === 'title') { startGame(); return; }
      if (game.mode === 'card' || game.mode === 'end') { if (!e.repeat) next(); return; }
      if (k === ' ' && !e.repeat) {
        if (game.introT > 0) { game.introT = 0; return; }
        if (canAct()) { game.charging = true; game.chargeT = 0; game.overview = false; }
      }
    }
    if (e.repeat) return;
    if (k === 'q' || k === 'й' || k === '1' || k === '2') toggleClub();
    else if (k === 'v' || k === 'м') game.overview = !game.overview;
    else if (k === 'r' || k === 'к') restartHole();
    else if (k === 'm' || k === 'ь') toggleMute();
    else if (k === 'escape') { game.charging = false; game.drag = null; game.power = 0; }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) game.keys[KEYMAP[k]] = false;
    if (k === 'shift') game.keys.fine = false;
    if (k === ' ' && game.charging) {
      game.charging = false;
      startSwing();
    }
  });

  $('btn-play').addEventListener('click', startGame);
  $('btn-next').addEventListener('click', next);
  $('btn-restart').addEventListener('click', restartHole);
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-view').addEventListener('click', () => (game.overview = !game.overview));
  document.querySelectorAll('.club').forEach((b) =>
    b.addEventListener('click', () => { if (!game.swing) setClub(b.dataset.club); })
  );

  // ---------- Цикл ----------
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const demo = P.createWorld(LEVELS[2]);
  game.world = null;
  buildLevel(demo);
  ballMesh.position.set(...demo.ball.p);
  club.visible = false;
  aimLine.visible = aimRing.visible = false;

  const rollQ = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  function updateVisuals(dt) {
    const w = game.mode === 'title' ? demo : game.world;
    if (!w) return;
    // Мельницы и балки
    for (const { m, rotor } of dyn.windmills) rotor.rotation.z = (m.phase || 0) + m.speed * w.t;
    for (const { s, g } of dyn.sweepers) g.rotation.y = -((s.phase || 0) + s.speed * w.t);
    for (const tex of dyn.boost) tex.offset.x -= dt * 1.5;
    // Флажок развевается и поднимается, когда мяч близко
    if (dyn.flag) {
      const pos = dyn.flag.geometry.attributes.position;
      const base = dyn.flag.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        pos.setZ(i, Math.sin(game.time * 5 - x * 6) * 0.08 * x);
      }
      pos.needsUpdate = true;
      dyn.flag.geometry.computeVertexNormals();
      const b = w.ball.p;
      const near = Math.hypot(b[0] - w.hole.x, b[2] - w.hole.z) < 2.2 ? 1 : 0;
      dyn.flagPole.position.y += (near * 1.3 - dyn.flagPole.position.y) * Math.min(1, dt * 4);
    }
    if (game.mode === 'title') return;

    // Мяч
    const b = w.ball;
    if (w.state === 'sunk' || w.state === 'done') {
      const k = Math.min(1, game.sinkAnim / 0.4);
      const hy = P.groundY(w, w.hole.x, w.hole.z);
      ballMesh.position.set(
        b.p[0] + (w.hole.x - b.p[0]) * k,
        w.state === 'sunk' ? hy + R - k * (R * 2.5) : b.p[1],
        b.p[2] + (w.hole.z - b.p[2]) * k
      );
      ballMesh.visible = w.state === 'done' || k < 1;
    } else {
      ballMesh.visible = true;
      const prev = ballMesh.position.clone();
      ballMesh.position.set(b.p[0], b.p[1], b.p[2]);
      const mv = ballMesh.position.clone().sub(prev);
      mv.y = 0;
      const dist = mv.length();
      if (dist > 1e-5 && dist < 2) {
        axis.set(mv.z, 0, -mv.x).normalize();
        rollQ.setFromAxisAngle(axis, dist / R);
        ballMesh.quaternion.premultiply(rollQ);
      }
    }

    // Клавиатурный прицел и зарядка
    if (canAct() || game.charging) {
      const rate = game.keys.fine ? 0.25 : 1.3;
      if (game.keys.left) game.yaw -= rate * dt;
      if (game.keys.right) game.yaw += rate * dt;
    }
    if (game.charging) {
      game.chargeT += dt;
      const ph = (game.chargeT / 1.1) % 2;
      game.power = ph < 1 ? ph : 2 - ph;
    }
    updateSwing(dt);
    updateClub(dt);
    updateAim();

    // Шкала силы
    const pw = game.power;
    $('power-fill').style.height = `${Math.round(pw * 100)}%`;
    $('power-val').textContent = `${Math.round(pw * 100)}%`;
  }

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.time += dt;
    if (game.mode === 'play' && game.world) {
      if (game.introT > 0) game.introT -= dt;
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 24) { tick(DT); acc -= DT; n++; }
      if (n >= 24) acc = 0;
    } else if (game.mode === 'title') {
      demo.t += dt;
    }
    game.shake = Math.max(0, game.shake - dt * 0.5);
    updateVisuals(dt);
    updateParticles(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  showBest();
  const m = location.hash.match(/hole=(\d+)/);
  if (m) {
    startGame();
    loadHole(clamp(+m[1] - 1, 0, LEVELS.length - 1));
  }
  window.__golf3d = { game, loadHole, P };
  requestAnimationFrame(frame);
})();
