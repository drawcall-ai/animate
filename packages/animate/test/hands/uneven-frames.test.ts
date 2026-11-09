import { BoxGeometry, Mesh, Object3D, Vector3 } from 'three';
import { runTimeline } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { Body, carry, grab, humanoid, Missed, release, wait } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';

const random = (run: number) => {
  let s = (run * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
};

const empty = (parent: Object3D, name: string, position: Vector3, userData = {}) => {
  const node = new Object3D();
  node.name = name;
  node.position.copy(position);
  Object.assign(node.userData, userData);
  parent.add(node);
  return node;
};

/** a body, a thing to take by `grips` in `hands`, and an empty for it; `steps` the story and the body once per frame of an uneven 16 … 72 ms */
function scene(run: number, mass: number, at: Vector3, to: Vector3, grips: (thing: Object3D) => void) {
  const body = new Body(humanoid(PERSON as never), { dev: true, life: { seed: run } }), room = new Object3D();
  const thing = new Mesh(new BoxGeometry(0.1, 0.1, 0.1));
  thing.name = 'thing';
  thing.userData.mass = mass;
  thing.position.copy(at);
  grips(thing);
  const spot = empty(room, 'spot', to);
  room.add(body.object, thing);
  room.updateMatrixWorld(true);
  const next = random(run);
  return { body, room, thing, spot, next, steps: (story: ReturnType<typeof runTimeline>, done: () => boolean) => {
    for (let f = 0; f < 1500 && !done(); f++) {
      const dt = 0.016 + next() * 0.056;
      story(undefined, dt);
      body.update(dt);
    }
    expect(done()).toBe(true);
  } };
}

const off = (a: Object3D, b: Object3D) => a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3()));

describe('what a carry brings to an empty, however uneven the frames', () => {
  it.each([
    ['in one hand', { left: 'top' }, new Vector3(0.2, 0.86, 0.42), new Vector3(0.05, 0.84, 0.6), (thing: Object3D): void => void empty(thing, 'top', new Vector3(0, 0.05, 0)), 0.3],
    ['in both hands', { left: 'left', right: 'right' }, new Vector3(0, 0.95, 0.42), new Vector3(0.05, 1, 0.5), (thing: Object3D): void => {
      empty(thing, 'left', new Vector3(0.05, 0, 0));
      empty(thing, 'right', new Vector3(-0.05, 0, 0));
    }, 2],
    ['by a fingertip', { right: 'pad' }, new Vector3(-0.2, 1, 0.42), new Vector3(-0.15, 1.05, 0.5), (thing: Object3D): void => void empty(thing, 'pad', new Vector3(0, 0, -0.051), { point: 'index', facing: [0, 0, 1] }), 0.1],
  ] as const)('is on it %s as the carry returns, and a release there sets it without a word', (_, hands, at, to, grips, mass) => {
    let worst = 0;
    for (let run = 1; run <= 40; run++) {
      const { body, room, thing, spot, next, steps } = scene(run, mass, at, to, grips);
      let done = false;
      steps(runTimeline(function* () {
        yield* wait(0.5 + next());
        expect(yield* grab(body, thing, hands, { step: false })).toBe(true);
        thing.getWorldQuaternion(spot.quaternion);
        room.updateMatrixWorld(true);
        expect(yield* carry(body, thing, spot, { step: false, speed: 0.3 })).toBe(true);
        room.updateMatrixWorld(true);
        worst = Math.max(worst, off(thing, spot));
        release(body, thing, spot);
        done = true;
      }), () => done);
      expect(thing.parent).toBe(spot);
    }
    expect(worst).toBeLessThan(0.0005);
  });

  it('says how far off it a thing let go of on its way was, as the viewer sees it', () => {
    let moved = 0;
    for (let run = 1; run <= 20; run++) {
      const { body, room, thing, spot, next, steps } = scene(run, 0.3, new Vector3(-0.2, 0.9, 0.42), new Vector3(-0.2, 1.3, 0.5), (it) => void empty(it, 'top', new Vector3(0, 0.05, 0)));
      let done = false;
      steps(runTimeline(function* () {
        yield* wait(0.5);
        yield* grab(body, thing, { right: 'top' }, { step: false });
        yield* carry(body, thing, spot, { step: false, until: 0.2 + next() * 0.2 });
        room.updateMatrixWorld(true);
        const shown = off(thing, spot), was = thing.getWorldPosition(new Vector3());
        moved = Math.max(moved, shown);
        let said = NaN;
        try {
          release(body, thing, spot);
        } catch (miss) {
          if (!(miss instanceof Missed)) throw miss;
          said = miss.off;
        }
        expect(Math.abs(said - shown)).toBeLessThan(1e-5);
        room.updateMatrixWorld(true);
        expect(thing.getWorldPosition(new Vector3()).distanceTo(was)).toBeLessThan(1e-5);
        done = true;
      }), () => done);
    }
    expect(moved).toBeGreaterThan(0.02);
  });
});
