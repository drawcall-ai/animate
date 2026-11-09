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
    const body = person({ dev: true, life: { seed: 3 } }), stood: number[] = [];
    play(function* () {
      for (let time = 0; time < 8; time++) {
        yield* parallel('race', pose(body, { stagger: 0.3 }), wait(3));
        yield* wait(4);
        stood.push(body.object.position.z);
      }
    }, [body], 60);
    for (let k = 1; k < stood.length; k++) expect(stood[k]).toBeGreaterThan(stood[k - 1] - 0.02);
    expect(body.log).toEqual([]);
  });
});
