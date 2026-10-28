import { Euler, Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { floorAt } from './hall';
import { arriving, lookAt, reach, track, wait, walkTo, type Body, type Verb } from '@drawcall/animate';

// The small, character-defining gestures of the medal moment, each a story function on one body (and whom it is for).
// The library has no verb that turns a joint directly, so every gesture is a gaze, a head pose or a hand target that moves over time:
// - a bow is a look, trunk and all, at a point low in front (the body bows from the hips to see it);
// - a nod is a look whose target dips below the eyes it is aimed at and comes back;
// - a head tilt (roll) is only reachable through `track`, whose head target sets where the eyes are and how the head is turned;
// - arms lifted from the body are a reach of each wrist to a point out to the side.
// When a gesture ends the body takes its head and hands back into its own standing life, so each one blends out by itself.

/** a point in `body`'s own frame (m: x its left, y up from its floor, z ahead) as a world point */
export function besides(body: Body, x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x, y, z).applyAxisAngle(UP, body.facing).add(body.position);
}

/**
 * where `body`'s eyes are, as `seer` must aim to look into them (world). The library stands every body on y = 0, and this scene lifts
 * each one by the floor under it (`floorAt`) only to be seen; so the 0.2 m between the heroes' step and Leia's dais is added here.
 */
export function eyesOf(body: Body, seer?: Body, out = new Vector3()): Vector3 {
  const gaze = body.species.gaze;
  if (!gaze) throw new Error(`${body.species.name ?? 'body'} has no eyes to look at`);
  gaze.eyes(body.pose, out);
  if (seer) out.y += floorAt(body.position.z) - floorAt(seer.position.z);
  return out;
}

/**
 * Luke's bow as the medal goes over his head: his head and upper body dip a little toward the ribbon in front of his chest, held
 * until `until` (Leia has hung it), then he straightens and looks up at her, proud and a little shy: on her face, a quick drop of the
 * eyes, and back to her for `proud` seconds.
 */
export function bowForMedal(luke: Body, leia: Body, { until, proud = 2.4 }: { until: number | (() => boolean); proud?: number }): Verb {
  return (function* () {
    // the ribbon's height, in front of his chest: a look there bows him about 15 degrees at the chest and 30 at the neck
    yield* lookAt(luke, besides(luke, 0, 1.12, 0.6), { trunk: true, until });
    // he straightens before he looks up at her: a look aims from where the eyes are as it begins, so one begun while still bowed
    // (the eyes 0.1 m low) holds the head 15 degrees too high at her face 0.6 m away
    yield* wait(0.35);
    const face = (out: Vector3) => eyesOf(leia, luke, out).add(LIFT);
    yield* lookAt(luke, follow(face), { until: proud * 0.4 });
    // the shy part: his eyes drop a little and come back up to her
    yield* lookAt(luke, follow((out) => face(out).add(SHY_DROP)), { until: 0.45 });
    yield* lookAt(luke, follow(face), { until: proud * 0.6 - 0.45 });
    return true;
  })();
}

/**
 * Han's wink: he turns his head and shoulders to Leia, his head tipping toward her as he gives her a slow, cocky half-nod (down and
 * back up, the chin finishing a touch high), held a moment, then he faces front again. About `seconds` in all.
 */
export function cockyWink(han: Body, leia: Body, { seconds = 2.6 }: { seconds?: number } = {}): Verb {
  return (function* () {
    const start = eyesOf(han);
    const toLeia = eyesOf(leia, han).sub(start);
    // how far round from his facing she is (+ left), at most 45 degrees of it taken by the head and shoulders
    const turn = clamp(Math.atan2(toLeia.x, toLeia.z) - han.facing, -0.8, 0.8);
    const head = new Object3D();
    const pose = new Euler(0, 0, 0, 'YXZ');
    // keyframes [share of `seconds`, turned toward her (0…1), nod (rad, + chin down), tilt (rad, + toward her)]
    const keys: Key[] = [
      [0, 0, 0, 0],
      [0.22, 0.85, -0.04, 0.1],
      [0.42, 0.9, 0.22, 0.2],
      [0.6, 0.9, -0.06, 0.16],
      [0.78, 0.85, -0.04, 0.12],
      [1, 0, 0, 0],
    ];
    let began: number | undefined;
    const target = (time: number) => {
      began ??= time;
      const [toward, nod, tilt] = sample(keys, (time - began) / seconds);
      // the eyes move a little toward her and down with the nod, so the shoulders come round under the head
      head.position.copy(start).addScaledVector(toLeia.clone().setY(0).normalize(), 0.03 * toward);
      head.position.y -= 0.02 * Math.max(0, nod) / 0.22;
      pose.set(nod, han.facing + turn * toward, -Math.sign(turn) * tilt);
      head.quaternion.setFromEuler(pose);
      head.updateMatrixWorld();
      return head;
    };
    return yield* track(han, { head: target }, { until: seconds });
  })();
}

/**
 * Chewbacca's roar: a heavy wind-up (the chin drops, the chest fills), then the head thrown back to the ceiling with the arms coming
 * a little away from his sides, a shake of the head through the roar, and a slow settle. About `seconds` in all.
 */
export function roar(chewbacca: Body, { seconds = 3 }: { seconds?: number } = {}): Verb {
  return (function* () {
    const person = chewbacca.species.person;
    if (!person) throw new Error('roar needs a person-shaped body (its arms and shoulders)');
    // the wind-up: a glance down, as a big creature gathers itself
    yield* lookAt(chewbacca, besides(chewbacca, 0, person.eyeHeight - 0.35, 1.2), { until: 0.4 });
    // head back: a point high above, just ahead (any further back and the gaze turns round instead)
    let began: number | undefined;
    const shake = (time: number) => {
      began ??= time;
      const side = 0.6 * Math.sin((time - began) * 2 * Math.PI * 1.6) * Math.min(1, (time - began) / 0.5);
      return besides(chewbacca, side, person.eyeHeight + 6, 1.1, SHAKE);
    };
    // the arms: each wrist about 30 degrees out from the side and a little forward, the elbow kept soft (90% of the arm's length from
    // the shoulder): a wrist any further than the arm reaches bends the chest down to it, against the head thrown back
    const span = person.armLength * 0.9, out = Math.sin(0.5) * span, low = person.shoulderHeight - Math.cos(0.5) * span;
    const arms = {
      left: besides(chewbacca, person.shoulderHalfWidth + out, low, 0.1),
      right: besides(chewbacca, -person.shoulderHalfWidth - out, low, 0.1),
    };
    const roaring = seconds - 0.4 - 0.6;
    yield* parallel(
      'all',
      lookAt(chewbacca, shake, { until: roaring }),
      reach(chewbacca, arms, { speed: 0.6, until: roaring }),
    );
    // the settle: head down to level, slowly
    yield* lookAt(chewbacca, besides(chewbacca, 0, person.eyeHeight, 4), { until: 0.6 });
    return true;
  })();
}

/**
 * Leia, having hung a medal: she takes a short step straight back from where she stands now, keeping her facing, and as she arrives
 * gives `hero` a small gracious nod, her eyes on him. The step is measured from where she is when it begins, not from a mark: a reach
 * can have drawn her a little nearer him. Keep `distance` short (0.35 m at most): a walk further back turns her round to walk it facing
 * away (measured: 0.45 m turns her 23 degrees, 0.8 m up to 150) and back again.
 */
export function stepBackAndNod(leia: Body, hero: Body, { distance = 0.35 }: { distance?: number } = {}): Verb {
  return (function* () {
    const place = new Object3D();
    place.position.copy(besides(leia, 0, 0, -distance));
    place.rotation.y = leia.facing;
    let walked = true;
    yield* parallel(
      'all',
      (function* () {
        walked = yield* walkTo(leia, place, { speed: 0.6 });
      })(),
      (function* () {
        yield* lookAt(leia, follow((out) => eyesOf(hero, leia, out)), { until: arriving(leia, 0.5) });
        yield* graciousNod(leia, hero);
      })(),
    );
    return walked;
  })();
}

/** a small nod to `toward`: the head dips about 14 degrees and comes back up over 1.2 s, the eyes staying on them */
export function graciousNod(body: Body, toward: Body, { seconds = 1.2, depth = 0.25 }: { seconds?: number; depth?: number } = {}): Verb {
  let began: number | undefined;
  const from = new Vector3();
  const target = (time: number) => {
    began ??= time;
    const [dip] = sample(NOD, (time - began) / seconds);
    const eyes = eyesOf(toward, body, NODDING);
    // the target drops `depth` × the distance per unit dip: tan of about 14 degrees
    const distance = eyesOf(body, undefined, from).distanceTo(eyes);
    return eyes.setY(eyes.y - dip * depth * distance);
  };
  return lookAt(body, target, { until: seconds });
}

// a keyframe: its time (share of the gesture, rising from 0 to 1), then its values
type Key = readonly [number, ...number[]];
const NOD: Key[] = [
  [0, 0],
  [0.35, 1],
  [0.55, 1],
  [1, 0],
];

/** the values of `keys` at share `at` of the way, eased in and out between neighbouring keys */
function sample(keys: readonly Key[], at: number): number[] {
  const u = clamp(at, 0, 1);
  let next = keys.findIndex(([time]) => time >= u);
  if (next <= 0) return keys[Math.max(0, next)].slice(1);
  const [t0, ...a] = keys[next - 1], [t1, ...b] = keys[next];
  const s = (u - t0) / (t1 - t0), eased = s * s * (3 - 2 * s);
  return a.map((value, i) => value + (b[i] - value) * eased);
}

/** a target that reads `point` afresh each sub-step (it follows a moving body) */
function follow(point: (out: Vector3) => Vector3): (time: number) => Vector3 {
  const out = new Vector3();
  return () => point(out);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const UP = new Vector3(0, 1, 0);
/** looking at someone's face, a touch above the eyes: the chin up, proud */
const LIFT = new Vector3(0, 0.04, 0);
const SHY_DROP = new Vector3(0, -0.22, 0);
const SHAKE = new Vector3();
const NODDING = new Vector3();
