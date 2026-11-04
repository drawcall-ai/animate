import { Group, MathUtils, Vector3 } from 'three';
import { horse, type Body, type Root } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { HORSE } from '../skeletons';

/** A route a root is scripted along: its top pace (m/s), when it sets off (s), how long it takes to stop (s), its bend's radius (m). */
export interface Route {
  pace: number;
  start?: number;
  brake?: number;
  radius?: number;
}

/** how long it takes to come up to its pace (s), then how long it goes straight on at it (s), and when it starts to stop (s after setting off) */
const RAMP = 2;
const STRAIGHT = 4;
const STOP = 10;

/**
 * A root driven along `route` from where `body` stands as it is first read, facing as it faces: speeding up to its pace and slowing
 * to a stop with a minimum-jerk speed (no jolt as it sets off or stops), straight on, then round a bend to its left.
 */
export function scripted(route: Route, body: () => Body): (time: number) => Root {
  const { pace, start = 0, brake = 2, radius = 15 } = route;
  let origin: { position: Vector3; facing: number } | null = null;
  let travelled = 0, then = 0;
  return (time) => {
    origin ??= { position: body().position, facing: body().facing };
    const speed = pace * MathUtils.smootherstep(time, start, start + RAMP) * (1 - MathUtils.smootherstep(time, start + STOP, start + STOP + brake));
    travelled += speed * (time - then);
    then = time;
    const straight = Math.min(travelled, pace * STRAIGHT), bend = Math.max(0, travelled - straight) / radius;
    const position = new Vector3(radius * (1 - Math.cos(bend)), 0, straight + radius * Math.sin(bend));
    return { position: position.applyAxisAngle(UP, origin.facing).add(origin.position), yaw: origin.facing + bend };
  };
}

/** A person's legs under a scripted root: it steps along a straight and a bend and stops, its balance planning nothing. */
export function legsBiped(): Scenario {
  return {
    id: 'legs-biped',
    title: 'Legs: a person on a scripted root',
    description: "A person's legs under a scripted root: straight, round a bend, stop. Its balance plans nothing.",
    duration: 16,
    stage: (cast) => {
      const walker: Body = cast.person({ drive: scripted({ pace: 1.3, start: 1, brake: 3 }, () => walker) });
      // (stood still at the end of its route, some 13.6 m on)
      return { scene: new Group(), bodies: [walker], story: function* () {}, done: () => walker.settled && walker.position.length() > 10 };
    },
  };
}

/** Two horses' legs under scripted roots, one walking and one trotting. */
export function legsHorse(): Scenario {
  return {
    id: 'legs-horse',
    title: 'Legs: horse walk and trot on scripted roots',
    description: 'Two horses walk and trot along scripted roots, round a bend, and stop with every hoof down. No planner.',
    duration: 16,
    cameraDistance: 9,
    stage: (cast) => {
      const walking: Body = cast.body(horse(HORSE), { at: new Vector3(-2, 0, 0), drive: scripted({ pace: 1.6 }, () => walking) });
      const trotting: Body = cast.body(horse(HORSE, 'trot'), { at: new Vector3(2, 0, 0), drive: scripted({ pace: 3.7 }, () => trotting) });
      const horses = [walking, trotting];
      return { scene: new Group(), bodies: horses, story: function* () {}, done: () => horses.every((one) => one.settled && one.feet.every((hoof) => hoof.planted)) };
    },
  };
}

const UP = new Vector3(0, 1, 0);
