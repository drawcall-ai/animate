import { Matrix4, Mesh, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { Triangles } from '../kernel/triangles';
import { bisect } from '../kernel/math';
import type { Placement } from '../kernel/goal';
import { inFrame, placedOf, worldOf, type Placed } from '../kernel/scene';
import { PAD_DEPTH } from './closing';
import type { Joints } from './joints';
import { DIGITS, easeShape, type Digit, type Shape } from './shape';

/** how near the last thing a hand held its digits are kept out of it, and how near it its shape is held as it was (m); how far a hand
 * moves before the triangles about it are gathered afresh (m); how deep a digit may sink into what it is kept out of (m: its skin's give
 * is in its balls' size already); and how many times a digit's ease is halved down to where it is kept out */
const GUARD = { within: 0.04, leaving: 0.01, regather: 0.03, sunk: 0.001, halvings: 5 } as const;
/** how much further than the hand reaches the triangles about it are gathered (m): as far as its seat may move it */
const REACH = 0.05;

/**
 * What one hand's eased shape is kept out of: the thing it comes to, else the last it held or came to, until it is clear of it — no
 * digit further into it than it was, and opened as far as takes it out where the thing came into it; while it is still within
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
    if (!kept || !place || !this.kept) return;
    for (const digit of ['thumb', ...DIGITS] as const) if (!at.includes(digit)) keptOut(this.joints, kept.near, place, shape, was, digit);
  }

  /** what the hand is kept out of as it is `on` that: its triangles about the hand, gathered afresh once it has moved `GUARD.regather` */
  private about(on: Object3D | null): Guard['kept'] {
    const thing = on ?? (this.kept?.left || this.kept?.thing !== on ? this.kept?.thing : null) ?? null;
    if (!thing) return (this.kept = null);
    const frame = worldOf(thing), at = inFrame(placedOf(this.joints.hand), frame).position, left = on === null;
    if (this.kept?.thing === thing && this.kept.at.distanceTo(at) < GUARD.regather) return Object.assign(this.kept, { left });
    return (this.kept = { thing, left, near: trianglesAbout(this.joints, this.skins, thing, frame), at });
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
 * opened toward straight as far as takes it out
 */
function keptOut(joints: Joints, near: Triangles, place: Placed, shape: Shape, was: Shape, digit: Digit): void {
  const matrix = new Matrix4().compose(place.position, place.quaternion, new Vector3().setScalar(place.scale));
  const depth = () => Math.max(0, ...joints.flesh(digit, shape).map((ball) => near.depth(ball.at.applyMatrix4(matrix), ball.radius * place.scale * PAD_DEPTH, GUARD.within)));
  const to = { ...shape[digit] } as Record<string, number>, from = { ...was[digit] } as Record<string, number>;
  const set = (a: Record<string, number>, b: Record<string, number>, t: number) => {
    const mixed = Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + (b[key] - a[key]) * t]));
    if (digit === 'thumb') shape.thumb = mixed as Shape['thumb'];
    else shape[digit] = mixed as Shape['index'];
  };
  if (depth() <= GUARD.sunk) return;
  set(from, from, 0);
  const before = depth();
  // (from where it was toward where it eased to, or, sunk already, from where it eased to toward straight)
  const [a, b] = before <= GUARD.sunk ? [from, to] : [to, Object.fromEntries(Object.keys(to).map((key) => [key, 0]))];
  if (before > GUARD.sunk) {
    set(a, b, 1);
    if (depth() > GUARD.sunk) return;
  }
  const free = before <= GUARD.sunk ? 0 : 1;
  set(a, b, bisect((t) => (set(a, b, t), depth() <= GUARD.sunk), free, 1 - free, GUARD.halvings));
}

/** the triangles of `thing`'s meshes about the hand `joints` move, in the thing's frame (`frame`, the world's): every mesh shown under it,
 * what hangs from it too (a magazine in a rifle's well) — the body's own `skins` left out — as far as the hand reaches and a seat may move
 * it */
export function trianglesAbout(joints: Joints, skins: readonly SkinnedMesh[], thing: Object3D, frame: Placement): Triangles {
  const back = new Matrix4().compose(frame.position, frame.quaternion, new Vector3(1, 1, 1)).invert(), meshes: Mesh[] = [];
  thing.traverseVisible((node) => { if (node instanceof Mesh && !skins.some((skin) => skin === node)) meshes.push(node); });
  const at = inFrame(placedOf(joints.hand), frame);
  return new Triangles(meshes.map((mesh) => ({ geometry: mesh.geometry, matrix: back.clone().multiply(mesh.matrixWorld) })), at.position, joints.span * at.scale + REACH);
}
