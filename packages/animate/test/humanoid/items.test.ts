import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { carry, closeHand, hold, idle, INDEX, Item, reachFor, release, takeOff, wear, when, type Behaviour, type Frame } from '../../src';
import { Humanoid } from '../../src/humanoid/humanoid';
import { createSkeletonModel } from '../../src/humanoid/model';

/** a humanoid stepping `behaviour` (over its base) for `seconds` */
function run(behaviour: (h: Humanoid) => Behaviour, seconds: number): Humanoid {
  // (from the first sub-step on: a timeline starts running as its body is made, before the body is there to read)
  const h = new Humanoid(createSkeletonModel(), (h) =>
    function* () {
      yield* when(() => true);
      yield* parallel<Frame>('all', idle(h), behaviour(h));
    },
  );
  for (let t = 0; t < seconds; t += 1 / 60) h.update(1 / 60);
  return h;
}

/** the world as a course's frame */
const WORLD = { position: new Vector3(), quaternion: new Quaternion() };
const box = (at: Vector3, mass = 0) => new Item(at, new Quaternion(), { left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) } }, { mass });

describe('items on the body', () => {
  /** a body wearing 10 kg 30 cm out to its left at the chest, stood a while; its centre of mass, and where its feet's middle is */
  const loaded = () => {
    const load = box(new Vector3(0.3, 1.2, 0.2), 10);
    const h = run((h) => wear(h, load, INDEX.chest), 3);
    const feet = h.feet[0].position.clone().add(h.feet[1].position).multiplyScalar(0.5);
    return { h, load, com: h.pose.com(new Vector3()), feet };
  };

  it('counts what it wears in its centre of mass, where it is worn', () => {
    const { h, load, com } = loaded();
    // (the segments' mass and the load's, the load where the chest carries it)
    const pose = h.pose;
    const segments = pose.skeleton.bones.reduce((sum, b, i) => sum.addScaledVector(pose.point(i, b.com, new Vector3()), b.mass), new Vector3());
    const body = pose.skeleton.bones.reduce((sum, b) => sum + b.mass, 0);
    expect(com.distanceTo(segments.addScaledVector(load.current.position, 10).divideScalar(body + 10))).toBeLessThan(1e-6);
  });

  it('stands the loaded centre of mass over its feet', () => {
    const { com, feet } = loaded();
    expect(Math.abs(com.x - feet.x)).toBeLessThan(0.02);
  });

  it('carries a worn item with its bone, settles it where it goes, and nests: a sword in a scabbard on the hips', () => {
    const scabbard = box(new Vector3(0.2, 1, 0.1));
    const sword = box(new Vector3(0.2, 1.1, 0.1));
    const to = { position: new Vector3(0.2, 0.05, 0.1), quaternion: new Quaternion() };
    const h = run(
      (h) =>
        function* () {
          yield* wear(h, sword, scabbard)();
          yield* wear(h, scabbard, INDEX.hips, { to })();
        },
      2,
    );
    const hips = h.pose.position(INDEX.hips);
    const at = to.position.clone().multiplyScalar(h.proportions.scale).applyQuaternion(h.pose.rotation(INDEX.hips)).add(hips);
    expect(scabbard.current.position.distanceTo(at)).toBeLessThan(1e-3);
    expect(sword.current.position.distanceTo(scabbard.current.position)).toBeCloseTo(0.1, 3);
    expect([...h.worn.keys()]).toEqual([sword, scabbard]);
  });

  it('bears what it carries off its support, none of it once put down again', () => {
    const load = box(new Vector3(0, 1.0, 0.4), 4);
    const kg = { carried: -1, down: -1 };
    const h = run(
      (h) =>
        function* () {
          yield* reachFor(h, { left: [load, 'left'], right: [load, 'right'] })();
          yield* carry(h, WORLD, [[load, { left: 'left', right: 'right' }, [[1, { position: new Vector3(0, 1.05, 0.35) }]]]])();
          yield* parallel<Frame>('race', hold(h, load, { left: 'left', right: 'right' }), function* () {
            yield* when(timePassed(1, 'seconds'));
          });
          kg.carried = h.borne.get(load)?.kg ?? 0;
          yield* release(h, ['left', 'right'])();
          yield* when(timePassed(1, 'seconds'));
          kg.down = h.borne.get(load)?.kg ?? 0;
        },
      8,
    );
    expect(load.supported).toBe(true);
    expect(kg.carried).toBeCloseTo(4, 3);
    expect(kg.down).toBe(0);
    expect(h.borne.has(load)).toBe(false);
  });

  it('throws on a second mover, on items worn on each other, and taking off what is not worn', () => {
    const a = box(new Vector3(0, 1, 0.3));
    const b = box(new Vector3(0, 1, 0.4));
    expect(() =>
      run(
        (h) =>
          function* () {
            yield* wear(h, a, INDEX.chest)();
            yield* action<Frame>({ update: (f) => a.move(f.time, new Vector3()) });
          },
        0.1,
      ),
    ).toThrow(/twice/);
    expect(() =>
      run(
        (h) =>
          function* () {
            yield* wear(h, a, b)();
            yield* wear(h, b, a)();
          },
        0.1,
      ),
    ).toThrow(/loop/);
    expect(() => run((h) => takeOff(h, a), 0.1)).toThrow(/not worn/);
  });
});

describe('hands that cannot get there', () => {
  it('fail visibly: a reach and a carry out of the arms throw, a release off a folded arm does not hang', () => {
    const far = box(new Vector3(0, 1, 3));
    expect(() => run((h) => reachFor(h, { left: [far, 'left'], right: [far, 'right'] }), 6)).toThrow(/did not get to their grips/);
    const held = box(new Vector3(0, 1.1, 0.35));
    const goal = { position: new Vector3(0, 1.1, 3) };
    expect(() =>
      run(
        (h) =>
          function* () {
            yield* reachFor(h, { left: [held, 'left'], right: [held, 'right'] })();
            yield* carry(h, WORLD, [[held, { left: 'left', right: 'right' }, [[1, goal]]]])();
          },
        12,
      ),
    ).toThrow(/did not come to rest/);
    // (the hand at the shoulder: back and down from there is behind it)
    let done = false;
    run(
      (h) =>
        function* () {
          const at = box(h.pose.position(INDEX.leftUpperArm).clone().add(new Vector3(0, 0.05, 0.12)));
          yield* closeHand(h, 'left', at, 'left')();
          yield* release(h, ['left'], { away: { left: new Vector3(0, -0.1, -0.3) } })();
          done = true;
        },
      4,
    );
    expect(done).toBe(true);
  });
});
