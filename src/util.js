/**
 * Small shared helpers: deterministic randomness, clamping, and the three
 * pieces of vector maths that both the flight model and the gunnery need.
 */
import * as THREE from 'three';

/**
 * Seeded xorshift32. Deterministic on purpose: every automated study replays
 * a match from its seed, so `Math.random()` anywhere in the simulation would
 * make a result impossible to reproduce or bisect.
 *
 * The seed is mixed twice before use because raw small integers (1, 2, 3 —
 * exactly what a loop over match numbers produces) leave xorshift correlated
 * for its first several outputs, which showed up as suspiciously similar
 * openings across consecutive seeds.
 */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  s = Math.imul(s ^ (s >>> 16), 73244475) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 73244475) >>> 0;
  s = ((s ^ (s >>> 16)) >>> 0) || 1;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const _altUp = new THREE.Vector3(0, 0, 1);
const _bankAxis = new THREE.Vector3(0, 0, 1);
const _bankQuat = new THREE.Quaternion();

/**
 * Turn `obj` toward `dir` at no more than `maxRadians` this step, with an
 * optional roll about the nose so craft bank into a turn.
 *
 * Note the basis is built with lookAt(ZERO, dir, up) and copied onto the
 * quaternion, NOT via Object3D.lookAt(): that method swaps its arguments for
 * non-camera objects and aims +Z at the target, and these hulls are modelled
 * nose-down -Z. Using it pointed every ship's tail where it was going.
 */
export function steerTowards(obj, dir, maxRadians, bank = 0) {
  if (dir.lengthSq() < 1e-8) return;
  _dir.copy(dir).normalize();
  // A target directly overhead makes the usual +Y up-vector degenerate.
  const up = Math.abs(_dir.y) > 0.995 ? _altUp : _up;
  _mat.lookAt(ZERO, _dir, up);
  _quat.setFromRotationMatrix(_mat);
  if (bank) _quat.multiply(_bankQuat.setFromAxisAngle(_bankAxis, bank));
  obj.quaternion.rotateTowards(_quat, maxRadians);
}

const _toTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();

/** Angle in radians between an object's nose (-Z) and a world position. */
export function angleToTarget(obj, targetPos) {
  _toTarget.copy(targetPos).sub(obj.position);
  if (_toTarget.lengthSq() < 1e-8) return 0;
  _toTarget.normalize();
  _forward.set(0, 0, -1).applyQuaternion(obj.quaternion);
  return Math.acos(clamp(_forward.dot(_toTarget), -1, 1));
}

/**
 * Where to shoot so a shell and a moving target arrive together. Deliberately
 * a single-step approximation rather than solving the quadratic: the error is
 * small at these speeds, and an exact solution makes fast craft feel
 * unfairly impossible to escape.
 */
export function leadPoint(from, targetPos, targetVel, projectileSpeed, out) {
  out.copy(targetPos);
  const dist = from.distanceTo(targetPos);
  if (projectileSpeed <= 0) return out;
  const t = dist / projectileSpeed;
  return out.addScaledVector(targetVel, t);
}

/** m:ss for the battle clock. */
export function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
