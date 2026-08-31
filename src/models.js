/**
 * Procedural ship + structure geometry. No external assets — every hull is
 * built from primitives here, merged down to one geometry per material slot
 * so the renderer can draw a whole ship class with a handful of InstancedMesh
 * draw calls instead of thousands of individual meshes.
 *
 * Each builder returns parts keyed by material slot:
 *   hull   - painted metal, takes the faction/type colour
 *   dark   - engine housings, greebles, recesses
 *   glow   - emissive engine bells and running lights (additive-ish)
 *   canopy - tinted glass
 *
 * Ships are modelled nose-down -Z, which is what steerTowards() expects.
 *
 * One hull (the Falcon) is no longer built here: it is an imported glTF asset
 * that replaces this module's version in the same cache at load time. See
 * hulls.js / hullImport.js. Its builder is kept as the fallback.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { detailTexture, DETAIL_TILE } from './textures.js';
import { GFX } from './config.js';

const SLOTS = ['hull', 'dark', 'glow', 'canopy'];

// ---------------------------------------------------------------------------
// Triplanar surface detail.
//
// Every live hull/dark material registers its uniforms here so the look toggle
// can fade the whole effect in and out in one pass. At strength 0 the shader
// arithmetic collapses to exactly the old flat-material result, which is what
// makes CLASSIC a true before-picture rather than an approximation of one.
// ---------------------------------------------------------------------------
const detailUniforms = [];

export function setDetailStrength(v) {
  for (const u of detailUniforms) u.uDetail.value = v;
}

/**
 * Drop uniform references when a fleet's materials are disposed. Without this
 * the registry pins every material from every battle ever started, and
 * setDetailStrength walks a list that grows for the whole session.
 */
export function resetDetailRegistry() { detailUniforms.length = 0; }

/**
 * Project the detail texture from all three object-space axes and blend by
 * normal. See textures.js for why UVs are unusable on these hulls.
 *
 * Object space, not world space: the texture has to travel with the ship. A
 * world-space projection makes the plating swim across the hull as it flies,
 * which is far more distracting than having no plating at all.
 */
function applyDetail(mat, { albedo, rough, bump }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPanel = { value: detailTexture() };
    // Seed from the live preset, NOT from zero. Shader programs compile lazily
    // at first render, so a preset applied before that point would push into an
    // empty registry and be lost — leaving uDetail pinned at 0 for the rest of
    // the session. Whether that happened was a genuine race against the first
    // frame, which is exactly the kind of bug that looks like "the texture just
    // doesn't work sometimes".
    shader.uniforms.uDetail = { value: GFX.detail };
    shader.uniforms.uTile = { value: 1 / DETAIL_TILE };
    shader.uniforms.uAlbedo = { value: albedo };
    shader.uniforms.uRough = { value: rough };
    shader.uniforms.uBump = { value: bump };
    detailUniforms.push(shader.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos;
        varying vec3 vObjNrm;`)
      // `transformed` and `objectNormal` are the geometry's own coordinates,
      // before the instance and model matrices — exactly what is wanted, since
      // the instance matrix is where per-ship position and display scale live.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObjPos = transformed;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vObjNrm = objectNormal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uPanel;
        uniform float uDetail, uTile, uAlbedo, uRough, uBump;
        varying vec3 vObjPos;
        varying vec3 vObjNrm;

        vec3 triplanar() {
          vec3 n = normalize(vObjNrm);
          // A high power narrows the blend band so seams meet crisply at
          // edges instead of smearing a quarter of the way across each face.
          vec3 w = pow(abs(n), vec3(6.0));
          w /= max(w.x + w.y + w.z, 1e-4);
          vec3 p = vObjPos * uTile;
          return texture2D(uPanel, p.zy).rgb * w.x
               + texture2D(uPanel, p.xz).rgb * w.y
               + texture2D(uPanel, p.xy).rgb * w.z;
        }`)
      // After <color_fragment> so this multiplies on top of the per-instance
      // damage flash rather than being overwritten by it.
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 detail = triplanar();
        diffuseColor.rgb *= 1.0 + (detail.r - 0.5) * 2.0 * uAlbedo * uDetail;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(
          roughnessFactor + (detail.g - 0.5) * 2.0 * uRough * uDetail, 0.04, 1.0);`)
      // Bump from the height channel by screen-space derivative. This is the
      // standard derivative-based perturbation: no tangents needed, which
      // matters because merged primitive soups have none.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uBump * uDetail > 0.001) {
          float h = detail.b;
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
          normal = normalize(abs(det) * normal - uBump * uDetail * grad);
        }`);
  };
  // Changing onBeforeCompile requires a new program; this key tells three.js
  // that these materials can share one rather than compiling per instance.
  mat.customProgramCacheKey = () => `detail:${albedo}:${rough}:${bump}`;
  return mat;
}

class Builder {
  constructor() {
    this.parts = { hull: [], dark: [], glow: [], canopy: [] };
  }
  add(slot, geo, { pos, rot, scale, quat } = {}) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (quat) q.copy(quat);
    else if (rot) q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    m.compose(
      new THREE.Vector3(...(pos || [0, 0, 0])),
      q,
      new THREE.Vector3(...(scale || [1, 1, 1])),
    );
    geo.applyMatrix4(m);
    this.parts[slot].push(geo);
    return this;
  }
  /** Add a part and its mirror across X — most ships are symmetrical. */
  addPair(slot, geoFactory, opts) {
    this.add(slot, geoFactory(), opts);
    const mirrored = { ...opts };
    mirrored.pos = [-opts.pos[0], opts.pos[1], opts.pos[2]];
    if (opts.rot) mirrored.rot = [opts.rot[0], -opts.rot[1], -opts.rot[2]];
    this.add(slot, geoFactory(), mirrored);
    return this;
  }
  build() {
    const out = {};
    for (const s of SLOTS) {
      if (!this.parts[s].length) continue;
      const merged = mergeGeometries(this.parts[s], false);
      if (merged) {
        merged.computeVertexNormals();
        out[s] = merged;
      }
    }
    return out;
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 10) => new THREE.ConeGeometry(r, h, seg);
const sph = (r, w = 10, h = 8, ps, pl, ts, tl) =>
  new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);

const HALF_PI = Math.PI / 2;
/** Cylinder aligned down -Z instead of +Y. */
const tube = (rt, rb, len, seg = 10) => {
  const g = cyl(rt, rb, len, seg);
  g.rotateX(HALF_PI);
  return g;
};

// ---------------------------------------------------------------------------
// Shared silhouette motifs.
//
// These hulls are original designs in the visual language of the "used
// future": working spacecraft rather than sleek warships. The recurring cues
// are an engine nacelle carried on an outrigger pylon well off the hull, a
// bulbous crew module set forward on a neck, exposed structural ribs, and
// asymmetric greebling. Nothing here reproduces a specific existing ship.
// ---------------------------------------------------------------------------

/** Engine nacelle on an outrigger pylon — the signature read at any distance. */
function nacelle(b, { x, y, z, len, r, pylonLen, pylonAngle = 0, tilt = 0 }) {
  // strut out to the pod
  b.addPair('dark', () => box(pylonLen, 0.32 * r * 4, 0.7 * r * 3), {
    pos: [x - Math.sign(x) * pylonLen * 0.5, y, z], rot: [0, 0, pylonAngle],
  });
  // the pod itself: a capped cylinder lying along the hull
  b.addPair('hull', () => tube(r, r * 1.12, len, 12), { pos: [x, y, z], rot: [tilt, 0, 0] });
  b.addPair('hull', () => sph(r * 1.05, 12, 8), { pos: [x, y, z - len * 0.5] });
  // intake ring forward, glowing exhaust aft
  b.addPair('dark', () => new THREE.TorusGeometry(r * 1.05, r * 0.16, 6, 14), {
    pos: [x, y, z - len * 0.42], rot: [0, 0, 0],
  });
  b.addPair('glow', () => tube(r * 0.82, r * 0.5, len * 0.22, 12), {
    pos: [x, y, z + len * 0.52],
  });
}

/** Exposed structural frames along a hull section. */
function ribs(b, { count, from, to, w, h, y = 0 }) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    b.add('dark', box(w, h, 0.16), { pos: [0, y, from + (to - from) * t] });
  }
}

// ---------------------------------------------------------------------------
// Wasp — Light Interceptor. A stripped courier: all engine, minimal hull.
// ---------------------------------------------------------------------------
function buildWasp() {
  const b = new Builder();
  // rounded crew pod forward on a short neck
  b.add('hull', sph(0.44, 12, 9), { pos: [0, 0.04, -1.45], scale: [1.1, 0.92, 1.4] });
  b.add('canopy', sph(0.3, 10, 7), { pos: [0, 0.14, -1.78], scale: [1, 0.66, 1.1] });
  b.add('dark', box(0.5, 0.42, 1.0), { pos: [0, 0, -0.75] });
  // spine and body
  b.add('hull', box(0.92, 0.66, 2.6), { pos: [0, 0, 0.5] });
  ribs(b, { count: 3, from: -0.2, to: 1.2, w: 1.02, h: 0.74 });
  b.add('hull', box(0.7, 0.22, 1.0), { pos: [0, 0.42, 0.3] });
  // stubby outriggers carrying the nacelles
  nacelle(b, { x: 1.15, y: -0.02, z: 0.55, len: 1.9, r: 0.34, pylonLen: 0.75, pylonAngle: 0.18 });
  // tail
  b.add('hull', box(0.14, 0.85, 0.8), { pos: [0, 0.55, 1.65], rot: [0.22, 0, 0] });
  b.addPair('glow', () => sph(0.07, 6, 4), { pos: [1.15, 0.28, -0.2] });
  return b.build();
}

// ---------------------------------------------------------------------------
// Falcon — Strike Fighter. Bulbous cockpit head, hard-mounted guns, big
// nacelles swung out wide on angled pylons.
//
// NOTE: at runtime this is replaced by the imported glTF hull (see hulls.js).
// It stays here as the fallback if that asset ever fails to load.
// ---------------------------------------------------------------------------
function buildFalcon() {
  const b = new Builder();
  // forward crew module on a neck
  b.add('hull', sph(0.56, 14, 10), { pos: [0, 0.08, -2.0], scale: [1.15, 0.9, 1.4] });
  b.add('canopy', sph(0.4, 12, 8), { pos: [0, 0.2, -2.35], scale: [1, 0.62, 1.05] });
  b.add('dark', box(0.7, 0.6, 1.3), { pos: [0, 0.02, -1.1] });
  // main hull with exposed frames
  b.add('hull', box(1.5, 0.95, 3.4), { pos: [0, 0, 0.5] });
  ribs(b, { count: 4, from: -0.8, to: 1.7, w: 1.62, h: 1.05 });
  b.add('hull', box(1.1, 0.3, 2.4), { pos: [0, 0.6, 0.4] });
  b.add('dark', box(1.7, 0.26, 1.2), { pos: [0, -0.5, 0.2] });   // belly plate
  // nacelles on swept pylons
  nacelle(b, { x: 1.85, y: 0.12, z: 0.55, len: 2.9, r: 0.5, pylonLen: 1.1, pylonAngle: 0.22 });
  // chin guns
  b.addPair('dark', () => tube(0.1, 0.1, 1.9, 6), { pos: [0.42, -0.42, -1.9] });
  // tail fins
  b.addPair('hull', () => box(0.12, 1.0, 0.9), { pos: [0.5, 0.7, 1.9], rot: [0.2, 0, 0.25] });
  b.add('dark', tube(0.55, 0.5, 0.7, 10), { pos: [0, 0, 2.25] });
  b.add('glow', tube(0.42, 0.28, 0.3, 10), { pos: [0, 0, 2.65] });
  return b.build();
}

// ---------------------------------------------------------------------------
// Warden — Medium Escort. A working hull: boxy, ribbed, with the nacelles
// carried high and clear of the superstructure.
// ---------------------------------------------------------------------------
function buildWarden() {
  const b = new Builder();
  b.add('hull', box(2.3, 1.5, 6.4), { pos: [0, 0, 0.2] });
  ribs(b, { count: 6, from: -2.4, to: 2.6, w: 2.45, h: 1.62 });
  // forward command module on a neck
  b.add('dark', box(1.1, 0.9, 1.1), { pos: [0, 0.5, -3.3] });
  b.add('hull', sph(0.72, 14, 10), { pos: [0, 0.5, -4.1], scale: [1.2, 0.85, 1.3] });
  b.add('canopy', box(0.92, 0.34, 0.6), { pos: [0, 0.62, -4.7] });
  // dorsal spine
  b.add('hull', box(1.2, 0.5, 4.4), { pos: [0, 1.0, 0.4] });
  b.add('dark', box(0.5, 0.3, 3.6), { pos: [0, 1.32, 0.4] });
  // nacelles on tall pylons
  nacelle(b, { x: 2.15, y: 0.55, z: 0.6, len: 3.6, r: 0.62, pylonLen: 1.0, pylonAngle: -0.12 });
  // dorsal turret and shield emitters
  b.add('dark', cyl(0.48, 0.58, 0.42, 10), { pos: [0, 1.42, -1.3] });
  b.add('dark', tube(0.12, 0.12, 1.5, 6), { pos: [0, 1.5, -2.0] });
  b.addPair('glow', () => new THREE.TorusGeometry(0.38, 0.08, 6, 12), {
    pos: [1.2, 0.85, 1.9], rot: [HALF_PI, 0, 0],
  });
  b.add('dark', box(2.4, 1.2, 0.9), { pos: [0, 0, 3.6] });
  b.add('glow', tube(0.46, 0.32, 0.34, 10), { pos: [0, 0, 4.15] });
  return b.build();
}

// ---------------------------------------------------------------------------
// Bastion — Heavy Cruiser. A long ribbed spine, an armoured prow, and four
// heavy nacelles hung off substantial pylons.
// ---------------------------------------------------------------------------
function buildBastion() {
  const b = new Builder();
  b.add('hull', box(3.4, 2.1, 11.0), { pos: [0, 0, 0] });
  b.add('hull', box(4.1, 1.0, 8.0), { pos: [0, -0.45, 0.4] });
  ribs(b, { count: 9, from: -4.6, to: 4.4, w: 4.25, h: 2.25 });
  // armoured prow
  b.add('hull', box(2.6, 1.6, 2.8), { pos: [0, 0.05, -6.2] });
  b.add('hull', cone(1.45, 3.0, 4), { pos: [0, 0.05, -8.2], rot: [-HALF_PI, Math.PI / 4, 0] });
  b.add('dark', box(3.0, 0.4, 2.0), { pos: [0, -0.7, -5.6] });
  // command module forward on a neck
  b.add('dark', box(1.5, 1.1, 1.4), { pos: [0, 1.5, -1.2] });
  b.add('hull', sph(0.9, 14, 10), { pos: [0, 2.05, -2.1], scale: [1.15, 0.8, 1.35] });
  b.add('canopy', box(1.1, 0.34, 0.72), { pos: [0, 2.2, -2.85] });
  // main turrets fore and aft
  for (const z of [-3.6, 3.0]) {
    b.add('dark', cyl(0.95, 1.1, 0.55, 12), { pos: [0, 1.2, z] });
    b.add('hull', box(1.6, 0.75, 1.9), { pos: [0, 1.6, z - 0.3] });
    b.addPair('dark', () => tube(0.16, 0.16, 2.8, 6), { pos: [0.4, 1.65, z - 1.8] });
  }
  // four heavy nacelles, stacked two per side
  nacelle(b, { x: 2.9, y: 0.85, z: 1.0, len: 4.6, r: 0.72, pylonLen: 1.3, pylonAngle: -0.16 });
  nacelle(b, { x: 2.9, y: -0.85, z: 1.6, len: 4.2, r: 0.66, pylonLen: 1.3, pylonAngle: 0.16 });
  // broadside blisters
  for (const z of [-2.2, 0.4, 2.6]) {
    b.addPair('dark', () => box(0.6, 0.6, 0.9), { pos: [1.85, 0.25, z] });
  }
  b.add('dark', box(3.6, 1.9, 1.3), { pos: [0, 0, 5.9] });
  b.addPair('glow', () => tube(0.56, 0.38, 0.44, 10), { pos: [0.95, 0, 6.7] });
  b.addPair('glow', () => sph(0.14, 6, 4), { pos: [2.0, 1.0, -4.2] });
  return b.build();
}

// ---------------------------------------------------------------------------
// Aegis — Support Carrier. Wide open hull built around a hangar deck, with
// the drive units mounted high and clear of the launch path.
// ---------------------------------------------------------------------------
function buildAegis() {
  const b = new Builder();
  b.add('hull', box(4.6, 1.1, 9.4), { pos: [0, 0, 0] });
  ribs(b, { count: 7, from: -3.8, to: 3.8, w: 4.75, h: 1.25 });
  // open hangar mouth forward, framed by the hull
  b.add('dark', box(2.4, 1.0, 2.8), { pos: [0, -0.1, -3.9] });
  b.add('glow', box(2.2, 0.06, 2.5), { pos: [0, -0.58, -3.9] });
  b.addPair('hull', () => box(0.85, 1.35, 3.4), { pos: [1.85, 0, -3.4] });
  b.add('hull', box(3.6, 0.5, 2.2), { pos: [0, 0.75, -3.6] });
  // command tower on a neck
  b.add('dark', box(1.0, 1.2, 1.0), { pos: [0, 1.2, 1.4] });
  b.add('hull', sph(0.78, 14, 10), { pos: [0, 2.0, 1.2], scale: [1.2, 0.8, 1.3] });
  b.add('canopy', box(0.98, 0.32, 0.64), { pos: [0, 2.12, 0.62] });
  // drive units high on pylons, out of the launch corridor
  nacelle(b, { x: 2.6, y: 1.25, z: 1.5, len: 3.8, r: 0.6, pylonLen: 0.95, pylonAngle: -0.3 });
  // sensor dishes and drone racks
  b.addPair('dark', () => cyl(0.09, 0.09, 1.0, 6), { pos: [1.5, 1.7, 3.1] });
  b.addPair('glow', () => sph(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), {
    pos: [1.5, 2.2, 3.1], rot: [0.5, 0, 0], scale: [1, 0.42, 1],
  });
  b.addPair('dark', () => box(0.45, 0.38, 4.4), { pos: [2.45, 0.45, 0.6] });
  for (let i = 0; i < 4; i++) {
    b.addPair('glow', () => sph(0.1, 6, 4), { pos: [2.45, 0.7, -1.3 + i * 1.25] });
  }
  b.add('dark', box(3.8, 1.2, 1.1), { pos: [0, 0.05, 5.1] });
  b.add('glow', tube(0.44, 0.3, 0.36, 10), { pos: [0, 0.05, 5.85] });
  return b.build();
}

// ---------------------------------------------------------------------------
// Specter — Cloak Scout. The one hull that hides its structure: flat, faceted
// and with its drives buried rather than slung outboard.
// ---------------------------------------------------------------------------
function buildSpecter() {
  const b = new Builder();
  b.add('hull', cone(1.55, 5.4, 4), {
    pos: [0, 0, -0.4], rot: [-HALF_PI, 0, 0], scale: [1, 1, 0.3],
  });
  b.add('hull', box(1.0, 0.28, 2.2), { pos: [0, 0, 1.4] });
  b.addPair('hull', () => box(1.6, 0.11, 1.0), {
    pos: [1.15, 0, 1.5], rot: [0, 0.5, 0.32],
  });
  // shallow dorsal blister instead of a raised cockpit
  b.add('dark', sph(0.5, 10, 7), { pos: [0, 0.12, -0.6], scale: [1.1, 0.4, 1.5] });
  b.add('dark', box(0.68, 0.26, 0.9), { pos: [0, 0.02, 2.3] });
  // deliberately dim — a Specter you can see has already failed
  b.add('glow', tube(0.24, 0.16, 0.18, 6), { pos: [0, 0.02, 2.75] });
  b.add('glow', sph(0.06, 6, 4), { pos: [0, 0.14, -1.4] });
  return b.build();
}

// ---------------------------------------------------------------------------
// Ground: Sentry Turret, Repair Rig, Flak Walker.
// Ground units are modelled +Y up, sitting on the deck.
// ---------------------------------------------------------------------------
function buildSentry() {
  const b = new Builder();
  b.add('dark', cyl(1.5, 1.9, 0.5, 12), { pos: [0, 0.25, 0] });     // foundation
  b.add('hull', cyl(1.1, 1.3, 0.7, 10), { pos: [0, 0.8, 0] });      // barbette
  b.add('hull', box(1.7, 1.0, 2.2), { pos: [0, 1.5, -0.2] });       // gunhouse
  b.add('hull', box(2.1, 0.5, 1.2), { pos: [0, 1.5, 0.3] });
  b.addPair('dark', () => tube(0.16, 0.18, 2.6, 6), { pos: [0.42, 1.6, -1.6] });
  b.add('glow', sph(0.13, 6, 4), { pos: [0, 2.1, 0.6] });
  b.addPair('dark', () => box(0.35, 0.9, 0.35), { pos: [1.3, 0.6, 1.3] });
  return b.build();
}

function buildRig() {
  const b = new Builder();
  b.add('dark', box(2.4, 0.6, 3.6), { pos: [0, 0.4, 0] });          // chassis
  b.addPair('dark', () => box(0.5, 0.7, 3.4), { pos: [1.35, 0.45, 0] }); // tracks
  b.add('hull', box(2.0, 1.0, 2.2), { pos: [0, 1.2, 0.3] });        // body
  b.add('canopy', box(1.2, 0.5, 0.5), { pos: [0, 1.5, -0.9] });
  // Repair crane arm.
  b.add('hull', box(0.3, 0.3, 2.6), { pos: [0, 2.0, -0.8], rot: [-0.5, 0, 0] });
  b.add('glow', sph(0.3, 8, 6), { pos: [0, 2.55, -1.9] });
  // Emitter ring.
  b.add('glow', new THREE.TorusGeometry(0.6, 0.08, 6, 14), {
    pos: [0, 1.85, 1.0], rot: [HALF_PI, 0, 0],
  });
  return b.build();
}

function buildFlak() {
  const b = new Builder();
  b.add('hull', box(2.6, 1.3, 3.0), { pos: [0, 2.0, 0] });          // body
  b.add('dark', box(1.8, 0.6, 1.8), { pos: [0, 2.85, 0.1] });
  // Quad flak barrels on a raised mount.
  for (const x of [-0.45, 0.45]) {
    for (const y of [3.0, 3.35]) {
      b.add('dark', tube(0.11, 0.11, 2.0, 6), { pos: [x, y, -1.4] });
    }
  }
  b.add('glow', sph(0.12, 6, 4), { pos: [0, 3.3, 1.2] });
  // Four splayed legs.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add('dark', box(0.3, 2.0, 0.3), {
        pos: [sx * 1.35, 1.1, sz * 1.2], rot: [sz * 0.25, 0, -sx * 0.3],
      });
      b.add('dark', box(0.5, 0.25, 0.9), { pos: [sx * 1.75, 0.15, sz * 1.5] });
    }
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// Spawner — Fleet Carrier. A slab of industry rather than a warship: a long
// spine of hangar bays with launch mouths down both flanks, a spinal gantry
// on top, and drives far too small for its mass. It should read as something
// that makes ships, not something that fights them.
// ---------------------------------------------------------------------------
function buildSpawner() {
  const b = new Builder();
  // Main spine.
  b.add('hull', box(5.0, 1.9, 12.0), { pos: [0, 0, 0] });
  b.add('dark', box(5.25, 0.55, 11.0), { pos: [0, -0.85, 0] });
  ribs(b, { count: 9, from: -5.0, to: 5.0, w: 5.2, h: 2.1 });

  // Launch bays down both flanks: dark recesses with a lit throat.
  for (let i = 0; i < 4; i++) {
    const z = -3.6 + i * 2.4;
    b.addPair('dark', () => box(0.7, 1.15, 1.7), { pos: [2.6, -0.1, z] });
    b.addPair('glow', () => box(0.12, 0.85, 1.4), { pos: [3.0, -0.1, z] });
  }

  // Forward launch mouth.
  b.add('dark', box(3.0, 1.25, 2.6), { pos: [0, -0.1, -6.0] });
  b.add('glow', box(2.7, 0.1, 2.3), { pos: [0, -0.66, -6.1] });
  b.addPair('hull', () => box(0.95, 1.7, 3.6), { pos: [2.1, 0, -5.2] });

  // Spinal gantry and command block.
  b.add('dark', box(0.85, 0.85, 9.0), { pos: [0, 1.35, 0.5] });
  for (let i = 0; i < 5; i++) {
    b.add('dark', box(2.9, 0.16, 0.3), { pos: [0, 1.35, -3.2 + i * 1.8] });
  }
  b.add('hull', box(2.3, 1.15, 2.4), { pos: [0, 1.95, 4.0] });
  b.add('canopy', box(1.9, 0.34, 0.5), { pos: [0, 2.2, 2.85] });

  // Undersized drives, slung low and close.
  nacelle(b, { x: 1.9, y: -0.5, z: 4.6, len: 3.0, r: 0.62, pylonLen: 0.5 });
  b.add('dark', box(3.4, 1.5, 1.3), { pos: [0, 0.1, 6.4] });
  b.add('glow', tube(0.5, 0.34, 0.4, 10), { pos: [0, 0.1, 7.15] });

  // Cargo/ordnance drums.
  b.addPair('dark', () => cyl(0.55, 0.55, 2.6, 8), {
    pos: [1.85, 1.05, -1.6], rot: [HALF_PI, 0, 0],
  });
  return b.build();
}

const BUILDERS = {
  wasp: buildWasp, falcon: buildFalcon, warden: buildWarden,
  bastion: buildBastion, aegis: buildAegis, specter: buildSpecter,
  spawner: buildSpawner,
  sentry: buildSentry, rig: buildRig, flak: buildFlak,
};

const cache = new Map();
/** Merged geometry-per-slot for a unit type id. Built once, reused forever. */
export function getGeometry(typeId) {
  if (!cache.has(typeId)) {
    const fn = BUILDERS[typeId];
    if (!fn) throw new Error(`No model builder for "${typeId}"`);
    cache.set(typeId, fn());
  }
  return cache.get(typeId);
}

/**
 * Swap a hull's procedural geometry for one loaded from an external asset
 * (see hullImport.js). Call before any battle starts — Batch construction
 * calls getGeometry() synchronously at match start, so this has to have
 * already landed in the cache by then, not be raced against it.
 *
 * Deliberately going through the SAME cache the procedural builders use:
 * everything downstream (instancing, formation-slot spread, damage flash,
 * shadows, the triplanar detail shader) reads geometry-per-slot with no idea
 * where it came from, and that stays true here too.
 */
export function setGeometry(typeId, parts) {
  const old = cache.get(typeId);
  if (old && old !== parts) for (const g of Object.values(old)) g.dispose();
  cache.set(typeId, parts);
}

export function disposeModels() {
  for (const parts of cache.values()) {
    for (const g of Object.values(parts)) g.dispose();
  }
  cache.clear();
}

/**
 * Materials per slot. Hull tint carries the ship-class colour, warmed or
 * cooled slightly by faction so attacker and defender read apart at a glance.
 */
export function makeMaterials(typeId, color, faction) {
  // Faction must dominate hue — at command range a hull is a few dozen
  // pixels and "whose is it" has to be answerable instantly. Lerping the
  // class colour straight at the faction colour muddies into pinks, so the
  // class colour is first flattened toward its own luminance and only then
  // tinted. Ship classes stay distinguishable by lightness, not hue.
  const base = new THREE.Color(color);
  const hsl = base.getHSL({ h: 0, s: 0, l: 0 });
  base.setHSL(hsl.h, hsl.s * 0.22, hsl.l);
  const hullTint = base.lerp(
    new THREE.Color(faction === 'attack' ? 0xc8623a : 0x4a90c8), 0.55,
  );
  return {
    // Painted plating carries the strongest detail: seams, grime and bump all
    // read here. Roughness variation is the big one — a single roughness value
    // across a whole hull is the thing that says "untextured" loudest.
    hull: applyDetail(new THREE.MeshStandardMaterial({
      color: hullTint, metalness: 0.72, roughness: 0.63,
      envMapIntensity: 0.95,
    }), { albedo: 0.52, rough: 0.58, bump: 0.075 }),
    // Housings and greebles are already dark and already broken up by their
    // own geometry, so they take the same surface at about half strength —
    // enough to stop them reading as solid black, not enough to make the
    // recesses noisy.
    dark: applyDetail(new THREE.MeshStandardMaterial({
      color: 0x35302c, metalness: 0.85, roughness: 0.72,
      envMapIntensity: 0.7,
    }), { albedo: 0.34, rough: 0.42, bump: 0.048 }),
    glow: new THREE.MeshStandardMaterial({
      color: 0x000000, metalness: 0, roughness: 1,
      emissive: new THREE.Color(faction === 'attack' ? 0xff7a3c : 0x63e8ff),
      // Bloom multiplies this. Much above ~2 and adjacent engine bells smear
      // into a single white slab instead of reading as separate nozzles.
      emissiveIntensity: 1.9 * GFX.glowScale,
    }),
    canopy: new THREE.MeshPhysicalMaterial({
      color: 0x0a1622, metalness: 0.2, roughness: 0.08,
      transmission: 0.4, thickness: 0.4, transparent: true, opacity: 0.85,
      envMapIntensity: 1.6,
    }),
  };
}

export const MATERIAL_SLOTS = SLOTS;
