/**
 * External hull assets. One place to list which unit types are backed by an
 * imported model instead of a models.js builder, and how each one's glTF
 * materials map onto this game's four render slots.
 *
 * Adding another imported hull later means: drop its base64 in src/assets,
 * add an entry here with its material mapping and orientation, done — no
 * changes anywhere else, since setGeometry() feeds the same cache the
 * procedural builders do.
 */
import { FALCON_GLB_BASE64 } from './assets/falcon_hull.js';
import { importGlbHull } from './hullImport.js';
import { setGeometry } from './models.js';

const EXTERNAL_HULLS = {
  falcon: {
    base64: FALCON_GLB_BASE64,
    // From inspecting the file: hull_gray and plate_light are painted panel
    // metal (the two lightest, least-metallic materials — these are what
    // should pick up faction tint, matching 'hull' on every procedural
    // ship). hull_charcoal and panel_grime are the dark recesses and
    // greebling. canopy_glass and drive_glow map onto their obvious
    // namesakes.
    materialMap: {
      hull_gray: 'hull',
      plate_light: 'hull',
      hull_charcoal: 'dark',
      panel_grime: 'dark',
      canopy_glass: 'canopy',
      drive_glow: 'glow',
    },
    orient: {
      // The file's forward axis is +X (engines cluster at min-X, nose mass at
      // max-X); this game's nose is -Z. +90 degree yaw takes +X to -Z.
      rotateY: Math.PI / 2,
      // Matches the procedural Falcon's own nose-to-tail length (measured
      // from its merged geometry's bounding box), so swapping the builder
      // does not also quietly change the hull's in-game size — `type.scale`
      // still does all the scaling, same as every other ship.
      targetLength: 5.65,
    },
  },
};

/**
 * Load every external hull and land it in the shared geometry cache. Must
 * resolve before the fleet builder becomes usable — see main.js. A failure
 * here is caught and left to fall back to the procedural builder for that
 * type id, rather than block the game from starting.
 */
export async function preloadExternalHulls() {
  await Promise.all(Object.entries(EXTERNAL_HULLS).map(async ([typeId, spec]) => {
    try {
      const parts = await importGlbHull(spec.base64, spec.materialMap, spec.orient);
      setGeometry(typeId, parts);
    } catch (err) {
      console.error(`hulls: failed to load external hull for "${typeId}", `
        + 'falling back to the procedural model.', err);
    }
  }));
}
