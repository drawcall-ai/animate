import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, grab, humanoid, wait } from '../../src/index';
import { CHEWBACCA } from '../kit/skeletons/chewbacca';
import { person, play } from '../kit/bodies';
import { box, named, roomOf, worldOf } from '../kit/things';
import { insides, palmAt } from './insides';

const BOTH = { left: 'left', right: 'right' } as const;

describe('grab, from where it stands', () => {
  it('sets off toward the grip at once: the hand never first draws back from it', () => {
    for (const at of [new Vector3(-0.1, 1.0, 0.45), new Vector3(-0.15, 0.3, 0.5), new Vector3(-0.3, 1.4, 0.3)]) {
      const body = person(), h = insides(body), room = roomOf(body);
      const thing = box(room, at, { mass: null, solid: false });
      const grip = named(thing, 'right');
      const off: number[] = [];
      play(function* () {
        yield* wait(1);
        yield* grab(body, thing, { right: 'right' });
      }, [body], 2.5, (time) => {
        if (time > 1 + 1e-9) off.push(palmAt(h, 'right').distanceTo(worldOf(grip)));
      });
      // (the first 0.3 s: never further off than it set off from)
      expect(Math.max(...off.slice(0, 18)) - off[0]).toBeLessThan(0.001);
    }
  });

  it('takes a grip on a turned thing, the palm on it', () => {
    const body = person(), h = insides(body), room = roomOf(body);
    const thing = box(room, new Vector3(-0.15, 1.0, 0.4), { turn: 0.6 });
    let held = false;
    play(function* () {
      held = yield* grab(body, thing, { right: 'right' });
    }, [body], 3, () => held);
    expect(held).toBe(true);
    const grip = named(thing, 'right');
    expect(palmAt(h, 'right').distanceTo(worldOf(grip))).toBeLessThan(0.03);
    expect(h.holding.right?.grip).toBe('right');
  });

});

describe('grab already', () => {
  const BODIES: [string, () => Body][] = [['the default person', () => person({ dev: true })], ['a 2.3 m skeleton', () => new Body(humanoid(CHEWBACCA), { dev: true })]];
  it.each(BODIES)('starts the body holding a cushion before it in both hands, as if it always had: %s', (_name, make) => {
    const body = make(), room = roomOf(body), scale = body.species.scale;
    // (where the arms hold it out before the chest, as far as they are long: the tall skeleton's are short for its height)
    const arm = body.species.person?.armLength ?? 0, at = new Vector3(0, (body.species.person?.shoulderHeight ?? 0) - 0.6 * arm, 0.55 * arm);
    const cushion = box(room, at, { size: new Vector3(0.36, 0.06, 0.24).multiplyScalar(scale), mass: 0.5, name: 'cushion' });
    let took: boolean | null = null, first = NaN, fastest = 0, last: Vector3 | null = null;
    play(function* () {
      took = yield* grab(body, cushion, BOTH, { already: true });
      yield* wait(3);
    }, [body], 3, (time) => {
      if (Number.isNaN(first) && body.holds(cushion)) first = time;
      const hand = worldOf(body.bones.rightHand);
      if (last) fastest = Math.max(fastest, hand.distanceTo(last) * 60);
      last = hand;
    });
    expect(took).toBe(true);
    expect(first).toBeCloseTo(1 / 60, 6);
    // (the hands as still as standing holds them: no reach, no jump onto the grips)
    expect(fastest).toBeLessThan(0.05);
    expect(worldOf(cushion).distanceTo(at)).toBeLessThan(0.02 * scale);
    expect(palmAt(insides(body), 'left').distanceTo(worldOf(named(cushion, 'left')))).toBeLessThan(0.02);
    expect(body.log).toEqual([]);
  });

});

