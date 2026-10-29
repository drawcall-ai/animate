import type { Object3D } from 'three';
import type { NonReuseableTimeline } from '@pmndrs/timeline';
import type { Frame } from '../kernel/frame';
import type { Goal, Motion } from '../kernel/goal';
import type { Request } from '../kernel/requests';
import type { Thing } from '../things/thing';
import type { Until } from '../verbs/story';

/** How a hand verb (`grab`, `reach`, `carry`) goes. */
export interface HandOptions {
  /**
   * how fast (m/s): `grab` and `reach`, the hands' top speed (default the time a calm reach that far takes, Fitts'); `carry`, the thing's
   * mean speed along its way (default a calm 0.5; a transfer walked somewhere goes at the walk's pace). Faster than calm (a person's hand
   * 1.5, a carry 0.5, a creature's 1), the movement is the calm one sped up, its acceleration growing with the speed squared; slower, it
   * sets off and stops as briskly as a calm one. `grab` alone takes `Infinity`: the hands there at once, for a person that starts a story
   * already holding the thing — only as it starts, the grips within its arms' reach from where it stands
   */
  speed?: number;
  /** whether the body may walk up to stand in reach (default true); false keeps its feet where they stand, turning, bowing, crouching and
   * rising on its toes for the target as far as its arms and trunk allow, and ends `false` if that is not far enough */
  step?: boolean;
  /** ends on this instead of arriving (`grab`: instead of holding); a target that moves is followed until then */
  until?: Until;
}

/** A hand's pace: its top speed (m/s) and acceleration (m/s²). */
export type Pace = Required<Pick<Motion, 'speed' | 'accel'>>;

/**
 * a hand's pace at `speed` (m/s; none: `calm`): faster than calm, `calm`'s movement sped up, its acceleration growing with the speed
 * squared (a brisk hand is quick off the mark as well as fast); slower, `calm`'s acceleration kept — a careful hand is slow for its
 * precision, not sluggish: it still sets off and stops as crisply (a slow hand's speed squared would leave a short placement at 0.3 m/s
 * still speeding up a second on)
 */
export function paceAt(speed: number | undefined, calm: Pace): Pace {
  if (speed === undefined) return { speed: calm.speed, accel: calm.accel };
  return { speed, accel: calm.accel * Math.max(1, speed / calm.speed) ** 2 };
}

/** A staging a hand works through for a request: it says when it has met its goal (`request.met`) or never can (`request.fail`). */
type Handwork = NonReuseableTimeline<Frame>;

/** Species-specific hand staging for the shared verbs. */
export interface Handling {
  /** each named hand takes hold of `thing` by its grip, the body walking up for them if it must and may; a loose thing with a mass is lifted clear */
  take(request: Request, thing: Thing, grips: readonly { hand: string; grip: string }[], options: HandOptions): Handwork;
  /** the hands holding `thing` bring it through `points` (each a sub-step at a time; the last sets its turn), in to `end` (an empty) by its approach, and keep it there */
  bring(request: Request, thing: Thing, points: readonly ((f: Frame) => Goal)[], end: Object3D | null, options: HandOptions): Handwork;
  /** each named hand reaches its target, taking nothing, and stays on it */
  reach(request: Request, aims: readonly { hand: string; target: (f: Frame) => Goal }[], options: HandOptions): Handwork;
  /** `hands`, having let go, back out of what they held: a request of the body's own */
  backOut(hands: readonly string[]): void;
}
