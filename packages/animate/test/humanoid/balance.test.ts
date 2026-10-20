import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel } from '@pmndrs/timeline';
import { Humanoid, Body, idle, walkTo, type Frame } from '../../src';
import { INDEX } from '../../src/humanoid/bones';
import { heelOf, swingProgress } from '../../src/humanoid/balance/foot';
import { wrapAngle, yawOf } from '../../src/core/math';
import { Legs } from '../../src/core/legs/legs';
import { humanGait, humanLegs } from '../../src/humanoid/legs';
import { createSkeletonModel } from '../../src/humanoid/model';
import { legSystem } from '../../src/humanoid/idle';

/** `idle` on the old or the core legs (the migration's switch, read as `idle` is called) */
function idleOn(h: Humanoid, legs: 'old' | 'core') {
  legSystem.path = legs;
  try { return idle(h); } finally { legSystem.path = 'old'; }
}

const dt = 1 / 60;

it('ends swing progression with zero speed and acceleration', () => {
  const d = 1e-4;
  expect(swingProgress(1)).toBeCloseTo(1, 12);
  expect((swingProgress(1 + d) - swingProgress(1 - d)) / (2 * d)).toBeCloseTo(0, 5);
  expect((swingProgress(1 + d) - 2 * swingProgress(1) + swingProgress(1 - d)) / d ** 2).toBeCloseTo(0, 4);
});

describe('balance', () => {
  it('stands still where it starts, its feet planted, and reads and clears what it is asked every sub-step', () => {
    const asked: number[] = [];
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* parallel<Frame>(
          'all',
          idle(h),
          action<Frame>({ update: () => void (asked.push(h.asks.lower), (h.asks.lower = 0.01)) }),
        );
      },
    );
    const start = h.feet.map((f) => f.position.clone());
    for (let k = 0; k < 120; k++) h.update(dt);
    expect(h.feet.every((f, s) => f.phase === 'planted' && f.position.equals(start[s]))).toBe(true);
    expect(h.locomotion.settled).toBe(true);
    // (cleared by balance before each sub-step's tasks ask again)
    expect(asked.every((x) => x === 0)).toBe(true);
  });

  it.each(['old', 'core'] as const)('%s walks to a point and settles there on squared feet; walkTo ends then', (legs) => {
    const to = new Vector3(0.6, 0, 2);
    let arrived = -1;
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* parallel<Frame>('all', idleOn(h, legs), function* () {
          yield* walkTo(h, { to, face: 0.5 })();
          arrived = h.locomotion.moving ? -2 : 1;
        });
      },
    );
    for (let k = 0; k < 8 * 60 && arrived < 0; k++) h.update(dt);
    expect(arrived).toBe(1);
    expect(h.pose.com(new Vector3()).setY(0).distanceTo(to)).toBeLessThan(0.15);
    expect(Math.abs(h.locomotion.facing - 0.5)).toBeLessThan(0.15);
    for (const [s, f] of h.feet.entries()) expect(Math.abs(f.yaw - (0.5 + (s === 0 ? 0.12 : -0.12)))).toBeLessThan(0.1);
  });

  it('core walks to a point without a facing and settles there', () => {
    const to = new Vector3(0.6, 0, 2);
    let arrived = false;
    const h = new Humanoid(createSkeletonModel(), (h) => function* () {
      yield* parallel<Frame>('all', idleOn(h, 'core'), function* () {
        yield* walkTo(h, { to })();
        arrived = true;
      });
    }, { dev: true });
    for (let k = 0; k < 8 * 60 && !arrived; k++) h.update(dt);
    expect(arrived).toBe(true);
    expect(h.locomotion.moving).toBe(false);
    expect(h.locomotion.settled).toBe(true);
    expect(h.pose.com(new Vector3()).setY(0).distanceTo(to)).toBeLessThan(0.15);
    h.update(dt);
    expect(h.log).toEqual([]);
  }, 20000);

  it.each(['old', 'core'] as const)('%s bounds pelvis excursion and contact ringing in each steady stride and after stopping', (legs) => {
    const h = new Humanoid(createSkeletonModel(), (h) => function* () {
      yield* parallel<Frame>('all', idleOn(h, legs), walkTo(h, { to: new Vector3(0, 0, 12) }));
    });
    const samples: { y: number; speed: number }[] = [];
    const contacts: number[] = [];
    const phases = ['planted', 'planted'];
    const touch: number[] = [], pitchSteps: number[] = [], heels: number[] = [];
    // Core starts the opposite leg late in stance; only an observed landing starts its heel window.
    const landed = [legs === 'old', legs === 'old'];
    const rocker: number[][] = [[], []];
    const pitch = (side: 'left' | 'right', previous = false) => {
      const forward = new Vector3(0, 0, 1).applyQuaternion((previous ? h.frame.prev2 : h.pose).rotation(INDEX[`${side}Foot`]));
      return Math.atan2(forward.y, Math.hypot(forward.x, forward.z)) * 180 / Math.PI;
    };
    let planted = true;
    let settled = Infinity;
    for (let tick = 0; tick < 15 * 60; tick++) {
      h.update(dt);
      for (const [s, side] of (['left', 'right'] as const).entries()) {
        const bone = INDEX[`${side}Foot`];
        const heel = h.pose.point(bone, heelOf(h.proportions), new Vector3());
        if (h.feet[s].phase === 'planted' && phases[s] === 'swing') {
          touch.push(Math.abs(heel.y - h.frame.prev2.point(bone, heelOf(h.proportions), new Vector3()).y) / dt);
          pitchSteps.push(Math.abs(pitch(side) - pitch(side, true)));
          rocker[s] = [];
          landed[s] = true;
        }
        if (landed[s] && h.feet[s].phase === 'planted' && rocker[s].length < 4) {
          rocker[s].push(pitch(side));
          heels.push(heel.y);
        }
        phases[s] = h.feet[s].phase;
      }
      samples.push({ y: h.pose.position(0).y, speed: h.locomotion.velocity.length() });
      const on = h.feet[0].phase === 'planted';
      if (on && !planted) contacts.push(tick);
      planted = on;
      if (tick > 3 * 60 && h.locomotion.settled) settled = Math.min(settled, tick);
    }
    const range = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
    const reversals = (ys: number[]) => {
      let peak = ys[0], direction = 0, count = 0;
      for (const y of ys.slice(1)) {
        const change = y - peak;
        if (!direction) {
          if (Math.abs(change) > 0.001) { direction = Math.sign(change); peak = y; }
          continue;
        }
        if (direction * change >= 0) { peak = y; continue; }
        if (Math.abs(change) <= 0.001) continue;
        count++;
        direction = Math.sign(change);
        peak = y;
      }
      return count;
    };
    const excursions = contacts.slice(1).map((to, k) => range(samples.slice(contacts[k], to + 1).map((sample) => sample.y)));
    expect(Math.max(...touch)).toBeLessThanOrEqual(0.1);
    expect(Math.max(...pitchSteps)).toBeLessThanOrEqual(1.5);
    expect(Math.max(...heels)).toBeLessThanOrEqual(1e-6);
    // HEAD 4411c97: first accelerating stride 7.281 cm, next 5.203 cm.
    expect(excursions[0]).toBeLessThanOrEqual(0.07281);
    expect(excursions[1]).toBeLessThanOrEqual(0.05203);
    let strides = 0;
    for (let k = 1; k < contacts.length; k++) {
      const from = contacts[k - 1], to = contacts[k];
      const stride = samples.slice(from, to + 1);
      if (from < 3 * 60 || stride.some((sample) => sample.speed < 1.2)) continue;
      const ys = stride.map((sample) => sample.y);
      // HEAD 4411c97: 4.417 cm maximum; eight reversals above 1 mm already exist.
      expect(range(ys)).toBeLessThanOrEqual(0.04418);
      expect(reversals(ys)).toBeLessThanOrEqual(8);
      strides++;
    }
    expect(strides).toBeGreaterThanOrEqual(4);
    expect(Number.isFinite(settled)).toBe(true);
    const rest = samples.slice(settled + 30).map((sample) => sample.y);
    expect(rest.length).toBeGreaterThan(60);
    expect(range(rest)).toBeLessThanOrEqual(0.012);
    expect(reversals(rest)).toBeLessThanOrEqual(1);
  });
});

// research-contact §3: arrival-turn claims [R-s], numerical details [C]; 20° here is the requested gate.
it.each([Math.PI / 2, 2 * Math.PI / 3, Math.PI])('core arrives facing %s without deferring its turn until after travel', (face) => {
  const to = new Vector3(0, 0, 4);
  let arrived = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idleOn(h, 'core'), function* () {
      yield* walkTo(h, { to, face })();
      arrived = true;
    });
  }, { dev: true });
  const phases = h.feet.map((foot) => foot.phase);
  const landings: { yaw: number; error: number; t: number }[] = [];
  let distance = 0, last = h.pose.com(new Vector3()).setY(0), facing = h.locomotion.facing, sign = 0, reversed = 0;
  for (let tick = 0; tick < 12 * 60 && !arrived; tick++) {
    h.update(dt);
    const delta = wrapAngle(h.locomotion.facing - facing);
    if (!sign && Math.abs(delta) > 1e-6) sign = Math.sign(delta);
    reversed += Math.max(0, -sign * delta); facing = h.locomotion.facing;
    const at = h.pose.com(new Vector3()).setY(0);
    distance += at.distanceTo(last);
    last = at;
    h.feet.forEach((foot, s) => {
      if (foot.phase === 'planted' && phases[s] === 'swing' && h.locomotion.velocity.length() > 0.05) {
        landings.push({ yaw: yawOf(h.pose.rotation(0)), error: Math.abs(wrapAngle(face + (s === 0 ? 0.12 : -0.12) - yawOf(h.pose.rotation(s === 0 ? INDEX.leftFoot : INDEX.rightFoot)))), t: tick * dt });
      }
      phases[s] = foot.phase;
    });
  }
  const lastTwo = landings.slice(-2);
  console.log('arrival', { face, distance, afterTouchdown: Math.abs(wrapAngle(yawOf(h.pose.rotation(0)) - lastTwo[1]?.yaw)), footErrors: lastTwo.map((land) => land.error) });
  expect(arrived).toBe(true);
  expect(distance).toBeLessThanOrEqual(1.15 * to.length());
  expect(reversed).toBeLessThanOrEqual(1e-3);
  expect(lastTwo).toHaveLength(2);
  expect(Math.abs(wrapAngle(yawOf(h.pose.rotation(0)) - lastTwo[1].yaw))).toBeLessThanOrEqual(20 * Math.PI / 180);
  expect(lastTwo[1].error).toBeLessThan(lastTwo[0].error);
  h.update(dt);
  // XCoM capture remains stage 4; contact, ROM and rate checks still apply here.
  expect(h.log.filter((entry) => entry.check !== 'XCoM outside support (m)')).toEqual([]);
}, 20000);

it('core toward turns from rest, forecasts facing, squares its anchors and then stops the clock', () => {
  const h = new Humanoid(createSkeletonModel(), () => function* () {});
  const legs = new Legs(h.pose, humanLegs(h.proportions), humanGait(h.proportions));
  const start = legs.root.position.clone();
  const anchors = h.feet.map((foot) => foot.position.clone().sub(start));
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const body = new Body(h.pose.skeleton, () => action<Frame>({ update: (f) => {
    legs.toward(f, { position: start, quaternion: facing }, { accel: 1.2, speed: 0 });
  } }), { pose: h.pose, dev: true });
  let lead = 0;
  for (let tick = 0; tick < 600; tick++) {
    body.update(dt);
    lead = Math.max(lead, Math.abs(wrapAngle(yawOf(legs.facingAhead) - yawOf(legs.root.quaternion))));
  }
  expect(lead).toBeGreaterThan(0.1);
  expect(legs.root.quaternion.angleTo(facing)).toBeLessThan(0.05);
  expect(legs.settled).toBe(true);
  for (const [s, leg] of legs.legs.entries()) {
    const bone = s === 0 ? INDEX.leftFoot : INDEX.rightFoot;
    const goal = anchors[s].clone().applyQuaternion(legs.root.quaternion).add(legs.root.position);
    expect(body.pose.position(bone).clone().setY(0).distanceTo(goal.setY(0))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(wrapAngle(yawOf(body.pose.rotation(bone)) - Math.PI - (s === 0 ? 0.12 : -0.12)))).toBeLessThanOrEqual(0.05);
    expect(leg.planted).toBe(true);
  }
  const phase = legs.phase;
  for (let tick = 0; tick < 60; tick++) body.update(dt);
  expect(legs.phase).toBe(phase);
  expect(body.log).toEqual([]);
}, 20000);
