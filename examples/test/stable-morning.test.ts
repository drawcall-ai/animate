import { Euler, Group, Mesh, Quaternion, Vector3, type BoxGeometry, type Line } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect } from 'vitest';
import { carry, grab, horse, lookAt, wait, walkTo, type Body } from '@drawcall/animate';
import { Simulation } from '../src/simulation';
import { seeded } from '../scripts/run';
import { GATE, LEAD_ROPE, RAIL, TIED, stableMorning } from '../src/scenarios/stable-morning';
import { Cast, type Scenario } from '../src/scenario';
import { HORSE, OUTLIER, SOLDIER, type PersonSkeleton } from '../src/skeletons';
import { box, empty } from '../src/things';
import { Actor } from './actor';
import { segmentDistance } from './clearance';
import { headShift, SHIFT_BOUNDS } from './gaze';
import { cases } from '../../packages/animate/test/open';

// Recalled conservative human radii, as shares of stature: the head round its centre, the trunk (hips–chest), the thorax (chest–neck,
// test/clearance.ts's capsule), a thigh or shank.
const HEAD_RADIUS = 0.06;
const BODY_RADIUS = 0.06;
const THORAX_RADIUS = 0.045;
const LEG_RADIUS = 0.038;
// Read from the horse's proportions (m): half its barrel's width, a leg's radius, its neck's and head's; the muzzle in its head bone's frame.
const HORSE_HALF_WIDTH = 0.24;
const HORSE_LEG_RADIUS = 0.06;
const HORSE_HEAD_RADIUS = 0.1;
const MUZZLE = new Vector3(0, -0.42, 0.33);
// Read from the scene: the rail's and the gate posts' half-diagonals (square sections), the rope's radius (m).
const RAIL_RADIUS = Math.SQRT2 * 0.04;
const POST_RADIUS = Math.SQRT2 * 0.075;
const ROPE_RADIUS = 0.012;
// Led from beside the neck: the handler's pelvis ahead of the horse's shoulder girdle by more than this (m), clear of its foreleg swing,
// and not past its poll: the leading position (horsemanship convention, recalled; the margin tuned).
const SHOULDER_CLEAR = 0.2;
const HUMAN_LEGS = [['UpperLeg', 'LowerLeg'], ['LowerLeg', 'Foot']];
const HORSE_LEGS = [
  ['Femur', 'Gaskin'], ['Gaskin', 'HindCannon'],
  ['Scapula', 'Humerus'], ['Humerus', 'Forearm'], ['Forearm', 'ForeCannon'],
  ['ForeCannon', 'ForePastern'], ['ForePastern', 'ForeHoof'],
];
// A walk at pace with the saddle, not yet slowing to arrive as the carry raises it onto its place over the walk's last second (a share of
// its top speed; tuned), a walk at all (m/s); a lead walk at speed (m/s); the saddle near the horse (its x, m); lifted (m, above contact jitter).
const AT_PACE = 0.75;
const WALKING = 0.3;
const LEADING = 0.8;
const AT_HORSE = -0.7;
const LIFT_RISE = 0.01;
const DEGREES = 180 / Math.PI;

// Every story on the default body and on the skeletons unlike it: what holds of a stable hand holds of any body. The cases that do not
// hold yet are listed below (expected to fail: each one fixed comes off the list), each with what fails, at seed 0.
const BODIES: readonly [on: string, skeleton: PersonSkeleton | undefined][] = [['', undefined], [' on the soldier', SOLDIER], [' on the outlier', OUTLIER]];
const test = cases([
  // The default body's head, turning from the saddle on the horse to the knot (its eyes borrowed by the grab), peaks at 431°/s, over
  // the 378°/s its 94° shift allows.
  `turns its eyes from the saddle's place to the horse, to the knot and back to the horse upright, never turning back`,
  // At other life seeds, its right hand going for the knot behind its right shoulder (facing the horse after checking the fit) passes
  // its forearm into its trunk: 4.7 cm at 12.5 s (seed 3), 12.5 cm at 13.7 s (seed 1, its start varied #2).
  ['leads upright with the near hand forward, slack outside, and halts beyond the gate', [3]],
  ['takes the slack across into its left hand in front of the hip, the 2.4 m rope keeping its length #0', [3]],
  ['takes the slack across into its left hand in front of the hip, the 2.4 m rope keeping its length #2', [1]],
  // The soldier (arms 0.46 m against the default's 0.60) lifts the 8 kg saddle off its rack and never draws it in: 4.9–5.4 cm off its
  // course's end after 2 s ('late carry' at 7.3–7.8 s), the grab never ends and the story stops there; it squats to the saddle
  // on its 0.88 m rack, its knees bent 62° as it takes hold (35° at most).
  'leads upright with the near hand forward, slack outside, and halts beyond the gate on the soldier',
  `turns its eyes from the saddle's place to the horse, to the knot and back to the horse upright, never turning back on the soldier`,
  ...[0, 1, 2].map((seed) => `takes the slack across into its left hand in front of the hip, the 2.4 m rope keeping its length on the soldier #${seed}`),
  ...[0, 1, 2].map((seed) => `carries below the face until arrival and places clear of both bodies on the soldier #${seed}`),
  // The outlier (legs 0.7×, arms 1.3×) puts the saddle on the horse 4.6–5.1 cm short of its place, never at rest there ('late carry'
  // at 11.8–12.4 s): the carry never ends and the story stops there; walking up to the rack its right hand is 2.1 cm in its trunk at
  // 2.2 s. Its start varied (#1, #2), it carries the saddle 1.1–1.4 cm above its shoulders; at other life seeds unvaried too (1.2–1.3 cm).
  'leads upright with the near hand forward, slack outside, and halts beyond the gate on the outlier',
  `turns its eyes from the saddle's place to the horse, to the knot and back to the horse upright, never turning back on the outlier`,
  ...[0, 1, 2].map((seed) => `takes the slack across into its left hand in front of the hip, the 2.4 m rope keeping its length on the outlier #${seed}`),
  ...[1, 2].map((seed) => `carries below the face until arrival and places clear of both bodies on the outlier #${seed}`),
  ['carries below the face until arrival and places clear of both bodies on the outlier #0', [1, 2, 3]],
]);

for (const [on, skeleton] of BODIES) {

test(`leads upright with the near hand forward, slack outside, and halts beyond the gate${on}`, () => {
  const run = staged(skeleton);
  const { sim, handler, person, mare, saddle, knot, slack, halter } = run;
  const atHandler = (name: string) => handler.pose.position(handler.pose.skeleton.index(name)).clone();
  const atHorse = (name: string) => mare.pose.position(mare.pose.skeleton.index(name)).clone();
  let settingOff = Infinity, eyesAt = Infinity;
  let gripAt = Infinity, liftAt = Infinity, contactKnee = NaN, contactPitch = NaN;
  let airborneTilt = 0, saddleOverRail = Infinity;
  let untiedAt = NaN, slackAt = NaN, firstStep = NaN, horseStep = NaN;
  let untieLegGap = Infinity, leadingLegGap = Infinity, leadGap = Infinity, ropeGap = Infinity, postGap = Infinity;
  let leading = 0, halted = 0;
  const nearHalter: number[] = [];
  const chest: number[] = [], roll: number[] = [], femurs: number[][] = [[], []];
  const phases = ['planted', 'planted'];
  const rest = saddle.getWorldPosition(new Vector3()).y;
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const t = sim.t;
    const at = saddle.getWorldPosition(new Vector3());
    if (person.locomotion.velocity.length() > 0.01) settingOff = Math.min(settingOff, t);
    if (handler.owners.look) eyesAt = Math.min(eyesAt, t);
    // (taken up: the hands close on the saddle, then it is lifted off its rack)
    if (!Number.isFinite(gripAt) && handler.holds(saddle)) {
      gripAt = t;
      contactKnee = ['left', 'right'].reduce((sum, side) => sum + handler.pose.local(handler.pose.skeleton.index(`${side}LowerLeg`)).angleTo(new Quaternion()), 0) / 2 * DEGREES;
      contactPitch = new Euler().setFromQuaternion(handler.pose.rotation(handler.pose.skeleton.index('chest')), 'YXZ').x * DEGREES;
    }
    if (handler.holds(saddle) && at.y > rest + LIFT_RISE) liftAt = Math.min(liftAt, t);
    if (handler.holds(saddle) && at.y > 1.25) {
      airborneTilt = Math.max(airborneTilt, new Vector3(0, 1, 0).applyQuaternion(saddle.getWorldQuaternion(new Quaternion())).angleTo(new Vector3(0, 1, 0)));
    }
    // (any crossing of the tie rail passes above it: its lowest point, the skirts' hems, over the rail)
    if (handler.holds(saddle) && Math.abs(at.x - RAIL.x) < 0.33 && at.z > RAIL.from - 0.3 && at.z < RAIL.to + 0.3) saddleOverRail = Math.min(saddleOverRail, at.y - 0.3 - RAIL.height);
    const tied = knot.parent?.name === 'tie rail';
    if (!tied && Number.isNaN(untiedAt)) untiedAt = t;
    if (handler.holds(slack) && Number.isNaN(slackAt)) slackAt = t;
    if (!Number.isNaN(slackAt) && Number.isNaN(firstStep) && person.feet.some((foot) => foot.phase === 'swing')) firstStep = t;
    if (!Number.isNaN(untiedAt) && Number.isNaN(horseStep) && mare.position.distanceTo(TIED) > 0.001) horseStep = t;
    // (the legs clear of the horse's as it unties and leads)
    const legGap = Math.min(...['left', 'right'].flatMap((side) => HUMAN_LEGS.flatMap(([a, b]) => ['left', 'right'].flatMap((s) => HORSE_LEGS.map(([c, d]) =>
      segmentDistance(atHandler(`${side}${a}`), atHandler(`${side}${b}`), atHorse(`${s}${c}`), atHorse(`${s}${d}`)) - LEG_RADIUS * person.proportions.height - HORSE_LEG_RADIUS)))));
    if (saddle.parent?.name === 'saddled' && tied) untieLegGap = Math.min(untieLegGap, legGap);
    if (!Number.isNaN(firstStep)) leadingLegGap = Math.min(leadingLegGap, legGap);
    const poll = atHorse('head'), muzzle = mare.pose.point(mare.pose.skeleton.index('head'), MUZZLE, new Vector3());
    if (!tied) for (const [a, b] of [['hips', 'chest'], ['chest', 'neck'], ['neck', 'head']]) for (const [c, d] of [[atHorse('neck'), poll], [poll, muzzle]]) {
      leadGap = Math.min(leadGap, segmentDistance(atHandler(a), atHandler(b), c, d) - BODY_RADIUS * person.proportions.height - HORSE_HEAD_RADIUS);
    }
    if (Number.isNaN(firstStep) || t < firstStep + 3) continue;
    // halted beyond the gate, the horse's head clear of its posts
    if (person.locomotion.settled) {
      halted++;
      for (const x of [0.9, -2.65]) postGap = Math.min(postGap, segmentDistance(poll, muzzle, new Vector3(x, 0, GATE), new Vector3(x, 1.6, GATE)) - HORSE_HEAD_RADIUS - POST_RADIUS);
    }
    // each foot landing on its own side of the walk
    person.feet.forEach((foot, s) => {
      const landed = foot.phase === 'planted' && phases[s] === 'swing';
      phases[s] = foot.phase;
      if (!landed || person.locomotion.velocity.length() < LEADING) return;
      const offset = foot.position.clone().sub(atHandler('hips'));
      const facing = person.locomotion.facing;
      expect((offset.x * Math.cos(facing) - offset.z * Math.sin(facing)) * (s === 0 ? 1 : -1)).toBeGreaterThan(0);
    });
    if (person.locomotion.velocity.length() < LEADING) continue;
    leading++;
    expect(person.holding.left?.thing).toBe(slack);
    chest.push(new Euler().setFromQuaternion(handler.pose.rotation(handler.pose.skeleton.index('chest')), 'YXZ').x);
    // the near hand forward and toward the horse, beside its halter; the slack hand outside the hip and in front of it
    const right = atHandler('rightHand').sub(atHandler('chest'));
    expect(right.z).toBeGreaterThan(0.25);
    expect(right.x).toBeLessThan(-0.1);
    const left = atHandler('leftHand').sub(atHandler('hips'));
    expect(left.x).toBeGreaterThan(0.15);
    expect(left.z).toBeGreaterThan(0.1);
    // (the near hand by the halter once the horse keeps its place at the handler's side: catching up, its head is further back)
    if (mare.position.distanceTo(run.led.position) < 0.1) nearHalter.push(atHandler('rightHand').distanceTo(halter.getWorldPosition(new Vector3())));
    // the rope clear of the trunk
    const points = ropePoints(run.rope);
    for (let k = 1; k < points.length; k++) {
      ropeGap = Math.min(ropeGap, segmentDistance(points[k - 1], points[k], atHandler('hips'), atHandler('chest')) - BODY_RADIUS * person.proportions.height - ROPE_RADIUS);
    }
    // beside the throatlatch: ahead of the horse's moving shoulder and its foreleg swing, behind its poll
    const shoulder = (atHorse('leftScapula').z + atHorse('rightScapula').z) / 2;
    if (t > firstStep + 5) {
      expect(atHandler('hips').z - shoulder).toBeGreaterThan(SHOULDER_CLEAR);
      expect(atHandler('hips').z - shoulder).toBeLessThan(poll.z - shoulder);
    }
    femurs.forEach((angles, s) => angles.push(new Euler().setFromQuaternion(mare.pose.local(mare.pose.skeleton.index(`${['left', 'right'][s]}Femur`)), 'YZX').x));
    roll.push(new Euler().setFromQuaternion(mare.pose.local(mare.pose.skeleton.index('pelvis')), 'YXZ').z);
  }
  // it sets off at once, its eyes first
  expect(settingOff).toBeLessThan(0.3);
  expect(eyesAt).toBeLessThanOrEqual(settingOff);
  // (the saddle rests on its rack at 0.88 m, about knuckle height, the best lifting origin (NIOSH: Waters 1993, recalled): taken up at
  // once, with the knees neither locked nor squatting and the trunk bowed no more than 35°)
  expect(liftAt - gripAt).toBeLessThanOrEqual(0.3);
  expect(contactKnee).toBeGreaterThanOrEqual(0);
  expect(contactKnee).toBeLessThanOrEqual(35);
  expect(contactPitch).toBeLessThanOrEqual(35);
  expect(airborneTilt * DEGREES).toBeLessThan(5);
  expect(saddleOverRail).toBeGreaterThan(0);
  // untied, it takes the slack and sets off with both hands on the lead where it keeps them (tuned: 1.5 s); the horse follows as its
  // lead comes up level with its head (tuned: 2 s)
  expect(firstStep - slackAt).toBeGreaterThanOrEqual(0);
  expect(firstStep - slackAt).toBeLessThan(1.5);
  expect(horseStep).toBeGreaterThanOrEqual(firstStep);
  expect(horseStep - firstStep).toBeLessThan(2);
  expect(untieLegGap).toBeGreaterThan(0);
  expect(leadingLegGap).toBeGreaterThan(0.02);
  expect(leadGap).toBeGreaterThan(0.02);
  expect(ropeGap).toBeGreaterThan(0.02);
  // (the lead held 15–30 cm below the halter, as horsemanship guides teach (recalled), on average: the horse's head nods and surges
  // with its walk, and the rope gives with it, never more than 40 cm off; tuned)
  const nearMean = nearHalter.reduce((sum, near) => sum + near, 0) / nearHalter.length;
  expect(nearMean).toBeGreaterThan(0.15);
  expect(nearMean).toBeLessThan(0.3);
  expect(Math.max(...nearHalter)).toBeLessThan(0.4);
  expect(postGap).toBeGreaterThan(0.02);
  // (upright as people walk, not plumb: the trunk leans ~6° forward walking — read: Thorstensson et al. 1984, Acta Physiol Scand 121:9,
  // abstract — the thorax 8.6 ± 3.9° off the vertical in one group — read: Leardini et al. 2013, PLoS ONE 8:e77168)
  expect(Math.max(...chest.map(Math.abs)) * DEGREES).toBeLessThan(10);
  expect(leading).toBeGreaterThan(60);
  expect(halted).toBeGreaterThan(30);
  // (the led horse walks, its hips swinging: a pelvis roll over 5.5° and a femur excursion of at least 10° — floors, not a band tuned to
  // the scene's lead speed, which would judge the horse's legs rather than the handler; tuned, no equine source read)
  expect((Math.max(...roll) - Math.min(...roll)) * DEGREES).toBeGreaterThan(5.5);
  for (const angles of femurs) expect((Math.max(...angles) - Math.min(...angles)) * DEGREES).toBeGreaterThan(10);
  expect(handler.log).toEqual([]);
  expect(mare.log).toEqual([]);
  expect(sim.stage.done()).toBe(true);
}, 30000);

for (const seed of [0, 1, 2]) test(`carries below the face until arrival and places clear of both bodies${on} #${seed}`, () => {
  const run = staged(skeleton, seed, false);
  const { sim, handler, person, mare, saddle } = run;
  const atHandler = (name: string) => handler.pose.position(handler.pose.skeleton.index(name)).clone();
  const atHorse = (name: string) => mare.pose.position(mare.pose.skeleton.index(name)).clone();
  const H = person.proportions.height;
  const rest = saddle.getWorldPosition(new Vector3()).y;
  let headGap = Infinity, torsoGap = Infinity, legGap = Infinity, barrelGap = Infinity, railGap = Infinity, footAcross = Infinity;
  const lifting: Quaternion[] = [], carried: { speed: number; height: number }[] = [];
  while (sim.t < 25) {
    sim.step();
    const feet = atHandler('leftFoot').sub(atHandler('rightFoot'));
    const facing = person.locomotion.facing;
    footAcross = Math.min(footAcross, feet.x * Math.cos(facing) - feet.z * Math.sin(facing));
    const at = saddle.getWorldPosition(new Vector3());
    // taking it up from when its hands close on it (its eyes going on to its place meanwhile), the head no faster than a calm gaze shift
    if (handler.holds(saddle) && handler.owners.hands.left?.verb === 'grab') lifting.push(handler.pose.rotation(handler.pose.skeleton.index('head')).clone());
    if (!handler.holds(saddle) || at.y <= rest + LIFT_RISE) continue;
    for (const side of ['left', 'right']) for (const [a, b] of HUMAN_LEGS) for (const [c, d] of run.rail) {
      railGap = Math.min(railGap, segmentDistance(atHandler(`${side}${a}`), atHandler(`${side}${b}`), c, d) - LEG_RADIUS * H - RAIL_RADIUS);
    }
    // the saddle clear of the head and the trunk
    headGap = Math.min(headGap, outside(run.saddleBoxes, person.point('head', person.proportions.headCenter)) - HEAD_RADIUS * H);
    for (const [a, b, radius] of [['hips', 'chest', BODY_RADIUS], ['chest', 'neck', THORAX_RADIUS]] as const) {
      const from = atHandler(a), to = atHandler(b);
      for (let k = 0; k <= 16; k++) torsoGap = Math.min(torsoGap, outside(run.saddleBoxes, from.clone().lerp(to, k / 16)) - radius * H);
    }
    // carried low walking there, below the shoulders, until it is raised onto its place
    carried.push({ speed: person.locomotion.velocity.length(), height: at.y });
    if (at.x > AT_HORSE) continue;
    // placing it, clear of the horse's barrel and its legs
    barrelGap = Math.min(barrelGap, atHandler('hips').x - mare.position.x - HORSE_HALF_WIDTH - BODY_RADIUS * H);
    for (const side of ['left', 'right']) for (const [a, b] of HUMAN_LEGS) for (const s of ['left', 'right']) for (const [c, d] of HORSE_LEGS) {
      legGap = Math.min(legGap, segmentDistance(atHandler(`${side}${a}`), atHandler(`${side}${b}`), atHorse(`${s}${c}`), atHorse(`${s}${d}`)) - LEG_RADIUS * H - HORSE_LEG_RADIUS);
    }
  }
  const top = Math.max(...carried.map(({ speed }) => speed));
  const walking = carried.filter(({ speed }) => speed > AT_PACE * top);
  // (it walks there with it: a walk's speed, not a sway's)
  expect(top).toBeGreaterThan(WALKING);
  for (const { height } of walking) expect(height).toBeLessThan(person.proportions.shoulderHeight);
  expect(torsoGap).toBeGreaterThan(0.02);
  const lift = headShift(lifting, 1 / 60);
  expect(lift.peak).toBeLessThan(SHIFT_BOUNDS.peak(lift.amplitude));
  expect(railGap).toBeGreaterThan(0);
  expect(footAcross).toBeGreaterThan(0);
  // (2 cm of reserve, rather than a pass/fail boundary at contact)
  expect(headGap).toBeGreaterThan(0.02);
  expect(legGap).toBeGreaterThan(0);
  expect(barrelGap).toBeGreaterThan(0);
}, 30000);

test(`turns its eyes from the saddle's place to the horse, to the knot and back to the horse upright, never turning back${on}`, () => {
  const { sim, handler, saddle, slack } = staged(skeleton);
  // (each shift in its task's first 1.5 s: lifting the saddle, the eyes leave the rack for its place on the horse; then the
  // saddle's back for the knot by the horse's head, behind the other shoulder; then the knot for the horse's head as they lead off.
  // Not a single bell, as on a body standing still (gaze.test.ts): stepping round, the trunk carries on a head held at the neck's range
  // after its shift, and the knot, out of view, is looked at once the body has turned to it)
  const begins: Record<string, () => boolean> = {
    'lifting the saddle': () => handler.holds(saddle),
    'untying the knot': () => saddle.parent?.name === 'saddled' && handler.owners.hands.right?.verb === 'grab',
    'leading out': () => handler.holds(slack),
  };
  const started = new Map<string, number>(), shifts = new Map<string, Quaternion[]>(Object.keys(begins).map((task) => [task, []]));
  const all: Quaternion[] = [];
  while (sim.t < 20) {
    sim.step();
    const head = handler.pose.rotation(handler.pose.skeleton.index('head')).clone();
    all.push(head);
    for (const [task, begun] of Object.entries(begins)) {
      if (!started.has(task) && begun()) started.set(task, sim.t);
      const from = started.get(task);
      if (from !== undefined && sim.t - from <= 1.5) shifts.get(task)?.push(head);
    }
  }
  for (const [task, heads] of shifts) {
    expect(started.has(task), `${task} begins within 20 s`).toBe(true);
    const shift = headShift(heads, 1 / 60);
    expect(shift.amplitude, task).toBeGreaterThan(45);
    expect(shift.peak, task).toBeLessThan(SHIFT_BOUNDS.peak(shift.amplitude));
    expect(shift.swing, task).toBeLessThan(SHIFT_BOUNDS.swing);
  }
  expect(headShift(all, 1 / 60).roll).toBeLessThan(SHIFT_BOUNDS.roll);
}, 30000);

for (const seed of [0, 1, 2]) test(`takes the slack across into its left hand in front of the hip, the 2.4 m rope keeping its length${on} #${seed}`, () => {
  const run = staged(skeleton, seed);
  const { sim, handler, person, knot, slack } = run;
  const atHandler = (name: string) => handler.pose.position(handler.pose.skeleton.index(name)).clone();
  let rightAt = NaN, leftAt = NaN;
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const points = ropePoints(run.rope);
    // The lead rope keeps its length (2.4 m) whatever holds it, within 2% (tuned bound), and lies on the ground, never in it.
    const length = points.slice(1).reduce((sum, point, k) => sum + point.distanceTo(points[k]), 0);
    if (sim.t > 1) expect(Math.abs(length - LEAD_ROPE) / LEAD_ROPE).toBeLessThan(0.02);
    expect(Math.min(...points.map((point) => point.y))).toBeGreaterThanOrEqual(0);
    if (!handler.holds(knot)) continue;
    if (Number.isNaN(rightAt)) {
      rightAt = sim.t;
      expect(person.holding.left).toBeNull();
    }
    // (the slack hangs from the hands: in a loop below the knot's, then from the left too)
    const loop = Math.min(...points.slice(Math.round(points.length / 2), Math.round((points.length - 1) * 0.875) + 1).map((point) => point.y));
    expect(loop).toBeLessThan(knot.getWorldPosition(new Vector3()).y);
    if (!handler.holds(slack)) continue;
    if (Number.isNaN(leftAt)) {
      leftAt = sim.t;
      // (taken in front of the hip, from the near hand)
      const facing = person.locomotion.facing;
      const ahead = atHandler('leftHand').sub(atHandler('hips'));
      expect(ahead.x * Math.sin(facing) + ahead.z * Math.cos(facing)).toBeGreaterThan(0.1);
    }
    expect(person.holding.left?.thing).toBe(slack);
    expect(points[points.length - 1].y).toBeLessThan(slack.getWorldPosition(new Vector3()).y);
  }
  expect(leftAt - rightAt).toBeGreaterThan(0.3);
  expect(leftAt - rightAt).toBeLessThan(3);
  expect(handler.log).toEqual([]);
}, 30000);
}

// What the story leans on, as small scenes: a hand kept on a watching horse's halter, a carry onto the body as it walks (an open one is
// listed here: expected to fail, it comes off the list once fixed).
const library = cases([]);

library('a person takes hold of the halter of a horse watching it', () => {
  const sim = new Simulation(scene((cast) => {
    const person = cast.person({ at: new Vector3(-0.5, 0, 3.3), face: -0.3 });
    const mare = cast.body(horse(HORSE), { at: TIED });
    const halter = empty(mare.bones.head, 'halter', new Vector3(0, -0.3, 0.05));
    empty(halter, 'lead', new Vector3(0, -0.25, 0)).userData.handTurn = [0, 1, 0];
    let held = false;
    return {
      bodies: [person, mare],
      story: () => parallel('race', lookAt(mare, person.bones.head, { until: Infinity }), function* () {
        yield* grab(person, halter, { right: 'lead' }, { until: 8 });
        held = person.holds(halter);
      }),
      done: () => held,
    };
  }), { dev: true });
  while (sim.t < 10) sim.step();
  expect(sim.stage.done()).toBe(true);
  expect(sim.stage.bodies[0].log).toEqual([]);
}, 30000);

library('a person walking carries what it holds onto a place on its own body', () => {
  const sim = new Simulation(scene((cast, scene) => {
    const person = cast.person();
    const knot = box(scene, 'knot', new Vector3(0.04, 0.04, 0.04), new Vector3(-0.25, 1, 0.35));
    knot.userData.mass = 0.2;
    const held = empty(person.object, 'held', new Vector3(-0.45, 1.33, 0.3));
    let walked = false;
    return {
      bodies: [person],
      story: function* () {
        yield* grab(person, knot, { right: 'knot' });
        // (a second into the walk, at its pace, the hand brings the knot up to where it keeps it)
        yield* parallel('race', function* () {
          yield* wait(1);
          yield* carry(person, knot, held, { until: Infinity });
        }, function* () {
          walked = yield* walkTo(person, new Vector3(0, 0, 6));
        });
      },
      done: () => walked,
    };
  }), { dev: true });
  while (sim.t < 12) sim.step();
  expect(sim.stage.done()).toBe(true);
  expect(sim.stage.bodies[0].log).toEqual([]);
}, 30000);

/** stable-morning on `skeleton` (or the cast's own), its handler varied by `seed` (0: not), with development checks or not, and its things */
function staged(skeleton?: PersonSkeleton, seed = 0, dev = true) {
  const sim = new Simulation(stableMorning(), { dev, skeleton, vary: seed ? seeded(seed) : undefined });
  const [handler, mare] = sim.stage.bodies as [Body, Body];
  const thing = (name: string) => {
    const found = sim.stage.scene.getObjectByName(name);
    if (!found) throw new Error(`stable-morning has no ${name}`);
    return found;
  };
  const saddle = thing('saddle');
  const posts = [RAIL.from, RAIL.to].map((z) => [new Vector3(RAIL.x, 0, z), new Vector3(RAIL.x, 1.2, z)]);
  return {
    sim, handler, mare, saddle,
    person: new Actor(sim.people[0]),
    knot: thing('knot'), slack: thing('slack'), halter: thing('halter'), led: thing('led'), rope: thing('lead rope') as Line,
    saddleBoxes: [saddle, ...saddle.children].filter((part): part is Mesh => part instanceof Mesh),
    rail: [...posts, [new Vector3(RAIL.x, RAIL.height, RAIL.from), new Vector3(RAIL.x, RAIL.height, RAIL.to)]],
  };
}

/** a scene of `stage`'s bodies and story, its props under the scene it is given */
function scene(stage: (cast: Cast, scene: Group) => Omit<ReturnType<Scenario['stage']>, 'scene'>): Scenario {
  return { id: 'stable-morning-defect', title: 'a defect', duration: 12, stage: (cast) => {
    const group = new Group();
    return { scene: group, ...stage(cast, group) };
  } };
}

/** how far `point` (world) is outside the nearest of `boxes` (box meshes; 0 inside one) */
function outside(boxes: readonly Mesh[], point: Vector3): number {
  return Math.min(...boxes.map((mesh) => {
    const { width, height, depth } = (mesh.geometry as BoxGeometry).parameters;
    mesh.updateWorldMatrix(true, false);
    const local = mesh.worldToLocal(point.clone());
    return Math.hypot(Math.max(0, Math.abs(local.x) - width / 2), Math.max(0, Math.abs(local.y) - height / 2), Math.max(0, Math.abs(local.z) - depth / 2));
  }));
}

/** the rope's points as it was last drawn (world) */
function ropePoints(rope: Line): Vector3[] {
  const position = rope.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, k) => new Vector3().fromBufferAttribute(position, k));
}
