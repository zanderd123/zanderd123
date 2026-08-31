/**
 * Turns a user-supplied glTF hull into the same shape getGeometry() returns
 * for a procedurally-built one: a merged BufferGeometry per material slot
 * (hull/dark/glow/canopy), already baked to this game's local-space
 * conventions — nose at -Z, centred, one hull unit matching the procedural
 * ships' scale — so nothing downstream (instancing, formation slots, damage
 * flash, shadows, the CINEMATIC surface-detail shader) has to know or care
 * that the geometry didn't come out of models.js's own builders.
 *
 * Why this exists rather than hand-modelling to match a reference: the user
 * supplied the actual asset, not a photo, so the highest-fidelity path is to
 * use it directly. The asset is well-formed for this — a static mesh (no
 * skin, no animation) split across ~330 primitives on 6 materials, exported
 * by THREE.GLTFExporter — which is structurally the same shape this game's
 * own Builder produces, just authored by a different tool.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

function decodeBase64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Parse a base64-embedded .glb into slot-bucketed, oriented, merged geometry.
 *
 * @param base64       the embedded asset
 * @param materialMap  { [gltfMaterialName]: 'hull'|'dark'|'glow'|'canopy' }
 * @param orient       { rotateY, targetLength } — see below
 */
export function importGlbHull(base64, materialMap, orient) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(decodeBase64ToArrayBuffer(base64), '', (gltf) => {
      try {
        resolve(processScene(gltf.scene, materialMap, orient));
      } catch (err) {
        reject(err);
      }
    }, reject);
  });
}

function processScene(root, materialMap, { rotateY = 0, targetLength }) {
  root.updateMatrixWorld(true);

  // Bucket every mesh's world-space geometry by which render slot its glTF
  // material maps to. World matrix, not local: the source file's parts carry
  // real per-node transforms (the paired nacelle assemblies especially), and
  // baking world space in now is what lets everything just be merged flat
  // afterward — exactly what Builder.add() does for the procedural ships,
  // just reading the transform from the file instead of from a call site.
  const buckets = { hull: [], dark: [], glow: [], canopy: [] };
  root.traverse((node) => {
    if (!node.isMesh) return;
    const matName = node.material?.name || '';
    const slot = materialMap[matName];
    if (!slot) {
      throw new Error(`hullImport: unmapped glTF material "${matName}" on node "${node.name}" — `
        + 'add it to the materialMap or the part silently vanishes.');
    }
    const geo = node.geometry.clone();
    // Drop everything but position/normal. UV is unused (the game's surface
    // detail is triplanar, not UV-mapped — see textures.js) and dropping it
    // is also what lets primitives from different corners of the file share
    // one mergeGeometries() call: it requires every input to carry the same
    // attribute set.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    }
    // mergeGeometries requires the index attribute present in ALL inputs or
    // NONE — some glTF primitives are indexed and some are not, so normalise
    // to non-indexed rather than gamble on which way the mix breaks first.
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    flat.applyMatrix4(node.matrixWorld);
    buckets[slot].push(flat);
  });

  for (const [slot, list] of Object.entries(buckets)) {
    if (!list.length) throw new Error(`hullImport: no geometry landed in slot "${slot}"`);
  }

  // One combined bounding box across every kept part, in the file's own
  // space — this is what "centred" and "targetLength" are measured against,
  // so a hull that leans forward of its own origin (this one does; the bridge
  // and nose mass are well past the engine block) still ends up centred on
  // its actual silhouette rather than on whatever point the source file
  // happened to call (0,0,0).
  const box = new THREE.Box3();
  for (const list of Object.values(buckets)) {
    for (const g of list) box.expandByObject(new THREE.Mesh(g));
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // The file's forward axis is +X (confirmed by inspection: engines cluster
  // at min-X, the bridge/nose mass at max-X). This game's convention is nose
  // at -Z (see the header comment in models.js) — a +90 degree yaw takes +X to -Z.
  const m = new THREE.Matrix4()
    .makeRotationY(rotateY)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

  // Scale AFTER measuring the pre-scale box, so targetLength is honest: it is
  // measured along the file's own forward axis (X), which becomes Z once
  // rotated — scaling first would make the box measurement chase its own tail.
  const rawLength = size.x;
  const scale = targetLength / rawLength;
  m.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));

  const out = {};
  for (const [slot, list] of Object.entries(buckets)) {
    for (const g of list) g.applyMatrix4(m);
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) throw new Error(`hullImport: merge produced nothing for slot "${slot}"`);
    // NOT computeVertexNormals(): the file's NORMAL attribute is authored
    // (hard edges on panel corners, not uniformly smoothed), and recomputing
    // per-triangle normals on a non-indexed merge would flatten every part
    // to faceted shading and throw that away.
    out[slot] = merged;
  }
  return out;
}
