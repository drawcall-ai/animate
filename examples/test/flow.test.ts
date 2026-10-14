// The flow metrics read off short runs made for them. Run: pnpm metrics flow
import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { createWorld, handTo, idle, type Behaviour, type Frame, type Humanoid, type World } from '@drawcall/animate';
import { expect, it } from 'vitest';
import { Report } from '../src/report';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { BELL } from './flow';
import { measure } from './judge';
import { steps } from './run';

/** the flow of `tasks` run over `idle` for `duration` s, the body at the origin facing +Z */
function flowOf(duration: number, tasks: (h: Humanoid<World>) => Behaviour<World>) {
  const sc: Scenario = {
    id: 'flow',
    title: 'flow',
    duration,
    actors: [{}],
    stage: () => ({
      world: createWorld(),
      report: new Report(),
      done: () => true,
      props: () => [],
      script: (h) =>
        function* () {
          yield* parallel<Frame<World>>('all', idle(h), tasks(h));
        },
    }),
  };
  return measure(sc.id, steps(new Simulation(sc))).flow.report(0, duration);
}

const reach = (h: Humanoid<World>, side: 'left' | 'right', x: number, after = 0) => handTo(h, side, { position: new Vector3(x, 1.25, 0.45) }, { seconds: 1, after, until: 'reached' });
const wait = (seconds: number): Behaviour<World> =>
  function* () {
    yield* action({ until: timePassed(seconds, 'seconds') });
  };

it('reads a minimum-jerk reach as a bell, standing still after it as dead time', () => {
  const f = flowOf(3.5, (h) =>
    function* () {
      yield* wait(0.5)();
      yield* reach(h, 'right', -0.2)();
      yield* wait(1.5)();
    },
  );
  const [r] = f.reaches.filter((m) => m.side === 'right');
  expect(r.ratio).toBeGreaterThan(BELL.low);
  expect(r.ratio).toBeLessThan(BELL.high);
  expect(f.dead.some((d) => d.to - d.from > 0.8)).toBe(true);
});

it('reads two hands setting off alike as mirrored, one leading the other as not', () => {
  const both = (lag: number) =>
    flowOf(2.5, (h) =>
      function* () {
        yield* wait(0.5)();
        yield* parallel<Frame<World>>('all', reach(h, 'left', 0.2), reach(h, 'right', -0.2, lag));
      },
    ).mirrored.length;
  expect(both(0)).toBeGreaterThan(0);
  expect(both(0.2)).toBe(0);
});
