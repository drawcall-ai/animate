import { Vector3 } from 'three';
import { held as heldThings, onBody } from '../../things/hold';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { inView, noticing } from '../../look/gaze';
import { leftOf, smoothstep } from '../../kernel/math';
import type { Walk } from '../../legs/walk';
import { during, type Request } from '../../kernel/requests';
import { clearArm, reaching } from './arms';
import { INDEX } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { pathAhead } from '../../look/around';
import { bringShoulder } from './bend';
import { BODY_RADIUS } from './clearance';
import { gripAt, reachFor, type Taking } from './reach';
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

/**
 * Taking hold of things, each step under way before the last is over: the body walks up to take them (borrowed legs); once they are in
 * view the eyes notice them (borrowed), follow the path during a long approach, and return to them within two steps of arriving;
 * within the last second the hands (asked) rise toward them, and as it arrives they reach them, the body bowing and bending with the
 * reach; the hands close on them and the eyes leave. `false` if it can stand nowhere to take them.
 */
export function* grabbing(person: Reacher, request: Request, takes: readonly Taking[], motion?: { speed: number; accel?: number }) {
  const middle = (f: Frame) => takes.reduce((sum, take) => sum.add(gripAt(person, take, f, _grip)), _middle.set(0, 0, 0)).divideScalar(takes.length);
  const regripping = takes.map((take) => person.holding[take.side]?.thing === take.thing);
  const plan = takes.every((take) => onBody(person, take.thing)) ? 'there' : footing(person, {
    grips: takes.map((take) => ({ side: take.side, at: gripAt(person, take, person.frame) })), mass: Math.max(...takes.map((take) => take.thing.mass)),
  });
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
    const at = f.prev.position(INDEX[`${take.side}UpperArm`]).clone().lerp(gripAt(person, take, f, _grip), 0.5);
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

const _grip = new Vector3(), _middle = new Vector3();
