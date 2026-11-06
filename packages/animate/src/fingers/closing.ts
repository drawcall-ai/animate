import { Ray, Vector3, type Matrix4, type Object3D, type SkinnedMesh } from 'three';
import { meshesOf } from '../things/thing';
import { bisect } from '../kernel/math';
import { Triangles } from '../kernel/triangles';
import type { Joints } from './joints';
import { DIGITS, type DigitName, type Shape } from './shape';
import { PINCH } from './joints';

/**
 * how a grasp starts to close on a thing: the fingers straight along the palm (a rig's rest fingers, a little curled, would start in a
 * handle the palm lies on); the thumb, which its contact then brings onto the thing (`opposite`), already turned across the palm and out
 * in front of it, its pad toward the fingers' (so its pad does not come round through the thing it opposes)
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
export const PAD_DEPTH = 0.8;
/**
 * the ways across a grip its chords are tried in (over half a turn); how much nearer the way the palm faces counts for against a chord's
 * width (m per unit of the cosine between them: a round rung's chords alike, the one along it); and how squarely the palm must face along
 * the chord to lie on its end (the cosine), the thumb going to the other (a pistol grip's palm on its side, a rung's) — facing across it
 * (on a magazine's edge, under a receiver's corner), the thumb goes away from the fingers' pads instead
 */
const CHORDS = 12, EVEN = 0.004, TIE = Math.SQRT1_2;
/** the steps each fold is tried at, and the halvings within the step it first meets the thing in: 1/128 of its range */
const FOLD = { steps: 16, halvings: 3 } as const;

/** A handle's middle and its line, toward the thumb (the world). */
export interface Line {
  at: Vector3;
  axis: Vector3;
}

/** A hand as a grasp closes it: its digits, the thing's triangles about it and where the hand stands (the world). */
interface Closing {
  joints: Joints;
  near: Triangles;
  world: Matrix4;
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
 * things attached to it (their own `userData.mass`), hidden meshes and the body's own skin (`skins`: an empty in a scene held every mesh
 * under it, the body's too) are not touched; other skinned meshes are touched as they stand at rest.
 */
export function closedOn(joints: Joints, object: Object3D, handle: Line | null, skins: readonly SkinnedMesh[], world: Matrix4 = joints.hand.matrixWorld): { shape: Shape; thumb: Opposed | null } {
  joints.hand.updateWorldMatrix(true, false);
  const shape = structuredClone(WRAP), at: Closing = { joints, near: nearHand(joints, world, object, skins), world };
  for (const digit of DIGITS) {
    const finger = shape[digit];
    const curl = (value: number) => (finger.curl = value), hook = (value: number) => (finger.hook = value);
    if (!opening(at, digit, shape, curl, 1)) closing(at, digit, shape, curl, 1);
    if (!opening(at, digit, shape, hook, 1 - finger.curl)) closing(at, digit, shape, hook, 1 - finger.curl);
  }
  return { shape, thumb: handle && opposite(at, shape, handle) };
}

/**
 * whether `digit` meets `near` as `shape` has it, against how it met it with `set`'s value at 0: one of its segments' palm side
 * (`PAD_DEPTH`) passing into it where it did not at 0 — or one lying on it at 0 (a finger along a receiver's flat underside) sinking past
 * half its flesh
 */
function meeting(at: Closing, digit: DigitName, shape: Shape, set: (value: number) => void): () => boolean {
  set(0);
  const lying = touches(at, digit, shape, PAD_DEPTH), deep = touches(at, digit, shape, PAD_DEPTH / 2);
  return () => touches(at, digit, shape, PAD_DEPTH).some((k) => !lying.includes(k))
    || touches(at, digit, shape, PAD_DEPTH / 2).some((k) => !deep.includes(k));
}

/** `set`'s value of `shape` (0 … `most`) raised from 0 until `digit` meets `near` (`meeting`): stepped up, then halved within the step it
 * first meets it in (1/128 of its range); whether it met it (none met: `most`) */
function closing(at: Closing, digit: DigitName, shape: Shape, set: (value: number) => void, most: number): boolean {
  const met = meeting(at, digit, shape, set), step = most / FOLD.steps;
  for (let k = 1; k <= FOLD.steps; k++) {
    set(k * step);
    if (!met()) continue;
    set(bisect((value) => (set(value), !met()), (k - 1) * step, k * step, FOLD.halvings));
    return true;
  }
  return false;
}

/** `set`'s value of `shape` lowered from `most` until `digit` comes clear of `near` (`meeting`), as `closing` steps it; whether it met it
 * at `most` (clear there: left at `most`) */
function opening(at: Closing, digit: DigitName, shape: Shape, set: (value: number) => void, most: number): boolean {
  const met = meeting(at, digit, shape, set), step = most / FOLD.steps;
  for (let k = FOLD.steps; k >= 0; k--) {
    set(k * step);
    if (met()) continue;
    if (k === FOLD.steps) return false;
    set(bisect((value) => (set(value), !met()), k * step, (k + 1) * step, FOLD.halvings));
    return true;
  }
  set(0);
  return true;
}

/**
 * where the thumb opposes the handle `handle` (its middle and line, the world's), `near`, as `shape` closed the fingers on it (the world):
 * at an end of the handle's narrowest chord square to its line, level along it with the thumb's pad as `WRAP` has it (it reaches across
 * beside the index, not the palm's middle) — a magazine's thickness, a receiver's width, a pistol grip's from side to side; of chords as
 * narrow as each other (`EVEN`, a round rung's), the one nearest the way the palm faces — the end away from the palm where it faces
 * along the chord (`TIE`), else away from the fingers' pads. Its pad goes on that face where
 * the line along the chord through its pad as `WRAP` has it meets it (within the chord's width of its end; else at the end), facing back
 * along the chord; no chord (nothing about the line within `GIRTH`), none.
 */
function opposite(hand: Closing, shape: Shape, handle: Line): Opposed | null {
  const { joints, near, world } = hand;
  const palm = joints.touch(null, shape);
  const at = palm.at.applyMatrix4(world), faces = palm.facing.transformDirection(world), axis = handle.axis;
  const thumb = joints.pad('thumb', shape, new Vector3(), _facing, PINCH).applyMatrix4(world);
  // (how far the surface is from `from` along `way`: where a line in from `GIRTH` out first meets it)
  const out = (from: Vector3, way: Vector3) => {
    const hit = near.first(_ray.set(from.clone().addScaledVector(way, GIRTH), way.clone().negate()), GIRTH);
    return hit === null ? null : GIRTH - hit;
  };
  const square = new Vector3().crossVectors(axis, faces);
  if (square.lengthSq() < 1e-8) square.crossVectors(axis, _pad.set(1, 0, 0));
  square.cross(axis).normalize();
  // (the chords through `from`, each way across, with its score)
  const chords = (from: Vector3) => Array.from({ length: CHORDS }, (_, k) => {
    const way = square.clone().applyAxisAngle(axis, (k * Math.PI) / CHORDS), ahead = out(from, way), behind = out(from, way.clone().negate());
    return ahead === null || behind === null ? null : { way, ahead, behind, score: ahead + behind - EVEN * Math.abs(way.dot(faces)) };
  }).filter((chord) => chord !== null);
  // (through the middle of its cross-section, the midpoints of the chords through the handle's line averaged: through a line off to its
  // side, as a receiver's is, the chord across its corner was the narrowest, and the thumb went for the corner)
  const level = handle.at.clone().addScaledVector(axis, thumb.clone().sub(handle.at).dot(axis)), first = chords(level);
  if (!first.length) return null;
  const middle = first.reduce((sum, c) => sum.add(level.clone().addScaledVector(c.way, (c.ahead - c.behind) / 2)), new Vector3()).divideScalar(first.length);
  const best = chords(middle).reduce<ReturnType<typeof chords>[number] | null>((was, c) => !was || c.score < was.score ? c : was, null);
  if (!best) return null;
  // (along the chord, from its middle: the palm, and the fingers' pads)
  const width = best.ahead + best.behind, centre = middle.clone().addScaledVector(best.way, (best.ahead - best.behind) / 2);
  const along = (point: Vector3) => point.clone().sub(centre).dot(best.way) / (width / 2), pads = padsOn(hand, shape);
  const side = -Math.sign(along(Math.abs(faces.dot(best.way)) > TIE ? at : pads));
  const end = middle.clone().addScaledVector(best.way, side >= 0 ? best.ahead : -best.behind), way = end.clone().sub(middle).normalize();
  // (on that face where the thumb already is, in along the chord through its pad as `WRAP` has it, rather than at the chord's own end,
  // which can lie short of the side's middle with the thumb through the face on the way)
  const hit = near.first(_ray.set(thumb.clone().addScaledVector(way, GIRTH), way.clone().negate()), 2 * GIRTH);
  const on = hit === null ? end : thumb.clone().addScaledVector(way, GIRTH - hit);
  return { at: on.distanceTo(end) < width ? on : end, facing: way.negate() };
}

/** the middle of the pads of the fingers whose last segment meets `near` as `shape` has them, else of any that meets it, else of all
 * (the world) */
function padsOn(at: Closing, shape: Shape): Vector3 {
  const { joints, world } = at;
  const met = DIGITS.filter((digit) => touches(at, digit, shape, PAD_DEPTH).length);
  const tips = met.filter((digit) => touches(at, digit, shape, PAD_DEPTH).includes(2));
  const pressing = tips.length ? tips : met.length ? met : DIGITS;
  const sum = new Vector3();
  for (const digit of pressing) sum.add(joints.pad(digit, shape, _pad, _facing, PINCH).applyMatrix4(world));
  return sum.divideScalar(pressing.length);
}


/** `object`'s triangles about `joints`' hand as they stand now, in the world, as far as it reaches (`Joints.span`) — meshes of things
 * attached to it (their own `userData.mass`), hidden meshes and `skins` left out, other skinned meshes as they stand at rest */
function nearHand(joints: Joints, world: Matrix4, object: Object3D, skins: readonly SkinnedMesh[]): Triangles {
  object.updateWorldMatrix(true, true);
  const meshes = meshesOf(object).filter((mesh) => !skins.some((skin) => skin === mesh)).map((mesh) => ({ geometry: mesh.geometry, matrix: mesh.matrixWorld }));
  return new Triangles(meshes, new Vector3().setFromMatrixPosition(world), joints.span * _scale.setFromMatrixScale(world).x + SLACK);
}

/**
 * the segments of `digit` whose palm side (or another line along it, as `Joints.segments`' `side`) passes into `near` as `shape` has it,
 * by index: crossing its surface, or lying inside it (a thumb sunk whole in a stile's flat bar crosses none of its faces), a part a
 * handle's girth thick at most
 */
function touches(at: Closing, digit: DigitName, shape: Shape, side = 1): number[] {
  const { joints, near, world } = at;
  return joints.segments(digit, shape, side, world).flatMap(([start, end], k) => {
    const length = _to.subVectors(end, start).length();
    _ray.set(start, _to.normalize());
    return near.first(_ray, length) === null && !near.inside(_ray, GIRTH) ? [] : [k];
  });
}

const _ray = new Ray(), _to = new Vector3(), _pad = new Vector3(), _facing = new Vector3(), _scale = new Vector3();
