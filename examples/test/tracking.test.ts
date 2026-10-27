import { expect } from 'vitest';
import { Group, Vector3 } from 'three';
import { reach } from '@drawcall/animate';
import { lookAround, reaching, vr } from '../src/scenarios/tracking';
import type { Cast, Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { route } from '../src/keys';
import { run } from '../scripts/run';
import { cases } from '../../packages/animate/test/open';

// Open (expected to fail: each one fixed comes off the list), library defects:
// - looking round, the body turning back from behind brings its left upper arm 1.0–1.1 cm into the trunk at 15 s (dev log, limit 1 cm);
const test = cases([
  'looks around with an empty dev log',
]);

/** a person reaching its right hand to `target` (a function of its time) until `until` s */
function following(target: (time: number) => Vector3, until: number, duration: number): Scenario {
  return {
    id: 'following', title: 'A following reach', duration,
    stage: (cast: Cast) => {
      const person = cast.person();
      return { scene: new Group(), bodies: [person], done: () => true, story: () => reach(person, { right: target }, { until }) };
    },
  };
}

/** the distance of the first person's `hand` (its wrist) from `target` at `time` s into `scenario` */
function offAt(scenario: Scenario, time: number, target: (sim: Simulation) => Vector3, hand: 'leftHand' | 'rightHand' = 'rightHand'): number {
  const sim = new Simulation(scenario);
  sim.advanceTo(time);
  return sim.people[0].bones[hand].getWorldPosition(new Vector3()).distanceTo(target(sim));
}

test('a following reach whose target starts out of reach follows it once it comes in reach', () => {
  const target = (time: number) => new Vector3(-0.25, time < 1 ? 2.05 : 1.4, 0.4);
  expect(offAt(following(target, 3, 3), 2.5, () => target(2.5))).toBeLessThan(0.03);
});

test('a following reach steps after a target leaving its reach', () => {
  const way = route([[0, [-0.25, 1.25, 0.45]], [3.5, [0, 1.25, 1.8]]]);
  expect(offAt(following((time) => way(time), 6, 6), 5.5, () => way(5.5))).toBeLessThan(0.05);
});

test('tracked controllers rising from the floor to a cheer are followed', () => {
  expect(offAt(vr(), 8.5, (sim) => sim.stage.scene.getObjectByName('left controller')!.position, 'leftHand')).toBeLessThan(0.15);
});

test('reaches a point 6 cm off the floor while it rests there', () => {
  // (the recording reaches the floor by 6.9 s and rests there till 7.7 s; its anticipatory walk brings the body up to it)
  const sim = new Simulation(reaching());
  let nearest = Infinity;
  while (sim.t < 7.7) {
    sim.step();
    const off = sim.people[0].bones.rightHand.getWorldPosition(new Vector3()).distanceTo(sim.stage.scene.getObjectByName('target')!.position);
    if (sim.t >= 6.9) nearest = Math.min(nearest, off);
  }
  expect(nearest).toBeLessThan(0.03);
});

test('looks around with an empty dev log', () => {
  expect(run(lookAround())).toEqual([]);
});

test('reaches round with an empty dev log', () => {
  expect(run(reaching())).toEqual([]);
});
