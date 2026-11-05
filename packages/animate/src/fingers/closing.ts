import { Matrix4, Ray, Vector3, type Object3D } from 'three';
import { meshesOf } from '../things/thing';
import { Triangles } from '../kernel/triangles';
import type { Joints } from './joints';
import { DIGITS, LIFTED, SPLAYED, type Digit, type Shape } from './shape';

/**
 * how a grasp starts to close on a thing: the fingers straight along the palm (a rig's rest fingers, a little curled, would start in a
 * handle the palm lies on), the thumb beside the index (it reaches round afresh, `padToward`)
 */
const WRAP: Shape = {
  thumb: { curl: 0, oppose: 0, spread: 0 },
  index: { curl: 0, hook: 0, spread: 0 }, middle: { curl: 0, hook: 0, spread: 0 }, ring: { curl: 0, hook: 0, spread: 0 }, little: { curl: 0, hook: 0, spread: 0 },
};
/** how much further than its segments' lengths a digit's palm side reaches from its first joint's, and a hand from its wrist (m: the
 * steps between one segment's palm side and the next's) */
const SLACK = 0.03;
/** how strongly a digit reaching for a point keeps to the shape it is asked (`padToward`): each unit of a value it leaves weighs as a miss
 * of this share of the hand's span (a shape pulled toward, not held to) */
const PULL = 0.05;
/** how far out from the palm the far side of what it holds is looked for (m): a thick handle's girth */
const GIRTH = 0.08;
/**
 * how far a digit's palm side is taken to touch, as a share of its depth from the bone: a fifth pressed in, as the pad's flesh gives (a
 * segment lying along a thing's surface, grazing it, does not stop the fold)
 */
const PRESSED = 0.8;
/** the steps each fold is tried at, and the halvings within the step it first meets the thing in: 1/128 of its range */
const STEPS = 16, HALVINGS = 3;

/** A handle's line in a hand's frame: a point on its axis and the axis's way. */
export interface Line {
  at: Vector3;
  axis: Vector3;
}

/**
 * The shape hand `joints` takes closed on `object` as the hand stands now: each finger curled as far as it goes on the object, then its
 * two end joints hooked on so too (a handle across the palm wraps, the fingertips round it; a box's flat underside, the fingers lie along
 * it and fold up its side) — opened from a fist until it comes clear (what a finger passes on its way in, a trigger guard before a grip's
 * front, does not stop it); clear of it even as a fist, it lies on what it meets curling from straight instead (a finger under a box
 * folded into the palm below it) — a finger meeting nothing folding into the palm (past the end of a grip). The thumb then: on a handle
 * (`handle`, its line in the hand's frame) wrapped round it from the other side (`wrapped`); elsewhere its pad reached to the far side of
 * what the palm holds (`farSide`, `padToward`). Meshes of things attached to it (their own `userData.mass`) and hidden meshes are not
 * touched; skinned meshes are touched as they stand at rest. Closed again on it a little further on (`was`, the shape it closed to
 * before), the thumb looks only close about where it was.
 */
export function closedOn(joints: Joints, object: Object3D, handle: Line | null, was: Shape | null = null): Shape {
  const shape = structuredClone(WRAP), near = nearHand(joints, object);
  for (const digit of DIGITS) {
    const finger = shape[digit];
    const curl = (value: number) => (finger.curl = value), hook = (value: number) => (finger.hook = value);
    if (!opening(joints, near, digit, shape, curl, 1)) closing(joints, near, digit, shape, curl, 1);
    if (!opening(joints, near, digit, shape, hook, 1 - finger.curl)) closing(joints, near, digit, shape, hook, 1 - finger.curl);
  }
  if (handle) wrapped(joints, near, shape, handle, was);
  else {
    if (was) shape.thumb = { ...was.thumb };
    padToward(joints, object, shape, 'thumb', farSide(joints, near, shape), !was);
  }
  return shape;
}

/**
 * whether `digit` meets `near` as `shape` has it, against how it met it with `set`'s value at 0: one of its segments' palm side
 * (`PRESSED`), past its metacarpal for a thumb (the ball of the thumb lies in the palm against what it holds), passing into it where it
 * did not at 0 — or one lying on it at 0 (a finger along a receiver's flat underside) sinking past half its flesh
 */
function meeting(joints: Joints, near: Triangles, digit: Digit, shape: Shape, set: (value: number) => void): () => boolean {
  const counted = (k: number) => digit !== 'thumb' || k > 0;
  set(0);
  const lying = touches(joints, near, digit, shape, PRESSED), deep = touches(joints, near, digit, shape, PRESSED / 2);
  return () => touches(joints, near, digit, shape, PRESSED).some((k) => counted(k) && !lying.includes(k))
    || touches(joints, near, digit, shape, PRESSED / 2).some((k) => counted(k) && !deep.includes(k));
}

/** `set`'s value of `shape` (0 … `most`) raised from 0 until `digit` meets `near` (`meeting`): stepped up, then halved within the step it
 * first meets it in (1/128 of its range); whether it met it (none met: `most`) */
function closing(joints: Joints, near: Triangles, digit: Digit, shape: Shape, set: (value: number) => void, most: number): boolean {
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
function opening(joints: Joints, near: Triangles, digit: Digit, shape: Shape, set: (value: number) => void, most: number): boolean {
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
 * `shape`'s thumb wrapped round the handle `line` (the hand's frame), in place, as a power grasp's thumb closes over the fingers from the
 * other side: its base swung (`oppose`, `spread`) to each of a grid of ways, its outer joints curled from straight until it meets the
 * handle (`closing`), and of those whose bones keep out of it, the one whose pad comes furthest round the handle from the palm, meeting it
 * (round a pistol grip's back strap onto its far side, under a rung the fingers come over) — none meeting it, the furthest round; a coarse
 * grid over their whole range, then a fine one about the best (only that, about `was`, closing again as the hand settles).
 */
function wrapped(joints: Joints, near: Triangles, shape: Shape, line: Line, was: Shape | null): void {
  const thumb = shape.thumb, palm = across(joints.touch(null, shape).at, line).normalize();
  let best = was ? { ...was.thumb } : null, score = -Infinity;
  for (const { step, span } of was ? [{ step: 0.1, span: 0.1 }] : [{ step: 0.3, span: 2 }, { step: 0.1, span: 0.2 }]) {
    const centre = best ?? { oppose: 0, spread: 0 };
    for (let oppose = Math.max(SPLAYED, centre.oppose - span); oppose <= Math.min(1, centre.oppose + span) + 1e-9; oppose += step) {
      for (let spread = Math.max(SPLAYED, centre.spread - span); spread <= Math.min(1, centre.spread + span) + 1e-9; spread += step) {
        Object.assign(thumb, { oppose, spread });
        closing(joints, near, 'thumb', shape, (value) => (thumb.curl = value), 1);
        const through = touches(joints, near, 'thumb', shape, 0), met = touches(joints, near, 'thumb', shape, PRESSED).includes(2);
        const pad = across(joints.pad('thumb', shape, _pad), line).normalize();
        const round = Math.acos(Math.max(-1, Math.min(1, pad.dot(palm)))) - (met ? 0 : Math.PI);
        if (through.length) continue;
        if (round > score) [score, best] = [round, { ...thumb }];
      }
    }
  }
  Object.assign(thumb, best ?? { curl: 0, oppose: 0, spread: 0 });
}

/** how far out from `line` `point` lies, square to it (the hand's frame) */
function across(point: Readonly<Vector3>, line: Line): Vector3 {
  const off = point.clone().sub(line.at);
  return off.addScaledVector(line.axis, -off.dot(line.axis));
}

/** one of a digit's values as `padToward` searches it, from `least` (a finger's curl `LIFTED`, a thumb's oppose and spread `SPLAYED`) to 1 */
interface Value {
  get(): number;
  set(value: number): void;
  least: number;
}

/**
 * `shape` with `digit` bent so its pad is as near `target` (the hand's frame) as it comes without passing into `object`, kept near how
 * `shape` has it as it comes (`PULL`), in place: a
 * finger's curl (lifted too), hook and spread, a thumb's curl, opposition and spread (splayed too), searched over their range on a coarse grid,
 * then on a fine one about the best so far (`afresh`), or only close about `shape` as it comes (an empty moved a little in the hand: a
 * hand's drift on its grip re-reaches every few frames). Each grid's shapes are tried nearest first, the first whose palm side (`PRESSED`,
 * as a closing fold's), bones and back all keep out of the object taken (a trigger finger goes into the guard, not through its frame; a
 * thumb reaching under a rung goes round it, not through); with none, the nearest of those passing into it least (against a stile's flat
 * face, the thumb that comes round its edge). The part `pressed` (the target's own: a trigger blade) is what the pad presses on, not kept
 * out of (counted, a pad on a 6 mm blade always touched it, and the finger stayed laid straight 3 cm off it). Given a line `along` (the
 * hand's frame) through `target`, anywhere on that line is as near.
 */
export function padToward(joints: Joints, object: Object3D, shape: Shape, digit: Digit, target: Readonly<Vector3>, afresh: boolean, pressed: Object3D | null = null, along: Readonly<Vector3> | null = null): void {
  const near = nearHand(joints, object, { digit, shape, pressed });
  const thumb = shape.thumb, finger = digit === 'thumb' ? null : shape[digit];
  /** a segment touching that counts: not the thumb's metacarpal, the ball of the thumb, which lies in the palm against what it holds */
  const palmless = (k: number) => finger !== null || k > 0;
  const values: Value[] = finger
    ? (['curl', 'hook', 'spread'] as const).map((key) => ({ get: () => finger[key], set: (v: number) => (finger[key] = v), least: key === 'curl' ? LIFTED : 0 }))
    : (['curl', 'oppose', 'spread'] as const).map((key) => ({ get: () => thumb[key], set: (v: number) => (thumb[key] = v), least: key === 'curl' ? 0 : SPLAYED }));
  /** how many of the digit's segment lines (palm side, bone, back) pass into the object as `shape` has it, counted no further than `most` */
  const into = (most: number) => {
    let count = 0;
    for (const side of [PRESSED, 0, -PRESSED]) if ((count += touches(joints, near, digit, shape, side).filter(palmless).length) >= most) break;
    return count;
  };
  let best = values.map((value) => value.get());
  const start = [...best];
  for (const { step, span } of afresh ? [{ step: 0.2, span: 2 }, { step: 0.05, span: 0.2 }, { step: 0.02, span: 0.05 }] : [{ step: 0.02, span: 0.04 }]) {
    const grids = best.map((centre, k) => {
      const out: number[] = [];
      for (let v = Math.max(values[k].least, centre - span); v <= Math.min(1, centre + span) + 1e-9; v += step) out.push(v);
      return out;
    });
    const tried: { chosen: number[]; miss: number }[] = [];
    const search = (k: number, chosen: number[]) => {
      if (k === values.length) {
        chosen.forEach((v, j) => values[j].set(v));
        const miss = joints.pad(digit, shape, _pad).sub(target);
        const pulled = chosen.reduce((sum, v, j) => sum + Math.abs(v - start[j]), 0) * PULL * joints.span;
        tried.push({ chosen, miss: (along ? miss.addScaledVector(along, -miss.dot(along)) : miss).length() + pulled });
        return;
      }
      for (const v of grids[k]) search(k + 1, [...chosen, v]);
    };
    search(0, []);
    let least = Infinity;
    for (const { chosen } of tried.sort((a, b) => a.miss - b.miss)) {
      chosen.forEach((v, j) => values[j].set(v));
      const count = into(least);
      if (count < least) [least, best] = [count, chosen];
      if (count === 0) break;
    }
  }
  best.forEach((v, j) => values[j].set(v));
}

/**
 * the far side of what the palm holds, `near`, as `shape` has the hand (its frame): where a line on from the palm's middle the way it faces
 * comes out of it, within `GIRTH` — none there, the palm's middle as far out as a handle's girth
 */
function farSide(joints: Joints, near: Triangles, shape: Shape): Vector3 {
  const palm = joints.touch(null, shape), world = joints.hand.matrixWorld;
  const from = palm.at.clone().applyMatrix4(world), way = palm.facing.clone().transformDirection(world);
  _ray.set(from.clone().addScaledVector(way, GIRTH), way.clone().negate());
  const met = near.first(_ray, GIRTH);
  return from.addScaledVector(way, met === null ? GIRTH : GIRTH - met).applyMatrix4(_back.copy(world).invert());
}

/** the world's scale of `node` */
function scaleOf(node: Object3D): number {
  return _scale.setFromMatrixScale(node.matrixWorld).x;
}

/** `object`'s triangles about `joints`' hand as they stand now, in the world, as far as it reaches (`Joints.span`) — or only those `reach`'s digit reaches, about its first joint
 * (every bend `padToward` tries is checked against them, and a grip's whole receiver is thousands), its part `pressed` left out — meshes of
 * things attached to it (their own `userData.mass`) and hidden meshes left out, skinned meshes as they stand at rest */
function nearHand(joints: Joints, object: Object3D, reach?: { digit: Digit; shape: Shape; pressed: Object3D | null }): Triangles {
  joints.hand.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, true);
  const pressed = new Set<Object3D>();
  reach?.pressed?.traverse((node) => pressed.add(node));
  const meshes = meshesOf(object).filter((mesh) => !pressed.has(mesh)).map((mesh) => ({ geometry: mesh.geometry, matrix: mesh.matrixWorld }));
  if (!reach) return new Triangles(meshes, joints.hand.getWorldPosition(new Vector3()), joints.span * scaleOf(joints.hand) + SLACK);
  const segments = joints.segments(reach.digit, reach.shape), length = segments.reduce((sum, [start, end]) => sum + start.distanceTo(end), 0);
  return new Triangles(meshes, segments[0][0], length + SLACK);
}

/**
 * the segments of `digit` whose palm side (or another line along it, as `Joints.segments`' `side`) passes into `near` as `shape` has it,
 * by index: crossing its surface, or lying inside it (a thumb sunk whole in a stile's flat bar crosses none of its faces), a part a
 * handle's girth thick at most
 */
function touches(joints: Joints, near: Triangles, digit: Digit, shape: Shape, side = 1): number[] {
  return joints.segments(digit, shape, side).flatMap(([start, end], k) => {
    const length = _to.subVectors(end, start).length();
    _ray.set(start, _to.normalize());
    return near.first(_ray, length) === null && !near.inside(_ray, GIRTH) ? [] : [k];
  });
}

const _ray = new Ray(), _to = new Vector3(), _pad = new Vector3(), _back = new Matrix4(), _scale = new Vector3();
