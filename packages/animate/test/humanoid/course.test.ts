import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action } from '@pmndrs/timeline';
import { Body, Item, still, type Frame, type Waypoint } from '../../src';
import { course } from '../../src/humanoid/course';
import { STEP } from '../../src/core/body';
import { leg } from '../core/rigs';

const WORLD = { position: new Vector3(), quaternion: new Quaternion() };

/** where an item carried along `waypoints` from the origin is at each sub-step, and when its course is over */
function sampled(waypoints: Waypoint[], seconds: number) {
  const item = new Item(new Vector3(), new Quaternion(), {});
  const c = course(item, WORLD, waypoints);
  const path: { t: number; position: Vector3; quaternion: Quaternion; over: boolean }[] = [];
  const body = new Body({ skeleton: leg() }, function* () {
    yield* action<Frame>({ update: (f) => void path.push({ t: f.time - STEP, ...c.to(f), over: c.over(f) }) });
  });
  for (let k = 0; k < seconds / STEP; k++) body.update(STEP);
  const speeds = path.slice(1).map((p, i) => p.position.distanceTo(path[i].position) / STEP);
  return { path, speeds };
}

const at = (x: number, y: number, z: number, quaternion?: Quaternion) => ({ position: new Vector3(x, y, z), quaternion });

describe('course', () => {
  it('passes its placements without stopping, smoothly, coming to rest only at its end', () => {
    const { path, speeds } = sampled([[0.6, at(0.3, 0.1, 0)], [0.6, at(0.4, 0.4, 0.1)], [0.6, at(0.2, 0.6, 0.3)]], 2.2);
    // (through each placement: within a few mm of it at some sub-step)
    for (const via of [at(0.3, 0.1, 0), at(0.4, 0.4, 0.1)]) expect(Math.min(...path.map((p) => p.position.distanceTo(via.position)))).toBeLessThan(0.01);
    // (never slowing on the way: one bell, its speed rising to a single peak and falling from it)
    const peak = speeds.indexOf(Math.max(...speeds));
    expect(speeds.slice(1, peak + 1).every((v, i) => v >= speeds[i] - 1e-9)).toBe(true);
    expect(speeds.slice(peak + 1).every((v, i) => v <= speeds[peak + i] + 1e-9)).toBe(true);
    // (no kinks: its speed changes by little from one sub-step to the next)
    const steps = speeds.slice(1).map((v, i) => Math.abs(v - speeds[i]));
    expect(Math.max(...steps)).toBeLessThan(0.1 * Math.max(...speeds));
    // (at rest at both ends, and there at the end)
    expect(speeds[0]).toBeLessThan(0.01);
    expect(speeds[speeds.length - 1]).toBeLessThan(1e-6);
    expect(path[path.length - 1].position.distanceTo(new Vector3(0.2, 0.6, 0.3))).toBeLessThan(1e-6);
    expect(path.find((p) => p.over)?.t).toBeCloseTo(1.8, 1);
  });

  it('turns what it carries along the same curve, through each placement turned as it says', () => {
    const half = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1);
    const full = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2);
    const { path } = sampled([[0.5, at(0.2, 0, 0, half)], [0.5, at(0.4, 0, 0, full)]], 1.2);
    expect(Math.min(...path.map((p) => p.quaternion.angleTo(half) + p.position.distanceTo(new Vector3(0.2, 0, 0))))).toBeLessThan(0.02);
    expect(path[path.length - 1].quaternion.angleTo(full)).toBeLessThan(1e-6);
    const spins = path.slice(1).map((p, i) => p.quaternion.angleTo(path[i].quaternion) / STEP);
    expect(Math.max(...spins.slice(1).map((w, i) => Math.abs(w - spins[i])))).toBeLessThan(0.1 * Math.max(...spins));
  });

  it('stops where it holds still or turns back on itself, and sets off again', () => {
    const { path, speeds } = sampled([[0.5, at(0.3, 0, 0)], [0.4, still], [0.5, at(0.1, 0, 0)], [0.5, at(0.4, 0, 0)]], 2.1);
    const near = (t: number) => speeds[path.findIndex((p) => p.t >= t) - 1];
    // (still through the hold, and stopped at the turn back at 1.4 s)
    expect(Math.max(near(0.55), near(0.7), near(0.85))).toBeLessThan(1e-6);
    expect(near(1.4)).toBeLessThan(0.02);
    expect(path.find((p) => Math.abs(p.t - 1.4) < STEP / 2)?.position.x).toBeCloseTo(0.1, 2);
  });
});

it('reads a live course endpoint throughout travel and after arrival', () => {
  const item = new Item(new Vector3(), new Quaternion(), {});
  let reads = 0;
  const c = course(item, WORLD, [[1, (f) => { reads++; return { position: new Vector3(f.time, 0, 0) }; }]]);
  const body = new Body({ skeleton: leg() }, () => action<Frame>({ update: (f) => {
    const at = c.to(f);
    if (f.time > 1.1) expect(at.position.x).toBeCloseTo(f.time, 8);
  } }));
  for (let tick = 0; tick < 120; tick++) body.update(STEP);
  expect(reads).toBe(120);
  expect(c.over(body.frame)).toBe(true);
});
