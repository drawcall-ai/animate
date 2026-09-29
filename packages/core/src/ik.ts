import { Vector3 } from 'three';
import { clamp } from './math';

const _d = new Vector3();
const _p = new Vector3();

/**
 * Analytic two-bone IK (law of cosines). The middle joint bends toward `pole`
 * (a direction, projected perpendicular to root→target). Writes the middle and
 * end joints; returns how far the target was out of reach (0 if reachable).
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  len1: number,
  len2: number,
  pole: Vector3,
  outMid: Vector3,
  outEnd: Vector3,
  maxExtension = 0.999,
  softness = 0,
): number {
  _d.subVectors(target, root);
  const raw = _d.length();
  const maxLen = (len1 + len2) * maxExtension;
  const minLen = Math.abs(len1 - len2) + 1e-4;
  // soft IK: ease into full extension instead of snapping straight (the knee/elbow
  // angle is ultra-sensitive near straight, so a hard clamp reads as jitter)
  const soft = softness * (len1 + len2);
  let dist = raw;
  if (soft > 0 && raw > maxLen - soft) dist = maxLen - soft + soft * (1 - Math.exp(-(raw - (maxLen - soft)) / soft));
  dist = clamp(dist, minLen, maxLen);
  if (raw < 1e-6) _d.set(0, -1, 0);
  else _d.divideScalar(raw);

  outEnd.copy(root).addScaledVector(_d, dist);

  const cosA = clamp((len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);

  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-10) {
    // pole parallel to the limb: choose any perpendicular
    _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
    if (_p.lengthSq() < 1e-10) _p.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  _p.normalize();

  outMid.copy(root).addScaledVector(_d, cosA * len1).addScaledVector(_p, sinA * len1);
  return Math.max(0, raw - maxLen);
}
