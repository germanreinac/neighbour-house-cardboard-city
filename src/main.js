// Cardboard City: you visit a friend, walk through his wrecked house, and find a city in the backyard.
import * as THREE from '../vendor/three.module.min.js';
import { World, generate, PLACES, LEVEL, districtAt, T, CITY, SY } from './world.js';
import { Kid, Animal, makeKid, moveActor, JUMP, WATER_GRAV } from './actors.js';

const $ = id => document.getElementById(id);
const STORY = true; // the linear adventure. The open-world tribe systems are still in here but switched off.
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TOUCH = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.08, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);
// Late-afternoon sun with real shadows: boxes need shade to read as a city rather than a grid.
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const hemi = new THREE.HemisphereLight(0xfff1d6, 0x9a8468, 1.2); scene.add(hemi);
const torch = new THREE.SpotLight(0xfff0c8, 0, 34, 0.5, 0.7, 0.45); scene.add(torch, torch.target); // your flashlight
const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
const SUN_DIR = V3(0.38, 0.9, 0.24).normalize(); // high enough to drop light into the alleys
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

// Outside it is a late afternoon. Inside the pile it is always dusk.
const ENV = {
  yard: { color: 0xa9d6ee, near: 25, far: 62, sky: 0xfff1d6, ground: 0x9a8468, hemi: 1.2, sun: 0xfff0d8, sunI: 2.3, torch: 0 },
  city: { color: 0x2b2749, near: 4, far: 46, sky: 0x9296dc, ground: 0x4d4258, hemi: 1.0, sun: 0xb4bcff, sunI: 0.8, torch: 3.2 },
};
let viewDist = 50;
function setEnv(name) {
  const e = ENV[name];
  scene.fog.color.setHex(e.color); scene.background.setHex(e.color);
  scene.fog.near = e.near; scene.fog.far = e.far; viewDist = e.far;
  hemi.color.setHex(e.sky); hemi.groundColor.setHex(e.ground); hemi.intensity = e.hemi;
  sun.color.setHex(e.sun); sun.intensity = e.sunI; torch.intensity = e.torch;
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
  // kind: 0 cosmetic, 1 your water, 2 balloon, 3 another kid's water
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
          if (kind[i] !== 2) game.waterHitsBlock(Math.floor(x), Math.floor(y), Math.floor(z), team[i], kind[i] === 1, x - v[j] * dt, y - v[j + 1] * dt, z - v[j + 2] * dt);
        } else for (const a of game.actors) {
          if (a.team === team[i] || !a.targetable()) continue;
          const dx = a.pos.x - x, dz = a.pos.z - z, rr = a.r + 0.16;
          if (dx * dx + dz * dz < rr * rr && y > a.pos.y && y < a.pos.y + a.h) {
            done = true; if (kind[i] !== 2) game.waterHitsActor(a, team[i], kind[i] === 1, x, y, z); break;
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
const { loot, flaps, signs, towers, shops, standees, ramps, doors } = generate(world);
const fx = new Fx();
const soggyBlue = new THREE.Color(0x27356b);

const player = {
  pos: V3(PLACES.start.x, 0, PLACES.start.z), vel: V3(), r: 0.3, h: 1.4, onGround: false, blocked: false,
  team: 0, yaw: 0, pitch: 0, face: 0, // yaw is where the camera looks, face is where your kid is turned
  water: 0, tank: 60, wetness: 0, sinceHit: 99, caps: 0, pocket: 0, card: 4, balloons: 2, decoys: 2,
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
  mode: 'menu', time: 0, guards: [], notes: [], lamps: [], doors: [], notesRead: 0, district: -1, checkpoint: null, lock: null, ended: false, actors: [player], items: [], flags: [], pools: [], allies: [], broken: [], goalSel: null, stage: 0, graceT: 0, flash: 0, won: false, marketOpen: false,
  nearPlayer(p, d) { const dx = p.x - player.pos.x, dz = p.z - player.pos.z; return dx * dx + dz * dz < d * d; },
  freeSpot(x, z, range, avoid = 0) {
    for (let n = 0; n < 80; n++) {
      const cx = Math.floor(x + (Math.random() * 2 - 1) * range), cz = Math.floor(z + (Math.random() * 2 - 1) * range);
      if (Math.abs(cx - Math.floor(x)) < avoid && Math.abs(cz - Math.floor(z)) < avoid) continue;
      if (cx < 3 || cz < 3 || cx > CITY - 4 || cz > CITY - 4) continue;
      if (PLACES.forts.some(f => Math.abs(cx - f.x) <= 2 && Math.abs(cz - f.z) <= 2)) continue; // never inside a sealed keep
      if (!world.solid(cx, 0, cz) && !world.solid(cx, 1, cz)) return { x: cx + 0.5, z: cz + 0.5 };
    }
    return { x: x + 0.5, z: z + 0.5 };
  },
  waterHitsBlock(x, y, z, team, byPlayer, px, py, pz) {
    world.soak(x, y, z, byPlayer ? (player.pump ? 0.5 : 0.34) : 0.25, byPlayer);
    if (Math.random() < 0.6) fx.burst(px, py, pz, 2, 0x8fd0ff, 3, 0.08);
  },
  waterHitsActor(a, team, byPlayer, x, y, z) {
    fx.burst(x, y, z, 3, 0xbfe4ff, 3, 0.08);
    if (a === player) player.hit(7); else a.hit(byPlayer ? (player.pump ? 34 : 25) : 20, team, byPlayer);
  },
  balloonPop(x, y, z, team) {
    const R = 2.3, cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    for (let yy = cy - 2; yy <= cy + 2; yy++) for (let zz = cz - 3; zz <= cz + 3; zz++) for (let xx = cx - 3; xx <= cx + 3; xx++)
      if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 + (zz + 0.5 - z) ** 2 < R * R) world.soak(xx, yy, zz, 1.5, team === 0);
    for (const a of game.actors) {
      if (a.team === team || !a.targetable()) continue;
      if (a.pos.distanceTo(V3(x, y - 0.5, z)) < 3.4) a === player ? player.hit(30) : a.hit(70, team, team === 0);
    }
    fx.burst(x, y, z, 40, 0x8fd0ff, 9, 0.14);
    sfx('pop', V3(x, y, z));
  },
  kidSoaked(kid, byPlayer) {
    if (byPlayer && kid.team > 0) { addItem('caps', kid.pos.x, kid.pos.y, kid.pos.z, 2); toast(`Soaked one of the ${TEAM_NAME[kid.team]}. They dropped caps.`); }
  },
  // where a kid with an empty squirter goes: a pool their side holds, or all the way back to base
  refillSpot(kid) {
    let best = null, bd = 1e9;
    for (const q of game.pools) { const d = Math.hypot(q.x - kid.pos.x, q.z - kid.pos.z); if (q.owner === kid.team && d < bd) { bd = d; best = q; } }
    return best ? { x: best.x, z: best.z, secs: 1.5 } : { x: kid.base.x, z: kid.base.z, secs: 7 };
  },
  hunting(team) { return game.flags.some(f => f.team === team && f.state === 'carried'); },
  goosed(goose, dx, dz) {
    player.vel.x += dx * 9; player.vel.z += dz * 9; player.vel.y = 4;
    if (player.hasGun && player.water > 0) { player.water = Math.max(0, player.water - 8); toast('HONK. The goose knocked water out of your tank.'); }
    sfx('thunk');
  },
  playerSoaked() {
    const lost = player.pocket; player.pocket = 0;
    for (const f of game.flags) if (f.state === 'carried') { f.state = 'home'; f.mesh.visible = true; }
    toast('Soaked through. You wake up at the last pool, dry. You don\'t remember walking there.');
    fade(() => {
      const c = game.checkpoint || PLACES.citySpawn; player.pos.set(c.x, 0, c.z); player.vel.set(0, 0, 0); player.pitch = 0;
      player.wetness = 0; player.water = Math.max(player.water, player.tank / 2);
    });
    game.graceT = 4;
  },
};
world.onBreak = (x, y, z, byPlayer) => {
  fx.burst(x + 0.5, y + 0.5, z + 0.5, 7, 0x6b4a2c, 4, 0.16);
  sfx('crumble', V3(x, y, z));
  if (byPlayer && Math.random() < 0.4) player.card++;
  if (z < CITY && world.orig[world.idx(x, y, z)] === T.CARD && game.broken.length < 4000) game.broken.push({ x, y, z, t: game.time });
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
const unitBox = new THREE.BoxGeometry(1, 1, 1), unitPlane = new THREE.PlaneGeometry(1, 1);
const paint = (w, h, draw) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
};
// the upper floors: big crooked boxes stacked on the buildings, far too tall for a backyard
const towerMesh = new THREE.InstancedMesh(unitBox, world.cardMat, towers.length);
towerMesh.castShadow = towerMesh.receiveShadow = true; towerMesh.frustumCulled = false;
towers.forEach((t, i) => {
  dummy.rotation.set(t.tilt, t.yaw, t.tilt * 0.7); dummy.position.set(t.x, t.y0 + t.h / 2 - 0.25, t.z);
  dummy.scale.set(t.w, t.h, t.d); dummy.updateMatrix();
  towerMesh.setMatrixAt(i, dummy.matrix); towerMesh.setColorAt(i, tone.setRGB(1, 1, 1));
});
scene.add(towerMesh);
{ // open box flaps along the tops of buildings
  const mesh = new THREE.InstancedMesh(unitBox, kraft, flaps.length);
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  flaps.forEach((f, i) => {
    const depth = 0.75 + (i % 5) * 0.12;
    dummy.rotation.set(-f.a, Math.atan2(f.dx, f.dz), 0);
    dummy.position.set(f.x + f.dx * Math.cos(f.a) * depth / 2, f.y + Math.sin(f.a) * depth / 2, f.z + f.dz * Math.cos(f.a) * depth / 2);
    dummy.scale.set(f.len, 0.05, depth); dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tone.setHex([0xc9a26b, 0xb98f58, 0xd3ae76][i % 3]));
    if (f.sup) hang(f.sup, () => { mesh.setMatrixAt(i, ZERO); mesh.instanceMatrix.needsUpdate = true; });
  });
  scene.add(mesh);
}
{ // flattened boxes trampled into the lawn, at every angle
  const N = 420, mesh = new THREE.InstancedMesh(unitBox, kraft, N);
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
// hand-lettered signs
const INK = ['#c23b2e', '#2a2018', '#2f5fb5', '#2a7a45'];
const signCache = new Map();
function signMat(text, big) {
  if (signCache.has(text)) return signCache.get(text);
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
  const m = new THREE.MeshLambertMaterial({ map: tex }); signCache.set(text, m); return m;
}
// A flat thing stuck on a wall. It stays only while every cell behind it is still cardboard.
function stick(geo, mat, w, h, d, x, y, z, dx, dz, sups, tiltX = 0, roll = 0) {
  if (sups.some(c => world.get(...c) !== T.CARD)) return;
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(tiltX, Math.atan2(dx, dz), roll, 'YXZ');
  m.receiveShadow = true; m.castShadow = d > 0.5; scene.add(m);
  for (const c of sups) hang(c, () => { m.visible = false; });
}
{
  const WORDS = ['KEEP OUT', 'NO GROWN-UPS', 'SECRET HQ', 'PASSWORD?', 'MY HOUSE', 'JAIL', 'NO GEESE', 'HOTEL', 'DO NOT MELT', 'LAB', 'DEAD END', 'THIS WAY'];
  signs.forEach((sg, i) => {
    const w = sg.big ? 3.4 : 1.7;
    stick(unitPlane, signMat(sg.text || WORDS[i % WORDS.length], sg.big), w, w * 0.375, 1, sg.x + sg.dx * 0.03, sg.y, sg.z + sg.dz * 0.03, sg.dx, sg.dz, [sg.sup], 0, (i % 7 - 3) * (sg.big ? 0.012 : 0.03));
  });
}
{ // fake shopfronts: a painted door that doesn't open, a painted window, an awning and a name
  const NAMES = ['PIZZA', 'ARCADE', 'PET SHOP', 'CANDY', 'TOYS', 'COMICS', 'ICE CREAM', 'BARBER', 'CINEMA', 'DONUTS'];
  const AWN = [0xd9483b, 0x2f7fb5, 0x3fa35c, 0xe8a13a, 0x8a4fd1].map(c => new THREE.MeshLambertMaterial({
    color: c, map: paint(64, 8, g => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff' : '#b9b9b9'; g.fillRect(i * 8, 0, 8, 8); } }),
  }));
  const door = new THREE.MeshLambertMaterial({ map: paint(128, 256, g => {
    g.fillStyle = '#6f4a31'; g.fillRect(0, 0, 128, 256); g.strokeStyle = '#2a2018'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 252);
    g.lineWidth = 4; g.strokeRect(22, 24, 84, 84); g.strokeRect(22, 132, 84, 96);
    g.fillStyle = '#e8c74a'; g.beginPath(); g.arc(102, 124, 8, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#f4ead2'; g.fillRect(34, 46, 60, 30); g.fillStyle = '#c23b2e'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('OPEN', 64, 69);
  }) });
  const pane = new THREE.MeshLambertMaterial({ map: paint(192, 128, g => {
    g.fillStyle = '#bfe0ee'; g.fillRect(0, 0, 192, 128); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(20, 100); g.lineTo(70, 20); g.moveTo(50, 110); g.lineTo(90, 46); g.stroke();
    g.strokeStyle = '#2a2018'; g.lineWidth = 9; g.strokeRect(4, 4, 184, 120); g.lineWidth = 5; g.beginPath(); g.moveTo(96, 4); g.lineTo(96, 124); g.moveTo(4, 64); g.lineTo(188, 64); g.stroke();
  }) });
  shops.forEach((sh, i) => {
    const at = (k, out) => [sh.x + sh.ax * k + sh.dx * out, sh.z + sh.az * k + sh.dz * out];
    const cell = (k, y) => [sh.sx + sh.ax * k, y, sh.sz + sh.az * k];
    let [x, z] = at(0, 0.03);
    stick(unitPlane, door, 1, 1.9, 1, x, 0.95, z, sh.dx, sh.dz, [cell(0, 0), cell(0, 1)]);
    for (const k of [-2, 2]) { [x, z] = at(k, 0.03); stick(unitPlane, pane, 1.5, 1.05, 1, x, 1.45, z, sh.dx, sh.dz, [cell(k, 1)]); }
    [x, z] = at(0, 0.04); stick(unitPlane, signMat(NAMES[sh.kind], true), 3.3, 1.15, 1, x, 3.5, z, sh.dx, sh.dz, [cell(0, 3)], 0, (i % 5 - 2) * 0.012);
    [x, z] = at(0, 0.5); stick(unitBox, AWN[i % AWN.length], 4.4, 0.06, 1.05, x, 2.62, z, sh.dx, sh.dz, [cell(0, 2)], 0.33);
  });
}

// ------------------------------------------------------------------ street life: a kid's idea of a city
const skyline = new THREE.Group(); scene.add(skyline); // hidden until you crawl into the pile
const lam = c => new THREE.MeshLambertMaterial({ color: c }), glow = c => new THREE.MeshBasicMaterial({ color: c });
const tubeGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
function prop(parent, geo, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
{
  // the road: painted cardboard with a taped centre line
  const road = paint(64, 256, g => {
    g.fillStyle = '#5d554c'; g.fillRect(0, 0, 64, 256); g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 60; i++) g.fillRect((i * 37) % 64, (i * 91) % 256, 6, 2);
    g.fillStyle = '#e9dcc0'; g.fillRect(2, 0, 3, 256); g.fillRect(59, 0, 3, 256);
    g.fillStyle = '#f2c94a'; g.fillRect(30, 20, 4, 90); g.fillRect(30, 150, 4, 90);
  });
  road.wrapS = road.wrapT = THREE.RepeatWrapping;
  const strip = (w, len, x, z, turn) => {
    const t = road.clone(); t.needsUpdate = true; t.repeat.set(1, len / 8);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), new THREE.MeshLambertMaterial({ map: t }));
    m.rotation.set(-Math.PI / 2, 0, turn ? Math.PI / 2 : 0); m.position.set(x, 0.036, z); m.receiveShadow = true; scene.add(m);
  };
  strip(4, 22, 65, 115, false);

  // parked cars: boxes with wheels drawn on. You can climb on them but not walk through them.
  const paintJob = [0xd9483b, 0x2f7fb5, 0xe8c74a, 0x3fa35c, 0xe07b39].map(lam), tyre = lam(0x1f1b1a), glass = lam(0xbfe0ee);
  LEVEL.cars.forEach(([x, z], c) => {
    const g = new THREE.Group(); g.position.set(x + 0.5, 0, z + 1.5); g.rotation.z = (c - 2) * 0.012;
    prop(g, unitBox, paintJob[c % 5], 0.96, 0.62, 2.9, 0, 0.56, 0); prop(g, unitBox, paintJob[c % 5], 0.9, 0.5, 1.4, 0, 1.1, 0.15);
    prop(g, unitBox, glass, 0.92, 0.36, 1.1, 0, 1.12, 0.15); prop(g, unitBox, glow(0xfff2b0), 0.7, 0.14, 0.04, 0, 0.62, -1.46);
    for (const [wx, wz] of [[-0.5, -0.95], [0.5, -0.95], [-0.5, 0.95], [0.5, 0.95]]) prop(g, tubeGeo, tyre, 0.62, 0.1, 0.62, wx, 0.31, wz, 0, 0, Math.PI / 2);
    scene.add(g);
    for (let k = 0; k < 3; k++) world.set(x, 0, z + k, T.GHOST);
  });

  // streetlights along the route. In Lights Out most of them are dead.
  const tubeMat = lam(0x8f7650), dark = lam(0x2a2422);
  const halo = paint(64, 64, g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,225,150,1)'); r.addColorStop(0.3, 'rgba(255,200,110,.45)'); r.addColorStop(1, 'rgba(255,190,90,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  for (const l of LEVEL.lamps) {
    prop(scene, tubeGeo, tubeMat, 0.13, 3.8, 0.13, l.x, 1.9, l.z);
    prop(scene, unitBox, tubeMat, 0.1 + Math.abs(l.dx) * 0.8, 0.1, 0.1 + Math.abs(l.dz) * 0.8, l.x + l.dx * 0.4, 3.75, l.z + l.dz * 0.4);
    const hx = l.x + l.dx * 0.8, hz = l.z + l.dz * 0.8;
    const bulb = prop(scene, unitBox, new THREE.MeshBasicMaterial({ color: l.dead ? 0x4a4338 : 0xffe9a0 }), 0.34, 0.24, 0.34, hx, 3.6, hz); bulb.castShadow = false;
    if (l.dead) continue;
    const sm = new THREE.SpriteMaterial({ map: halo, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(sm); sp.position.set(hx, 3.5, hz); sp.scale.set(4.5, 4.5, 1); scene.add(sp);
    const pm = new THREE.MeshBasicMaterial({ map: halo, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
    const pool = new THREE.Mesh(unitPlane, pm); pool.rotation.x = -Math.PI / 2; pool.position.set(hx, 0.06, hz); pool.scale.set(8, 8, 1); scene.add(pool);
    game.lamps.push({ sm, pm, bulb, seed: game.lamps.length * 7.3, flicker: game.lamps.length % 5 === 2 });
  }
  // chalk arrows on the ground, in case you get turned around
  const chalk = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, map: paint(64, 128, g => {
    g.strokeStyle = '#f4ead2'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(32, 118); g.lineTo(32, 16); g.moveTo(10, 46); g.lineTo(32, 14); g.lineTo(54, 46); g.stroke();
  }) });
  for (const a of LEVEL.arrows) { const m = new THREE.Mesh(unitPlane, chalk); m.rotation.set(-Math.PI / 2, a.yaw, 0, 'YXZ'); m.position.set(a.x, 0.045, a.z); m.scale.set(0.8, 1.6, 1); scene.add(m); }
  // vending boxes by each pool: somebody trades caps through the slot. You never see who.
  for (const v of LEVEL.vendors) {
    prop(scene, unitBox, lam(0xa9743f), 1.1, 2, 0.8, v.x, 1, v.z); prop(scene, unitBox, glow(0xffd98a), 0.7, 0.16, 0.05, v.x, 1.05, v.z + 0.41);
    prop(scene, unitPlane, signMat('CAPS FOR STUFF', true), 1.05, 0.4, 1, v.x, 1.6, v.z + 0.42).castShadow = false;
    world.set(Math.floor(v.x), 0, Math.floor(v.z), T.GHOST); world.set(Math.floor(v.x), 1, Math.floor(v.z), T.GHOST);
  }
  // signs over the gates
  LEVEL.gates.forEach((g, i) => {
    const along = g.x1 > g.x0, t = signMat(LEVEL.districts[i + 1].name.toUpperCase(), true);
    for (const s of [-1, 1]) prop(scene, unitPlane, t, 3.4, 1.2, 1, g.x + (along ? 0 : s * 0.56), 4.1, g.z + (along ? s * 0.56 : 0), 0, along ? (s > 0 ? 0 : Math.PI) : s * Math.PI / 2).castShadow = false;
  });
  // Milo's notes: pages torn from a school notebook, stuck on sticks
  const page = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: paint(128, 96, g => {
    g.fillStyle = '#fff6d8'; g.fillRect(0, 0, 128, 96); g.strokeStyle = '#9fc0e8'; g.lineWidth = 2;
    for (let y = 22; y < 96; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
    g.strokeStyle = '#3b3b6b'; g.lineWidth = 3; for (let y = 28; y < 84; y += 14) { g.beginPath(); g.moveTo(12, y); g.lineTo(60 + (y * 7) % 50, y + 1); g.stroke(); }
  }) });
  LEVEL.notes.forEach((n, i) => {
    const g = new THREE.Group(); g.position.set(n.x, 0, n.z); scene.add(g);
    prop(g, tubeGeo, tubeMat, 0.05, 1, 0.05, 0, 0.5, 0); const m = prop(g, unitPlane, page, 0.6, 0.45, 1, 0, 1.15, 0); m.castShadow = false;
    game.notes.push({ ...n, i, g, read: false });
  });
  { const g = new THREE.Group(); g.position.set(PLACES.crate.x + 0.9, 0, PLACES.crate.z); scene.add(g); // the crate with his spare squirter on it
    prop(g, unitBox, tubeMat, 0.8, 0.6, 0.8, 0, 0.3, 0); game.spare = [prop(g, unitBox, lam(0x35c46a), 0.12, 0.12, 0.42, 0, 0.67, 0), prop(g, unitBox, lam(0xff8a2a), 0.14, 0.14, 0.2, 0, 0.78, 0.06)]; }

  // planks and bunting strung between the towers, far over your head
  const firsts = towers.filter(t => t.base), plank = lam(0xb98f58), string = lam(0x3a302a), spans = [];
  for (let i = 0; i < firsts.length; i++) for (let j = i + 1; j < firsts.length && spans.length < 70; j++) {
    const a = firsts[i], b = firsts[j], d = Math.hypot(a.x - b.x, a.z - b.z), y = Math.min(a.y0 + a.h, b.y0 + b.h) - 1 - ((i * 7 + j) % 3);
    if (d < 6 || d > 13 || y < 7 || (i * 13 + j * 7) % 5 > 1) continue;
    spans.push({ a, b, d, y, bunting: (i + j) % 2 === 0 });
  }
  for (const z of [80, 94, 108, 122]) spans.push({ a: { x: 61.5, z }, b: { x: 68.5, z: z + 1 }, d: 7.1, y: 5.2, bunting: true }); // over the main street
  const pennants = new THREE.InstancedMesh(new THREE.BufferGeometry().setFromPoints([V3(-0.18, 0, 0), V3(0.18, 0, 0), V3(0, -0.42, 0)]),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), spans.length * 12);
  pennants.frustumCulled = false; let np = 0;
  const FLAGC = [0xd9483b, 0xf2c94a, 0x35a7c4, 0x3fa35c, 0x8a4fd1, 0xf4f1ea];
  for (const sp of spans) {
    const ry = Math.atan2(sp.b.x - sp.a.x, sp.b.z - sp.a.z), mx = (sp.a.x + sp.b.x) / 2, mz = (sp.a.z + sp.b.z) / 2;
    if (!sp.bunting) { prop(skyline, unitBox, plank, 0.9, 0.07, sp.d, mx, sp.y, mz, 0, ry); continue; }
    prop(skyline, unitBox, string, 0.03, 0.03, sp.d, mx, sp.y, mz, 0, ry).castShadow = false;
    for (let k = 1; k < 12; k++) {
      const f = k / 12; dummy.position.set(sp.a.x + (sp.b.x - sp.a.x) * f, sp.y - 0.02 - Math.sin(f * Math.PI) * 0.25, sp.a.z + (sp.b.z - sp.a.z) * f);
      dummy.rotation.set(0, ry + Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      pennants.setMatrixAt(np, dummy.matrix); pennants.setColorAt(np++, tone.setHex(FLAGC[(k + np) % FLAGC.length]));
    }
  }
  pennants.count = np; skyline.add(pennants);

  // rooftops: water tanks on stilts and bent aerials
  towers.forEach((t, i) => {
    if (!t.top) return;
    const y = t.y0 + t.h - 0.25;
    if (i % 4 === 0) {
      prop(skyline, tubeGeo, tubeMat, 1.7, 1.5, 1.7, t.x, y + 1.75, t.z); prop(skyline, new THREE.ConeGeometry(0.5, 1, 10), lam(0x8c4a3c), 2, 0.7, 2, t.x, y + 2.85, t.z);
      for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) prop(skyline, unitBox, dark, 0.1, 1, 0.1, t.x + lx, y + 0.5, t.z + lz);
    } else if (i % 4 === 1) {
      prop(skyline, unitBox, dark, 0.06, 3.2, 0.06, t.x + 0.6, y + 1.6, t.z - 0.4, 0, 0, 0.08);
      prop(skyline, unitBox, dark, 0.9, 0.05, 0.05, t.x + 0.5, y + 2.6, t.z - 0.4); prop(skyline, unitBox, dark, 0.6, 0.05, 0.05, t.x + 0.45, y + 3, t.z - 0.4);
    }
  });

  // the sky: a cardboard sun and clouds hung on strings
  const hung = (draw, n, size, tint) => {
    const map = paint(256, 512, g => { g.strokeStyle = '#3a302a'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 330); g.stroke(); g.lineJoin = 'round'; draw(g); });
    const mat = new THREE.SpriteMaterial({ map, fog: false, color: tint });
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(mat), a = i * 2.4 + size, r = 18 + (i * 29) % 50;
      sp.position.set(64 + Math.cos(a) * r, 34 + (i * 13) % 16, 64 + Math.sin(a) * r); sp.scale.set(size, size * 2, 1); skyline.add(sp);
    }
  };
  hung(g => { // cloud
    g.fillStyle = '#f4ead2'; g.strokeStyle = '#2a2018'; g.lineWidth = 7; g.beginPath();
    g.arc(70, 410, 46, 2, 5); g.arc(118, 370, 52, 3.4, 5.6); g.arc(176, 392, 46, 4.2, 6.6); g.arc(190, 440, 36, 5.6, 8.2); g.lineTo(60, 472); g.closePath(); g.fill(); g.stroke();
  }, 13, 13, 0x8d86b5);
  hung(g => { // sun
    g.fillStyle = '#f2c94a'; g.strokeStyle = '#2a2018'; g.lineWidth = 7;
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(128 + Math.cos(a) * 78, 400 + Math.sin(a) * 78); g.lineTo(128 + Math.cos(a) * 112, 400 + Math.sin(a) * 112); g.stroke(); }
    g.beginPath(); g.arc(128, 400, 66, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#2a2018'; g.beginPath(); g.arc(106, 388, 6, 0, 7); g.arc(150, 388, 6, 0, 7); g.fill(); g.lineWidth = 5; g.beginPath(); g.arc(128, 404, 30, 0.4, 2.7); g.stroke();
  }, 1, 26, 0xff9d5c); // a sun that never quite sets
}

// ------------------------------------------------------------------ ramps, stairs and doors
{
  // A wedge that rises toward +x from h0 to h1; turned to face the cell's uphill direction.
  const wedge = (h0, h1) => {
    const A = [-.5, 0, -.5], B = [.5, 0, -.5], C = [.5, 0, .5], D = [-.5, 0, .5], E = [-.5, h0, -.5], F = [.5, h1, -.5], G = [.5, h1, .5], H = [-.5, h0, .5];
    const tris = [A, B, C, A, C, D, E, H, G, E, G, F, B, F, G, B, G, C, A, D, H, A, H, E, A, F, B, A, E, F, D, C, G, D, G, H];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3)); g.computeVertexNormals(); return g;
  };
  const geos = [wedge(0, 1), wedge(0, 0.5), wedge(0.5, 1)], tones = [0xc9a26b, 0xb98f58, 0xd3ae76].map(c => new THREE.MeshLambertMaterial({ color: c })), step = new THREE.MeshLambertMaterial({ color: 0xa9804c });
  ramps.forEach((r, i) => {
    const g = new THREE.Group(); g.position.set(r.x + 0.5, r.y, r.z + 0.5); g.rotation.y = -r.dir * Math.PI / 2; scene.add(g);
    if (r.stairs) { // three box steps, with a darker tread so they read as stairs
      for (let k = 0; k < 3; k++) { const h = (k + 1) / 3, w = 1 - k / 3; prop(g, unitBox, tones[i % 3], w, h, 1, 0.5 - w / 2, h / 2, 0); prop(g, unitBox, step, 1 / 3, 0.03, 1, -0.5 + k / 3 + 1 / 6, h + 0.012, 0).castShadow = false; }
    } else { const m = new THREE.Mesh(geos[r.part], tones[i % 3]); m.castShadow = m.receiveShadow = true; g.add(m); }
    hang([r.x, r.y, r.z], () => { g.visible = false; });
  });
  // Doors are a flap of cardboard on a tape hinge. Walk into one and it swings away from you.
  const face = new THREE.MeshLambertMaterial({ map: paint(128, 256, g => {
    g.fillStyle = '#c9a26b'; g.fillRect(0, 0, 128, 256); g.strokeStyle = '#2a2018'; g.lineWidth = 7; g.strokeRect(5, 5, 118, 246);
    g.lineWidth = 4; g.strokeRect(24, 26, 80, 70); g.strokeRect(24, 120, 80, 100);
    g.beginPath(); g.arc(100, 132, 9, 0, 7); g.stroke(); g.fillStyle = '#f2e3b8'; g.fillRect(0, 30, 10, 26); g.fillRect(0, 190, 10, 26);
    g.fillStyle = '#2a2018'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('PUSH', 64, 68);
  }) });
  for (const d of doors) {
    const pivot = new THREE.Group(); pivot.position.set(d.horiz ? d.x : d.x + 0.5, 0, d.horiz ? d.z + 0.5 : d.z); pivot.rotation.y = d.horiz ? 0 : -Math.PI / 2; scene.add(pivot);
    prop(pivot, unitBox, face, 0.96, 1.94, 0.06, 0.5, 0.97, 0);
    const door = { ...d, cx: d.x + 0.5, cz: d.z + 0.5, pivot, base: pivot.rotation.y, angle: 0, open: false, dir: 1, t: 0, gone: false };
    for (const y of [0, 1]) hang([d.x, y, d.z], () => { if (door.gone) return; door.gone = true; pivot.visible = false; world.set(d.x, 0, d.z, T.AIR); world.set(d.x, 1, d.z, T.AIR); });
    game.doors.push(door);
  }
}
function updateDoors(dt) {
  for (const d of game.doors) {
    if (d.gone || (!d.open && Math.abs(d.angle) < 0.01 && !game.nearPlayer({ x: d.cx, z: d.cz }, 30))) continue;
    let push = 0;
    for (const a of game.actors) {
      if (a.isDecoy || a.out > 0 || Math.abs(a.pos.x - d.cx) > 1.25 || Math.abs(a.pos.z - d.cz) > 1.25 || a.pos.y > 1.5) continue;
      push = (d.horiz ? a.pos.z - d.cz : a.pos.x - d.cx) > 0 ? 1 : -1; break;
    }
    if (push) {
      if (!d.open) { d.open = true; d.dir = d.horiz ? push : -push; world.set(d.x, 0, d.z, T.AIR); world.set(d.x, 1, d.z, T.AIR); sfx('thunk', tmp.set(d.cx, 1, d.cz)); }
      d.t = 1.4;
    } else if (d.open && (d.t -= dt) <= 0) { d.open = false; world.set(d.x, 0, d.z, T.FLAP); world.set(d.x, 1, d.z, T.FLAP); }
    d.angle += ((d.open ? d.dir * 1.5 : 0) - d.angle) * Math.min(1, dt * 9);
    d.pivot.rotation.y = d.base + d.angle;
  }
}

// ------------------------------------------------------------------ cardboard cut-out kids
// They draw fire. The tribes' ones fool you and each other; yours fool them.
const TEAM_COL = { '-1': 0xe9dcc0, 0: 0x35a7c4, 1: 0xd9483b, 2: 0x8a4fd1, 3: 0x3fa35c };
const TEAM_NAME = { 0: 'your team', 1: 'Box Knights', 2: 'Alley Pirates', 3: 'Dino Scouts' };
const standeeMats = [0, 1, 2, 3].map(team => {
  const map = paint(128, 192, g => {
    const col = '#' + TEAM_COL[team].toString(16).padStart(6, '0');
    g.lineJoin = 'round'; g.strokeStyle = '#2a2018'; g.lineWidth = 6; g.fillStyle = '#c9a26b';
    const part = f => { g.beginPath(); f(); g.fill(); g.stroke(); };
    part(() => g.rect(42, 126, 18, 60)); part(() => g.rect(68, 126, 18, 60));      // legs
    part(() => g.rect(86, 70, 34, 14)); part(() => g.rect(108, 58, 16, 14));       // arm and squirter
    part(() => g.roundRect(36, 62, 56, 70, 10));                                   // body
    part(() => g.arc(64, 36, 25, 0, 7));                                           // head
    g.strokeStyle = col; g.lineWidth = 7; g.beginPath();
    for (let y = 74; y < 126; y += 11) { g.moveTo(44, y); g.lineTo(84, y + 6); } g.stroke(); // crayon shirt
    g.fillStyle = '#2a2018'; g.beginPath(); g.arc(55, 32, 3.5, 0, 7); g.arc(73, 32, 3.5, 0, 7); g.fill();
    g.strokeStyle = '#2a2018'; g.lineWidth = 3; g.beginPath(); g.arc(64, 40, 9, 0.3, 2.8); g.stroke();
  });
  return { face: new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }),
    depth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 }) };
});
const tmp = V3();
class Decoy {
  constructor(x, y, z, yaw, team) {
    this.pos = V3(x, y, z); this.r = 0.32; this.h = 1.3; this.team = team; this.wet = 0; this.out = 0; this.fall = 0; this.isDecoy = true; this.dead = false;
    this.pivot = new THREE.Group(); this.pivot.rotation.order = 'YXZ'; this.pivot.position.copy(this.pos); this.pivot.rotation.y = yaw;
    const m = new THREE.Mesh(unitPlane, standeeMats[team].face); m.customDepthMaterial = standeeMats[team].depth;
    m.scale.set(0.9, 1.35, 1); m.position.y = 0.675; m.castShadow = true; this.pivot.add(m); scene.add(this.pivot);
  }
  targetable() { return this.out <= 0; }
  hit(amount) { if (this.out > 0) return; this.wet += amount; if (this.wet >= 50) { this.out = 1; sfx('crumble', this.pos); } }
  update(dt) {
    if (this.out <= 0) {
      if (this.team === 0 || game.mode !== 'city') return;
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 40 || d < 0.1) return;
      // Is the camera looking this way? If not, turn to face you. Some of them take a step.
      camera.getWorldDirection(tmp);
      const cx = this.pos.x - camera.position.x, cz = this.pos.z - camera.position.z, cd = Math.hypot(cx, cz) || 1;
      if ((cx * tmp.x + cz * tmp.z) / cd > 0.3) return;
      const want = Math.atan2(dx, dz); let diff = want - this.pivot.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.pivot.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.2);
      if (this.creeper && d > 2 && d < 32) {
        const nx = this.pos.x + dx / d * dt * 1.7, nz = this.pos.z + dz / d * dt * 1.7;
        if (!world.solidAt(nx, 0.5, nz) && !world.solidAt(nx, 1.2, nz)) { this.pos.x = nx; this.pos.z = nz; this.pivot.position.copy(this.pos); }
      }
      return;
    }
    this.fall += dt * 2.5; this.pivot.rotation.x = Math.min(1.5, this.fall);
    if (this.fall < 4) return;
    if (this.team === 0) { scene.remove(this.pivot); this.dead = true; return; }
    // the tribes prop theirs back up once nobody is looking
    this.pivot.visible = false;
    if (this.fall > 150 && !game.nearPlayer(this.pos, 20)) { this.out = 0; this.wet = 0; this.fall = 0; this.pivot.rotation.x = 0; this.pivot.visible = true; }
  }
}
for (const sd of standees) game.actors.push(new Decoy(sd.x, 0, sd.z, sd.yaw, sd.team));
for (const c of LEVEL.creepers) { const d = new Decoy(c.x, 0, c.z, 0, 2); d.creeper = true; game.actors.push(d); }

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

PLACES.pools.forEach((p, i) => {
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.34, 20), new THREE.MeshLambertMaterial({ color: 0xe86a8a }));
  pool.position.set(p.x, 0.17, p.z); pool.receiveShadow = true; scene.add(pool);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.36, 20), new THREE.MeshBasicMaterial({ color: 0x4fb4ff }));
  water.position.set(p.x, 0.17, p.z); scene.add(water);
  // a pennant says whose pool it is
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
  pole.position.set(p.x + 2.7, 1.7, p.z); scene.add(pole);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.05), new THREE.MeshLambertMaterial({ color: TEAM_COL[p.owner] }));
  cloth.position.set(p.x + 3.25, 3, p.z); scene.add(cloth);
  game.pools.push({ ...p, i, cloth, capTeam: -1, capT: 0 });
});

function makeFlag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
  pole.position.y = 1.15; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.04), new THREE.MeshLambertMaterial({ color }));
  cloth.position.set(0.4, 1.95, 0); g.add(cloth);
  scene.add(g); return g;
}
PLACES.forts.forEach((f, i) => {
  const mesh = makeFlag(f.color); mesh.position.set(f.x + 0.5, 0, f.z + 0.5);
  game.flags.push({ ...f, mesh, state: 'home', home: V3(f.x + 0.5, 0, f.z + 0.5), yard: PLACES.yard[i], stealT: 0 });
  // banners on the fort towers so you can tell whose turf it is
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const b = makeFlag(f.color); b.position.set(f.x + sx * 10 + 0.5, 10, f.z + sz * 10 + 0.5); }
  $('flags').children[i].style.setProperty('--c', '#' + f.color.toString(16).padStart(6, '0'));
});

const COSTUME = [null, { costume: 'knight', shirt: 0xd9483b }, { costume: 'pirate', shirt: 0x8a4fd1 }, { costume: 'dino', shirt: 0x3fa35c }];
const addActor = a => { game.actors.push(a); return a; };
// Each tribe: three guards who stay in the fort, three raiders the tribe sends around the city.
const tribes = PLACES.forts.map((f, i) => ({ ...f, t: 25 + i * 14, guards: [], raiders: [] }));
for (const tr of tribes) for (let i = 0; i < 6; i++) {
  const court = { x: tr.x + (tr.x < 64 ? 6 : -6) + 0.5, z: tr.z + 0.5 }, raider = i >= 3;
  const post = raider ? { x: 64 + (tr.x - 64) * 0.45 + (i - 4) * 8, z: 64 + (tr.z - 64) * 0.45 + (4 - i) * 8 } : court;
  const s = game.freeSpot(post.x, post.z, 6);
  const k = addActor(new Kid(game, { ...COSTUME[tr.team], team: tr.team, x: s.x, z: s.z }));
  k.base = court; k.home = post; k.range = raider ? 8 : 7;
  (raider ? tr.raiders : tr.guards).push(k);
}
// Your team. One friend goes out to guard each pool you hold.
const ALLY_NAMES = ['Juno', 'Bea', 'Tomás', 'Ike'];
function postAlly(pool, quiet) {
  let k = game.allies.find(a => !a.post);
  if (!k && game.allies.length < ALLY_NAMES.length) {
    const s = game.freeSpot(PLACES.respawn.x, PLACES.respawn.z, 3);
    k = addActor(new Kid(game, { team: 0, costume: 'cape', shirt: 0x35a7c4, x: s.x, z: s.z }));
    k.base = { x: PLACES.respawn.x, z: PLACES.respawn.z }; k.name = ALLY_NAMES[game.allies.length]; game.allies.push(k);
  }
  if (!k) return;
  k.post = pool; k.home = { x: pool.x, z: pool.z }; k.range = 4; k.goal = null;
  if (quiet) { const s = game.freeSpot(pool.x, pool.z, 3); k.pos.set(s.x, 0, s.z); } else toast(`${k.name} heads out to guard it.`);
}
function setPoolOwner(pool, team) {
  const old = pool.owner; pool.owner = team; pool.capT = 0; pool.capTeam = -1;
  pool.cloth.material.color.setHex(TEAM_COL[team]);
  if (team === 0) { toast(`You hold the ${pool.name}. Refill here, and box it in before they come back.`); sfx('win'); postAlly(pool); }
  else if (old === 0) {
    toast(`The ${TEAM_NAME[team]} took your ${pool.name}!`); sfx('empty');
    const k = game.allies.find(a => a.post === pool); if (k) { k.post = null; k.home = k.base; k.goal = null; }
  }
}

// ---- territory: stand in a pool with nobody else's side around and it becomes yours
function updatePools(dt) {
  if (STORY) return; // in the story, pools are just checkpoints
  let showing = null;
  for (const pool of game.pools) {
    let mask = 0, one = -1;
    for (const a of game.actors) {
      if (a.team < 0 || a.isDecoy) continue;
      if (a === player ? (game.mode !== 'city' || game.graceT > 0) : a.out > 0) continue;
      if (a.pos.y < 2 && Math.hypot(a.pos.x - pool.x, a.pos.z - pool.z) < 3.6) { mask |= 1 << a.team; one = a.team; }
    }
    if (mask && !(mask & (mask - 1)) && one !== pool.owner) {
      if (pool.capTeam !== one) { pool.capTeam = one; pool.capT = 0; }
      if ((pool.capT += dt) >= 5) setPoolOwner(pool, one);
    } else pool.capT = Math.max(0, pool.capT - dt * 2);
    if (pool.capT > 0 && (pool.capTeam === 0 || pool.owner === 0) && game.nearPlayer(pool, 30)) showing = pool;
  }
  const el = $('capbar'); el.hidden = !showing;
  if (showing) {
    $('capname').textContent = showing.capTeam === 0 ? `Taking the ${showing.name}` : `The ${TEAM_NAME[showing.capTeam]} are taking your ${showing.name}!`;
    el.querySelector('i').style.width = showing.capT / 5 * 100 + '%';
  }
}

// ---- the city pushes back
function director(dt) {
  if (game.mode !== 'city' || game.stage < 3) return;
  for (const tr of tribes) {
    if ((tr.t -= dt) > 0) continue;
    tr.t = 40 + Math.random() * 25;
    const flag = game.flags[tr.team - 1];
    let tx, tz, range = 3, msg = null;
    if (flag.state === 'captured') { [tx, tz] = flag.yard; range = 2; msg = `The ${tr.name} are coming to steal their flag back!`; }
    else { // raid a pool they don't hold, usually the nearest
      const c = game.pools.filter(q => q.owner !== tr.team).sort((a, b) => Math.hypot(a.x - tr.x, a.z - tr.z) - Math.hypot(b.x - tr.x, b.z - tr.z));
      if (!c.length) continue;
      const q = c[Math.random() < 0.65 || c.length < 2 ? 0 : 1]; tx = q.x; tz = q.z;
      if (q.owner === 0) msg = `The ${tr.name} are heading for your ${q.name}.`;
    }
    for (const k of tr.raiders) { k.home = { x: tx, z: tz }; k.range = range; k.goal = null; }
    if (msg) toast(msg);
  }
  for (const fl of game.flags) if (fl.state === 'captured') { // a flag in your yard can be taken back
    const thief = game.actors.some(a => a.team === fl.team && !a.isDecoy && a.out <= 0 && Math.hypot(a.pos.x - fl.yard[0], a.pos.z - fl.yard[1]) < 1.8);
    fl.stealT = thief ? fl.stealT + dt : 0;
    if (fl.stealT > 3) { fl.state = 'home'; fl.stealT = 0; fl.mesh.position.copy(fl.home); toast(`The ${fl.name} stole their flag back!`); sfx('empty'); }
  }
}
// Tribes re-tape the walls you melted, unless you're standing there or you hold the pool nearby.
let rebuildT = 0;
function rebuild(dt) {
  if (STORY) return;
  if ((rebuildT -= dt) > 0 || game.mode !== 'city') return;
  rebuildT = 0.4;
  const B = game.broken;
  for (let n = Math.min(30, B.length); n > 0; n--) {
    const b = B.shift();
    if (world.get(b.x, b.y, b.z) !== T.AIR) continue;
    const busy = game.time - b.t < 45 || game.nearPlayer(b, 18) || game.pools.some(q => q.owner === 0 && Math.hypot(q.x - b.x, q.z - b.z) < 12)
      || game.actors.some(a => Math.abs(a.pos.x - b.x - 0.5) < 0.9 && Math.abs(a.pos.z - b.z - 0.5) < 0.9 && a.pos.y < b.y + 1 && a.pos.y + a.h > b.y);
    if (busy) { B.push(b); continue; }
    world.set(b.x, b.y, b.z, T.CARD); break;
  }
}

const brother = addActor(new Kid(game, { team: -1, still: true, costume: 'brother', shirt: 0x6b6b7a, pants: 0x2f2f38, scale: 1.45, gun: false, x: 63.1, z: 210.4, yaw: Math.PI }));
const milo = addActor(new Kid(game, { team: -1, still: true, costume: 'cape', shirt: 0x35a7c4, x: 66.5, z: 66.5, yaw: -Math.PI / 2, gun: false }));
milo.pos.y = 7.05;
const keeper = addActor(new Kid(game, { team: -1, still: true, costume: 'apron', shirt: 0xe07b39, gun: false, x: PLACES.shop.x, z: PLACES.shop.z, yaw: -Math.PI / 2 }));
keeper.pos.y = 7.05; keeper.say('CAPS FOR STUFF', 1e9);
const animalAt = (kind, x, z, r = 6) => { const s = game.freeSpot(x, z, r); addActor(new Animal(game, kind, s.x, s.z)); };
animalAt('dog', 64, 114, 3);
animalAt('cat', 40, 112); animalAt('cat', 12, 60); animalAt('cat', 60, 14); animalAt('cat', 110, 40);
animalAt('goose', 17, 78, 3); animalAt('goose', 112, 50, 3); animalAt('goose', 84, 57, 3);
// the kids who hold each gate. Soak one and they're gone for good.
for (const gd of LEVEL.guards) {
  const k = addActor(new Kid(game, { ...COSTUME[gd.team], team: gd.team, x: gd.x, z: gd.z }));
  k.noRespawn = true; k.range = 4; k.district = gd.district; game.guards.push(k);
}
// lookouts on the high ground. They don't hold a gate; they just make the low road expensive.
for (const lo of LEVEL.lookouts) {
  const k = addActor(new Kid(game, { ...COSTUME[lo.team], team: lo.team, x: lo.x, z: lo.z }));
  k.pos.y = lo.y + 0.05; k.noRespawn = true; k.perch = true; k.district = -1;
}

// you, seen from over your shoulder
const avatar = makeKid({ shirt: 0x2f6fd0, pants: 0x4a4038, costume: 'none' });
{
  const u = avatar.userData, b = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: c })); m.scale.set(w, h, d); m.position.set(x, y, z); avatar.add(m); return m; };
  b(0.3, 0.36, 0.16, 0, 0.66, 0.2, 0xff8a2a); b(0.4, 0.1, 0.44, 0, 1.27, 0, 0xe2553f); b(0.36, 0.05, 0.2, 0, 1.23, -0.28, 0xe2553f); // water pack, red cap
  u.pole = b(0.04, 1.5, 0.04, 0.16, 1.2, 0.3, 0xe8dcc0); u.cloth = b(0.5, 0.34, 0.03, 0.42, 1.74, 0.3, 0xffffff); // a captured flag rides on your back
  avatar.traverse(o => { if (o.isMesh) o.castShadow = true; });
  avatar.visible = false; scene.add(avatar);
}
const CAM = { dist: TOUCH ? 4.8 : 4, cur: 4, side: 0, y: 0 }, pivot = V3(), back = V3();
function updateCamera(dt) {
  const p = player.pos, cp = Math.cos(player.pitch), sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  back.set(sy * cp, -Math.sin(player.pitch), cy * cp);
  // sit over the right shoulder when there's room, tuck in behind the head in a narrow alley
  const roomy = !world.solidAt(p.x + cy * 0.85, p.y + 1.4, p.z - sy * 0.85);
  CAM.side += ((roomy && !TOUCH ? 0.5 : 0) - CAM.side) * Math.min(1, dt * 8);
  CAM.y = Math.abs(p.y - CAM.y) > 3 ? p.y : CAM.y + (p.y - CAM.y) * Math.min(1, dt * 7); // don't bob with every hop
  pivot.set(p.x + cy * CAM.side, CAM.y + (TOUCH ? 1.85 : 1.6), p.z - sy * CAM.side);
  const h = world.raycast(pivot, back, CAM.dist + 0.35, 0.05);
  const want = h ? Math.max(0.2, h.dist - 0.35) : CAM.dist;
  CAM.cur = want < CAM.cur ? want : Math.min(want, CAM.cur + dt * 5);
  camera.position.copy(pivot).addScaledVector(back, CAM.cur);
  camera.rotation.set(player.pitch, player.yaw, 0);
  const fs = Math.sin(player.face), fc = Math.cos(player.face);
  torch.position.set(p.x - fs * 0.3, p.y + 1.15, p.z - fc * 0.3);
  torch.target.position.set(p.x - fs * 10, p.y + 0.6, p.z - fc * 10);

  const u = avatar.userData, sp = Math.hypot(player.vel.x, player.vel.z);
  avatar.visible = CAM.cur > 0.9; avatar.position.copy(p); avatar.rotation.y = player.face;
  player.walk = (player.walk || 0) + sp * dt * 3.2;
  const sw = Math.sin(player.walk) * Math.min(1, sp / 2) * 0.7;
  u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw; u.armR.rotation.x = 1.45 + (TOUCH ? 0 : player.pitch);
  u.bodyMat.color.copy(u.shirt).lerp(soggyBlue, Math.min(0.75, player.wetness / 110));
  for (const m of u.gunParts) m.visible = player.hasGun;
  const carried = game.flags.find(f => f.state === 'carried');
  u.pole.visible = u.cloth.visible = !!carried; if (carried) u.cloth.material.color.setHex(carried.color);
}

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
  if (TOUCH) $('cross').hidden = true;
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
    player.pos.set(PLACES.citySpawn.x, 0, PLACES.citySpawn.z); player.vel.set(0, 0, 0); player.yaw = player.face = 0; player.pitch = 0;
    subs.length = 0; subT = 0;
    showHud(); titleCard('Cardboard City', 'It was a pile of boxes a second ago.');
    say('', 'It is bigger in here than the whole backyard. And later. The sky is the colour of almost dinner time.', 5);
    say('', 'No Milo. There is something on a box up ahead.', 3.5);
  };
  if (instant) { initAudio(); go(); canvas.focus(); } else fade(go);
}
function readNote(n) {
  n.read = true; n.g.visible = false; game.notesRead++; sfx('pick');
  say('Milo\'s note', n.text, 3.5 + n.text.length * 0.045);
  if (n.i === 0) {
    game.stage = 3; player.hasGun = true; player.water = player.tank; for (const m of game.spare) m.visible = false;
    toast(TOUCH ? 'Got a squirter. Hold squirt: it aims at the kid in the ring, or melts the wall in front of you.' : 'Got a squirter. Hold click to spray. Walls melt.');
  }
}
// What each district says to you as you walk in, and as its gate gives way.
const ARRIVE = [
  'A wall of taped boxes shuts the street. Somebody has drawn windows on everything.',
  'The alleys squeeze in. The cut-outs here have faces. You are fairly sure that one was looking the other way.',
  'No pools in this part. Somewhere far above the clouds, somebody is playing music.',
  'The streetlights are dead past the gate. Your flashlight is not very big.',
  'A real tree. Real wood. It is the only thing in here that was not made by a kid.',
];
const OPENED = [
  'The last Knight runs off. The gate swings open by itself. Nobody is behind it.',
  'The Pirates are gone. On the gate somebody has written a date. It is next Thursday.',
  'The Scouts scatter. Far overhead a voice says "...ten minutes!" The clouds sway a little.',
  'The night shift is over. The tube through the wall is open, and there is light at the end of it.',
];
function storyTick() {
  const p = player.pos;
  for (const n of game.notes) if (!n.read) {
    n.g.rotation.y += 0.02;
    if (Math.hypot(n.x - p.x, n.z - p.z) < 1.7 && Math.abs(p.y) < 2) readNote(n);
  }
  const d = districtAt(p.x, p.z);
  if (d !== game.district) {
    game.district = d;
    if (d > 0 || game.stage >= 3) { titleCard(LEVEL.districts[d].name, '', 2.6); say('', ARRIVE[d], 5); }
  }
  LEVEL.gates.forEach((g, i) => {
    if (g.open || game.stage < 3 || game.guards.some(k => k.district === g.district && k.out <= 0)) return;
    g.open = true; for (let y = 0; y < 3; y++) for (let z = g.z0; z <= g.z1; z++) for (let x = g.x0; x <= g.x1; x++) world.set(x, y, z, T.AIR);
    sfx('win'); say('', OPENED[i], 5.5);
  });
  if (player.safe && !game.ended) {
    game.ended = true;
    subs.length = 0; subT = 0;
    say('Milo', 'You came! ...What day is it?', 3.5);
    say('Milo', 'I\'ve been here since Tuesday. I think. They keep building. It was a pile of boxes on Tuesday.', 5.5);
    say('Milo', 'They made a cut-out of me. Look over there. They\'ve started one of you.', 5);
    say('Big brother', '(from somewhere above the clouds) DINNER!', 3.5);
    say('Milo', '...Did you hear that? He says that every day. It is never dinner.', 5);
    game.actors.push(new Decoy(68.5, 7, 68.5, -2.4, 0));
    setTimeout(() => titleCard('To be continued', `You found ${game.notesRead} of ${LEVEL.notes.length} notes.`, 8), 20000);
  }
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
    if (LEVEL.vendors.some(v => near(v.x, v.z, 2.7)) || (player.safe && near(PLACES.shop.x, PLACES.shop.z, 3.4))) return { label: 'Trade bottle caps', fn: openMarket };
  }
  return null;
}

// ------------------------------------------------------------------ market
const SHOP = [
  { name: 'Backpack tank', note: 'Carry 60 more water', cost: 6, can: () => player.tankLvl < 2, buy() { player.tankLvl++; player.tank += 60; player.water = player.tank; } },
  { name: 'Pump-action pressure', note: 'Shoots further, melts walls in two hits', cost: 8, can: () => !player.pump, buy() { player.pump = true; } },
  { name: 'Raincoat', note: 'You get soaked a lot slower', cost: 7, can: () => !player.coat, buy() { player.coat = true; } },
  { name: 'Water balloons ×3', note: 'One balloon opens a whole wall', cost: 4, can: () => true, buy() { player.balloons += 3; } },
  { name: 'Cardboard you ×2', note: 'A cut-out kid. They shoot it instead of you', cost: 3, can: () => true, buy() { player.decoys += 2; } },
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
// The war map: choose what the compass points at before you head out.
function renderTargets() {
  const opts = [{ name: 'Nearest flag', sel: null }];
  for (const f of game.flags) if (f.state === 'home') opts.push({ name: `${f.name} flag`, sel: { name: `${f.name} flag`, x: f.home.x, z: f.home.z, live: () => f.state === 'home' } });
  for (const q of game.pools) if (q.owner !== 0) opts.push({ name: `${q.name} (${q.owner < 0 ? 'nobody\'s' : TEAM_NAME[q.owner]})`, sel: { name: q.name, x: q.x, z: q.z, live: () => q.owner !== 0 } });
  $('targets').replaceChildren(...opts.map((o, i) => {
    const b = document.createElement('button'); b.id = 'target-' + i; b.textContent = o.name;
    b.setAttribute('aria-pressed', (game.goalSel?.name || null) === (o.sel?.name || null));
    b.onclick = () => { game.goalSel = o.sel; renderTargets(); };
    return b;
  }));
}
function openMarket() { game.marketOpen = true; $('market').hidden = false; renderShop(); if (document.pointerLockElement) document.exitPointerLock(); input.fire = false; }
function closeMarket() { game.marketOpen = false; $('market').hidden = true; canvas.focus(); }
$('market-close').onclick = closeMarket;

// ------------------------------------------------------------------ input
const input = { keys: new Set(), fire: false, mx: 0, mz: 0, lookAt: -9 };
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
  if (e.code === 'KeyX') placeDecoy();
});
addEventListener('keyup', e => input.keys.delete(e.code));
addEventListener('blur', () => { input.keys.clear(); input.fire = false; });
const look = (dx, dy, k) => { input.lookAt = game.time; player.yaw -= dx * k; player.pitch = clamp(player.pitch - dy * k, -1.45, 1.45); };
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
    if (!firing && stickId === null && e.clientX < innerWidth * 0.5) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      const r = $('ui').getBoundingClientRect(); stick.style.left = sx - r.left + 'px'; stick.style.top = sy - r.top + 'px'; stick.hidden = false;
    } else { looks.set(e.pointerId, { x: e.clientX, y: e.clientY, firing }); input.looking = true; }
    if (firing) input.fire = true;
  };
  canvas.addEventListener('pointerdown', e => down(e, false));
  $('b-fire').addEventListener('pointerdown', e => { $('b-fire').setPointerCapture(e.pointerId); down(e, true); });
  addEventListener('pointermove', e => {
    if (e.pointerId === stickId) {
      let dx = (e.clientX - sx) / 56, dy = (e.clientY - sy) / 56; const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      $('knob').style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      const live = m > 0.18; input.mx = live ? dx : 0; input.mz = live ? dy : 0; // small dead zone so a resting thumb stands still
    }
    const l = looks.get(e.pointerId);
    if (l) { look(e.clientX - l.x, e.clientY - l.y, 0.006); l.x = e.clientX; l.y = e.clientY; }
  });
  const up = e => {
    if (e.pointerId === stickId) { stickId = null; input.mx = input.mz = 0; stick.hidden = true; $('knob').style.transform = ''; }
    const l = looks.get(e.pointerId); if (l) { if (l.firing) input.fire = false; looks.delete(e.pointerId); input.looking = looks.size > 0; }
  };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  $('b-jump').addEventListener('pointerdown', e => { e.preventDefault(); input.keys.add('Space'); setTimeout(() => input.keys.delete('Space'), 200); });
  $('b-block').addEventListener('pointerdown', e => { e.preventDefault(); placeBox(); });
  $('b-balloon').addEventListener('pointerdown', e => { e.preventDefault(); throwBalloon(); });
  $('b-decoy').addEventListener('pointerdown', e => { e.preventDefault(); placeDecoy(); });
}
$('start-intro').onclick = startIntro;
$('start-skip').onclick = () => enterCity(true);

// ------------------------------------------------------------------ player actions
const fwd = V3(), eye = V3();
// Aim where the crosshair points, but shoot from the squirter in your hand.
let aimDist = 20, flip = false;
const yawDiff = (dx, dz) => { const d = Math.atan2(-dx, -dz) - player.yaw; return Math.atan2(Math.sin(d), Math.cos(d)); };
// The kid you are roughly facing. On a phone this cone is wide and the squirter fires at them by itself.
function findLock() {
  const p = player.pos, cone = TOUCH ? 1.0 : 0.14; let best = null, ba = cone;
  for (const a of game.actors) {
    if (a.team <= 0 || a.isDecoy || !a.targetable()) continue;
    const dx = a.pos.x - p.x, dz = a.pos.z - p.z, d = Math.hypot(dx, dz);
    if (d > 15 || d < 0.3) continue;
    const ang = Math.abs(yawDiff(dx, dz)) + d * 0.01 - (a === game.lock ? 0.35 : 0); // stick with whoever you're already on
    if (ang < ba && world.los(p.x, p.y + 1.2, p.z, a.pos.x, a.pos.y + 0.8, a.pos.z)) { ba = ang; best = a; }
  }
  return best;
}
function aim() {
  camera.getWorldDirection(fwd);
  const p = player.pos, sy = Math.sin(player.face), cy = Math.cos(player.face);
  let tx, ty, tz; const lk = game.lock;
  if (lk) { tx = lk.pos.x; ty = lk.pos.y + lk.h * 0.6; tz = lk.pos.z; }
  else if (TOUCH) {
    // No crosshair on a phone: you squirt the way your kid is facing. A wall straight ahead gets opened
    // at walking height, one cell at your feet and one above.
    flip = !flip; tmp.set(p.x, p.y + (flip ? 0.5 : 1.5), p.z); back.set(-sy, 0, -cy);
    const h = world.raycast(tmp, back, 7, 0.1);
    if (h && world.get(h.x, h.y, h.z) === T.CARD) { tx = h.x + 0.5; ty = h.y + 0.5; tz = h.z + 0.5; }
    else { tx = p.x - sy * 9; ty = p.y + 0.9; tz = p.z - cy * 9; }
  } else {
    const h = world.raycast(camera.position, fwd, 45, 0.12), d = h ? Math.max(h.dist, CAM.cur + 1.5) : 45;
    tx = camera.position.x + fwd.x * d; ty = camera.position.y + fwd.y * d; tz = camera.position.z + fwd.z * d;
  }
  eye.set(p.x - sy * 0.4 + cy * 0.28, p.y + 0.95, p.z - cy * 0.4 - sy * 0.28);
  fwd.set(tx - eye.x, ty - eye.y, tz - eye.z); aimDist = fwd.length(); fwd.normalize();
}
let fireAcc = 0, emptyT = 0;
function squirt(dt) {
  if (!input.fire && !input.keys.has('KeyF')) { fireAcc = 0; return; }
  if (!player.hasGun || game.mode !== 'city') return;
  if (player.safe) { toast('No squirting in the Treehouse. That\'s the rule.'); return; }
  if (player.water <= 0) { if ((emptyT -= dt) <= 0) { emptyT = 0.4; sfx('empty'); toast('Tank\'s empty. Find a kiddie pool.'); } return; }
  fireAcc += dt * 13;
  aim();
  const speed = player.pump ? 30 : 23, lift = 0.5 * WATER_GRAV * Math.min(aimDist, 18) / speed; // lob it so it lands on the crosshair
  while (fireAcc >= 1 && player.water > 0) {
    fireAcc -= 1; player.water -= 1;
    const s = 0.9;
    fx.spawn(eye.x + fwd.x * 0.3, eye.y + fwd.y * 0.3, eye.z + fwd.z * 0.3,
      fwd.x * speed + (Math.random() - 0.5) * s, fwd.y * speed + lift + (Math.random() - 0.5) * s, fwd.z * speed + (Math.random() - 0.5) * s,
      1.7, 0x5fb8ff, 0.13, 1, 0);
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
function placeDecoy() {
  if (game.mode !== 'city' || player.safe) return;
  if (player.decoys <= 0) { toast('No cut-outs left. The Treehouse sells them.'); return; }
  const p = player.pos, x = p.x - Math.sin(player.face) * 1.5, z = p.z - Math.cos(player.face) * 1.5;
  if (world.solidAt(x, p.y + 0.4, z) || world.solidAt(x, p.y + 1.1, z)) { toast('No room to stand it up there.'); return; }
  player.decoys--; game.actors.push(new Decoy(x, p.y, z, player.face, 0)); sfx('thunk');
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
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw), carrying = game.flags.some(fl => fl.state === 'carried'), speed = carrying ? 4.3 : 5.3; // a flag is heavy
  const wx = (-sin * f + cos * s) * speed, wz = (-cos * f - sin * s) * speed, a = Math.min(1, dt * 14);
  player.vel.x += (wx - player.vel.x) * a; player.vel.z += (wz - player.vel.z) * a;
  const turn = (to, rate) => { const d = Math.atan2(Math.sin(to - player.face), Math.cos(to - player.face)); player.face += d * Math.min(1, dt * rate); };
  const moving = Math.hypot(f, s) > 0.1, firing = player.hasGun && (input.fire || k.has('KeyF'));
  const lk = game.lock;
  if (firing && lk) turn(Math.atan2(-(lk.pos.x - p.x), -(lk.pos.z - p.z)), 18);      // squirting: face whoever you're aimed at
  else if (firing && !TOUCH) turn(player.yaw, 18);                                    // or, with a mouse, wherever the crosshair is
  else if (moving) turn(Math.atan2(-wx, -wz), 12);                                    // otherwise face the way you're running
  // Nobody steering the camera? Let it swing round behind you. Running straight at it leaves it alone.
  const handsOff = TOUCH ? !input.looking && game.time - input.lookAt > 0.6 : document.pointerLockElement !== canvas && game.time - input.lookAt > 1.2;
  if (handsOff && game.mode !== 'menu') {
    const d = Math.atan2(Math.sin(player.face - player.yaw), Math.cos(player.face - player.yaw));
    if (moving) player.yaw += Math.sin(d) * Math.min(1, Math.hypot(f, s)) * 1.05 * dt; // gentle: holding sideways is a wide arc, not a spin
    if (firing && lk) player.yaw += d * Math.min(1, dt * 2.5);
    player.pitch += ((TOUCH ? -0.2 : -0.1) - player.pitch) * Math.min(1, dt * 1.5);
  }
  if (k.has('Space') && player.onGround) { player.vel.y = JUMP; player.onGround = false; }
  moveActor(world, player, dt);
  if (game.mode === 'intro') { p.x = clamp(p.x, 50, 79); p.z = clamp(p.z, 175.5, 222.5); }

  player.sinceHit += dt; game.graceT -= dt;
  const wasSafe = player.safe;
  player.safe = game.mode === 'city' && p.y >= 6.9 && p.x > 57 && p.x < 72 && p.z > 57 && p.z < 72;
  if (player.safe && player.hasGun) player.water = Math.min(player.tank, player.water + 40 * dt); // the rain barrel
  if ((player.sinceHit > 2.5 && !carrying) || player.safe) player.wetness = Math.max(0, player.wetness - (player.safe ? 30 : 4) * dt);

  if (game.mode === 'intro' && game.stage === 2 && p.z < 181.6 && Math.abs(p.x - 64.5) < 0.8) { game.stage = 2.5; enterCity(false); }
  if (game.mode === 'city') {
    storyTick();
    game.lock = player.hasGun ? findLock() : null;
    // pools
    for (const q of game.pools) if (p.y < 0.6 && Math.hypot(p.x - q.x, p.z - q.z) < 2.4 && player.hasGun) {
      if (q.owner !== 0) { if (player.water < player.tank * 0.5 && q.capT < 0.2) toast('Not your pool. Hold it alone for a few seconds to take it.'); continue; }
      if (game.checkpoint !== q) { game.checkpoint = q; toast(`${q.name}. If you get soaked, this is where you wake up.`); }
      if (player.water >= player.tank) continue;
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
        toast(`You grabbed the ${fl.name} flag. It's heavy, and they're all coming. Get it home!`);
      } else if (fl.state === 'carried' && (player.safe || Math.hypot(p.x - fl.yard[0], p.z - fl.yard[1]) < 3.5)) {
        fl.state = 'captured'; fl.mesh.visible = true; fl.mesh.position.set(fl.yard[0], 0, fl.yard[1]); sfx('win');
        const n = game.flags.filter(x => x.state === 'captured').length;
        if (n === 3 && !game.won) { game.won = true; titleCard('The city is yours', 'All three flags stand in the Treehouse yard. Now keep them there.', 7); }
        else toast(`${fl.name} flag planted in the yard. ${3 - n} to go. They'll try to take it back.`);
      }
    }
  }
  updateCamera(dt);
}

function updateHud() {
  $('watern').textContent = `${Math.ceil(player.water)} / ${player.tank}`;
  $('waterbar').firstChild.style.width = (player.hasGun ? player.water / player.tank * 100 : 0) + '%';
  $('wetbar').firstChild.style.width = Math.min(100, player.wetness) + '%';
  $('caps').textContent = player.caps + (player.pocket ? ` +${player.pocket}` : ''); $('decoys').textContent = player.decoys; $('boxes').textContent = player.card; $('balloons').textContent = player.balloons;
  $('notes').textContent = `${game.notesRead}/${LEVEL.notes.length}`;
  game.flash = Math.max(0, game.flash - 0.03);
  $('wetflash').style.opacity = Math.max(game.flash, player.wetness > 70 ? (player.wetness - 70) / 60 : 0);
  // the compass points at whatever stands between you and the next gate
  let tx = PLACES.respawn.x, tz = PLACES.respawn.z, name = 'The Treehouse';
  const dn = districtAt(player.pos.x, player.pos.z), gt = LEVEL.gates[dn];
  if (game.stage < 3) { tx = PLACES.crate.x; tz = PLACES.crate.z; name = 'Something on a box'; }
  else if (gt && !gt.open) {
    let best = null, bd = 1e9;
    for (const k of game.guards) if (k.district === dn && k.out <= 0) { const d = Math.hypot(k.pos.x - player.pos.x, k.pos.z - player.pos.z); if (d < bd) { bd = d; best = k; } }
    const left = game.guards.filter(k => k.district === dn && k.out <= 0).length;
    if (best) { tx = best.pos.x; tz = best.pos.z; name = `${LEVEL.districts[dn].who} hold the gate · ${left} left`; }
  } else if (gt) { tx = gt.x; tz = gt.z; name = 'The gate is open'; }
  // the ring on the kid you're locked on to
  const lk = game.lock, ring = $('lock');
  if (lk && playing()) {
    tmp.set(lk.pos.x, lk.pos.y + lk.h * 0.6, lk.pos.z).project(camera);
    ring.hidden = tmp.z > 1; ring.style.left = (tmp.x * 0.5 + 0.5) * canvas.clientWidth + 'px'; ring.style.top = (-tmp.y * 0.5 + 0.5) * canvas.clientHeight + 'px';
  } else ring.hidden = true;
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
    camera.position.set(64.5 + Math.cos(a) * 8.5, 8.4, 64.5 + Math.sin(a) * 8.5); camera.lookAt(64.5 + Math.cos(a) * 30, 11, 64.5 + Math.sin(a) * 30); // looking out from the Treehouse
  } else if (!game.marketOpen) { updatePlayer(dt); squirt(dt); }
  let gone = false;
  for (const a of game.actors) if (a !== player) { a.update(dt); gone ||= a.dead; }
  if (gone) game.actors = game.actors.filter(a => !a.dead);
  updatePools(dt); director(dt); rebuild(dt); updateDoors(dt);
  for (const l of game.lamps) { // lamps breathe; a few are on their way out
    const f = l.flicker ? (Math.sin(game.time * 23 + l.seed) > 0.2 || Math.sin(game.time * 3.1 + l.seed) > 0.6 ? 1 : 0.15) : 0.9 + 0.1 * Math.sin(game.time * 2 + l.seed);
    l.sm.opacity = f; l.pm.opacity = 0.55 * f;
  }
  towerMesh.visible = skyline.visible = game.mode !== 'intro';
  if (game.mode === 'menu') avatar.visible = false; // the backyard is an ordinary backyard until you crawl in
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
window.__cc = { game, player, world, step, input, PLACES, LEVEL, enterCity, startIntro };
