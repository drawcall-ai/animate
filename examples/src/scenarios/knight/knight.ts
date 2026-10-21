import { Euler, Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { arriving, carry, grab, when, release, walkTo, withGaze, type Behaviour, type Holds, type Humanoid, type Item, type Waypoint, type Live, type Placement, type Side, type Spot } from '@drawcall/animate';
import { reported, reporting, type Report } from '../../report';

// The knight and the small pieces his behaviours are made of over the package's tasks. Placements
// are in the frame of the body part they go to (left +x, up +y, ahead +z; m, default body), timed at
// a calm pace: a reach of 30–60 cm in about a second (Fitts' law at everyday precision), fine work (a
// strap through a buckle, a hand into a gauntlet) at a third of that speed. One thing flows into
// the next: the next sets off as the hands let go of the last (`flow`).

/** The knight: his body, the report his gaze and busy hands go to, and how fast he goes about it (1: as timed here). */
export interface Knight {
  h: Humanoid;
  report: Report;
  pace: number;
}

/** a while doing nothing new (s at pace 1) */
export const pause = (k: Knight, seconds: number): Behaviour =>
  function* () {
    yield* action({ until: timePassed(seconds / k.pace, 'seconds') });
  };

/** the hands busy while `task` runs (the metrics judge the arms nobody asks anything of as free) */
export const busy = (k: Knight, task: Behaviour): Behaviour => reporting(k.report, ['leftHand', 'rightHand'], task);

/** `task` with the eyes on `at` (`withGaze`: concurrent by default, or with `first: true` once they are there; bowing at least `bow`), reported as the gaze */
export const eyesOn = (k: Knight, at: Live<Vector3>, task: Behaviour, options: { first?: boolean; bow?: number } = {}): Behaviour => withGaze(k.h, reported(k.report, 'gaze', at), task, options);

/** taking hold of `holds` (`grab`), the eyes on them reported */
export function take(k: Knight, holds: Holds<Side>, options: { face?: number; spot?: Spot } = {}): Behaviour {
  return function* () {
    const grips = Object.values(holds).flatMap((hold) => hold ? [hold] : []).map(([item, grip]) => item.toWorld(item.grips[grip], { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }).position);
    const middle = grips.reduce((sum, g) => sum.add(g), new Vector3()).divideScalar(grips.length);
    yield* busy(k, grab(k.h, holds, { ...options, look: reported(k.report, 'gaze', middle), first: true }))();
  };
}

/** A beat of the knight's work: what his hands do, and the hands that let go once it is done (going off as they `release` does, or `away`). */
export type Beat = [work: Behaviour, sides: readonly Side[], away?: Partial<Record<Side, Vector3>>];

/**
 * `beats` one after another, then `then`, each flowing into the next: as a beat's hands let go of
 * what they did (`release`), the next sets off — its eyes and its feet on their way
 * while the hands come off
 */
export function flow(k: Knight, beats: readonly Beat[], then: Behaviour): Behaviour {
  return beats.reduceRight<Behaviour>((next, [work, sides, away]) => {
    let done = false;
    const beat = function* () {
      done = false;
      yield* work();
      done = true;
      yield* busy(k, release(k.h, sides, { away }))();
    };
    return function* () {
      yield* parallel('all', beat, function* () {
        yield* when(() => done);
        yield* next();
      });
    };
  }, then);
}

/** A held item carried along its course at the knight’s pace. */
export const along = (k: Knight, item: Item, waypoints: readonly Waypoint[], options: { frame: Live<Placement> }): Behaviour => carry(k.h, item, waypoints, { ...options, pace: k.pace });

export const at = (x: number, y: number, z: number, quaternion?: Quaternion): Placement => ({ position: new Vector3(x, y, z), quaternion });
export const turn = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));

/** how long before he comes to a stop in the yard his eyes go to the first sight (s): the head leads the body's turn (Imai et al. 2001) */
const LOOKING = 1;

/** Out to the yard: walking there, and looking round it, a while at each of `sights` — the eyes on the first LOOKING s before he stops. */
export function walkOut(k: Knight, yard: Vector3, face: number, sights: readonly Vector3[]): Behaviour {
  return function* () {
    const look = function* () {
      for (const sight of sights) yield* eyesOn(k, sight, pause(k, 1.4), { first: true })();
    };
    yield* parallel('all', walkTo(k.h, { to: yard, face }), function* () {
      yield* when(arriving(k.h, LOOKING));
      yield* look();
    });
  };
}
