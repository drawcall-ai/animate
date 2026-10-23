import { expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { Body, type Frame } from '../../src/core/body';
import { strideAt, type Gait } from '../../src/core/legs/gait';
import { quintic } from '../../src/core/legs/swing';
import { HORSE_WALK, HORSE_TROT, horse, horseLegs, horseLeadPoint } from '../../src/horse/legs';
import { horseMotion } from '../../src/horse/legs';
import { idle } from '../../src/humanoid/idle';
import { walkTo } from '../../src/core/walk';
import type { Species } from '../../src/core/species';
import type { Attention as HorseAttention } from '../../src/core/species';
import { SKELETON, LEGS, HEAD, NECK, PELVIS, SPINE, EARS, TAIL, HALTER } from '../../src/horse/skeleton';
import { Pose } from '../../src/core/pose';
import type { Stepper } from '../../src/core/legs/stepper';
import type { DrivenRoot } from '../../src/core/legs/stepper';
import { human } from '../../src/humanoid/humanoid';
import { INDEX } from '../../src/humanoid/bones';

it('a Cartesian swing has a bell-shaped speed peaking halfway and zero contact acceleration', () => {
  for (const T of [0.08, 0.2, 0.6]) {
    const values = Array.from({ length: 201 }, (_, k) => quintic(0, 0, 0, 1, 0, T, T * k / 200));
    expect(values[0]).toEqual([0, 0, 0]);
    expect(values[200]).toEqual([1, 0, 0]);
    for (const [x] of values) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
    expect(values.findIndex((v) => v[1] === Math.max(...values.map((x) => x[1])))).toBe(100);
    expect(values[100][1]).toBeCloseTo(1.875 / T, 8);
  }
});

it('a swing ends on the stance rate rather than at rest', () => {
  const end = quintic(0, 0.2, 0, 1, -0.7, 0.5, 0.5 - 1e-6);
  expect(end[0]).toBeCloseTo(1, 5);
  expect(end[1]).toBeCloseTo(-0.7, 5);
  expect(end[2]).toBeCloseTo(0, 2);
});

/** a horse standing, or walking straight on at `speed`, its root and pose then written over by `later` (a later writer) */
function writtenOver(dev: boolean, speed: number, later: (f: Frame, body: Body) => void) {
  const body: Body = new Body(horse(), () => (() => parallel<Frame>('all', idle(body), ...(speed ? [walkTo(body, { to: new Vector3(0, 0, 20), speed, accel: 0.65 })] : []),
    action<Frame>({ update: (f) => later(f, body) }))), { idle: false, pose: new Pose(SKELETON), dev });
  return body;
}

it('leg contact checks read the final pose after a later writer, and disappear with dev off', () => {
  const joints = horseLegs()[0].joints, terminal = joints[joints.length - 1].bone;
  const run = (dev: boolean) => {
    const body = writtenOver(dev, 0, (f) => {
      if (f.time <= 0.05) return;
      f.current.setLocal(terminal, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3));
      f.current.setRoot(f.current.position(0).clone().add(new Vector3(0.01, -0.01, 0)));
    });
    for (let k = 0; k < 10; k++) body.update(1 / 60);
    return body.log;
  };
  const checks = run(true).map((entry) => entry.check);
  expect(checks).toContain('leg contact (m)');
  expect(checks).toContain('leg contact turn (rad)');
  expect(checks).toContain('leg ground (m)');
  expect(run(false)).toEqual([]);
});

it.each([['vertical', new Vector3(0, -0.01, 0), 0.1], ['horizontal', new Vector3(0.03, 0, 0), 1]] as const)('checks %s touchdown after later pose writers, only with dev enabled', (axis, offset, limit) => {
  const run = (dev: boolean) => {
    let landed = -1;
    const body = writtenOver(dev, 0.95, (f, b) => {
      if (landed < 0 && (b.stepper as Stepper | null)?.legs.some((leg) => !leg.swing && leg.planted === 0 && leg.landed)) {
        landed = f.time;
        f.current.setRoot(f.current.position(0).clone().add(offset));
      }
    });
    for (let tick = 0; tick < 240 && (landed < 0 || body.frame.time <= landed + 1 / 60); tick++) body.update(1 / 60);
    expect(landed).toBeGreaterThan(0);
    return body.log.filter((entry) => entry.check === `leg touchdown ${axis} speed (m/s)`);
  };
  expect(run(true)).toContainEqual(expect.objectContaining({ limit }));
  expect(run(false)).toEqual([]);
});

it('rounds tiny negative speed noise but rejects reverse and nonfinite speed', () => {
  expect(strideAt(HORSE_WALK, -8.9e-16, 0)).toEqual(strideAt(HORSE_WALK, 0, 0));
  for (const speed of [-1e-9, -0.1, NaN, Infinity]) expect(() => strideAt(HORSE_WALK, speed, 0)).toThrow('leg speed');
  // (and a body whose legs read such noise off a root standing still steps on, its log empty)
  const root = { position: new Vector3(), velocity: new Vector3(0, 0, -8.9e-16), yaw: 0 };
  const body = new Body(horse(), undefined, { pose: new Pose(SKELETON), idle: { root }, dev: true });
  for (let tick = 0; tick < 60; tick++) body.update(1 / 60);
  expect(body.log).toEqual([]);
});

it('follows a moving goal with supported contacts and a root that turns toward its path', () => {
  const base = horse();
  let turned = 0;
  const body: Body = new Body(base, () => (() => parallel<Frame>('all', idle(body), walkTo(body, { to: (f: Frame) => new Vector3(0.05, 0, 2 + 0.75 * f.time), velocity: () => new Vector3(0, 0, 0.75), speed: 0.95, accel: 0.65, until: () => false }),
    action<Frame>({ update: (f) => { turned = Math.max(turned, Math.abs(2 * Math.atan2(f.current.rotation(0).y, f.current.rotation(0).w))); } }))), { idle: false, pose: new Pose(SKELETON), dev: true });
  for (let tick = 0; tick < 8 * 60; tick++) body.update(1 / 60);
  expect(body.pose.position(0).z).toBeGreaterThan(4);
  expect(turned).toBeGreaterThan(0.01);
  expect(turned).toBeLessThan(0.2);
  expect(body.log).toEqual([]);
});

// (a horse standing at rest: its neck rising from the withers, the poll above them, its croup a little below them — withers 138, back 127,
// croup 136 cm in Icelandic horses (read: Acta Vet Scand 2025, PMC12180175) — and its face sloping 45–75° below horizontal, between a
// nasal plane held extended (~51°) and neutral (~72°) (read: Go et al. 2014, BMC Vet Res 10:118))
it('stands with its neck rising to a poll above its withers, its croup a little below them and its face sloping down', () => {
  const pose = new Pose(SKELETON), withers = pose.position(LEGS[0].scapula!).y, deg = 180 / Math.PI;
  const neck = pose.position(HEAD).clone().sub(pose.position(NECK)), face = new Vector3(0, -0.37, 0.3);
  expect(Math.atan2(neck.y, neck.z) * deg).toBeGreaterThan(30);
  expect(Math.atan2(neck.y, neck.z) * deg).toBeLessThan(50);
  expect(pose.position(HEAD).y - withers).toBeGreaterThan(0.1);
  expect(withers - pose.position(PELVIS).y).toBeGreaterThan(0);
  expect(withers - pose.position(PELVIS).y).toBeLessThan(0.08);
  const muzzle = pose.point(HEAD, face, new Vector3()).sub(pose.position(HEAD));
  expect(Math.atan2(-muzzle.y, muzzle.z) * deg).toBeGreaterThan(45);
  expect(Math.atan2(-muzzle.y, muzzle.z) * deg).toBeLessThan(75);
});

it('back flexion pivots about the hips without translating their attachments', () => {
  const pose = new Pose(SKELETON);
  const hips = LEGS.slice(2).map(leg => pose.position(leg.upper).clone());
  const croup = pose.position(PELVIS).clone();
  pose.setLocal(SPINE, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 5 * Math.PI / 180));
  LEGS.slice(2).forEach((leg, i) => expect(pose.position(leg.upper).distanceTo(hips[i])).toBeLessThan(1e-12));
  expect(pose.position(PELVIS).distanceTo(croup)).toBeGreaterThan(0.01);
});

it('a slow horse walk supports on an extended carpus, folds in swing and visibly nods', () => {
  const { body, planted: down, phase } = movingHorse(HORSE_WALK, 0.95, {}, 42, () => null, 0.65);
  const support: number[] = [], swing: number[] = [], poll: number[] = [];
  const hoofPitch: number[] = [], hindHock: number[] = [], column: number[] = [];
  const planted = [true, true, true, true];
  const contact = [0, 0], horizontal = [0, 0];
  for (let tick = 0; tick < 480; tick++) {
    body.update(1 / 60);
    LEGS.forEach((leg, i) => {
      if (down(i) && !planted[i]) {
        const velocity = body.pose.position(leg.hoof).clone().sub(body.frame.prev2.position(leg.hoof)).multiplyScalar(60);
        contact[i < 2 ? 0 : 1] = Math.max(contact[i < 2 ? 0 : 1], Math.abs(velocity.y));
        horizontal[i < 2 ? 0 : 1] = Math.max(horizontal[i < 2 ? 0 : 1], velocity.setY(0).length());
      }
      planted[i] = down(i);
    });
    if (tick < 180) continue;
    const q = body.pose.local(LEGS[0].cannon);
    const angle = Math.abs(2 * Math.atan2(q.x, q.w)) * 180 / Math.PI;
    if (down(0) && phase(0) > 0.15 && phase(0) < 0.45) support.push(angle);
    if (!down(0)) swing.push(angle);
    poll.push(body.pose.position(HEAD).y);
    LEGS.forEach((leg, i) => {
      if (!down(i)) {
        const forward = new Vector3(0, 0, 1).applyQuaternion(body.pose.rotation(leg.hoof));
        hoofPitch.push(Math.asin(forward.y) * 180 / Math.PI);
      }
      if (i < 2 && down(i) && phase(i) > 0.26 && phase(i) < 0.3) {
        const delta = body.pose.position(leg.pastern).clone().sub(body.pose.position(leg.cannon));
        column.push(Math.abs(Math.atan2(delta.z, -delta.y)) * 180 / Math.PI);
      }
      if (i >= 2 && down(i) && phase(i) > 0.2 && phase(i) < 0.45) {
        const hock = body.pose.local(leg.cannon);
        hindHock.push(Math.abs(2 * Math.atan2(hock.x, hock.w)) * 180 / Math.PI);
      }
    });
  }
  expect(Math.max(...contact)).toBeLessThanOrEqual(0.1);
  expect(Math.max(...horizontal)).toBeLessThanOrEqual(1);
  expect(support.length).toBeGreaterThan(30);
  expect(Math.max(...support)).toBeLessThan(3);
  expect(Math.max(...swing)).toBeGreaterThan(25);
  expect(Math.max(...poll) - Math.min(...poll)).toBeGreaterThan(0.12);
  expect(hoofPitch.length).toBeGreaterThan(30);
  expect(Math.min(...hoofPitch)).toBeGreaterThan(-25);
  expect(Math.max(...hindHock)).toBeLessThan(6);
  expect(column.length).toBeGreaterThan(5);
  expect(Math.max(...column)).toBeLessThan(3);
  expect(body.log).toEqual([]);
});

it.each([[0.4, 0], [0.2, -1], [0, -2], [1, 2], [-1, 2]])('supports ordinary goals (%s, %s), then follows their next position', (x, z) => {
  let goal = new Vector3(x, 0, z);
  const body: Body = new Body(horse(), () => (() => parallel<Frame>('all', idle(body), walkTo(body, { to: () => goal, speed: 0.95, accel: 0.65, until: () => false }))), { idle: false, pose: new Pose(SKELETON), dev: true });
  const start = body.pose.position(0).clone();
  for (let tick = 0; tick < 120; tick++) body.update(1 / 60);
  // (a goal behind it turned to on the spot, the root staying put; one beside it within reach stepped toward)
  if (z < 0) expect(body.pose.position(0).clone().setY(start.y).distanceTo(start)).toBeLessThan(1e-6);
  goal = new Vector3(0, 0, 3);
  // (the next one ahead it then walks on to: after a turn on the forehand back round — 4–5 hind steps, ~2 s — and 3 m)
  for (let tick = 0; tick < (z < 0 ? 5.5 : 4) * 60; tick++) body.update(1 / 60);
  expect(body.pose.position(0).z).toBeGreaterThan(1);
  expect(body.log).toEqual([]);
});

it('brakes for a moving goal that crosses behind a travelling root', () => {
  const body: Body = new Body(horse(), () => (() => parallel<Frame>('all', idle(body), walkTo(body, { to: (f: Frame) => f.time < 2 ? new Vector3(0, 0, 5) : new Vector3(0.1 * Math.sin(f.time), 0, -2), speed: 0.95, accel: 0.65, until: () => false }))), { idle: false, pose: new Pose(SKELETON), dev: true });
  for (let tick = 0; tick < 480; tick++) body.update(1 / 60);
  expect(body.pose.position(0).z).toBeGreaterThan(0.5);
  expect(body.pose.position(0).z).toBeLessThan(3);
  expect(body.log).toEqual([]);
});


function movingHorse(gait: Gait, speed: number, attention: HorseAttention = {}, seed = 42, look: () => Vector3 | null = () => null, accel = 1.85) {
  const base = horse(), species: Species = { ...base, legs: { ...base.legs!, gait, posture: (start) => horseMotion(start, gait, seed) } };
  const body: Body = new Body(species, () => (() => parallel<Frame>('all', idle(body, { attention }),
    action<Frame>({ update: () => { const at = look(); if (at) body.asks.look = at; } }),
    ...(speed ? [walkTo(body, { to: new Vector3(0, 0, 200), speed, accel })] : []))), { idle: false, pose: new Pose(SKELETON), dev: true });
  const planted = (i: number) => !(body.stepper as Stepper).legs[i].swing;
  const phase = (i: number) => {
    const stepper = body.stepper as Stepper, leg = stepper.legs[i];
    return leg.swing ? (stepper.Ts + leg.swing.u * (stepper.cycle - stepper.Ts)) / stepper.cycle : (leg.planted / stepper.cycle) % 1;
  };
  return { body, planted, phase };
}
const excursion = (samples: number[]) => Math.max(...samples) - Math.min(...samples);
/** the croup read at the landmark its bounds were set at: the pelvis bone's origin before it moved to where the rigged horse has it, now
 * 9 cm ahead of and 3 cm above it (in its frame) */
const CROUP = new Vector3(0, 0.03, 0.09);
const pitchOf = (q: Readonly<Quaternion>) => new Euler().setFromQuaternion(q, 'YXZ').x;

it.each([[HORSE_WALK, 1.6], [HORSE_TROT, 3.7]] as const)('%s: final body excursions and contact phase match research §5', (gait, speed) => {
  const { body, phase: phaseOf } = movingHorse(gait, speed);
  const poll: number[] = [], withers: number[] = [], croup: number[] = [], trunk: number[] = [], head: number[] = [], back: number[] = [], roll: number[] = [], pelvis: number[] = [], tail: number[] = [];
  const high: number[] = [], low: number[] = [], relative: number[] = [], relativeCroup: number[] = [], lead: number[] = [];
  // (at speed: 10 s on, then 6 s)
  for (let tick = 0; tick < 960; tick++) {
    body.update(1 / 60);
    if (tick < 600) continue;
    const p = body.pose;
    poll.push(p.position(HEAD).y); withers.push(p.position(LEGS[0].scapula ?? 0).y); croup.push(p.point(PELVIS, CROUP, new Vector3()).y);
    trunk.push(pitchOf(p.rotation(0))); head.push(pitchOf(p.rotation(HEAD))); back.push(pitchOf(p.local(SPINE)));
    roll.push(new Euler().setFromQuaternion(p.rotation(PELVIS), 'YXZ').z);
    pelvis.push(pitchOf(p.rotation(PELVIS))); tail.push(new Euler().setFromQuaternion(p.local(TAIL), 'YXZ').y);
    relative.push(p.position(HEAD).y - p.position(LEGS[0].scapula ?? 0).y);
    relativeCroup.push(p.position(HEAD).y - p.point(PELVIS, CROUP, new Vector3()).y);
    lead.push(horseLeadPoint(p, new Vector3()).sub(p.position(0)).z);
    const phase = phaseOf(0) % 0.5;
    if (phase < 0.03 || phase > 0.47) high.push(p.position(HEAD).y);
    if (Math.abs(phase - 0.25) < 0.03) low.push(p.position(HEAD).y);
  }
  const lag = Array.from({ length: 19 }, (_, delay) => {
    let xy = 0, xx = 0, yy = 0;
    for (let i = delay; i < tail.length; i++) { const x = tail[i], y = -roll[i - delay]; xy += x * y; xx += x * x; yy += y * y; }
    return xy / Math.sqrt(xx * yy);
  });
  const passiveLag = lag.indexOf(Math.max(...lag)) / 60;
  expect(passiveLag).toBeGreaterThanOrEqual(0.1); expect(passiveLag).toBeLessThanOrEqual(0.2);
  expect(excursion(tail)).toBeGreaterThan(5 * Math.PI / 180);
  expect(excursion(lead)).toBeLessThan(1e-12);
  expect(excursion(pelvis) / (Math.PI / 180)).toBeGreaterThan(6.5);
  expect(excursion(pelvis) / (Math.PI / 180)).toBeLessThan(7.5);
  const trot = gait === HORSE_TROT;
  expect(excursion(poll)).toBeGreaterThan(trot ? 0.08 : 0.12);
  expect(excursion(poll)).toBeLessThan(trot ? 0.1 : 0.15);
  expect(excursion(withers)).toBeGreaterThan(trot ? 0.08 : 0.06);
  expect(excursion(withers)).toBeLessThan(trot ? 0.1 : 0.08);
  expect(excursion(croup)).toBeGreaterThan(trot ? 0.08 : 0.09);
  expect(excursion(croup)).toBeLessThan(0.11);
  expect(excursion(head) / (Math.PI / 180)).toBeGreaterThan(trot ? 4 : 8);
  expect(excursion(head) / (Math.PI / 180)).toBeLessThan(trot ? 6 : 10);
  if (trot) {
    expect(excursion(relative)).toBeLessThan(0.005);
    expect(excursion(relativeCroup)).toBeLessThan(0.005);
    expect(excursion(back) / (Math.PI / 180)).toBeGreaterThan(4);
    expect(excursion(back) / (Math.PI / 180)).toBeLessThanOrEqual(6);
    expect(excursion(roll) / (Math.PI / 180)).toBeGreaterThan(9);
    expect(excursion(roll) / (Math.PI / 180)).toBeLessThan(10);
  } else {
    expect(excursion(trunk) / (Math.PI / 180)).toBeGreaterThan(5.5);
    expect(excursion(trunk) / (Math.PI / 180)).toBeLessThan(6.5);
    expect(excursion(back) / (Math.PI / 180)).toBeGreaterThan(4);
    expect(excursion(back) / (Math.PI / 180)).toBeLessThan(7);
    expect(Math.min(...high) - Math.max(...low)).toBeGreaterThan(0.11);
  }
  expect(body.log).toEqual([]);
});

it('standing life is seeded, irregular, tied, balanced and rests a hind hoof on its toe', () => {
  /** `seconds` of a tied horse standing: what moves, how far off it strays, and how its hind hooves rest late on */
  const sample = (seed: number, seconds: number) => {
    const knot = new Vector3(0.7, 1.12, 0.8);
    const { body } = movingHorse(HORSE_WALK, 0, { tether: { position: knot, length: 1.1 } }, seed);
    const ears: number[][] = [[], []], tail: number[] = [], head: number[] = [], roll: number[] = [], yaw: number[] = [], shift: number[] = [];
    let rested = 0, toe = 0, heel = 0, tied = 0, aside = 0, ahead = -Infinity, behind = Infinity, standing = NaN;
    for (let tick = 0; tick < seconds * 60; tick++) {
      body.update(1 / 60);
      const p = body.pose;
      if (Number.isNaN(standing)) standing = p.position(LEGS[2].upper).y;
      EARS.forEach((ear, i) => ears[i].push(p.local(ear).angleTo(new Quaternion())));
      tail.push(p.local(TAIL).angleTo(new Quaternion())); head.push(p.rotation(HEAD).angleTo(new Quaternion()));
      yaw.push(new Euler().setFromQuaternion(p.local(NECK), 'YXZ').y);
      roll.push(new Euler().setFromQuaternion(p.rotation(PELVIS), 'YXZ').z);
      shift.push(p.position(PELVIS).x);
      tied = Math.max(tied, p.point(HEAD, HALTER, new Vector3()).distanceTo(knot));
      const com = p.com(new Vector3());
      [aside, ahead, behind] = [Math.max(aside, Math.abs(com.x)), Math.max(ahead, com.z), Math.min(behind, com.z)];
      if (tick > 180 * 60) for (const leg of LEGS.slice(2)) {
        const h = p.point(leg.hoof, leg.heel, new Vector3()).y, t = p.point(leg.hoof, leg.toe, new Vector3()).y;
        if (h > heel) { heel = h; toe = t; rested = p.position(leg.upper).y; }
      }
    }
    expect(tied).toBeLessThanOrEqual(1.1 + 1e-6);
    expect(aside).toBeLessThan(0.08);
    expect(behind).toBeGreaterThan(-0.4); expect(ahead).toBeLessThan(0.5);
    expect(body.log).toEqual([]);
    return { ears, tail, head, roll, yaw, shift, heel, toe, rested, standing };
  };
  // (the whole while once, to the hind rest after 60–180 s quiet; seeding judged over the first 25 s)
  const a = sample(42, 220);
  expect(excursion(a.ears[0].slice(0, 6 * 60))).toBeGreaterThan(0.1);
  expect(excursion(a.ears[1].slice(0, 6 * 60))).toBeGreaterThan(0.1);
  expect(excursion(a.tail.slice(0, 20 * 60))).toBeGreaterThan(0.1);
  expect(excursion(a.head.slice(0, 25 * 60))).toBeGreaterThan(0.02);
  expect(excursion(a.yaw.slice(0, 25 * 60))).toBeGreaterThan(0.03);
  expect(excursion(a.roll.slice(0, 60 * 60))).toBeGreaterThan(0.01);
  expect(excursion(a.shift.slice(0, 6 * 60))).toBeGreaterThan(0.01);
  expect(a.heel).toBeGreaterThan(0.04); expect(Math.abs(a.toe)).toBeLessThan(1e-4);
  // (the hip let down over the resting leg, below where it stood)
  expect(a.rested).toBeLessThan(a.standing - 0.02);
  const early = (s: ReturnType<typeof sample>) => [s.ears.map((e) => e.slice(0, 25 * 60)), s.tail.slice(0, 25 * 60), s.head.slice(0, 25 * 60)];
  expect(early(sample(42, 25))).toEqual(early(a));
  expect(early(sample(43, 25))).not.toEqual(early(a));
}, 30000);

it.each([false, true])('checks the final tied pose after later writers, dev=%s', (dev) => {
  const pose = new Pose(SKELETON); pose.setRoot(new Vector3(0, 1.32, 0));
  const motion = horseMotion(pose, HORSE_WALK);
  // (standing legs, as the posture reads them)
  const legs = { legs: LEGS.map(() => ({ phase: 0 })), rest: () => {} };
  const tether = { position: new Vector3(0.7, 1.12, 0.8), length: 0.9 };
  const body = new Body({ skeleton: SKELETON }, () => (() => action<Frame>({ update: f => {
    motion.prepare(f, legs, { tether: f.time < 0.02 ? tether : undefined });
    if (f.time < 0.02) f.current.setLocal(NECK, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.5));
  } })), { idle: false, pose, dev });
  body.update(1 / 30);
  const checks = body.log.filter(entry => entry.check === 'horse tether (m)');
  expect(checks.length).toBe(dev ? 1 : 0);
  if (dev) expect(checks[0]).toMatchObject({ time: 1 / 60, limit: 0.9, where: 'halter' });
});

it('ears lead the head toward an approaching person; both saddling reactions begin within 1 s and settle by 5 s', () => {
  let person: Vector3 | null = null;
  let startle: Vector3 | undefined;
  const { body } = movingHorse(HORSE_WALK, 0, { startle: () => startle }, 42, () => person);
  for (let i = 0; i < 60; i++) body.update(1 / 60);
  const ear = body.pose.local(EARS[0]).clone(), neck = body.pose.local(NECK).clone();
  person = new Vector3(2, 1.5, 3);
  for (let i = 0; i < 6; i++) body.update(1 / 60);
  expect(ear.angleTo(body.pose.local(EARS[0]))).toBeGreaterThan(neck.angleTo(body.pose.local(NECK)));
  for (let i = 0; i < 54; i++) body.update(1 / 60);
  expect(new Euler().setFromQuaternion(body.pose.local(NECK), 'YXZ').y).toBeGreaterThan(0.1);
  const point = new Vector3(2, 1, -1);
  for (let event = 0; event < 2; event++) {
    const before = body.pose.local(HEAD).clone();
    startle = point.clone();
    for (let i = 0; i < 60; i++) body.update(1 / 60);
    expect(before.angleTo(body.pose.local(HEAD))).toBeGreaterThan(0.15);
    expect(new Euler().setFromQuaternion(body.pose.local(HEAD), 'YXZ').y).toBeGreaterThan(0.15);
    for (let i = 0; i < 240; i++) body.update(1 / 60);
    expect(Math.abs(new Euler().setFromQuaternion(body.pose.local(HEAD), 'YXZ').y)).toBeLessThan(0.01);
  }
  expect(body.log).toEqual([]);
});


it.each([[HORSE_WALK, 1.6], [HORSE_TROT, 3.7]] as const)('%s: solved hooves peak near mid-swing, rise early and brake into contact', (gait, speed) => {
  const { body, planted } = movingHorse(gait, speed);
  const flights: { speed: number; height: number; forward: number }[][] = [[], [], [], []];
  let checked = 0;
  for (let tick = 0; tick < 960; tick++) {
    body.update(1 / 60);
    LEGS.forEach((leg, i) => {
      const p = body.pose;
      const velocity = p.position(leg.hoof).clone().sub(body.frame.prev2.position(leg.hoof)).multiplyScalar(60);
      if (!planted(i)) {
        flights[i].push({ speed: velocity.clone().setY(0).length(), height: Math.min(p.point(leg.hoof, leg.heel, new Vector3()).y, p.point(leg.hoof, leg.toe, new Vector3()).y), forward: velocity.z });
        return;
      }
      const flight = flights[i]; flights[i] = [];
      if (tick < 600 || !flight.length) return;
      const peak = flight.findIndex((v) => v.speed === Math.max(...flight.map(v => v.speed)));
      const high = flight.findIndex((v) => v.height === Math.max(...flight.map(v => v.height)));
      expect((peak + 0.5) / flight.length).toBeGreaterThanOrEqual(0.45);
      expect((peak + 0.5) / flight.length).toBeLessThanOrEqual(0.55);
      expect((high + 0.5) / flight.length).toBeGreaterThanOrEqual(0.25);
      expect((high + 0.5) / flight.length).toBeLessThanOrEqual(0.35);
      const terminal = flight.slice(Math.floor(flight.length * (i < 2 ? 0.75 : 0.875)));
      expect(terminal[0].speed).toBeGreaterThan(terminal[terminal.length - 1].speed);
      expect(Math.abs(velocity.y)).toBeLessThanOrEqual(0.1);
      expect(velocity.setY(0).length()).toBeLessThanOrEqual(1);
      checked++;
    });
  }
  expect(checked).toBeGreaterThan(10);
  expect(body.log).toEqual([]);
});

// (a stepper keeps what it stood on for its own feet: another body stepping between its move and its feet changes nothing)
it('plants its feet from its own pelvis, whatever another stepper did since', () => {
  const driven = (x: number, speed: number) => {
    const root: DrivenRoot = { position: new Vector3(x, 0, 0), velocity: new Vector3(0, 0, speed), yaw: 0 };
    return { root, body: new Body(human(), undefined, { at: { x, z: 0 }, idle: { root } }) };
  };
  const [a, b] = [driven(0, 3.5), driven(3, -3.5)];
  let most = 0;
  for (let i = 0; i < 120; i++) {
    for (const { root, body } of [a, b]) { root.position.addScaledVector(root.velocity, 1 / 60); body.update(1 / 60); }
    const stepper = a.body.stepper as Stepper, legs = stepper.legs.flatMap((leg, k) => leg.swing ? [] : [k]);
    const tops = legs.map((k) => a.body.pose.position(k ? INDEX.rightUpperLeg : INDEX.leftUpperLeg).clone());
    const before = legs.map((k, j) => stepper.pose(k, tops[j]).ankle.clone());
    (b.body.stepper as Stepper).move(b.body.frame, b.root);
    legs.forEach((k, j) => { most = Math.max(most, stepper.pose(k, tops[j]).ankle.distanceTo(before[j])); });
  }
  expect(most).toBe(0);
});
