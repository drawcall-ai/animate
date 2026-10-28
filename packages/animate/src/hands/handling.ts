import type { Object3D } from 'three';
import type { NonReuseableTimeline } from '@pmndrs/timeline';
import type { Frame } from '../kernel/frame';
import type { Goal, Motion } from '../kernel/goal';
import type { Request } from '../kernel/requests';
import type { Thing } from '../things/thing';

/** How briskly hands go: their speed (m/s) and acceleration (m/s²); none, the time a calm movement that far takes. */
export type Pace = Partial<Pick<Motion, 'speed' | 'accel'>>;

/** How hands go about a verb: as briskly as `Pace` has it, and whether the body may walk up to stand in reach (`step`, default true; false:
 * its feet stay where they stand, and what they cannot reach so is out of reach). */
export type Manner = Pace & { step?: boolean };

export function paceOf(pace: Pace, defaults: Required<Pace>): Required<Pace> {
  return { speed: pace.speed ?? defaults.speed, accel: pace.accel ?? defaults.accel };
}

/** A staging a hand works through for a request: it says when it has met its goal (`request.met`) or never can (`request.fail`). */
type Handwork = NonReuseableTimeline<Frame>;

/** Species-specific hand staging for the shared verbs. */
export interface Handling {
  /** each named hand takes hold of `thing` by its grip, the body walking up for them if it must and may; a loose thing with a mass is lifted clear */
  take(request: Request, thing: Thing, grips: readonly { hand: string; grip: string }[], manner: Manner): Handwork;
  /** the hands holding `thing` bring it through `points` (each a sub-step at a time; the last sets its turn), in to `end` (an empty) by its approach, and keep it there */
  bring(request: Request, thing: Thing, points: readonly ((f: Frame) => Goal)[], end: Object3D | null, manner: Manner): Handwork;
  /** each named hand reaches its target, taking nothing, and stays on it */
  reach(request: Request, aims: readonly { hand: string; target: (f: Frame) => Goal }[], manner: Manner): Handwork;
  /** `hands`, having let go, back out of what they held: a request of the body's own */
  backOut(hands: readonly string[]): void;
}
