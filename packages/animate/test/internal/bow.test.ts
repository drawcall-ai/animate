import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, humanoid, pose, poseOf } from '../../src/index';
import { clamp } from '../../src/kernel/math';
import { palmOf } from '../../src/person/anatomy/landmarks';
import { forwardOf, leftOf, yawOf } from '../kit/angles';
import { INDEX, SIDES, person, play } from '../kit/bodies';
import { SOLDIER } from '../kit/skeletons/soldier';
import { insides } from './insides';

// (where a palm is, on a hand, is not to be read off a body but through its grips: these judge it)
describe('a bow', () => {
  const BODIES: [string, () => Body][] = [['the default person', () => person({ dev: true })], ['the soldier', () => new Body(humanoid(SOLDIER), { dev: true })]];
  /** how far (m) each palm stands ahead of its thigh's axis (hip to knee) and out beside it, in the pelvis's facing */
  const palms = (body: Body) => SIDES.map((side) => {
    const p = poseOf(body), yaw = yawOf(p.local(0).clone()), sign = side === 'left' ? 1 : -1;
    const hip = p.position(INDEX[`${side}UpperLeg`]), axis = p.position(INDEX[`${side}LowerLeg`]).clone().sub(hip);
    const palm = p.point(INDEX[`${side}Hand`], palmOf(insides(body).proportions, side), new Vector3());
    const off = palm.sub(hip).addScaledVector(axis, -clamp(palm.dot(axis) / axis.lengthSq(), 0, 1));
    return { ahead: off.dot(forwardOf(yaw)), out: sign * off.dot(leftOf(yaw)) };
  });
  /** the palms after a bow of `bow` held 2.5 s, against a like body's standing beside it asked nothing, and both bodies' logs */
  const bowed = (make: () => Body, bow: number) => {
    const bowing = make(), still = make();
    let palmsBowed = palms(bowing), palmsStill = palms(still);
    play(function* () {
      yield* pose(bowing, { bow }, { until: 2.5 });
      [palmsBowed, palmsStill] = [palms(bowing), palms(still)];
    }, [bowing, still], 2.6);
    return { bowed: palmsBowed, still: palmsStill, log: [...bowing.log, ...still.log] };
  };

  describe.each(BODIES)('on %s', (_name, make) => {
    it.each([0.3, 0.6])('of %s rad keeps the free hands at the sides of the thighs, sliding a little down their fronts, not plumb ahead', (bow) => {
      const { bowed: hands, still, log } = bowed(make, bow);
      hands.forEach((hand, i) => {
        // (plumb, a 0.6 rad bow leaves the palms 0.2 m ahead of where they hang standing)
        expect(hand.ahead - still[i].ahead).toBeGreaterThan(-0.01);
        expect(hand.ahead - still[i].ahead).toBeLessThan(0.05);
        expect(Math.abs(hand.out - still[i].out)).toBeLessThan(0.01);
      });
      // (no arm in the trunk or a thigh, the joints within their pace and range, the extrapolated centre of mass over the feet)
      expect(log).toEqual([]);
    });

    it('stooped deep, lets the arms hang toward the plumb', () => {
      const { bowed: hands, still, log } = bowed(make, 1.4);
      hands.forEach((hand, i) => expect(hand.ahead - still[i].ahead).toBeGreaterThan(0.25));
      expect(log).toEqual([]);
    });
  });
});

