import { Quaternion, Vector3 } from 'three';
import { Carrier } from '../../src/core/carrier';
import { describe, expect, it } from 'vitest';
import { Body, species } from '../../src';
import { selfOf } from '../../src/body/body';
import { TrackedRotation } from '../../src/core/track';
import { looking, SHIFT } from '../../src/core/gaze';
import { spinOf } from '../../src/core/rotation';
import { ChainTip, reached } from '../../src/core/tip';
import type { ReadonlyPose } from '../../src/core/pose';
import { claim, dt } from '../bodies';
import { turn } from './rigs';

/** a free root at (0, 1, 0) with a leg hanging down −y: a ball-jointed thigh, a knee bending back (+x), a foot */
const LEG = [
  { name: 'pelvis', position: [0, 1, 0] }, { name: 'thigh', parent: 'pelvis', position: [0.1, 1, 0] },
  { name: 'shin', parent: 'thigh', position: [0.1, 0.55, 0] }, { name: 'foot', parent: 'shin', position: [0.1, 0.15, 0] },
] as const;
const leg = () => new Body(species(LEG, { hands: { leg: ['thigh', 'shin', 'foot'] } }, { masses: { pelvis: 1, thigh: 1, shin: 1, foot: 1 } }));

/** a chest and a neck carrying a head, its eyes 5 cm up and 8 cm ahead of the head bone */
const NECK = [
  { name: 'chest', position: [0, 1.4, 0] }, { name: 'neck', parent: 'chest', position: [0, 1.5, 0] }, { name: 'head', parent: 'neck', position: [0, 1.6, 0] },
] as const;
const GAZE = { neck: ['neck', 'head'], eyes: { bone: 'head', at: [0, 0.05, 0.08] }, range: { down: 0.5, up: 0.35, side: 0.35 } } as const;
const gazing = () => new Body(species(NECK, { gaze: GAZE }, { masses: { chest: 1, neck: 1, head: 1 } }));
const eyesOf = (body: Body) => body.pose.point(2, new Vector3(0, 0.05, 0.08), new Vector3());

describe('chainTo', () => {
  it("moves a chain's tip on to its target, its joints braked to `turnAccel`, and gets there", () => {
    const goal = new Vector3(0.25, 0.35, 0.3), body = leg(), tip = new ChainTip('leg');
    let ended = -1;
    claim(body, 'hand.leg', (f) => {
      if (ended < 0 && f.time > f.dt && reached(f, 3, { position: goal })) ended = f.time;
      tip.to(f, { position: goal }, { accel: 6, speed: 1, turnAccel: 40, pole: new Vector3(0.1, 0.6, 2) });
    });
    const knee: Quaternion[] = [];
    for (let k = 0; k < 240 && ended < 0; k++) {
      body.update(dt);
      knee.push(body.pose.local(2).clone());
    }
    expect(ended).toBeGreaterThan(0);
    expect(body.pose.position(3).distanceTo(goal)).toBeLessThan(0.01);
    const spins = knee.slice(1).map((q, k) => spinOf(knee[k], q, dt, new Vector3()));
    expect(Math.max(...spins.slice(1).map((w, k) => w.distanceTo(spins[k]) / dt))).toBeLessThan(40 + 1e-6);
  });

  it('keeps its intended path when a moving base brings an unreachable goal into reach', () => {
    const ease = (t: number) => {
      const u = Math.max(0, Math.min(1, t));
      return u ** 3 * (10 - 15 * u + 6 * u * u);
    };
    const body = leg(), tip = new ChainTip('leg');
    claim(body, 'go', (f) => f.current.setRoot(new Vector3(0, 1.4 - ease((f.time - 1) * 2), 0)));
    claim(body, 'hand.leg', (f) => {
      const u = Math.max(0, Math.min(1, f.time - 1));
      tip.to(f, { position: new Vector3(0.1, 0.1 + 0.6 * ease(u), 0.5), velocity: new Vector3(0, 18 * u * u * (1 - u) ** 2, 0) }, { accel: 8, speed: 2 });
    });
    for (let k = 0; k < 90; k++) body.update(dt);
    expect(body.pose.position(3).distanceTo(new Vector3(0.1, 0.4, 0.5))).toBeLessThan(0.01);
  });
});

describe('TrackedRotation', () => {
  it('holds a joint to its acceleration where its goal jumps, and follows a goal moving smoothly without lag', () => {
    const joint = new TrackedRotation();
    let goal = (t: number) => turn(1, 0, 0, Math.sin(2 * t));
    const body = leg();
    claim(body, 'hand.leg', (f) => void f.current.setLocal(2, joint.follow(f.prev2.local(2), f.prev.local(2), goal(f.time), { accel: 30, speed: 8 }, f.dt, new Quaternion())));
    for (let k = 0; k < 120; k++) body.update(dt);
    expect(body.pose.local(2).angleTo(goal(selfOf(body).frame.time))).toBeLessThan(1e-3);
    goal = () => turn(1, 0, 0, 2);
    const turns: number[] = [];
    let last = body.pose.local(2).clone();
    for (let k = 0; k < 30; k++) {
      body.update(dt);
      turns.push(body.pose.local(2).angleTo(last) / dt);
      last = body.pose.local(2).clone();
    }
    expect(Math.max(...turns.slice(1).map((w, k) => Math.abs(w - turns[k]) / dt))).toBeLessThan(30 + 1);
  });
});

describe('looking', () => {
  it("turns a gazer's head, upright, until its eyes are on the point: the head most of the way, the eyes the rest (a few degrees)", () => {
    const point = new Vector3(2, 1.2, 1), body = gazing();
    claim(body, 'look', looking(selfOf(body), () => point));
    for (let k = 0; k < 120; k++) body.update(dt);
    const head = body.pose.rotation(2);
    const forward = new Vector3(0, 0, 1).applyQuaternion(head);
    const eyes = eyesOf(body);
    // (the eyes take a quarter of the turn, at most 0.3 of their range to the side or up: 0.105 rad)
    const off = forward.angleTo(point.clone().sub(eyes));
    expect(off).toBeGreaterThan(0.08);
    expect(off).toBeLessThan(0.3 * 0.35 + 0.01);
    expect(new Vector3(1, 0, 0).applyQuaternion(head).y).toBeCloseTo(0, 6);
  });

  it('looks down past straight down at a point below and a little behind, rather than turning round', () => {
    const point = new Vector3(0.05, 0, -0.3), body = gazing();
    claim(body, 'look', looking(selfOf(body), () => point));
    for (let k = 0; k < 120; k++) body.update(dt);
    // (still facing the way the chest does, not turned half round)
    expect(new Vector3(1, 0, 0).applyQuaternion(body.pose.rotation(2)).x).toBeGreaterThan(0.9);
  });

  it('keeps one way of looking at a point nearly straight below, the chest bowed and swaying under it', () => {
    // (a hilt at the left hip, seen from above: down, a little left and ahead)
    const point = new Vector3(0.17, 0.95, 0.2);
    const sway = (t: number) => turn(0, 1, 0, 0.04 * Math.sin(2 * Math.PI * 3 * t)).multiply(turn(1, 0, 0, 0.4));
    const body = gazing();
    claim(body, 'go', (f) => void f.current.setLocal(0, sway(f.time)));
    claim(body, 'look', looking(selfOf(body), () => point));
    const heads: Quaternion[] = [];
    let missed = 0;
    for (let k = 0; k < 120; k++) {
      body.update(dt);
      heads.push(body.pose.rotation(2).clone());
      const eyes = eyesOf(body);
      if (k >= 60) missed = Math.max(missed, new Vector3(0, 0, 1).applyQuaternion(body.pose.rotation(2)).angleTo(point.clone().sub(eyes)));
    }
    // (on it but for the eyes' share, the head turning no faster than the chest sways under it: ~0.75 rad/s, 0.013 rad a step)
    expect(missed).toBeLessThan(0.3 * 0.35 + 0.03);
    expect(Math.max(...heads.slice(61).map((q, k) => q.angleTo(heads[60 + k])))).toBeLessThan(0.02);
  });

  it('turns the head as fast as the gaze shift is large (its main sequence), a bell, however many joints share the turn', () => {
    /** the head's speed (rad/s) every step of a look `yaw` aside, and how far it turned */
    const look = (yaw: number) => {
      const eyes = new Vector3(0, 1.65, 0.08);
      const body = gazing(), point = eyes.clone().add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(3));
      claim(body, 'look', looking(selfOf(body), () => point, SHIFT));
      const speeds: number[] = [];
      let last = new Quaternion();
      for (let k = 0; k < 180; k++) {
        body.update(dt);
        speeds.push(body.pose.rotation(2).angleTo(last) / dt);
        last = body.pose.rotation(2).clone();
      }
      return { speeds: speeds.slice(1), turned: last.angleTo(new Quaternion()) };
    };
    const small = look(0.35);
    const large = look(1.4);
    const peak = (s: number[]) => Math.max(...s);
    // (100°/s + 2.3°/s per degree turned at the peak: the large shift's head about twice as fast, neither at SHIFT's 6 rad/s)
    expect(peak(large.speeds) / peak(small.speeds)).toBeGreaterThan(1.8);
    expect(peak(large.speeds)).toBeLessThan(1.75 + 2.5 * large.turned);
    expect(peak(small.speeds)).toBeLessThan(1.75 + 2.5 * small.turned);
    // (a bell: up to its peak and down from it, no plateau at a cap)
    const top = large.speeds.indexOf(peak(large.speeds));
    expect(large.speeds.filter((v) => v > 0.95 * peak(large.speeds)).length).toBeLessThan(0.25 * large.speeds.filter((v) => v > 0.05).length);
    expect(top).toBeGreaterThan(3);
  });
});

describe('reached', () => {
  it('counts a tip tracking a moving target exactly, judging the last pose against where the target was then', () => {
    const speed = 0.9;
    const pose = (x: number) => ({ position: () => new Vector3(x, 0, 0) }) as unknown as ReadonlyPose;
    const target = { position: new Vector3(speed * 2 * dt, 0, 0), velocity: new Vector3(speed, 0, 0) };
    // the tip was on the target both earlier frames; now the target is a frame (1.5 cm) further on
    expect(reached({ prev2: pose(0), prev: pose(speed * dt), dt, time: 2 * dt }, 0, target)).toBe(true);
    expect(reached({ prev2: pose(0), prev: pose(0), dt, time: 2 * dt }, 0, target)).toBe(false);
  });

  it('counts a tip riding a fast-turning carrier, judged over the same sub-steps as the carrier moved', () => {
    // (a point 0.5 m out on a carrier turning 6 rad/s: 3 m/s, its velocity turning 0.1 rad a sub-step)
    const on = new Carrier(new Vector3());
    const turned = (k: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 6 * k * dt);
    for (let k = 1; k <= 2; k++) on.move(k * dt, new Vector3(), turned(k));
    const grip = { position: new Vector3(0.5, 0, 0) };
    const pose = (k: number) => ({ position: () => grip.position.clone().applyQuaternion(turned(k)) }) as unknown as ReadonlyPose;
    expect(reached({ prev2: pose(0), prev: pose(1), dt, time: 2 * dt }, 0, grip, on)).toBe(true);
  });
});
