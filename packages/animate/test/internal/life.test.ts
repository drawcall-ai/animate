import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { grab, walkTo } from '../../src/index';
import { QuietStance } from '../../src/person/legs/quiet-stance';
import { INDEX, person, play, run, type Side } from '../kit/bodies';
import { box, roomOf } from '../kit/things';
import { insides } from './insides';

const pitchOf = (rotation: Quaternion) => new Euler().setFromQuaternion(rotation, 'YXZ').x;

it('stands alive, deterministically: breathing, millimetre sway and a weight shift within 25 s', () => {
  const sample = () => {
    const body = person({ dev: true }), h = insides(body);
    const x: number[] = [], pitch: number[] = [];
    run(body, 25, () => {
      x.push(h.pose.com(new Vector3()).x);
      pitch.push(pitchOf(h.pose.rotation(INDEX.chest)));
    });
    const sign = Math.sign(h.trunk!.quiet.x);
    expect(Math.abs(h.trunk!.quiet.x)).toBeGreaterThan(0.04);
    const loaded = sign > 0 ? 'left' : 'right', unloaded = sign > 0 ? 'right' : 'left';
    const hip = (side: Side) => h.pose.position(INDEX[`${side}UpperLeg`]).y;
    const knee = (side: Side) => h.pose.local(INDEX[`${side}LowerLeg`]).angleTo(new Quaternion());
    expect(hip(unloaded)).toBeLessThan(hip(loaded) - 0.005);
    expect(knee(unloaded)).toBeGreaterThan(0.2);
    expect(knee(unloaded)).toBeGreaterThan(knee(loaded));
    run(body, 3);
    expect(h.trunk!.quiet.x * sign).toBeGreaterThan(0.04);
    expect(body.log).toEqual([]);
    return { x, pitch };
  };
  const a = sample(), b = sample();
  expect(a).toEqual(b);
  expect(Math.max(...a.x.slice(0, 600)) - Math.min(...a.x.slice(0, 600))).toBeGreaterThan(0.003);
  expect(Math.max(...a.x) - Math.min(...a.x)).toBeGreaterThan(0.04);
  expect(Math.max(...a.pitch.slice(120, 600)) - Math.min(...a.pitch.slice(120, 600))).toBeGreaterThan(0.02);
});

it('slows its walk under a load, counting a load held in both hands once', () => {
  const pace = (mass: number, both: boolean) => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 1, 0.4), { mass, solid: false });
    let speed = 0;
    play(function* () {
      yield* grab(body, load, both ? { left: 'left', right: 'right' } : { right: 'right' });
      yield* walkTo(body, new Vector3(0, 0, 3), { until: 0.3 });
    }, [body], 4, () => {
      if (h.asks.legGoal && body.owners.legs?.verb === 'walkTo') speed = h.asks.legGoal.speed;
    });
    expect(body.log).toEqual([]);
    return speed;
  };
  const light = pace(0, false), heavy = pace(5, false);
  expect(heavy).toBeGreaterThan(0);
  expect(heavy).toBeLessThan(light);
  expect(pace(5, true)).toBeCloseTo(heavy, 8);
});

it('keeps its sway and breathing after a loaded walk, without spontaneous weight shifts', () => {
  const body = person({ dev: true }), h = insides(body), room = roomOf(body);
  const load = box(room, new Vector3(-0.15, 1.05, 0.35), { mass: 5, solid: false });
  play(function* () {
    yield* grab(body, load, { right: 'right' });
    yield* walkTo(body, new Vector3(0, 0, 2));
  }, [body], 8);
  const sway: number[] = [], breath: number[] = [];
  run(body, 15, () => {
    sway.push(h.pose.com(new Vector3()).x);
    breath.push(pitchOf(h.pose.rotation(INDEX.chest)));
    expect(h.trunk!.quiet.length()).toBeLessThan(0.02);
  });
  expect(body.holds(load)).toBe(true);
  expect(Math.max(...sway) - Math.min(...sway)).toBeGreaterThan(0.004);
  expect(Math.max(...breath) - Math.min(...breath)).toBeGreaterThan(0.02);
  expect(body.log).toEqual([]);
});

it('seeds the side of its first weight shift and alternates the later ones, after activity too', () => {
  for (const seed of [0, 1, 42]) {
    const life = new QuietStance(seed);
    const shifts: Side[] = [];
    let previous: Side | null = null;
    for (let step = 0; step < 6000; step++) {
      life.update(0.1, step < 2000 || step >= 2100, 0, 0);
      if (life.onto && life.onto !== previous) shifts.push(life.onto);
      previous = life.onto;
    }
    expect(shifts.length).toBeGreaterThan(8);
    expect(shifts.every((side, i) => i === 0 || side !== shifts[i - 1])).toBe(true);
  }
});

