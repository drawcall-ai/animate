import { Matrix4, Mesh, Quaternion, Ray, Vector3, type Object3D, type SkinnedMesh } from 'three';
import type { Placement } from '../kernel/goal';
import { bisect } from '../kernel/math';
import { Triangles } from '../kernel/triangles';
import { FLAT, type Joints } from './joints';
import { DIGITS, SPLAYED, type DigitName, type Shape } from './shape';

/**
 * how a grasp starts to close on a thing: the fingers straight along the palm (a rig's rest fingers, a little curled, would start in a
 * handle the palm lies on); the thumb turned across the palm and out in front of it, its pad toward the fingers', as it stays where it
 * opposes nothing (`opposite`)
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
/** the steps each of the thumb's values is tried at across its range, finding where it meets the face it opposes on */
const REACHING = 8;
/** how deep a ball of the thumb's flesh may sink into the face it reaches (m: its skin's give is in its size already); and how many of its
 * balls, from its base, are its web (`sinks`) */
const SUNK = 0.001, WEB = 4;

/** A grasp's line through what it holds, toward the thumb, and a point on it (the world). */
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

/**
 * The shape hand `joints` takes closed on `object`, the hand standing at `world` (default: as it stands now). Each finger curled as far as
 * it goes on the object, then its two end joints hooked on so too (a handle across the palm wraps, the fingertips round it; a box's flat
 * underside, the fingers lie along it and fold up its side) — opened from a fist until it comes clear (what a finger passes on its way in,
 * a trigger guard before a grip's front, does not stop it); clear of it even as a fist, it lies on what it meets curling from straight
 * instead (a finger under a box folded into the palm below it) — a finger meeting nothing folding into the palm (past the end of a grip).
 * The thumb then opposes them across the grasp (`opposite`; `line`: the grasp's line through the thing, the world's). It touches what
 * `trianglesAbout` gathers.
 */
export function closedOn(joints: Joints, object: Object3D, line: Line, skins: readonly SkinnedMesh[], world: Matrix4 = joints.hand.matrixWorld): Shape {
  joints.hand.updateWorldMatrix(true, false);
  const near = trianglesAbout(object, skins, WORLD, _centre.setFromMatrixPosition(world), joints.span * _scale.setFromMatrixScale(world).x + SLACK);
  const shape = structuredClone(WRAP), at: Closing = { joints, near, world };
  for (const digit of DIGITS) {
    const finger = shape[digit];
    const curl = (value: number) => (finger.curl = value), hook = (value: number) => (finger.hook = value);
    if (!opening(at, digit, shape, curl, 1)) closing(at, digit, shape, curl, 1);
    if (!opening(at, digit, shape, hook, 1 - finger.curl)) closing(at, digit, shape, hook, 1 - finger.curl);
  }
  shape.thumb = opposite(at, shape, line);
  return shape;
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
 * The thumb opposing the fingers across `line` (its middle and way through the thing, the world's), `near`, as `shape` closed the fingers
 * on it: toward an end of the narrowest chord square to the line, level along it with the thumb's pad as `WRAP` has it (it reaches across
 * beside the index, not the palm's middle) — a magazine's thickness, a receiver's width, a pistol grip's from side to side; of chords as
 * narrow as each other (`EVEN`, a round rung's), the one nearest the way the palm faces — the end away from the palm where it faces along
 * the chord (`TIE`), else away from the fingers' pads. Of the thumb's shapes over its range, those whose flesh stays out of the thing, the
 * one whose pad lies nearest on that face, pressing most squarely in (`reached`); no chord (nothing about the line within `GIRTH`), the
 * one nearest `WRAP`'s; none clear of the thing, as `WRAP` has it.
 */
function opposite(hand: Closing, shape: Shape, line: Line): Shape['thumb'] {
  const { joints, near, world } = hand;
  const palm = joints.point('palm', shape);
  const at = palm.at.applyMatrix4(world), faces = palm.facing.transformDirection(world), axis = line.axis;
  const thumb = joints.pad('thumb', shape, new Vector3(), _facing, FLAT).applyMatrix4(world);
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
  // (through the middle of its cross-section, the midpoints of the chords through the line averaged: through a line off to its side, as
  // a receiver's is, the chord across its corner was the narrowest, and the thumb went for the corner)
  const level = line.at.clone().addScaledVector(axis, thumb.clone().sub(line.at).dot(axis)), first = chords(level);
  const middle = first.reduce((sum, c) => sum.add(level.clone().addScaledVector(c.way, (c.ahead - c.behind) / 2)), new Vector3()).divideScalar(Math.max(1, first.length));
  const best = first.length ? chords(middle).reduce<ReturnType<typeof chords>[number] | null>((was, c) => !was || c.score < was.score ? c : was, null) : null;
  if (!best) return reached(hand, shape, null);
  // (along the chord, from its middle: the palm, and the fingers' pads)
  const width = best.ahead + best.behind, centre = middle.clone().addScaledVector(best.way, (best.ahead - best.behind) / 2);
  const along = (point: Vector3) => point.clone().sub(centre).dot(best.way) / (width / 2), pads = padsOn(hand, shape);
  const side = -Math.sign(along(Math.abs(faces.dot(best.way)) > TIE ? at : pads));
  const end = middle.clone().addScaledVector(best.way, side >= 0 ? best.ahead : -best.behind), way = end.clone().sub(middle).normalize();
  return reached(hand, shape, { way, end, width });
}

/**
 * the thumb's shape, the fingers as `shape` has them: of its shapes over its range (`REACHING` steps each way), those whose flesh stays
 * out of `near`, the one whose pad lies nearest on the face `face.way` points out of (within the chord's width of its end `face.end`),
 * pressing most squarely in — a point it reaches with its skin clear of the thing, not one along a line through where it starts, which it
 * reaches, if at all, only by pressing through the face; on no such face (`face` none, or the pad on it nowhere), the one nearest
 * `WRAP`'s; none clear, as `WRAP` has it
 */
function reached(hand: Closing, shape: Shape, face: { way: Vector3; end: Vector3; width: number } | null): Shape['thumb'] {
  const { joints, near, world } = hand, tried = structuredClone(shape), into = face?.way.clone().negate();
  const steps = (least: number) => Array.from({ length: REACHING + 1 }, (_, k) => least + ((1 - least) * k) / REACHING);
  const wrap = WRAP.thumb;
  let best: { thumb: Shape['thumb']; score: number } | null = null;
  for (const oppose of steps(SPLAYED)) for (const spread of steps(SPLAYED)) for (const curl of steps(0)) {
    tried.thumb = { curl, oppose, spread };
    // (how far the pad is off the face, and how far its flat is turned off pressing square into it, as a centimetre a unit; else, a
    // metre off the face, how far off `WRAP`'s it is)
    let score = 1 + Math.hypot(curl - wrap.curl, oppose - wrap.oppose, spread - wrap.spread) / 100;
    if (face && into) {
      const pad = joints.pad('thumb', tried, new Vector3(), _facing, FLAT).applyMatrix4(world);
      const hit = near.first(_ray.set(pad.clone().addScaledVector(face.way, GIRTH), into), 2 * GIRTH);
      if (hit !== null && pad.clone().addScaledVector(face.way, GIRTH - hit).distanceTo(face.end) <= face.width) {
        score = Math.abs(hit - GIRTH) + 0.01 * _facing.transformDirection(world).distanceTo(into);
      }
    }
    if ((best && score >= best.score) || sinks(hand, tried)) continue;
    best = { thumb: { ...tried.thumb }, score };
  }
  return best?.thumb ?? { ...wrap };
}

/**
 * whether any ball of the thumb's flesh (`Joints.flesh`) as `shape` has it sinks into `near`, as its skin gives (`PAD_DEPTH`): its web —
 * the balls along its metacarpal and on to the middle of its first phalanx (`WEB`), which wrap what the grasp holds as the palm does, a
 * pistol grip's back strap — as far as keeps their bones outside by `SUNK`; the rest no further than `SUNK` (held to that, the thumb
 * could not wrap the back strap at all and lay forward along the grip's right side)
 */
function sinks(at: Closing, shape: Shape): boolean {
  const { joints, near, world } = at, scale = _scale.setFromMatrixScale(world).x;
  return joints.flesh('thumb', shape).some((ball, k) => {
    const radius = ball.radius * scale * PAD_DEPTH;
    return near.depth(ball.at.applyMatrix4(world), radius, GIRTH) > (k < WEB ? radius - SUNK : SUNK);
  });
}

/** the middle of the pads of the fingers whose last segment meets `near` as `shape` has them, else of any that meets it, else of all
 * (the world) */
function padsOn(at: Closing, shape: Shape): Vector3 {
  const { joints, world } = at;
  const met = DIGITS.filter((digit) => touches(at, digit, shape, PAD_DEPTH).length);
  const tips = met.filter((digit) => touches(at, digit, shape, PAD_DEPTH).includes(2));
  const pressing = tips.length ? tips : met.length ? met : DIGITS;
  const sum = new Vector3();
  for (const digit of pressing) sum.add(joints.pad(digit, shape, _pad, _facing, FLAT).applyMatrix4(world));
  return sum.divideScalar(pressing.length);
}


/**
 * `thing`'s triangles within `radius` of `centre`, in the frame `frame` places (the world's; `centre` in it): every mesh shown under it,
 * what hangs from it too (a magazine in a rifle's well) — a hand touches whatever is there — but the body's own skin (`skins`: an empty
 * in a scene holds every mesh under it, the body's too); skinned meshes as they stand at rest
 */
export function trianglesAbout(thing: Object3D, skins: readonly SkinnedMesh[], frame: Placement, centre: Readonly<Vector3>, radius: number): Triangles {
  const back = new Matrix4().compose(frame.position, frame.quaternion, _one).invert(), meshes: Mesh[] = [];
  thing.updateWorldMatrix(true, true);
  thing.traverseVisible((node) => { if (node instanceof Mesh && !skins.some((skin) => skin === node)) meshes.push(node); });
  return new Triangles(meshes.map((mesh) => ({ geometry: mesh.geometry, matrix: back.clone().multiply(mesh.matrixWorld) })), centre, radius);
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

const WORLD: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const _ray = new Ray(), _to = new Vector3(), _pad = new Vector3(), _facing = new Vector3(), _scale = new Vector3(), _centre = new Vector3(), _one = new Vector3(1, 1, 1);
