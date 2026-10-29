import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { type Body, lookAt, pose, type Target, track, type Until, type Verb, wait, walkTo, arriving } from '@drawcall/animate';

// The small gestures of the medal moment, each a story of its own for a body that otherwise stands and balances by itself.
// They only ask for the parts they are about (the trunk's posture, the head, the eyes, the hands), so they layer over whatever
// else the body does, ease in and ease back out. Angles are radians in the body's own frame: +X its left, +Y up, +Z ahead.

/**
 * Luke receiving his medal: as she hangs it (until `hung`) he bows his head and upper body a little, his eyes lowered to the medal at
 * his chest, then straightens, chest lifting, and looks up at the giver for `proudSeconds`, chin a touch down: proud, and a little shy.
 */
export function* bowForMedal(body: Body, giver: Body, hung: Until, proudSeconds = 2.5): Verb {
  // where his eyes go: down toward the medal and her hands, 0.2 m above his chest bone and 1.5 m before him (in his own frame, so it
  // turns with him); far enough out that the look alone lowers his head only a little
  const medal = new Object3D();
  medal.position.set(0, chestHeight(body) + 0.2, 1.5);
  body.object.add(medal);
  medal.updateWorldMatrix(true, false);
  // a modest bow: the trunk forward 0.1 rad (6°) at the hips, the head nodding a further 0.2 rad (11°) over his lowered eyes
  yield* parallel('race', lookAt(body, medal, { until: Infinity }), pose(body, { bow: 0.1, head: { pitch: 0.2 } }, { until: hung }));
  body.object.remove(medal);
  // straightening up, the chest a little lifted, the chin slightly down: a proud, shy look up at her
  yield* parallel('race', lookAt(body, giver, { pitch: 0.12, roll: -0.05, until: proudSeconds }), pose(body, { bow: -0.05 }, { until: proudSeconds }));
  return true;
}

/** the height of `body`'s chest bone above its floor (m), as it stands now */
function chestHeight(body: Body): number {
  return (body.bones as Record<string, Object3D>).chest.getWorldPosition(new Vector3()).y - body.position.y;
}

/**
 * Han's wink: he turns his head and shoulders toward `at` (Leia), tips his head with a cocky tilt and gives a quick half-nod at
 * her (the wink itself is in his face), holds the look a moment and turns back. `holdSeconds` is how long he keeps looking at her.
 */
export function* cockyWink(body: Body, at: Body, holdSeconds = 2): Verb {
  // which way she is from him, as a turn of his shoulders: + to his left
  const toward = turnToward(body, at);
  const shoulders = clamp(toward * 0.5, -0.3, 0.3);
  yield* parallel(
    'race',
    // the look tipped toward his right shoulder: the cocky tilt
    lookAt(body, at, { roll: 0.14, until: Infinity }),
    pose(body, { twist: shoulders, lean: 0.03 }, { until: Infinity }),
    function* () {
      yield* wait(0.6); // the head comes round first
      // the half-nod as he winks: chin down 0.35 rad (20°) and back up (a shorter pose does not get the head that far down)
      yield* pose(body, { twist: shoulders, lean: 0.03, head: { pitch: 0.35 } }, { until: 0.35 });
      yield* wait(holdSeconds);
    },
  );
  return true;
}

/**
 * Chewbacca's roar: he arches back and throws his head up, his arms lifting a little away from his sides, holds it for the roar's
 * `roarSeconds`, then settles back, heavily. `onRoar` runs as the head goes back (for the sound).
 */
export function* roar(body: Body, roarSeconds = 1.6, onRoar?: () => void): Verb {
  // the arms swing 0.22 rad (13°) out from his sides and 0.3 rad (17°) ahead: lifted a little, not flung up
  const arms = swingArms(body, 0.22, 0.3, 0.7, roarSeconds + 0.3, 1);
  yield* parallel(
    'all',
    track(body, arms.targets, { until: arms.seconds }),
    function* () {
      // the wind-up: a slight dip of the head and chest before throwing it back
      yield* pose(body, { bow: 0.08, head: { pitch: 0.15 } }, { until: 0.35 });
      onRoar?.();
      // thrown back: the chest lifting, the chin up toward the ceiling
      yield* pose(body, { bow: -0.25, head: { pitch: -0.6 } }, { until: roarSeconds });
      // the settle: a small heavy nod forward as the roar ends, then upright
      yield* pose(body, { bow: 0.05, head: { pitch: 0.12 } }, { until: 0.5 });
    },
  );
  return true;
}

/**
 * Leia, after hanging a medal: she steps back to `place` (a mark, its +Z the way she faces), her eyes staying on whom she decorated,
 * and gives a small gracious nod to them, then keeps her look on them a moment.
 */
export function* stepBackAndNod(body: Body, place: Object3D, decorated: Body): Verb {
  let arrived = false;
  yield* parallel(
    'race',
    lookAt(body, decorated, { until: Infinity }),
    function* () {
      arrived = yield* stepBack(body, place);
      yield* graciousNod(body);
      yield* wait(0.6);
    },
  );
  return arrived;
}

/**
 * Steps `body` back to `place` facing the way it faces: a step at a time of at most STEP_BACK, since one walk much longer than a step
 * turns the body round to walk there face first.
 */
/** the longest step back a walk takes without turning round (m) */
const STEP_BACK = 0.36;
function* stepBack(body: Body, place: Object3D): Verb {
  const goal = place.getWorldPosition(new Vector3());
  const distance = body.position.distanceTo(goal.clone().setY(body.position.y));
  const count = Math.max(1, Math.ceil(distance / STEP_BACK));
  const from = body.position.clone();
  for (let step = 1; step < count; step++) {
    const along = from.clone().lerp(goal, step / count);
    if (!(yield* walkTo(body, along, { face: place.rotation.y, speed: 0.7, until: arriving(body, 0.4) }))) return false;
  }
  return yield* walkTo(body, place, { speed: 0.7, until: arriving(body, 0.3) });
}

/** a small, gracious nod: the head dipping 0.3 rad (17°) with the shoulders following a little, and back up */
export function graciousNod(body: Body) {
  return pose(body, { bow: 0.06, head: { pitch: 0.3 } }, { until: 0.45 });
}

/**
 * The hands' targets for an arm gesture: each arm swings from where it hangs, about its shoulder, `spread` rad out to its side and
 * `forward` rad ahead (so the gesture is the same size on any body), eased in over `rise` s, held `hold` s and eased back to where it
 * started over `fall` s; it is done `seconds` after it began.
 */
function swingArms(body: Body, spread: number, forward: number, rise: number, hold: number, fall: number) {
  const bones = body.bones as Record<string, Object3D>;
  const target = (side: 'left' | 'right'): Target => {
    const outward = side === 'left' ? 1 : -1; // its left is +X
    let begun: number | undefined;
    let shoulder: Vector3 | undefined;
    let hang: Vector3 | undefined;
    const turn = new Quaternion();
    return (time: number) => {
      begun ??= time;
      // the shoulder and the hand's place from it, in the body's own frame, so the gesture turns with the body
      shoulder ??= body.object.worldToLocal(bones[`${side}UpperArm`].getWorldPosition(new Vector3()));
      hang ??= body.object.worldToLocal(bones[`${side}Hand`].getWorldPosition(new Vector3())).sub(shoulder);
      const elapsed = time - begun;
      const amount = elapsed < rise ? smooth(elapsed / rise) : elapsed < rise + hold ? 1 : 1 - smooth((elapsed - rise - hold) / fall);
      // out about the body's +Z axis, ahead about its +X axis (a hanging arm swings forward under a negative turn about +X)
      turn.setFromEuler(new Euler(-forward * amount, 0, outward * spread * amount));
      return body.object.localToWorld(hang.clone().applyQuaternion(turn).add(shoulder));
    };
  };
  return { targets: { left: target('left'), right: target('right') }, seconds: rise + hold + fall };
}

/** the turn (rad, + to its left) from where `body` faces to where `other` stands */
function turnToward(body: Body, other: Body): number {
  const offset = other.position.clone().sub(body.position);
  const angle = Math.atan2(offset.x, offset.z) - body.facing;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));
