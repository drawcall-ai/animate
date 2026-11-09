import { MathUtils, Box3, Quaternion, Ray, Vector3 } from 'three';
import { bear, bodyOf, grasp, held as heldThings, lift, onBody } from '../../things/hold';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { inView, noticing } from '../../look/gaze';
import { forwardOf, leftOf } from '../../kernel/math';
import type { Walk } from '../../step/walk';
import { during, type Request } from '../../kernel/requests';
import { placeArm, reaching } from './arms';
import { clearArm } from './hang';
import type { Pace } from '../../body/hand-staging';
import { INDEX } from '../anatomy/bones';
import { ARM_REACH } from './shoulder';
import { pathAhead } from '../look/around';
import { bringShoulder } from './shoulder';
import { BODY_RADIUS, LOAD_RESERVE } from './load-clearance';
import { approach } from './approach';
import { loadLean } from '../legs/walk-pose';
import { handsGoing, withinArm } from './reach';
import { emptyAt, gripAt, handPlanOf, holdOn, type HandPlan } from './plan';
import { handsHolding } from './travel';
import { CARRYING, guidesFor } from './guide';
import { sideOf } from '../anatomy/bones';
import type { Thing } from '../../things/thing';
import { ARM } from './arm-clearance';
import { flat, footing, walkingToReach } from './standing-spot';
import type { Person } from '../person';

/** Minimum final-approach gaze lead (s); distance also brings the eyes back within two steps. */
const LOOKING = 0.6;
/** Prepare the knees during the last landing (s before arrival). */
const LOWERING = 0.3;
/** how long after the walk arrives the hands are on the grips (s, derived): a calm reach of ~0.5 m takes ~0.95 s (`reachTime`), set off
 * `LOOKING` s before arriving */
const REACHED_AFTER = 0.35;
/** Two-step gaze horizon (read via summary); default-body distance proxy (m, derived). */
const CLOSE = 1.6;

/** Overlap gaze, walking and hand preparation; fail when no reachable stand exists. */
export function* grabbing(person: Person, request: Request, takes: readonly HandPlan[], step: boolean, motion?: Pace) {
  const middle = (f: Frame) => takes.reduce((sum, take) => sum.add(gripAt(person, take, f, _grip)), _middle.set(0, 0, 0)).divideScalar(takes.length);
  // (what its hands hold already — this one regripping it, or the other — rides with the body: bowing toward it brings it along, so the
  // bow would never bring the grip nearer, only bend the trunk as far as it goes)
  const holding = takes.map((take) => heldThings(person).includes(take.thing));
  const plan = takes.every((take) => onBody(person, take.thing)) ? 'there' : footing(person, {
    // (stood to as if the wrist went on the empty: the hand still hangs, so the palm's way back from it is not yet the reach's)
    grips: takes.map((take) => ({ side: take.side, at: emptyAt(person, take, person.frame) })), mass: Math.max(...takes.map((take) => take.thing.mass)),
    things: [...new Set(takes.map((take) => take.thing))].map((thing) => ({ bounds: thing.bounds, ...person.movingFrameOf(thing.object).current })),
  }, step);
  if (plan !== 'there' && 'nowhere' in plan) {
    // (no stand in reach: the hands go as far as they can as the body stands, the eyes on them, for as long as a reach there takes, and it misses)
    const going = handsGoing(person, takes.map((take) => ({ side: take.side, target: (f: Frame) => withinArm(person, f, take.side, { position: gripAt(person, take, f, new Vector3()) }) })), motion?.speed);
    const until = person.frame.time + Math.max(...going.map((hand) => hand.lasts));
    yield* parallel<Frame>('race', noticing(person, request, middle), action<Frame>({ until: (f) => f.time >= until }), ...going.map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)));
    request.fail({ ...plan.nowhere, where: takes.map(({ thing, side, grip }) => `${thing.object.name} ${side} ${grip}`).join(', ') });
    return false;
  }
  let stood = plan === 'there';
  const walk: Walk | null = plan === 'there' ? null : plan.walk;
  // (the walk up ends within `seconds`: standing there already, once the body is at rest)
  const walkEnds = (seconds: number) => () => walk ? walk.eta <= seconds : person.locomotion.settled;
  const preparing = walkEnds(LOWERING), near = walkEnds(LOOKING), raising = walkEnds(1);
  // (the body bows and bends for the grips under their load: walking up, from the last landing on; from where it stands, as far as each
  // hand has come toward its grip, so that the hands lead it and it does not bow before they set off)
  const from = takes.map((take) => person.pose.position(person.hands[take.side]).distanceTo(gripAt(person, take, person.frame)));
  const share = (f: Frame, k: number) => walk ? 1 : MathUtils.smoothstep(1 - f.prev.position(person.hands[takes[k].side]).distanceTo(gripAt(person, takes[k], f, _grip)) / Math.max(from[k], 1e-6), 0, 1);
  const com = new Vector3(), ahead = new Vector3();
  let noticed = NaN, returning = false;
  const gaze = (f: Frame) => {
    if (Number.isNaN(noticed)) noticed = f.time;
    returning ||= flat(f.prev.com(com), middle(f)) < CLOSE * person.scale || near();
    return stood || returning || f.time - noticed < LOOKING ? middle(f) : pathAhead(person, f.prev, ahead);
  };
  const raisedHand = (f: Frame, take: HandPlan) => {
    const shoulder = f.prev.position(INDEX[`${take.side}UpperArm`]);
    const at = shoulder.clone().lerp(gripAt(person, take, f, _grip), 0.5);
    shortOf(person, take, shoulder, at);
    const left = leftOf(person.locomotion.facing), sign = take.side === 'left' ? 1 : -1;
    const out = at.clone().sub(f.prev.position(0)).dot(left) * sign;
    // Prepare on the hand's own side while turning. Paired hands may come inward below the torso's rounded lower boundary.
    if (takes.length === 1 || at.y >= f.prev.position(0).y - BODY_RADIUS * person.proportions.height) {
      at.addScaledVector(left, sign * Math.max(0, person.proportions.shoulderHalfWidth - out));
    }
    return { position: clearArm(person, f, take.side, at, undefined, [take.thing, ...heldThings(person)]) };
  };
  const waitingHands = function* () {
    yield* action<Frame>({ until: (f) => stood || (inView(person, middle(f), f) && raising()) });
    // (the hands rising halfway toward what they take, before the body has come up to it)
    yield* parallel<Frame>('race', action<Frame>({ until: () => stood || near() }), () => parallel<Frame>('all', ...takes.map((take) => during(request, `hand.${take.side}`, 'asked',
      reaching(person, take.side, (f) => raisedHand(f, take), { bodyFollows: false })))));
    yield* parallel<Frame>('race', approach(person, request, takes, motion), function* () {
      yield* action<Frame>({ until: () => stood || preparing() });
      yield* during(request, 'trunk', 'borrowed', (f) => {
        takes.forEach((take, k) => {
          if (!holding[k]) bringShoulder(person, f, take.side, gripAt(person, take, f, _grip), share(f, k), take.thing.mass, onBody(person, take.thing));
        });
      });
    });
  };
  let held = false;
  yield* parallel<Frame>('all', function* () {
    if (plan === 'there') return;
    // (the hands on the grips, it stands: a walk it has not yet ended — the legs another's — is not walked on, away from what they hold)
    yield* parallel<Frame>('race', action<Frame>({ until: () => held }), function* () {
      const stall = yield* walkingToReach(request, plan, REACHED_AFTER);
      if (stall) request.fail(stall);
    });
    stood = true;
  }, function* () {
    // (the eyes leave it as the hands close on it)
    yield* parallel<Frame>('race', waitingHands, noticing(person, request, gaze, { seen: middle, anyway: () => stood }));
    held = true;
  });
  return request.outcome !== 'failed';
}

/**
 * The hands on their grips at once, before the body's first sub-step (`grab`'s `already`): each arm posed onto its grip as if it had always
 * held it — its history the same, so nothing reads the jump as motion, and balance setting out from the body as it now is — and a loose thing
 * with a mass taken up where it is, staying there (`SETTLING`) as the body settles under it, the arms taking that up. A grip beyond the arm's
 * reach from where the body stands fails it.
 */
export function holdingAtOnce(person: Person, request: Request, thing: Thing, named: readonly { hand: string; grip: string }[]): void {
  if (person.updates > 0) throw new Error('grab: `already` holds it only as a body starts (in its first update): a body already shown reaches for it');
  const takes = named.map(({ hand, grip }) => handPlanOf(person, sideOf(hand), thing, grip));
  const f = person.frame, reach = ARM_REACH * person.proportions.armLength;
  for (const take of takes) {
    const short = person.pose.position(INDEX[`${take.side}UpperArm`]).distanceTo(gripAt(person, take, f)) - reach;
    if (short <= 0) continue;
    request.fail({ where: `${thing.object.name} ${take.side} ${take.grip}`, off: short, limit: 0,
      why: `at once, the grip is ${short.toFixed(2)} m beyond the arm's reach from where the body stands (the arm ${person.proportions.armLength.toFixed(2)} m: species.person.armLength): start it nearer` });
  }
  if (request.outcome === 'failed') return;
  const frame = person.movingFrameOf(thing.object).at(f.time).current, place = { position: frame.position.clone(), quaternion: frame.quaternion.clone() };
  const posed = () => takes.forEach((take) => {
    // (posed again until the wrist stays put: on a grip that sets no turn the wrist is a palm back from it along the hand as last posed)
    const wrist = new Vector3(Infinity, 0, 0);
    for (let pass = 0; pass < 32 && wrist.distanceTo(gripAt(person, take, f)) > 1e-6; pass++) {
      placeArm(person, f, take.side, { position: wrist.copy(gripAt(person, take, f)), quaternion: take.goal.quaternion && place.quaternion.clone().multiply(take.goal.quaternion) });
      person.startAs((['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const).map((bone) => INDEX[`${take.side}${bone}`]));
    }
  });
  posed();
  for (const take of takes) grasp(person, take.side, { ...holdOn(person, take), by: request });
  request.met();
  if (!thing.massive || bodyOf(thing.object)) return;
  lift(person, thing);
  // (its weight borne from the start, and the trunk leaning against it as it would: balance sets out from them, nothing to take up)
  bear(person, f, [], person.borne);
  const facing = person.locomotion.facing, spine = new Quaternion().setFromAxisAngle(_right, -loadLean(f.current, person.proportions, forwardOf(facing)) / 2);
  f.current.setLocal(INDEX.spine, spine);
  f.current.setLocal(INDEX.chest, spine);
  person.startAs([INDEX.spine, INDEX.chest]);
  posed();
  bear(person, f, [], person.borne);
  person.startAs(takes.map((take) => person.hands[take.side]));
  const guide = guidesFor(person, thing, CARRYING, false)();
  for (const { hold, move } of handsHolding(person, thing, guide, place)) hold.idle = (at) => {
    move(at);
    if (at.time >= SETTLING || person.claims.owner('legs')) hold.idle = undefined;
  };
}

/** Tuned: how long (s) from its start a body settles under its weight and its own stance: its first half second and a little (a heavy tray's rise, measured) */
const SETTLING = 1;

/**
 * `at` (world), on the way from `shoulder` to what `take` takes, drawn back along that way so far as the hand held out along it (its
 * length, half-thickness and reserve) is short of that thing's envelope — the hands rising toward it as the body comes up do not go into
 * it — in place
 */
function shortOf(person: Person, take: HandPlan, shoulder: Vector3, at: Vector3): void {
  const frame = person.movingFrameOf(take.thing.object).current, back = _back.copy(frame.quaternion).invert();
  const box = _box.copy(take.thing.bounds).expandByScalar(ARM.hand * person.proportions.height + LOAD_RESERVE * person.scale);
  if (box.isEmpty()) return;
  const from = _from.copy(shoulder).sub(frame.position).applyQuaternion(back), to = _to.copy(at).sub(frame.position).applyQuaternion(back);
  if (box.containsPoint(from)) return;
  const way = _way.subVectors(to, from), length = way.length(), hand = ARM.length * person.proportions.height;
  const hit = _ray.set(from, way.normalize()).intersectBox(box, _hit);
  if (!hit) return;
  const most = Math.max(0, from.distanceTo(hit) - hand);
  if (length <= most) return;
  at.copy(from).addScaledVector(way, most).applyQuaternion(frame.quaternion).add(frame.position);
}

const _grip = new Vector3(), _middle = new Vector3(), _back = new Quaternion(), _box = new Box3(), _from = new Vector3(), _to = new Vector3();
const _way = new Vector3(), _hit = new Vector3(), _ray = new Ray(), _right = new Vector3(1, 0, 0);
