import { Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Simulation } from '../src/simulation';
import { vary } from '../scripts/run';
import { segmentDistance } from './clearance';
import { stableMorning } from '../src/scenarios/stable-morning';

// Read from the scene's saddle meshes and horse barrel, in metres.
const SEAT_HEIGHT = 0.16;
const SKIRT_HEIGHT = 0.29;
const HORSE_HALF_WIDTH = 0.24;
// Recalled conservative body radii, as shares of stature.
const HEAD_RADIUS = 0.06;
const BODY_RADIUS = 0.06;
const LEG_RADIUS = 0.038;
const HORSE_LEG_RADIUS = 0.06;
const HUMAN_LEGS = [['UpperLeg', 'LowerLeg'], ['LowerLeg', 'Foot']];
const HORSE_LEGS = [
  ['Femur', 'Gaskin'], ['Gaskin', 'HindCannon'],
  ['Scapula', 'Humerus'], ['Humerus', 'Forearm'],
];
// Read from the carry/raise split: observe walking after leaving the rack and before the final approach.
const LEAVING_RACK = 14;
const RAISE_LEAD = 0.7;
const MOVING = 0.15;
const AT_HORSE = 0.7;

it('leads upright with a free swinging arm and an articulated pelvis', () => {
  const sim = new Simulation(stableMorning(), undefined, true);
  const chest: number[] = [];
  const arm: number[] = [];
  const roll: number[] = [];
  const hip: number[][] = [[], []];
  let airborneTilt = 0;
  while (sim.t < 50) {
    sim.step();
    const saddle = sim.props().find(p => p.kind === 'box' && p.size.y === SEAT_HEIGHT);
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
    // The handler stays beside the shoulder once the horse has caught up.
    if (sim.t > 45) {
      const ahead = p.position(0).z - horse.pose.position(0).z;
      expect(ahead).toBeGreaterThan(0.45);
      expect(ahead).toBeLessThan(0.75);
    }
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

it.each([0, 1, 2])('carries below the face until arrival and places clear of both bodies #%i', (seed) => {
  const scene = stableMorning();
  const sim = new Simulation(seed ? vary(scene, seed) : scene);
  let headGap = Infinity;
  let legGap = Infinity;
  let barrelGap = Infinity;
  let walking = 0;
  while (sim.t < 25) {
    sim.step();
    const h = sim.actors[0];
    const item = h.holding.left?.item;
    const horse = sim.stage.bodies?.[0];
    if (!item || item.name !== 'saddle' || !horse || item.supported || item.wornBy) continue;
    const head = h.pose.point(h.pose.skeleton.index('head'), h.proportions.headCenter, new Vector3());
    for (const box of sim.props()) {
      if (box.kind !== 'box' || !box.quaternion || ![SEAT_HEIGHT, SKIRT_HEIGHT].includes(box.size.y)) continue;
      const local = head.clone().sub(box.position).applyQuaternion(box.quaternion.clone().invert());
      const off = new Vector3(
        Math.max(0, Math.abs(local.x) - box.size.x / 2),
        Math.max(0, Math.abs(local.y) - box.size.y / 2),
        Math.max(0, Math.abs(local.z) - box.size.z / 2),
      );
      headGap = Math.min(headGap, off.length() - HEAD_RADIUS * h.proportions.height);
    }
    if (sim.t > LEAVING_RACK && h.gait.eta > RAISE_LEAD && h.gait.velocity.length() > MOVING) {
      walking++;
      expect(item.current.position.y).toBeLessThan(h.proportions.shoulderHeight);
    }
    if (item.current.position.x < AT_HORSE) continue;
    const root = horse.pose.position(0);
    barrelGap = Math.min(barrelGap, root.x - h.pose.position(0).x - HORSE_HALF_WIDTH - BODY_RADIUS * h.proportions.height);
    for (const side of ['left', 'right']) for (const [a, b] of HUMAN_LEGS) {
      const from = h.pose.position(h.pose.skeleton.index(`${side}${a}`));
      const end = h.pose.position(h.pose.skeleton.index(`${side}${b}`));
      for (const s of ['left', 'right']) for (const [c, d] of HORSE_LEGS) {
        const other = horse.pose.position(horse.pose.skeleton.index(`${s}${c}`));
        const tip = horse.pose.position(horse.pose.skeleton.index(`${s}${d}`));
        legGap = Math.min(legGap, segmentDistance(from, end, other, tip) - LEG_RADIUS * h.proportions.height - HORSE_LEG_RADIUS);
      }
    }
  }
  expect(walking).toBeGreaterThan(0);
  // Keep 2 cm of reserve, rather than a pass/fail boundary at contact.
  expect(headGap).toBeGreaterThan(0.02);
  expect(legGap).toBeGreaterThan(0);
  expect(barrelGap).toBeGreaterThan(0);
});
