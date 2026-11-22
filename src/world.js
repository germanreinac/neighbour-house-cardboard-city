// Voxel world: one grid holds the house, the backyard and Cardboard City.
// Cardboard gets soggy when hit by water and collapses; everything else is solid.
import * as THREE from '../vendor/three.module.min.js';

export const SX = 128, SY = 14, SZ = 224;
export const CITY = 128; // city occupies z in [0, CITY)

export const T = {
  AIR: 0, CARD: 1, WOOD: 2, WALL: 3, FENCE: 4, LEAF: 5, CLUTTER: 6, DOOR: 7, TRUNK: 8, EDGE: 9, ROOF: 10,
  GHOST: 11, // solid but not drawn: the collision under the tall non-voxel towers
};
const SOLID_COLORS = {
  [T.WOOD]: 0xa9743f, [T.WALL]: 0xe6dcc6, [T.FENCE]: 0xb08a5c, [T.LEAF]: 0x4f8f4a,
  [T.DOOR]: 0x7a3f2a, [T.TRUNK]: 0x5c3d24, [T.ROOF]: 0x8c4a3c,
};
const DRY = new THREE.Color().setRGB(1, 1, 1), EDGE_TONE = new THREE.Color().setRGB(0.6, 0.57, 0.55);
const CLUTTER_TONES = [0xd96a4f, 0x4f7fd9, 0xe8c74a, 0x6b6b7a, 0x58a56e, 0xd9d2c4, 0x9a5fc4].map(c => new THREE.Color(c));
const SOGGY = new THREE.Color().setRGB(0.3, 0.26, 0.27); // multiplies the box skin

const CH = 16; // chunk size in x and z
const CX = SX / CH, CZ = SZ / CH;

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const hash = i => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ h >>> 16) >>> 0; };

// Cardboard is drawn as big taped boxes that span several grid cells, so a wall reads as
// a stack of fridge boxes rather than a grid of cubes. The pattern lives in world space.
const SKIN = /* glsl */`
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 cardSkin(vec3 wp, vec3 n){
  bool top = abs(n.y) > 0.5; bool xs = abs(n.x) > 0.5;
  vec2 uv = top ? wp.xz : vec2(xs ? wp.z : wp.x, wp.y);
  float along = uv.x;
  vec2 B = top ? vec2(3.0, 3.0) : vec2(3.0, 2.0);
  if (!top) uv.x += mod(floor(uv.y / B.y), 2.0) * 1.5 + (xs ? 0.7 : 0.0);
  vec2 id = floor(uv / B) + (xs ? 17.0 : 0.0); vec2 f = fract(uv / B); vec2 m = f * B;
  vec2 d = min(f, 1.0 - f) * B; float e = min(d.x, d.y);
  float r = h21(id);
  vec3 col = vec3(0.584, 0.361, 0.147) * mix(0.78, 1.16, r);
  col = mix(col, col * vec3(1.08, 0.96, 0.8), h21(id + 3.1));
  float aa = fwidth(e) + 0.004;
  col *= mix(0.42, 1.0, smoothstep(0.02, 0.035 + aa, e));
  col *= mix(0.86, 1.0, smoothstep(0.0, 0.4, e));
  col *= 1.0 + 0.035 * sin(uv.x * 40.0) * (1.0 - smoothstep(0.4, 1.4, fwidth(uv.x) * 40.0));
  if (top) {
    col *= mix(0.55, 1.0, smoothstep(0.015, 0.05 + aa, abs(m.x - 1.5)));
    col = mix(col, vec3(0.74, 0.6, 0.38), 0.75 * step(abs(m.y - 1.5), 0.13) * step(0.35, r));
  } else {
    col = mix(col, vec3(0.74, 0.6, 0.38), 0.75 * step(abs(m.x - 1.5), 0.13) * step(1.3, m.y) * step(0.3, r));
    float r2 = h21(id + 9.7);
    if (r2 > 0.8) {
      vec2 q = m - vec2(0.4, 0.35);
      if (q.x > 0.0 && q.x < 0.8 && q.y > 0.0 && q.y < 0.5) {
        col = vec3(0.85, 0.82, 0.74);
        col = mix(col, vec3(0.2), 0.6 * step(0.5, fract(q.y * 8.0)) * step(0.08, q.x) * step(q.x, 0.62));
      }
    } else if (r2 < 0.14) {
      for (int i = 0; i < 2; i++) {
        vec2 q = m - vec2(2.2 + float(i) * 0.36, 0.4);
        float stem = step(abs(q.x), 0.04) * step(0.0, q.y) * step(q.y, 0.36);
        float head = step(0.36, q.y) * step(q.y, 0.58) * step(abs(q.x), (0.58 - q.y) * 0.65);
        col = mix(col, col * 0.3, max(stem, head));
      }
    }
  }
  // windows a kid drew on with a fat marker, above head height: some lit, some blue, all wobbly
  if (!top && wp.y > 2.7) {
    vec2 wv = vec2(along, wp.y) + 0.04 * sin(vec2(wp.y, along) * 4.3);
    vec2 W = vec2(1.6, 2.1); vec2 wi = floor(wv / W); vec2 wf = fract(wv / W) * W;
    float wr = h21(wi + (xs ? 31.0 : 5.0));
    if (wr > 0.34) {
      vec2 q = abs(wf - W * 0.5) - vec2(0.36, 0.52);
      float sd = max(q.x, q.y), waa = fwidth(sd) + 0.004;
      vec3 pane = wr > 0.84 ? vec3(0.95, 0.74, 0.2) : (wr > 0.6 ? vec3(0.4, 0.58, 0.7) : col * 0.8);
      col = mix(col, pane, (1.0 - smoothstep(0.0, waa, sd)) * 0.9);
      float line = 1.0 - smoothstep(0.035, 0.035 + waa, abs(sd));
      float bars = (1.0 - smoothstep(0.02, 0.02 + waa, min(abs(wf.x - W.x * 0.5), abs(wf.y - W.y * 0.5)))) * step(sd, 0.0);
      col = mix(col, vec3(0.05, 0.04, 0.04), max(line, bars) * 0.9);
    }
  }
  return col;
}`;
function cardboardMaterial() {
  const mat = new THREE.MeshLambertMaterial();
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vONrm;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vONrm = normal; vec4 wpC = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpC = instanceMatrix * wpC;
        #endif
        vWPos = (modelMatrix * wpC).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vONrm;\n' + SKIN)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= cardSkin(vWPos, vONrm);');
  };
  return mat;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.type = new Uint8Array(SX * SY * SZ);
    this.wet = new Float32Array(SX * SY * SZ);
    this.wetSet = new Set();
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.cardMat = cardboardMaterial();
    this.solidMat = new THREE.MeshLambertMaterial();
    this.chunks = [];
    for (let i = 0; i < CX * CZ; i++) this.chunks.push({ dirty: true, card: null, solid: null });
    this.onBreak = null; // (x,y,z,byPlayer)
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    this.dryTimer = 0;
  }
  idx(x, y, z) { return x + SX * (z + SZ * y); }
  inb(x, y, z) { return x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ; }
  get(x, y, z) { return this.inb(x, y, z) ? this.type[this.idx(x, y, z)] : T.AIR; }
  // Solid for collision: ground and the outside of the grid are solid, sky is not.
  solid(x, y, z) {
    if (y < 0) return true;
    if (y >= SY) return false;
    if (x < 0 || x >= SX || z < 0 || z >= SZ) return true;
    return this.type[x + SX * (z + SZ * y)] !== 0;
  }
  solidAt(px, py, pz) { return this.solid(Math.floor(px), Math.floor(py), Math.floor(pz)); }
  set(x, y, z, t) {
    if (!this.inb(x, y, z)) return;
    const i = this.idx(x, y, z);
    this.type[i] = t;
    if (this.wet[i]) { this.wet[i] = 0; this.wetSet.delete(i); }
    this.chunks[(x >> 4) + CX * (z >> 4)].dirty = true;
  }
  // Add water to a block. Returns true if it collapsed.
  soak(x, y, z, amount, byPlayer) {
    if (!this.inb(x, y, z)) return false;
    const i = this.idx(x, y, z);
    if (this.type[i] !== T.CARD) return false;
    this.wet[i] += amount;
    if (this.wet[i] >= 1) {
      this.set(x, y, z, T.AIR);
      if (this.onBreak) this.onBreak(x, y, z, byPlayer);
      return true;
    }
    this.wetSet.add(i);
    this.chunks[(x >> 4) + CX * (z >> 4)].dirty = true;
    return false;
  }
  // March a ray through the grid. Returns {x,y,z, px,py,pz (last empty cell), dist} or null.
  raycast(o, d, max, step = 0.06) {
    let lx = Math.floor(o.x), ly = Math.floor(o.y), lz = Math.floor(o.z);
    for (let t = 0; t <= max; t += step) {
      const x = Math.floor(o.x + d.x * t), y = Math.floor(o.y + d.y * t), z = Math.floor(o.z + d.z * t);
      if (x === lx && y === ly && z === lz) continue;
      if (this.solid(x, y, z)) return { x, y, z, px: lx, py: ly, pz: lz, dist: t };
      lx = x; ly = y; lz = z;
    }
    return null;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const n = Math.ceil(Math.hypot(dx, dy, dz) / 0.45);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(ax + dx * t, ay + dy * t, az + dz * t)) return false;
    }
    return true;
  }
  boxFree(x0, y0, z0, x1, y1, z1) {
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
          if (this.solid(x, y, z)) return false;
    return true;
  }

  update(dt, cam, viewDist) {
    // Cardboard slowly dries out if it wasn't soaked all the way through.
    this.dryTimer += dt;
    if (this.dryTimer > 1.5) {
      for (const i of this.wetSet) {
        this.wet[i] -= 0.03 * this.dryTimer;
        if (this.wet[i] <= 0) { this.wet[i] = 0; this.wetSet.delete(i); }
        const x = i % SX, z = Math.floor(i / SX) % SZ;
        this.chunks[(x >> 4) + CX * (z >> 4)].dirty = true;
      }
      this.dryTimer = 0;
    }
    for (let cz = 0; cz < CZ; cz++) for (let cx = 0; cx < CX; cx++) {
      const ch = this.chunks[cx + CX * cz];
      const dx = cx * CH + 8 - cam.x, dz = cz * CH + 8 - cam.z;
      const vis = dx * dx + dz * dz < (viewDist + 12) * (viewDist + 12);
      if (vis && ch.dirty) this.rebuild(cx, cz, ch);
      if (ch.card) ch.card.visible = vis;
      if (ch.solid) ch.solid.visible = vis;
    }
  }
  rebuild(cx, cz, ch) {
    ch.dirty = false;
    let nCard = 0, nSolid = 0;
    const x0 = cx * CH, z0 = cz * CH;
    for (let y = 0; y < SY; y++) for (let z = z0; z < z0 + CH; z++) for (let x = x0; x < x0 + CH; x++) {
      const t = this.type[x + SX * (z + SZ * y)];
      if (!t || t === T.GHOST) continue;
      if (t === T.CARD || t === T.EDGE) nCard++; else nSolid++;
    }
    ch.card = this.ensure(ch.card, nCard, this.cardMat);
    ch.solid = this.ensure(ch.solid, nSolid, this.solidMat);
    let a = 0, b = 0;
    const m = this._m, c = this._c;
    for (let y = 0; y < SY; y++) for (let z = z0; z < z0 + CH; z++) for (let x = x0; x < x0 + CH; x++) {
      const i = x + SX * (z + SZ * y), t = this.type[i];
      if (!t || t === T.GHOST) continue;
      m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      const h = hash(i);
      if (t === T.CARD) {
        c.copy(DRY).lerp(SOGGY, Math.min(1, this.wet[i]));
        ch.card.setMatrixAt(a, m); ch.card.setColorAt(a++, c);
      } else if (t === T.EDGE) {
        ch.card.setMatrixAt(a, m); ch.card.setColorAt(a++, EDGE_TONE);
      } else {
        if (t === T.CLUTTER) c.copy(CLUTTER_TONES[h % CLUTTER_TONES.length]);
        else { c.setHex(SOLID_COLORS[t]); if (t === T.WOOD || t === T.FENCE) c.multiplyScalar(0.86 + (hash(t === T.WOOD ? z : x + z) % 20) / 100); }
        ch.solid.setMatrixAt(b, m); ch.solid.setColorAt(b++, c);
      }
    }
    for (const mesh of [ch.card, ch.solid]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  ensure(mesh, n, mat) {
    if (mesh && mesh.userData.cap >= n) { mesh.count = n; return mesh; }
    if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
    if (n === 0) return null;
    const cap = Math.ceil(n * 1.3) + 32;
    mesh = new THREE.InstancedMesh(this.geo, mat, cap);
    mesh.userData.cap = cap; mesh.count = n; mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }
}

// ---------------------------------------------------------------- generation

export const PLACES = {
  start: { x: 64.5, z: 219.5 },
  frontDoor: { x: 64, z: 212 },
  backDoor: { x: 64, z: 196 },
  pileHole: { x: 64.5, z: 182.5 },
  citySpawn: { x: 64.5, z: 121.5 },
  friend: { x: 64.5, z: 116.5 },
  tree: { x: 64.5, z: 64.5 },
  treeTopY: 7,
  respawn: { x: 80.5, z: 64.5 },
  shop: { x: 58.9, z: 61 },
  yard: [[79.5, 69.5], [81.5, 69.5], [83.5, 69.5]], // where captured flags stand, on the ground, stealable
  forts: [
    { team: 1, x: 24, z: 26, name: 'Box Knights', color: 0xd9483b },
    { team: 2, x: 104, z: 26, name: 'Alley Pirates', color: 0x8a4fd1 },
    { team: 3, x: 24, z: 100, name: 'Dino Scouts', color: 0x3fa35c },
  ],
  pools: [
    { x: 73, z: 112, owner: 0, name: 'South pool' }, { x: 34, z: 62, owner: 3, name: 'West pool' },
    { x: 96, z: 64, owner: 2, name: 'East pool' }, { x: 62, z: 30, owner: 1, name: 'North pool' },
    { x: 102, z: 102, owner: -1, name: 'Corner pool' },
  ],
};

export function generate(world, seed = 7) {
  const R = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const set = (x, y, z, t) => world.set(x, y, z, t);
  const fill = (x0, y0, z0, x1, y1, z1, t) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, t);
  };
  const shell = (x0, z0, x1, z1, h, t, roofT, y0 = 0) => {
    for (let y = y0; y < h; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (x === x0 || x === x1 || z === z0 || z === z1) set(x, y, z, t);
    if (roofT) fill(x0, h, z0, x1, h, z1, roofT);
  };
  // decoration hangs off a support cell and goes when that cell melts
  const loot = [], flaps = [], signs = [], towers = [], shops = [], standees = [];

  // --- city boundary: stacks you can't melt, with giant boxes looming behind them
  for (let i = 0; i < CITY; i++) for (let k = 0; k < 2; k++) {
    const h = () => ri(9, 13);
    fill(i, 0, k, i, h(), k, T.EDGE); fill(i, 0, CITY - 1 - k, i, h(), CITY - 1 - k, T.EDGE);
    fill(k, 0, i, k, h(), i, T.EDGE); fill(CITY - 1 - k, 0, i, CITY - 1 - k, h(), i, T.EDGE);
  }
  for (let side = 0; side < 4; side++) for (let i = -4; i < CITY + 4; i += ri(7, 11)) {
    const o = side % 2 ? CITY + 5 : -5, w = ri(9, 13);
    towers.push({ x: side < 2 ? i : o, z: side < 2 ? o : i, y0: 0, w, d: w, h: ri(22, 44), yaw: (R() - 0.5) * 0.3, tilt: (R() - 0.5) * 0.06 });
  }

  // --- reserved ground (1 = keep clear)
  const mask = new Uint8Array(CITY * CITY);
  const reserve = (x0, z0, x1, z1) => {
    for (let z = Math.max(0, z0); z <= Math.min(CITY - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(CITY - 1, x1); x++) mask[x + CITY * z] = 1;
  };
  const free = (x0, z0, x1, z1) => {
    if (x0 < 3 || z0 < 3 || x1 > CITY - 4 || z1 > CITY - 4) return false;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (mask[x + CITY * z]) return false;
    return true;
  };
  reserve(52, 53, 85, 76);              // treehouse clearing, stairs and flag yard
  reserve(63, 77, 66, 125);             // the one wide street: arrival gate to the Treehouse
  reserve(8, 88, 119, 89);              // a cross street
  for (const p of PLACES.pools) reserve(p.x - 5, p.z - 5, p.x + 5, p.z + 5);
  for (const f of PLACES.forts) reserve(f.x - 12, f.z - 12, f.x + 12, f.z + 12);

  // --- treehouse: real wood, water can't touch it
  {
    const cx = 64, cz = 64;
    fill(cx - 1, 0, cz - 1, cx + 1, 9, cz + 1, T.TRUNK);
    fill(57, 6, 57, 71, 6, 71, T.WOOD);                       // deck
    for (let i = 57; i <= 71; i++) {                          // railing
      set(i, 7, 57, T.WOOD); set(i, 7, 71, T.WOOD); set(57, 7, i, T.WOOD);
      if (i < 63 || i > 65) set(71, 7, i, T.WOOD);
    }
    for (const [px, pz] of [[57, 57], [71, 57], [57, 71], [71, 71]]) fill(px, 0, pz, px, 9, pz, T.WOOD);
    for (let i = 0; i < 6; i++) fill(77 - i, 0, 63, 77 - i, i, 65, T.WOOD); // stairs up the east side
    fill(60, 7, 59, 60, 7, 62, T.WOOD);                       // market counter
  }

  // --- tribe forts
  for (const f of PLACES.forts) {
    const { x: cx, z: cz } = f;
    shell(cx - 10, cz - 10, cx + 10, cz + 10, 5, T.CARD);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      shell(cx + sx * 10 - 1, cz + sz * 10 - 1, cx + sx * 10 + 1, cz + sz * 10 + 1, 9, T.CARD, T.CARD);
    const gx = cx < 64 ? cx + 10 : cx - 10; // gate on the side facing the middle of the city
    fill(gx, 0, cz - 1, gx, 2, cz + 1, T.AIR);
    signs.push({ x: cx < 64 ? gx + 1 : gx, y: 3.9, z: cz + 0.5, dx: cx < 64 ? 1 : -1, dz: 0, sup: [gx, 3, cz], text: f.name.toUpperCase(), big: true });
    shell(cx - 2, cz - 2, cx + 2, cz + 2, 3, T.CARD, T.CARD); // sealed keep holding the flag
    towers.push({ x: cx + 0.5, z: cz + 0.5, y0: 4, w: 4.6, d: 4.6, h: 9, yaw: 0.06, tilt: 0.02 });
    shell(cx - 2, cz - 2, cx + 2, cz + 2, SY, T.GHOST, 0, 4);
  }

  // --- the city: boxes packed tight, alleys one or two cells wide, towers stacked on top
  const SHOPS = 10;
  for (let n = 0; n < 11000; n++) {
    const small = n > 4500; // second pass: little boxes wedged into whatever gaps are left
    const w = small ? ri(3, 6) : ri(5, 11), d = small ? ri(3, 6) : ri(5, 11), h = ri(4, 7), m = small || R() < 0.6 ? 1 : 2;
    const x0 = ri(3, CITY - 4 - w), z0 = ri(3, CITY - 4 - d), x1 = x0 + w - 1, z1 = z0 + d - 1;
    if (!free(x0 - m, z0 - m, x1 + m, z1 + m)) continue;
    reserve(x0, z0, x1, z1);
    const tall = R() < 0.85;
    shell(x0, z0, x1, z1, h, T.CARD, tall || R() < 0.5 ? T.CARD : 0);
    let top = h + 1;
    if (tall) {
      // upper floors are big single boxes, a little crooked, each smaller than the one below
      let sw = w, sd = d, y = h + 1;
      const cx = (x0 + x1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
      const k0 = ri(1, 3);
      for (let k = k0; k > 0; k--) {
        sw = Math.max(3, sw - R() * 1.6); sd = Math.max(3, sd - R() * 1.6);
        const sh = ri(4, 12);
        towers.push({ x: cx + (R() - 0.5) * 0.8, z: cz + (R() - 0.5) * 0.8, y0: y, w: sw, d: sd, h: sh, yaw: (R() - 0.5) * 0.16, tilt: (R() - 0.5) * 0.05, top: k === 1, base: k0 === k });
        y += sh;
      }
      shell(x0, z0, x1, z1, SY, T.GHOST, 0, h + 1);
      top = y;
    }
    const doorSide = ri(0, 3);
    for (let side = 0; side < 4; side++) {
      const horiz = side < 2, near = side % 2 === 0, len = horiz ? w : d;
      const fx = horiz ? (x0 + x1 + 1) / 2 : (near ? x0 : x1 + 1), fz = horiz ? (near ? z0 : z1 + 1) : (z0 + z1 + 1) / 2;
      const dx = horiz ? 0 : (near ? -1 : 1), dz = horiz ? (near ? -1 : 1) : 0;
      const sx = horiz ? Math.floor(fx) : (near ? x0 : x1), sz = horiz ? (near ? z0 : z1) : Math.floor(fz);
      if (R() < 0.4) flaps.push({ x: fx, y: tall ? top : h, z: fz, len: len - 0.3, dx, dz, a: R() * 1.5 - 0.45, sup: tall ? null : [sx, h - 1, sz] });
      if (side === doorSide) {
        if (R() < 0.6) { // a real doorway
          const dxx = horiz ? ri(x0 + 1, x1 - 1) : sx, dzz = horiz ? sz : ri(z0 + 1, z1 - 1);
          fill(dxx, 0, dzz, dxx, 1, dzz, T.AIR);
        }
      } else if (len >= 6 && R() < 0.34) { // a fake shopfront: painted door, window, awning, sign
        shops.push({ x: horiz ? sx + 0.5 : fx, z: horiz ? fz : sz + 0.5, dx, dz, ax: horiz ? 1 : 0, az: horiz ? 0 : 1, sx, sz, kind: ri(0, SHOPS - 1) });
      } else if (R() < 0.16) signs.push({ x: fx, y: 1.5 + R() * 0.5, z: fz, dx, dz, sup: [sx, 1, sz] });
      else if (h >= 5 && R() < 0.5) { // a window, above head height
        const wx = horiz ? ri(x0 + 1, x1 - 1) : sx, wz = horiz ? sz : ri(z0 + 1, z1 - 1);
        set(wx, ri(2, h - 2), wz, T.AIR);
      }
    }
    if (R() < 0.6) {
      const k = R();
      loot.push({ x: (x0 + x1 + 1) / 2, y: 0, z: (z0 + z1 + 1) / 2, kind: k < 0.6 ? 'caps' : k < 0.8 ? 'balloon' : 'bottle' });
    }
  }

  // --- a few long walls and loose boxes in the open bits
  for (let n = 0; n < 10; n++) {
    const horiz = R() < 0.5, len = ri(8, 18), h = ri(2, 5);
    const x0 = ri(4, CITY - 5 - (horiz ? len : 0)), z0 = ri(4, CITY - 5 - (horiz ? 0 : len));
    const x1 = horiz ? x0 + len : x0, z1 = horiz ? z0 : z0 + len;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (!mask[x + CITY * z]) fill(x, 0, z, x, h - 1 - (R() < 0.15 ? 1 : 0), z, T.CARD);
  }
  for (let n = 0; n < 150; n++) {
    const x = ri(3, CITY - 4), z = ri(3, CITY - 4);
    if (mask[x + CITY * z]) continue;
    fill(x, 0, z, x, R() < 0.8 ? 0 : 1, z, T.CARD);
  }
  // crates inside each fort for cover
  for (const f of PLACES.forts) for (let n = 0; n < 14; n++) {
    const x = f.x + ri(-8, 8), z = f.z + ri(-8, 8);
    if (Math.abs(x - f.x) < 4 && Math.abs(z - f.z) < 4) continue;
    if (Math.abs(z - f.z) < 2) continue; // keep the gate lane open
    fill(x, 0, z, x, ri(0, 1), z, T.CARD);
  }
  // cardboard cut-out kids standing around the alleys
  for (let n = 0; n < 2000 && standees.length < 70; n++) {
    const x = ri(4, CITY - 5), z = ri(4, CITY - 5);
    if (world.solid(x, 0, z) || world.solid(x, 1, z)) continue;
    if (Math.hypot(x - 64, z - 64) < 14 || (Math.abs(x - 64.5) < 3 && z > 104)) continue;
    standees.push({ x: x + 0.5, z: z + 0.5, yaw: R() * 6.28, team: ri(1, 3) });
  }

  // --- the house (front door faces +z, you walk -z through it)
  {
    fill(56, 0, 196, 72, 3, 212, T.WALL); fill(57, 0, 197, 71, 3, 211, T.AIR);
    fill(55, 4, 195, 73, 4, 213, T.ROOF); fill(58, 5, 198, 70, 5, 210, T.ROOF);
    fill(64, 0, 212, 64, 1, 212, T.DOOR); fill(64, 0, 196, 64, 1, 196, T.DOOR);
    for (const wx of [59, 60, 68, 69]) { set(wx, 1, 212, T.AIR); set(wx, 2, 212, T.AIR); }
    fill(57, 0, 205, 61, 3, 205, T.WALL); fill(67, 0, 205, 71, 3, 205, T.WALL); // inner wall
    // the mess
    const H = mulberry32(99);
    for (let n = 0; n < 120; n++) {
      const x = 57 + Math.floor(H() * 15), z = 197 + Math.floor(H() * 15);
      if (world.get(x, 0, z)) continue;
      if (Math.abs(x - 64) <= 1 && (z > 208 || z < 199 || (z > 203 && z < 207))) continue;
      if (x === 64 && H() < 0.6) continue;
      fill(x, 0, z, x, H() < 0.2 ? 1 : 0, z, T.CLUTTER);
    }
    fill(58, 0, 200, 58, 0, 203, T.CLUTTER); fill(57, 0, 200, 57, 1, 203, T.CLUTTER); // couch
    // backyard fence
    fill(54, 0, 175, 54, 2, 196, T.FENCE); fill(74, 0, 175, 74, 2, 196, T.FENCE); fill(54, 0, 175, 74, 2, 175, T.FENCE);
    fill(54, 0, 196, 55, 2, 196, T.FENCE); fill(73, 0, 196, 74, 2, 196, T.FENCE);
    // the pile of boxes
    for (let z = 176; z <= 183; z++) for (let x = 57; x <= 71; x++) {
      const hgt = Math.round(5.5 - Math.abs(x - 64) * 0.55 - (z - 176) * 0.35 + H() * 1.6);
      if (hgt > 0) fill(x, 0, z, x, Math.min(hgt, 6) - 1, z, T.CARD);
    }
    fill(63, 0, 177, 65, 2, 183, T.CARD); fill(64, 0, 178, 64, 1, 183, T.AIR); // the big box with the hole
    fill(62, 0, 184, 62, 0, 184, T.CARD); fill(67, 0, 185, 67, 1, 185, T.CARD); fill(60, 0, 186, 60, 0, 186, T.CARD);
  }
  world.orig = world.type.slice(); // what the tribes rebuild back to
  return { loot, flaps, signs, towers, shops, standees };
}
