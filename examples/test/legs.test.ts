import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, horse, humanoid, walkTo } from '@drawcall/animate';
import { selfOf } from '../../packages/animate/src/body/body';
import { clampRotation } from '../../packages/animate/src/kernel/limits';
import { INDEX } from '../../packages/animate/src/species/humanoid/bones';
import { solePoints } from '../../packages/animate/src/species/humanoid/landmarks';
import { cases } from '../../packages/animate/test/open';
import { play } from '../../packages/animate/test/bodies';
import { Playback } from '../src/playback';
import { Simulation } from '../src/simulation';
import { HORSE, PERSON } from '../src/skeletons';
import { legsBiped, legsHorse, scripted, type Route } from '../src/scenarios/legs';

// The legs on scripted roots: a person and two horses (walk, trot) carried along a straight, a bend and a stop by the scene.

/** the stepping legs of `body`, as its stepper has them */
const legsOf = (body: Body) => selfOf(body).stepper?.legs ?? [];

it('two horses walk and trot along their scripted roots, every hoof down again at the end, the dev log empty', () => {
  const sim = new Simulation(legsHorse(), { dev: true });
  const landings = sim.stage.bodies.map(() => 0);
  let lifted = sim.stage.bodies.map((body) => body.feet.map((foot) => !foot.planted));
  while (sim.t < sim.scenario.duration) {
    sim.step();
    sim.stage.bodies.forEach((body, which) => {
      const now = body.feet.map((foot) => !foot.planted);
      landings[which] += now.filter((up, leg) => lifted[which][leg] && !up).length;
      lifted[which] = now;
    });
  }
  for (const count of landings) expect(count).toBeGreaterThan(10);
  expect(sim.stage.done()).toBe(true);
  for (const body of sim.stage.bodies) expect(body.log).toEqual([]);
});

it('a person steps along a scripted root and stops, the dev log empty', () => {
  const sim = new Simulation(legsBiped(), { dev: true });
  while (sim.t < sim.scenario.duration) sim.step();
  expect(sim.stage.done()).toBe(true);
  expect(sim.people[0].log).toEqual([]);
});

it('plays back creatures on driven roots, no person among them', () => {
  const playback = new Playback(new Simulation(legsHorse()));
  playback.advanceTo(4);
  const { focus } = playback.blend(0.5);
  expect(Number.isFinite(focus.x + focus.y + focus.z)).toBe(true);
  expect(focus.z).toBeGreaterThan(1);
});

// The stepper on scripted roots (a ramp up, a bend, a stop over `brake` s): each final pose with the soles on or over the floor, a
// planted foot pivoting about a point of its sole that stays put, a landing frozen once past mid-swing, every joint in range, the
// joints no faster than a snap, a horse's walk in its lateral sequence, every foot down at the end and the dev log empty.
const person = (brake: number) => { const body: Body = new Body(humanoid(PERSON), { dev: true, drive: scripted({ pace: 1.3, start: 1, brake }, () => body) }); return body; };
const horseOn = (gait: 'walk' | 'trot', route: Route) => { const body: Body = new Body(horse(HORSE, gait), { dev: true, drive: scripted(route, () => body) }); return body; };
/**
 * Open: a person's leg joints at 1.3 m/s reach a p99 of ~610 °/s (~600 stopping hard) against a ceiling of 500 (the gait's swing is
 * 0.355 s of a 0.935 s stride, shorter than a person's ~0.4 s of ~1.05 s): a gait to tune, not a ceiling to raise.
 */
const test = cases(['a person walking', 'a person stopping hard']
  .map((name) => `${name}: soles on the floor, planted pivots, frozen landings, joints in range and no faster than a snap`));
for (const [name, make] of [['a person walking', () => person(3)], ['a person stopping hard', () => person(0.5)], ['a horse walking', () => horseOn('walk', { pace: 1.6 })],
  ['a horse trotting, braking in 2 s', () => horseOn('trot', { pace: 3.7 })], ['a horse trotting, braking in 3 s', () => horseOn('trot', { pace: 3.7, brake: 3 })],
  ['a horse walking a 3 m turn', () => horseOn('walk', { pace: 1.6, radius: 3 })]] as const) {
  test(`${name}: soles on the floor, planted pivots, frozen landings, joints in range and no faster than a snap`, () => {
    const body = make(), chains = body.species.legs?.chains, proportions = body.species.person;
    const sole = (leg: number) => proportions ? solePoints(proportions, body.pose, leg ? 'right' : 'left')
      : [chains![leg].heel, chains![leg].toe].map((at) => body.pose.point(chains![leg].joints[chains![leg].joints.length - 1].bone, at, new Vector3()));
    const bones = (leg: number) => proportions ? (['UpperLeg', 'LowerLeg', 'Foot'] as const).map((part) => INDEX[`${leg ? 'right' : 'left'}${part}`]) : chains![leg].joints.map((joint) => joint.bone);
    let ground = 0, pivot = 0, outOfRange = 0, drift = 0;
    const landings: number[] = [], speeds: number[] = [], was = body.pose.skeleton.bones.map(() => new Quaternion());
    const before: { sole: Vector3[]; swing: boolean; anchor: Vector3 }[] = [];
    for (let tick = 0; tick < 16 * 60; tick++) {
      body.pose.skeleton.bones.forEach((_, bone) => was[bone].copy(body.pose.local(bone)));
      body.update(1 / 60);
      legsOf(body).forEach((leg, i) => {
        const points = sole(i), last = before[i];
        ground = Math.max(ground, ...points.map((point) => -point.y));
        if (last && !leg.swing && !last.swing) pivot = Math.max(pivot, Math.min(...points.map((point, k) => point.distanceTo(last.sole[k]))));
        if (last?.swing && leg.swing && leg.swing.u > 0.55) drift = Math.max(drift, leg.anchor.distanceTo(last.anchor));
        if (last?.swing && !leg.swing) landings.push(i);
        for (const bone of bones(i)) {
          const limit = body.pose.skeleton.limits[bone], turn = new Quaternion().copy(body.pose.local(bone)), kept = turn.clone();
          if (limit) { clampRotation(kept, limit); outOfRange = Math.max(outOfRange, turn.angleTo(kept)); }
          if (tick > 0) speeds.push(was[bone].angleTo(body.pose.local(bone)) * 60 * 180 / Math.PI);
        }
        before[i] = { sole: points, swing: !!leg.swing, anchor: leg.anchor.clone() };
      });
    }
    speeds.sort((a, b) => a - b);
    expect(ground).toBeLessThan(1e-5);
    // (a person's planted foot stays put; a hoof pivots in place as the body turns — the user's decision, 2026-10-20 — by under a mm a sub-step)
    expect(pivot).toBeLessThan(proportions ? 1e-5 : 1e-3);
    expect(drift).toBe(0);
    expect(outOfRange).toBeLessThan(1e-6);
    expect(landings.length).toBeGreaterThan(10);
    expect(legsOf(body).every((leg) => !leg.swing)).toBe(true);
    expect(speeds[Math.floor(speeds.length * 0.99)]).toBeLessThan(proportions ? 500 : 800);
    expect(body.log).toEqual([]);
    // (Hildebrand's lateral sequence: left hind, left fore, right hind, right fore — the chains fore-left, fore-right, hind-left, hind-right)
    if (name === 'a horse walking') {
      const order = [2, 0, 3, 1], steady = landings.slice(4);
      for (let k = 1; k < steady.length; k++) expect(steady[k]).toBe(order[(order.indexOf(steady[k - 1]) + 1) % 4]);
    }
  }, 30_000);
}

// (the planner foresees its root and keeps to what the legs can follow: a horse walking a 2 m circle at 1.6 m/s after a carrot never
// outruns its legs)
it('a horse walks a 2 m circle at 1.6 m/s after a carrot, its legs keeping up, its log empty', () => {
  const radius = 2, centre = new Vector3(radius, 0, 0);
  const mare = new Body(horse(HORSE), { dev: true });
  const angleOf = (at: Vector3) => Math.atan2(at.z - centre.z, at.x - centre.x);
  let swept = 0, last = Math.PI, lag = 0, circled = false;
  const carrot = () => {
    const angle = angleOf(mare.position) + 1.2 / radius;
    return new Vector3(centre.x + radius * Math.cos(angle), 0, centre.z + radius * Math.sin(angle));
  };
  const once = () => {
    const angle = angleOf(mare.position);
    swept += Math.abs(Math.atan2(Math.sin(angle - last), Math.cos(angle - last)));
    last = angle;
    return swept > 2 * Math.PI;
  };
  play(function* () { circled = yield* walkTo(mare, carrot, { speed: 1.6, accel: 1.2, until: once }); }, [mare], 40, () => {
    lag = Math.max(lag, Math.abs(mare.position.distanceTo(centre) - radius));
    return circled;
  });
  expect(circled).toBe(true);
  expect(lag).toBeLessThan(0.5 * radius);
  expect(mare.log).toEqual([]);
}, 30_000);
