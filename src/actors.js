// Kids, animals and the shared walking physics.
import * as THREE from '../vendor/three.module.min.js';

export const GRAV = 22, JUMP = 7.4, WATER_GRAV = 14;

// Axis-separated AABB movement against the voxel grid. e: {pos, vel, r, h, onGround, blocked}
export function moveActor(world, e, dt) {
  const p = e.pos, r = e.r;
  const hit = (x, y, z) => !world.boxFree(x - r, y + 0.001, z - r, x + r, y + e.h, z + r);
  e.vel.y -= GRAV * dt;
  e.blocked = false;
  const nx = p.x + e.vel.x * dt;
  if (hit(nx, p.y, p.z)) e.blocked = true; else p.x = nx;
  const nz = p.z + e.vel.z * dt;
  if (hit(p.x, p.y, nz)) e.blocked = true; else p.z = nz;
  const ny = p.y + e.vel.y * dt;
  if (hit(p.x, ny, p.z)) {
    if (e.vel.y < 0) { p.y = Math.max(0, Math.floor(ny) + 1); e.onGround = true; }
    e.vel.y = 0;
  } else { p.y = ny; e.onGround = false; }
  // hop up one-box steps on its own
  if (e.blocked && e.onGround) {
    const sp = Math.hypot(e.vel.x, e.vel.z);
    if (sp > 0.5) {
      const ax = p.x + e.vel.x / sp * 0.45, az = p.z + e.vel.z / sp * 0.45;
      if (!hit(p.x, p.y + 1.05, p.z) && !hit(ax, p.y + 1.05, az)) { e.vel.y = JUMP; e.onGround = false; e.blocked = false; }
    }
  }
}

const matCache = new Map();
const mat = c => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c })); return matCache.get(c); };
const unit = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(0.5, 1, 4);
const ball = new THREE.SphereGeometry(0.5, 14, 10);
const tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const torso = new THREE.CylinderGeometry(0.4, 0.5, 1, 12);
function part(parent, geo, w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? mat(color) : color);
  m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m;
}
function box(parent, w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(unit, typeof color === 'number' ? mat(color) : color);
  m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m;
}
function spike(parent, s, x, y, z, color, rx = 0) {
  const m = new THREE.Mesh(cone, mat(color)); m.scale.set(s, s * 1.4, s); m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}

const SKINS = [0xf2c9a0, 0xd9a273, 0xa8724a, 0x7a4e2e, 0xf7d9b8];
const KRAFT = 0xc9a26b;

// Kids are soft and round; only their costumes are made of boxes. Local -z is forward.
export function makeKid({ shirt = 0x4f7fd9, pants = 0x3b4a6b, costume = 'none', scale = 1, gun = true }) {
  const g = new THREE.Group();
  const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
  const bodyMat = new THREE.MeshLambertMaterial({ color: shirt });
  const legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  legL.position.set(-0.11, 0.4, 0); legR.position.set(0.11, 0.4, 0);
  part(legL, tube, 0.17, 0.4, 0.17, 0, -0.2, 0, pants); part(legR, tube, 0.17, 0.4, 0.17, 0, -0.2, 0, pants);
  part(g, torso, 0.46, 0.46, 0.34, 0, 0.63, 0, bodyMat);
  armL.position.set(-0.29, 0.82, 0); armR.position.set(0.29, 0.82, 0);
  part(armL, tube, 0.13, 0.4, 0.13, 0, -0.18, 0, bodyMat); part(armR, tube, 0.13, 0.4, 0.13, 0, -0.18, 0, bodyMat);
  part(armL, ball, 0.13, 0.13, 0.13, 0, -0.4, 0, skin); part(armR, ball, 0.13, 0.13, 0.13, 0, -0.4, 0, skin);
  const head = new THREE.Group(); head.position.set(0, 1.05, 0);
  part(head, ball, 0.42, 0.4, 0.42, 0, 0.02, 0, skin);
  part(head, ball, 0.06, 0.08, 0.04, -0.09, 0.04, -0.195, 0x1c1c1c); part(head, ball, 0.06, 0.08, 0.04, 0.09, 0.04, -0.195, 0x1c1c1c);
  if (gun) {
    armR.rotation.x = 1.35;
    g.userData.gunParts = [box(armR, 0.09, 0.3, 0.12, 0, -0.42, 0.06, 0x35c46a), box(armR, 0.1, 0.12, 0.16, 0, -0.34, 0.16, 0xff8a2a)];
  }
  if (costume === 'knight') {
    box(head, 0.48, 0.48, 0.48, 0, 0.02, 0, KRAFT); box(head, 0.34, 0.08, 0.02, 0, 0.04, -0.25, 0x241a12);
    box(g, 0.42, 0.62, 0.04, 0, 0.52, 0.17, shirt);
  } else if (costume === 'pirate') {
    box(head, 0.56, 0.06, 0.56, 0, 0.2, 0, 0x1f1b24); box(head, 0.36, 0.16, 0.3, 0, 0.3, 0, 0x1f1b24);
    box(head, 0.12, 0.1, 0.02, 0.09, 0.03, -0.2, 0x111111);
    box(g, 0.46, 0.08, 0.28, 0, 0.5, 0, 0xf2e9d8);
  } else if (costume === 'dino') {
    box(head, 0.42, 0.2, 0.44, 0, 0.14, 0.02, 0x2f8a4a); box(head, 0.42, 0.44, 0.08, 0, 0.0, 0.2, 0x2f8a4a);
    spike(head, 0.14, 0, 0.3, -0.06, 0xf2c94a); spike(head, 0.14, 0, 0.3, 0.12, 0xf2c94a);
    spike(g, 0.12, 0, 0.75, 0.2, 0xf2c94a, 0.9); spike(g, 0.22, 0, 0.45, 0.32, 0x2f8a4a, 1.6);
  } else if (costume === 'cape') {
    box(g, 0.44, 0.7, 0.04, 0, 0.5, 0.17, 0xe8c74a); box(head, 0.4, 0.1, 0.4, 0, 0.2, 0, 0xe8c74a);
  } else if (costume === 'apron') {
    box(g, 0.36, 0.5, 0.03, 0, 0.6, -0.15, 0xf2e9d8); box(head, 0.4, 0.1, 0.5, 0, 0.2, -0.06, 0x3b6ea8);
  } else if (costume === 'brother') {
    box(head, 0.42, 0.06, 0.1, 0, 0.2, 0, 0x222222); box(head, 0.06, 0.16, 0.14, -0.21, 0.02, 0, 0x222222); box(head, 0.06, 0.16, 0.14, 0.21, 0.02, 0, 0x222222);
  }
  g.add(legL, legR, armL, armR, head);
  g.scale.setScalar(scale);
  g.userData = { ...g.userData, legL, legR, armL, armR, head, bodyMat, shirt: new THREE.Color(shirt) };
  return g;
}

function makeAnimal(kind) {
  const g = new THREE.Group();
  const legs = [];
  const leg = (x, z, h, c) => { const l = new THREE.Group(); l.position.set(x, h, z); box(l, 0.08, h, 0.08, 0, -h / 2, 0, c); g.add(l); legs.push(l); };
  if (kind === 'dog') {
    box(g, 0.3, 0.3, 0.7, 0, 0.45, 0, 0xb5793f); box(g, 0.28, 0.28, 0.3, 0, 0.66, -0.42, 0xb5793f);
    box(g, 0.14, 0.12, 0.16, 0, 0.6, -0.62, 0x6b4423); box(g, 0.08, 0.16, 0.04, -0.12, 0.8, -0.36, 0x6b4423); box(g, 0.08, 0.16, 0.04, 0.12, 0.8, -0.36, 0x6b4423);
    box(g, 0.07, 0.07, 0.3, 0, 0.62, 0.45, 0xb5793f);
    for (const [x, z] of [[-0.1, -0.25], [0.1, -0.25], [-0.1, 0.25], [0.1, 0.25]]) leg(x, z, 0.3, 0x8f5d2e);
  } else if (kind === 'cat') {
    box(g, 0.2, 0.2, 0.5, 0, 0.3, 0, 0x33312f); box(g, 0.22, 0.2, 0.2, 0, 0.42, -0.3, 0x33312f);
    spike(g, 0.07, -0.07, 0.56, -0.3, 0x33312f); spike(g, 0.07, 0.07, 0.56, -0.3, 0x33312f);
    box(g, 0.05, 0.3, 0.05, 0, 0.5, 0.27, 0x33312f);
    for (const [x, z] of [[-0.07, -0.18], [0.07, -0.18], [-0.07, 0.18], [0.07, 0.18]]) leg(x, z, 0.2, 0x242220);
  } else { // goose
    box(g, 0.3, 0.3, 0.55, 0, 0.42, 0, 0xf4f1ea); box(g, 0.1, 0.45, 0.1, 0, 0.72, -0.26, 0xf4f1ea);
    box(g, 0.14, 0.13, 0.16, 0, 0.98, -0.3, 0xf4f1ea); box(g, 0.08, 0.05, 0.16, 0, 0.96, -0.44, 0xf08a24);
    box(g, 0.1, 0.16, 0.12, 0, 0.5, 0.3, 0xf4f1ea);
    leg(-0.08, 0, 0.28, 0xf08a24); leg(0.08, 0, 0.28, 0xf08a24);
  }
  g.userData.legs = legs;
  return g;
}

const bubbleCache = new Map();
function bubble(text) {
  if (bubbleCache.has(text)) return bubbleCache.get(text);
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px "Patrick Hand", "Comic Sans MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(text).width + 28);
  x.fillStyle = '#fffaf0'; x.strokeStyle = '#2a2018'; x.lineWidth = 4;
  x.beginPath(); x.roundRect(128 - w / 2, 6, w, 52, 14); x.fill(); x.stroke();
  x.fillStyle = '#2a2018'; x.fillText(text, 128, 33, 236);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, fog: false });
  bubbleCache.set(text, m); return m;
}

const pick = a => a[Math.floor(Math.random() * a.length)];
const SEE = ['YOU\'RE NEW.', 'NOBODY LEAVES!', 'SOAK EM!', 'IT\'S NOT DINNER YET!', 'WHO LET YOU IN?', 'GET THEM!'];
const OUCH = ['HEY!', 'COLD!!', 'NO FAIR!', 'MY SOCKS!'];
const BYE = ['I\'M TELLING!', 'TIME OUT!', 'I WANT TO GO HOME', 'WHAT DAY IS IT?'];

class Actor {
  constructor(game, group, x, z, r, h) {
    this.game = game; this.group = group;
    this.pos = new THREE.Vector3(x, 0, z); this.vel = new THREE.Vector3();
    this.r = r; this.h = h; this.onGround = false; this.blocked = false;
    this.yaw = Math.random() * 6.28; this.walk = 0; this.out = 0; this.wet = 0;
    this.home = { x, z }; this.goal = null; this.goalT = 0; this.stuck = 0;
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    game.scene.add(group);
  }
  targetable() { return this.out <= 0; }
  say(text, secs = 1.6) {
    if (this.sprite) this.group.remove(this.sprite);
    this.sprite = new THREE.Sprite(bubble(text));
    const s = 1 / this.group.scale.x;
    this.sprite.scale.set(2.2 * s, 0.55 * s, 1); this.sprite.position.y = 1.75 * s * (this.h / 1.25);
    this.sprite.renderOrder = 10;
    this.group.add(this.sprite); this.sayT = secs;
  }
  // steer on the ground plane; (dx,dz) need not be normalised
  go(dx, dz, speed) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) { this.vel.x = this.vel.z = 0; return; }
    this.vel.x = dx / d * speed; this.vel.z = dz / d * speed;
  }
  face(dx, dz, dt, rate = 10) {
    let want = Math.atan2(-dx, -dz), diff = want - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, rate * dt);
  }
  wander(dt, range, speed) {
    this.goalT -= dt;
    const g = this.goal;
    if (!g || this.goalT <= 0 || Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 1.2) {
      const far = Math.random() < 0.25 ? 3 : 1, a = Math.random() * 6.28, d = Math.random() * range * far;
      this.goal = {
        x: Math.min(123, Math.max(4, this.home.x + Math.cos(a) * d)),
        z: Math.min(123, Math.max(4, this.home.z + Math.sin(a) * d)),
      };
      this.goalT = 5 + Math.random() * 6;
      return;
    }
    const dx = g.x - this.pos.x, dz = g.z - this.pos.z;
    this.go(dx, dz, speed); this.face(dx, dz, dt, 6);
  }
  finish(dt) {
    moveActor(this.game.world, this, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += sp * dt * 3.2;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    if (this.sprite) { this.sayT -= dt; if (this.sayT <= 0) { this.group.remove(this.sprite); this.sprite = null; } }
    return sp;
  }
}

// ---- pathfinding on the ground plan. Open ground is cheap, cardboard is passable but dear
// (a kid will melt through it), everything else is a wall.
const N = 128;
const gArr = new Float32Array(N * N), came = new Int32Array(N * N), seen = new Uint32Array(N * N), shut = new Uint32Array(N * N);
let run = 0;
function cellCost(world, x, z) {
  if (x < 2 || z < 2 || x > N - 3 || z > N - 3) return 0;
  const a = world.get(x, 0, z), b = world.get(x, 1, z);
  if (!a && !b) return 1;
  return (a === 0 || a === 1) && (b === 0 || b === 1) ? 7 : 0;
}
export function findPath(world, sx, sz, gx, gz) {
  const cl = v => Math.min(N - 3, Math.max(2, Math.floor(v)));
  sx = cl(sx); sz = cl(sz); gx = cl(gx); gz = cl(gz);
  const start = sx + N * sz, goal = gx + N * gz;
  if (start === goal) return [];
  run++;
  const hf = [], hi = []; // binary heap of (f, cell)
  const push = (f, i) => {
    let c = hf.length; hf.push(f); hi.push(i);
    while (c > 0) { const p = (c - 1) >> 1; if (hf[p] <= f) break; hf[c] = hf[p]; hi[c] = hi[p]; c = p; }
    hf[c] = f; hi[c] = i;
  };
  const pop = () => {
    const top = hi[0], f = hf.pop(), i = hi.pop(), n = hf.length;
    if (n) { let c = 0; for (;;) { let k = c * 2 + 1; if (k >= n) break; if (k + 1 < n && hf[k + 1] < hf[k]) k++; if (hf[k] >= f) break; hf[c] = hf[k]; hi[c] = hi[k]; c = k; } hf[c] = f; hi[c] = i; }
    return top;
  };
  gArr[start] = 0; seen[start] = run; came[start] = -1; push(0, start);
  let found = false;
  for (let exp = 0; hf.length && exp < 9000;) {
    const cur = pop();
    if (cur === goal) { found = true; break; }
    if (shut[cur] === run) continue;
    shut[cur] = run; exp++;
    const cx = cur % N, cz = (cur / N) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0) - (k === 1), nz = cz + (k === 2) - (k === 3), ni = nx + N * nz;
      const c = ni === goal ? Math.max(1, cellCost(world, nx, nz)) : cellCost(world, nx, nz);
      if (!c || shut[ni] === run) continue;
      const ng = gArr[cur] + c;
      if (seen[ni] !== run || ng < gArr[ni]) { gArr[ni] = ng; seen[ni] = run; came[ni] = cur; push(ng + Math.abs(nx - gx) + Math.abs(nz - gz), ni); }
    }
  }
  if (!found) return null;
  const out = [];
  for (let c = goal; c !== start && c >= 0; c = came[c]) out.push({ x: (c % N) + 0.5, z: ((c / N) | 0) + 0.5 });
  return out.reverse();
}

export const AMMO = 24;
export class Kid extends Actor {
  constructor(game, o) {
    super(game, makeKid(o), o.x, o.z, 0.28, 1.25 * (o.scale || 1));
    this.team = o.team; this.still = !!o.still; this.name = o.name || '';
    this.think = Math.random(); this.target = null; this.cool = 1 + Math.random() * 2; this.burst = 0; this.burstT = 0;
    this.strafe = 1; this.chase = null;
    this.base = { x: o.x, z: o.z }; this.avoid = 0; this.range = 9; // base: where you respawn. home: where you're posted.
    this.ammo = AMMO; this.refillT = 0; this.path = null; this.pathGoal = null; this.pathT = 0; this.wp = 0; this.digT = 0; this.pause = 0;
    if (o.yaw !== undefined) this.yaw = o.yaw;
    this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
  }
  findTarget() {
    let best = null, bd = 16;
    const p = this.pos, w = this.game.world;
    for (const a of this.game.actors) {
      if (a === this || a.team < 0 || a.team === this.team || !a.targetable()) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < bd && Math.abs(a.pos.y - p.y) < 6 && w.los(p.x, p.y + 1, p.z, a.pos.x, a.pos.y + 0.8, a.pos.z)) { bd = d; best = a; }
    }
    return best;
  }
  shootAt(tx, ty, tz) {
    const p = this.pos, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const ox = p.x + fx * 0.4, oy = p.y + 0.85, oz = p.z + fz * 0.4;
    const dx = tx - ox, dz = tz - oz, dh = Math.max(0.5, Math.hypot(dx, dz)), vh = 16, t = dh / vh;
    const s = 1.3;
    this.game.fx.spawn(ox, oy, oz, dx / dh * vh + (Math.random() - 0.5) * s, (ty - oy) / t + 0.5 * WATER_GRAV * t + (Math.random() - 0.5) * s,
      dz / dh * vh + (Math.random() - 0.5) * s, 1.6, 0x5fb8ff, 0.13, 3, this.team);
  }
  hit(amount, byTeam, byPlayer) {
    if (this.team < 0 || this.out > 0) return;
    this.wet += amount;
    if (Math.random() < 0.25) this.say(pick(OUCH), 1);
    if (this.wet >= 100) {
      this.say(pick(BYE), 2); this.out = this.noRespawn ? Infinity : 14; this.outAnim = 1.6; this.vel.set(0, 0, 0);
      this.game.kidSoaked(this, byPlayer);
    }
  }
  // Walk a path to (tx,tz), melting any cardboard on the way. Returns true on arrival.
  travel(dt, tx, tz, speed) {
    const g = this.game, w = g.world, p = this.pos;
    this.pathT -= dt;
    if (!this.path || this.pathT <= 0 || Math.hypot(tx - this.pathGoal.x, tz - this.pathGoal.z) > 3) {
      this.path = findPath(w, p.x, p.z, tx, tz) || [{ x: tx, z: tz }];
      this.wp = 0; this.pathGoal = { x: tx, z: tz }; this.pathT = 5 + Math.random() * 3; this.stuck = 0;
    }
    const n = this.path[this.wp];
    if (!n) { this.go(0, 0, 0); return true; }
    const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { this.wp++; return this.wp >= this.path.length; }
    this.go(dx, dz, speed); this.face(dx, dz, dt, 8);
    const cx = Math.floor(n.x), cz = Math.floor(n.z), low = w.get(cx, 0, cz) === 1, high = w.get(cx, 1, cz) === 1;
    if (d < 1.7 && (low || high)) {
      this.go(0, 0, 0);
      if ((this.digT -= dt) <= 0) {
        this.digT = 0.22;
        if (g.nearPlayer(p, 48)) { this.shootAt(n.x, (low ? 0.5 : 1.5), n.z); g.sfx('squirt', p); }
        else w.soak(cx, low ? 0 : 1, cz, 0.25, false);
      }
    } else if (this.blocked) { this.stuck += dt; if (this.stuck > 1.5) this.pathT = 0; }
    else this.stuck = 0;
    return false;
  }
  update(dt) {
    const g = this.game, u = this.group.userData;
    if (this.out > 0) {
      this.out -= dt; this.outAnim -= dt;
      if (this.outAnim > 0) { this.group.scale.y = 0.7; this.vel.x = this.vel.z = 0; this.finish(dt); }
      else this.group.visible = false;
      if (this.out <= 0) {
        this.wet = 0; this.ammo = AMMO; this.group.visible = true; this.group.scale.y = 1; this.target = null; this.path = null; this.goal = null;
        const s = g.freeSpot(this.base.x, this.base.z, 7, this.avoid); this.pos.set(s.x, 0, s.z);
      }
      return;
    }
    this.wet = Math.max(0, this.wet - 5 * dt);
    u.bodyMat.color.copy(u.shirt).lerp(g.soggyBlue, Math.min(0.75, this.wet / 110));
    if (this.still) {
      const pl = g.player; const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
      if (dx * dx + dz * dz < 64) this.face(dx, dz, dt, 4);
      u.head.rotation.z = Math.sin(g.time * 1.3 + this.pos.x) * 0.06;
      this.vel.x = this.vel.z = 0; this.finish(dt); return;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.3 + Math.random() * 0.25;
      const had = this.target; this.target = this.ammo > 0 ? this.findTarget() : null;
      if (this.target && !had && Math.random() < 0.5) this.say(pick(SEE));
      if (!this.target && had && had === g.player && had.targetable()) this.chase = { x: had.pos.x, z: had.pos.z, t: 6 };
    }
    const t = this.target, p = this.pos;
    this.cool -= dt;
    if (t && t.targetable() && this.ammo > 0) {
      const dx = t.pos.x - p.x, dz = t.pos.z - p.z, d = Math.hypot(dx, dz);
      this.face(dx, dz, dt);
      if (Math.random() < dt * 0.4) this.strafe = -this.strafe;
      if (d > 9) this.go(dx, dz, 3.3);
      else if (d < 4.5) this.go(-dx, -dz, 2.6);
      else this.go(-dz * this.strafe, dx * this.strafe, 2.2);
      if (this.cool <= 0) { this.burst = 3; this.cool = 1.1 + Math.random() * 0.9; }
      if (this.burst > 0 && (this.burstT -= dt) <= 0) {
        this.burst--; this.burstT = 0.1; this.ammo--;
        if (g.nearPlayer(p, 48)) { this.shootAt(t.pos.x, t.pos.y + t.h * 0.6, t.pos.z); g.sfx('squirt', p); }
        else if (Math.random() < 0.45) t.hit(20, this.team, false); // fights you can't see are settled by dice
        if (this.ammo <= 0) this.say('I\'M OUT!', 1.5);
      }
      this.chase = null; this.path = null;
    } else if (this.ammo <= 0) {
      // out of water: run for a pool your side holds, or all the way home
      const r = g.refillSpot(this);
      this.travel(dt, r.x, r.z, 3.4);
      if (Math.hypot(r.x - p.x, r.z - p.z) < 2.8) { this.go(0, 0, 0); if ((this.refillT += dt) > r.secs) { this.ammo = AMMO; this.refillT = 0; this.path = null; } }
    } else if (g.hunting(this.team)) {
      this.travel(dt, g.player.pos.x, g.player.pos.z, 3.5); // someone has our flag
    } else if (this.chase) {
      if (this.travel(dt, this.chase.x, this.chase.z, 3.3) || (this.chase.t -= dt) <= 0) this.chase = null;
    } else if (this.pause > 0) { this.pause -= dt; this.go(0, 0, 0); }
    else {
      if (!this.goal || (this.goalT -= dt) <= 0) { this.goal = g.freeSpot(this.home.x, this.home.z, this.range, this.home === this.base ? this.avoid : 0); this.goalT = 30; }
      if (this.travel(dt, this.goal.x, this.goal.z, 2.6)) { this.goal = null; this.pause = 1 + Math.random() * 3; }
    }
    const sp = this.finish(dt);
    const sw = Math.sin(this.walk) * Math.min(1, sp / 2) * 0.7;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw;
  }
}

export class Animal extends Actor {
  constructor(game, kind, x, z) {
    super(game, makeAnimal(kind), x, z, 0.22, kind === 'goose' ? 0.95 : 0.6);
    this.kind = kind; this.team = -2; this.scared = 0; this.cool = 0;
  }
  hit() { this.scared = 7; if (this.kind === 'goose') this.say('HONK?!', 1); }
  update(dt) {
    const g = this.game, pl = g.player, p = this.pos;
    const dx = pl.pos.x - p.x, dz = pl.pos.z - p.z, d = Math.hypot(dx, dz);
    this.scared -= dt; this.cool -= dt;
    const live = g.mode === 'city' && !pl.safe;
    if (this.scared > 0) { this.go(-dx, -dz, 5); this.face(-dx, -dz, dt); }
    else if (this.kind === 'dog' && live && d < 9) {
      if (d > 2.6) this.go(dx, dz, 4.2); else this.go(0, 0, 0);
      this.face(dx, dz, dt);
    } else if (this.kind === 'cat' && d < 3.5) { this.go(-dx, -dz, 5.2); this.face(-dx, -dz, dt); }
    else if (this.kind === 'goose' && live && d < 7 && Math.abs(pl.pos.y - p.y) < 2) {
      this.go(dx, dz, 4.4); this.face(dx, dz, dt);
      if (d < 0.95 && this.cool <= 0) { this.cool = 2.5; this.scared = 1.2; this.say('HONK!', 1.2); g.goosed(this, dx / d, dz / d); }
    } else this.wander(dt, 14, this.kind === 'goose' ? 1.6 : 2.4);
    const sp = this.finish(dt);
    const sw = Math.sin(this.walk * 1.6) * Math.min(1, sp / 2) * 0.7;
    this.group.userData.legs.forEach((l, i) => { l.rotation.x = i % 2 ? sw : -sw; });
  }
}
