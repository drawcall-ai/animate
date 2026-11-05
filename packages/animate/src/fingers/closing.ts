import { Ray, Vector3, type Object3D } from 'three';
import { meshesOf } from '../things/thing';
import { Triangles } from '../kernel/triangles';
import type { Digit, Joints } from './joints';
import { DIGITS, type Shape } from './shape';

/** how a grasp closes on a thing, each digit folding until it touches: the thumb swung this far across (`Thumb.oppose`), the fingers straight */
const WRAP: Shape = {
  thumb: { curl: 0, oppose: 0.55 },
  index: { curl: 0, hook: 0, spread: 0 }, middle: { curl: 0, hook: 0, spread: 0 }, ring: { curl: 0, hook: 0, spread: 0 }, little: { curl: 0, hook: 0, spread: 0 },
};
/** how far from the wrist a hand's fingers reach (m; a long hand's 0.21 m, and a handle's girth) */
const REACH = 0.3;
/**
 * how far a digit's palm side is taken to touch, as a share of its depth from the bone: a fifth pressed in, as the pad's flesh gives (a
 * segment lying along a thing's surface, grazing it, does not stop the fold)
 */
const PRESSED = 0.8;
/** the steps each fold is tried at, and the halvings within the step it first touches in: 1/128 of its range */
const STEPS = 8, HALVINGS = 4;

/**
 * The shape hand `joints` takes closed on `object` as the hand stands now: each finger curled until a segment's palm side (`PRESSED`) touches the
 * object's meshes, then its two end joints hooked on until they touch too (a handle across the palm wraps, the fingertips round it); the
 * thumb, swung across the palm, curled until it touches. A segment touching as its fold starts lies in the object already and the others
 * fold on past it; a digit clear of the object folds all the way (fingers past the end of a grip close into the palm). Meshes of things
 * attached to it (their own `userData.mass`) and hidden meshes are not touched; skinned meshes are touched as they stand at rest.
 */
export function closedOn(joints: Joints, object: Object3D): Shape {
  const shape = structuredClone(WRAP), near = nearHand(joints, object);
  /** the segments of `digit` touching the object as `shape` has it now, by index */
  const touching = (digit: Digit) => touches(joints, near, digit, shape, PRESSED);
  /** the most of `set`'s range (0 … `most`) it folds to before a segment comes to touch: stepped out from 0, so a fold does not pass
   * through a thin rung on its way, then halved within the step it first touches in */
  const fold = (digit: Digit, set: (value: number) => void, most: number) => {
    const embedded = new Set(touching(digit));
    const meets = () => touching(digit).some((k) => !embedded.has(k));
    let clear = 0, met = most;
    for (let k = 1; k <= STEPS; k++) {
      set((k / STEPS) * most);
      if (meets()) break;
      clear = (k / STEPS) * most;
    }
    if (clear === most) return set(most);
    met = Math.min(most, clear + most / STEPS);
    for (let k = 0; k < HALVINGS; k++) {
      const mid = (clear + met) / 2;
      set(mid);
      if (meets()) met = mid;
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

/** the triangles of `object`'s meshes about `joints`' hand as both stand now, in the world (the meshes as `closedOn` touches them) */
export function nearHand(joints: Joints, object: Object3D): Triangles {
  joints.hand.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, true);
  const meshes = meshesOf(object), hand = joints.hand.getWorldPosition(new Vector3());
  return new Triangles(meshes.map((mesh) => ({ geometry: mesh.geometry, matrix: mesh.matrixWorld })), hand, REACH);
}

/**
 * the segments of `digit` whose palm side (or another line along it, as `Joints.segments`' `side`) passes into `near` as `shape` has it,
 * by index: crossing its surface, or lying inside it (a thumb sunk whole in a stile's flat bar crosses none of its faces)
 */
function touches(joints: Joints, near: Triangles, digit: Digit, shape: Shape, side = 1): number[] {
  return joints.segments(digit, shape, side).flatMap(([start, end], k) => {
    const length = _to.subVectors(end, start).length();
    _ray.set(start, _to.normalize());
    return near.first(_ray, length) === null && !near.inside(_ray) ? [] : [k];
  });
}

/** one of a digit's values as `reaching` searches it */
interface Value {
  get(): number;
  set(value: number): void;
}

/**
 * `shape` with `digit` bent so its pad is as near `target` (the hand's frame) as it comes, in place: a finger's curl, hook and spread, a
 * thumb's curl and opposition, searched over their range on a coarse grid (`afresh`), then on a fine one about the best so far. A thumb
 * passing into the thing (`near`, its triangles about the hand), its palm side, bones or back, is searched again kept out of it, as it
 * swings round a thing to oppose the fingers: reaching under a rung it goes round it, not through (with every shape passing into it, the
 * nearest of those passing into it least: against a stile's flat face, the thumb that comes round its edge). (A finger's pad on a trigger
 * lies inside its guard: three values to search, kept to the nearest.)
 */
export function reaching(joints: Joints, shape: Shape, digit: Digit, target: Readonly<Vector3>, afresh: boolean, near: Triangles): void {
  const values: Value[] = digit === 'thumb'
    ? [{ get: () => shape.thumb.curl, set: (v) => (shape.thumb.curl = v) }, { get: () => shape.thumb.oppose, set: (v) => (shape.thumb.oppose = v) }]
    : (['curl', 'hook', 'spread'] as const).map((key) => ({ get: () => shape[digit][key], set: (v: number) => (shape[digit][key] = v) }));
  const start = values.map((value) => value.get());
  /** how many of the digit's segment lines (palm side, bone, back) pass into the thing as `shape` has it */
  const into = () => [1, 0, -1].reduce((count, side) => count + touches(joints, near, digit, shape, side).length, 0);
  /** the values nearest, set: kept `out` of the thing (each stage's shapes tried nearest first, the first out of it taken; none: the first
   * of those passing into it least) */
  const nearest = (out: boolean) => {
    let best = [...start];
    for (const { step, span } of [...afresh ? [{ step: 0.1, span: 1 }] : [], { step: 0.02, span: 0.1 }]) {
      const grids = best.map((centre) => {
        const grid: number[] = [];
        for (let v = Math.max(0, centre - span); v <= Math.min(1, centre + span) + 1e-9; v += step) grid.push(v);
        return grid;
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
      tried.sort((a, b) => a.miss - b.miss);
      best = tried[0].chosen;
      for (let k = 0, least = Infinity; out && least > 0 && k < tried.length; k++) {
        const { chosen } = tried[k];
        chosen.forEach((v, j) => values[j].set(v));
        const count = into();
        if (count < least) [least, best] = [count, chosen];
      }
    }
    best.forEach((v, j) => values[j].set(v));
  };
  nearest(false);
  if (digit === 'thumb' && into() > 0) nearest(true);
}

const _ray = new Ray(), _to = new Vector3(), _pad = new Vector3();
