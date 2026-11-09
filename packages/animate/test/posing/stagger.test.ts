import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { pose, reach, wait, walkTo, type Body } from '../../src/index';
import { person, play } from '../kit/bodies';

/** how far its left foot stands ahead of its right along its facing (m) */
const stagger = (body: Body) => {
  const [left, right] = body.feet;
  return (left.position.x - right.position.x) * Math.sin(body.facing) + (left.position.z - right.position.z) * Math.cos(body.facing);
};

describe('a pose\'s stagger', () => {
  it('steps the feet apart and holds them so, a reach going on over it, then squares up as it ends', () => {
    for (const asked of [0.2, -0.2]) {
      const body = person({ dev: true, life: { seed: 3 } });
      let held = 0, late = 0, reached = false;
      play(function* () {
        yield* parallel('race', pose(body, { stagger: asked }), function* () {
          yield* wait(3);
          held = stagger(body);
          reached = yield* reach(body, { right: body.armPoint('right', new Vector3(0, 0, 1), 0.7) }, { step: false });
          yield* wait(5);
          late = stagger(body);
        });
      }, [body], 16);
      expect(Math.abs(held - asked)).toBeLessThan(0.02);
      expect(Math.abs(late - held)).toBeLessThan(1e-6);
      expect(reached).toBe(true);
      expect(Math.abs(stagger(body))).toBeLessThan(0.02);
      expect(body.settled).toBe(true);
      expect(body.log).toEqual([]);
    }
  });

  it('asks no more than the feet settle on, and waits for them under a `hold`', () => {
    const body = person({ dev: true, life: { seed: 3 } });
    play(function* () { yield* pose(body, { stagger: 2 }, { hold: 0 }); expect(body.settled).toBe(true); expect(stagger(body)).toBeGreaterThan(0.25); }, [body], 6);
    expect(body.log).toEqual([]);
  });

  it('leaves a walk its stride, and is stood in once there', () => {
    const body = person({ dev: true, life: { seed: 3 } });
    let arrived = 1;
    play(function* () {
      yield* parallel('race', pose(body, { stagger: 0.2 }), function* () {
        yield* walkTo(body, new Vector3(0, 0, 2));
        arrived = stagger(body);
        yield* wait(3);
      });
    }, [body], 12);
    expect(Math.abs(arrived)).toBeLessThan(0.02);
    expect(body.log).toEqual([]);
  });

  it('stays where its feet have brought it, however often it staggers, and does not walk back to where it last stopped', () => {
    for (const asked of [0.3, 0.1]) {
      const body = person({ dev: true, life: { seed: 3 } }), stood: number[] = [];
      play(function* () {
        for (let time = 0; time < 8; time++) {
          yield* parallel('race', pose(body, { stagger: asked }), wait(3));
          yield* wait(4);
          stood.push(body.object.position.z);
        }
      }, [body], 60);
      for (let k = 1; k < stood.length; k++) expect(stood[k]).toBeGreaterThan(stood[k - 1] - 0.02);
      // (nor creeps on: each squaring up stepped the back foot after a root settling over the feet, 3–4 cm on a cycle)
      expect(Math.abs(stood[stood.length - 1] - stood[0])).toBeLessThan(0.1);
      expect(body.log).toEqual([]);
    }
  });

  it('steps an uneven stagger with one step of each foot to where it was asked, and squares up where it began', () => {
    for (const asked of [0.25, -0.25]) for (const seed of [1, 3]) {
      const body = person({ dev: true, life: { seed } });
      let held = 0, lifts = 0, planted = [true, true];
      play(function* () {
        yield* parallel('race', pose(body, { stagger: asked }), function* () { yield* wait(3); held = stagger(body); });
        yield* wait(4);
      }, [body], 8, (time) => {
        if (time < 3) lifts += body.feet.filter((foot, i) => planted[i] && !foot.planted).length;
        planted = body.feet.map((foot) => foot.planted);
      });
      expect(lifts).toBe(2);
      expect(Math.abs(held - asked)).toBeLessThan(0.01);
      expect(Math.abs(stagger(body))).toBeLessThan(0.005);
      expect(Math.abs(body.object.position.z)).toBeLessThan(0.06);
      expect(body.log).toEqual([]);
    }
  });

  it('keeps its balance stepping a wide stagger and out of it, bowed, leaning or twisted over it', () => {
    for (const posture of [{}, { lean: 0.3 }, { twist: 0.6 }, { bow: 0.6 }]) for (const seed of [1, 3]) {
      const body = person({ dev: true, life: { seed } });
      play(function* () { yield* parallel('race', pose(body, { stagger: -0.3, ...posture }), wait(4)); yield* wait(3); }, [body], 7);
      expect(body.log).toEqual([]);
    }
  });
});
