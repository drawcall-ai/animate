import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, createSkeletonModel, horse, Humanoid, INDEX, Pose, walkTo, type Gait, type ReadonlyPose } from '@drawcall/animate';
import type { Stepper } from '../../packages/animate/src/core/legs/stepper';
import { HORSE_TROT, HORSE_WALK, horseMotion } from '../../packages/animate/src/horse/legs';
import { clampRotation } from '../../packages/animate/src/core/limits';
import { solePoints } from '../../packages/animate/src/humanoid/landmarks';
import { Playback } from '../src/playback';
import { Simulation } from '../src/simulation';
import { along, legsBiped, legsHorse, scriptedRoot } from '../src/scenarios/legs';
import { cases } from '../../packages/animate/test/open';

// The legs on scripted roots: a person and two horses (walk, trot) carried along a straight, a bend and a stop by the scene.

it('two horses walk and trot along their scripted roots, every foot down again at the end, the dev log empty', () => {
  const sim = new Simulation(legsHorse(), undefined, true);
  const landings = [0, 0];
  const swinging = [[false, false, false, false], [false, false, false, false]];
  while (sim.t < sim.scenario.duration) {
    sim.step();
    sim.stage.bodies!.forEach((body, b) => (body.stepper as Stepper).legs.forEach((leg, i) => {
      if (swinging[b][i] && !leg.swing) landings[b]++;
      swinging[b][i] = !!leg.swing;
    }));
  }
  for (const count of landings) expect(count).toBeGreaterThan(10);
  expect(sim.stage.done()).toBe(true);
  for (const body of sim.stage.bodies!) expect(body.log).toEqual([]);
});

it('a person steps along a scripted root and stops, the dev log empty', () => {
  const sim = new Simulation(legsBiped(), undefined, true);
  while (sim.t < sim.scenario.duration) sim.step();
  expect(sim.stage.done()).toBe(true);
  expect(sim.actors[0].log).toEqual([]);
});

it('shows a generic body without assuming a humanoid cast', () => {
  const playback = new Playback(new Simulation(legsHorse()));
  playback.advanceTo(4);
  const shown = playback.blend(0.5);
  expect(shown.props.length).toBeGreaterThan(0);
  expect(Number.isFinite(shown.root.z + playback.facing + playback.velocity.length())).toBe(true);
  expect(playback.sim.stage.bodies?.every((b) => b.frame.dev === undefined)).toBe(true);
});

it('legs-biped playback leads along the scripted travel and turn', () => {
  const playback = new Playback(new Simulation(legsBiped()));
  playback.advanceTo(8);
  expect(playback.velocity.length()).toBeGreaterThan(1);
  expect(playback.facing).toBeGreaterThan(0.1);
  expect(playback.facing).toBeCloseTo(playback.sim.actors[0].yaw, 10);
});

// The stepper on scripted roots (a ramp up, a bend, a stop over `brake` s): each final pose with the soles on or over the floor, a
// planted foot pivoting about a point of its sole that stays put, a landing frozen once past mid-swing, every joint in range, the
// joints no faster than a snap, a horse's walk in its lateral sequence, every foot down at the end and the dev log empty.
const person = (brake: number) => new Humanoid(createSkeletonModel(), undefined, { idle: { root: along(scriptedRoot(0, 1.3, new Vector3(), 0, 1, brake)) }, dev: true });
const horseOn = (gait: Gait, pace: number, brake = 2, radius = 15) => {
  const base = horse(), species = { ...base, legs: { ...base.legs!, gait, posture: (start: ReadonlyPose) => horseMotion(start, gait, 1) } };
  return new Body(species, undefined, { pose: new Pose(base.skeleton), idle: { root: along(scriptedRoot(0, pace, new Vector3(), 0, 0, brake, radius)) }, dev: true });
};
/** Open: a person's joints at 1.3 m/s reach a p99 of ~690 °/s at the knee and ~610 °/s at the ankle against a ceiling of 500 (the gait's
 * swing is 0.355 s of a 0.935 s stride, shorter than a person's ~0.4 s of ~1.05 s): a gait to tune, not a ceiling to raise */
const test = cases(['a person walking', 'a person stopping hard'].map((name) => `${name}: soles on the floor, planted pivots, frozen landings, joints in range and no faster than a snap`));
for (const [name, make] of [['a person walking', () => person(3)], ['a person stopping hard', () => person(0.5)], ['a horse walking', () => horseOn(HORSE_WALK, 1.6)],
  ['a horse trotting, braking in 2 s', () => horseOn(HORSE_TROT, 3.7)], ['a horse trotting, braking in 3 s', () => horseOn(HORSE_TROT, 3.7, 3)], ['a horse walking a 3 m turn', () => horseOn(HORSE_WALK, 1.6, 2, 3)]] as const) {
  test(`${name}: soles on the floor, planted pivots, frozen landings, joints in range and no faster than a snap`, () => {
    const body: Body = make(), chains = body.species.legs?.chains, person = body instanceof Humanoid ? body : null;
    const sole = (i: number) => person ? solePoints(person, body.pose, i ? 'right' : 'left')
      : [chains![i].heel, chains![i].toe].map((at) => body.pose.point(chains![i].joints[chains![i].joints.length - 1].bone, at, new Vector3()));
    const bones = (i: number) => person ? (['UpperLeg', 'LowerLeg', 'Foot'] as const).map((b) => INDEX[`${i ? 'right' : 'left'}${b}`]) : chains![i].joints.map((joint) => joint.bone);
    let ground = 0, pivot = 0, rom = 0, drift = 0;
    const landings: number[] = [], speeds: number[] = [], was = new Pose(body.pose.skeleton);
    const before: { sole: Vector3[]; swing: boolean; anchor: Vector3 }[] = [];
    for (let tick = 0; tick < 16 * 60; tick++) {
      was.copy(body.pose);
      body.update(1 / 60);
      (body.stepper as Stepper).legs.forEach((leg, i) => {
        const points = sole(i), last = before[i];
        ground = Math.max(ground, ...points.map((p) => -p.y));
        if (last && !leg.swing && !last.swing) pivot = Math.max(pivot, Math.min(...points.map((p, k) => p.distanceTo(last.sole[k]))));
        if (last?.swing && leg.swing && leg.swing.u > 0.55) drift = Math.max(drift, leg.anchor.distanceTo(last.anchor));
        if (last?.swing && !leg.swing) landings.push(i);
        for (const bone of bones(i)) {
          const limit = body.pose.skeleton.limits[bone], q = new Quaternion().copy(body.pose.local(bone)), kept = q.clone();
          if (limit) { clampRotation(kept, limit); rom = Math.max(rom, q.angleTo(kept)); }
          if (tick > 0) speeds.push(was.local(bone).angleTo(body.pose.local(bone)) * 60 * 180 / Math.PI);
        }
        before[i] = { sole: points, swing: !!leg.swing, anchor: leg.anchor.clone() };
      });
    }
    speeds.sort((a, b) => a - b);
    expect(ground).toBeLessThan(1e-5);
    // (a person's planted foot stays put; a hoof pivots in place as the body turns — the user's decision, 2026-10-20 — by under a mm a sub-step)
    expect(pivot).toBeLessThan(person ? 1e-5 : 1e-3);
    expect(drift).toBe(0);
    expect(rom).toBeLessThan(1e-6);
    expect(landings.length).toBeGreaterThan(10);
    expect((body.stepper as Stepper).legs.every((leg) => !leg.swing)).toBe(true);
    expect(speeds[Math.floor(speeds.length * 0.99)]).toBeLessThan(person ? 500 : 800);
    expect(body.log).toEqual([]);
    // (Hildebrand's lateral sequence: left hind, left fore, right hind, right fore — the chains fore-left, fore-right, hind-left, hind-right)
    if (name === 'a horse walking') {
      const order = [2, 0, 3, 1], steady = landings.slice(4);
      for (let k = 1; k < steady.length; k++) expect(steady[k]).toBe(order[(order.indexOf(steady[k - 1]) + 1) % 4]);
    }
  }, 30_000);
}

// (the planner foresees its root and keeps to what the legs can follow — `Stepper.reachable` — as a caller once preflighted its own:
// a horse walking a 2 m circle at 1.6 m/s after a carrot never outruns its legs)
it('a horse walks a 2 m circle at 1.6 m/s after a carrot, its legs keeping up, its log empty', () => {
  const R = 2, centre = new Vector3(R, 0, 0);
  let swept = 0, last = Math.PI;
  const body = new Body(horse(), (b) => walkTo(b, { speed: 1.6, accel: 1.2, to: () => {
    const p = b.pose.position(0), a = Math.atan2(p.z - centre.z, p.x - centre.x) + 1.2 / R;
    return new Vector3(centre.x + R * Math.cos(a), 0, centre.z + R * Math.sin(a));
  }, until: () => {
    const p = b.pose.position(0), a = Math.atan2(p.z - centre.z, p.x - centre.x);
    swept += Math.abs(Math.atan2(Math.sin(a - last), Math.cos(a - last))); last = a;
    return swept > 2 * Math.PI;
  } }), { pose: new Pose(horse().skeleton), dev: true });
  let lag = 0;
  for (let i = 0; i < 40 * 60 && !body.done; i++) {
    body.update(1 / 60);
    const p = body.pose.position(0);
    lag = Math.max(lag, Math.abs(Math.hypot(p.x - centre.x, p.z - centre.z) - R));
  }
  expect(body.done).toBe(true);
  expect(lag).toBeLessThan(0.5 * R);
  expect(body.log).toEqual([]);
}, 30_000);
