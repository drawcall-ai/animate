import { Vector3, type Object3D } from 'three';
import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { Body, selfOf } from '../body/body';
import type { Self } from '../body/runtime';
import type { Frame } from '../kernel/frame';
import { aiming, looking } from '../look/gaze';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a look goes: how much of it the head and the trunk take. To tilt or nod the head as it looks, `pose` its `head` beside it. */
export interface LookOptions {
  /**
   * how much of a turn aside the head takes (0 … 1; default all but a few degrees): the eyes take the rest, as far as they turn
   * comfortably (a person's 20° each way), and past that the head turns on for them — so 0.3 is a glance with the eyes, the head
   * following slightly: a soldier at attention watching someone pass. Up and down the head turns all the way.
   */
  head?: number;
  /**
   * how much of its bearing the trunk turns toward it too (0 … 1, at most 45°; default 0, the trunk left alone): a person's shoulders
   * come round so, the trunk bowing toward a low point or arching back for a high one by two fifths of that share of its pitch, following
   * it as it moves — 0.65 aims a rifle, 0.5 half turns to someone without a walk
   */
  trunk?: number;
  /** ends on this; without it, it keeps looking until its story moves on */
  until?: Until;
}

/** What a body looks at: a target, or another body (its eyes) — or a function of the body's time giving either. */
type Seen = Target | Body | ((time: number) => Vector3 | Object3D | Body);

/**
 * Looks at `target` — a point, an object, or another body: its eyes, followed as they move; a function may give any of them, a
 * changing focus — the eyes on it, the head turning most of the way (a person's neck within its range, the body bowing to see low
 * down; a creature's posture turning its head), eased in and back out, a new focus taken as a gaze shift. An aimer, it keeps on until
 * `until`. It asks for the eyes (and the trunk's posture, given a `trunk` share). A body to look at needs eyes (a gaze), and is not the
 * body looking.
 */
export function lookAt(body: Body, target: Seen, options: LookOptions = {}): Verb {
  const { head, trunk = 0 } = options;
  for (const [name, share] of [['head', head], ['trunk', trunk]] as const) {
    if (share !== undefined && !(share >= 0 && share <= 1)) throw new Error(`lookAt: a ${name} share of ${share}: give 0 … 1`);
  }
  const self = selfOf(body), point = located(self, target);
  return verb(body, 'lookAt', (request) => function* () {
    yield* parallel('all', during(request, 'look', 'asked', looking(self, point, { recentring: true, head })),
      trunk > 0 && during(request, 'trunk', 'asked', aiming(self, point, trunk)));
  }, options.until, true);
}

/** where what `self` looks at is, each sub-step */
function located(self: Self, target: Seen): (f: Frame) => Vector3 {
  if (target instanceof Body) return eyesOf(self, target);
  if (typeof target !== 'function') {
    const find = finder(self, target);
    return (f) => find(f).position;
  }
  // (a point or an object the function gives is found as such a target is; a body, by its eyes)
  let seen: Vector3 | Object3D = new Vector3();
  const find = finder(self, () => seen), eyes = new Map<Body, (f: Frame) => Vector3>();
  return (f) => {
    const at = target(f.time);
    if (!(at instanceof Body)) {
      seen = at;
      return find(f).position;
    }
    let of = eyes.get(at);
    if (!of) eyes.set(at, of = eyesOf(self, at));
    return of(f);
  };
}

/** where `seen`'s eyes are each sub-step, as `self` reads its pose: the midpoint between them, as its gaze has them */
function eyesOf(self: Self, seen: Body): (f: Frame) => Vector3 {
  const other = selfOf(seen), gazer = other.gazer, eyes = new Vector3();
  if (other === self) throw new Error('lookAt: a body cannot look at its own eyes');
  if (!gazer) throw new Error(`lookAt: a ${seen.species.name ?? 'custom species'} has no eyes to look at (no gaze): look at one of its bones`);
  return () => gazer.eyes(other.poseFor(self), eyes);
}
