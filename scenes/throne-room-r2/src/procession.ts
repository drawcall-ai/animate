import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, type Body, lookAt, pose, type Until, wait, walkTo, type Verb } from '@drawcall/animate';
import type { Cast } from './cast';
import { floorAt, HALL, type Marks } from './hall';

// The heroes' entrance (A New Hope's last scene): Luke, Han and Chewbacca walk side by side from the doors up the aisle and the steps
// to the step below Leia; and, after the medals, their turn to face the hall.

/**
 * The procession's pace (m/s): a slow, ceremonial walk that takes the trio up the 33 m aisle in about half a minute. All three walk at
 * it, so the line abreast keeps its spacing (left to their own paces, the long-legged Chewbacca would draw ahead). On the steps each
 * body slows to its own climbing cap (0.7 m/s × its height over 1.75 m), so the climb is walked at Luke's, the smallest's.
 */
export const PROCESSION_PACE = 1.05;
const CLIMBING_PACE = 0.65;

/** where the aisle walk hands over to the climb: a stride short of the first riser, so the pace changes on the level */
const FOOT_OF_STEPS = HALL.steps.start - 0.6;

/**
 * The entrance: from wherever the three stand (their `*Enter` marks at the doors) up the aisle side by side, each in character, then up
 * the steps to their `*Decorated` marks, facing Leia. Their eyes go to Leia well before they arrive. Returns whether all three got there.
 */
export function* procession(cast: Cast, marks: Marks): Verb {
  const { luke, han, chewbacca, leia } = cast;
  const heroes = [
    { body: luke, mark: marks.lukeDecorated, manner: lukeWalking },
    { body: han, mark: marks.hanDecorated, manner: hanWalking },
    { body: chewbacca, mark: marks.chewbaccaDecorated, manner: chewbaccaWalking },
  ];
  const arrived = new Map<Body, boolean>();
  yield* parallel('all', ...heroes.map(({ body, mark, manner }, index) => function* () {
    // (a few frames apart, so the three do not set off on one frame like copies)
    yield* wait(index * 0.05);
    yield* parallel('race', function* () {
      const footOfSteps = new Vector3(mark.position.x, 0, FOOT_OF_STEPS);
      // the aisle at the procession's pace, handing over to the climb while still walking, then the climb at the climbing pace
      yield* walkTo(body, footOfSteps, { speed: PROCESSION_PACE, face: 0, until: () => body.position.z > FOOT_OF_STEPS - 0.8 });
      arrived.set(body, yield* walkTo(body, mark, { speed: CLIMBING_PACE }));
    }, function* () {
      // its own manner while the aisle lasts; then, some seconds out, its eyes go to Leia and stay there
      yield* parallel('race', manner(body), wait(arriving(body, 9)));
      yield* lookAt(body, leia);
    });
  }));
  return heroes.every(({ body }) => arrived.get(body) === true);
}

/** a point `ahead` metres along the aisle from `body`, `left` metres to its left (+X) and `height` above the hall floor */
const around = (body: Body, ahead: number, left: number, height: number) => () => new Vector3(body.position.x + left, height, body.position.z + ahead);

/** Luke walks upright and a little awed: chin slightly up, his eyes going round the hall, the troop ranks either side and the high roof. */
function* lukeWalking(body: Body): Verb {
  yield* parallel('race', pose(body, { bow: -0.04, head: { pitch: -0.06 } }), function* () {
    yield* wait(2.5);
    for (;;) {
      yield* lookAt(body, around(body, 4, 5, 1.7), { until: 2.6 }); // the troops on his left
      yield* lookAt(body, around(body, 10, 1, 6.5), { until: 2.2 }); // up at the high walls and banners
      yield* lookAt(body, around(body, 4, -5, 1.7), { until: 2.6 }); // the troops on his right
      yield* lookAt(body, around(body, 12, 0, 1.6), { until: 2.4 }); // ahead, down the aisle
    }
  });
  return true;
}

/** Han swaggers, relaxed: his head a little cocked, taking the troops in with a glance now and then rather than staring about. */
function* hanWalking(body: Body): Verb {
  yield* parallel('race', pose(body, { twist: 0.04, head: { roll: 0.06 } }), function* () {
    yield* wait(4);
    for (;;) {
      yield* lookAt(body, around(body, 14, 0, 1.7), { until: 4, roll: 0.08 });
      yield* lookAt(body, around(body, 3, 5, 1.7), { until: 1.8, roll: 0.08 }); // a glance at the troops on his side
      yield* lookAt(body, around(body, 14, 0, 1.7), { until: 3.5, roll: 0.08 });
      yield* lookAt(body, around(body, 6, -2, 1.7), { until: 1.6 }); // across at Luke and Chewie's side
    }
  });
  return true;
}

/** Chewbacca lumbers, his heavy frame a little hunched forward, his big head turning slowly to the ranks. */
function* chewbaccaWalking(body: Body): Verb {
  yield* parallel('race', pose(body, { bow: 0.08, head: { pitch: -0.05 } }), function* () {
    yield* wait(5);
    for (;;) {
      yield* lookAt(body, around(body, 5, -6, 1.7), { until: 3.2 }); // the troops on his side
      yield* lookAt(body, around(body, 14, 0, 2.2), { until: 4 });
    }
  });
  return true;
}

/** the tread the heroes stand on at their `*Decorated` marks: where it begins and ends (z) */
const STEP_FRONT = HALL.steps.start + (HALL.steps.count - 2) * HALL.steps.tread;
/** where an ankle stands on that tread facing the doors: toes (up to 0.25 m ahead of it) and heel (back of it) both on the tread */
const FACING_HALL_Z = STEP_FRONT + 0.3;

/**
 * The finale: after the medals, the three turn round together to face the hall and stand proudly. Each turns its head toward the hall
 * first and the body follows, Luke a moment ahead of the others; turned, chests lifted and chins up. Ends once they have stood so for
 * `hold` (seconds after each has turned, or a condition: what the scene does next). Returns whether all three turned.
 */
export function* faceHall(cast: Cast, hold: Until = 4): Verb {
  const heroes = [cast.luke, cast.han, cast.chewbacca];
  const turned = new Map<Body, boolean>();
  yield* parallel('all', ...heroes.map((body, index) => function* () {
    yield* wait(index * 0.2);
    const x = body.position.x;
    // (the troops at eye height down the hall, a little off to its own side, so its head leads round the way the turn goes)
    const hall = new Vector3(x + (x >= 0 ? 3 : -3), 1.7, 20);
    yield* parallel('race', lookAt(body, hall, { pitch: -0.05 }), pose(body, { bow: -0.07, head: { pitch: -0.08 } }), function* () {
      // the eyes and head lead; the feet start round a beat later and the gaze settles out over the troops as the body comes round
      yield* wait(0.35);
      const spot = new Vector3(x, floorAt(x, FACING_HALL_Z), FACING_HALL_Z);
      turned.set(body, yield* walkTo(body, spot, { face: Math.PI, speed: 0.6 }));
      yield* wait(hold);
    });
  }));
  return heroes.every((body) => turned.get(body) === true);
}

/** whether `body` stands with both feet planted around `x`, `z` (within 15 cm), facing `face` (within about 10°) */
export function standsAt(body: Body, x: number, z: number, face: number): boolean {
  const feet = body.feet;
  if (feet.length === 0 || !feet.every((foot) => foot.planted)) return false;
  const middleX = feet.reduce((sum, foot) => sum + foot.position.x, 0) / feet.length;
  const middleZ = feet.reduce((sum, foot) => sum + foot.position.z, 0) / feet.length;
  const turn = Math.atan2(Math.sin(body.facing - face), Math.cos(body.facing - face));
  return Math.hypot(middleX - x, middleZ - z) < 0.15 && Math.abs(turn) < 0.18;
}

/** whether the three stand at their `*Decorated` marks facing Leia */
export const heroesBeforeLeia = (cast: Cast, marks: Marks): boolean =>
  ([[cast.luke, marks.lukeDecorated], [cast.han, marks.hanDecorated], [cast.chewbacca, marks.chewbaccaDecorated]] as const)
    .every(([body, mark]) => standsAt(body, mark.position.x, mark.position.z, mark.rotation.y));

/** whether the three stand on their step facing the hall */
export const heroesFacingHall = (cast: Cast, marks: Marks): boolean =>
  ([[cast.luke, marks.lukeDecorated], [cast.han, marks.hanDecorated], [cast.chewbacca, marks.chewbaccaDecorated]] as const)
    .every(([body, mark]) => standsAt(body, mark.position.x, FACING_HALL_Z, Math.PI));
