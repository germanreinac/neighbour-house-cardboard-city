// Voxel world: one grid holds the house, the backyard and Cardboard City.
// Cardboard gets soggy when hit by water and collapses; everything else is solid.
import * as THREE from '../vendor/three.module.min.js';

export const SX = 128, SY = 14, SZ = 224;
export const CITY = 128; // city occupies z in [0, CITY)

export const T = {
  AIR: 0, CARD: 1, WOOD: 2, WALL: 3, FENCE: 4, LEAF: 5, CLUTTER: 6, DOOR: 7, TRUNK: 8, EDGE: 9, ROOF: 10,
  GHOST: 11, // solid but not drawn: the collision under the tall non-voxel towers
  // Types from here up are cardboard that is drawn as its own mesh rather than a cube.
  RAMP: 12,  // 12..23: a slope. (t-12)&3 is the uphill direction (+x, +z, -x, -z); (t-12)>>2 is full, lower half, upper half
  FLAP: 24,  // a closed cardboard door
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
vec3 skinGlow;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 cardSkin(vec3 wp, vec3 n){
  skinGlow = vec3(0.0);
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
      if (wr > 0.84) skinGlow = vec3(1.0, 0.72, 0.25) * (1.0 - smoothstep(0.0, waa, sd)) * (0.55 + 0.25 * sin(wi.x * 12.9 + wi.y * 7.1));
      col = mix(col, pane, (1.0 - smoothstep(0.0, waa, sd)) * 0.9);
      float line = 1.0 - smoothstep(0.035, 0.035 + waa, abs(sd));
      float bars = (1.0 - smoothstep(0.02, 0.02 + waa, min(abs(wf.x - W.x * 0.5), abs(wf.y - W.y * 0.5)))) * step(sd, 0.0);
      col = mix(col, vec3(0.05, 0.04, 0.04), max(line, bars) * 0.9);
    }
  }
  return col;
}`;
// The diorama camera looks down into the city, so anything between it and your kid has to get out
// of the way. Fragments inside a cone from the camera (a) to the kid (b) are thrown away.
export const CUT = { a: { value: new THREE.Vector3() }, b: { value: new THREE.Vector3() }, r: { value: 0 }, y: { value: 99 } };
const CUT_GLSL = /* glsl */`
uniform vec3 uCutA; uniform vec3 uCutB; uniform float uCutR; uniform float uCutY;
void cutAway(vec3 wp){
  if (uCutR <= 0.0) return;
  if (wp.y > uCutY) discard; // the dollhouse slice: nothing far above your head
  vec3 ab = uCutB - uCutA; float t = dot(wp - uCutA, ab) / dot(ab, ab);
  if (t > 0.0 && t < 0.965 && length(wp - (uCutA + ab * t)) < uCutR * (0.3 + 0.7 * t)) discard;
}`;
function worldMaterial(skin) {
  const mat = new THREE.MeshLambertMaterial();
  mat.customProgramCacheKey = () => (skin ? 'card' : 'plain'); // same hook function, two different shaders
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCutA = CUT.a; sh.uniforms.uCutB = CUT.b; sh.uniforms.uCutR = CUT.r; sh.uniforms.uCutY = CUT.y;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vONrm;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vONrm = normal; vec4 wpC = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpC = instanceMatrix * wpC;
        #endif
        vWPos = (modelMatrix * wpC).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vONrm;\n' + CUT_GLSL + (skin ? SKIN : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\ncutAway(vWPos);' + (skin ? '\ndiffuseColor.rgb *= cardSkin(vWPos, vONrm);' : ''));
    if (skin) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += skinGlow;');
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
    this.cardMat = worldMaterial(true);
    this.solidMat = worldMaterial(false);
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
  // What stops a walking body. Ramps don't: you walk into them and are lifted onto the slope.
  blocks(x, y, z) {
    if (!this.solid(x, y, z)) return false;
    const t = this.get(x, y, z); return t < T.RAMP || t > 23;
  }
  // Height of the slope under a body at (px,py,pz), or null. The uphill edge of the body leads,
  // so you reach the top exactly as you reach the next cell.
  floorAt(px, py, pz, r) {
    const x = Math.floor(px), z = Math.floor(pz);
    for (let y = Math.floor(py + 0.45); y >= Math.floor(py - 0.45) && y >= 0; y--) {
      const t = this.get(x, y, z); if (t < T.RAMP || t > 23) continue;
      const d = (t - 12) & 3, part = (t - 12) >> 2, fx = px - x, fz = pz - z;
      const u = Math.min(1, Math.max(0, (d === 0 ? fx : d === 1 ? fz : d === 2 ? 1 - fx : 1 - fz) + r));
      const h0 = part === 2 ? 0.5 : 0, h1 = part === 1 ? 0.5 : 1;
      return y + h0 + (h1 - h0) * u;
    }
    return null;
  }
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
    if (this.type[i] !== T.CARD && this.type[i] < T.RAMP) return false; // ramps and doors are cardboard too
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
          if (this.blocks(x, y, z)) return false;
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
      if (!t || t >= T.GHOST) continue;
      if (t === T.CARD || t === T.EDGE) nCard++; else nSolid++;
    }
    ch.card = this.ensure(ch.card, nCard, this.cardMat);
    ch.solid = this.ensure(ch.solid, nSolid, this.solidMat);
    let a = 0, b = 0;
    const m = this._m, c = this._c;
    for (let y = 0; y < SY; y++) for (let z = z0; z < z0 + CH; z++) for (let x = x0; x < x0 + CH; x++) {
      const i = x + SX * (z + SZ * y), t = this.type[i];
      if (!t || t >= T.GHOST) continue;
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
  citySpawn: { x: 64.5, z: 122.5 },
  crate: { x: 64.5, z: 117.5 },      // Milo's first note and his spare squirter
  tree: { x: 64.5, z: 64.5 },
  respawn: { x: 80.5, z: 64.5 },
  shop: { x: 58.9, z: 61 },
  yard: [],
  forts: [],                          // the open-world tribes are not part of the story level
  pools: [
    { x: 24, z: 116, owner: 0, name: 'Corner pool' }, { x: 17, z: 78, owner: 0, name: 'Narrows pool' },
    { x: 115, z: 14, owner: 0, name: 'Far pool' }, { x: 84, z: 57, owner: 0, name: 'Treehouse pool' },
  ],
};

// The story level: a spiral of four gated districts around the Treehouse.
// South band (west) -> west band -> north band -> east band -> through the ring wall to the middle.
export const LEVEL = {
  districts: [
    { name: 'Checkpoint Street', tribe: 1, who: 'The Box Knights' },
    { name: 'The Narrows', tribe: 2, who: 'The Alley Pirates' },
    { name: 'The Dry District', tribe: 3, who: 'The Dino Scouts' },
    { name: 'Lights Out', tribe: 1, who: 'The night shift' },
    { name: 'The Treehouse', tribe: 0, who: '' },
  ],
  notes: [
    { x: 64.5, z: 117.5, text: 'If you\'re reading this, you came. Take my spare squirter. Water melts cardboard. Find me at the Treehouse. —Milo' },
    { x: 47.5, z: 111.5, text: 'Day 2. The city is bigger than the backyard. I measured. I ran out of string.' },
    { x: 19.5, z: 108.5, text: 'The Box Knights won\'t open the gate. They say they\'ve guarded it since last summer. Which summer?' },
    { x: 11.5, z: 90.5, text: 'Don\'t trust the cut-outs. They face a different way every time I come back.' },
    { x: 20.5, z: 56.5, text: 'It is always almost dinner time in here. The sun doesn\'t go down. It just stays like that.' },
    { x: 31.5, z: 13.5, text: 'I asked a Dino Scout where he lives. He pointed at a box. I asked since when. He said "now".' },
    { x: 86.5, z: 12.5, text: 'I can still hear my brother\'s music. It comes from above the clouds. The clouds are on strings.' },
    { x: 117.5, z: 39.5, text: 'The lights are out past here. Something moves when you look away. It\'s only cardboard. It\'s only cardboard.' },
    { x: 115.5, z: 92.5, text: 'I found a cut-out that looks like me. I didn\'t make it.' },
    { x: 90.5, z: 64.5, text: 'If you make it to the Treehouse, don\'t let them measure you.' },
  ],
  guards: [], gates: [], lamps: [], arrows: [], cars: [], vendors: [], creepers: [], lookouts: [],
};
export function districtAt(x, z) {
  if (Math.max(Math.abs(x - 64), Math.abs(z - 64)) <= 35) return 4;
  if (z >= 100) return 0;
  if (z <= 28) return 2;
  return x < 64 ? 1 : 3;
}

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
  const loot = [], flaps = [], signs = [], towers = [], shops = [], standees = [], ramps = [], doors = [];
  const L = LEVEL;
  // one cell of slope, with boxes stacked under it
  const ramp = (x, y, z, dir, part = 0, stairs = false) => {
    if (y > 0) fill(x, 0, z, x, y - 1, z, T.CARD);
    set(x, y, z, T.RAMP + part * 4 + dir); ramps.push({ x, y, z, dir, part, stairs });
  };

  // mask: 0 free to build on, 1 a building (others keep a gap from it), 2 kept clear (route, plazas, walls)
  const mask = new Uint8Array(CITY * CITY);
  const mark = (x0, z0, x1, z1, v) => {
    for (let z = Math.max(0, z0); z <= Math.min(CITY - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(CITY - 1, x1); x++) mask[x + CITY * z] = v;
  };
  const reserve = (x0, z0, x1, z1) => mark(x0, z0, x1, z1, 2);
  const free = (x0, z0, x1, z1, m) => {
    if (x0 < 3 || z0 < 3 || x1 > CITY - 4 || z1 > CITY - 4) return false;
    for (let z = z0 - m; z <= z1 + m; z++) for (let x = x0 - m; x <= x1 + m; x++) {
      const v = mask[x + CITY * z], inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
      if (inside ? v : v === 1) return false;
    }
    return true;
  };

  // --- outer boundary and the giant boxes behind it
  for (let i = 0; i < CITY; i++) for (let k = 0; k < 2; k++) {
    const h = () => ri(9, 13);
    fill(i, 0, k, i, h(), k, T.EDGE); fill(i, 0, CITY - 1 - k, i, h(), CITY - 1 - k, T.EDGE);
    fill(k, 0, i, k, h(), i, T.EDGE); fill(CITY - 1 - k, 0, i, CITY - 1 - k, h(), i, T.EDGE);
  }
  for (let side = 0; side < 4; side++) for (let i = -4; i < CITY + 4; i += ri(7, 11)) {
    const o = side % 2 ? CITY + 5 : -5, w = ri(9, 13);
    towers.push({ x: side < 2 ? i : o, z: side < 2 ? o : i, y0: 0, w, d: w, h: ri(22, 44), yaw: (R() - 0.5) * 0.3, tilt: (R() - 0.5) * 0.06 });
  }

  // --- the ring wall around the middle of the city, topped with towers
  for (let z = 29; z <= 99; z++) for (let x = 29; x <= 99; x++) {
    const m = Math.max(Math.abs(x - 64), Math.abs(z - 64));
    if (m < 31) continue;
    mask[x + CITY * z] = 2;
    if (m === 31 || m === 35) fill(x, 0, z, x, 11, z, T.EDGE);
    if (m === 33) set(x, 11, z, T.EDGE);
  }
  for (let i = 31; i <= 97; i += 7) for (const [x, z] of [[i, 31], [i, 97], [31, i], [97, i]])
    towers.push({ x: x + 0.5, z: z + 0.5, y0: 11.5, w: 6.4, d: 6.4, h: ri(8, 26), yaw: (R() - 0.5) * 0.2, tilt: (R() - 0.5) * 0.05, top: R() < 0.5 });
  // the tube through the ring, east side, into the Treehouse grounds
  fill(95, 0, 62, 99, 3, 66, T.EDGE); fill(95, 0, 63, 99, 2, 65, T.AIR);
  // the south band is cut in two just east of the arrival street; nothing beyond it is reachable
  fill(70, 0, 100, 71, 11, 125, T.EDGE); mark(70, 100, 71, 125, 2);
  fill(100, 0, 100, 125, 11, 101, T.EDGE); mark(100, 100, 125, 101, 2); // and the east band stops here too

  // --- gates between districts: wooden fences with a door that opens when the guards are soaked
  const gate = (x0, z0, x1, z1, gx0, gz0, gx1, gz1, district) => {
    fill(x0, 0, z0, x1, 7, z1, T.FENCE); fill(x0, 8, z0, x1, SY - 1, z1, T.GHOST); mark(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 2);
    fill(gx0, 0, gz0, gx1, 2, gz1, T.DOOR);
    L.gates.push({ district, x0: gx0, z0: gz0, x1: gx1, z1: gz1, x: (gx0 + gx1 + 1) / 2, z: (gz0 + gz1 + 1) / 2, open: false });
  };
  gate(2, 99, 28, 99, 14, 99, 16, 99, 0);       // Checkpoint Street -> The Narrows
  gate(2, 28, 28, 28, 14, 28, 16, 28, 1);       // The Narrows -> The Dry District
  gate(100, 28, 125, 28, 111, 28, 113, 28, 2);  // The Dry District -> Lights Out
  fill(99, 0, 63, 99, 2, 65, T.DOOR);           // Lights Out -> the tube
  L.gates.push({ district: 3, x0: 99, z0: 63, x1: 99, z1: 65, x: 99.5, z: 64.5, open: false });

  // --- the route. Walking it drops lamps, chalk arrows and cardboard barricades as it goes.
  const barricades = [];
  const walk = (pts, w, o = {}) => {
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let t = 0; t <= len; t += 0.5) {
        const x = ax + dx * t, z = az + dz * t;
        reserve(Math.floor(x - w / 2), Math.floor(z - w / 2), Math.floor(x + w / 2), Math.floor(z + w / 2));
        acc += 0.5;
        if (acc % 12 < 0.5) L.lamps.push({ x: x - dz * (w / 2 + 0.75), z: z + dx * (w / 2 + 0.75), dead: !!o.dark && (L.lamps.length % 4 !== 0), dx: dz, dz: -dx });
        if ((acc + 5) % 10 < 0.5) L.arrows.push({ x, z, yaw: Math.atan2(-dx, -dz) });
        if (o.walls && o.walls.some(d => Math.abs(acc - d) < 0.25)) barricades.push({ x, z, nx: -dz, nz: dx, w });
      }
    }
  };
  reserve(63, 104, 66, 125);                                                                        // arrival street
  walk([[64.5, 106], [52, 109], [44, 116], [33, 111], [24, 116], [15, 111], [15.5, 101]], 3, { walls: [16, 44] });
  walk([[15.5, 97], [10, 89], [17, 78], [11, 68], [21, 58], [10, 48], [18, 38], [15.5, 30]], 2, { walls: [20, 52, 70] });
  walk([[15.5, 26], [14, 15], [30, 12], [44, 20], [58, 10], [72, 18], [86, 10], [100, 17], [112, 13], [112.5, 26]], 3, { walls: [30, 62, 96] });
  walk([[112.5, 30], [118, 40], [106, 48], [112, 58], [104, 64.5], [100.5, 64.5]], 2, { dark: true, walls: [22] });
  walk([[112, 58], [117, 72], [108, 84], [116, 93]], 2, { dark: true, walls: [26] });           // a dead end worth finding
  walk([[94, 64.5], [79, 64.5]], 3);
  reserve(52, 53, 85, 76);                                                                          // treehouse clearing
  for (const [x0, z0, x1, z1] of [[36, 110, 51, 122], [13, 100, 27, 105], [5, 61, 22, 72], [50, 8, 66, 24], [100, 51, 120, 56]]) reserve(x0, z0, x1, z1); // high ground
  for (const p of PLACES.pools) { reserve(p.x - 4, p.z - 4, p.x + 4, p.z + 4); L.vendors.push({ x: p.x - 3.5, z: p.z - 3.5 }); }
  for (const n of L.notes) reserve(Math.floor(n.x) - 1, Math.floor(n.z) - 1, Math.floor(n.x) + 1, Math.floor(n.z) + 1);

  // who holds each gate
  const post = (district, team, list) => { for (const [x, z] of list) { L.guards.push({ district, team, x: x + 0.5, z: z + 0.5 }); reserve(x - 1, z - 1, x + 1, z + 1); } };
  post(0, 1, [[14, 104], [17, 106], [19, 112]]);
  post(1, 2, [[16, 34], [13, 42], [19, 40], [11, 52]]);
  post(2, 3, [[104, 16], [110, 20], [100, 12], [113, 23], [92, 14]]);
  post(3, 1, [[105, 62], [110, 56], [108, 50], [114, 60], [103, 67]]);
  L.creepers.push({ x: 117.5, z: 44.5 }, { x: 109.5, z: 52.5 }, { x: 113.5, z: 80.5 });
  L.cars.push([63, 111], [66, 106], [42, 115], [70, 15], [98, 15]);
  for (const [x, z] of L.cars) reserve(x - 1, z - 1, x + 1, z + 3);

  // --- treehouse: real wood, water can't touch it
  {
    const cx = 64, cz = 64;
    fill(cx - 1, 0, cz - 1, cx + 1, 9, cz + 1, T.TRUNK);
    fill(57, 6, 57, 71, 6, 71, T.WOOD);
    for (let i = 57; i <= 71; i++) {
      set(i, 7, 57, T.WOOD); set(i, 7, 71, T.WOOD); set(57, 7, i, T.WOOD);
      if (i < 63 || i > 65) set(71, 7, i, T.WOOD);
    }
    for (const [px, pz] of [[57, 57], [71, 57], [57, 71], [71, 71]]) fill(px, 0, pz, px, 9, pz, T.WOOD);
    for (let i = 0; i < 6; i++) fill(77 - i, 0, 63, 77 - i, i, 65, T.WOOD);
    fill(60, 7, 59, 60, 7, 62, T.WOOD);
  }

  // --- the city: boxes packed tight around the route, towers stacked on top
  const SHOPS = 10;
  for (let n = 0; n < 12000; n++) {
    const small = n > 4500;
    const w = small ? ri(3, 6) : ri(5, 11), d = small ? ri(3, 6) : ri(5, 11), h = ri(4, 7), m = small || R() < 0.7 ? 1 : 2;
    const x0 = ri(3, CITY - 4 - w), z0 = ri(3, CITY - 4 - d), x1 = x0 + w - 1, z1 = z0 + d - 1;
    if (!free(x0, z0, x1, z1, m)) continue;
    mark(x0, z0, x1, z1, 1);
    const tall = R() < 0.85;
    shell(x0, z0, x1, z1, h, T.CARD, tall || R() < 0.5 ? T.CARD : 0);
    let top = h + 1;
    if (tall) {
      let sw = w, sd = d, y = h + 1;
      const cx = (x0 + x1 + 1) / 2, cz = (z0 + z1 + 1) / 2, k0 = ri(1, 3);
      for (let k = k0; k > 0; k--) {
        sw = Math.max(3, sw - R() * 1.6); sd = Math.max(3, sd - R() * 1.6);
        const sh = ri(4, 12);
        towers.push({ x: cx + (R() - 0.5) * 0.8, z: cz + (R() - 0.5) * 0.8, y0: y, w: sw, d: sd, h: sh, yaw: (R() - 0.5) * 0.16, tilt: (R() - 0.5) * 0.05, top: k === 1, base: k0 === k });
        y += sh;
      }
      shell(x0, z0, x1, z1, SY, T.GHOST, 0, h + 1);
      top = y;
    }
    const loft = h >= 6 && w >= 7 && d >= 5 && R() < 0.7; // an upstairs, reached by a ramp along the near wall
    const doorSide = loft ? ri(1, 3) : ri(0, 3);
    for (let side = 0; side < 4; side++) {
      const horiz = side < 2, near = side % 2 === 0, len = horiz ? w : d;
      const fx = horiz ? (x0 + x1 + 1) / 2 : (near ? x0 : x1 + 1), fz = horiz ? (near ? z0 : z1 + 1) : (z0 + z1 + 1) / 2;
      const dx = horiz ? 0 : (near ? -1 : 1), dz = horiz ? (near ? -1 : 1) : 0;
      const sx = horiz ? Math.floor(fx) : (near ? x0 : x1), sz = horiz ? (near ? z0 : z1) : Math.floor(fz);
      if (R() < 0.4) flaps.push({ x: fx, y: tall ? top : h, z: fz, len: len - 0.3, dx, dz, a: R() * 1.5 - 0.45, sup: tall ? null : [sx, h - 1, sz] });
      if (side === doorSide) {
        if (loft || R() < 0.7) {
          const dxx = horiz ? ri(x0 + 1, x1 - 1) : sx, dzz = horiz ? sz : ri(z0 + 1, z1 - 1);
          fill(dxx, 0, dzz, dxx, 1, dzz, T.AIR);
          if (R() < 0.75) { fill(dxx, 0, dzz, dxx, 1, dzz, T.FLAP); doors.push({ x: dxx, z: dzz, horiz }); } // a door you can push open
        }
      } else if (len >= 6 && R() < 0.34) {
        shops.push({ x: horiz ? sx + 0.5 : fx, z: horiz ? fz : sz + 0.5, dx, dz, ax: horiz ? 1 : 0, az: horiz ? 0 : 1, sx, sz, kind: ri(0, SHOPS - 1) });
      } else if (R() < 0.16) signs.push({ x: fx, y: 1.5 + R() * 0.5, z: fz, dx, dz, sup: [sx, 1, sz] });
      else if (h >= 5 && R() < 0.5) {
        const wx = horiz ? ri(x0 + 1, x1 - 1) : sx, wz = horiz ? sz : ri(z0 + 1, z1 - 1);
        set(wx, ri(2, h - 2), wz, T.AIR);
      }
    }
    if (loft) {
      for (let z = z0 + 1; z < z1; z++) for (let x = x0 + 1; x < x1; x++) if (z > z0 + 1 || x >= x0 + 5) set(x, 3, z, T.CARD);
      for (let i = 0; i < 4; i++) ramp(x0 + 1 + i, i, z0 + 1, 0, 0, i % 2 === 0);
      for (let k = 0; k < 2; k++) { // a balcony opening or two upstairs
        const side = ri(1, 3), wx = side === 1 ? ri(x0 + 1, x1 - 1) : (side === 2 ? x0 : x1), wz = side === 1 ? z1 : ri(z0 + 2, z1 - 1);
        fill(wx, 4, wz, wx, Math.min(5, h - 1), wz, T.AIR);
      }
      loot.push({ x: x1 - 0.5, y: 4, z: z1 - 0.5, kind: R() < 0.5 ? 'caps' : R() < 0.5 ? 'balloon' : 'bottle' });
    }
    if (R() < 0.6) {
      const k = R();
      loot.push({ x: (x0 + x1 + 1) / 2, y: 0, z: (z0 + z1 + 1) / 2, kind: k < 0.6 ? 'caps' : k < 0.8 ? 'balloon' : 'bottle' });
    }
  }

  // --- barricades across the route: the tribes taped the street shut. Melt through.
  fill(61, 0, 109, 68, 2, 109, T.CARD);
  for (const b of barricades) for (let k = -b.w / 2 - 2.5; k <= b.w / 2 + 2.5; k += 0.5) {
    const x = Math.floor(b.x + b.nx * k), z = Math.floor(b.z + b.nz * k);
    if (!world.get(x, 0, z)) fill(x, 0, z, x, 2, z, T.CARD);
  }
  // --- high ground along the route, all of it cardboard and all of it meltable
  { // The Stacks: a loading dock with a long ramp on one side and steps on the other
    fill(41, 0, 117, 46, 1, 120, T.CARD);
    for (const z of [118, 119]) { ramp(37, 0, z, 0, 1); ramp(38, 0, z, 0, 2); ramp(39, 1, z, 0, 1); ramp(40, 1, z, 0, 2); ramp(48, 0, z, 2, 0, true); ramp(47, 1, z, 2, 0, true); }
    L.lookouts.push({ team: 1, x: 43.5, y: 2, z: 119.5 }); loot.push({ x: 45.5, y: 2, z: 117.5, kind: 'balloon' });
  }
  { // the Knights' watchtower by the first gate
    for (const [x, z] of [[18, 101], [21, 101], [18, 103], [21, 103]]) fill(x, 0, z, x, 2, z, T.CARD);
    fill(18, 3, 101, 21, 3, 103, T.CARD);
    for (let i = 0; i < 4; i++) ramp(25 - i, i, 102, 2, 0, true);
    L.lookouts.push({ team: 1, x: 19.5, y: 4, z: 102.5 });
  }
  { // a footbridge over The Narrows
    fill(6, 3, 66, 20, 3, 67, T.CARD);
    for (let i = 0; i < 4; i++) for (const x of [19, 20]) ramp(x, i, 71 - i, 3, 0, true);
    for (let i = 0; i < 4; i++) for (const x of [6, 7]) ramp(x, i, 62 + i, 1, 0, true);
    L.lookouts.push({ team: 2, x: 13.5, y: 4, z: 66.5 }); loot.push({ x: 9.5, y: 4, z: 67.5, kind: 'caps' });
  }
  { // the box pyramid in The Dry District, with a full bottle on top
    fill(53, 0, 11, 63, 0, 21, T.CARD); fill(55, 1, 13, 61, 1, 19, T.CARD); fill(57, 2, 15, 59, 2, 17, T.CARD);
    for (let i = 0; i < 3; i++) { ramp(52 + i * 2, i, 16, 0, 0, true); ramp(64 - i * 2, i, 16, 2, 0, true); ramp(58, i, 10 + i * 2, 1, 0, true); ramp(58, i, 22 - i * 2, 3, 0, true); }
    L.lookouts.push({ team: 3, x: 55.5, y: 2, z: 13.5 }, { team: 3, x: 61.5, y: 2, z: 19.5 }); loot.push({ x: 58.5, y: 3, z: 15.5, kind: 'bottle' });
  }
  { // a catwalk through Lights Out
    fill(104, 2, 53, 116, 2, 54, T.CARD);
    for (const z of [53, 54]) for (let i = 0; i < 3; i++) { ramp(101 + i, i, z, 0); ramp(119 - i, i, z, 2); }
    loot.push({ x: 110.5, y: 3, z: 53.5, kind: 'caps' });
  }
  // loose boxes for cover along the way
  for (let n = 0; n < 220; n++) {
    const x = ri(3, CITY - 4), z = ri(3, CITY - 4);
    if (mask[x + CITY * z] !== 2 || world.get(x, 0, z) || districtAt(x, z) === 4) continue;
    if (L.guards.some(g => Math.hypot(g.x - x, g.z - z) < 1.6) || PLACES.pools.some(p => Math.hypot(p.x - x, p.z - z) < 4) || (Math.abs(x - 64) < 3 && z > 114)) continue;
    if (R() < 0.1) fill(x, 0, z, x, 0, z, T.CARD);
  }
  // cardboard cut-out kids standing around the alleys
  for (let n = 0; n < 4000 && standees.length < 60; n++) {
    const x = ri(4, CITY - 5), z = ri(4, CITY - 5);
    if (world.solid(x, 0, z) || world.solid(x, 1, z) || (x > 70 && z > 100) || districtAt(x, z) === 4) continue;
    if (Math.abs(x - 64.5) < 3 && z > 112) continue;
    standees.push({ x: x + 0.5, z: z + 0.5, yaw: R() * 6.28, team: ri(1, 3) });
  }

  // --- the house (front door faces +z, you walk -z through it)
  {
    fill(56, 0, 196, 72, 3, 212, T.WALL); fill(57, 0, 197, 71, 3, 211, T.AIR);
    fill(55, 4, 195, 73, 4, 213, T.ROOF); fill(58, 5, 198, 70, 5, 210, T.ROOF);
    fill(64, 0, 212, 64, 1, 212, T.DOOR); fill(64, 0, 196, 64, 1, 196, T.DOOR);
    for (const wx of [59, 60, 68, 69]) { set(wx, 1, 212, T.AIR); set(wx, 2, 212, T.AIR); }
    fill(57, 0, 205, 61, 3, 205, T.WALL); fill(67, 0, 205, 71, 3, 205, T.WALL);
    const H = mulberry32(99);
    for (let n = 0; n < 120; n++) {
      const x = 57 + Math.floor(H() * 15), z = 197 + Math.floor(H() * 15);
      if (world.get(x, 0, z)) continue;
      if (Math.abs(x - 64) <= 1 && (z > 208 || z < 199 || (z > 203 && z < 207))) continue;
      if (x === 64 && H() < 0.6) continue;
      fill(x, 0, z, x, H() < 0.2 ? 1 : 0, z, T.CLUTTER);
    }
    fill(58, 0, 200, 58, 0, 203, T.CLUTTER); fill(57, 0, 200, 57, 1, 203, T.CLUTTER);
    fill(54, 0, 175, 54, 2, 196, T.FENCE); fill(74, 0, 175, 74, 2, 196, T.FENCE); fill(54, 0, 175, 74, 2, 175, T.FENCE);
    fill(54, 0, 196, 55, 2, 196, T.FENCE); fill(73, 0, 196, 74, 2, 196, T.FENCE);
    for (let z = 176; z <= 183; z++) for (let x = 57; x <= 71; x++) {
      const hgt = Math.round(5.5 - Math.abs(x - 64) * 0.55 - (z - 176) * 0.35 + H() * 1.6);
      if (hgt > 0) fill(x, 0, z, x, Math.min(hgt, 6) - 1, z, T.CARD);
    }
    fill(63, 0, 177, 65, 2, 183, T.CARD); fill(64, 0, 178, 64, 1, 183, T.AIR);
    fill(62, 0, 184, 62, 0, 184, T.CARD); fill(67, 0, 185, 67, 1, 185, T.CARD); fill(60, 0, 186, 60, 0, 186, T.CARD);
  }
  world.orig = world.type.slice();
  return { loot, flaps, signs, towers, shops, standees, ramps, doors };
}
