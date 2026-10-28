import { expect, test } from 'vitest';
import { Group, Vector3 } from 'three';
import { reach } from '@drawcall/animate';
import { reachAround } from '../src/scenarios/life';
import { Cast, type Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { armInTrunk } from './clearance';
import { Actor } from './actor';

test('reaches every reach-around target without squatting or penetrating the trunk', () => {
  const sim = new Simulation(reachAround);
  const person = new Actor(sim.people[0]);
  const targets = sim.stage.scene.children.filter((child) => child.name === 'point').map((ball) => ball.position);
  const reached = new Set<number>();
  let lowest = Infinity, deepest = 0;
  while (sim.t < reachAround.duration) {
    sim.step();
    deepest = Math.max(deepest, armInTrunk(person, 'right'));
    lowest = Math.min(lowest, person.joint('hips').y - person.proportions.hipHeight);
    targets.forEach((target, i) => {
      if (person.joint('rightHand').distanceTo(target) < 0.01) reached.add(i);
    });
  }
  expect(deepest).toBeLessThan(0.01);
  expect(lowest).toBeGreaterThan(-0.08);
  expect(reached.size).toBe(3);
  expect(sim.stage.done()).toBe(true);
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
