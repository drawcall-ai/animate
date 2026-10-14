// Objective motion metrics per scenario, judged by the universal rules and the limits of its id
// (judge.ts), and again under small changes to the scenarios. Run: pnpm metrics [-- -t <id>]
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
import type { Frame } from './frame';
import { judge, LIMITS, limitsOf, measure, type Limits } from './judge';

/** each fixed step's frames of a run `sim` (OpenPose models, read without rendering) */
function* steps(sim: Simulation): Generator<Frame[]> {
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const asked = sim.stage.report.at(sim.t);
    const solids = sim.stage.solids?.() ?? [];
    yield sim.actors.map((h) => ({ t: sim.t, h, asked, solids }));
  }
}

/** a run of `sc` measured, held to its limits, and to what it is for */
function judged(sc: Scenario, strides?: Limits['strides']) {
  const sim = new Simulation(sc);
  const m = measure(sc.id, steps(sim));
  console.log(m.report);
  const limit = limitsOf(sc.id);
  judge(m, strides ? { ...limit, strides } : limit);
  expect(sim.stage.done(), `${sc.id}: done`).toBe(true);
}

it('lists each scenario once', () => {
  const ids = SCENARIOS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// (the scenarios without limits are not judged yet: they only have to run; vr fails its
// side-step until `balance` strafes, see KNOWN)
const FAILING = new Set(['vr']);
for (const sc of SCENARIOS) {
  if (!(sc.id in LIMITS)) {
    it(`${sc.id} runs`, () => console.log(measure(sc.id, steps(new Simulation(sc))).report));
    continue;
  }
  if (FAILING.has(sc.id)) it.fails(`${sc.id} (known)`, () => judged(sc));
  else it(sc.id, () => judged(sc));
}

// the same limits a little off the script: no metric may hang on its exact numbers
// (a variation that walks less than its scenario says how few strides it judges: none go unjudged silently)
const NONE = { straight: 0, curve: 0 };
const VARIATIONS: [string, Scenario, Limits['strides']?][] = [
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
  ['reach, the targets 10 cm nearer', reach({ shift: { x: 0, z: -0.1 } })],
  ['reach, the targets 10 cm to the right', reach({ shift: { x: -0.1, z: 0 } })],
  ['reach, the targets 10 cm higher', reach({ rise: 0.1 })],
  ['reach, the targets 10 cm lower', reach({ rise: -0.1 })],
  ['reach, turned 0.3 rad right', reach({ turn: -0.3 })],
  ['reach, turned 0.3 rad left', reach({ turn: 0.3 })],
  ['reach, the hand 20% slower', reach({ pace: 0.8 })],
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
  ['knight-arming, the shield\'s wall turned 0.4 rad', knightArming({ wallTurn: 0.4 })],
  ['knight-arming, the shield\'s wall turned −0.4 rad', knightArming({ wallTurn: -0.4 })],
];
for (const [name, sc, strides] of VARIATIONS) it(name, () => judged(sc, strides));

// known to fail, tracked until fixed (it.fails turns red once they pass): a brisk stroll's
// arrival and a point stopping dead on a tight bend leave the extrapolated centre of mass out
const KNOWN: [string, Scenario][] = [
  ['stroll 40% faster (1.82 m/s)', stroll({ speed: 1.4 })],
  ['stroll whose point stops dead on a 1.5 m bend', stroll({ radius: 1.5, halt: true })],
  // a head bent down off the line the body faces, or a little further than it bows to, is reached by
  // the spine alone: `balance` carries the centre of mass toward it only by walking, and walks only
  // to a goal 14 cm off (asks.lean, being built, is the way: the weight shifted within the feet).
  // Further off and higher the eyes miss (8 cm); further left the spine bends sideways and carries
  // the shoulder 5 cm in over the squatting thigh: a hand hanging clear of it is out 17° (free arms: ≤ 12°)
  ['look-around, looking down 10 cm further off', lookAround({ shift: { x: 0, z: -0.1 } })],
  ['look-around, looking down 10 cm higher', lookAround({ rise: 0.1 })],
  ['look-around, looking down 10 cm further left', lookAround({ shift: { x: 0.1, z: 0 } })],
  // `balance` stepping round in a full squat, bowed: the swinging leg's hip twists to and fro (125k°/s²
  // at 8.2 s; repro: idle, ask lower 0.44 and bow 1.6, then from 1.5 s face −1.8 rad at 2.5 rad/s and
  // go to (−0.2, 0, 0.3): leftUpperLeg 77k°/s² at 2.13 s, over the 67k°/s² a joint may reach)
  ['reach, the targets 10 cm further out', reach({ shift: { x: 0, z: 0.1 } })],
  // the body turns back from the target across it to where the hand is going (the floor) as the hand
  // sets off, the hand still across the body: carried off its way by the turn (0.19 m at 5.4 s; holding
  // the turn until the hand has crossed the midline leaves this and breaks the targets 10 cm right)
  ['reach, the targets 10 cm to the left', reach({ shift: { x: 0.1, z: 0 } })],
  // reach played 20% faster: the target swung out far ahead still outruns the body walking after it
  // (its walk faster with the pace), beyond the arm but within the arm + 35 cm the wrist is judged in (0.23 m)
  ['reach, the hand 20% faster', reach({ pace: 1.2 })],
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
  expect(curve!.pelvisUp, 'curve pelvis vertical (m)').toBeLessThanOrEqual(straight!.pelvisUp + 0.01);
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
  expect(m.rates.velocity.knee.value).toBe(0);
  expect(m.rom.worst.value).toBe(0);
  expect(m.feet.slide).toBe(0);
  expect(m.balance.xcomFrames).toBe(0);
  expect(seen.length).toBe(2 * 30);
  expect(seen.every((x, i) => Math.abs(x - (i % 2 === 0 ? 1 : -1)) < 0.05)).toBe(true);
  expect(m.report).toContain('== still (30 frames)');
});
