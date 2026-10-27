import { Group, MathUtils, Vector3 } from 'three';
import { walkTo } from '@drawcall/animate';
import type { Person, Scenario } from '../scenario';

/** the point's pace (m/s), and the body's top speed */
const PACE = 1.3;
/** the path's straight before its arc, and how far along the arc the point begins to slow to a stop (m) */
const STRAIGHT = 12;
const ARC = 6.6;

/** a stroll's variations: its pace (× PACE), the arc's radius (m), the body's facing at the start (rad), and the point stopping dead rather than slowing */
export interface Variation {
  speed?: number;
  radius?: number;
  yaw?: number;
  halt?: boolean;
}

/** Only a go-there point moves, along a path at a stroll; nobody scripts a step. */
export function stroll({ speed = 1, radius = 3, yaw = 0, halt = false }: Variation = {}): Scenario {
  return {
    id: 'stroll',
    title: 'Stroll (a go-there point)',
    description:
      'Only a point on the floor moves, along a path at 1.3 m/s, and the body walks after it. The legs step, the pelvis bobs and sways, the thorax counter-rotates, the arms swing in counter-phase and the head keeps its eyes on the way; it comes to rest with its feet squared.',
    duration: 24,
    stage: (cast) => {
      const walker = cast.person({ face: yaw });
      // (it slows once as far along the arc at any pace: as many strides on it, slower or faster)
      const slowing = 1.65 + (STRAIGHT + ARC) / (PACE * speed);
      const pace = (time: number) => {
        const stopping = halt ? (time < slowing ? 0 : 1) : MathUtils.smoothstep(time, slowing, slowing + 2);
        return PACE * speed * MathUtils.smoothstep(time, 0.8, 2.5) * (1 - stopping);
      };
      // the point glides along the path, speeding up into a stroll and slowing to a stop
      const point = new Vector3();
      let travelled = 0, then = 0;
      const glide = (time: number) => {
        travelled += pace(time) * (time - then);
        then = time;
        return path(travelled, radius, point);
      };
      return {
        scene: new Group(),
        bodies: [walker],
        // (after it, until it has long stopped)
        story: () => walkTo(walker, glide, { speed: PACE * speed, until: 22 }),
        // (come to rest at the point where it stopped)
        done: () => walker.settled && standsAt(walker, point),
      };
    },
  };
}

/**
 * A walk from standing at the origin facing +Z to a point on the floor (and a facing there): judged as a stroll, done once the walk
 * has ended there.
 */
export function walkThere(to: Vector3, face?: number): Scenario {
  return {
    id: 'stroll',
    title: 'Walk there',
    description: 'From standing, the body walks to a point (behind it, beside it, or where it stands, turning round) and comes to rest there.',
    duration: 8,
    stage: (cast) => {
      const walker = cast.person();
      let arrived = false;
      return {
        scene: new Group(),
        bodies: [walker],
        story: function* () {
          arrived = yield* walkTo(walker, to, { face });
        },
        done: () => arrived && walker.settled && standsAt(walker, to) && (face === undefined || Math.abs(MathUtils.euclideanModulo(walker.facing - face + Math.PI, 2 * Math.PI) - Math.PI) < 0.15),
      };
    },
  };
}

/** a point on the path `s` m along it: straight along +z for `STRAIGHT` m, then a left-hand arc of `radius` */
function path(s: number, radius: number, out: Vector3): Vector3 {
  if (s < STRAIGHT || radius === Infinity) return out.set(0, 0, s);
  const angle = (s - STRAIGHT) / radius;
  return out.set(radius - radius * Math.cos(angle), 0, STRAIGHT + radius * Math.sin(angle));
}

/** whether `walker`'s centre of mass stands over `point` (within 15 cm) */
const standsAt = (walker: Person, point: Vector3) => walker.pose.com(new Vector3()).setY(0).distanceTo(point) < 0.15;
