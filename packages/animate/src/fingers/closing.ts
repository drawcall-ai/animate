import { Ray, Vector3, type Object3D } from 'three';
import { meshesOf } from '../things/thing';
import { Triangles } from '../kernel/triangles';
import type { Joints } from './joints';
import { DIGITS, type DigitName, type Shape } from './shape';
import { PINCH } from './joints';

/**
 * how a grasp starts to close on a thing: the fingers straight along the palm (a rig's rest fingers, a little curled, would start in a
 * handle the palm lies on); the thumb, which its contact then brings onto the thing (`opposite`), already turned across the palm and out
 * in front of it, its pad toward the fingers' — started beside the index, the solve brought its pad round through the thing it opposes
 */
const WRAP: Shape = {
  thumb: { curl: 0.3, oppose: 0.5, spread: 0.6 },
  index: { curl: 0, hook: 0, spread: 0 }, middle: { curl: 0, hook: 0, spread: 0 }, ring: { curl: 0, hook: 0, spread: 0 }, little: { curl: 0, hook: 0, spread: 0 },
};
/** how much further than its segments' lengths a digit's palm side reaches from its first joint's, and a hand from its wrist (m: the
 * steps between one segment's palm side and the next's) */
const SLACK = 0.03;
/** how far across what the hand holds its far side is looked for (m): a thick handle's girth, a magazine's depth */
const GIRTH = 0.09;
/**
 * how far a digit's palm side is taken to touch, as a share of its depth from the bone: a fifth pressed in, as the pad's flesh gives (a
 * segment lying along a thing's surface, grazing it, does not stop the fold)
 */
const PRESSED = 0.8;
/** the ways across a grip its chords are tried in (over half a turn); how much nearer the way the palm faces counts for against a chord's
 * width (m per unit of the cosine between them: a round rung's chords alike, the one along it); and how much nearer one end of the chord
 * than the other the palm must lie, as a share of its width, for the thumb to go to the other */
const CHORDS = 12, EVEN = 0.004, TIE = 0.3;
/** the steps each fold is tried at, and the halvings within the step it first meets the thing in: 1/128 of its range */
const STEPS = 16, HALVINGS = 3;

/** A handle's middle and its line, toward the thumb (the world). */
export interface Line {
  at: Vector3;
  axis: Vector3;
}

/** Where a grasp's thumb goes on the handle (the world): its pad at `at`, facing `facing`, back against the fingers or the palm across it. */
export interface Opposed {
  at: Vector3;
  facing: Vector3;
}

/**
 * The shape hand `joints` takes closed on `object` as the hand stands now, and where its thumb opposes it. Each finger curled as far as
 * it goes on the object, then its two end joints hooked on so too (a handle across the palm wraps, the fingertips round it; a box's flat
 * underside, the fingers lie along it and fold up its side) — opened from a fist until it comes clear (what a finger passes on its way in,
 * a trigger guard before a grip's front, does not stop it); clear of it even as a fist, it lies on what it meets curling from straight
 * instead (a finger under a box folded into the palm below it) — a finger meeting nothing folding into the palm (past the end of a grip).
 * On a handle (`handle`, its middle and line, the world's) the thumb then opposes them (`opposite`): a grasp clamps what it holds between
 * the thumb's pad on one face and the fingers' pads, or the palm, on the other — its pad there is a contact of its own, met once the arm
 * has brought the hand, from the thumb `WRAP` has; a palm elsewhere presses on what it is on, the thumb as `WRAP` has it. Meshes of
 * things attached to it (their own `userData.mass`) and hidden meshes are not touched; skinned meshes are touched as they stand at rest.
 */
export function closedOn(joints: Joints, object: Object3D, handle: Line | null): { shape: Shape; thumb: Opposed | null } {
  const shape = structuredClone(WRAP), near = nearHand(joints, object);
  for (const digit of DIGITS) {
    const finger = shape[digit];
    const curl = (value: number) => (finger.curl = value), hook = (value: number) => (finger.hook = value);
    if (!opening(joints, near, digit, shape, curl, 1)) closing(joints, near, digit, shape, curl, 1);
    if (!opening(joints, near, digit, shape, hook, 1 - finger.curl)) closing(joints, near, digit, shape, hook, 1 - finger.curl);
  }
  return { shape, thumb: handle && opposite(joints, near, shape, handle) };
}

/**
 * whether `digit` meets `near` as `shape` has it, against how it met it with `set`'s value at 0: one of its segments' palm side
 * (`PRESSED`) passing into it where it did not at 0 — or one lying on it at 0 (a finger along a receiver's flat underside) sinking past
 * half its flesh
 */
function meeting(joints: Joints, near: Triangles, digit: DigitName, shape: Shape, set: (value: number) => void): () => boolean {
  set(0);
  const lying = touches(joints, near, digit, shape, PRESSED), deep = touches(joints, near, digit, shape, PRESSED / 2);
  return () => touches(joints, near, digit, shape, PRESSED).some((k) => !lying.includes(k))
    || touches(joints, near, digit, shape, PRESSED / 2).some((k) => !deep.includes(k));
}

/** `set`'s value of `shape` (0 … `most`) raised from 0 until `digit` meets `near` (`meeting`): stepped up, then halved within the step it
 * first meets it in (1/128 of its range); whether it met it (none met: `most`) */
function closing(joints: Joints, near: Triangles, digit: DigitName, shape: Shape, set: (value: number) => void, most: number): boolean {
  const met = meeting(joints, near, digit, shape, set), step = most / STEPS;
  for (let k = 1; k <= STEPS; k++) {
    set(k * step);
    if (!met()) continue;
    set(halved(met, set, (k - 1) * step, k * step));
    return true;
  }
  return false;
}

/** `set`'s value of `shape` lowered from `most` until `digit` comes clear of `near` (`meeting`), as `closing` steps it; whether it met it
 * at `most` (clear there: left at `most`) */
function opening(joints: Joints, near: Triangles, digit: DigitName, shape: Shape, set: (value: number) => void, most: number): boolean {
  const met = meeting(joints, near, digit, shape, set), step = most / STEPS;
  for (let k = STEPS; k >= 0; k--) {
    set(k * step);
    if (met()) continue;
    if (k === STEPS) return false;
    set(halved(met, set, k * step, (k + 1) * step));
    return true;
  }
  set(0);
  return true;
}

/** the value between `free` (clear: `met` false) and `hit` it halves down to, `HALVINGS` times: the clear one nearest `hit` */
function halved(met: () => boolean, set: (value: number) => void, free: number, hit: number): number {
  for (let h = 0; h < HALVINGS; h++) {
    const mid = (free + hit) / 2;
    set(mid);
    if (met()) hit = mid;
    else free = mid;
  }
  return free;
}

/**
 * where the thumb opposes the handle `handle` (its middle and line, the world's), `near`, as `shape` closed the fingers on it (the world):
 * at an end of the handle's narrowest chord square to its line, level along it with the thumb's pad as `WRAP` has it (it reaches across
 * beside the index, not the palm's middle) — a magazine's thickness, a receiver's width, a pistol grip's from side to side; of chords as
 * narrow as each other (`EVEN`, a round rung's), the one nearest the way the palm faces — the end away from the palm, or where the palm
 * lies about as near both (`TIE`: on a magazine's edge, under a receiver), away from the fingers' pads. Its pad goes there, facing back
 * along the chord; no chord (nothing about the line within `GIRTH`), none.
 */
function opposite(joints: Joints, near: Triangles, shape: Shape, handle: Line): Opposed | null {
  const world = joints.hand.matrixWorld, palm = joints.touch(null, shape);
  const at = palm.at.applyMatrix4(world), faces = palm.facing.transformDirection(world), axis = handle.axis;
  const thumb = joints.pad('thumb', shape, new Vector3(), _facing, PINCH).applyMatrix4(world);
  const middle = handle.at.clone().addScaledVector(axis, thumb.sub(handle.at).dot(axis));
  // (how far the surface is from the middle along `way`: where a line in from `GIRTH` out first meets it)
  const out = (way: Vector3) => {
    const hit = near.first(_ray.set(middle.clone().addScaledVector(way, GIRTH), way.clone().negate()), GIRTH);
    return hit === null ? null : GIRTH - hit;
  };
  const square = new Vector3().crossVectors(axis, faces);
  if (square.lengthSq() < 1e-8) square.crossVectors(axis, _pad.set(1, 0, 0));
  square.cross(axis).normalize();
  let best: { way: Vector3; ahead: number; behind: number; score: number } | null = null;
  for (let k = 0; k < CHORDS; k++) {
    const way = square.clone().applyAxisAngle(axis, (k * Math.PI) / CHORDS), ahead = out(way), behind = out(way.clone().negate());
    if (ahead === null || behind === null) continue;
    const score = ahead + behind - EVEN * Math.abs(way.dot(faces));
    if (!best || score < best.score) best = { way, ahead, behind, score };
  }
  if (!best) return null;
  const ends = [middle.clone().addScaledVector(best.way, best.ahead), middle.clone().addScaledVector(best.way, -best.behind)];
  const width = best.ahead + best.behind, pads = padsOn(joints, near, shape);
  const away = Math.abs(ends[0].distanceTo(at) - ends[1].distanceTo(at)) > TIE * width || !pads ? at : pads;
  const end = ends[0].distanceTo(away) > ends[1].distanceTo(away) ? ends[0] : ends[1];
  return { at: end, facing: middle.sub(end).normalize() };
}

/** the middle of the pads of the fingers whose last segment meets `near` as `shape` has them, else of any that meets it (the world); none
 * meeting it, none */
function padsOn(joints: Joints, near: Triangles, shape: Shape): Vector3 | null {
  const met = DIGITS.filter((digit) => touches(joints, near, digit, shape, PRESSED).length);
  const tips = met.filter((digit) => touches(joints, near, digit, shape, PRESSED).includes(2)), pressing = tips.length ? tips : met;
  if (!pressing.length) return null;
  const sum = new Vector3();
  for (const digit of pressing) sum.add(joints.pad(digit, shape, _pad, _facing, PINCH).applyMatrix4(joints.hand.matrixWorld));
  return sum.divideScalar(pressing.length);
}

/** the world's scale of `node` */
function scaleOf(node: Object3D): number {
  return _scale.setFromMatrixScale(node.matrixWorld).x;
}

/** `object`'s triangles about `joints`' hand as they stand now, in the world, as far as it reaches (`Joints.span`) — meshes of things
 * attached to it (their own `userData.mass`) and hidden meshes left out, skinned meshes as they stand at rest */
function nearHand(joints: Joints, object: Object3D): Triangles {
  joints.hand.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, true);
  const meshes = meshesOf(object).map((mesh) => ({ geometry: mesh.geometry, matrix: mesh.matrixWorld }));
  return new Triangles(meshes, joints.hand.getWorldPosition(new Vector3()), joints.span * scaleOf(joints.hand) + SLACK);
}

/**
 * the segments of `digit` whose palm side (or another line along it, as `Joints.segments`' `side`) passes into `near` as `shape` has it,
 * by index: crossing its surface, or lying inside it (a thumb sunk whole in a stile's flat bar crosses none of its faces), a part a
 * handle's girth thick at most
 */
function touches(joints: Joints, near: Triangles, digit: DigitName, shape: Shape, side = 1): number[] {
  return joints.segments(digit, shape, side).flatMap(([start, end], k) => {
    const length = _to.subVectors(end, start).length();
    _ray.set(start, _to.normalize());
    return near.first(_ray, length) === null && !near.inside(_ray, GIRTH) ? [] : [k];
  });
}

const _ray = new Ray(), _to = new Vector3(), _pad = new Vector3(), _facing = new Vector3(), _scale = new Vector3();
