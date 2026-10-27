import { Euler, Group, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, dog, grab, walkTo } from '@drawcall/animate';
import { selfOf } from '../../packages/animate/src/body/body';
import { play } from '../../packages/animate/test/bodies';
import { DOG } from '../src/skeletons';
import { dogFetch } from '../src/scenarios/dog';
import { Simulation } from '../src/simulation';
import { ball } from '../src/things';

const DEG = Math.PI / 180, dt = 1 / 60;

/** the pace its legs walk it at (m/s): its walk's, not its centre of mass's, which rides on the trot */
const paceOf = (body: Body) => selfOf(body).locomotion.velocity.length();

/** the dog with a neck as short as a cat's for its size: its jaw no nearer the floor than its body lets down and bows for */
const SHORT_NECKED = DOG.map((bone) => bone.name === 'head' ? { ...bone, position: [0, 0.53, 0.31] as const }
  : bone.name === 'jaw' ? { ...bone, position: [0, 0.48, 0.43] as const } : bone);

/** the dog-fetch run with development on: its dog and its ball */
function fetching() {
  const sim = new Simulation(dogFetch(), { dev: true });
  const [labrador] = sim.stage.bodies, toy = sim.stage.scene.getObjectByName('ball')!;
  return { sim, labrador, toy, bone: (name: string) => labrador.pose.skeleton.index(name) };
}

it('trots to a ball, takes it in its jaw and carries it back, its whole body riding on the trot', () => {
  const { sim, labrador, toy, bone } = fetching();
  const jaw = bone('jaw'), withersAt = bone('leftFore0'), pelvis = bone('pelvis');
  const paws = labrador.species.legs!.chains.map((leg) => leg.joints[3].bone);
  let off = 0, taken = NaN, up = paws.map(() => false), cruising = 0, pace = 0;
  const landed: [time: number, trotting: boolean][][] = paws.map(() => []), withers: number[] = [], steady: number[] = [], croup: number[] = [], roll: number[] = [], yaw: number[] = [];
  while (sim.t < sim.scenario.duration) {
    sim.step();
    if (labrador.holds(toy)) {
      if (Number.isNaN(taken)) taken = sim.t;
      off = Math.max(off, labrador.pose.position(jaw).distanceTo(toy.getWorldPosition(new Vector3())));
    }
    const speed = paceOf(labrador), trotting = speed > 1.2, now = paws.map((paw) => labrador.pose.position(paw).y > 0.038);
    now.forEach((lifted, leg) => { if (up[leg] && !lifted) landed[leg].push([sim.t, trotting]); });
    up = now;
    // (the bounce read trotting on at its pace — not speeding up or slowing down, by less than 0.3 m/s² — its lean into a change of pace
    // settled)
    cruising = speed > 1.25 && Math.abs(speed - pace) * 60 < 0.3 ? cruising + dt : 0;
    pace = speed;
    if (cruising < 0.6) continue;
    steady.push(sim.t);
    withers.push(labrador.pose.position(withersAt).y); croup.push(labrador.pose.position(pelvis).y);
    const turned = new Euler().setFromQuaternion(labrador.pose.local(pelvis), 'YXZ');
    roll.push(turned.z / DEG); yaw.push(turned.y / DEG);
  }
  expect(sim.stage.done()).toBe(true);
  expect(labrador.log).toEqual([]);
  expect(taken).toBeGreaterThan(3);
  expect(off).toBeLessThan(0.01);
  // (trotting along: each fore paw lands with the hind paw across from it)
  for (const [fore, hind] of [[0, 3], [1, 2]]) {
    const along = landed[fore].filter(([, trotting]) => trotting);
    expect(along.length).toBeGreaterThan(3);
    for (const [time] of along) expect(Math.min(...landed[hind].map(([t]) => Math.abs(t - time)))).toBeLessThan(0.06);
  }
  // (the trunk bounces twice a stride, ±1.2–1.4 cm, withers and croup together; the pelvis rolls a few degrees and hardly yaws:
  // the references at the library's `dog`)
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

// (fetching, it turns to the ball and back to where it set off: its head leads into each turn and its spine bends into it; it leans into
// setting off and back from stopping — the references at the library's `dog`)
it('leads a turn with its head, bends into it and leans into its speeding up and slowing down', () => {
  const { sim, labrador, bone } = fetching();
  const head = bone('head'), neck = bone('neck'), pelvis = bone('pelvis');
  const yawOf = (q: Readonly<Quaternion>) => { const f = new Vector3(0, 0, 1).applyQuaternion(q); return Math.atan2(f.x, f.z); };
  const body: number[] = [], gaze: number[] = [], neckYaw: number[] = [], pelvisYaw: number[] = [], pitch: number[] = [], speed: number[] = [];
  while (sim.t < sim.scenario.duration && !sim.stage.done()) {
    sim.step();
    body.push(yawOf(labrador.pose.rotation(0)));
    gaze.push(yawOf(labrador.pose.rotation(head)));
    neckYaw.push(new Euler().setFromQuaternion(labrador.pose.local(neck), 'YXZ').y);
    pelvisYaw.push(new Euler().setFromQuaternion(labrador.pose.local(pelvis), 'YXZ').y);
    pitch.push(new Euler().setFromQuaternion(labrador.pose.rotation(0), 'YXZ').x);
    speed.push(paceOf(labrador));
  }
  expect(sim.stage.done()).toBe(true);
  expect(labrador.log).toEqual([]);
  // the turn back, carrying the ball: from where the body faces as it starts turning to where it ends
  const unwrap = (a: number[]) => a.reduce<number[]>((out, x, i) => [...out, i ? out[i - 1] + Math.atan2(Math.sin(x - a[i - 1]), Math.cos(x - a[i - 1])) : x], []);
  const yaw = unwrap(body), look = yaw.map((x, i) => x + Math.atan2(Math.sin(gaze[i] - body[i]), Math.cos(gaze[i] - body[i])));
  const rate = yaw.map((x, i) => i ? (x - yaw[i - 1]) / dt : 0);
  const from = rate.findIndex((r, i) => i > 4 * 60 && Math.abs(r) > 0.05), to = from + rate.slice(from).findIndex((r, i) => i > 30 && Math.abs(r) < 0.02);
  const turned = yaw[to] - yaw[from], sign = Math.sign(turned);
  expect(Math.abs(turned)).toBeGreaterThan(Math.PI / 2);
  // (its head leads: halfway round 0.1–0.5 s before its body — a person's head leads the body's yaw by ~0.2 s, the eyes by ~0.4 s
  // (Lamontagne et al. 2020) — and by 15–45° on its way round: a person's head anticipates the way by up to ~25° (Imai et al. 2001),
  // the neck taking the spine's bend on top. The time is the head's own lead, the bend's front half taken off it — as much as its back
  // half turns the pelvis out: a person's trunk does not bend so, and turning slowly on the spot that bend alone is most of a second
  // of its turn)
  const half = (a: number[]) => from + a.slice(from).findIndex((x) => sign * (x - a[from]) > Math.abs(turned) / 2);
  const led = look.map((x, i) => x + pelvisYaw[i]);
  const lead = (half(yaw) - half(led)) * dt, ahead = Math.max(...look.slice(from, to).map((x, i) => sign * (x - yaw[from + i])));
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
// stifle and hock bent as a Labrador's — the references at the library's `dog`)
it('trots as a Labrador does: its stride, its duty and its carpus and hock folding', () => {
  const labrador = new Body(dog(DOG), { dev: true });
  const at = (name: string) => labrador.pose.position(labrador.pose.skeleton.index(name));
  // (a segment's lean forward from plumb, and a joint's flexion as the lean between its segments, ° in the sagittal plane)
  const lean = (a: string, b: string) => Math.atan2(at(b).z - at(a).z, at(a).y - at(b).y) / DEG;
  const angle = (a: string, b: string, c: string) => at(a).clone().sub(at(b)).angleTo(at(c).clone().sub(at(b))) / DEG;
  labrador.update(dt);
  expect(angle('leftHind0', 'leftHind1', 'leftHind2')).toBeGreaterThan(115);
  expect(angle('leftHind0', 'leftHind1', 'leftHind2')).toBeLessThan(140);
  expect(angle('leftHind1', 'leftHind2', 'leftHind3')).toBeGreaterThan(120);
  expect(angle('leftHind1', 'leftHind2', 'leftHind3')).toBeLessThan(145);
  const lands: number[] = [], carpus: number[] = [], hock: number[] = [];
  let up = false, planted = 0, sampled = 0;
  play(() => walkTo(labrador, new Vector3(0, 0, 40), { speed: 2, accel: 2 }), [labrador], 14, (time) => {
    const lifted = at('leftFore3').y > 0.038;
    if (time > 6) {
      if (up && !lifted) lands.push(time);
      sampled++;
      if (!lifted) planted++;
      carpus.push(lean('leftFore1', 'leftFore2') - lean('leftFore2', 'leftFore3'));
      hock.push(lean('leftHind2', 'leftHind3') - lean('leftHind1', 'leftHind2'));
    }
    up = lifted;
  });
  expect(labrador.log).toEqual([]);
  const stride = (lands[lands.length - 1] - lands[0]) / (lands.length - 1), range = (a: number[]) => Math.max(...a) - Math.min(...a);
  expect(1 / stride).toBeGreaterThan(1.9);
  expect(1 / stride).toBeLessThan(2.6);
  expect(2 * stride).toBeGreaterThan(0.75);
  expect(2 * stride).toBeLessThan(1.2);
  expect(planted / sampled).toBeGreaterThan(0.35);
  expect(planted / sampled).toBeLessThan(0.5);
  expect(range(carpus)).toBeGreaterThan(70);
  expect(range(carpus)).toBeLessThan(110);
  expect(range(hock)).toBeGreaterThan(45);
  expect(range(hock)).toBeLessThan(75);
});

// (taking a ball off the floor, it stands, pitches its head down to it and up again with it, upright and no faster than a brisk gaze
// shift turns a head — ~340°/s at its peak (recalled: Guitton & Volle 1987, the library's `SHIFT`) — its ears level within a few
// degrees: a head keeps its roll small (recalled: Pozzo et al. 1990). Read off the head's side axis, the roll is well defined looking
// straight down.)
it.each([['the dog', DOG], ['a short-necked one', SHORT_NECKED]] as const)('%s lowers its head to a ball and lifts it with it smoothly and upright', (_, skeleton) => {
  const labrador = new Body(dog(skeleton), { dev: true });
  const room = new Group().add(labrador.object);
  const toy = ball(room, 'ball', 0.04, new Vector3(1.5, 0.04, 1.5));
  toy.userData.mass = 0.06;
  toy.userData.free = true;
  const head = labrador.pose.skeleton.index('head'), was = labrador.pose.rotation(head).clone(), side = new Vector3();
  let taken = NaN, fastest = 0, roll = 0;
  play(function* () {
    yield* grab(labrador, toy, { jaw: 'ball' });
    yield* walkTo(labrador, new Vector3(0, 0, 0.5));
  }, [labrador], 12, (time) => {
    if (Number.isNaN(taken) && labrador.holds(toy)) taken = time;
    const turn = labrador.pose.rotation(head), still = paceOf(labrador) <= 0.1;
    if (still) fastest = Math.max(fastest, was.angleTo(turn) / dt);
    if (still) roll = Math.max(roll, Math.abs(Math.asin(side.set(1, 0, 0).applyQuaternion(turn).y)));
    was.copy(turn);
    return time > taken + 1.5;
  });
  expect(taken).toBeGreaterThan(0);
  expect(fastest).toBeLessThan(340 * DEG);
  expect(roll).toBeLessThan(5 * DEG);
  expect(labrador.log).toEqual([]);
});
