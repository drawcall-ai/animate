import { expect } from 'vitest';
import { Group, Vector3 } from 'three';
import { reach } from '@drawcall/animate';
import { reachAround } from '../src/scenarios/life';
import { Cast, type Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { armInTrunk } from './clearance';
import { Actor } from './actor';
import { cases } from '../../packages/animate/test/open';

// Open (expected to fail: each one fixed comes off the list), library defects:
// - reaching the right hand across the body to (0.4, 1.15, 0.3), 0.4 m to its left, the hand stops 6–7 cm short of it from 2 s on
//   and the reach never ends (12 s and on), with nothing in the dev log; so reach-around never gets to its third point;
// - a reach's hand leaves its target ~0.6 s before the verb ends: reaching a point 1.1 m up, 0.8 m ahead, the hand is on it at 6.75 s,
//   no verb owns the hand from ~6.9 s, the hand is 0.58 m off it at 7.25 s, and the reach ends only at 7.43 s.
const test = cases([
  'reaches every reach-around target standing, without a squat',
  'keeps its hand on what it reaches for until the reach ends',
]);

test('reaches every reach-around target standing, without a squat', () => {
  const sim = new Simulation(reachAround);
  const person = new Actor(sim.people[0]);
  const targets = sim.stage.scene.children.filter((child) => child.name === 'point').map((ball) => ball.position);
  const reached = new Set<number>();
  let lowest = Infinity;
  while (sim.t < reachAround.duration) {
    sim.step();
    lowest = Math.min(lowest, person.joint('hips').y - person.proportions.hipHeight);
    targets.forEach((target, i) => {
      if (person.joint('rightHand').distanceTo(target) < 0.01) reached.add(i);
    });
  }
  expect(lowest).toBeGreaterThan(-0.08);
  expect(reached.size).toBe(3);
  expect(sim.stage.done()).toBe(true);
});

test('brings the right hand round the front of the trunk to the reach-around target behind it on the left', () => {
  const sim = new Simulation(reachAround);
  const person = new Actor(sim.people[0]);
  let deepest = 0;
  while (sim.t < reachAround.duration) {
    sim.step();
    deepest = Math.max(deepest, armInTrunk(person, 'right'));
  }
  expect(deepest).toBeLessThan(0.01);
});

test('keeps its hand on what it reaches for until the reach ends', () => {
  const target = new Vector3(0, 1.1, 0.8);
  let reaching = false;
  const scenario: Scenario = {
    id: 'reach ahead', title: 'A reach ahead', duration: 6,
    stage: (cast: Cast) => {
      const person = cast.person();
      return {
        scene: new Group(), bodies: [person], done: () => !reaching,
        story: function* () {
          reaching = true;
          yield* reach(person, { right: target });
          reaching = false;
        },
      };
    },
  };
  const sim = new Simulation(scenario);
  const person = new Actor(sim.people[0]);
  let on = false, farthest = 0;
  while (sim.t < scenario.duration) {
    sim.step();
    const off = person.joint('rightHand').distanceTo(target);
    on ||= off < 0.01;
    if (on && reaching) farthest = Math.max(farthest, off);
  }
  expect(on).toBe(true);
  expect(farthest).toBeLessThan(0.03);
});
