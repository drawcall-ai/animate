import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, dog, humanoid, lookAt } from '../../src/index';
import { INDEX } from '../../src/species/humanoid/bones';
import { gazeOff, insides, person, play } from '../bodies';
import { CHEWBACCA } from '../skeletons/chewbacca';
import { DOG } from '../../skills/animate/references/dog';

const BODIES: [string, () => Body][] = [['the default person', () => person({ dev: true })], ['a 2.3 m skeleton', () => new Body(humanoid(CHEWBACCA), { dev: true })]];

/** a person looking `bearing` (rad, + to its left) aside at eye height 3 m off, held 3 s with `head`: the head's turn off the facing at the
 * end (rad), how far its eyes are off the point, and its log */
function looked(make: () => Body, bearing: number, head?: number) {
  const body = make(), h = insides(body), eyes = body.species.person?.eyeHeight ?? 0;
  const point = new Vector3(3 * Math.sin(bearing), eyes, 3 * Math.cos(bearing));
  play(function* () { yield* lookAt(body, point, { head }); }, [body], 3);
  const turn = new Euler().setFromQuaternion(new Quaternion().copy(h.pose.rotation(INDEX.head)), 'YXZ').y - body.facing;
  return { turn, off: gazeOff(h.gazer, h.pose, point), log: body.log };
}

describe('lookAt with a head share', () => {
  it.each(BODIES)('turns the head that share of a small turn aside, the eyes the rest, still on it: %s', (_name, make) => {
    const bearing = 0.35, eased = looked(make, bearing, 0.3), whole = looked(make, bearing);
    expect(eased.turn).toBeCloseTo(0.3 * bearing, 1);
    expect(whole.turn).toBeGreaterThan(0.7 * bearing);
    expect(eased.off).toBe(0);
    expect([...eased.log, ...whole.log]).toEqual([]);
  });

  it.each(BODIES)('turns the head on past it where the eyes run out of their comfortable 20°: %s', (_name, make) => {
    const bearing = 0.9, { turn, off, log } = looked(make, bearing, 0.3);
    expect(turn).toBeCloseTo(bearing - (20 * Math.PI) / 180, 1);
    expect(off).toBe(0);
    expect(log).toEqual([]);
  });

  it('throws for a share outside 0 … 1, and for a body whose posture turns its head', () => {
    expect(() => lookAt(person(), new Vector3(0, 1.6, 3), { head: 1.5 })).toThrow('head share');
    const neckless = new Body({ ...dog(DOG), gaze: { ...dog(DOG).gaze!, neck: undefined } });
    expect(() => play(function* () { yield* lookAt(neckless, new Vector3(0, 0.5, 3), { head: 0.5 }); }, [neckless], 0.1)).toThrow('needs a neck');
  });
});
