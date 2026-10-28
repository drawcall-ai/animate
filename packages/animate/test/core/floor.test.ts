import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, dog, horse, walkTo } from '../../src/index';
import { selfOf } from '../../src/body/body';
import { play, run } from '../bodies';
import { HORSE } from '../../skills/animate/references/horse';
import { DOG } from '../../skills/animate/references/dog';

const KINDS = { horse: horse(HORSE), dog: dog(DOG) };

/** how far each of `body`'s soles (its heel and toe) is above the floor under it (m; − into it), and whether its leg is planted */
function soles(body: Body, floor: (x: number, z: number) => number): { above: number; planted: boolean }[] {
  const self = selfOf(body), chains = body.species.legs?.chains ?? [];
  return chains.map((chain, i) => {
    const bone = chain.joints[chain.joints.length - 1].bone;
    const above = Math.min(...[chain.heel, chain.toe].map((p) => self.pose.point(bone, p, new Vector3())).map((p) => p.y - floor(p.x, p.z)));
    return { above, planted: !self.stepper?.legs[i].swing };
  });
}

it.each(Object.entries(KINDS))('a %s stands on a raised floor as on the ground', (_, kind) => {
  const raised = new Body(kind, { dev: true, floor: () => 1, at: new Vector3(0, 1, 0) }), flat = new Body(kind, { at: new Vector3() });
  run(raised, 3);
  run(flat, 3);
  expect(raised.position.y).toBe(1);
  expect(flat.position.y).toBe(0);
  raised.pose.skeleton.bones.forEach((_, b) => expect(raised.pose.position(b).clone().setY(raised.pose.position(b).y - 1).distanceTo(flat.pose.position(b))).toBeLessThan(1e-6));
  expect(raised.log).toEqual([]);
});

it.each(Object.entries(KINDS))('a %s walks up a 0.15 m step and on, its hooves or paws on each level and never in it', (_, kind) => {
  const floor = (_x: number, z: number) => z < 2 ? 0 : 0.15, body = new Body(kind, { dev: true, floor });
  let arrived = false, sunk = 0, raised = 0;
  play(function* () { arrived = yield* walkTo(body, new Vector3(0, floor(0, 5), 5), { speed: 0.8 }); }, [body], 15, () => {
    for (const { above, planted } of soles(body, floor)) {
      sunk = Math.max(sunk, -above);
      if (planted) raised = Math.max(raised, above);
    }
    return arrived;
  });
  expect(arrived).toBe(true);
  expect(body.position.y).toBe(0.15);
  expect(sunk).toBeLessThan(1e-3);
  expect(raised).toBeLessThan(1e-3);
  expect(body.log).toEqual([]);
});
