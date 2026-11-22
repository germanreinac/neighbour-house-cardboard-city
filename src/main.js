// Cardboard City: you visit a friend, walk through his wrecked house, and find a city in the backyard.
import * as THREE from '../vendor/three.module.min.js';
import { World, generate, PLACES, T, CITY, SY } from './world.js';
import { Kid, Animal, moveActor, JUMP, WATER_GRAV } from './actors.js';

const $ = id => document.getElementById(id);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TOUCH = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, 0.08, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);
// Late-afternoon sun with real shadows: boxes need shade to read as a city rather than a grid.
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(new THREE.HemisphereLight(0xfff1d6, 0x9a8468, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
const SUN_DIR = V3(0.55, 0.8, 0.38).normalize();
sun.castShadow = true; sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 150 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
function aimSun(c) {
  sun.target.position.set(Math.round(c.x / 2) * 2, 0, Math.round(c.z / 2) * 2);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 70);
}
scene.fog = new THREE.Fog(0xdcc096, 10, 50);
scene.background = new THREE.Color(0xdcc096);

function lawnTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#7f9f58'; g.fillRect(0, 0, 512, 512);
  const blot = (col, n, r0, r1) => { g.fillStyle = col; for (let i = 0; i < n; i++) { const x = rnd() * 512, y = rnd() * 512, r = r0 + rnd() * (r1 - r0);
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill(); } } };
  blot('rgba(104,138,70,0.5)', 40, 30, 80); blot('rgba(150,172,96,0.45)', 40, 20, 70); blot('rgba(176,160,104,0.4)', 14, 20, 50); // worn, dry patches
  blot('rgba(70,104,52,0.5)', 500, 1, 3);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 22); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const flat = (w, d, x, z, color, y = 0, map = null) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color, map }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
};
flat(500, 500, 64, 112, 0xffffff, 0, lawnTexture());
flat(15, 15, 64.5, 204.5, 0xb89468, 0.01);  // house floor
flat(3, 11, 64.5, 218.5, 0xbdb7ab, 0.01);   // front path

const ENV = {
  yard: { color: 0xa9d6ee, near: 25, far: 62 },
  city: { color: 0xdcc096, near: 9, far: 50 },
};
let viewDist = 50;
function setEnv(name) {
  const e = ENV[name];
  scene.fog.color.setHex(e.color); scene.background.setHex(e.color);
  scene.fog.near = e.near; scene.fog.far = e.far; viewDist = e.far;
}

// ------------------------------------------------------------------ particles (water, balloons, soggy bits)
class Fx {
  constructor(max = 900) {
    this.max = max; this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.kind = new Uint8Array(max); this.team = new Int8Array(max); this.next = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial(), max);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
  }
  // kind: 0 cosmetic, 1 water, 2 balloon
  spawn(x, y, z, vx, vy, vz, life, color, size, kind = 0, team = -9) {
    let i = this.next;
    for (let n = 0; n < this.max && this.life[i] > 0; n++) i = (i + 1) % this.max;
    this.next = (i + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.size[i] = size; this.kind[i] = kind; this.team[i] = team;
    this._c.setHex(color); this.col[i * 3] = this._c.r; this.col[i * 3 + 1] = this._c.g; this.col[i * 3 + 2] = this._c.b;
  }
  burst(x, y, z, n, color, speed, size) {
    for (let i = 0; i < n; i++) this.spawn(x, y, z, (Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed, 0.35 + Math.random() * 0.4, color, size * (0.6 + Math.random() * 0.8));
  }
  update(dt) {
    const { p, v, life, kind, team } = this; let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      v[j + 1] -= WATER_GRAV * dt;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      const x = p[j], y = p[j + 1], z = p[j + 2];
      if (kind[i] === 0) { if (y < 0) life[i] = 0; }
      else {
        let done = false;
        if (world.solidAt(x, y, z)) {
          done = true;
          if (kind[i] === 1) game.waterHitsBlock(Math.floor(x), Math.floor(y), Math.floor(z), team[i], x - v[j] * dt, y - v[j + 1] * dt, z - v[j + 2] * dt);
        } else for (const a of game.actors) {
          if (a.team === team[i] || !a.targetable()) continue;
          const dx = a.pos.x - x, dz = a.pos.z - z, rr = a.r + 0.16;
          if (dx * dx + dz * dz < rr * rr && y > a.pos.y && y < a.pos.y + a.h) {
            done = true; if (kind[i] === 1) game.waterHitsActor(a, team[i], x, y, z); break;
          }
        }
        if (done) { life[i] = 0; if (kind[i] === 2) game.balloonPop(x - v[j] * dt, y - v[j + 1] * dt, z - v[j + 2] * dt, team[i]); }
      }
      if (life[i] <= 0) continue;
      const s = this.size[i];
      this._m.makeScale(s, s, s).setPosition(x, y, z);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n++, this._c.setRGB(this.col[j], this.col[j + 1], this.col[j + 2]));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ sound (tiny synth, no assets)
let ac = null, noise = null, lastSquirt = 0;
function initAudio() {
  if (ac) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ac = null; }
}
function sfx(name, pos) {
  if (!ac) return;
  let vol = 0.25;
  if (pos) { const d = pos.distanceTo(player.pos); if (d > 30) return; vol *= 1 - d / 30; }
  const t = ac.currentTime, g = ac.createGain(); g.connect(ac.destination);
  const tone = (f0, f1, dur, type = 'sine') => {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  };
  const hiss = (freq, dur, type) => {
    const s = ac.createBufferSource(); s.buffer = noise; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    s.connect(f); f.connect(g); s.start(t); s.stop(t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  };
  if (name === 'squirt') { if (t - lastSquirt < 0.05) return; lastSquirt = t; vol *= 0.5; hiss(2200, 0.07, 'bandpass'); }
  else if (name === 'crumble') hiss(420, 0.22, 'lowpass');
  else if (name === 'pop') { hiss(900, 0.25, 'lowpass'); tone(300, 60, 0.2); }
  else if (name === 'pick') tone(700, 1400, 0.12, 'triangle');
  else if (name === 'thunk') tone(160, 70, 0.1, 'triangle');
  else if (name === 'glug') { vol *= 0.6; tone(260, 180, 0.12); }
  else if (name === 'empty') { vol *= 0.5; tone(900, 700, 0.04, 'square'); }
  else if (name === 'win') { tone(523, 1046, 0.6, 'triangle'); }
}

// ------------------------------------------------------------------ world
const world = new World(scene);
const { loot, flaps, signs } = generate(world);
const fx = new Fx();
const soggyBlue = new THREE.Color(0x27356b);

const player = {
  pos: V3(PLACES.start.x, 0, PLACES.start.z), vel: V3(), r: 0.3, h: 1.4, onGround: false, blocked: false,
  team: 0, yaw: 0, pitch: 0, water: 0, tank: 60, wetness: 0, sinceHit: 99, caps: 0, card: 4, balloons: 2,
  hasGun: false, pump: false, coat: false, tankLvl: 0, safe: false, out: 0,
  targetable() { return game.mode === 'city' && !this.safe && game.graceT <= 0; },
  hit(amount) {
    if (!this.targetable()) return;
    this.wetness += amount * (this.coat ? 0.6 : 1); this.sinceHit = 0; game.flash = 0.6;
    if (this.wetness >= 100) game.playerSoaked();
  },
};

const game = {
  scene, world, fx, player, soggyBlue, sfx,
  mode: 'menu', time: 0, actors: [player], items: [], flags: [], stage: 0, graceT: 0, flash: 0, won: false, marketOpen: false,
  nearPlayer(p, d) { const dx = p.x - player.pos.x, dz = p.z - player.pos.z; return dx * dx + dz * dz < d * d; },
  freeSpot(x, z, range, avoid = 0) {
    for (let n = 0; n < 80; n++) {
      const cx = Math.floor(x + (Math.random() * 2 - 1) * range), cz = Math.floor(z + (Math.random() * 2 - 1) * range);
      if (Math.abs(cx - Math.floor(x)) < avoid && Math.abs(cz - Math.floor(z)) < avoid) continue;
      if (cx < 3 || cz < 3 || cx > CITY - 4 || cz > CITY - 4) continue;
      if (!world.solid(cx, 0, cz) && !world.solid(cx, 1, cz)) return { x: cx + 0.5, z: cz + 0.5 };
    }
    return { x: x + 0.5, z: z + 0.5 };
  },
  waterHitsBlock(x, y, z, team, px, py, pz) {
    const amount = team === 0 ? (player.pump ? 0.5 : 0.34) : 0.25;
    world.soak(x, y, z, amount, team === 0);
    if (Math.random() < 0.6) fx.burst(px, py, pz, 2, 0x8fd0ff, 3, 0.08);
  },
  waterHitsActor(a, team, x, y, z) {
    fx.burst(x, y, z, 3, 0xbfe4ff, 3, 0.08);
    if (a === player) player.hit(7); else a.hit(team === 0 ? (player.pump ? 34 : 25) : 20, team);
  },
  balloonPop(x, y, z, team) {
    const R = 2.3, cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    for (let yy = cy - 2; yy <= cy + 2; yy++) for (let zz = cz - 3; zz <= cz + 3; zz++) for (let xx = cx - 3; xx <= cx + 3; xx++)
      if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 + (zz + 0.5 - z) ** 2 < R * R) world.soak(xx, yy, zz, 1.5, team === 0);
    for (const a of game.actors) {
      if (a.team === team || !a.targetable()) continue;
      if (a.pos.distanceTo(V3(x, y - 0.5, z)) < 3.4) a === player ? player.hit(30) : a.hit(70, team);
    }
    fx.burst(x, y, z, 40, 0x8fd0ff, 9, 0.14);
    sfx('pop', V3(x, y, z));
  },
  kidSoaked(kid, byTeam) {
    if (byTeam === 0) { addItem('caps', kid.pos.x, kid.pos.y, kid.pos.z, 2); toast(`Soaked one of the ${PLACES.forts[kid.team - 1].name}. They dropped caps.`); }
  },
  goosed(goose, dx, dz) {
    player.vel.x += dx * 9; player.vel.z += dz * 9; player.vel.y = 4;
    if (player.hasGun && player.water > 0) { player.water = Math.max(0, player.water - 8); toast('HONK. The goose knocked water out of your tank.'); }
    sfx('thunk');
  },
  playerSoaked() {
    const lost = Math.min(3, player.caps); player.caps -= lost;
    for (const f of game.flags) if (f.state === 'carried') { f.state = 'home'; f.mesh.visible = true; }
    toast(`Soaked through. You squelch back to the Treehouse${lost ? ` and drop ${lost} caps on the way` : ''}.`);
    fade(() => {
      player.pos.set(PLACES.respawn.x, 0, PLACES.respawn.z); player.vel.set(0, 0, 0); player.yaw = Math.PI / 2; player.pitch = 0;
      player.wetness = 0; player.water = Math.max(player.water, player.tank / 2);
    });
    game.graceT = 4;
  },
};
world.onBreak = (x, y, z, byPlayer) => {
  fx.burst(x + 0.5, y + 0.5, z + 0.5, 7, 0x6b4a2c, 4, 0.16);
  sfx('crumble', V3(x, y, z));
  if (byPlayer && Math.random() < 0.4) player.card++;
  const hung = props.get(world.idx(x, y, z));
  if (hung) { hung.forEach(fn => fn()); props.delete(world.idx(x, y, z)); }
};

// ------------------------------------------------------------------ decoration that breaks up the grid
const props = new Map(); // support cell -> things to remove when that cell melts
const hang = (sup, fn) => { const i = world.idx(...sup); if (!props.has(i)) props.set(i, []); props.get(i).push(fn); };
const kraft = new THREE.MeshLambertMaterial({ color: 0xffffff });
const dummy = new THREE.Object3D(); dummy.rotation.order = 'YXZ';
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tone = new THREE.Color();
{ // open box flaps along the tops of buildings
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), kraft, flaps.length);
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  flaps.forEach((f, i) => {
    const depth = 0.75 + (i % 5) * 0.12;
    dummy.rotation.set(-f.a, Math.atan2(f.dx, f.dz), 0);
    dummy.position.set(f.x + f.dx * Math.cos(f.a) * depth / 2, f.y + Math.sin(f.a) * depth / 2, f.z + f.dz * Math.cos(f.a) * depth / 2);
    dummy.scale.set(f.len, 0.05, depth); dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tone.setHex([0xc9a26b, 0xb98f58, 0xd3ae76][i % 3]));
    hang(f.sup, () => { mesh.setMatrixAt(i, ZERO); mesh.instanceMatrix.needsUpdate = true; });
  });
  scene.add(mesh);
}
{ // flattened boxes trampled into the lawn, at every angle
  const N = 420, mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), kraft, N);
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    dummy.rotation.set(0, rnd() * 3.14, 0); dummy.position.set(4 + rnd() * 120, 0.012 + i * 0.00004, 4 + rnd() * 120);
    dummy.scale.set(1.2 + rnd() * 2.4, 0.02, 0.9 + rnd() * 1.6); dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tone.setHex([0xb89460, 0xa98552, 0xc4a06c][i % 3]));
  }
  scene.add(mesh);
}
{ // the tree's canopy: soft blobs, the one thing here that isn't a box
  const leaf = new THREE.MeshLambertMaterial({ color: 0x4f8f4a, flatShading: true }), geo = new THREE.IcosahedronGeometry(1, 1);
  for (const [x, y, z, r] of [[64.5, 12.5, 64.5, 8], [58, 11.5, 61, 5.5], [71, 11.8, 62, 5.5], [62, 11.5, 71, 5.5], [69, 12, 70, 5], [64.5, 15, 64.5, 5.5]]) {
    const m = new THREE.Mesh(geo, leaf); m.position.set(x, y, z); m.scale.set(r, r * 0.55, r); m.rotation.y = x; m.castShadow = true; scene.add(m);
  }
}
{ // hand-lettered signs
  const WORDS = ['KEEP OUT', 'NO GROWN-UPS', 'SECRET HQ', 'PASSWORD?', 'MY HOUSE', 'BANK', 'JAIL', 'NO GEESE', 'HOTEL', 'DO NOT MELT', 'SNACKS', 'LAB'];
  const INK = ['#c23b2e', '#2a2018', '#2f5fb5', '#2a7a45'];
  const cache = new Map();
  const signMat = (text, big) => {
    if (cache.has(text)) return cache.get(text);
    const c = document.createElement('canvas'); c.width = 512; c.height = 192;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const draw = () => {
      const g = c.getContext('2d'); g.fillStyle = big ? '#f4ead2' : '#e9dcc0'; g.fillRect(0, 0, 512, 192);
      g.strokeStyle = 'rgba(42,32,24,.5)'; g.lineWidth = 6; g.strokeRect(3, 3, 506, 186);
      g.fillStyle = INK[text.length % INK.length]; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '84px "Permanent Marker", "Comic Sans MS", sans-serif';
      g.translate(256, 100); g.rotate((text.length % 5 - 2) * 0.025); g.fillText(text, 0, 0, 470); g.setTransform(1, 0, 0, 1, 0, 0);
      tex.needsUpdate = true;
    };
    draw(); document.fonts?.load('84px "Permanent Marker"').then(draw).catch(() => {});
    const m = new THREE.MeshLambertMaterial({ map: tex }); cache.set(text, m); return m;
  };
  const geo = new THREE.PlaneGeometry(1, 1);
  signs.forEach((sg, i) => {
    if (world.get(...sg.sup) !== T.CARD) return;
    const text = sg.text || WORDS[i % WORDS.length], w = sg.big ? 3.4 : 1.7;
    const m = new THREE.Mesh(geo, signMat(text, sg.big));
    m.scale.set(w, w * 0.375, 1); m.position.set(sg.x + sg.dx * 0.03, sg.y, sg.z + sg.dz * 0.03);
    m.rotation.set(0, Math.atan2(sg.dx, sg.dz), (i % 7 - 3) * (sg.big ? 0.012 : 0.03), 'YXZ'); m.receiveShadow = true;
    scene.add(m); hang(sg.sup, () => { m.visible = false; });
  });
}

// ------------------------------------------------------------------ things in the world
const capGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.05, 8);
function addItem(kind, x, y, z, n) {
  const g = new THREE.Group();
  if (kind === 'caps') for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(capGeo, new THREE.MeshLambertMaterial({ color: [0xe8c74a, 0xd9483b, 0x4f7fd9][i] }));
    m.position.set(Math.cos(i * 2.1) * 0.16, i * 0.06, Math.sin(i * 2.1) * 0.16); m.rotation.z = 0.3 * i; g.add(m);
  } else if (kind === 'balloon') g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshLambertMaterial({ color: 0xe2553f })));
  else { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.42, 8), new THREE.MeshLambertMaterial({ color: 0x6ec3ff })); g.add(m); }
  g.position.set(x, y + 0.45, z); scene.add(g);
  game.items.push({ g, kind, n: n || 2 + Math.floor(Math.random() * 3), y: y + 0.45 });
}
for (const l of loot) addItem(l.kind, l.x, l.y, l.z);

for (const p of PLACES.pools) {
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.34, 20), new THREE.MeshLambertMaterial({ color: 0xe86a8a }));
  pool.position.set(p.x, 0.17, p.z); scene.add(pool);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.36, 20), new THREE.MeshBasicMaterial({ color: 0x4fb4ff }));
  water.position.set(p.x, 0.17, p.z); scene.add(water);
}

function makeFlag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
  pole.position.y = 1.15; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.04), new THREE.MeshLambertMaterial({ color }));
  cloth.position.set(0.4, 1.95, 0); g.add(cloth);
  scene.add(g); return g;
}
const DECK = [[70.2, 58.8], [70.2, 70.2], [58.8, 70.2]];
PLACES.forts.forEach((f, i) => {
  const mesh = makeFlag(f.color); mesh.position.set(f.x + 0.5, 0, f.z + 0.5);
  game.flags.push({ ...f, mesh, state: 'home', home: V3(f.x + 0.5, 0, f.z + 0.5), deck: DECK[i] });
  // banners on the fort towers so you can tell whose turf it is
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const b = makeFlag(f.color); b.position.set(f.x + sx * 10 + 0.5, 10, f.z + sz * 10 + 0.5); }
  $('flags').children[i].style.setProperty('--c', '#' + f.color.toString(16).padStart(6, '0'));
});

const COSTUME = [null, { costume: 'knight', shirt: 0xd9483b }, { costume: 'pirate', shirt: 0x8a4fd1 }, { costume: 'dino', shirt: 0x3fa35c }];
const addActor = a => { game.actors.push(a); return a; };
for (const f of PLACES.forts) for (let i = 0; i < 6; i++) {
  // half of each tribe guards the fort, the other half raids the middle of the city
  const home = i < 3 ? { x: f.x + 0.5, z: f.z + 0.5 } : { x: 64 + (f.x - 64) * 0.3 + (i - 4) * 9, z: 64 + (f.z - 64) * 0.3 + (4 - i) * 9 };
  const s = i < 3 ? game.freeSpot(f.x, f.z, 8, 4) : game.freeSpot(home.x, home.z, 5);
  const k = addActor(new Kid(game, { ...COSTUME[f.team], team: f.team, x: s.x, z: s.z }));
  k.home = home;
}
const brother = addActor(new Kid(game, { team: -1, still: true, costume: 'brother', shirt: 0x6b6b7a, pants: 0x2f2f38, scale: 1.45, gun: false, x: 63.1, z: 210.4, yaw: Math.PI }));
const milo = addActor(new Kid(game, { team: -1, still: true, costume: 'cape', shirt: 0x35a7c4, x: PLACES.friend.x, z: PLACES.friend.z, yaw: Math.PI }));
const keeper = addActor(new Kid(game, { team: -1, still: true, costume: 'apron', shirt: 0xe07b39, gun: false, x: PLACES.shop.x, z: PLACES.shop.z, yaw: -Math.PI / 2 }));
keeper.pos.y = 7.05; keeper.say('CAPS FOR STUFF', 1e9);
for (const [x, z, c] of [[66.5, 68.5, 0xd96aa0], [68.5, 60.5, 0x58a56e]]) {
  const k = addActor(new Kid(game, { team: -1, still: true, costume: 'none', shirt: c, gun: false, x, z })); k.pos.y = 7.05;
}
const animalAt = (kind, x, z, r = 6) => { const s = game.freeSpot(x, z, r); addActor(new Animal(game, kind, s.x, s.z)); };
animalAt('dog', 66, 108); animalAt('dog', 92, 90);
animalAt('cat', 50, 96); animalAt('cat', 82, 40); animalAt('cat', 40, 44); animalAt('cat', 70, 80);
animalAt('goose', 34, 62, 3); animalAt('goose', 62, 30, 3); animalAt('goose', 102, 102, 3); animalAt('goose', 96, 64, 3);

// water gun in your hand
const gun = new THREE.Group();
{
  const b = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c, fog: false })); m.position.set(x, y, z); gun.add(m); };
  b(0.07, 0.09, 0.36, 0, 0, 0, 0x35c46a); b(0.06, 0.14, 0.07, 0, -0.1, 0.1, 0x35c46a);
  b(0.09, 0.1, 0.16, 0, 0.09, 0.06, 0xff8a2a); b(0.035, 0.035, 0.1, 0, 0.01, -0.22, 0xffd23f);
}
gun.scale.setScalar(0.62); gun.position.set(0.24, -0.2, -0.45); gun.visible = false; camera.add(gun);

// ------------------------------------------------------------------ HUD helpers
function toast(text) {
  const box = $('toasts');
  if (box.lastChild && box.lastChild.textContent === text) return;
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = text; box.appendChild(d);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.remove(), 3300);
}
const subs = []; let subT = 0;
function say(who, text, secs = 3.4) { subs.push({ who, text, secs }); }
function updateSubs(dt) {
  subT -= dt;
  if (subT > 0) return;
  const s = subs.shift(), el = $('sub');
  if (!s) { el.hidden = true; return; }
  el.replaceChildren(); const b = document.createElement('b'); b.textContent = s.who; el.append(b, s.text);
  el.hidden = false; subT = s.secs;
}
function fade(mid) {
  $('fade').style.opacity = 1;
  setTimeout(() => { mid(); $('fade').style.opacity = 0; }, 550);
}
function titleCard(h, p, secs = 3.5) {
  $('card-h').textContent = h; $('card-p').textContent = p; $('card').style.opacity = 1;
  setTimeout(() => { $('card').style.opacity = 0; }, secs * 1000);
}
function showHud() {
  for (const id of ['cross', 'compass', 'pack', 'stats']) $(id).hidden = !(game.mode === 'city');
  $('touch').hidden = !(TOUCH && game.mode !== 'menu');
}

// ------------------------------------------------------------------ story beats
function startIntro() {
  initAudio(); game.mode = 'intro'; $('menu').hidden = true; setEnv('yard');
  player.pos.set(PLACES.start.x, 0, PLACES.start.z); player.yaw = 0; player.pitch = 0;
  showHud(); canvas.focus();
  say('', 'Milo said to come over after school. This is his house. The lawn has not been mowed since spring.', 4.2);
}
function enterCity(instant) {
  const go = () => {
    game.mode = 'city'; setEnv('city'); $('menu').hidden = true;
    player.pos.set(PLACES.citySpawn.x, 0, PLACES.citySpawn.z); player.vel.set(0, 0, 0); player.yaw = 0; player.pitch = 0;
    subs.length = 0; subT = 0;
    showHud(); titleCard('Cardboard City', 'It was a pile of boxes a second ago.');
  };
  if (instant) { initAudio(); go(); canvas.focus(); } else fade(go);
}
function meetMilo() {
  game.stage = 3;
  say('Milo', 'You made it! Dad\'s at work till, like, forever. So we built this.');
  say('Milo', 'Take my spare squirter. Water melts cardboard, so any wall is a door if you want it to be.', 4.5);
  say('Milo', 'Refill at the kiddie pools. Don\'t get soaked. And watch out for the goose.', 4);
  say('Milo', 'Three tribes, three flags. Get all three up to the Treehouse and the whole city is ours.', 4.5);
  player.hasGun = true; player.water = player.tank; gun.visible = true; sfx('pick');
  toast('Got a squirter. Hold click to spray.');
}

function interaction() {
  const p = player.pos, near = (x, z, d) => Math.hypot(p.x - x, p.z - z) < d;
  if (game.mode === 'intro') {
    if (game.stage === 0 && near(64.5, 213.4, 2)) return { label: 'Knock', fn() {
      game.stage = 1; world.set(64, 0, 212, T.AIR); world.set(64, 1, 212, T.AIR); sfx('thunk');
      brother.say('...', 2);
      say('Big brother', '...Yeah? Oh. It\'s you.', 2.4); say('Big brother', 'He\'s in the backyard. Don\'t touch my stuff.', 3.2);
    } };
    if (game.stage === 1 && near(64.5, 197.6, 1.8)) return { label: 'Open the back door', fn() {
      game.stage = 2; world.set(64, 0, 196, T.AIR); world.set(64, 1, 196, T.AIR); sfx('thunk');
      say('', 'The backyard. A mountain of cardboard boxes. One of them has a hole in the front, kid sized.', 4.5);
    } };
  } else if (game.mode === 'city') {
    if (player.safe && near(PLACES.shop.x, PLACES.shop.z, 3.4)) return { label: 'Trade bottle caps', fn: openMarket };
  }
  return null;
}

// ------------------------------------------------------------------ market
const SHOP = [
  { name: 'Backpack tank', note: 'Carry 60 more water', cost: 6, can: () => player.tankLvl < 2, buy() { player.tankLvl++; player.tank += 60; player.water = player.tank; } },
  { name: 'Pump-action pressure', note: 'Shoots further, melts walls in two hits', cost: 8, can: () => !player.pump, buy() { player.pump = true; } },
  { name: 'Raincoat', note: 'You get soaked a lot slower', cost: 7, can: () => !player.coat, buy() { player.coat = true; } },
  { name: 'Water balloons ×3', note: 'One balloon opens a whole wall', cost: 4, can: () => true, buy() { player.balloons += 3; } },
  { name: 'Flat-pack bundle ×8', note: 'Boxes to build stairs, bridges and cover', cost: 3, can: () => true, buy() { player.card += 8; } },
];
function renderShop() {
  $('mcaps').textContent = player.caps;
  $('shop').replaceChildren(...SHOP.map((it, i) => {
    const b = document.createElement('button'); b.id = 'shop-' + i;
    const own = !it.can();
    b.disabled = own || player.caps < it.cost;
    b.innerHTML = `<span></span><b></b><small></small>`;
    b.children[0].textContent = it.name; b.children[1].textContent = own ? 'got it' : it.cost + ' caps'; b.children[2].textContent = it.note;
    b.onclick = () => { player.caps -= it.cost; it.buy(); sfx('pick'); renderShop(); };
    return b;
  }));
}
function openMarket() { game.marketOpen = true; $('market').hidden = false; renderShop(); if (document.pointerLockElement) document.exitPointerLock(); input.fire = false; }
function closeMarket() { game.marketOpen = false; $('market').hidden = true; canvas.focus(); }
$('market-close').onclick = closeMarket;

// ------------------------------------------------------------------ input
const input = { keys: new Set(), fire: false, mx: 0, mz: 0 };
const playing = () => game.mode !== 'menu' && !game.marketOpen;
addEventListener('keydown', e => {
  if (e.code === 'Escape' && game.marketOpen) return closeMarket();
  if (!playing()) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  input.keys.add(e.code);
  if (e.code === 'KeyE') interaction()?.fn();
  if (e.code === 'KeyQ') placeBox();
  if (e.code === 'KeyG') throwBalloon();
});
addEventListener('keyup', e => input.keys.delete(e.code));
addEventListener('blur', () => { input.keys.clear(); input.fire = false; });
const look = (dx, dy, k) => { player.yaw -= dx * k; player.pitch = clamp(player.pitch - dy * k, -1.45, 1.45); };
canvas.addEventListener('mousedown', e => {
  if (!playing() || TOUCH) return;
  canvas.focus();
  if (!document.pointerLockElement) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* drag-to-look still works */ } }
  if (e.button === 0) input.fire = true;
  if (e.button === 2) placeBox();
});
addEventListener('mouseup', e => { if (e.button === 0) input.fire = false; });
addEventListener('mousemove', e => {
  if (!playing() || TOUCH) return;
  if (document.pointerLockElement === canvas || e.buttons) look(e.movementX, e.movementY, 0.0024);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
$('prompt').onclick = () => interaction()?.fn();

if (TOUCH) {
  $('keys-desktop').hidden = true; $('keys-touch').hidden = false;
  let stickId = null, sx = 0, sy = 0; const looks = new Map();
  const stick = $('stick');
  const down = (e, firing) => {
    if (!playing()) return;
    e.preventDefault();
    if (!firing && stickId === null && e.clientX < innerWidth * 0.42) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      const r = $('ui').getBoundingClientRect(); stick.style.left = sx - r.left + 'px'; stick.style.top = sy - r.top + 'px'; stick.hidden = false;
    } else looks.set(e.pointerId, { x: e.clientX, y: e.clientY, firing });
    if (firing) input.fire = true;
  };
  canvas.addEventListener('pointerdown', e => down(e, false));
  $('b-fire').addEventListener('pointerdown', e => { $('b-fire').setPointerCapture(e.pointerId); down(e, true); });
  addEventListener('pointermove', e => {
    if (e.pointerId === stickId) { input.mx = clamp((e.clientX - sx) / 48, -1, 1); input.mz = clamp((e.clientY - sy) / 48, -1, 1); }
    const l = looks.get(e.pointerId);
    if (l) { look(e.clientX - l.x, e.clientY - l.y, 0.006); l.x = e.clientX; l.y = e.clientY; }
  });
  const up = e => {
    if (e.pointerId === stickId) { stickId = null; input.mx = input.mz = 0; stick.hidden = true; }
    const l = looks.get(e.pointerId); if (l) { if (l.firing) input.fire = false; looks.delete(e.pointerId); }
  };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  $('b-jump').addEventListener('pointerdown', e => { e.preventDefault(); input.keys.add('Space'); setTimeout(() => input.keys.delete('Space'), 200); });
  $('b-block').addEventListener('pointerdown', e => { e.preventDefault(); placeBox(); });
  $('b-balloon').addEventListener('pointerdown', e => { e.preventDefault(); throwBalloon(); });
}
$('start-intro').onclick = startIntro;
$('start-skip').onclick = () => enterCity(true);

// ------------------------------------------------------------------ player actions
const fwd = V3(), eye = V3();
function aim() { camera.getWorldDirection(fwd); eye.copy(camera.position); }
let fireAcc = 0, emptyT = 0;
function squirt(dt) {
  if (!input.fire && !input.keys.has('KeyF')) { fireAcc = 0; return; }
  if (!player.hasGun || game.mode !== 'city') return;
  if (player.safe) { toast('No squirting in the Treehouse. That\'s the rule.'); return; }
  if (player.water <= 0) { if ((emptyT -= dt) <= 0) { emptyT = 0.4; sfx('empty'); toast('Tank\'s empty. Find a kiddie pool.'); } return; }
  fireAcc += dt * 13;
  aim();
  const speed = player.pump ? 30 : 23;
  while (fireAcc >= 1 && player.water > 0) {
    fireAcc -= 1; player.water -= 1;
    const s = 0.9, r = 0.22;
    fx.spawn(eye.x + fwd.x * 0.5 - fwd.z * r, eye.y - 0.16 + fwd.y * 0.5, eye.z + fwd.z * 0.5 + fwd.x * r,
      fwd.x * speed + player.vel.x + (Math.random() - 0.5) * s, fwd.y * speed + 1.2 + (Math.random() - 0.5) * s, fwd.z * speed + player.vel.z + (Math.random() - 0.5) * s,
      1.7, 0x5fb8ff, 0.13, 1, 0);
    gun.position.z = -0.4;
    sfx('squirt');
  }
}
function placeBox() {
  if (game.mode !== 'city') return;
  if (player.card <= 0) { toast('No boxes left. Melt some walls and grab the dry bits.'); return; }
  aim();
  const h = world.raycast(eye, fwd, 4.6);
  if (!h) return;
  const { px: x, py: y, pz: z } = h;
  if (!world.inb(x, y, z) || y >= SY - 1 || z >= CITY || world.get(x, y, z) !== T.AIR) return;
  const p = player.pos;
  if (x + 1 > p.x - player.r && x < p.x + player.r && z + 1 > p.z - player.r && z < p.z + player.r && y + 1 > p.y && y < p.y + player.h) return;
  world.set(x, y, z, T.CARD); player.card--; sfx('thunk');
}
function throwBalloon() {
  if (game.mode !== 'city' || player.safe) return;
  if (player.balloons <= 0) { toast('No balloons. The Treehouse market sells them.'); return; }
  aim(); player.balloons--;
  fx.spawn(eye.x + fwd.x * 0.6, eye.y + fwd.y * 0.6, eye.z + fwd.z * 0.6, fwd.x * 15, fwd.y * 15 + 4, fwd.z * 15, 4, 0xe2553f, 0.32, 2, 0);
  sfx('thunk');
}

function updatePlayer(dt) {
  const k = input.keys, p = player.pos;
  if (k.has('ArrowLeft')) player.yaw += 2.2 * dt;
  if (k.has('ArrowRight')) player.yaw -= 2.2 * dt;
  if (k.has('ArrowUp')) player.pitch = clamp(player.pitch + 1.5 * dt, -1.45, 1.45);
  if (k.has('ArrowDown')) player.pitch = clamp(player.pitch - 1.5 * dt, -1.45, 1.45);
  let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - input.mz, s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + input.mx;
  const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw), speed = 5.3;
  const wx = (-sin * f + cos * s) * speed, wz = (-cos * f - sin * s) * speed, a = Math.min(1, dt * 14);
  player.vel.x += (wx - player.vel.x) * a; player.vel.z += (wz - player.vel.z) * a;
  if (k.has('Space') && player.onGround) { player.vel.y = JUMP; player.onGround = false; }
  moveActor(world, player, dt);
  if (game.mode === 'intro') { p.x = clamp(p.x, 50, 79); p.z = clamp(p.z, 175.5, 222.5); }

  player.sinceHit += dt; game.graceT -= dt;
  const wasSafe = player.safe;
  player.safe = game.mode === 'city' && p.y >= 6.9 && p.x > 57 && p.x < 72 && p.z > 57 && p.z < 72;
  if (player.safe && !wasSafe) toast('The Treehouse. Real wood. Water can\'t touch it, and nobody fights up here.');
  if (player.sinceHit > 2.5 || player.safe) player.wetness = Math.max(0, player.wetness - (player.safe ? 30 : 4) * dt);

  if (game.mode === 'intro' && game.stage === 2 && p.z < 181.6 && Math.abs(p.x - 64.5) < 0.8) { game.stage = 2.5; enterCity(false); }
  if (game.mode === 'city') {
    if (game.stage < 3 && Math.hypot(p.x - milo.pos.x, p.z - milo.pos.z) < 3.4) meetMilo();
    // pools
    for (const q of PLACES.pools) if (p.y < 0.6 && Math.hypot(p.x - q.x, p.z - q.z) < 2.4 && player.hasGun && player.water < player.tank) {
      player.water = Math.min(player.tank, player.water + 45 * dt);
      if (Math.random() < dt * 6) sfx('glug');
    }
    // pickups
    for (let i = game.items.length - 1; i >= 0; i--) {
      const it = game.items[i], q = it.g.position;
      it.g.rotation.y += dt * 2; q.y = it.y + Math.sin(game.time * 3 + i) * 0.08;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 1.1 && Math.abs(it.y - p.y - 0.6) < 1.4) {
        if (it.kind === 'caps') { player.caps += it.n; toast(`+${it.n} bottle caps`); }
        else if (it.kind === 'balloon') { player.balloons++; toast('+1 water balloon'); }
        else { player.water = Math.min(player.tank, player.water + 30); toast('A full water bottle. Glug.'); }
        scene.remove(it.g); game.items.splice(i, 1); sfx('pick');
      }
    }
    // flags
    for (const fl of game.flags) {
      if (fl.state === 'home' && p.distanceTo(fl.home) < 1.5) {
        fl.state = 'carried'; fl.mesh.visible = false; sfx('pick');
        toast(`You grabbed the ${fl.name} flag. Get it to the Treehouse!`);
      } else if (fl.state === 'carried' && player.safe) {
        fl.state = 'captured'; fl.mesh.visible = true; fl.mesh.position.set(fl.deck[0], 7, fl.deck[1]); sfx('win');
        const n = game.flags.filter(x => x.state === 'captured').length;
        if (n === 3 && !game.won) { game.won = true; titleCard('The city is yours', 'All three flags fly over the Treehouse. Milo says you can come back tomorrow.', 7); }
        else toast(`${fl.name} flag planted. ${3 - n} to go.`);
      }
    }
  }
  camera.position.set(p.x, p.y + 1.25, p.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  gun.position.z += (-0.45 - gun.position.z) * Math.min(1, dt * 12);
  gun.position.y = -0.2 + Math.sin(game.time * 9) * 0.008 * Math.min(1, Math.hypot(player.vel.x, player.vel.z));
}

function updateHud() {
  $('watern').textContent = `${Math.ceil(player.water)} / ${player.tank}`;
  $('waterbar').firstChild.style.width = (player.hasGun ? player.water / player.tank * 100 : 0) + '%';
  $('wetbar').firstChild.style.width = Math.min(100, player.wetness) + '%';
  $('caps').textContent = player.caps; $('boxes').textContent = player.card; $('balloons').textContent = player.balloons;
  game.flags.forEach((f, i) => { $('flags').children[i].className = f.state === 'home' ? '' : f.state; });
  game.flash = Math.max(0, game.flash - 0.03);
  $('wetflash').style.opacity = Math.max(game.flash, player.wetness > 70 ? (player.wetness - 70) / 60 : 0);
  // compass: next flag, or home if you're carrying one
  let tx = PLACES.tree.x, tz = PLACES.tree.z, name = 'Treehouse';
  if (game.stage < 3) { tx = milo.pos.x; tz = milo.pos.z; name = 'Milo'; }
  else if (!game.flags.some(f => f.state === 'carried')) {
    let bd = 1e9;
    for (const f of game.flags) { const d = Math.hypot(f.home.x - player.pos.x, f.home.z - player.pos.z); if (f.state === 'home' && d < bd) { bd = d; tx = f.home.x; tz = f.home.z; name = f.name + ' flag'; } }
  }
  const dx = tx - player.pos.x, dz = tz - player.pos.z;
  $('needle').style.transform = `rotate(${-(Math.atan2(-dx, -dz) - player.yaw)}rad)`;
  $('goal').textContent = `${name} · ${Math.round(Math.hypot(dx, dz))} boxes`;
  const it = playing() ? interaction() : null, pr = $('prompt');
  pr.hidden = !it; if (it) pr.textContent = (TOUCH ? 'Tap: ' : 'E: ') + it.label;
}

// ------------------------------------------------------------------ loop
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
}
let last = performance.now();
function step(dt) {
  game.time += dt;
  if (game.mode === 'menu') {
    const a = game.time * 0.06;
    camera.position.set(64.5 + Math.cos(a) * 30, 15, 64.5 + Math.sin(a) * 30); camera.lookAt(64.5, 6, 64.5);
  } else if (!game.marketOpen) { updatePlayer(dt); squirt(dt); }
  for (const a of game.actors) if (a !== player) a.update(dt);
  fx.update(dt);
  aimSun(game.mode === 'menu' ? PLACES.tree : camera.position);
  world.update(dt, camera.position, viewDist);
  updateSubs(dt);
  updateHud();
}
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  resize(); step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
setEnv('city'); showHud();
requestAnimationFrame(frame);
window.__cc = { game, player, world, step, input, PLACES, enterCity, startIntro };
