// Scenario statistics and task accuracy under small changes. Run: pnpm metrics [-- -t <id>]
import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { createWorld, type Frame as BodyFrame, type World } from '@drawcall/animate';
import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { pickupShelf } from '../src/scenarios/pickup';
import { knightArming } from '../src/scenarios/knight';
import { stroll, walkThere } from '../src/scenarios/stroll';
import { lookAround, reach, vr } from '../src/scenarios/tracking';
import { Report } from '../src/report';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { checks, failed, measure, type MetricsOptions } from './metrics';
import type { Frame } from './frame';

/** Frames for the remaining scenario metrics, after each fixed step. */
function* steps(sim: Simulation): Generator<Frame[]> {
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const asked = sim.stage.report.at(sim.t);
    const solids = sim.stage.solids?.() ?? [];
    yield sim.actors.map((h) => ({ t: sim.t, h, asked, solids }));
  }
}

/** Keep task accuracy, gait and clearance regressions that the runtime checks do not cover. */
function judged(sc: Scenario, strides?: MetricsOptions['strides']) {
  const sim = new Simulation(sc);
  const m = measure(sc.id, steps(sim));
  const options: MetricsOptions = { startStop: null, strides };
  // Gait coverage and start/stop blending are run-level regressions.
  if (sc.id === 'stroll') { options.strides ??= { straight: 3, curve: 3 }; options.startStop = 1.25; }
  // Keep the known tracking misses below and item clearance; neither has a built-in check.
  if (sc.id === 'pickup-shelf') options.wrist = 0.04;
  if (sc.id === 'reach') options.wrist = 0.17;
  if (sc.id === 'look-around') options.head = 0.075;
  if (sc.id === 'vr') { options.wrist = 0.165; options.head = 0.165; }
  if (sc.id === 'knight-arming') { options.wrist = 0.03; options.clearance = 0.015; options.strides ??= { straight: 3, curve: 0 }; }
  expect(sim.stage.done(), `${sc.id} finished`).toBe(true);
  const fails = checks(m, options).filter(failed).map((c) => `${c.what}: ${c.value} (${c.bound} ${c.limit}) @${c.at ?? 0}s`);
  expect(fails).toEqual([]);
}

it('lists each scenario once', () => {
  const ids = SCENARIOS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// These metrics assume humanoid balance owns h.feet/h.gait and centres the CoM.
// The isolated leg scenes have final-pose contact/ROM/rate coverage in legs.test.ts and dev.test.ts.
for (const sc of SCENARIOS.filter((s) => !s.id.startsWith('legs-'))) {
  if (sc.id === 'vr') it.fails(`${sc.id} target tracking (known)`, () => judged(sc));
  else it(sc.id, () => judged(sc));
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
  ['walk within reach of a point 2 m to the left, no facing asked', walkThere(new Vector3(2, 0, 0), undefined, 0.45), NONE],
  ['walk within reach of a point 2 m to the right, no facing asked', walkThere(new Vector3(-2, 0, 0), undefined, 0.45), NONE],
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
  ['look-around, turned 0.3 rad left', lookAround({ turn: 0.3 })],
  ['look-around, turned 0.3 rad right', lookAround({ turn: -0.3 })],
  ['reach, the targets 10 cm to the left', reach({ shift: { x: 0.1, z: 0 } })],
  ['reach, the targets 10 cm nearer', reach({ shift: { x: 0, z: -0.1 } })],
  ['reach, the targets 10 cm to the right', reach({ shift: { x: -0.1, z: 0 } })],
  ['reach, the targets 10 cm higher', reach({ rise: 0.1 })],
  ['reach, the targets 10 cm lower', reach({ rise: -0.1 })],
  ['reach, turned 0.3 rad right', reach({ turn: -0.3 })],
  ['reach, turned 0.3 rad left', reach({ turn: 0.3 })],
  ['reach, the hand 20% slower', reach({ pace: 0.8 })],
  ['reach, the hand 20% faster', reach({ pace: 1.2 })],
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
for (const [name, sc, strides] of VARIATIONS) it(name, () => judged(sc, strides));

// Known task-accuracy failures, tracked until fixed (it.fails turns red once they pass).
const KNOWN: [string, Scenario][] = [
  // a head bent down off the line the body faces, or a little further than it bows to, is reached by
  // the spine alone: `balance` carries the centre of mass toward it only by walking, and walks only
  // to a goal 14 cm off (asks.lean, being built, is the way: the weight shifted within the feet).
  // Further off and higher the eyes miss (8 cm); further left the spine bends sideways and carries
  // the shoulder 5 cm in over the squatting thigh: a hand hanging clear of it is out 17° (free arms: ≤ 12°)
  ['look-around, looking down 10 cm further off', lookAround({ shift: { x: 0, z: -0.1 } })],
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
for (const [name, sc] of KNOWN) it.fails(`${name} (known)`, () => judged(sc));
// (known too: on a bend the outer foot's steps dip the pelvis 1.5–2 cm lower than straight)
it.fails('stroll: the pelvis bobs on a bend within 1 cm of walking straight (known)', () => {
  const m = measure('stroll', steps(new Simulation(stroll())));
  const straight = m.gait.summary(false, false);
  const curve = m.gait.summary(true, false);
  expect(straight && curve).toBeTruthy();
  if (!straight || !curve) throw new Error('no steady strides');
  expect(curve.pelvisUp, 'curve pelvis vertical (m)').toBeLessThanOrEqual(straight.pelvisUp + 0.01);
});

it('runs a scenario through the metrics: two actors standing still, relaxed, each reading the other', () => {
  const seen: number[] = [];
  const still: Scenario = {
    id: 'still',
    title: 'Standing still',
    duration: 0.49,
    actors: [{ position: { x: -1, z: 0 } }, { position: { x: 1, z: 0 }, yaw: Math.PI }],
    stage: () => ({
      world: createWorld(),
      report: new Report(),
      done: () => true,
      props: () => [],
      script: (_, index) =>
        function* () {
          yield* action<BodyFrame<World>>({ update: (f) => void seen.push(f.world.bodies[1 - index].com(new Vector3()).x) });
        },
    }),
  };
  const m = measure(still.id, steps(new Simulation(still)));
  expect(seen.length).toBe(2 * 30);
  expect(seen.every((x, i) => Math.abs(x - (i % 2 === 0 ? 1 : -1)) < 0.05)).toBe(true);
  expect(m.report).toContain('== still (30 frames)');
});
