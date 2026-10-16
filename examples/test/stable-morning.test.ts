import { Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Simulation } from '../src/simulation';
import { vary } from '../scripts/run';
import { segmentDistance } from './clearance';
import { RAISE_LEAD } from '../../packages/animate/src/humanoid/hands/place';
import { HORSE, stableMorning } from '../src/scenarios/stable-morning';

// Read from the scene's saddle meshes and horse barrel, in metres.
const SEAT_HEIGHT = 0.16;
const SKIRT_HEIGHT = 0.29;
const HORSE_HALF_WIDTH = 0.24;
// Recalled conservative human radii, as shares of stature.
const HEAD_RADIUS = 0.06;
const BODY_RADIUS = 0.06;
const LEG_RADIUS = 0.038;
// Read from the horse leg proxy meshes, metres.
const HORSE_LEG_RADIUS = 0.06;
// Tuned catch-up window (s) and shoulder station bounds (m).
const SHOULDER_MIN = 0.45;
const SHOULDER_MAX = 0.75;
const HUMAN_LEGS = [['UpperLeg', 'LowerLeg'], ['LowerLeg', 'Foot']];
const HORSE_LEGS = [
  ['Femur', 'Gaskin'], ['Gaskin', 'HindCannon'],
  ['Scapula', 'Humerus'], ['Humerus', 'Forearm'],
];
// Read from the carry/raise split: observe all walking before the final approach.
// Read from the horse neck/head proxy cylinders and square tie-rail sections, metres.
const HORSE_HEAD_RADIUS = 0.1;
const RAIL_RADIUS = Math.SQRT2 * 0.04;
const RAIL = [
  [new Vector3(-0.35, 0, 2.8), new Vector3(-0.35, 1.2, 2.8)],
  [new Vector3(-0.35, 0, 4.5), new Vector3(-0.35, 1.2, 4.5)],
  [new Vector3(-0.35, 1.12, 2.8), new Vector3(-0.35, 1.12, 4.5)],
];
const MOVING = 0.15;
const AT_HORSE = 0.7;

it('leads upright with the near hand forward, slack outside, and halts beyond the gate', () => {
  const sim = new Simulation(stableMorning(), undefined, true);
  const chest: number[] = [];
  const phases = ['', ''];
  let ropeGap = Infinity;
  let leading = 0;
  let settled = 0;
  const roll: number[] = [];
  const hip: number[][] = [[], []];
  let airborneTilt = 0;
  let knot = NaN;
  let firstStep = NaN;
  let horseStep = NaN;
  let leadGap = Infinity;
  let horseRoot = HORSE.clone();
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const saddle = sim.props().find(p => p.kind === 'box' && p.size.y === SEAT_HEIGHT);
    if (!saddle || saddle.kind !== 'box' || !saddle.quaternion) throw new Error('missing saddle');
    if (!sim.stage.bodies?.[0].worn.size && saddle.position.y > 1.25) {
      airborneTilt = Math.max(airborneTilt, new Vector3(0, 1, 0).applyQuaternion(saddle.quaternion).angleTo(new Vector3(0, 1, 0)));
      // Conservative bounds include both skirts: any crossing of the tie rail must pass above it.
      if (Math.abs(saddle.position.x + 0.35) < 0.33 && saddle.position.z > 2.5 && saddle.position.z < 4.8) {
        expect(saddle.position.y - 0.3).toBeGreaterThan(1.16);
      }
    }
    const h = sim.actors[0];
    const horse = sim.stage.bodies?.[0];
    if (!horse) throw new Error('missing horse');
    for (const [s, side] of ['left', 'right'].entries()) {
      const landed = h.feet[s].phase === 'planted' && phases[s] !== 'planted';
      phases[s] = h.feet[s].phase;
      if (!landed || Number.isNaN(knot) || sim.t < knot + 3 || h.gait.velocity.length() < 0.8) continue;
      const foot = h.pose.position(h.pose.skeleton.index(`${side}Foot`)).clone().sub(h.pose.position(0));
      expect((foot.x * Math.cos(h.gait.facing) - foot.z * Math.sin(h.gait.facing)) * (s === 0 ? 1 : -1)).toBeGreaterThan(0);
    }
    const rope = h.holding.right?.item;
    if (rope?.name === 'rope' && !rope.supported) {
      if (Number.isNaN(knot)) knot = sim.t;
      if (Number.isNaN(firstStep) && h.feet.some((foot) => foot.phase === 'swing')) firstStep = sim.t;
      if (Number.isNaN(horseStep) && horse.pose.position(0).distanceTo(horseRoot) > 0.0001) horseStep = sim.t;
      if (h.gait.settled && sim.t > knot + 3) settled++;
      if (sim.t > knot + 3 && h.gait.eta > 1 && h.gait.eta !== Infinity) expect(h.gait.velocity.length()).toBeGreaterThan(0.8);
      for (const [a, b] of [['hips', 'chest'], ['chest', 'neck'], ['neck', 'head']]) {
        const from = h.pose.position(h.pose.skeleton.index(a));
        const end = h.pose.position(h.pose.skeleton.index(b));
        const neck = horse.pose.position(horse.pose.skeleton.index('neck'));
        const poll = horse.pose.position(horse.pose.skeleton.index('head'));
        const muzzle = horse.pose.point(horse.pose.skeleton.index('head'), new Vector3(0, -0.42, 0.33), new Vector3());
        for (const [c, d] of [[neck, poll], [poll, muzzle]]) {
          leadGap = Math.min(leadGap, segmentDistance(from, end, c, d) - BODY_RADIUS * h.proportions.height - HORSE_HEAD_RADIUS);
        }
      }
    }
    horseRoot = horse.pose.position(0).clone();
    if (Number.isNaN(knot) || sim.t < knot + 3 || h.gait.velocity.length() < 0.8) continue;
    leading++;
    const p = h.pose;
    const at = (name: string) => p.position(p.skeleton.index(name));
    expect(h.holding.left).toBeNull();
    expect(h.asks.bow).toBe(0);
    chest.push(new Euler().setFromQuaternion(p.rotation(p.skeleton.index('chest')), 'YXZ').x);
    const right = at('rightHand').clone().sub(at('chest'));
    expect(right.z).toBeGreaterThan(0.25);
    expect(right.x).toBeLessThan(-0.1);
    const left = at('leftHand').clone().sub(at('hips'));
    expect(left.x).toBeGreaterThan(0.15);
    expect(left.z).toBeGreaterThan(0.1);
    for (const prop of sim.props()) {
      if (prop.kind !== 'cylinder' || prop.color !== 0xc4a273 || !prop.quaternion) continue;
      const turn = prop.quaternion;
      const end = (sign: number) => new Vector3(0, sign * prop.length / 2, 0).applyQuaternion(turn).add(prop.position);
      ropeGap = Math.min(ropeGap, segmentDistance(end(-1), end(1), at('hips'), at('chest')) - BODY_RADIUS * h.proportions.height - prop.radius);
    }
    // The handler stays beside the shoulder once the horse has caught up.
    if (sim.t > knot + 5) {
      const ahead = p.position(0).z - horse.pose.position(0).z;
      expect(ahead).toBeGreaterThan(SHOULDER_MIN);
      expect(ahead).toBeLessThan(SHOULDER_MAX);
    }
    for (const [i, side] of ['left', 'right'].entries()) {
      hip[i].push(new Euler().setFromQuaternion(horse.pose.local(horse.pose.skeleton.index(`${side}Femur`)), 'YZX').x);
    }
    roll.push(new Euler().setFromQuaternion(horse.pose.local(horse.pose.skeleton.index('pelvis')), 'YXZ').z);
  }
  expect(firstStep - knot).toBeGreaterThanOrEqual(0);
  expect(firstStep - knot).toBeLessThan(0.5);
  expect(horseStep).toBeGreaterThanOrEqual(firstStep);
  expect(horseStep - firstStep).toBeLessThan(0.1);
  expect(leadGap).toBeGreaterThan(0.02);
  expect(airborneTilt * 180 / Math.PI).toBeLessThan(5);
  const degrees = 180 / Math.PI;
  expect(Math.max(...chest.map(Math.abs)) * degrees).toBeLessThan(5);
  expect(ropeGap).toBeGreaterThan(0.02);
  expect(leading).toBeGreaterThan(60);
  expect(settled).toBeGreaterThan(30);
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
  let railGap = Infinity;
  let footAcross = Infinity;
  while (sim.t < 25) {
    sim.step();
    const h = sim.actors[0];
    const item = h.holding.left?.item;
    const horse = sim.stage.bodies?.[0];
    const feet = h.pose.position(h.pose.skeleton.index('leftFoot')).clone().sub(h.pose.position(h.pose.skeleton.index('rightFoot')));
    footAcross = Math.min(footAcross, feet.x * Math.cos(h.gait.facing) - feet.z * Math.sin(h.gait.facing));
    if (!item || item.name !== 'saddle' || !horse || item.supported || item.wornBy) continue;
    for (const side of ['left', 'right']) for (const [a, b] of HUMAN_LEGS) {
      const from = h.pose.position(h.pose.skeleton.index(`${side}${a}`));
      const end = h.pose.position(h.pose.skeleton.index(`${side}${b}`));
      for (const [c, d] of RAIL) railGap = Math.min(railGap, segmentDistance(from, end, c, d) - LEG_RADIUS * h.proportions.height - RAIL_RADIUS);
    }
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
    if (h.gait.eta > RAISE_LEAD && h.gait.velocity.length() > MOVING) {
      walking++;
      expect(item.current.position.y).toBeLessThan(h.proportions.shoulderHeight);
    }
    if (item.current.position.x > -AT_HORSE) continue;
    const root = horse.pose.position(0);
    barrelGap = Math.min(barrelGap, h.pose.position(0).x - root.x - HORSE_HALF_WIDTH - BODY_RADIUS * h.proportions.height);
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
  expect(railGap).toBeGreaterThan(0);
  expect(footAcross).toBeGreaterThan(0);
  // Keep 2 cm of reserve, rather than a pass/fail boundary at contact.
  expect(headGap).toBeGreaterThan(0.02);
  expect(legGap).toBeGreaterThan(0);
  expect(barrelGap).toBeGreaterThan(0);
});
