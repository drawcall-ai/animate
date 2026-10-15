import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { carried, carry, createWorld, grab, handTo, hold, idle, Item, walkTo, withGaze, type Frame, type World } from '@drawcall/animate';
import { forwardOf } from '../math';
import type { Scenario } from '../scenario';
import { Report, reported, reporting } from '../report';

export const idleLife: Scenario = {
  id: 'idle-life',
  title: 'Quiet standing',
  description: 'Breathing, quiet sway and an occasional shift of weight, without a task.',
  duration: 25,
  actors: [{}],
  stage: () => ({ world: createWorld(), report: new Report(), props: () => [], done: () => true, script: (h) => idle(h) }),
};

export const reachAround: Scenario = {
  id: 'reach-around',
  title: 'The trunk joins the reach',
  duration: 12,
  actors: [{}],
  stage: () => {
    const points = [new Vector3(-0.15, 1.15, 0.5), new Vector3(0.4, 1.15, 0.3), new Vector3(-0.45, 1.15, -0.15)];
    let done = false;
    const report = new Report();
    return {
      world: createWorld(), report,
      props: () => points.map((position) => ({ kind: 'ball', position, radius: 0.025 })),
      done: () => done,
      script: (h) => function* () {
        yield* parallel<Frame<World>>('all', idle(h), function* () {
          for (const position of points) {
            yield* reporting(report, ['rightHand'], withGaze(h, position, () => parallel<Frame<World>>('all',
              walkTo(h, { to: position, within: 0.4 }),
              handTo(h, 'right', reported(report, 'rightWrist', { position }), { seconds: 1, until: 'reached' }),
            ), { first: false }))();
          }
          done = true;
        });
      },
    };
  },
};

export const liftHeavy: Scenario = {
  id: 'lift-heavy',
  title: 'Lift and carry five kilograms',
  duration: 20,
  actors: [{}],
  stage: () => {
    const size = new Vector3(0.34, 0.26, 0.26);
    const box = new Item(new Vector3(0, size.y / 2, 0.5), new Quaternion(), {
      left: { position: new Vector3(0.18, 0, 0) }, right: { position: new Vector3(-0.18, 0, 0) },
    }, { name: 'box', mass: 5 });
    let done = false;
    const report = new Report();
    return {
      world: createWorld(), report,
      props: () => [{ kind: 'box', position: box.current.position.clone(), quaternion: box.current.quaternion.clone(), size }],
      done: () => done,
      script: (h) => function* () {
        yield* parallel<Frame<World>>('all', idle(h), function* () {
          yield* reporting(report, ['leftHand', 'rightHand'], grab(h, { left: [box, 'left'], right: [box, 'right'] }))();
          yield* carry(h, box, [[1.5, carried(h)()]])();
          const there = h.pose.com(new Vector3()).setY(0).addScaledVector(forwardOf(h.gait.facing), 3);
          yield* parallel<Frame<World>>('race', hold(h, box, { to: carried(h) }), walkTo(h, { to: there }));
          done = true;
          yield* hold(h, box, { to: carried(h) })();
        });
      },
    };
  },
};
