import { Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Simulation } from '../src/simulation';
import { stableMorning } from '../src/scenarios/stable-morning';

it('leads upright with a free swinging arm and an articulated pelvis', () => {
  const sim = new Simulation(stableMorning(), undefined, true);
  const chest: number[] = [], arm: number[] = [], roll: number[] = [];
  while (sim.t < 50) {
    sim.step();
    if (sim.t < 35) continue;
    const h = sim.actors[0];
    const p = h.pose;
    const at = (name: string) => p.position(p.skeleton.index(name));
    expect(h.holding.left).toBeNull();
    expect(h.asks.bow).toBe(0);
    chest.push(new Euler().setFromQuaternion(p.rotation(p.skeleton.index('chest')), 'YXZ').x);
    const upper = at('leftLowerArm').clone().sub(at('leftUpperArm'));
    const forward = new Vector3(Math.sin(h.gait.facing), 0, Math.cos(h.gait.facing));
    arm.push(Math.atan2(upper.dot(forward), -upper.y));
    const horse = sim.stage.bodies?.[0];
    if (!horse) throw new Error('missing horse');
    roll.push(new Euler().setFromQuaternion(horse.pose.local(horse.pose.skeleton.index('pelvis')), 'YXZ').z);
  }
  const degrees = 180 / Math.PI;
  expect(Math.max(...chest.map(Math.abs)) * degrees).toBeLessThan(5);
  expect((Math.max(...arm) - Math.min(...arm)) * degrees).toBeGreaterThan(30);
  expect((Math.max(...roll) - Math.min(...roll)) * degrees).toBeGreaterThan(5.5);
  expect(sim.actors[0].log).toEqual([]);
  expect(sim.stage.bodies?.[0].log).toEqual([]);
  expect(sim.stage.done()).toBe(true);
});
