import { humanGait, humanLegs } from '../../packages/animate/src/humanoid/legs';
import { HORSE_TROT } from '../../packages/animate/src/horse/legs';
import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, horse as horseSpecies, Humanoid, Legs, Pose, type Frame, type Gait, type LegStep } from '@drawcall/animate';
import { HORSE_WALK, horseLegs } from '../../packages/animate/src/horse/legs';
import { beyond } from '../../packages/animate/src/core/limits';
import { createOpenPoseModel } from '../src/openpose';
import { Playback } from '../src/playback';
import { Simulation } from '../src/simulation';
import { bipedRoot, legsBiped, legsHorse, scriptedRoot } from '../src/scenarios/legs';

const HORSE = horseSpecies().skeleton;

function human(brake = 3, pace = 1.3, supported = false) {
  let engine: Legs | undefined;
  let move: ReturnType<typeof supportRoute> | null = null;
  const body = new Humanoid(createOpenPoseModel(), (h) => function* () {
    const route = bipedRoot(h.pose, h.proportions.scale, brake, pace);
    engine = new Legs(h.pose, humanLegs(h.proportions), humanGait(h.proportions));
    move = supported ? supportRoute(engine, route) : null;
    yield* action<Frame>({ update: (f) => {
      if (move) return move.update(f);
      const at = route.at(f.time);
      f.current.setRoot(at.position);
      f.current.setLocal(0, at.quaternion);
      engine?.update(f, { root: route.at, speed: route.speed });
    } });
  }, { dev: true });
  return { body, motion: () => move, engine: () => { if (!engine) throw new Error('human has not stepped'); return engine; } };
}

function horse(gait: Gait, pace: number, brake = 2, radius = 15, supported = false) {
  const pose = new Pose(HORSE);
  const route = scriptedRoot(1.32, pace, new Vector3(), 0, 0, brake, radius);
  pose.setRoot(route.at(0).position);
  const engine = new Legs(pose, horseLegs(), gait);
  const move = supported ? supportRoute(engine, route) : null;
  const body = new Body(horseSpecies(), () => action<Frame>({ update: (f) => {
    if (move) return move.update(f);
    const at = route.at(f.time);
    f.current.setRoot(at.position);
    f.current.setLocal(0, at.quaternion);
    engine.update(f, { root: route.at, speed: route.speed });
  } }), { pose, dev: true });
  return { body, motion: () => move, engine: () => engine };
}

// The caller adjusts height and, for tight turns, traversal speed in the same root forecast.
function supportRoute(engine: Legs, route: ReturnType<typeof scriptedRoot>) {
  let drop = 0.04;
  let time = 1 / 60;
  let rate = 1;
  let peak = 0;
  let rejected = 0;
  return {
    get time() { return time; },
    get rate() { return rate; },
    get peak() { return peak; },
    get rejected() { return rejected; },
    update(f: Frame) {
      const atTime = (t: number) => time + rate * (t - f.time);
      const step: LegStep = { speed: (t) => rate * route.speed(atTime(t)), root: (t) => {
        const at = route.at(atTime(t));
        at.position.y -= drop;
        return at;
      } };
      const states = JSON.stringify(engine.legs);
      const events = JSON.stringify(engine.events);
      const root = f.current.position(0).clone();
      const previous = drop;
      let found = engine.supports(f, step);
      if (!found) rejected++;
      for (let offset = 0.002; !found && offset <= 0.2; offset += 0.002) {
        for (const direction of [1, -1]) {
          drop = previous + direction * offset;
          if (!engine.supports(f, step)) continue;
          found = true;
          break;
        }
      }
      if (!found) drop = previous;
      while (!engine.supports(f, step)) {
        rate *= 0.9;
        if (rate < 0.1) throw new Error(`no supported root at ${f.time}`);
      }
      expect(JSON.stringify(engine.legs)).toBe(states);
      expect(JSON.stringify(engine.events)).toBe(events);
      expect(f.current.position(0).equals(root)).toBe(true);
      const at = step.root(f.time);
      f.current.setRoot(at.position);
      f.current.setLocal(0, at.quaternion);
      engine.update(f, step);
      peak = Math.max(peak, rate * route.speed(time));
      time += rate * f.dt;
    },
  };
}

for (const [name, make] of [['human', human], ['horse walk', () => horse(HORSE_WALK, 1.6)], ['horse trot 2s brake', () => horse(HORSE_TROT, 3.7)], ['horse trot 3s brake', () => horse(HORSE_TROT, 3.7, 3)], ['horse walk 3m turn', () => horse(HORSE_WALK, 1.6, 2, 3)], ['human hard stop', () => human(0.5)]] as const) {
  it(`${name}: held contacts, committed landings, ROM and joint speeds on final poses`, () => {
    const { body, engine: read } = make();
    const chains = body instanceof Humanoid ? humanLegs(body.proportions) : horseLegs();
    const committed = new Map<number, { position: Vector3; yaw: number }>();
    const landings: number[] = [];
    const speeds = new Map<string, number[]>();
    let previous = new Pose(body.pose.skeleton).copy(body.pose);
    let contact = 0;
    let ground = 0;
    let stancePeak = 0;
    let rom = 0;
    let drift = 0;
    const peaks = new Map<string, {speed: number; time: number; planted: boolean}>();
    const up = new Vector3(0, 1, 0);
    for (let tick = 0; tick < 16 * 60; tick++) {
      body.update(1 / 60);
      const engine = read();
      for (const event of engine.events) {
        if (event.type === 'lift') committed.set(event.leg, event.foothold);
        else {
          const to = committed.get(event.leg);
          if (!to) throw new Error('landing without a lift');
          drift = Math.max(drift, event.foothold.position.distanceTo(to.position), Math.abs(event.foothold.yaw - to.yaw));
          landings.push(event.leg);
          committed.delete(event.leg);
        }
      }
      engine.legs.forEach((state, i) => {
        const leg = chains[i];
        const terminal = leg.joints[leg.joints.length - 1].bone;
        const points = [body.pose.point(terminal, leg.heel, new Vector3()), body.pose.point(terminal, leg.toe, new Vector3())];
        if (leg.toes) points.push(body.pose.point(leg.toes.bone, leg.toes.tip, new Vector3()));
        ground = Math.max(ground, ...points.map((p) => -p.y));
        if (!state.planted) {
          const to = committed.get(i);
          if (!to) throw new Error('swing without committed foothold');
          drift = Math.max(drift, to.position.distanceTo(state.foothold.position));
        } else {
          // Whichever end is on the ground is pinned to its original flat-foot position.
          const heel = body.pose.point(terminal, leg.heel, new Vector3());
          const toe = body.pose.point(terminal, leg.toe, new Vector3());
          const pivot = heel.y <= toe.y ? leg.heel : leg.toe;
          const actual = body.pose.point(terminal, pivot, new Vector3());
          const target = pivot.clone().applyAxisAngle(up, state.foothold.yaw).add(state.foothold.position);
          const miss = actual.distanceTo(target);
          contact = Math.max(contact, miss);
        }
        for (const { bone } of leg.joints) {
          const limit = body.pose.skeleton.limits[bone];
          if (limit) rom = Math.max(rom, beyond(new Quaternion().copy(body.pose.local(bone)), limit));
          const joint = body.pose.skeleton.bones[bone].name;
          const v = new Quaternion().copy(previous.local(bone)).angleTo(body.pose.local(bone)) * 60 * 180 / Math.PI;
          if (tick > 0 && v > (peaks.get(joint)?.speed ?? 0)) peaks.set(joint, { speed: v, time: tick / 60, planted: state.planted });
          if (tick > 0 && state.planted) stancePeak = Math.max(stancePeak, v);
          const samples = speeds.get(joint) ?? [];
          if (tick > 0) samples.push(v);
          speeds.set(joint, samples);
        }
      });
      previous.copy(body.pose);
    }
    const report = [...speeds].map(([joint, samples]) => {
      samples.sort((a, b) => a - b);
      return { joint, p99: samples[Math.floor(samples.length * 0.99)], peak: Math.max(...samples), at: peaks.get(joint) };
    });
    console.log(name, JSON.stringify({ contactMM: contact * 1000, groundMM: ground * 1000, stancePeak, romDegrees: rom * 180 / Math.PI, footholdDrift: drift, footfalls: landings.slice(0, 20), joints: report }));
    expect(contact).toBeLessThan(1e-5);
    expect(ground).toBeLessThan(1e-5);
    expect(drift).toBe(0);
    expect(rom).toBeLessThan(1e-6);
    expect(landings.length).toBeGreaterThan(10);
    expect(committed.size).toBe(0);
    // Regression ceilings, diagnostic only: broad enough for startup, strict enough to catch snaps.
    expect(Math.max(...report.map((r) => r.p99))).toBeLessThan(name.startsWith('human') ? 500 : 800);
    expect(body.log).toEqual([]);
    if (name === 'horse walk') {
      // Hildebrand lateral sequence: LH, LF, RH, RF, cyclically.
      const order = [2, 0, 3, 1];
      const steady = landings.slice(4);
      for (let k = 1; k < steady.length; k++) expect(steady[k]).toBe(order[(order.indexOf(steady[k - 1]) + 1) % 4]);
    }
  });
}

it('shows a generic body without assuming a humanoid cast', () => {
  const playback = new Playback(new Simulation(legsHorse()));
  playback.advanceTo(4);
  const shown = playback.blend(0.5);
  expect(shown.props.length).toBeGreaterThan(0);
  expect(Number.isFinite(shown.root.z + playback.facing + playback.velocity.length())).toBe(true);
  expect(playback.sim.stage.bodies?.every((b) => b.frame.dev === undefined)).toBe(true);
});

it('legs-biped playback leads along the scripted travel and turn without writing gait', () => {
  const playback = new Playback(new Simulation(legsBiped()));
  playback.advanceTo(8);
  expect(playback.velocity.length()).toBeGreaterThan(1);
  expect(playback.facing).toBeGreaterThan(0.1);
  expect(playback.facing).toBeCloseTo(playback.sim.actors[0].yaw, 10);
  expect(playback.sim.actors[0].locomotion.velocity.length()).toBe(0);
  expect(playback.sim.actors[0].locomotion.facing).toBe(0);
});

for (const [name, make] of [
  ['biped 1.6m/s acceleration', () => human(3, 1.6, true)],
  ['biped 1.8m/s braked in 1s', () => human(1, 1.8, true)],
  ['horse walk R=2m turn', () => horse(HORSE_WALK, 1.6, 2, 2, true)],
] as const) {
  it(`${name}: caller preflights its root and never trips the stance guard`, () => {
    const { body, engine, motion } = make();
    const duration = name.startsWith('biped') ? 16 : 32;
    for (let tick = 0; tick < duration * 60; tick++) body.update(1 / 60);
    const travelled = motion();
    if (!travelled) throw new Error('missing preflight caller');
    expect(travelled.time).toBeGreaterThan(16);
    expect(travelled.rejected).toBeGreaterThan(0);
    expect(travelled.peak).toBeCloseTo(name.includes('1.8m/s') ? 1.8 : 1.6, 5);
    if (name.startsWith('biped')) expect(travelled.rate).toBe(1);
    expect(engine().legs.every((leg) => leg.planted)).toBe(true);
  }, 15000);
}
