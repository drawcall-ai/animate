import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { course, still, type Waypoint } from '../../src/kernel/course';
import { STEP, type Frame } from '../../src/kernel/frame';
import { Pose } from '../../src/kernel/pose';
import { leg } from './rigs';


/** a frame at each sub-step from 1/60 s on, for what reads only its time */
function frames(): (time: number) => Frame {
  const pose = new Pose(leg());
  return (time) => ({ dt: STEP, time, prev2: pose, prev: pose, current: pose });
}

/** where a thing carried along `waypoints` from the origin is at each sub-step, and when its course is over */
function sampled(waypoints: Waypoint[], seconds: number) {
  const thing = { current: { position: new Vector3(), quaternion: new Quaternion() } };
  const made = course(thing, waypoints), at = frames();
  const path: { t: number; position: Vector3; quaternion: Quaternion; over: boolean }[] = [];
  for (let k = 1; k <= Math.round(seconds / STEP); k++) {
    const f = at(k * STEP);
    path.push({ t: f.time - STEP, ...made.to(f), over: made.over(f) });
  }
  const speeds = path.slice(1).map((p, i) => p.position.distanceTo(path[i].position) / STEP);
  return { path, speeds };
}

const place = (x: number, y: number, z: number, quaternion?: Quaternion) => ({ position: new Vector3(x, y, z), quaternion });

describe('course', () => {
  it('passes its placements without stopping, smoothly, coming to rest only at its end', () => {
    const { path, speeds } = sampled([[0.6, place(0.3, 0.1, 0)], [0.6, place(0.4, 0.4, 0.1)], [0.6, place(0.2, 0.6, 0.3)]], 2.2);
    // (through each placement: within a few mm of it at some sub-step)
    for (const via of [place(0.3, 0.1, 0), place(0.4, 0.4, 0.1)]) expect(Math.min(...path.map((p) => p.position.distanceTo(via.position)))).toBeLessThan(0.01);
    // (never slowing on the way: one bell, its speed rising to a single peak and falling from it)
    const peak = speeds.indexOf(Math.max(...speeds));
    expect(speeds.slice(1, peak + 1).every((v, i) => v >= speeds[i] - 1e-9)).toBe(true);
    expect(speeds.slice(peak + 1).every((v, i) => v <= speeds[peak + i] + 1e-9)).toBe(true);
    // (no kinks: its speed changes by little from one sub-step to the next)
    const changes = speeds.slice(1).map((v, i) => Math.abs(v - speeds[i]));
    expect(Math.max(...changes)).toBeLessThan(0.1 * Math.max(...speeds));
    // (at rest at both ends, and there at the end)
    expect(speeds[0]).toBeLessThan(0.01);
    expect(speeds[speeds.length - 1]).toBeLessThan(1e-6);
    expect(path[path.length - 1].position.distanceTo(new Vector3(0.2, 0.6, 0.3))).toBeLessThan(1e-6);
    expect(path.find((p) => p.over)?.t).toBeCloseTo(1.8, 1);
  });

  it('turns what it carries along the same curve, through each placement turned as it says', () => {
    const half = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1);
    const full = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2);
    const { path } = sampled([[0.5, place(0.2, 0, 0, half)], [0.5, place(0.4, 0, 0, full)]], 1.2);
    expect(Math.min(...path.map((p) => p.quaternion.angleTo(half) + p.position.distanceTo(new Vector3(0.2, 0, 0))))).toBeLessThan(0.02);
    expect(path[path.length - 1].quaternion.angleTo(full)).toBeLessThan(1e-6);
    const spins = path.slice(1).map((p, i) => p.quaternion.angleTo(path[i].quaternion) / STEP);
    expect(Math.max(...spins.slice(1).map((w, i) => Math.abs(w - spins[i])))).toBeLessThan(0.1 * Math.max(...spins));
  });

  it('stops where it holds still or turns back on itself, and sets off again', () => {
    const { path, speeds } = sampled([[0.5, place(0.3, 0, 0)], [0.4, still], [0.5, place(0.1, 0, 0)], [0.5, place(0.4, 0, 0)]], 2.1);
    const near = (t: number) => speeds[path.findIndex((p) => p.t >= t) - 1];
    // (still through the hold, and stopped at the turn back at 1.4 s)
    expect(Math.max(near(0.55), near(0.7), near(0.85))).toBeLessThan(1e-6);
    expect(near(1.4)).toBeLessThan(0.02);
    expect(path.find((p) => Math.abs(p.t - 1.4) < STEP / 2)?.position.x).toBeCloseTo(0.1, 2);
  });

  it('keeps insertion on a moving and turning approach axis', () => {
    const on = (f: Frame) => ({ position: new Vector3(f.time, 0, 0),
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), f.time / 2) });
    const thing = { current: { position: new Vector3(0, 1, 0), quaternion: new Quaternion() } };
    const path = course(thing, [[1, on]], { on }), at = frames();
    for (let k = 0; k <= 60; k++) {
      const f = at(k * STEP), anchor = on(f), goal = path.to(f);
      const local = goal.position.sub(anchor.position).applyQuaternion(anchor.quaternion.clone().invert());
      expect(Math.hypot(local.x, local.z)).toBeLessThan(1e-9);
      expect(local.y).toBeGreaterThanOrEqual(-1e-9);
      expect(local.y).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(path.to(at(1)).position.distanceTo(on(at(1)).position)).toBeLessThan(1e-9);
  });

  it('reads a live endpoint throughout its travel and after it is over', () => {
    const thing = { current: { position: new Vector3(), quaternion: new Quaternion() } };
    let reads = 0;
    const made = course(thing, [[1, (f) => { reads++; return { position: new Vector3(f.time, 0, 0) }; }]]), at = frames();
    for (let k = 1; k <= 120; k++) {
      const f = at(k * STEP), placed = made.to(f);
      if (f.time > 1.1) expect(placed.position.x).toBeCloseTo(f.time, 8);
    }
    expect(reads).toBe(120);
    expect(made.over(at(2))).toBe(true);
  });
});
