import { Box3, Quaternion, Ray, Vector3 } from 'three';
import { grasp, held as heldThings, lift, onBody } from '../../things/hold';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { inView, noticing } from '../../look/gaze';
import { leftOf, smoothstep } from '../../kernel/math';
import type { Walk } from '../../legs/walk';
import { during, type Request } from '../../kernel/requests';
import { clearArm, placeArm, reaching } from './arms';
import type { Pace } from '../handling';
import { INDEX } from '../../species/humanoid/bones';
import { ARM_REACH } from './bend';
import type { Reacher } from './reacher';
import { pathAhead } from '../../look/around';
import { bringShoulder } from './bend';
import { BODY_RADIUS, LOAD_RESERVE } from './clearance';
import { gripAt, reachFor, type Taking } from './reach';
import { ARM } from './trunk';
import { flat, footing, walking } from './stand';

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
export function* grabbing(person: Reacher, request: Request, takes: readonly Taking[], step: boolean, motion?: Pace) {
  const middle = (f: Frame) => takes.reduce((sum, take) => sum.add(gripAt(person, take, f, _grip)), _middle.set(0, 0, 0)).divideScalar(takes.length);
  const regripping = takes.map((take) => person.holding[take.side]?.thing === take.thing);
  const plan = takes.every((take) => onBody(person, take.thing)) ? 'there' : footing(person, {
    grips: takes.map((take) => ({ side: take.side, at: gripAt(person, take, person.frame) })), mass: Math.max(...takes.map((take) => take.thing.mass)),
    things: [...new Set(takes.map((take) => take.thing))].map((thing) => ({ bounds: thing.bounds, ...person.track(thing.object).current })),
  }, step);
  if (plan === 'nowhere') {
    request.fail();
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
  const share = (f: Frame, k: number) => walk ? 1 : smoothstep(0, 1, 1 - f.prev.position(person.hands[takes[k].side]).distanceTo(gripAt(person, takes[k], f, _grip)) / Math.max(from[k], 1e-6));
  const com = new Vector3(), ahead = new Vector3();
  let noticed = NaN, returning = false;
  const gaze = (f: Frame) => {
    if (Number.isNaN(noticed)) noticed = f.time;
    returning ||= flat(f.prev.com(com), middle(f)) < CLOSE * person.scale || near();
    return stood || returning || f.time - noticed < LOOKING ? middle(f) : pathAhead(person, f.prev, ahead);
  };
  const raisedHand = (f: Frame, take: Taking) => {
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
      reaching(person, take.side, (f) => raisedHand(f, take), { lead: false })))));
    yield* parallel<Frame>('race', reachFor(person, request, takes, motion), function* () {
      yield* action<Frame>({ until: () => stood || preparing() });
      yield* during(request, 'trunk', 'borrowed', (f) => {
        takes.forEach((take, k) => {
          if (!regripping[k]) bringShoulder(person, f, take.side, gripAt(person, take, f, _grip), share(f, k), take.thing.mass, onBody(person, take.thing));
        });
      });
    });
  };
  let held = false;
  yield* parallel<Frame>('all', function* () {
    if (plan === 'there') return;
    // (the hands on the grips, it stands: a walk it has not yet ended — the legs another's — is not walked on, away from what they hold)
    yield* parallel<Frame>('race', action<Frame>({ until: () => held }), function* () {
      if (!(yield* walking(request, plan, REACHED_AFTER))) request.fail();
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
 * The hands on their grips at once, as the body starts (`grab`'s `speed: Infinity`): each arm posed onto its grip as if it had always
 * held it — its history the same, so nothing reads the jump as motion — and a loose thing with a mass taken up where it is. A grip beyond
 * the arm's reach from where the body stands fails it, said in development.
 */
export function* takingAtOnce(person: Reacher, request: Request, takes: readonly Taking[]) {
  if (person.updates > 0) throw new Error('grab: `speed: Infinity` takes hold at once only as a body starts (in its first update): a body already shown reaches for it');
  const f = person.frame, reach = ARM_REACH * person.proportions.armLength;
  for (const take of takes) {
    const short = person.pose.position(INDEX[`${take.side}UpperArm`]).distanceTo(gripAt(person, take, f)) - reach;
    if (short <= 0) continue;
    f.dev?.append(f.time, { check: 'grab at once: a grip beyond the arm’s reach from where the body stands (m short)', value: short, limit: 0,
      where: `${take.thing.object.name} ${take.side} ${take.grip}`, detail: `the arm ${person.proportions.armLength.toFixed(2)} m (species.person.armLength)` });
    request.fail();
  }
  if (request.outcome === 'failed') return;
  let placed = false;
  yield* parallel<Frame>('all', ...takes.map((take) => during(request, `hand.${take.side}`, 'asked', (f) => {
    const frame = person.track(take.thing.object).at(f.time).current;
    placeArm(person, f, take.side, { position: gripAt(person, take, f), quaternion: take.goal.quaternion && frame.quaternion.clone().multiply(take.goal.quaternion) });
    person.startAs((['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const).map((bone) => INDEX[`${take.side}${bone}`]));
    grasp(person, take.side, { thing: take.thing, grip: take.grip, goal: take.goal });
    placed = true;
  }, () => placed)));
  for (const thing of new Set(takes.map((take) => take.thing))) if (thing.massive && !onBody(person, thing)) lift(person, thing);
}

/**
 * `at` (world), on the way from `shoulder` to what `take` takes, drawn back along that way so far as the hand held out along it (its
 * length, half-thickness and reserve) is short of that thing's envelope — the hands rising toward it as the body comes up do not go into
 * it — in place
 */
function shortOf(person: Reacher, take: Taking, shoulder: Vector3, at: Vector3): void {
  const frame = person.track(take.thing.object).current, back = _back.copy(frame.quaternion).invert();
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
const _way = new Vector3(), _hit = new Vector3(), _ray = new Ray();
