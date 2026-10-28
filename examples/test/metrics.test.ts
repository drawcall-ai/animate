// Scenario statistics and task accuracy under small changes. Run: pnpm metrics [-- -t <id>]
import { setImmediate } from 'node:timers/promises';
import { Group, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { afterEach, expect, it, vi } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { pickupShelf } from '../src/scenarios/pickup';
import { knightArming } from '../src/scenarios/knight';
import { stroll, walkThere } from '../src/scenarios/stroll';
import { lookAround, reaching, vr } from '../src/scenarios/tracking';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { checks, failed, measure, type MetricsOptions } from './metrics';
import { frames } from './frame';
import { GaitKinematics } from './gait';
import { cases, type Open } from '../../packages/animate/test/open';

// Whole-scene simulations can occupy a worker for over a minute; let Vitest receive its RPC replies between cases.
afterEach(() => setImmediate());

/** Keep task accuracy, gait and clearance regressions that the runtime checks do not cover. */
function judged(sc: Scenario, strides?: MetricsOptions['strides']) {
  const sim = new Simulation(sc);
  const m = measure(sc.id, frames(sim));
  const options: MetricsOptions = { startStop: null, strides };
  // Gait coverage and start/stop blending are run-level regressions.
  // (setting off, the trunk leans ~7° forward between the first knee movement and the first heel strike, under a second — read:
  // Leteneur et al. 2013, PLoS ONE 8:e55256 — on top of the stride's own nod; tuned: its pitch up to 1.75× walking's peak, the pelvis's 1.25×)
  if (sc.id === 'stroll') { options.strides ??= { straight: 3, curve: 3 }; options.startStop = { trunk: 1.75, pelvis: 1.25 }; }
  // Hands on what they hold and item clearance; neither has a built-in check. (Tracked targets are judged by their course in
  // `Targets`, not by one fixed margin per scene.)
  if (sc.id === 'stable-morning') options.clearance = 0;
  if (sc.id === 'pickup-shelf') options.wrist = 0.04;
  if (sc.id === 'knight-arming') { options.wrist = 0.03; options.clearance = 0.015; options.strides ??= { straight: 3, curve: 0 }; }
  expect(sim.stage.done(), `${sc.id} finished`).toBe(true);
  const fails = checks(m, options).filter(failed).map((c) => `${c.what}${c.where ? ` (${c.where})` : ''}: ${c.value} (${c.bound} ${c.limit}) @${c.at ?? 0}s`);
  expect(fails, fails.join('\n')).toEqual([]);
}

it('lists each scenario once', () => {
  const ids = SCENARIOS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// Expected failures still present at the listed life seeds. Finished viewer stories are guarded separately in viewer.test.ts.
// Upstream tiptoe settlement retains the higher target's 55–56 mm wrist error (50 mm bound).
// The upstream forward-shifted knight remains open at seed 2: helm rim 23.2 mm into the forearm (15 mm bound).
const OPEN: Open[] = [
  ['knight-arming, the stand, wall and rack 15 cm further on', [2]],
  ['reach, the targets 10 cm higher', [0, 2]],
  'stroll 15% faster',
  'look-around, the headset 20% faster',
  ["look-around, looking down 10 cm nearer", [0]],
  'look-around, looking down 10 cm further off',
  ["look-around, turned 0.3 rad left", [0]],
  'knight-arming, the stand, wall and rack 15 cm further left',
  'knight-arming, 20% slower',
  ["stroll round a sharp 0.6 m turn", [2]],
];
// (and the known task-accuracy failures, `known()`, below)
const KNOWN = known();
const check = cases([...OPEN, 'vr', ...KNOWN.map(([name]) => name)]);

// These metrics assume humanoid balance owns h.feet/h.locomotion and centres the CoM.
// The isolated leg scenes have final-pose contact/ROM/rate coverage in legs.test.ts and dev.test.ts.
for (const sc of SCENARIOS.filter((s) => !['legs-biped', 'legs-horse', 'dog-fetch', 'lion-run'].includes(s.id))) {
  check(sc.id, () => judged(sc));
}

// the same limits a little off the script: no metric may hang on its exact numbers
// (a variation that walks less than its scenario says how few strides it judges: none go unjudged silently)
const NONE = { straight: 0, curve: 0 };
const VARIATIONS: [string, Scenario, MetricsOptions['strides']?][] = [
  ['stroll 15% slower', stroll({ speed: 0.85 })],
  ['stroll 15% faster', stroll({ speed: 1.15 })],
  ['stroll on a 20% tighter arc', stroll({ radius: 2.4 })],
  ['stroll on a 20% wider arc', stroll({ radius: 3.6 })],
  ['stroll setting off turned 0.3 rad left', stroll({ yaw: 0.3 })],
  ['stroll setting off turned 0.3 rad right', stroll({ yaw: -0.3 })],
  ['stroll setting off turned a quarter turn away', stroll({ yaw: Math.PI / 2 })],
  ['stroll setting off facing away', stroll({ yaw: Math.PI })],
  // (round so sharp a bend the body slows below a walk's speed: no curve strides to judge)
  ['stroll round a sharp 0.6 m turn', stroll({ radius: 0.6 }), { straight: 3, curve: 0 }],
  ['walk to a point 2 m behind', walkThere(new Vector3(0, 0, -2)), NONE],
  ['walk to a point 2 m to the right', walkThere(new Vector3(-2, 0, 0)), NONE],
  ['turn round in place', walkThere(new Vector3(0, 0, 0), Math.PI), NONE],
  ['walk 4 m ahead, turning round on arrival', walkThere(new Vector3(0, 0, 4), Math.PI), NONE],
  ['stroll setting off turned 3/4 of a half turn left', stroll({ yaw: (3 * Math.PI) / 4 })],
  ['stroll setting off turned 3/4 of a half turn right', stroll({ yaw: (-3 * Math.PI) / 4 })],
  ['pickup-shelf, the box 10 cm nearer', pickupShelf({ nearer: 0.1 })],
  ['pickup-shelf, the box 10 cm farther', pickupShelf({ nearer: -0.1 })],
  ['pickup-shelf, the box 5 cm higher', pickupShelf({ taller: 0.1 })],
  ['pickup-shelf, the box 5 cm lower', pickupShelf({ taller: -0.1 })],
  ['pickup-shelf, the shelf 5 cm lower', pickupShelf({ lower: 0.05 })],
  ['pickup-shelf, the box behind', pickupShelf({ around: Math.PI })],
  ['pickup-shelf, the box lifted to the chest in 1.2 s', pickupShelf({ lift: 1.2 })],
  ['look-around, the headset 20% faster', lookAround({ pace: 1.2 })],
  ['look-around, the headset 20% slower', lookAround({ pace: 0.8 })],
  ['look-around, looking down 10 cm nearer', lookAround({ shift: { x: 0, z: 0.1 } })],
  ['look-around, looking down 10 cm lower', lookAround({ rise: -0.1 })],
  // (off the known list since the head is judged by its course, 2026-10-22: it lags a moving target, holds within 5 cm)
  ['look-around, looking down 10 cm further off', lookAround({ shift: { x: 0, z: -0.1 } })],
  ['look-around, turned 0.3 rad left', lookAround({ turn: 0.3 })],
  ['look-around, turned 0.3 rad right', lookAround({ turn: -0.3 })],
  ['reach, the targets 10 cm to the left', reaching({ shift: { x: 0.1, z: 0 } })],
  ['reach, the targets 10 cm nearer', reaching({ shift: { x: 0, z: -0.1 } })],
  ['reach, the targets 10 cm to the right', reaching({ shift: { x: -0.1, z: 0 } })],
  ['reach, the targets 10 cm higher', reaching({ rise: 0.1 })],
  ['reach, the targets 10 cm lower', reaching({ rise: -0.1 })],
  ['reach, turned 0.3 rad right', reaching({ turn: -0.3 })],
  ['reach, turned 0.3 rad left', reaching({ turn: 0.3 })],
  ['reach, the hand 20% slower', reaching({ pace: 0.8 })],
  ['reach, the hand 20% faster', reaching({ pace: 1.2 })],
  ['knight-arming, the stand, wall and rack 15 cm further left', knightArming({ shift: { x: 0.15, z: 0 } })],
  ['knight-arming, the stand, wall and rack 15 cm further right', knightArming({ shift: { x: -0.15, z: 0 } })],
  ['knight-arming, the stand, wall and rack 15 cm further on', knightArming({ shift: { x: 0, z: 0.15 } })],
  ['knight-arming, the stand, wall and rack 15 cm nearer', knightArming({ shift: { x: 0, z: -0.15 } })],
  ['knight-arming, the gear 10 cm higher', knightArming({ rise: 0.1 })],
  ['knight-arming, the gear 10 cm lower', knightArming({ rise: -0.1 })],
  ['knight-arming, the knight 5% taller', knightArming({ height: 1.75 * 1.05 })],
  ['knight-arming, the knight 5% shorter', knightArming({ height: 1.75 * 0.95 })],
  ['knight-arming, 20% quicker', knightArming({ pace: 1.2 })],
  ['knight-arming, 20% slower', knightArming({ pace: 0.8 })],
  ['knight-arming, the stand, wall and rack on the other sides', knightArming({ mirror: true })],
  ['knight-arming, the helm turned a quarter on its stand', knightArming({ helmTurn: Math.PI / 2 })],
  ['knight-arming, the helm turned a quarter the other way', knightArming({ helmTurn: -Math.PI / 2 })],
  ['knight-arming, the helm turned half round on its stand: walked round to take it', knightArming({ helmTurn: Math.PI })],
  ['knight-arming, mirrored, the helm turned half round: walked round the stand clear of it', knightArming({ mirror: true, helmTurn: Math.PI })],
  ['knight-arming, the shield\'s wall turned 0.4 rad', knightArming({ wallTurn: 0.4 })],
  ['knight-arming, the shield\'s wall turned −0.4 rad', knightArming({ wallTurn: -0.4 })],
];
for (const [name, sc, strides] of VARIATIONS) check(name, () => judged(sc, strides));

// Known task-accuracy failures, tracked until fixed.
function known(): [string, Scenario][] {
  return [
  // a head bent down off the line the body faces, or a little further than it bows to, is reached by
  // the spine alone: `balance` carries the centre of mass toward it only by walking, and walks only
  // to a goal 14 cm off (asks.lean, being built, is the way: the weight shifted within the feet).
  // Higher the eyes miss (8 cm); further left the spine bends sideways and carries
  // the shoulder 5 cm in over the squatting thigh: a hand hanging clear of it is out 17° (free arms: ≤ 12°)
  ['look-around, looking down 10 cm higher', lookAround({ rise: 0.1 })],
  ['look-around, looking down 10 cm further left', lookAround({ shift: { x: 0.1, z: 0 } })],
  // the side-step: `balance` turns to walk sideways rather than keep the facing asked (no strafe yet),
  // so the body comes under the head late; and a controller on the floor turned off the body's facing,
  // or brought in close while rising to the cheer, is missed by more than the floor's own 15 cm
  ['vr, the trackers 20% faster', vr({ pace: 1.2 })],
  ['vr, the trackers 20% slower', vr({ pace: 0.8 })],
  ['vr, the controllers 10 cm further out', vr({ shift: { x: 0, z: 0.1 } })],
  ['vr, the controllers 10 cm nearer', vr({ shift: { x: 0, z: -0.1 } })],
  ['vr, the controllers 10 cm to the left', vr({ shift: { x: 0.1, z: 0 } })],
  ['vr, the controllers 10 cm higher', vr({ rise: 0.1 })],
  ['vr, the controllers 10 cm lower', vr({ rise: -0.1 })],
  ['vr, turned 0.3 rad left', vr({ turn: 0.3 })],
  ['vr, turned 0.3 rad right', vr({ turn: -0.3 })],
  ];
}
for (const [name, sc] of KNOWN) check(name, () => judged(sc));
// (known too: on a bend the outer foot's steps dip the pelvis 1.5–2 cm lower than straight)
it('stroll: the pelvis bobs on a bend within 1 cm of walking straight', () => {
  const m = measure('stroll', frames(new Simulation(stroll())));
  const straight = m.gait.summary(false, false);
  const curve = m.gait.summary(true, false);
  expect(straight && curve).toBeTruthy();
  if (!straight || !curve) throw new Error('no steady strides');
  expect(curve.pelvisUp, 'curve pelvis vertical (m)').toBeLessThanOrEqual(straight.pelvisUp + 0.01);
});

it('runs a scenario through the metrics: two people standing still, relaxed, each reading the other', () => {
  const seen: number[] = [];
  const still: Scenario = {
    id: 'still',
    title: 'Standing still',
    duration: 0.49,
    stage: (cast) => {
      const people = [cast.person({ at: new Vector3(-1, 0, 0) }), cast.person({ at: new Vector3(1, 0, 0), face: Math.PI })];
      return {
        scene: new Group(),
        bodies: people,
        done: () => true,
        story: () => action({ update: () => void seen.push(...people.map((_, index) => people[1 - index].position.x)) }),
      };
    },
  };
  const m = measure(still.id, frames(new Simulation(still)));
  expect(seen.length).toBe(2 * 30);
  expect(seen.every((x, i) => Math.abs(x - (i % 2 === 0 ? 1 : -1)) < 0.05)).toBe(true);
  expect(m.report).toContain('== still (30 frames)');
});

it('judges head roll while looking and outside samples borrowed by hand tasks', () => {
  const free = new GaitKinematics(), looking = new GaitKinematics();
  const borrowed = new GaitKinematics(), mixed = new GaitKinematics();
  let sample = 0;
  for (const [frame] of frames(new Simulation(stroll({ radius: Infinity })))) {
    free.see(frame);
    const owners = vi.spyOn(frame.h.body, 'owners', 'get');
    try {
      owners.mockReturnValue({ hands: {}, look: { verb: 'lookAt', site: '', tier: 'asked' } });
      looking.see({ ...frame, asked: new Map([...frame.asked, ['gaze', new Vector3(0, 0, 1)]]) });
      owners.mockReturnValue({ hands: {}, look: { verb: 'grab', site: '', tier: 'borrowed' } });
      borrowed.see(frame);
      if (sample++ % 2 === 0) owners.mockReturnValue({ hands: {} });
      mixed.see(frame);
    } finally {
      owners.mockRestore();
    }
  }
  const walking = free.summary(false, false), directed = looking.summary(false, false);
  const tasked = borrowed.summary(false, false), partial = mixed.summary(false, false);
  if (!walking || !directed || !tasked || !partial) throw new Error('no steady walking strides');
  expect(Number.isFinite(walking.headRoll)).toBe(true);
  expect(directed.headRoll).toBe(walking.headRoll);
  expect(Number.isNaN(tasked.headRoll)).toBe(true);
  expect(Number.isFinite(partial.headRoll)).toBe(true);
  expect(partial.headRoll).toBeLessThanOrEqual(walking.headRoll);
  expect(tasked.pelvisLat).toBe(walking.pelvisLat);
});
