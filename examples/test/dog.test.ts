import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { dogFetch } from '../src/scenarios/dog';

it('a dog made of data only trots to a ball, takes it in its jaw and carries it back, its whole body riding on the trot', () => {
  const scenario = dogFetch(), stage = scenario.stage(true);
  const [dog] = stage.bodies ?? [];
  const s = dog.pose.skeleton, jaw = s.index('jaw'), withersAt = s.index('leftFore0'), pelvis = s.index('pelvis');
  const paws = dog.species.legs!.chains.map((leg) => leg.joints[3].bone);
  let off = 0, taken = NaN, up = paws.map(() => false), cruising = 0;
  const landed: [time: number, trotting: boolean][][] = paws.map(() => []), withers: number[] = [], steady: number[] = [], croup: number[] = [], roll: number[] = [], yaw: number[] = [];
  for (let i = 0; i < scenario.duration * 60; i++) {
    dog.update(1 / 60);
    const ball = dog.holding.jaw?.item;
    if (ball) {
      if (Number.isNaN(taken)) taken = dog.frame.time;
      off = Math.max(off, dog.pose.position(jaw).distanceTo(ball.current.position));
    }
    const speed = dog.locomotion.velocity.length(), trotting = speed > 1.2, now = paws.map((paw) => dog.pose.position(paw).y > 0.033);
    now.forEach((lifted, leg) => { if (up[leg] && !lifted) landed[leg].push([dog.frame.time, trotting]); });
    up = now;
    // (the bounce read trotting on at its pace: its lean into speeding up or slowing down settled)
    cruising = speed > 1.25 ? cruising + 1 / 60 : 0;
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
