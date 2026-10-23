import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, Pose, walkTo } from '@drawcall/animate';
import { DOG, dogFetch } from '../src/scenarios/dog';

it('a dog made of data only trots to a ball, takes it in its jaw and carries it back, its whole body riding on the trot', () => {
  const scenario = dogFetch(), stage = scenario.stage(true);
  const [dog] = stage.bodies ?? [];
  const s = dog.pose.skeleton, jaw = s.index('jaw'), withersAt = s.index('leftFore0'), pelvis = s.index('pelvis');
  const paws = dog.species.legs!.chains.map((leg) => leg.joints[3].bone);
  let off = 0, taken = NaN, up = paws.map(() => false), cruising = 0, pace = 0;
  const landed: [time: number, trotting: boolean][][] = paws.map(() => []), withers: number[] = [], steady: number[] = [], croup: number[] = [], roll: number[] = [], yaw: number[] = [];
  for (let i = 0; i < scenario.duration * 60; i++) {
    dog.update(1 / 60);
    const ball = dog.holding.jaw?.item;
    if (ball) {
      if (Number.isNaN(taken)) taken = dog.frame.time;
      off = Math.max(off, dog.pose.position(jaw).distanceTo(ball.current.position));
    }
    const speed = dog.locomotion.velocity.length(), trotting = speed > 1.2, now = paws.map((paw) => dog.pose.position(paw).y > 0.038);
    now.forEach((lifted, leg) => { if (up[leg] && !lifted) landed[leg].push([dog.frame.time, trotting]); });
    up = now;
    // (the bounce read trotting on at its pace — not speeding up or slowing down, by less than 0.3 m/s² — its lean into a change of pace
    // settled)
    cruising = speed > 1.25 && Math.abs(speed - pace) * 60 < 0.3 ? cruising + 1 / 60 : 0;
    pace = speed;
    if (cruising < 0.6) continue;
    steady.push(dog.frame.time);
    withers.push(dog.pose.position(withersAt).y); croup.push(dog.pose.position(pelvis).y);
    const turned = new Euler().setFromQuaternion(dog.pose.local(pelvis), 'YXZ');
    roll.push(turned.z / DEG); yaw.push(turned.y / DEG);
  }
  expect(stage.done()).toBe(true);
  expect(dog.log).toEqual([]);
  expect(taken).toBeGreaterThan(3);
  expect(off).toBeLessThan(0.01);
  // (trotting along: each fore paw lands with the hind paw across from it)
  for (const [fore, hind] of [[0, 3], [1, 2]]) {
    const along = landed[fore].filter(([, trotting]) => trotting);
    expect(along.length).toBeGreaterThan(3);
    for (const [time] of along) expect(Math.min(...landed[hind].map(([t]) => Math.abs(t - time)))).toBeLessThan(0.06);
  }
  // (the trunk bounces twice a stride, ±1.2–1.4 cm, withers and croup together; the pelvis rolls a few degrees and hardly yaws:
  // the references at `DOG`)
  const mean = (a: number[]) => a.reduce((sum, x) => sum + x, 0) / a.length, range = (a: number[]) => Math.max(...a) - Math.min(...a);
  const w = mean(withers), c = mean(croup), dips = withers.filter((x, i) => x < withers[i - 1] && x <= withers[i + 1] && x < w - 0.35 * range(withers)).length;
  const together = withers.reduce((sum, x, i) => sum + (x - w) * (croup[i] - c), 0) / Math.sqrt(withers.reduce((sum, x) => sum + (x - w) ** 2, 0) * croup.reduce((sum, x) => sum + (x - c) ** 2, 0));
  expect(range(withers)).toBeGreaterThan(0.015); expect(range(withers)).toBeLessThan(0.035);
  expect(together).toBeGreaterThan(0.9);
  const strides = landed[0].filter(([time]) => steady.includes(time)).length;
  expect(dips / strides).toBeGreaterThan(1.6); expect(dips / strides).toBeLessThan(2.6);
  expect(range(roll)).toBeGreaterThan(2); expect(range(roll)).toBeLessThan(8);
  expect(range(yaw)).toBeLessThan(5);
});

const DEG = Math.PI / 180, dt = 1 / 60;

// (fetching, it turns to the ball and back to where it set off: its head leads into each turn and its spine bends into it; it leans into
// setting off and back from stopping — the references at `DOG`)
it('leads a turn with its head, bends into it and leans into its speeding up and slowing down', () => {
  const scenario = dogFetch(), stage = scenario.stage(true);
  const [dog] = stage.bodies ?? [];
  const s = dog.pose.skeleton, head = s.index('head'), neck = s.index('neck'), pelvis = s.index('pelvis');
  const yawOf = (q: Quaternion) => { const f = new Vector3(0, 0, 1).applyQuaternion(q); return Math.atan2(f.x, f.z); };
  const body: number[] = [], gaze: number[] = [], neckYaw: number[] = [], pelvisYaw: number[] = [], pitch: number[] = [], speed: number[] = [];
  for (let i = 0; i < scenario.duration * 60 && !stage.done(); i++) {
    dog.update(dt);
    body.push(yawOf(dog.pose.rotation(0)));
    gaze.push(yawOf(dog.pose.rotation(head)));
    neckYaw.push(new Euler().setFromQuaternion(dog.pose.local(neck), 'YXZ').y);
    pelvisYaw.push(new Euler().setFromQuaternion(dog.pose.local(pelvis), 'YXZ').y);
    pitch.push(new Euler().setFromQuaternion(dog.pose.rotation(0), 'YXZ').x);
    speed.push(dog.locomotion.velocity.length());
  }
  expect(stage.done()).toBe(true);
  expect(dog.log).toEqual([]);
  // the turn back, carrying the ball: from where the body faces as it starts turning to where it ends
  const unwrap = (a: number[]) => a.reduce<number[]>((out, x, i) => [...out, i ? out[i - 1] + Math.atan2(Math.sin(x - a[i - 1]), Math.cos(x - a[i - 1])) : x], []);
  const yaw = unwrap(body), look = yaw.map((x, i) => x + Math.atan2(Math.sin(gaze[i] - body[i]), Math.cos(gaze[i] - body[i])));
  const rate = yaw.map((x, i) => i ? (x - yaw[i - 1]) / dt : 0);
  const from = rate.findIndex((r, i) => i > 4 * 60 && Math.abs(r) > 0.05), to = from + rate.slice(from).findIndex((r, i) => i > 30 && Math.abs(r) < 0.02);
  const turned = yaw[to] - yaw[from], sign = Math.sign(turned);
  expect(Math.abs(turned)).toBeGreaterThan(Math.PI / 2);
  // (its head leads: halfway round 0.1–0.5 s before its body — a person's head leads the body's yaw by ~0.2 s, the eyes by ~0.4 s
  // (Lamontagne et al. 2020) — and by 15–45° on its way round: a person's head anticipates the way by up to ~25° (Imai et al. 2001),
  // the neck taking the spine's bend on top)
  const half = (a: number[]) => from + a.slice(from).findIndex((x) => sign * (x - a[from]) > Math.abs(turned) / 2);
  const lead = (half(yaw) - half(look)) * dt, ahead = Math.max(...look.slice(from, to).map((x, i) => sign * (x - yaw[from + i])));
  expect(lead).toBeGreaterThan(0.1);
  expect(lead).toBeLessThan(0.5);
  expect(ahead / DEG).toBeGreaterThan(15);
  expect(ahead / DEG).toBeLessThan(45);
  // (its spine bends into the turn: the neck turned in, the pelvis out — concave to the inside — by 5° or more each)
  const middle = Math.round((from + to) / 2);
  expect(sign * neckYaw[middle]).toBeGreaterThan(5 * DEG);
  expect(-sign * pelvisYaw[middle]).toBeGreaterThan(5 * DEG);
  // it pitches head-end down into setting off and up from stopping, by 0.2–0.6 of atan(a / g) (the trot's own pitch is none: withers
  // and croup bounce together); on its way, level
  const accel = speed.map((v, i) => i > 6 ? (v - speed[i - 6]) / (6 * dt) : 0);
  const going = speed.findIndex((v) => v > 1), starting = Math.max(...accel.slice(0, going)), stopping = Math.min(...accel.slice(going, going + 4 * 60));
  const down = Math.max(...pitch.slice(0, going + 30)), up = Math.min(...pitch.slice(going, going + 4 * 60));
  for (const [lean, a] of [[down, starting], [-up, -stopping]]) {
    expect(lean / Math.atan2(a, 9.81)).toBeGreaterThan(0.2);
    expect(lean / Math.atan2(a, 9.81)).toBeLessThan(0.6);
  }
});

// (trotting on at 2 m/s, a Labrador's pace, it strides as one: ~2.2 strides a second of ~1 m, each paw down ~0.42 of it (read: Charles et
// al. 2025, Labradors; Fischer et al. 2018), its carpus folding ~90° in the swing and its hock ~55° (read: Miao et al. 2026); standing, its
// stifle and hock bent as a Labrador's — the references at `DOG`)
it('trots as a Labrador does: its stride, its duty and its carpus and hock folding', () => {
  const dog = new Body(DOG, (b) => walkTo(b, { to: new Vector3(0, 0, 40), speed: 2, accel: 2 }), { pose: new Pose(DOG.skeleton), dev: true });
  const P = (n: string) => dog.pose.position(dog.pose.skeleton.index(n));
  // (a segment's lean forward from plumb, and a joint's flexion as the lean between its segments, ° in the sagittal plane)
  const lean = (a: string, b: string) => Math.atan2(P(b).z - P(a).z, P(a).y - P(b).y) / DEG;
  const angle = (a: string, b: string, c: string) => P(a).clone().sub(P(b)).angleTo(P(c).clone().sub(P(b))) / DEG;
  dog.update(dt);
  expect(angle('leftHind0', 'leftHind1', 'leftHind2')).toBeGreaterThan(115);
  expect(angle('leftHind0', 'leftHind1', 'leftHind2')).toBeLessThan(140);
  expect(angle('leftHind1', 'leftHind2', 'leftHind3')).toBeGreaterThan(120);
  expect(angle('leftHind1', 'leftHind2', 'leftHind3')).toBeLessThan(145);
  const lands: number[] = [], carpus: number[] = [], hock: number[] = [];
  let up = false, planted = 0, n = 0;
  for (let i = 0; i < 14 * 60; i++) {
    dog.update(dt);
    const lifted = P('leftFore3').y > 0.038;
    if (dog.frame.time > 6) {
      if (up && !lifted) lands.push(dog.frame.time);
      n++;
      if (!lifted) planted++;
      carpus.push(lean('leftFore1', 'leftFore2') - lean('leftFore2', 'leftFore3'));
      hock.push(lean('leftHind2', 'leftHind3') - lean('leftHind1', 'leftHind2'));
    }
    up = lifted;
  }
  expect(dog.log).toEqual([]);
  const stride = (lands[lands.length - 1] - lands[0]) / (lands.length - 1), range = (a: number[]) => Math.max(...a) - Math.min(...a);
  expect(1 / stride).toBeGreaterThan(1.9);
  expect(1 / stride).toBeLessThan(2.6);
  expect(2 * stride).toBeGreaterThan(0.75);
  expect(2 * stride).toBeLessThan(1.2);
  expect(planted / n).toBeGreaterThan(0.35);
  expect(planted / n).toBeLessThan(0.5);
  expect(range(carpus)).toBeGreaterThan(70);
  expect(range(carpus)).toBeLessThan(110);
  expect(range(hock)).toBeGreaterThan(45);
  expect(range(hock)).toBeLessThan(75);
});
