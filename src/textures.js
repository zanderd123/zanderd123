/**
 * Procedural surface detail for hulls.
 *
 * The ships are assemblies of primitives merged down per material slot, which
 * means their UVs are useless for texturing: a BoxGeometry gets 0-1 across
 * every face regardless of size, so the Bastion's 12-unit spine and the 0.3-unit
 * ribs bolted to it would both receive one full copy of the texture. Rescaling
 * UVs per part does not fix it either, because a single box face can be 12 units
 * on one axis and 1.9 on the other.
 *
 * So nothing here is sampled through UVs at all. The shader projects this
 * texture from all three object-space axes and blends by surface normal
 * (triplanar), which gives identical texel density on every part of every ship
 * whatever primitive it came from — and it costs no geometry changes.
 *
 * One RGBA texture carries three signals, so the triplanar blend needs three
 * fetches rather than nine:
 *
 *   R  albedo detail   — panel seams and grime, multiplied into the hull colour
 *   G  roughness       — plate-to-plate variation; this is what stops a hull
 *                        reading as one moulded piece of plastic
 *   B  height          — bump, differentiated in the fragment shader
 *
 * FEATURE SIZE IS THE WHOLE GAME HERE. A Bastion is 11 model units long and
 * draws around 50 pixels at the CINEMATIC camera, so one model unit is roughly
 * 4.5 pixels. Panel detail finer than about a unit lands inside a single pixel
 * and turns into shimmer rather than surface. Everything below is therefore
 * deliberately coarse — big chunky plating, not fine greebling.
 */
import * as THREE from 'three';

/** Model units covered by one tile of the texture. See the note above. */
export const DETAIL_TILE = 5.5;

const SIZE = 512;

/** Deterministic noise so the hulls look identical every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Draw a rect that wraps at the tile edge, so the pattern is seamless when the
 * shader tiles it across a hull.
 */
function wrapRect(ctx, x, y, w, h) {
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) ctx.fillRect(x + dx, y + dy, w, h);
  }
}

function buildCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const r = rng(0x5eed17);

  // ---- base plating -------------------------------------------------------
  // Mid grey means "no change". Each channel is read as a multiplier or an
  // offset around 0.5, so a flat 0.5 tile leaves the material exactly as it
  // is — which is what CLASSIC gets by fading the effect to zero.
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Plate-to-plate variation. Four plates across the tile, so at 5.5 model
  // units per tile each plate is ~1.4 units — roughly 6 screen pixels on a
  // Bastion, which is about as fine as is worth drawing.
  const CELLS = 4;
  const step = SIZE / CELLS;
  for (let iy = 0; iy < CELLS; iy++) {
    for (let ix = 0; ix < CELLS; ix++) {
      // Albedo and roughness wander per plate; height stays near neutral so
      // plates sit flush and only the seams between them read as recessed.
      const a = 118 + Math.floor(r() * 26);
      const g = 108 + Math.floor(r() * 46);
      const b = 126 + Math.floor(r() * 6);
      ctx.fillStyle = `rgb(${a},${g},${b})`;
      ctx.fillRect(ix * step, iy * step, step, step);
    }
  }

  // ---- panel seams --------------------------------------------------------
  // Dark in albedo, rougher, and recessed in height. Drawn as two passes: a
  // wide soft shadow either side, then the hard seam itself.
  for (let i = 0; i <= CELLS; i++) {
    const p = i * step;
    ctx.fillStyle = 'rgba(96,150,104,0.55)';
    wrapRect(ctx, p - 3, 0, 6, SIZE);
    wrapRect(ctx, 0, p - 3, SIZE, 6);
    ctx.fillStyle = 'rgb(74,168,86)';
    wrapRect(ctx, p - 1, 0, 2, SIZE);
    wrapRect(ctx, 0, p - 1, SIZE, 2);
  }

  // A few half-seams so the plating doesn't read as perfect graph paper.
  for (let i = 0; i < 10; i++) {
    const vertical = r() < 0.5;
    const p = Math.floor(r() * CELLS) * step + step * 0.5;
    const from = Math.floor(r() * CELLS) * step;
    const len = step * (1 + Math.floor(r() * 2));
    ctx.fillStyle = 'rgb(88,155,96)';
    if (vertical) wrapRect(ctx, p - 1, from, 2, len);
    else wrapRect(ctx, from, p - 1, len, 2);
  }

  // ---- raised strakes -----------------------------------------------------
  // Proud of the surface rather than recessed, so the bump has something to
  // catch the key light on as well as something to lose it in.
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * SIZE);
    const w = 5 + Math.floor(r() * 7);
    const y = Math.floor(r() * SIZE);
    const h = Math.floor(step * (0.6 + r()));
    ctx.fillStyle = 'rgba(150,120,178,0.85)';
    wrapRect(ctx, x, y, w, h);
  }

  // ---- grime --------------------------------------------------------------
  // Streaks running one way only. Real weathering has a direction (thrust,
  // venting, gravity on the yard floor) and unidirectional streaking is most
  // of what separates "used" from "dirty texture applied evenly".
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * SIZE);
    const w = 2 + Math.floor(r() * 9);
    const y = Math.floor(r() * SIZE);
    const h = Math.floor(SIZE * (0.10 + r() * 0.30));
    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(86,120,128,0.30)');
    grd.addColorStop(1, 'rgba(120,128,128,0)');
    ctx.fillStyle = grd;
    for (const dy of [-SIZE, 0]) ctx.fillRect(x, y + dy, w, h);
  }

  // ---- fine grain ---------------------------------------------------------
  // Breaks up the flat plate interiors. Kept very low contrast: at this
  // texel-to-pixel ratio anything stronger sparkles when the ship moves.
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 12;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 1.6));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let cached = null;

/** The shared detail texture. Built once on first use. */
export function detailTexture() {
  if (cached) return cached;
  cached = new THREE.CanvasTexture(buildCanvas());
  cached.wrapS = cached.wrapT = THREE.RepeatWrapping;
  // Linear, NOT sRGB: these channels are data (roughness, height), not colour.
  cached.colorSpace = THREE.NoColorSpace;
  cached.anisotropy = 4;
  return cached;
}
