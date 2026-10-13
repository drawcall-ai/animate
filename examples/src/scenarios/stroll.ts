import { MathUtils, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { createWorld, idle, walkTo, type Frame, type Humanoid, type World } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { Report, reported } from '../report';

const { smoothstep } = MathUtils;

/** the point's pace (m/s), and the body's top speed */
const PACE = 1.3;

/** a point on the path `s` m along it: straight along +z for `straight` m, then a left-hand arc of `radius` */
function path(s: number, straight: number, radius: number, out: Vector3): Vector3 {
  if (s < straight) return out.set(0, 0, s);
  const a = (s - straight) / radius;
  return out.set(radius - radius * Math.cos(a), 0, straight + radius * Math.sin(a));
}

/** a stroll's variations: its pace (× PACE), the arc's radius (m) and the body's facing at the start (rad) */
export interface Variation {
  speed?: number;
  radius?: number;
  yaw?: number;
}

/** Only a go-there point moves, along a path at a stroll; nobody scripts a step. */
export function stroll({ speed = 1, radius = 3, yaw = 0 }: Variation = {}): Scenario {
  return {
    id: 'stroll',
    title: 'Stroll (a go-there point)',
    description:
      'Only a point on the floor moves, along a path at 1.3 m/s, and the body walks after it. The legs step, the pelvis bobs and sways, the thorax counter-rotates, the arms swing in counter-phase and the head keeps its eyes on the way; it comes to rest with its feet squared.',
    duration: 14,
    actors: [{ yaw }],
    stage: () => {
      const report = new Report();
      const point = new Vector3();
      let walker: Humanoid<World> | null = null;
      return {
        world: createWorld(),
        report,
        props: () => [],
        // (come to rest at the point where it stopped)
        done: () => !!walker && walker.gait.settled && walker.pose.com(new Vector3()).setY(0).distanceTo(point) < 0.15,
        script: (h) =>
          function* () {
            walker = h;
            let s = 0;
            const tasks = parallel<Frame<World>>(
              'all',
              // the point glides along the path, speeding up into a stroll and slowing to a stop
              action<Frame<World>>({
                update: ({ time: t, dt }) => {
                  s += PACE * speed * smoothstep(t, 0.8, 2.5) * (1 - smoothstep(t, 9.5, 11.5)) * dt;
                  path(s, 6, radius, point);
                },
              }),
              // (after it, until it has long stopped)
              walkTo(h, { to: reported(report, 'go', point), speed: PACE * speed, until: timePassed(13, 'seconds') }),
            );
            yield* parallel<Frame<World>>('all', idle(h), tasks);
          },
      };
    },
  };
}
