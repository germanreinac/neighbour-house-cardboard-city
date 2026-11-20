// Voxel world: one grid holds the house, the backyard and Cardboard City.
// Cardboard gets soggy when hit by water and collapses; everything else is solid.
import * as THREE from '../vendor/three.module.min.js';

export const SX = 128, SY = 14, SZ = 224;
export const CITY = 128; // city occupies z in [0, CITY)

export const T = {
  AIR: 0, CARD: 1, WOOD: 2, WALL: 3, FENCE: 4, LEAF: 5, CLUTTER: 6, DOOR: 7, TRUNK: 8, EDGE: 9, ROOF: 10,
};
const SOLID_COLORS = {
  [T.WOOD]: 0xa9743f, [T.WALL]: 0xe6dcc6, [T.FENCE]: 0xb08a5c, [T.LEAF]: 0x4f8f4a,
  [T.DOOR]: 0x7a3f2a, [T.TRUNK]: 0x5c3d24, [T.ROOF]: 0x8c4a3c,
};
const CARD_TONES = [0xc9a26b, 0xbd945c, 0xd4b07a, 0xb5895a, 0xcfa870].map(c => new THREE.Color(c));
const EDGE_TONES = [0x9c7a4c, 0x8f6f45, 0xa58352].map(c => new THREE.Color(c));
const CLUTTER_TONES = [0xd96a4f, 0x4f7fd9, 0xe8c74a, 0x6b6b7a, 0x58a56e, 0xd9d2c4, 0x9a5fc4].map(c => new THREE.Color(c));
const SOGGY = new THREE.Color(0x4a3524);

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

function boxTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(120,90,60,0.10)';
  for (let x = 3; x < 64; x += 5) g.fillRect(x, 0, 1, 64); // corrugation
  g.strokeStyle = 'rgba(70,45,25,0.55)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 61);
  g.fillStyle = 'rgba(255,240,210,0.55)'; g.fillRect(0, 27, 64, 9); // packing tape
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.type = new Uint8Array(SX * SY * SZ);
    this.wet = new Float32Array(SX * SY * SZ);
    this.wetSet = new Set();
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.cardMat = new THREE.MeshLambertMaterial({ map: boxTexture() });
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
      if (!t) continue;
      if (t === T.CARD || t === T.EDGE) nCard++; else nSolid++;
    }
    ch.card = this.ensure(ch.card, nCard, this.cardMat);
    ch.solid = this.ensure(ch.solid, nSolid, this.solidMat);
    let a = 0, b = 0;
    const m = this._m, c = this._c;
    for (let y = 0; y < SY; y++) for (let z = z0; z < z0 + CH; z++) for (let x = x0; x < x0 + CH; x++) {
      const i = x + SX * (z + SZ * y), t = this.type[i];
      if (!t) continue;
      m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      const h = hash(i);
      if (t === T.CARD) {
        c.copy(CARD_TONES[h % CARD_TONES.length]).lerp(SOGGY, Math.min(1, this.wet[i]));
        ch.card.setMatrixAt(a, m); ch.card.setColorAt(a++, c);
      } else if (t === T.EDGE) {
        ch.card.setMatrixAt(a, m); ch.card.setColorAt(a++, EDGE_TONES[h % EDGE_TONES.length]);
      } else {
        if (t === T.CLUTTER) c.copy(CLUTTER_TONES[h % CLUTTER_TONES.length]);
        else { c.setHex(SOLID_COLORS[t]); c.multiplyScalar(0.92 + (h % 16) / 100); }
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
    mesh.userData.cap = cap; mesh.count = n;
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
  forts: [
    { team: 1, x: 24, z: 26, name: 'Box Knights', color: 0xd9483b },
    { team: 2, x: 104, z: 26, name: 'Alley Pirates', color: 0x8a4fd1 },
    { team: 3, x: 24, z: 100, name: 'Dino Scouts', color: 0x3fa35c },
  ],
  pools: [{ x: 73, z: 112 }, { x: 34, z: 62 }, { x: 96, z: 64 }, { x: 62, z: 30 }, { x: 102, z: 102 }],
};

export function generate(world, seed = 7) {
  const R = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const set = (x, y, z, t) => world.set(x, y, z, t);
  const fill = (x0, y0, z0, x1, y1, z1, t) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, t);
  };
  const shell = (x0, z0, x1, z1, h, t, roofT) => {
    for (let y = 0; y < h; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (x === x0 || x === x1 || z === z0 || z === z1) set(x, y, z, t);
    if (roofT) fill(x0, h, z0, x1, h, z1, roofT);
  };
  const loot = []; // {x,y,z,kind}

  // --- city boundary: looming stacks you can't melt or see past
  for (let i = 0; i < CITY; i++) for (let k = 0; k < 2; k++) {
    const h = () => ri(9, 13);
    fill(i, 0, k, i, h(), k, T.EDGE); fill(i, 0, CITY - 1 - k, i, h(), CITY - 1 - k, T.EDGE);
    fill(k, 0, i, k, h(), i, T.EDGE); fill(CITY - 1 - k, 0, i, CITY - 1 - k, h(), i, T.EDGE);
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
  reserve(50, 52, 82, 76);              // treehouse clearing + stairs
  reserve(60, 110, 69, 125);            // arrival street
  for (const p of PLACES.pools) reserve(p.x - 4, p.z - 4, p.x + 4, p.z + 4);
  for (const f of PLACES.forts) reserve(f.x - 13, f.z - 13, f.x + 13, f.z + 13);

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
    for (let y = 10; y <= 13; y++) {                          // canopy
      const r = y === 13 ? 4 : y === 10 ? 6 : 8;
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r + 2) set(x, y, z, T.LEAF);
    }
  }

  // --- tribe forts
  for (const f of PLACES.forts) {
    const { x: cx, z: cz } = f;
    shell(cx - 10, cz - 10, cx + 10, cz + 10, 4, T.CARD);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      shell(cx + sx * 10 - 1, cz + sz * 10 - 1, cx + sx * 10 + 1, cz + sz * 10 + 1, 7, T.CARD, T.CARD);
    // gate on the side facing the middle of the city
    const gx = cx < 64 ? cx + 10 : cx - 10;
    fill(gx, 0, cz - 1, gx, 2, cz + 1, T.AIR);
    shell(cx - 2, cz - 2, cx + 2, cz + 2, 3, T.CARD, T.CARD); // sealed keep holding the flag
  }

  // --- buildings: hollow boxes, some with doors, some you have to melt into
  for (let n = 0; n < 900; n++) {
    const w = ri(4, 9), d = ri(4, 9), h = ri(2, 6);
    const x0 = ri(3, CITY - 4 - w), z0 = ri(3, CITY - 4 - d), x1 = x0 + w - 1, z1 = z0 + d - 1;
    if (!free(x0 - 2, z0 - 2, x1 + 2, z1 + 2)) continue;
    reserve(x0, z0, x1, z1);
    const roofed = R() < 0.7;
    shell(x0, z0, x1, z1, h, T.CARD, roofed ? T.CARD : 0);
    if (R() < 0.55) { // doorway
      const side = ri(0, 3);
      const dx = side < 2 ? ri(x0 + 1, x1 - 1) : (side === 2 ? x0 : x1);
      const dz = side < 2 ? (side === 0 ? z0 : z1) : ri(z0 + 1, z1 - 1);
      fill(dx, 0, dz, dx, 1, dz, T.AIR);
    }
    if (h >= 3) for (let k = 0; k < 3; k++) { // windows
      const side = ri(0, 3);
      const wx = side < 2 ? ri(x0 + 1, x1 - 1) : (side === 2 ? x0 : x1);
      const wz = side < 2 ? (side === 0 ? z0 : z1) : ri(z0 + 1, z1 - 1);
      set(wx, ri(1, h - 1), wz, T.AIR);
    }
    if (roofed && R() < 0.35 && w > 5 && d > 5) { // a box on top of the box
      const hh = h + ri(2, 3);
      for (let y = h + 1; y <= hh; y++) for (let z = z0 + 1; z <= z0 + 3; z++) for (let x = x0 + 1; x <= x0 + 3; x++)
        if (y === hh || x === x0 + 1 || x === x0 + 3 || z === z0 + 1 || z === z0 + 3) set(x, y, z, T.CARD);
    }
    if (R() < 0.7) {
      const k = R();
      loot.push({ x: (x0 + x1 + 1) / 2, y: 0, z: (z0 + z1 + 1) / 2, kind: k < 0.6 ? 'caps' : k < 0.8 ? 'balloon' : 'bottle' });
    }
    if (roofed && R() < 0.25) loot.push({ x: x0 + 1.5, y: h + 1, z: z1 - 0.5, kind: 'caps' });
  }

  // --- long walls that cut streets off (melt through or go around)
  for (let n = 0; n < 40; n++) {
    const horiz = R() < 0.5, len = ri(8, 22), h = ri(2, 4);
    const x0 = ri(4, CITY - 5 - (horiz ? len : 0)), z0 = ri(4, CITY - 5 - (horiz ? 0 : len));
    const x1 = horiz ? x0 + len : x0, z1 = horiz ? z0 : z0 + len;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (!mask[x + CITY * z]) fill(x, 0, z, x, h - 1 - (R() < 0.15 ? 1 : 0), z, T.CARD);
  }
  // --- loose stacks
  for (let n = 0; n < 420; n++) {
    const x = ri(3, CITY - 4), z = ri(3, CITY - 4);
    if (mask[x + CITY * z]) continue;
    fill(x, 0, z, x, ri(0, 2), z, T.CARD);
  }
  // a few crates inside each fort for cover
  for (const f of PLACES.forts) for (let n = 0; n < 14; n++) {
    const x = f.x + ri(-8, 8), z = f.z + ri(-8, 8);
    if (Math.abs(x - f.x) < 4 && Math.abs(z - f.z) < 4) continue;
    if (Math.abs(z - f.z) < 2) continue; // keep the gate lane open
    fill(x, 0, z, x, ri(0, 1), z, T.CARD);
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
  return { loot };
}
