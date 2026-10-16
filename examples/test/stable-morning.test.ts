import { Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Simulation } from '../src/simulation';
import { stableMorning } from '../src/scenarios/stable-morning';

it('leads upright with a free swinging arm and an articulated pelvis', () => {
  const sim = new Simulation(stableMorning(), undefined, true);
  const chest: number[] = [], arm: number[] = [], roll: number[] = [];
  const hip: number[][] = [[], []];
  let airborneTilt = 0;
  while (sim.t < 50) {
    sim.step();
    const saddle = sim.props().find(p => p.kind === 'box' && p.size.y === 0.16);
    if (!saddle || saddle.kind !== 'box' || !saddle.quaternion) throw new Error('missing saddle');
    if (!sim.stage.bodies?.[0].worn.size && saddle.position.y > 1.25) {
      airborneTilt = Math.max(airborneTilt, new Vector3(0, 1, 0).applyQuaternion(saddle.quaternion).angleTo(new Vector3(0, 1, 0)));
      // Conservative bounds include both skirts: any crossing of the tie rail must pass above it.
      if (Math.abs(saddle.position.x - 0.35) < 0.33 && saddle.position.z > 2.5 && saddle.position.z < 4.8) {
        expect(saddle.position.y - 0.3).toBeGreaterThan(1.16);
      }
    }
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
    for (const [i, side] of ['left', 'right'].entries()) {
      hip[i].push(new Euler().setFromQuaternion(horse.pose.local(horse.pose.skeleton.index(`${side}Femur`)), 'YZX').x);
    }
    roll.push(new Euler().setFromQuaternion(horse.pose.local(horse.pose.skeleton.index('pelvis')), 'YXZ').z);
  }
  expect(airborneTilt * 180 / Math.PI).toBeLessThan(5);
  const degrees = 180 / Math.PI;
  expect(Math.max(...chest.map(Math.abs)) * degrees).toBeLessThan(5);
  expect((Math.max(...arm) - Math.min(...arm)) * degrees).toBeGreaterThan(30);
  expect((Math.max(...roll) - Math.min(...roll)) * degrees).toBeGreaterThan(5.5);
  for (const angles of hip) {
    const excursion = (Math.max(...angles) - Math.min(...angles)) * degrees;
    expect(excursion).toBeGreaterThan(17);
    expect(excursion).toBeLessThan(21);
  }
  expect(sim.actors[0].log).toEqual([]);
  expect(sim.stage.bodies?.[0].log).toEqual([]);
  expect(sim.stage.done()).toBe(true);
});
