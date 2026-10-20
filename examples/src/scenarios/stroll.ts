import { MathUtils, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { idle, walkTo, type Frame, type Humanoid } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { Report, reported } from '../report';

const { smoothstep } = MathUtils;

/** the point's pace (m/s), and the body's top speed */
const PACE = 1.3;
/** the path's straight before its arc, and how far along the arc the point begins to slow to a stop (m) */
const STRAIGHT = 12;
const ARC = 6.6;

/** a point on the path `s` m along it: straight along +z for `straight` m, then a left-hand arc of `radius` */
function path(s: number, straight: number, radius: number, out: Vector3): Vector3 {
  if (s < straight || radius === Infinity) return out.set(0, 0, s);
  const a = (s - straight) / radius;
  return out.set(radius - radius * Math.cos(a), 0, straight + radius * Math.sin(a));
}

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
    actors: [{ yaw }],
    stage: () => {
      const report = new Report();
      const point = new Vector3();
      let walker: Humanoid | null = null;
      return {
        report,
        props: () => [],
        // (come to rest at the point where it stopped)
        done: () => !!walker && walker.locomotion.settled && walker.pose.com(new Vector3()).setY(0).distanceTo(point) < 0.15,
        script: (h) =>
          function* () {
            walker = h;
            let s = 0;
            // (it slows once as far along the arc at any pace: as many strides on it, slower or faster)
            const slow = 1.65 + (STRAIGHT + ARC) / (PACE * speed);
            const tasks = parallel<Frame>(
              'all',
              // the point glides along the path, speeding up into a stroll and slowing to a stop
              action<Frame>({
                update: ({ time: t, dt }) => {
                  s += PACE * speed * smoothstep(t, 0.8, 2.5) * (halt ? (t < slow ? 1 : 0) : 1 - smoothstep(t, slow, slow + 2)) * dt;
                  path(s, STRAIGHT, radius, point);
                },
              }),
              // (after it, until it has long stopped)
              walkTo(h, { to: reported(report, 'go', point), speed: PACE * speed, until: timePassed(22, 'seconds') }),
            );
            yield* parallel<Frame>('all', idle(h), tasks);
          },
      };
    },
  };
}

/**
 * A walk to a point on the floor (and a facing there), or `within` reach of it facing it, from
 * standing at the origin facing +Z: judged as a stroll, done once the walk has ended there.
 */
export function walkThere(to: Vector3, face?: number, within = 0): Scenario {
  return {
    id: 'stroll',
    title: 'Walk there',
    description: 'From standing, the body walks to a point (behind it, beside it, or where it stands, turning round; or within reach of it) and comes to rest there.',
    duration: 8,
    actors: [{}],
    stage: () => {
      let walker: Humanoid | null = null;
      let ended = false;
      return {
        report: new Report(),
        props: () => [],
        done: () => {
          if (!ended || !walker?.locomotion.settled) return false;
          const com = walker.pose.com(new Vector3()).setY(0);
          const toward = within > 0 ? Math.atan2(to.x - com.x, to.z - com.z) : face;
          const turned = toward === undefined || Math.abs(Math.atan2(Math.sin(walker.locomotion.facing - toward), Math.cos(walker.locomotion.facing - toward))) < 0.15;
          return turned && Math.abs(com.distanceTo(to) - within) < 0.15;
        },
        script: (h) =>
          function* () {
            walker = h;
            yield* parallel<Frame>(
              'all',
              idle(h),
              function* () {
                yield* walkTo(h, { to, face, within })();
                ended = true;
              },
            );
          },
      };
    },
  };
}
