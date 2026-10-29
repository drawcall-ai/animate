import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { type Body, lookAt, pose, track, type Until, type Verb, wait } from '@drawcall/animate';

// The droids' parts in the ceremony. R2-D2, freshly repaired, rocks from side to side on its legs, turns its dome to whatever is going
// on and bobs when it is excited; C-3PO stands stiff and upright, following events with small, precise turns of his head and fussing
// with his hands. Both run until `until`, beside whatever story the rest of the scene plays.

/** what a droid should be watching now: a body (its eyes), a thing (a medal), or nothing in particular (it looks about) */
export type Focus = (droid: Body) => Object3D | Body | undefined;

/** what R2 says, for the scene to sound: a happy cheer as it gets excited, a whistle now and then as its dome turns to something new */
export type Chirp = (kind: 'cheer' | 'whistle') => void;

/**
 * R2-D2's life until `until`: its dome on what `focus` names (glancing aside now and then when one thing holds it long, and looking
 * about when there is nothing), its body rocking from side to side on its legs — slowly at rest; quickly, with a bob each rock, while
 * `excited()` holds. `chirp`, if given, hears what it says.
 */
export function* artooLives(artoo: Body, focus: Focus, excited: () => boolean, until: Until, chirp: Chirp = () => {}): Verb {
  yield* parallel('race', wait(until), rocking(artoo, excited, chirp), watching(artoo, focus, excited, chirp, 7));
  return true;
}

/**
 * C-3PO's life until `until`: upright and a little stiff, chest lifted; his eyes and head on what `focus` names, turning to it
 * promptly; and every few seconds a small fussy gesture of one hand or a tilt of the head.
 */
export function* threepioLives(threepio: Body, focus: Focus, until: Until): Verb {
  yield* parallel('race', wait(until),
    // stiff: the chest held up and the trunk not bowing to look
    pose(threepio, { bow: -0.04 }),
    watching(threepio, focus, () => false, undefined, 3),
    headFussing(threepio, 5),
    track(threepio, fussingHands(threepio, 11)));
  return true;
}

/** R2's rock: a lean to one side and the other over its planted feet; excited, quicker and wider, each rock let down a little (a bob) */
function* rocking(artoo: Body, excited: () => boolean, chirp: Chirp): Verb {
  let was = false;
  for (let side = 1; ; side = -side) {
    if (excited() && !was) chirp('cheer');
    was = excited();
    if (was) {
      yield* pose(artoo, { lean: side * 0.12, lower: 0.04 }, { until: 0.3 });
      yield* pose(artoo, { lean: side * 0.06 }, { until: 0.25 });
    } else {
      yield* pose(artoo, { lean: side * 0.05 }, { until: 1.3 });
    }
  }
}

/**
 * The eyes on what `focus` names, turning when it changes; with nothing named, glances about the hall ahead. R2's dome (given its
 * `chirp`) is always on the go: a look held a few seconds breaks off for a quick glance aside and back, sooner when it is excited, and
 * every other turn to something new comes with a whistle.
 */
function* watching(droid: Body, focus: Focus, excited: () => boolean, chirp: Chirp | undefined, seed: number): Verb {
  const random = seeded(seed);
  let last: Object3D | Body | undefined;
  for (;;) {
    const target = focus(droid);
    const changed = () => focus(droid) !== target;
    if (target === undefined) {
      yield* parallel('race', lookAt(droid, aside(droid, random), { until: changed }), wait(1.5 + random() * 2));
      continue;
    }
    if (!chirp) {
      yield* lookAt(droid, target, { until: changed });
      continue;
    }
    if (target !== last && random() < 0.5) chirp('whistle');
    last = target;
    yield* parallel('race', lookAt(droid, target, { until: changed }), wait(excited() ? 1.2 + random() : 3 + random() * 3));
    if (!changed()) yield* lookAt(droid, aside(droid, random), { until: 0.7 + random() * 0.5 });
  }
}

/** a point in the hall a few metres ahead of `body`, off to one side or the other, at about eye height */
function aside(body: Body, random: () => number): Vector3 {
  const turn = body.facing + (random() < 0.5 ? -1 : 1) * (0.4 + random() * 0.6);
  return new Vector3(Math.sin(turn), 0, Math.cos(turn)).multiplyScalar(4).add(body.position).setY(body.position.y + 1.2);
}

/** C-3PO's head: every few seconds a small, quick, precise tilt or tuck of the head, held a moment */
function* headFussing(body: Body, seed: number): Verb {
  const random = seeded(seed);
  for (;;) {
    yield* wait(2.5 + random() * 3);
    const roll = (random() < 0.5 ? -1 : 1) * (0.08 + random() * 0.06);
    yield* pose(body, { head: { roll, pitch: 0.06 * random() } }, { until: 0.6 + random() * 0.5 });
  }
}

/**
 * C-3PO's hands, as targets for `track`: each held before him, elbows bent and forearms forward, fingers pointing ahead and palms down
 * (his stance), and every few seconds one of them lifts a little and gives two small precise flicks before settling back. His arms are
 * short (0.31 m from shoulder to wrist), so every wrist point keeps within about 0.28 m of his shoulder. Each target is an empty this
 * moves each sub-step, in his own frame turned and moved with him.
 */
function fussingHands(body: Body, seed: number): { left: (time: number) => Object3D; right: (time: number) => Object3D } {
  const random = seeded(seed);
  // the gestures: when each starts (body time, s), which hand, and how high and far out it goes
  const gestures: { start: number; hand: 'left' | 'right'; lift: number; out: number }[] = [];
  for (let start = 1.5 + random() * 2; start < 600; start += 2.2 + random() * 2.5) {
    gestures.push({ start, hand: random() < 0.5 ? 'left' : 'right', lift: 0.04 + random() * 0.04, out: 0.02 + random() * 0.03 });
  }
  const GESTURE = 1.4; // s: raise, two flicks, settle
  const hand = (side: 'left' | 'right') => {
    const sign = side === 'left' ? 1 : -1;
    const target = new Object3D();
    const local = new Vector3();
    return (time: number) => {
      local.set(sign * 0.21, 1.22, 0.09);
      let flick = 0;
      const gesture = gestures.find((each) => each.hand === side && time >= each.start && time < each.start + GESTURE);
      if (gesture) {
        const u = (time - gesture.start) / GESTURE;
        // up and back down as a smooth hump; two small flicks of the hand outward on top
        const hump = Math.sin(Math.PI * u) ** 2;
        flick = hump * Math.sin(4 * Math.PI * u) ** 2;
        local.y += gesture.lift * hump;
        local.z += 0.03 * hump;
        local.x += sign * gesture.out * flick;
      }
      target.position.copy(local).applyAxisAngle(UP, body.facing).add(body.position);
      // a hand's rest points out along its arm (+X on the left); turned a quarter about the vertical its fingers point ahead, and a flick
      // turns them a little outward
      target.rotation.set(0, body.facing - sign * (Math.PI / 2 - 0.4 * flick), 0);
      target.updateMatrixWorld();
      return target;
    };
  };
  return { left: hand('left'), right: hand('right') };
}

const UP = new Vector3(0, 1, 0);

/** a small seeded random generator (so each run of a story is the same) */
function seeded(seed: number): () => number {
  let state = seed * 9301 + 49297;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}
