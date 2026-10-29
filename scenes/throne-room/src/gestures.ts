import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { floorAt } from './hall';
import { arriving, lookAt, pose, reach, wait, walkTo, type Body, type Verb } from '@drawcall/animate';

// The small, character-defining gestures of the medal moment, each a story function on one body (and whom it is for).
// Each is a gaze (`lookAt`: where the eyes go, its `roll` and `pitch` tipping the head as it looks) beside a `pose`: trunk and head angles
// added on top of whatever the body does, eased in and out, so poses one after another flow into each other and a short one is a nod.
// When a gesture ends the body takes its head and hands back into its own standing life, so each one blends out by itself.

/** a point in `body`'s own frame (m: x its left, y up from its floor, z ahead) as a world point */
export function besides(body: Body, x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x, y, z).applyAxisAngle(UP, body.facing).add(body.position);
}

/** where `body`'s eyes are (world) */
export function eyesOf(body: Body, out = new Vector3()): Vector3 {
  const gaze = body.species.gaze;
  if (!gaze) throw new Error(`${body.species.name ?? 'body'} has no eyes to look at`);
  return gaze.eyes(body.pose, out);
}

/**
 * Luke's bow as the medal goes over his head: his eyes drop to the ribbon in front of his chest and his head bows to it, the shoulders
 * following a little, held until `until` (Leia has hung it); then he straightens and looks up at her, proud and a little shy: his chin
 * up on her face, a quick drop of the head, and back to her for `proud` seconds.
 */
export function bowForMedal(luke: Body, leia: Body, { until, proud = 2.4 }: { until: number | (() => boolean); proud?: number }): Verb {
  return (function* () {
    yield* parallel('race', lookAt(luke, besides(luke, 0, 1.15, 0.5)), pose(luke, { bow: 0.12, head: { pitch: 0.3 } }, { until }));
    yield* lookAt(luke, leia, { pitch: -0.08, until: proud * 0.4 });
    // the shy part: his head dips a little under his eyes, still on her, and comes back up
    yield* parallel('race', lookAt(luke, leia), pose(luke, { head: { pitch: 0.22 } }, { until: 0.45 }));
    yield* lookAt(luke, leia, { pitch: -0.08, until: proud * 0.6 - 0.45 });
    return true;
  })();
}

/**
 * Han's wink: his eyes go to Leia, his head tipped toward her with a cocky tilt and his shoulders coming round a little, and he gives
 * her a slow half-nod (down, and back up with the chin finishing a touch high), held a moment, then he faces front again. About
 * `seconds` in all.
 */
export function cockyWink(han: Body, leia: Body, { seconds = 2.6 }: { seconds?: number } = {}): Verb {
  return (function* () {
    // she is to his left or right: the head tips toward her (+ roll lifts his left side, tipping him toward his right shoulder)
    const toLeia = eyesOf(leia).sub(eyesOf(han));
    const left = Math.sin(Math.atan2(toLeia.x, toLeia.z) - han.facing) > 0;
    const roll = left ? -0.2 : 0.2;
    const twist = left ? 0.15 : -0.15;
    yield* parallel('race', lookAt(han, leia, { roll, until: seconds }), function* () {
      yield* pose(han, { twist, head: { pitch: 0 } }, { until: seconds * 0.22 });
      yield* pose(han, { twist, head: { pitch: 0.24 } }, { until: seconds * 0.2 });
      yield* pose(han, { twist, head: { pitch: -0.08 } }, { until: seconds * 0.36 });
      yield* wait(Infinity);
    });
    return true;
  })();
}

/**
 * Chewbacca's roar: a heavy wind-up (the chin drops, the chest gathers), then his back arches and his head is thrown back to the
 * ceiling with the arms coming a little away from his sides, a shake of the head through the roar, and a slow settle. About `seconds`
 * in all; `thrown` is told as the head goes back (the roar's sound).
 */
export function roar(chewbacca: Body, { seconds = 3, thrown }: { seconds?: number; thrown?: () => void } = {}): Verb {
  return (function* () {
    const person = chewbacca.species.person;
    if (!person) throw new Error('roar needs a person-shaped body (its arms and shoulders)');
    const ahead = besides(chewbacca, 0, person.eyeHeight + 0.6, 4);
    // the wind-up: a gathering, the head and chest down
    yield* parallel('race', lookAt(chewbacca, ahead), pose(chewbacca, { bow: 0.12, head: { pitch: 0.3 } }, { until: 0.4 }));
    // the arms: each wrist about 30 degrees out from the side and a little forward, the elbow kept soft (90% of the arm's length from
    // the shoulder): a wrist any further than the arm reaches bends the chest down to it, against the back arched
    const span = person.armLength * 0.9, out = Math.sin(0.5) * span, low = person.shoulderHeight - Math.cos(0.5) * span;
    const arms = {
      left: besides(chewbacca, person.shoulderHalfWidth + out, low, 0.1),
      right: besides(chewbacca, -person.shoulderHalfWidth - out, low, 0.1),
    };
    const roaring = seconds - 0.4 - 0.6;
    thrown?.();
    yield* parallel(
      'all',
      reach(chewbacca, arms, { speed: 0.6, until: roaring }),
      parallel('race', lookAt(chewbacca, ahead), function* () {
        // head back, then shaken from side to side through the roar (each pose flows into the next)
        yield* pose(chewbacca, { bow: -0.22, head: { pitch: -0.75 } }, { until: 0.5 });
        for (let shake = 0; shake < 4; shake++)
          yield* pose(chewbacca, { bow: -0.22, head: { pitch: -0.7, yaw: shake % 2 ? -0.18 : 0.18 } }, { until: (roaring - 0.5) / 4 });
      }),
    );
    // the settle: the head comes down to level, slowly
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
    place.position.y = floorAt(place.position.x, place.position.z);
    place.rotation.y = leia.facing;
    let walked = true;
    yield* parallel(
      'all',
      (function* () {
        walked = yield* walkTo(leia, place, { speed: 0.6 });
      })(),
      (function* () {
        yield* lookAt(leia, hero, { until: arriving(leia, 0.5) });
        yield* graciousNod(leia, hero);
      })(),
    );
    return walked;
  })();
}

/** a small nod to `toward`: the head dips about 14 degrees and comes back up, about `seconds` in all, the eyes staying on them */
export function graciousNod(body: Body, toward: Body, { seconds = 1.2, depth = 0.25 }: { seconds?: number; depth?: number } = {}): Verb {
  return (function* () {
    yield* parallel('race', lookAt(body, toward, { until: seconds }), pose(body, { head: { pitch: depth } }, { until: seconds * 0.45 }));
    return true;
  })();
}

const UP = new Vector3(0, 1, 0);
