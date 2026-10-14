import { Euler, Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import {
  approach,
  ask,
  live,
  carry,
  closeHand,
  handTo,
  hold,
  INDEX,
  lookAt,
  onBone,
  onItem,
  reachFor,
  release,
  takeOff,
  walkTo,
  wear,
  withGaze,
  type Behaviour,
  type BoneName,
  type Frame,
  type Grips,
  type Holds,
  type Humanoid,
  type Item,
  type Live,
  type Placement,
  type Side,
  type Stand,
  type World,
} from '@drawcall/animate';
import { forwardOf } from '../../math';
import { reported, reporting, type Report } from '../../report';
import { course, still, type Leg } from './course';

// Arming: the knight's behaviours, one piece of gear each, made of the package's tasks (approach,
// reachFor, carry, hold, wear, release, withGaze). Placements are in the frame of the body part they
// go to (left +x, up +y, ahead +z; m, default body), timed at a calm pace: a reach of 30–60 cm in
// about a second (Fitts' law at everyday precision), fine work (a strap through a buckle, a hand
// into a gauntlet) at a third of that speed; a pause of half a second between things.

type F = Frame<World>;

/** The knight: his body, the report his gaze and busy hands go to, and how fast he goes about it (1: as timed here). */
export interface Knight {
  h: Humanoid<World>;
  report: Report;
  pace: number;
}

/** a moment's pause (s at pace 1): the arms settling from what they did, before the next thing */
const SETTLE = 0.5;
/**
 * looking down: how far the head pitches on the neck before the body bows to see lower (rad, ~57°:
 * the neck's flexion short of its end), and how far it bows for that at most (rad)
 */
const NECK_PITCH = 1.0;
const MOST_BOW = 0.35;

/** a while doing nothing new (s at pace 1) */
export const pause = (k: Knight, seconds: number): Behaviour<World> =>
  function* () {
    yield* action({ until: timePassed(seconds / k.pace, 'seconds') });
  };

/** the hands busy while `task` runs (the metrics judge the arms nobody asks anything of as free) */
const busy = (k: Knight, task: Behaviour<World>): Behaviour<World> => reporting(k.report, ['leftHand', 'rightHand'], task);

/**
 * `task` with the eyes on `at` first (`lead` s at pace 1), reported as the gaze: for a point further
 * below the eyes than the neck pitches the head, the body bows to see it — or, given `bow` (rad), it
 * bows so far (work at the waist: the eyes over the hands)
 */
function eyesOn(k: Knight, at: Live<Vector3, World>, task: Behaviour<World>, lead = 0.5, bow?: number): Behaviour<World> {
  const h = k.h;
  const bowing = (f: F) => {
    const eyes = f.prev.point(INDEX.head, h.proportions.eyes, _eyes);
    const to = _to.subVectors(live(at, f), eyes);
    const below = Math.atan2(-to.y, Math.hypot(to.x, to.z));
    return { bow: Math.max(h.asks.bow, bow ?? Math.min(MOST_BOW, below - NECK_PITCH)) };
  };
  return function* () {
    yield* parallel<F>('race', withGaze(h, reported(k.report, 'gaze', at), task, { lead: lead / k.pace }), ask(h, bowing));
  };
}

/** how far the body bows to see what its hands do at its waist (rad) */
const AT_THE_WAIST = 0.35;

/** after a moment's pause, walking up to take hold of `holds` (`approach`), then the eyes on them and the hands to them (`reachFor`) */
function take(k: Knight, holds: Holds, options: { face?: number; stand?: Stand } = {}): Behaviour<World> {
  return function* () {
    yield* pause(k, SETTLE)();
    yield* approach(k.h, holds, options)();
    const grips = Object.values(holds).map(([item, grip]) => item.toWorld(item.grips[grip], { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }).position);
    const middle = grips.reduce((sum, g) => sum.add(g), new Vector3()).divideScalar(grips.length);
    yield* busy(k, eyesOn(k, middle, reachFor(k.h, holds)))();
  };
}

/** `loads` carried along their courses' legs, through one moving frame, together (the hands on each item's grips) */
function along(k: Knight, frame: Live<Required<Placement>, World>, loads: readonly [Item, Grips, readonly Leg[]][], scaled = true): Behaviour<World> {
  return function* () {
    const courses = loads.map(([item, , legs]) => course(item, frame, legs, { scale: scaled ? k.h.proportions.scale : 1, pace: k.pace }));
    yield* carry(
      k.h,
      loads.map(([item, grips], i) => [item, grips, courses[i].to] as const),
      { until: (f) => courses.every((c) => c.over(f)) },
    )();
  };
}

/** a frame at bone `bone`'s joint, turned as the body faces */
const facingAt = (k: Knight, bone: BoneName) => onBone(k.h, INDEX[bone], ORIGIN, { facing: true });

const ORIGIN: Placement = { position: new Vector3() };
const at = (x: number, y: number, z: number, quaternion?: Quaternion): Placement => ({ position: new Vector3(x, y, z), quaternion });
const turn = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));

/** the facing along `item`'s local `axis` (on the floor's plane) */
export const facingOf = (item: Item, axis: Vector3) => {
  const d = axis.clone().applyQuaternion(item.current.quaternion);
  return Math.atan2(d.x, d.z);
};

/**
 * The sword belt: its two ends taken off the table, lifted and carried out round the hips (the
 * strap swung behind them), drawn round to the front, the tongue put through the buckle and
 * pulled tight, the eyes on it, bowed to see; then worn on the hips.
 */
export function buckle(k: Knight, belt: { buckle: Item; tongue: Item }, stand: Stand): Behaviour<World> {
  const round = (s: 1 | -1): Leg[] => [
    [1.0, at(0.3 * s, 0.14, 0.34)], // off the table, out in front
    [1.1, at(0.26 * s, 0.07, -0.05)], // out round the hips: the strap behind them
  ];
  const hips = facingAt(k, 'hips');
  const front = onBone(k.h, INDEX.hips, at(0, 0.05, 0.17), { facing: true });
  return function* () {
    yield* take(k, { left: [belt.buckle, 'end'], right: [belt.tongue, 'end'] }, { stand })();
    yield* along(k, hips, [
      [belt.buckle, { left: 'end' }, round(1)],
      [belt.tongue, { right: 'end' }, round(-1)],
    ])();
    // (drawn round to the front, the ends together, the tongue through the buckle and pulled tight)
    yield* eyesOn(
      k,
      (f) => front(f).position,
      along(k, hips, [
        [belt.buckle, { left: 'end' }, [[0.8, at(0.17, 0.05, 0.14)], [0.6, at(0.035, 0.05, 0.165)], [0.75, still]]],
        [belt.tongue, { right: 'end' }, [[0.8, at(-0.17, 0.05, 0.14)], [0.6, at(-0.035, 0.05, 0.165)], [0.4, at(0.005, 0.05, 0.17)], [0.35, at(-0.05, 0.05, 0.165)]]],
      ]),
      0,
      AT_THE_WAIST,
    )();
    yield* wear(k.h, belt.buckle, INDEX.hips)();
    yield* wear(k.h, belt.tongue, INDEX.hips)();
    yield* busy(k, release(k.h, ['left', 'right']))();
  };
}

/** where the scabbard's throat hangs on the belt: before the left hip, the hilt up and forward, the scabbard down and back 35° and its chape out 13° (clear of the thigh swinging back and of the arm hanging beside it) */
const HANGING = at(0.165, 0.03, 0.12, turn(0.6, 0, 0.22));

/** The sword, in its scabbard, taken by the throat (left hand) where it leans, hung on the belt at the left hip, worn there. */
export function hangSword(k: Knight, scabbard: Item): Behaviour<World> {
  // (straight up first: its chape on the floor by the feet; out to the side upright, turned to hang there, then in to the hip: round the outside of the thigh)
  const up = (s: Required<Placement>) => at(s.position.x, s.position.y + 0.3, s.position.z);
  return function* () {
    yield* take(k, { left: [scabbard, 'throat'] }, { face: facingOf(scabbard, FORWARD) })();
    yield* along(k, facingAt(k, 'hips'), [[scabbard, { left: 'throat' }, [[0.6, up], [0.6, at(0.3, 0.32, 0.3)], [0.7, at(0.34, 0.24, 0.22, HANGING.quaternion)], [0.8, HANGING]]]])();
    yield* wear(k.h, scabbard, INDEX.hips)();
    yield* busy(k, release(k.h, ['left']))();
  };
}

/**
 * Checking the sword draws: the eyes on the hilt (bowed to see it), the left hand steadies the
 * scabbard at its throat, the right takes the hilt across the body, draws a hand's breadth and more
 * of the blade (30 cm), holds a moment and sheathes it again, home into the scabbard; the hands let go.
 */
export function checkDraw(k: Knight, sword: Item, scabbard: Item): Behaviour<World> {
  const hilt = onItem(sword, sword.grips.hilt);
  const sheath = onItem(scabbard, ORIGIN);
  return busy(
    k,
    eyesOn(k, (f) => hilt(f).position, function* () {
      yield* pause(k, SETTLE)();
      yield* reachFor(k.h, { left: [scabbard, 'throat'], right: [sword, 'hilt'] })();
      yield* takeOff(k.h, sword)();
      const drawn = course(sword, (f) => ({ position: sheath(f).position, quaternion: scabbard.current.quaternion.clone() }), [[0.7, at(0, 0.3, 0)], [0.5, still], [0.8, at(0, 0, 0)]], { pace: k.pace });
      yield* parallel<F>('race', carry(k.h, [[sword, { right: 'hilt' }, drawn.to]], { until: drawn.over }), hold(k.h, scabbard, { left: 'throat' }));
      yield* wear(k.h, sword, scabbard, { to: { position: new Vector3(), quaternion: new Quaternion() } })();
      yield* release(k.h, ['left', 'right'])();
    }, 0, AT_THE_WAIST),
  );
}

/** where the helm sits on the head (its middle in the head's frame: round the skull, a finger's breadth all round) */
const HELMED = at(0, 0.15, 0.02, new Quaternion());

/**
 * The helm: taken off its stand in both hands, lifted before the face (a look into it), raised over
 * the head and lowered onto it slowly, the head bowed a little to take it (the eyes ahead and down);
 * worn on the head, settling onto it; the hands go to its chin strap's ends, buckle it under the
 * chin, and let go.
 */
export function putOnHelmet(k: Knight, helmet: Item): Behaviour<World> {
  const grips = { left: 'left', right: 'right' };
  // (before the face and over the head in a level frame at the head: the eyes on the helmet turn the head, which must not turn where it goes)
  const level = facingAt(k, 'head');
  const head = onBone(k.h, INDEX.head, ORIGIN);
  const down = onBone(k.h, INDEX.hips, at(0, 0.15, 1.6), { facing: true });
  return function* () {
    // (its grips are toward its front, away from him: he stands back from them)
    yield* take(k, { left: [helmet, 'left'], right: [helmet, 'right'] }, { stand: { ahead: 0.9 } })();
    yield* eyesOn(k, () => helmet.current.position, along(k, level, [[helmet, grips, [[1.0, at(0, 0.14, 0.3, new Quaternion())], [0.4, still]]]]), 0)();
    yield* along(k, level, [[helmet, grips, [[0.7, at(0, 0.42, 0.26)], [0.6, at(0, 0.4, 0.02)]]]])();
    yield* parallel<F>('race', along(k, head, [[helmet, grips, [[1.2, HELMED]]]]), lookAt(k.h.gazer, reported(k.report, 'gaze', (f) => down(f).position)));
    yield* wear(k.h, helmet, INDEX.head, { to: HELMED })();
    // (the chin strap: its ends from the cheeks, buckled under the chin, a tug)
    yield* busy(k, function* () {
      yield* reachFor(k.h, { left: [helmet, 'strapLeft'], right: [helmet, 'strapRight'] })();
      yield* reachFor(k.h, { left: [helmet, 'chinLeft'], right: [helmet, 'chinRight'] })();
      yield* parallel<F>('race', pause(k, 0.6), hold(k.h, helmet, { left: 'chinLeft', right: 'chinRight' }));
      yield* release(k.h, ['left', 'right'], { away: { left: new Vector3(0.1, -0.4, 0.05), right: new Vector3(-0.1, -0.4, 0.05) } })();
    })();
  };
}

/** where the other hand holds a gauntlet open for hand `side` (its wrist, in the chest's frame): before the belly, fingers ahead and 20° across, palm down */
const heldOpen = (side: Side) => {
  const s = side === 'left' ? 1 : -1;
  return at(0.07 * s, -0.17, 0.36, turn(0, (-110 * s * Math.PI) / 180, 0));
};

/**
 * A gauntlet on hand `side`: the other hand takes it off the table by its cuff (it lies on that
 * hand's side, fingers away) and holds it open before the belly; the hand goes to its mouth and
 * slides in (slowly, in line); worn on that hand, home on it, the other lets go.
 */
export function don(k: Knight, gauntlet: Item, side: Side, stand: Stand): Behaviour<World> {
  const other: Side = side === 'left' ? 'right' : 'left';
  const cuff = { [other]: 'cuff' };
  const fingers = new Vector3(side === 'left' ? 1 : -1, 0, 0);
  return function* () {
    yield* take(k, { [other]: [gauntlet, 'cuff'] }, { face: facingOf(gauntlet, fingers), stand: { ...stand, aside: side === 'left' ? -0.1 : 0.1 } })();
    yield* along(k, facingAt(k, 'chest'), [[gauntlet, cuff, [[1.0, heldOpen(side)]]]])();
    const open = onBone(k.h, INDEX.chest, heldOpen(side), { facing: true });
    yield* eyesOn(k, () => gauntlet.current.position, () => parallel<F>('race', slideIn(k, side, gauntlet, 'mouth', 'inside'), hold(k.h, gauntlet, cuff, { to: open })), 0)();
    yield* wear(k.h, gauntlet, INDEX[`${side}Hand`], { to: { position: new Vector3(), quaternion: new Quaternion() } })();
    yield* busy(k, release(k.h, [other]))();
  };
}

/**
 * Hand `side` into `item` (a gauntlet, a shield's straps): to its grip `entry`, in line, then slowly
 * on to its grip `inside` (fine work: a third of a reach's pace), turning as they say; until the
 * wrist is there (within 1 cm: the hand's turn is as near as the arm takes it). Not there within
 * SLIDING s, it throws.
 */
function slideIn(k: Knight, side: Side, item: Item, entry: string, inside: string): Behaviour<World> {
  const off = (grip: string) => (f: F) => f.prev.position(INDEX[`${side}Hand`]).distanceTo(onItem(item, item.grips[grip])(f).position);
  const until = (grip: string, within: number) => (f: F, _: unknown, time: number) => {
    if (off(grip)(f) < within) return true;
    if (time > SLIDING) throw new Error(`the ${side} hand did not get to the grip "${grip}" in ${SLIDING} s`);
    return false;
  };
  return function* () {
    yield* handTo(k.h, side, item.grips[entry], { on: item, until: until(entry, 0.02) })();
    yield* handTo(k.h, side, item.grips[inside], { on: item, accel: 3, speed: 0.4, until: until(inside, 0.01) })();
  };
}

const SLIDING = 4;

/**
 * the left fist on the shield's grip as the shield is borne (in the hips' frame, facing as the body
 * does): on the forearm across the belly, the fist before the navel, thumb up, the shield's face
 * turned out to the front and left
 */
const FIST = at(0.1, 0.16, 0.32, turn(0, Math.PI + 0.35, 0).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)));

/**
 * The shield off the wall, where it hangs on a peg by its strap, its back to the room: facing it,
 * the right hand steadies it by its edge, the left arm goes through the strap to the grip; worn
 * on the left forearm, the right hand lets go and the left fist lifts it off the peg and draws it
 * back. Then bear it (`bearShield`).
 */
export function takeShield(k: Knight, shield: Item): Behaviour<World> {
  const steady = hold(k.h, shield, { right: 'edge' });
  return function* () {
    yield* take(k, { right: [shield, 'edge'] }, { face: facingOf(shield, BACK) })();
    yield* eyesOn(k, () => shield.current.position, () => parallel<F>('race', slideIn(k, 'left', shield, 'enter', 'grip'), steady), 0)();
    yield* wear(k.h, shield, INDEX.leftLowerArm)();
    yield* closeHand(k.h, 'left', shield, 'grip')();
    // (the right hand off to the side and down, out of the shield's way; then the shield up off the peg and back off the wall)
    const fist = { position: k.h.pose.position(INDEX.leftHand).clone(), quaternion: k.h.pose.rotation(INDEX.leftHand).clone() };
    yield* parallel<F>('race', busy(k, release(k.h, ['right'], { away: { right: new Vector3(-0.3, -0.15, -0.15) } })), handTo(k.h, 'left', fist));
    fist.position.addScaledVector(UP, 0.05).addScaledVector(forwardOf(k.h.gait.facing), -0.08);
    yield* handTo(k.h, 'left', fist, { until: 'reached' })();
  };
}

/** the shield borne on the left arm across the belly: endless */
export const bearShield = (k: Knight): Behaviour<World> => handTo(k.h, 'left', onBone(k.h, INDEX.hips, FIST, { facing: true }));

/** the lance borne upright in the right hand, the fist by the right side at the lower ribs */
const UPRIGHT = at(-0.27, 0.3, 0.22, new Quaternion());

/** The lance out of its rack: the right hand takes it (the lance ahead of the right shoulder: the head clear of the shaft), lifts it out of its socket and brings it in upright by the right side. Then bear it (`bearLance`). */
export function takeLance(k: Knight, lance: Item): Behaviour<World> {
  const lift = (s: Required<Placement>) => at(s.position.x, s.position.y + 0.1, s.position.z);
  return function* () {
    yield* take(k, { right: [lance, 'grip'] }, { stand: { aside: -0.22 } })();
    yield* along(k, facingAt(k, 'hips'), [[lance, { right: 'grip' }, [[0.6, lift], [1.2, UPRIGHT]]]])();
  };
}

/** the lance borne upright by the right side: endless */
export const bearLance = (k: Knight, lance: Item): Behaviour<World> => hold(k.h, lance, { right: 'grip' }, { to: onBone(k.h, INDEX.hips, UPRIGHT, { facing: true }) });

/** Out to the yard: walking there, then looking round it, a while at each of `sights`. */
export function walkOut(k: Knight, yard: Vector3, face: number, sights: readonly Vector3[]): Behaviour<World> {
  return function* () {
    yield* pause(k, SETTLE)();
    yield* walkTo(k.h, { to: yard, face })();
    for (const sight of sights) yield* eyesOn(k, sight, pause(k, 1.4), 0)();
  };
}

/** The harness he stands in before he arms (a squire's work): each piece put on its bone where its frame says, at once, worn from then on. */
export function inHarness(k: Knight, pieces: readonly { bone: BoneName; item: Item }[]): Behaviour<World> {
  return function* () {
    yield* action<F>({
      update: (f) => {
        for (const { bone, item } of pieces) item.move(f.time, f.prev.position(INDEX[bone]), f.prev.rotation(INDEX[bone]));
      },
      until: (_f, _c, time) => time > 0,
    });
    for (const { bone, item } of pieces) yield* wear(k.h, item, INDEX[bone])();
  };
}

const UP = new Vector3(0, 1, 0);
const _eyes = new Vector3();
const _to = new Vector3();
const FORWARD = new Vector3(0, 0, 1);
/** a shield's back, toward the arm: facing it is facing the way −z of its frame goes */
const BACK = new Vector3(0, 0, -1);
