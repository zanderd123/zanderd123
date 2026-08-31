/**
 * The world everything else is drawn into: renderer, camera, lighting, the
 * planet, the starfield, and the arena shell.
 *
 * Nothing in here knows about units or the simulation. It owns the things that
 * exist whether or not a battle is running, so a match can be reset without
 * rebuilding the sky.
 *
 * The post chain is deliberately short — one bloom pass. Ships carry emissive
 * drive glow and the planet has a rim, and both want to bleed; anything beyond
 * that costs frames for very little.
 */
import * as THREE from 'three';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { WORLD, GFX } from './config.js';
import { makeRng } from './util.js';

/**
 * Where the key light sits relative to whatever it is following. Shadows need
 * a tight frustum to stay sharp, so the sun is not fixed in the world — it is
 * parked at this offset from the camera's focus and dragged along with it.
 */
export const SUN_OFFSET = new THREE.Vector3(900, 620, -700);
/** Half-width of the shadow camera's box, in world units. */
const SHADOW_SPAN = 700;

// ---------------------------------------------------------------------------
// Procedural textures. Everything is generated at boot from a fixed seed, so
// the build stays a single file with no external assets.
// ---------------------------------------------------------------------------

/** Banded ocean world with continents and ice caps. */
function planetTexture(seed = 7) {
  const rnd = makeRng(seed);
  const W = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = W / 2;
  const ctx = cv.getContext('2d');

  const sea = ctx.createLinearGradient(0, 0, 0, cv.height);
  sea.addColorStop(0, '#d8e6ef');
  sea.addColorStop(0.12, '#2b6d92');
  sea.addColorStop(0.5, '#0f4f74');
  sea.addColorStop(0.88, '#2b6d92');
  sea.addColorStop(1, '#dae8f0');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, cv.width, cv.height);

  // Continents: blobs of overlapping ellipses, greener at the equator and
  // browner toward the poles.
  for (let i = 0; i < 26; i++) {
    const cx = rnd() * cv.width;
    const cy = cv.height * (0.16 + rnd() * 0.68);
    const lat = Math.abs(cy / cv.height - 0.5) * 2;
    const g = Math.floor(90 + (1 - lat) * 60 + rnd() * 30);
    const r = Math.floor(60 + lat * 90 + rnd() * 30);
    ctx.fillStyle = `rgb(${r},${g},${Math.floor(48 + rnd() * 26)})`;
    const lobes = 10 + Math.floor(rnd() * 16);
    for (let k = 0; k < lobes; k++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 78;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6,
        18 + rnd() * 46, 12 + rnd() * 30, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = 'rgba(238,246,252,0.92)';
  ctx.fillRect(0, 0, cv.width, cv.height * 0.055);
  ctx.fillRect(0, cv.height * 0.945, cv.width, cv.height * 0.055);

  // A little grain, so the surface does not read as flat paint under the
  // near-flat lighting of the poles.
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Transparent cloud deck, thinned toward the poles. */
function cloudTexture(seed = 19) {
  const rnd = makeRng(seed);
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  for (let i = 0; i < 110; i++) {
    const y = rnd() * cv.height;
    // Reject sample toward the poles rather than squashing, which would leave
    // a visible seam.
    const keep = 1 - Math.abs(y / cv.height - 0.5) * 1.4;
    if (rnd() > keep) continue;
    const x = rnd() * cv.width;
    const w = 24 + rnd() * 78;
    const h = 6 + rnd() * 16;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      ctx.ellipse(x + (rnd() - 0.5) * w, y + (rnd() - 0.5) * h,
        w * (0.25 + rnd() * 0.4), h * (0.5 + rnd() * 0.6), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fresnel shell — bright where the surface turns away from the eye. */
function rimMaterial(radius, color, power, intensity, side) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        float f = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewW)));
        f = pow(clamp(f, 0.0, 1.0), uPower) * uIntensity;
        gl_FragColor = vec4(uColor * f, f);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: side ?? THREE.FrontSide,
  });
}

/** A shell of stars, points rather than a skybox so they twinkle-free but pop. */
function makeStars(rnd, count = 7000, radius = 12000) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: pick z uniformly, then the angle.
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const d = radius * (0.75 + rnd() * 0.25);
    pos[i * 3] = Math.cos(a) * r * d;
    pos[i * 3 + 1] = z * d;
    pos[i * 3 + 2] = Math.sin(a) * r * d;
    const roll = rnd();
    if (roll < 0.06) c.setHSL(0.58, 0.75, 0.78);
    else if (roll < 0.18) c.setHSL(0.08, 0.6, 0.72);
    else c.setHSL(0.6, 0.12, 0.72 + rnd() * 0.28);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    size[i] = rnd() < 0.012 ? 2.6 + rnd() * 1.8 : 0.7 + rnd() * 1.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // gl_PointSize is in device pixels, so scale by DPR to keep the
        // apparent size constant across displays.
        gl_PointSize = aSize * uPixelRatio;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        // Hard core with a thin halo — a star, not a puffball.
        float a = smoothstep(0.5, 0.18, r);
        gl_FragColor = vec4(vColor * (0.6 + 0.4 * a), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** A soft nebula billboard, faded to nothing at its edges so it has no border. */
function nebulaTexture(rnd, hue) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = S * (0.5 + (rnd() - 0.5) * 0.62);
    const y = S * (0.5 + (rnd() - 0.5) * 0.62);
    const r = 40 + rnd() * 150;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue + rnd() * 40 - 20},70%,${30 + rnd() * 26}%,0.22)`);
    g.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Mask to a disc so the quad's corners never show.
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.55, 'rgba(0,0,0,0.85)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The reflection probe. Metal hulls need something to reflect or they read as
 * flat grey, and there is nothing out here — so a tiny room of emissive boxes
 * is built, baked to a cubemap, and thrown away.
 */
function makeEnvironment(renderer) {
  const room = new THREE.Scene();
  const box = (color, mul, pos, scale) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mul) }),
    );
    m.position.set(...pos);
    m.scale.set(...scale);
    room.add(m);
  };
  room.background = new THREE.Color(0x02030a);
  box(0xfff2e0, 9, [40, 20, -30], [26, 26, 2]);    // key
  box(0x3f7fbf, 1.1, [0, -40, 0], [90, 2, 90]);    // planetshine from below
  box(0x121a2a, 0.6, [-45, 10, 25], [2, 60, 60]);  // cold fill
  box(0x2a1b3a, 0.5, [0, 40, 45], [70, 40, 2]);    // nebula wash

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(room, 0.04);
  pmrem.dispose();
  room.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return rt.texture;
}

// ---------------------------------------------------------------------------

export class SpaceScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = GFX.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = GFX.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 40000);
    this.camera.position.set(0, 700, -2400);

    this.env = makeEnvironment(this.renderer);
    this.scene.environment = this.env;

    const rnd = makeRng(4242);

    this.sun = new THREE.DirectionalLight(0xfff0dc, GFX.sunIntensity);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    // Hulls are thin plates in places; without a normal bias they shadow-acne
    // along every panel line.
    this.sun.shadow.normalBias = 0.5;
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_SPAN; sc.right = SHADOW_SPAN;
    sc.top = SHADOW_SPAN; sc.bottom = -SHADOW_SPAN;
    sc.near = 1;
    sc.far = SUN_OFFSET.length() + SHADOW_SPAN * 2;
    sc.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.bounce = new THREE.DirectionalLight(0x5590d0, GFX.bounceIntensity);
    this.bounce.position.set(-300, -600, 300);
    this.scene.add(this.bounce);

    this.ambient = new THREE.AmbientLight(0x1a2436, GFX.ambientIntensity);
    this.scene.add(this.ambient);

    this.stars = makeStars(rnd);
    this.scene.add(this.stars);

    for (let i = 0; i < 3; i++) {
      const tex = nebulaTexture(rnd, [255, 205, 300][i]);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000), mat);
      const a = (i / 3) * Math.PI * 2 + rnd() * 1.2;
      quad.position.set(Math.cos(a) * 15500, (rnd() - 0.5) * 6000, Math.sin(a) * 15500);
      quad.lookAt(0, 0, 0);
      quad.frustumCulled = false;
      this.scene.add(quad);
    }

    this.buildPlanet();
    this.buildArena();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.85,
    );
    this.composer.addPass(this.bloom);

    addEventListener('resize', () => this.resize());
  }

  buildPlanet() {
    const R = WORLD.planetRadius;
    this.planet = new THREE.Group();
    this.planet.position.set(...WORLD.planetCenter);
    this.scene.add(this.planet);

    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 64),
      new THREE.MeshStandardMaterial({
        map: planetTexture(), roughness: 0.92, metalness: 0, envMapIntensity: 0.25,
      }),
    );
    surface.receiveShadow = true;
    this.planet.add(surface);
    this.surface = surface;

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.012, 72, 48),
      new THREE.MeshStandardMaterial({
        map: cloudTexture(), transparent: true, opacity: 0.42,
        roughness: 1, metalness: 0, depthWrite: false,
      }),
    );
    this.planet.add(this.clouds);

    // Two rims: a tight bright one for the atmosphere's edge, a wide dim one
    // for the halo that sells its depth.
    this.planet.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.035, 64, 40), rimMaterial(R, 0x5aa9ff, 2.6, 0.9)));
    this.planet.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.14, 64, 40), rimMaterial(R, 0x2f7fd8, 3.4, 0.55)));

    // Bombardment scorch. Hidden until the crust actually takes damage.
    this.scorchMat = new THREE.MeshBasicMaterial({
      color: 0xff5a1e, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.scorch = new THREE.Mesh(new THREE.SphereGeometry(R * 1.006, 48, 32), this.scorchMat);
    this.scorch.visible = false;
    this.planet.add(this.scorch);
  }

  /** `frac` is remaining crust, 0..1. `flash` is a short hit pulse. */
  setPlanetDamage(frac, flash = 0) {
    if (!this.scorchMat) return;
    const hurt = Math.min(1, Math.max(0, 1 - frac));
    this.scorch.visible = hurt > 0.01;
    this.scorchMat.opacity = hurt * 0.42 + flash * 0.25;
  }

  /** FLAT/VOLUME changes the arena's dimensions, so it gets thrown away. */
  rebuildArena() {
    if (this.arena) {
      this.arena.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.scene.remove(this.arena);
      this.arena = null;
    }
    this.buildArena();
  }

  buildArena() {
    const R = WORLD.arenaRadius;
    const H = WORLD.arenaHeight;
    this.arena = new THREE.Group();
    this.arena.renderOrder = -1;
    this.scene.add(this.arena);

    const wallMat = new THREE.LineBasicMaterial({
      color: 0x2c6d98, transparent: true, opacity: 0.075,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.arenaWallMat = wallMat;

    const pts = [];
    // Vertical ribs at a fixed world spacing, so the wall does not get denser
    // when the arena shrinks.
    const ribs = Math.round(R / 107);
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      pts.push(new THREE.Vector3(x, -H, z), new THREE.Vector3(x, H, z));
    }
    // Horizontal bands only when there is enough height for them to read.
    for (const y of H > 600 ? [-H * 0.5, 0, H * 0.5] : []) {
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const b = ((i + 1) / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R),
          new THREE.Vector3(Math.cos(b) * R, y, Math.sin(b) * R));
      }
    }
    this.arena.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts), wallMat));

    const ringMat = new THREE.LineBasicMaterial({
      color: 0x63b6e6, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.arenaRingMat = ringMat;
    for (const y of [H, -H]) {
      const ring = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        ring.push(new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R));
      }
      this.arena.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), ringMat));
    }
  }

  /** Light the shell up as hulls press against it, so the wall is legible. */
  setWallPressure(p) {
    if (!this.arenaWallMat) return;
    const k = Math.min(1, Math.max(0, p));
    this.arenaWallMat.opacity = 0.075 + k * 0.26;
    this.arenaRingMat.opacity = 0.22 + k * 0.44;
  }

  /** Re-read the graphics preset. Cheap enough to call on every toggle. */
  applyGfx() {
    this.renderer.shadowMap.enabled = GFX.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMappingExposure = GFX.exposure;
    this.sun.intensity = GFX.sunIntensity;
    this.bounce.intensity = GFX.bounceIntensity;
    this.ambient.intensity = GFX.ambientIntensity;
    if (this.bloom) this.bloom.strength = GFX.bloomStrength;
  }

  /**
   * Drag the shadow frustum along with the view. A 1,400-unit box over a
   * 9,400-unit arena is the only way to get shadows that are not mush.
   */
  followShadow(focus) {
    if (!GFX.shadows) return;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(SUN_OFFSET);
    this.sun.target.updateMatrixWorld();
  }

  update(dt) {
    if (this.clouds) this.clouds.rotation.y += dt * 0.004;
    if (this.surface) this.surface.rotation.y += dt * 0.002;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  render() {
    this.composer.render();
  }
}
