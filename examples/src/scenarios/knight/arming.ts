import { Euler, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { closeHand, grab, handTo, hold, INDEX, lookAt, walkTo, type Behaviour, type Frame, type Item, type Live, type Placement, type Side, type World } from '@drawcall/animate';
import { reported } from '../../report';
import { carry, eyesFirst, facingAt, headFrame, itemFrame, letGo, pause, placed, put, reach, route, slideIn, take, type Knight, type Leg } from './handling';

// Arming: the knight's behaviours, one piece of gear each, made of the handling pieces over the
// package's tasks. Placements are in the frame of the body they go to (left +x, up +y, ahead +z; m,
// default body), timed at a calm pace: a reach of 30–60 cm in about a second (Fitts' law at
// everyday precision), fine work (a strap through a buckle, a hand into a gauntlet) at half that speed.

type F = Frame<World>;

/** the frame at the hips, facing as the body does */
const hips = (k: Knight) => facingAt(k.h, INDEX.hips);
/** at the chest */
const chest = (k: Knight) => facingAt(k.h, INDEX.chest);

const UP = new Vector3(0, 1, 0);
const at = (x: number, y: number, z: number, quaternion?: Quaternion): Placement => ({ position: new Vector3(x, y, z), quaternion });
/** a leg that stays where the one before ended: a moment held still */
const still = (_: Required<Placement>, last: Placement) => last;
const turn = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));

/**
 * The sword belt: its two ends taken off the table, lifted and carried out round the hips (the
 * strap swung behind them), drawn round to the front, the tongue put through the buckle and
 * pulled tight, the eyes on it; then worn on the hips.
 */
export function buckle(k: Knight, belt: { buckle: Item; tongue: Item }, face: number): Behaviour<World> {
  const round = (s: 1 | -1): Leg[] => [
    [1.0, at(0.3 * s, 0.14, 0.34)], // off the table, out in front
    [1.1, at(0.26 * s, 0.07, -0.05)], // out round the hips: the strap behind them
  ];
  const front = at(0, 0.05, 0.17);
  return function* () {
    yield* take(k, { left: [belt.buckle, 'end'], right: [belt.tongue, 'end'] }, face)();
    yield* carry(k, [
      [belt.buckle, { left: 'end' }, route(k, belt.buckle, hips(k), round(1))],
      [belt.tongue, { right: 'end' }, route(k, belt.tongue, hips(k), round(-1))],
    ])();
    // (drawn round to the front, the ends together, the tongue through the buckle and pulled tight)
    const buckled = route(k, belt.buckle, hips(k), [[0.8, at(0.17, 0.05, 0.14)], [0.6, at(0.035, 0.05, 0.165)], [0.75, at(0.035, 0.05, 0.165)]]);
    const pulled = route(k, belt.tongue, hips(k), [[0.8, at(-0.17, 0.05, 0.14)], [0.6, at(-0.035, 0.05, 0.165)], [0.4, at(0.005, 0.05, 0.17)], [0.35, at(-0.05, 0.05, 0.165)]]);
    yield* eyesFirst(k, placedAt(hips(k), front), carry(k, [[belt.buckle, { left: 'end' }, buckled], [belt.tongue, { right: 'end' }, pulled]]), 0)();
    yield* put(k, belt.buckle, INDEX.hips)();
    yield* put(k, belt.tongue, INDEX.hips)();
    yield* letGo(k, ['left', 'right'])();
  };
}

/** where the scabbard's throat hangs on the belt: before the left hip, the hilt up and forward, the scabbard down and back 35° and its chape out 13° (clear of the thigh swinging back and of the arm hanging beside it) */
const HANGING = at(0.165, 0.03, 0.12, turn(0.6, 0, 0.22));

/** The sword, in its scabbard, taken off the table by the throat (left hand), hung on the belt at the left hip, worn there. */
export function hangSword(k: Knight, scabbard: Item, face: number): Behaviour<World> {
  return function* () {
    yield* take(k, { left: [scabbard, 'throat'] }, face)();
    // (straight up first: its chape on the floor by the foot)
    const up = (s: Required<Placement>) => at(s.position.x, s.position.y + 0.3, s.position.z);
    // (out to the side upright, turned to hang there, then in to the hip: round the outside of the thigh)
    yield* carry(k, [[scabbard, { left: 'throat' }, route(k, scabbard, hips(k), [[0.6, up], [0.6, at(0.3, 0.32, 0.3)], [0.7, at(0.34, 0.24, 0.22, HANGING.quaternion)], [0.8, HANGING]])]])();
    yield* put(k, scabbard, INDEX.hips)();
    yield* letGo(k, ['left'])();
  };
}

/**
 * Checking the sword draws: the eyes on the hilt, the left hand steadies the scabbard at its throat,
 * the right takes the hilt across the body, draws a hand's breadth and more of the blade (30 cm),
 * holds a moment and sheathes it again; then the hands let go.
 */
export function checkDraw(k: Knight, sword: Item, scabbard: Item): Behaviour<World> {
  const hilt = (f: F) => placed(itemFrame(sword), { position: sword.grips.hilt.position })(f).position;
  return eyesFirst(k, hilt, function* () {
      yield* reach(k, { left: [scabbard, 'throat'], right: [sword, 'hilt'] })();
      k.worn.take(sword);
      const drawn = route(k, sword, itemFrame(scabbard), [[0.7, at(0, 0.3, 0)], [0.5, at(0, 0.3, 0)], [0.8, at(0, 0, 0)]]);
      yield* parallel<F>('race', carry(k, [[sword, { right: 'hilt' }, drawn]]), hold(k.h, scabbard, { left: 'throat' }));
      yield* put(k, sword, scabbard)();
      yield* letGo(k, ['left', 'right'])();
    });
}

/** where the helm sits on the head (its middle in the head's frame) */
const HELMED = at(0, 0.15, 0, new Quaternion());

/**
 * The helm: taken off its stand in both hands, lifted before the face (a look into it), raised over
 * the head and lowered onto it slowly, the head bowed a little to take it (the eyes ahead and down);
 * worn on the head, the hands let go.
 */
export function putOnHelmet(k: Knight, helmet: Item, face: number): Behaviour<World> {
  const grips = { left: 'left', right: 'right' };
  // (before the face and over the head in a level frame at the head: the eyes on the helmet turn the head, which must not turn where it goes)
  const level = facingAt(k.h, INDEX.head);
  const down = placed(hips(k), at(0, 0.15, 1.6));
  return function* () {
    // (its grips are toward its front, away from him: he stands back from them)
    yield* take(k, { left: [helmet, 'left'], right: [helmet, 'right'] }, face, { ahead: 0.9 })();
    // (held a moment before the face: a look into it)
    yield* eyesFirst(k, (f) => helmet.current.position, carry(k, [[helmet, grips, route(k, helmet, level, [[1.0, at(0, 0.14, 0.3, new Quaternion())], [0.4, still]])]]), 0)();
    yield* carry(k, [[helmet, grips, route(k, helmet, level, [[0.7, at(0, 0.42, 0.26)], [0.6, at(0, 0.4, 0.06)]])]])();
    yield* parallel<F>('race', carry(k, [[helmet, grips, route(k, helmet, headFrame(k.h), [[1.2, HELMED]])]]), lookAt(k.h.gazer, reported(k.report, 'gaze', (f) => down(f).position)));
    yield* put(k, helmet, INDEX.head, HELMED)();
    yield* letGo(k, ['left', 'right'], { left: new Vector3(0.1, -0.5, 0), right: new Vector3(-0.1, -0.5, 0) })();
  };
}

/** where the other hand holds a gauntlet open for hand `side` (its wrist, in the chest's frame): before the belly, fingers ahead and 20° across, palm down */
const heldOpen = (side: Side) => {
  const s = side === 'left' ? 1 : -1;
  return at(0.07 * s, -0.17, 0.36, turn(0, (-110 * s * Math.PI) / 180, 0));
};

/**
 * A gauntlet on hand `side`: the other hand takes it off the table by its cuff and holds it open
 * before the belly; the hand goes to its mouth and slides in (slowly, in line); worn on that
 * hand, the other lets go.
 */
export function don(k: Knight, gauntlet: Item, side: Side, face: number): Behaviour<World> {
  const other: Side = side === 'left' ? 'right' : 'left';
  const cuff = { [other]: 'cuff' };
  const open = placed(chest(k), heldOpen(side));
  return function* () {
    // (it lies on the side of the hand that takes it)
    yield* take(k, { [other]: [gauntlet, 'cuff'] }, face, { aside: side === 'left' ? -0.1 : 0.1 })();
    yield* carry(k, [[gauntlet, cuff, route(k, gauntlet, chest(k), [[1.0, heldOpen(side)]])]])();
    yield* eyesFirst(
      k,
      (f) => gauntlet.current.position,
      () => parallel<F>(
        'race',
        slideIn(k, side, gauntlet, 'mouth', 'inside'),
        hold(k.h, gauntlet, cuff, { to: open }),
      ),
      0,
    )();
    yield* put(k, gauntlet, INDEX[`${side}Hand`])();
    yield* letGo(k, [other])();
  };
}

/** the shield borne: on the left forearm across the belly, the fist before the navel, its face turned out to the front and left (its frame in the hips') */
const BORNE = at(0.1, 0.16, 0.32, turn(0, Math.PI + 0.35, 0));
/** the left fist on the shield's grip as it is borne (thumb up, the forearm through the strap) */
const FIST = at(0.1, 0.16, 0.32, BORNE.quaternion?.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)));

/**
 * The shield off the wall, where it hangs on a peg by its strap, its back to the room: the right
 * hand steadies it by its top rim, the left arm goes through the strap to the grip; worn on the left
 * forearm, the right hand lets go and the left fist lifts it off the peg and draws it back. Then
 * bear it (`bearShield`).
 */
export function takeShield(k: Knight, shield: Item, face: number): Behaviour<World> {
  const steady = hold(k.h, shield, { right: 'rim' });
  return function* () {
    yield* take(k, { right: [shield, 'rim'] }, face)();
    yield* eyesFirst(k, (f) => shield.current.position, () => parallel<F>('race', slideIn(k, 'left', shield, 'enter', 'grip'), steady), 0)();
    yield* put(k, shield, INDEX.leftLowerArm)();
    yield* closeHand(k.h, 'left', shield, 'grip')();
    // (the right hand off to the side and down, out of the shield's way; then the shield up off the peg and back off the wall)
    const fist = { position: k.h.pose.position(INDEX.leftHand).clone(), quaternion: k.h.pose.rotation(INDEX.leftHand).clone() };
    yield* parallel<F>('race', letGo(k, ['right'], { right: new Vector3(-0.25, -0.35, 0) }), handTo(k.h, 'left', fist));
    fist.position.addScaledVector(UP, 0.05).addScaledVector(new Vector3(Math.sin(k.h.gait.facing), 0, Math.cos(k.h.gait.facing)), -0.08);
    yield* handTo(k.h, 'left', fist, { until: 'reached' })();
  };
}

/** the shield borne on the left arm across the belly: endless */
export const bearShield = (k: Knight): Behaviour<World> => handTo(k.h, 'left', placed(hips(k), FIST));

/** the lance borne upright in the right hand, the fist by the right side at the lower ribs */
const UPRIGHT = at(-0.27, 0.3, 0.22, new Quaternion());

/** The lance out of its rack: the right hand takes it, lifts it out of its socket and brings it in upright by the right side. Then bear it (`bearLance`). */
export function takeLance(k: Knight, lance: Item, face: number): Behaviour<World> {
  const lift = (s: Required<Placement>) => at(s.position.x, s.position.y + 0.1, s.position.z);
  return function* () {
    // (ahead of the right shoulder: the head stays clear of the shaft as the body bows for it)
    yield* take(k, { right: [lance, 'grip'] }, face, { aside: -0.18 })();
    yield* carry(k, [[lance, { right: 'grip' }, route(k, lance, hips(k), [[0.6, lift], [1.2, UPRIGHT]])]])();
  };
}

/** the lance borne upright by the right side: endless */
export const bearLance = (k: Knight, lance: Item): Behaviour<World> => hold(k.h, lance, { right: 'grip' }, { to: placed(hips(k), UPRIGHT) });

/** Out to the yard: walking there, then looking round it, a while at each of `sights`. */
export function walkOut(k: Knight, yard: Vector3, face: number, sights: readonly Vector3[]): Behaviour<World> {
  return function* () {
    yield* walkTo(k.h, { to: yard, face })();
    for (const sight of sights) yield* eyesFirst(k, sight, pause(k, 1.4), 0)();
  };
}

/** a placement in a moving frame, its position */
const placedAt =
  (frame: ReturnType<typeof hips>, local: Placement): Live<Vector3, World> =>
  (f) =>
    placed(frame, local)(f).position;
