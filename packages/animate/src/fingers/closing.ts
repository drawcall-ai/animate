import { Ray, Vector3, type Object3D } from 'three';
import { meshesOf } from '../things/thing';
import { Triangles } from '../kernel/triangles';
import type { Digit, Joints } from './joints';
import { DIGITS, LIFTED, SPLAYED, type Shape } from './shape';

/**
 * how a grasp closes on a thing, each digit folding until it touches: the thumb swung this far across (`Thumb.oppose`), the fingers
 * straight along the palm (a rig's rest fingers, a little curled, would start in a handle the palm lies on)
 */
const WRAP: Shape = {
  thumb: { curl: 0, oppose: 0.55 },
  index: { curl: 0, hook: 0, spread: 0 }, middle: { curl: 0, hook: 0, spread: 0 }, ring: { curl: 0, hook: 0, spread: 0 }, little: { curl: 0, hook: 0, spread: 0 },
};
/** how far from the wrist a hand's fingers reach (m; a long hand's 0.21 m, and a handle's girth), and how much further than its segments'
 * lengths a digit's palm side reaches from its first joint's (m: the steps between one segment's palm side and the next's) */
const REACH = 0.3, SLACK = 0.03;
/** the steps each fold is tried at, and the halvings within the step it first touches in: 1/128 of its range */
const STEPS = 8, HALVINGS = 4;

/**
 * The shape hand `joints` takes closed on `object` as the hand stands now: each finger curled from straight until a segment's palm side
 * touches the object's meshes, then its two end joints hooked on until they touch too (a handle across the palm wraps, the fingertips
 * round it); the thumb, swung across the palm, curled until it touches. A segment touching as its fold starts lies in the object
 * already: the fold goes on past it until it comes clear, then stops as it touches again (a straight finger's tip in a magazine well
 * hooks out of it and on under the guard); a digit clear of the object folds all the way (fingers past the end of a grip close into the palm). Meshes of things
 * attached to it (their own `userData.mass`) and hidden meshes are not touched; skinned meshes are touched as they stand at rest.
 */
export function closedOn(joints: Joints, object: Object3D): Shape {
  const shape = structuredClone(WRAP), near = nearHand(joints, object);
  const touching = (digit: Digit) => touchingIn(near, joints, digit, shape);
  /** the most of `set`'s range (0 … `most`) it folds to before a segment comes to touch: stepped out from 0, so a fold does not pass
   * through a thin rung on its way, then halved within the step it first touches in */
  const fold = (digit: Digit, set: (value: number) => void, most: number) => {
    const embedded = new Set(touching(digit));
    const touches = () => {
      const now = touching(digit);
      for (const k of embedded) if (!now.includes(k)) embedded.delete(k);
      return now.some((k) => !embedded.has(k));
    };
    let clear = 0, met = most;
    for (let k = 1; k <= STEPS; k++) {
      set((k / STEPS) * most);
      if (touches()) break;
      clear = (k / STEPS) * most;
    }
    if (clear === most) return set(most);
    met = Math.min(most, clear + most / STEPS);
    for (let k = 0; k < HALVINGS; k++) {
      const mid = (clear + met) / 2;
      set(mid);
      if (touches()) met = mid;
      else clear = mid;
    }
    set(clear);
  };
  for (const digit of DIGITS) {
    const finger = shape[digit];
    fold(digit, (value) => (finger.curl = value), 1);
    fold(digit, (value) => (finger.hook = value), 1 - finger.curl);
  }
  fold('thumb', (value) => (shape.thumb.curl = value), 1);
  return shape;
}

/** one of a digit's values as `reaching` searches it, from `least` (a finger's curl `LIFTED`, a thumb's oppose `SPLAYED`) to 1 */
interface Value {
  get(): number;
  set(value: number): void;
  least: number;
}

/**
 * `shape` with `digit` bent so its pad is as near `target` (the hand's frame) as it comes, in place, its segments' palm sides kept out of
 * `object` as `closedOn` touches it (a trigger finger goes into the guard, not through its frame; a bend that goes into it
 * ranks behind every one that keeps clear): a finger's curl (lifted too), hook and spread, a thumb's curl and opposition (splayed too),
 * searched over their range on a coarse grid, then on a fine one about the best so far (`afresh`), or only close about `shape` as it
 * comes (an empty moved a little in the hand: a hand's drift on its grip re-reaches every few frames)
 */
export function reaching(joints: Joints, object: Object3D, shape: Shape, digit: Digit, target: Readonly<Vector3>, afresh: boolean): void {
  const near = nearHand(joints, object, { digit, shape });
  const values: Value[] = digit === 'thumb'
    ? [{ get: () => shape.thumb.curl, set: (v) => (shape.thumb.curl = v), least: 0 }, { get: () => shape.thumb.oppose, set: (v) => (shape.thumb.oppose = v), least: SPLAYED }]
    : (['curl', 'hook', 'spread'] as const).map((key) => ({ get: () => shape[digit][key], set: (v: number) => (shape[digit][key] = v), least: key === 'curl' ? LIFTED : 0 }));
  let best = values.map((value) => value.get()), least = Infinity, into = true;
  for (const { step, span } of afresh ? [{ step: 0.1, span: 2 }, { step: 0.02, span: 0.1 }] : [{ step: 0.02, span: 0.04 }]) {
    const grids = best.map((centre, k) => {
      const out: number[] = [];
      for (let v = Math.max(values[k].least, centre - span); v <= Math.min(1, centre + span) + 1e-9; v += step) out.push(v);
      return out;
    });
    const tried: { chosen: number[]; miss: number }[] = [];
    const search = (k: number, chosen: number[]) => {
      if (k === values.length) {
        chosen.forEach((v, j) => values[j].set(v));
        tried.push({ chosen, miss: joints.pad(digit, shape, _pad).distanceTo(target) });
        return;
      }
      for (const v of grids[k]) search(k + 1, [...chosen, v]);
    };
    search(0, []);
    // (the nearest first, each tried for going into the object until one keeps clear)
    for (const { chosen, miss } of tried.sort((a, b) => a.miss - b.miss)) {
      if (!into && miss >= least) break;
      chosen.forEach((v, j) => values[j].set(v));
      const goes = touchingIn(near, joints, digit, shape).length > 0;
      if (goes && (!into || miss >= least)) continue;
      [least, best, into] = [miss, chosen, goes];
      if (!goes) break;
    }
  }
  best.forEach((v, j) => values[j].set(v));
}

/** `object`'s triangles about `joints`' hand as they stand now, in the world — or only those `reach`'s digit reaches, about its first joint
 * (every bend `reaching` tries is checked against them, and a grip's whole receiver is thousands) — meshes of things attached to it
 * (their own `userData.mass`) and hidden meshes left out, skinned meshes as they stand at rest */
function nearHand(joints: Joints, object: Object3D, reach?: { digit: Digit; shape: Shape }): Triangles {
  joints.hand.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, true);
  const meshes = meshesOf(object).map((mesh) => ({ geometry: mesh.geometry, matrix: mesh.matrixWorld }));
  if (!reach) return new Triangles(meshes, joints.hand.getWorldPosition(new Vector3()), REACH);
  const segments = joints.segments(reach.digit, reach.shape), length = segments.reduce((sum, [start, end]) => sum + start.distanceTo(end), 0);
  return new Triangles(meshes, segments[0][0], length + SLACK);
}

/** the segments of `digit` whose palm sides touch `near` as `shape` has it, by index */
function touchingIn(near: Triangles, joints: Joints, digit: Digit, shape: Shape): number[] {
  return joints.segments(digit, shape).flatMap(([start, end], k) => {
    const length = _to.subVectors(end, start).length();
    return near.first(_ray.set(start, _to.normalize()), length) === null ? [] : [k];
  });
}

const _ray = new Ray(), _to = new Vector3(), _pad = new Vector3();
