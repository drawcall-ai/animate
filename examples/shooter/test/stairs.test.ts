import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { box, DT, node, soldierOn, soles, stairs } from './course';
import { expectSmooth, Motion } from './motion';

/** The path's staircase on the floor, and the soldier standing seen from outside at `spawn`, settled 3 s. */
async function setup(spawn: Vector3, yaw: number) {
  const run = await soldierOn((scene) => {
    box(scene, [40, 1, 40], [0, -0.5, 0]);
    stairs(scene);
  }, { spawn, yaw, firstPerson: false });
  run.advance(3);
  return run;
}

it('keeps the soles on the floor when the capsule first climbs a stair riser', async () => {
  const { world, movement, avatar, advance } = await setup(new Vector3(0, 0.02, -1), 0);
  movement.input.move.z = 1;
  for (let i = 0; i < 180 && movement.position.z < -0.21; i++) world.update(DT);
  expect(movement.position.z).toBeGreaterThanOrEqual(-0.21);
  movement.input.move.z = 0;
  advance(2);
  expect(movement.grounded).toBe(true);
  for (const side of ['left', 'right'] as const) {
    const points = soles(avatar.body, side);
    const errors = points.map((point) => point.y - (point.z < 0 ? 0 : 0.22));
    expect(Math.min(...errors)).toBeGreaterThan(-0.01);
    expect(Math.min(...errors)).toBeLessThan(0.025);
  }
});


const stairFloor = (z: number) => z < 0 ? 0 : Math.min(8, Math.floor(z / 0.55) + 1) * 0.22;
const traversals = [1, -1].flatMap((direction) => [false, true].map((sprint) => ({ direction, sprint })));

it.each(traversals)(
  'lands its feet on staircase treads in direction $direction with sprint=$sprint', async ({ direction, sprint }) => {
  const spawn = new Vector3(0, direction > 0 ? 0.02 : 1.78, direction > 0 ? -1 : 5.2);
  const { world, movement, avatar } = await setup(spawn, direction > 0 ? 0 : Math.PI);
  const motion = new Motion(avatar.body);
  const touched = new Set<number>();
  let penetration = 0, hovering = 0, split = 0, clearance = Infinity;
  let worst: object = {}, worstHover: object = {};
  let previous = avatar.body.feet.map((foot) => foot.planted);
  const snapshot = () => ({
    hip: node(avatar.group, 'hips').getWorldPosition(new Vector3()).y, eye: avatar.look().eye.y,
    posedEye: node(avatar.group, 'right eye').getWorldPosition(new Vector3()).y,
    capsule: movement.position.toArray(), velocity: movement.actualVelocity.toArray(), support: movement.support?.toArray(), grounded: movement.grounded,
    feet: avatar.body.feet.map((foot) => ({ planted: foot.planted, at: foot.position.toArray() })),
  });
  let last = snapshot(), hipSpeed = 0, eyeSpeed = 0, maxMove = 0, maxAcceleration = 0;
  let worstMove: object = {}, worstAcceleration: object = {};
  let maxHipMove = 0, maxPoseEyeMove = 0, maxHipAcceleration = 0;
  let worstHipMove: object = {}, worstHipAcceleration: object = {};
  movement.input.move.z = direction;
  movement.input.sprint = sprint;
  for (let frame = 0; frame < 480 && (direction > 0 ? movement.position.z < 5.2 : movement.position.z > -1); frame++) {
    world.update(DT);
    motion.sample(frame);
    const now = snapshot(), dy = now.hip - last.hip, ey = now.eye - last.eye;
    const step = Math.max(Math.abs(dy), Math.abs(ey));
    const acceleration = Math.max(Math.abs(dy / DT - hipSpeed), Math.abs(ey / DT - eyeSpeed)) / DT;
    if (Math.abs(dy) > maxHipMove) { maxHipMove = Math.abs(dy); worstHipMove = { frame, from: last, to: now }; }
    maxPoseEyeMove = Math.max(maxPoseEyeMove, Math.abs(now.posedEye - last.posedEye));
    const hipAcceleration = Math.abs(dy / DT - hipSpeed) / DT;
    if (hipAcceleration > maxHipAcceleration) { maxHipAcceleration = hipAcceleration; worstHipAcceleration = { frame, from: last, to: now }; }
    if (step > maxMove) { maxMove = step; worstMove = { frame, from: last, to: now }; }
    if (acceleration > maxAcceleration) { maxAcceleration = acceleration; worstAcceleration = { frame, from: last, to: now }; }
    [last, hipSpeed, eyeSpeed] = [now, dy / DT, ey / DT];
    const feet = avatar.body.feet;
    feet.forEach((foot, index) => {
      if (!foot.planted) return;
      const points = soles(avatar.body, index === 0 ? 'left' : 'right');
      const levels = points.map((point) => stairFloor(point.z));
      clearance = Math.min(clearance, node(avatar.group, 'hips').getWorldPosition(new Vector3()).y - Math.max(...levels));
      const above = points.map((point, i) => point.y - levels[i]);
      if (-Math.min(...above) > penetration) {
        penetration = -Math.min(...above);
        worst = { frame, index, points: points.map((p) => p.toArray()), levels, capsule: movement.position.toArray(), grounded: movement.grounded, feet: feet.map((foot) => ({ planted: foot.planted, at: foot.position.toArray() })), hips: node(avatar.group, 'hips').getWorldPosition(new Vector3()).toArray() };
      }
      if (Math.min(...above) > hovering) {
        hovering = Math.min(...above);
        worstHover = { frame, index, points: points.map((point) => point.toArray()), levels, ...now };
      }
      if (previous[index]) return;
      if (Math.max(...levels) - Math.min(...levels) > 0.01) split++;
      touched.add(Math.round(levels[0] / 0.22));
    });
    previous = feet.map((foot) => foot.planted);
  }
  expect(direction * movement.position.z).toBeGreaterThan(direction > 0 ? 5.2 : 1);
  expect(penetration, JSON.stringify(worst)).toBeLessThan(0.01);
  expect(hovering, JSON.stringify(worstHover)).toBeLessThan(0.025);
  expect(clearance).toBeGreaterThan(0.35);
  expect(split).toBe(0);
  expect([...touched].filter((tread) => tread > 0).length).toBeGreaterThan(1);
  expect(maxHipMove, JSON.stringify(worstHipMove)).toBeLessThan(0.06);
  expect(maxMove, JSON.stringify(worstMove)).toBeLessThan(0.08);
  expect(maxPoseEyeMove).toBeLessThan(0.08);
  // Full-speed toe-off briefly loads the trailing leg more sharply than flat ground or a ramp.
  expect(maxHipAcceleration, JSON.stringify(worstHipAcceleration)).toBeLessThan(75);
  expect(maxAcceleration, JSON.stringify(worstAcceleration)).toBeLessThan(75);
  expectSmooth(motion);
});


// (each way, stopped on each part of a tread, from standing and once its life has run a while)
const stops = [
  { direction: 1, stop: 0.1, warmup: 0 }, { direction: 1, stop: 0.65, warmup: 4.3 },
  { direction: -1, stop: 0.45, warmup: 4.3 }, { direction: -1, stop: 0.65, warmup: 0 },
];

it.each(stops)('settles on different stair treads after direction $direction stops at $stop with warmup $warmup', async ({ direction, stop, warmup }) => {
  // The path's own staircase position.
  const X = -8, Z = -5.275;
  const { world, movement, avatar, acquire } = await soldierOn((scene) => {
    box(scene, [40, 1, 40], [X, -0.5, Z]);
    stairs(scene, X, Z);
  }, { spawn: new Vector3(X, direction > 0 ? 0.02 : 1.78, Z + (direction > 0 ? -1 : 5.2)), yaw: direction > 0 ? 0 : Math.PI, pitch: -0.18 });
  acquire();
  while (world.time < warmup) world.update(DT);
  movement.input.move.z = direction;
  for (let frame = 0; frame < 600 && direction * (movement.position.z - Z) < direction * stop; frame++) world.update(DT);
  expect(direction * (movement.position.z - Z)).toBeGreaterThanOrEqual(direction * stop);
  movement.input.move.z = 0;
  const motion = new Motion(avatar.body);
  const rows = [];
  for (let frame = 0; frame < 420; frame++) {
    world.update(DT);
    motion.sample(frame);
    rows.push({ frame, hip: avatar.body.bones.hips.getWorldPosition(new Vector3()).y,
      eye: avatar.look().eye.y, capsule: movement.position.toArray(), velocity: movement.actualVelocity.toArray(),
      grounded: movement.grounded, support: movement.support?.toArray(), feet: avatar.body.feet.map((f) => ({ planted: f.planted, at: f.position.toArray() })),
    });
  }
  const settled = rows.slice(120);
  const range = (values: number[]) => Math.max(...values) - Math.min(...values);
  let worst = 0, worstEye = 0, worstFrame = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].hip - rows[i - 1].hip);
    if (d > worst) { worst = d; worstFrame = i; }
    worstEye = Math.max(worstEye, Math.abs(rows[i].eye - rows[i - 1].eye));
  }
  expect(worst, JSON.stringify(rows.slice(Math.max(0, worstFrame - 2), worstFrame + 3))).toBeLessThan(0.06);
  expect(worstEye).toBeLessThan(0.06);
  expect(range(settled.map((r) => r.capsule[1]))).toBeLessThan(0.001);
  expect(range(settled.map((r) => r.hip))).toBeLessThan(0.005);
  const eyeStep = Math.max(...settled.slice(1).map((r, i) => Math.abs(r.eye - settled[i].eye)));
  expect(eyeStep).toBeLessThan(0.002);
  expect(settled.every((r) => r.feet.every((f) => f.planted)), 'Standing feet must not keep stepping in place').toBe(true);
  expectSmooth(motion);
});
