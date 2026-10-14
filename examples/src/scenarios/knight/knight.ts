import { Euler, Quaternion, Vector3 } from 'three';
import { action, timePassed } from '@pmndrs/timeline';
import { carry, grab, INDEX, onBone, walkTo, withGaze, type Behaviour, type BoneName, type Grips, type Holds, type Humanoid, type Item, type Live, type Placement, type Stand, type World } from '@drawcall/animate';
import { reported, reporting, type Report } from '../../report';
import { course, type Leg } from './course';

// The knight and the small pieces his behaviours are made of over the package's tasks. Placements
// are in the frame of the body part they go to (left +x, up +y, ahead +z; m, default body), timed at
// a calm pace: a reach of 30–60 cm in about a second (Fitts' law at everyday precision), fine work (a
// strap through a buckle, a hand into a gauntlet) at a third of that speed; a pause of half a
// second between things.

/** The knight: his body, the report his gaze and busy hands go to, and how fast he goes about it (1: as timed here). */
export interface Knight {
  h: Humanoid<World>;
  report: Report;
  pace: number;
}

/** a moment's pause (s at pace 1): the arms settling from what they did, before the next thing */
export const SETTLE = 0.5;

/** a while doing nothing new (s at pace 1) */
export const pause = (k: Knight, seconds: number): Behaviour<World> =>
  function* () {
    yield* action({ until: timePassed(seconds / k.pace, 'seconds') });
  };

/** the hands busy while `task` runs (the metrics judge the arms nobody asks anything of as free) */
export const busy = (k: Knight, task: Behaviour<World>): Behaviour<World> => reporting(k.report, ['leftHand', 'rightHand'], task);

/** `task` with the eyes on `at` first (`lead` s at pace 1; `withGaze`, bowing at least `bow`), reported as the gaze */
export const eyesOn = (k: Knight, at: Live<Vector3, World>, task: Behaviour<World>, lead = 0.5, bow?: number): Behaviour<World> => withGaze(k.h, reported(k.report, 'gaze', at), task, { lead: lead / k.pace, bow });

/** after a moment's pause, taking hold of `holds` (`grab`), the eyes on them reported */
export function take(k: Knight, holds: Holds, options: { face?: number; stand?: Stand } = {}): Behaviour<World> {
  return function* () {
    yield* pause(k, SETTLE)();
    const grips = Object.values(holds).map(([item, grip]) => item.toWorld(item.grips[grip], { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }).position);
    const middle = grips.reduce((sum, g) => sum.add(g), new Vector3()).divideScalar(grips.length);
    yield* busy(k, grab(k.h, holds, { ...options, look: reported(k.report, 'gaze', middle) }))();
  };
}

/** `loads` carried along their courses' legs, through one moving frame, together (the hands on each item's grips) */
export function along(k: Knight, frame: Live<Required<Placement>, World>, loads: readonly [Item, Grips, readonly Leg[]][]): Behaviour<World> {
  return function* () {
    const courses = loads.map(([item, , legs]) => course(item, frame, legs, { scale: k.h.proportions.scale, pace: k.pace }));
    yield* carry(
      k.h,
      loads.map(([item, grips], i) => [item, grips, courses[i].to] as const),
      { until: (f) => courses.every((c) => c.over(f)) },
    )();
  };
}

/** a frame at bone `bone`'s joint, turned as the body faces */
export const facingAt = (k: Knight, bone: BoneName) => onBone(k.h, INDEX[bone], ORIGIN, { facing: true });

export const ORIGIN: Placement = { position: new Vector3() };
export const at = (x: number, y: number, z: number, quaternion?: Quaternion): Placement => ({ position: new Vector3(x, y, z), quaternion });
export const turn = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));

/** Out to the yard: walking there, then looking round it, a while at each of `sights`. */
export function walkOut(k: Knight, yard: Vector3, face: number, sights: readonly Vector3[]): Behaviour<World> {
  return function* () {
    yield* pause(k, SETTLE)();
    yield* walkTo(k.h, { to: yard, face })();
    for (const sight of sights) yield* eyesOn(k, sight, pause(k, 1.4), 0)();
  };
}
