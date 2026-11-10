import { Matrix4, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { Triangles } from '../kernel/triangles';
import { bisect } from '../kernel/math';
import type { Placement } from '../kernel/goal';
import { inFrame, placedOf, worldOf, type Placed } from '../kernel/scene';
import { PAD_DEPTH, trianglesAbout } from './closing';
import type { Joints } from './joints';
import { blendShape, DIGITS, easeShape, SHAPING, withValues, type Digit, type Shape } from './shape';

/** how near the last thing a hand held its digits are kept out of it, and how near it its shape is held as it was (m); how far a hand
 * moves before the triangles about it are gathered afresh (m); how deep a digit may sink into what it is kept out of (m: its skin's give
 * is in its balls' size already); and how many times a digit's ease is halved down to where it is kept out */
const GUARD = { within: 0.04, leaving: 0.01, regather: 0.03, sunk: 0.001, halvings: 5 } as const;
/** how much further than the hand reaches the triangles about it are gathered (m): as far as it moves before they are gathered afresh */
const REACH = 0.05;

/**
 * What one hand's eased shape is kept out of: the thing it comes to, else the last it held or came to, until it is clear of it — no
 * digit further into it than it was, and opened as far as takes it out where the thing came into it — easing out as a shape eases, so a
 * loose finger the hand runs into an edge gives over a few sub-steps rather than flicking open in one; while it is still within
 * `GUARD.leaving` of what it let go, its shape is held as it was, so a hand letting go opens only as its fingers must to clear the bar.
 * What it holds keeps its digits out itself (closed round it, its contacts met clear of it).
 */
export class Guard {
  private kept: { thing: Object3D; left: boolean; near: Triangles; at: Vector3 } | null = null;

  constructor(private readonly joints: Joints, private readonly skins: readonly SkinnedMesh[]) {}

  /** the hand holds `thing`: the last it held, once it lets go */
  holding(thing: Object3D): void {
    if (this.kept?.thing === thing && this.kept.left) return;
    this.kept = { thing, left: true, near: new Triangles([], new Vector3(), 0), at: new Vector3(Infinity, Infinity, Infinity) };
  }

  /** `shape` eased `seconds` on toward `goal` in place, the digits `at` put there at once, every other digit kept out of what it comes
   * to (`on`), or of what it last held; `false`: it holds something now */
  ease(shape: Shape, goal: Shape, seconds: number, on: Object3D | null | false, at: readonly Digit[]): void {
    const kept = on === false ? null : this.about(on), was = structuredClone(shape);
    const place = kept && inFrame(placedOf(this.joints.hand), worldOf(kept.thing));
    const leaving = kept && place && kept.left ? this.clear(kept.near, place, shape) : Infinity;
    if (kept?.left && leaving > GUARD.within) this.kept = null;
    easeShape(shape, leaving < GUARD.leaving ? was : goal, seconds);
    for (const digit of at) {
      if (digit === 'thumb') shape.thumb = { ...goal.thumb };
      else shape[digit] = { ...goal[digit] };
    }
    if (kept && place && this.kept) {
      for (const digit of ['thumb', ...DIGITS] as const) {
        if (!at.includes(digit) && keptOut(this.joints, kept.near, place, shape, was, digit)) withValues(shape, digit, blendShape(was, shape, 1 - Math.exp(-seconds / SHAPING))[digit]);
      }
    }
    // (as fast as its joints turn, however it is put: a digit put on its contact or opened out of a thing at once would swing there in
    // one step)
    this.joints.braked(shape, was, seconds);
  }

  /** what the hand is kept out of as it is `on` that: its triangles about the hand, gathered afresh once it has moved `GUARD.regather` */
  private about(on: Object3D | null): Guard['kept'] {
    const thing = on ?? (this.kept?.left || this.kept?.thing !== on ? this.kept?.thing : null) ?? null;
    if (!thing) return (this.kept = null);
    const frame = worldOf(thing), at = inFrame(placedOf(this.joints.hand), frame).position, left = on === null;
    if (this.kept?.thing === thing && this.kept.at.distanceTo(at) < GUARD.regather) return Object.assign(this.kept, { left });
    return (this.kept = { thing, left, near: nearHand(this.joints, this.skins, thing, frame), at });
  }

  /** how far the palm and digits as `shape` has them are clear of `near` (m; `place`: the hand in its frame) */
  private clear(near: Triangles, place: Placed, shape: Shape): number {
    const matrix = new Matrix4().compose(place.position, place.quaternion, new Vector3().setScalar(place.scale));
    let least = Infinity;
    for (const part of [null, 'thumb', ...DIGITS] as const) for (const ball of this.joints.flesh(part, shape)) {
      least = Math.min(least, -near.depth(ball.at.applyMatrix4(matrix), ball.radius * place.scale * PAD_DEPTH, GUARD.within));
    }
    return least;
  }
}

/**
 * `digit` of `shape` (in place, eased on from `was`) kept out of `near` (`place`: the hand in its frame): as far on from `was` as it goes
 * no deeper into it than it was, halved down to that — or, where it was in it already (the thing come into it, the hand leaving it),
 * opened toward straight as far as takes it out (`true`: it was in it)
 */
function keptOut(joints: Joints, near: Triangles, place: Placed, shape: Shape, was: Shape, digit: Digit): boolean {
  const matrix = new Matrix4().compose(place.position, place.quaternion, new Vector3().setScalar(place.scale));
  const depth = () => Math.max(0, ...joints.flesh(digit, shape).map((ball) => near.depth(ball.at.applyMatrix4(matrix), ball.radius * place.scale * PAD_DEPTH, GUARD.within)));
  const to = structuredClone(shape), from = structuredClone(was);
  const set = (a: Shape, b: Shape, t: number) => withValues(shape, digit, blendShape(a, b, t)[digit]);
  if (depth() <= GUARD.sunk) return false;
  set(from, from, 0);
  const before = depth();
  // (from where it was toward where it eased to, or, sunk already, from where it eased to toward straight)
  const straight = structuredClone(to);
  withValues(straight, digit, digit === 'thumb' ? { curl: 0, oppose: 0, spread: 0 } : { curl: 0, hook: 0, spread: 0 });
  const [a, b] = before <= GUARD.sunk ? [from, to] : [to, straight];
  if (before > GUARD.sunk) {
    set(a, b, 1);
    if (depth() > GUARD.sunk) return true;
  }
  const free = before <= GUARD.sunk ? 0 : 1;
  set(a, b, bisect((t) => (set(a, b, t), depth() <= GUARD.sunk), free, 1 - free, GUARD.halvings));
  return before > GUARD.sunk;
}

/** `thing`'s triangles about the hand `joints` move, in the thing's frame (`frame`, the world's), as far as the hand reaches from its
 * wrist at `about` (the thing's frame; default: where it is) and on as far as it moves before they are gathered afresh */
export function nearHand(joints: Joints, skins: readonly SkinnedMesh[], thing: Object3D, frame: Placement, about?: Vector3): Triangles {
  const at = inFrame(placedOf(joints.hand), frame);
  return trianglesAbout(thing, skins, frame, about ?? at.position, joints.span * at.scale + REACH);
}
