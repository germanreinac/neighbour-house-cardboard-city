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
function box(parent, w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(unit, typeof color === 'number' ? mat(color) : color);
  m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m;
}
function spike(parent, s, x, y, z, color, rx = 0) {
  const m = new THREE.Mesh(cone, mat(color)); m.scale.set(s, s * 1.4, s); m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}

const SKINS = [0xf2c9a0, 0xd9a273, 0xa8724a, 0x7a4e2e, 0xf7d9b8];
const KRAFT = 0xc9a26b;

// A kid is a handful of boxes. Local -z is forward.
export function makeKid({ shirt = 0x4f7fd9, pants = 0x3b4a6b, costume = 'none', scale = 1, gun = true }) {
  const g = new THREE.Group();
  const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
  const bodyMat = new THREE.MeshLambertMaterial({ color: shirt });
  const legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  legL.position.set(-0.11, 0.4, 0); legR.position.set(0.11, 0.4, 0);
  box(legL, 0.16, 0.4, 0.18, 0, -0.2, 0, pants); box(legR, 0.16, 0.4, 0.18, 0, -0.2, 0, pants);
  box(g, 0.44, 0.46, 0.26, 0, 0.63, 0, bodyMat);
  armL.position.set(-0.29, 0.82, 0); armR.position.set(0.29, 0.82, 0);
  box(armL, 0.12, 0.4, 0.14, 0, -0.18, 0, bodyMat); box(armR, 0.12, 0.4, 0.14, 0, -0.18, 0, bodyMat);
  const head = new THREE.Group(); head.position.set(0, 1.05, 0);
  box(head, 0.36, 0.36, 0.36, 0, 0, 0, skin);
  box(head, 0.06, 0.07, 0.02, -0.09, 0.03, -0.19, 0x1c1c1c); box(head, 0.06, 0.07, 0.02, 0.09, 0.03, -0.19, 0x1c1c1c);
  if (gun) {
    armR.rotation.x = 1.35;
    box(armR, 0.09, 0.3, 0.12, 0, -0.42, 0.06, 0x35c46a); box(armR, 0.1, 0.12, 0.16, 0, -0.34, 0.16, 0xff8a2a);
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
  g.userData = { legL, legR, armL, armR, head, bodyMat, shirt: new THREE.Color(shirt) };
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
  const m = new THREE.SpriteMaterial({ map: t, depthTest: false, fog: false });
  bubbleCache.set(text, m); return m;
}

const pick = a => a[Math.floor(Math.random() * a.length)];
const SEE = ['GET THEM!', 'INTRUDER!', 'SOAK EM!', 'THIS IS OUR STREET!', 'FIRE!', 'YOU\'RE TOAST!'];
const OUCH = ['HEY!', 'COLD!!', 'NO FAIR!', 'MY SOCKS!'];
const BYE = ['I\'M TELLING!', 'TIME OUT!', 'I\'M SOAKED!', 'REMATCH!!'];

class Actor {
  constructor(game, group, x, z, r, h) {
    this.game = game; this.group = group;
    this.pos = new THREE.Vector3(x, 0, z); this.vel = new THREE.Vector3();
    this.r = r; this.h = h; this.onGround = false; this.blocked = false;
    this.yaw = Math.random() * 6.28; this.walk = 0; this.out = 0; this.wet = 0;
    this.home = { x, z }; this.goal = null; this.goalT = 0; this.stuck = 0;
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

export class Kid extends Actor {
  constructor(game, o) {
    super(game, makeKid(o), o.x, o.z, 0.28, 1.25 * (o.scale || 1));
    this.team = o.team; this.still = !!o.still; this.name = o.name || '';
    this.think = Math.random(); this.target = null; this.cool = 1 + Math.random() * 2; this.burst = 0; this.burstT = 0;
    this.strafe = 1; this.chase = null;
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
      dz / dh * vh + (Math.random() - 0.5) * s, 1.6, 0x5fb8ff, 0.13, 1, this.team);
  }
  hit(amount, byTeam) {
    if (this.team < 0 || this.out > 0) return;
    this.wet += amount;
    if (Math.random() < 0.25) this.say(pick(OUCH), 1);
    if (this.wet >= 100) {
      this.say(pick(BYE), 2); this.out = 14; this.outAnim = 1.6; this.vel.set(0, 0, 0);
      this.game.kidSoaked(this, byTeam);
    }
  }
  update(dt) {
    const g = this.game, u = this.group.userData;
    if (this.out > 0) {
      this.out -= dt; this.outAnim -= dt;
      if (this.outAnim > 0) { this.group.scale.y = 0.7; this.finishStill(dt); }
      else this.group.visible = false;
      if (this.out <= 0) {
        this.wet = 0; this.group.visible = true; this.group.scale.y = 1; this.target = null;
        const s = g.freeSpot(this.home.x, this.home.z, 7); this.pos.set(s.x, 0, s.z);
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
      const had = this.target; this.target = this.findTarget();
      if (this.target && !had && Math.random() < 0.5) this.say(pick(SEE));
      if (!this.target && had && had === g.player && had.targetable()) this.chase = { x: had.pos.x, z: had.pos.z, t: 6 };
    }
    const t = this.target, p = this.pos;
    this.cool -= dt;
    if (t && t.targetable()) {
      const dx = t.pos.x - p.x, dz = t.pos.z - p.z, d = Math.hypot(dx, dz);
      this.face(dx, dz, dt);
      if (Math.random() < dt * 0.4) this.strafe = -this.strafe;
      if (d > 9) this.go(dx, dz, 3.3);
      else if (d < 4.5) this.go(-dx, -dz, 2.6);
      else this.go(-dz * this.strafe, dx * this.strafe, 2.2);
      if (this.cool <= 0 && g.nearPlayer(p, 46)) { this.burst = 3; this.cool = 1.1 + Math.random() * 0.9; }
      if (this.burst > 0 && (this.burstT -= dt) <= 0) { this.burst--; this.burstT = 0.1; this.shootAt(t.pos.x, t.pos.y + t.h * 0.6, t.pos.z); g.sfx('squirt', p); }
      this.chase = null;
    } else if (this.chase) {
      const dx = this.chase.x - p.x, dz = this.chase.z - p.z;
      this.go(dx, dz, 3.3); this.face(dx, dz, dt);
      if ((this.chase.t -= dt) <= 0 || Math.hypot(dx, dz) < 1.5) this.chase = null;
      this.tunnel(dt);
    } else {
      this.wander(dt, 12, 2.5);
      this.tunnel(dt);
    }
    const sp = this.finish(dt);
    const sw = Math.sin(this.walk) * Math.min(1, sp / 2) * 0.7;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw;
  }
  // stuck against cardboard? melt a door through it.
  tunnel(dt) {
    if (!this.blocked) { this.stuck = Math.max(0, this.stuck - dt); return; }
    this.stuck += dt;
    if (this.stuck > 0.8) {
      this.stuck = 0;
      if (Math.random() < 0.5 && this.game.nearPlayer(this.pos, 46)) {
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        for (let i = 0; i < 4; i++) this.shootAt(this.pos.x + fx * 1.2, this.pos.y + 0.3 + (i % 2), this.pos.z + fz * 1.2);
      } else this.goalT = 0;
    }
  }
  finishStill(dt) { this.vel.x = this.vel.z = 0; this.finish(dt); }
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
