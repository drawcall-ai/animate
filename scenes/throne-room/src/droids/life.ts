import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { lookAt, pose, reach, wait, type Body, type Until, type Verb } from '@drawcall/animate';
import { IDLE, rockingOf, type Rocking } from './artoo';

// R2-D2 and C-3PO beside Leia's party through the ceremony. Each mood is a story piece that ends on `until`; `droidsLife` runs a list of
// cues, so the scene that composes the ceremony says what the droids attend to and when.

/** what the droids attend to: a fixed point, or a thing that moves (a hero's head bone, a medal) */
export type Focus = Vector3 | Object3D;


/** a point in `body`'s own frame: `x` to its left, `y` up from its floor, `z` ahead (m) */
function besides(body: Body, x: number, y: number, z: number): Vector3 {
  const f = body.facing;
  return new Vector3(body.position.x + x * Math.cos(f) + z * Math.sin(f), body.position.y + y, body.position.z - x * Math.sin(f) + z * Math.cos(f));
}

/** R2 excited: rocking quicker and wider, as far as its feet stay planted */
const EXCITED: Rocking = { sway: 0.009, turn: 0.08, rate: 1.3 };

/** sets R2's rocking for as long as the story runs this, then lets it settle back to its idle */
function* rocking(artoo: Body, aim: Rocking): Verb {
  const rock = rockingOf(artoo);
  Object.assign(rock, aim);
  try {
    return yield* wait(Infinity);
  } finally {
    Object.assign(rock, IDLE);
  }
}

/** R2 watches `focus`: its dome turns to follow it, rocking gently */
export function* artooWatch(artoo: Body, focus: Focus, until: Until): Verb {
  return yield* parallel('race', wait(until), lookAt(artoo, focus));
}

/**
 * R2 cheers at `focus`: its dome on it, it rocks quickly from side to side and bobs, its barrel tipping forward and back on its axle
 * `bobs` times a second (a pose of its trunk: a creature takes one by turning its whole body over its planted legs).
 */
export function* artooCheer(artoo: Body, focus: Focus, until: Until, { bobs = 0.8 } = {}): Verb {
  yield* parallel('race', wait(until), rocking(artoo, EXCITED), lookAt(artoo, focus), function* () {
    for (let bob = 0; ; bob++) yield* pose(artoo, { bow: bob % 2 ? -0.08 : 0.14 }, { until: 0.5 / bobs });
  });
  return true;
}

/** a small seeded random sequence in [0, 1) (C-3PO's fussing varies but plays the same every run) */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** C-3PO's hands held before his waist, elbows bent: his stiff resting pose */
const held = (threepio: Body, side: 1 | -1) => besides(threepio, 0.16 * side, 1.22, 0.22);

/**
 * C-3PO's small, precise fussing: hands held before him, now and then one lifts a little and turns out (a protocol droid's aside) or
 * both come up together, then settle back. Never ends: race it.
 */
export function* threepioFuss(threepio: Body, seed = 3): Verb {
  const rand = seeded(seed);
  for (;;) {
    yield* reach(threepio, { left: held(threepio, 1), right: held(threepio, -1) }, { until: 1.4 + 1.8 * rand() });
    const pick = rand();
    if (pick < 0.4) yield* reach(threepio, { right: besides(threepio, -0.2, 1.36, 0.25) }, { until: 0.7 });
    else if (pick < 0.8) yield* reach(threepio, { left: besides(threepio, 0.2, 1.36, 0.25) }, { until: 0.7 });
    else yield* reach(threepio, { left: besides(threepio, 0.12, 1.32, 0.24), right: besides(threepio, -0.12, 1.32, 0.24) }, { until: 0.9 });
  }
}

/**
 * C-3PO's stiffness: a protocol droid stands bolt upright, chest out and chin a touch high, and turns his head on a stiff neck: his
 * chest turns a little with it (`turn`, rad to his left) where a person's neck would take it all
 */
const upright = (turn = 0) => ({ bow: -0.05, twist: turn, head: { pitch: -0.06 } });

/** how far round from `threepio`'s facing `focus` is (rad, + to his left), at most `most` */
function towards(threepio: Body, focus: Focus, most: number): number {
  const point = focus instanceof Vector3 ? focus : focus.getWorldPosition(new Vector3());
  const off = Math.atan2(point.x - threepio.position.x, point.z - threepio.position.z) - threepio.facing;
  return Math.max(-most, Math.min(most, Math.atan2(Math.sin(off), Math.cos(off))));
}

/** C-3PO watches `focus`: his head turns to it, stiff and upright, his chest turning with it, fussing with his hands */
export function* threepioWatch(threepio: Body, focus: Focus, until: Until, seed?: number): Verb {
  const turn = 0.4 * towards(threepio, focus, 0.6);
  return yield* parallel('race', wait(until), lookAt(threepio, focus), pose(threepio, upright(turn)), threepioFuss(threepio, seed));
}

/**
 * C-3PO startled by `focus` (Chewbacca's roar): his head goes to it, he jerks back from the hips with his hands flying up before his
 * chest, then he watches it warily, upright again
 */
export function* threepioStartle(threepio: Body, focus: Focus, until: Until): Verb {
  const hands = { left: besides(threepio, 0.14, 1.42, 0.2), right: besides(threepio, -0.14, 1.42, 0.2) };
  const turn = 0.4 * towards(threepio, focus, 0.6);
  yield* parallel('race', wait(until), lookAt(threepio, focus), function* () {
    yield* pose(threepio, { bow: -0.16, twist: turn, head: { pitch: -0.15 } }, { until: 0.7 });
    yield* pose(threepio, upright(turn));
  }, function* () {
    yield* reach(threepio, hands, { until: 1.6, speed: 1.6 });
    yield* threepioFuss(threepio, 11);
  });
  return true;
}

/** what the droids do for one stretch of the ceremony: what they attend to, how, and until when */
export interface Cue {
  focus: Focus;
  until: Until;
  artoo: 'watch' | 'cheer';
  threepio: 'watch' | 'startle';
}

/** runs `cues` in order: R2 and C-3PO each attend to the cue's focus as it says, until the cue ends */
export function* droidsLife(artoo: Body, threepio: Body, cues: readonly Cue[]): Verb {
  for (const [i, cue] of cues.entries()) {
    yield* parallel(
      'all',
      cue.artoo === 'cheer' ? artooCheer(artoo, cue.focus, cue.until) : artooWatch(artoo, cue.focus, cue.until),
      cue.threepio === 'startle' ? threepioStartle(threepio, cue.focus, cue.until) : threepioWatch(threepio, cue.focus, cue.until, i + 1),
    );
  }
  return true;
}
