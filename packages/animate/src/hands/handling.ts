import type { Object3D } from 'three';
import type { NonReuseableTimeline } from '@pmndrs/timeline';
import type { Frame } from '../kernel/frame';
import type { Goal } from '../kernel/goal';
import type { Request } from '../kernel/requests';
import type { Thing } from '../things/thing';

/** How briskly hands go: their speed (m/s) and acceleration (m/s²); none, the time a calm movement that far takes. */
export interface Pace {
  speed?: number;
  accel?: number;
}

/** A staging a hand works through for a request: it says when it has met its goal (`request.met`) or never can (`request.fail`). */
export type Handwork = NonReuseableTimeline<Frame>;

/**
 * What a body's hands do for the verbs, each a staging of the verb's request: take hold of a thing by its grips, bring what they hold to
 * where it goes, reach to targets taking nothing, and back out of what they let go. A person's two hands and a creature's one (a jaw)
 * each do it their way.
 */
export interface Handling {
  /** each named hand takes hold of `thing` by its grip, the body walking up for them if it must; a loose thing with a mass is lifted clear */
  take(request: Request, thing: Thing, grips: readonly { hand: string; grip: string }[], pace: Pace): Handwork;
  /**
   * the hands holding `thing` bring it through `points` (each where it is a sub-step at a time; the last also sets its turn) — in to
   * `end`, an empty, by its approach — and keep it there
   */
  bring(request: Request, thing: Thing, points: readonly ((f: Frame) => Goal)[], end: Object3D | null, pace: Pace): Handwork;
  /** each named hand reaches its target, taking nothing, and stays on it */
  reach(request: Request, aims: readonly { hand: string; target: (f: Frame) => Goal }[], pace: Pace): Handwork;
  /** `hands`, having let go, back out of what they held: a request of the body's own */
  backOut(hands: readonly string[]): void;
}
