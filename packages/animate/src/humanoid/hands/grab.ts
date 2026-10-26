import { Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/frame';
import { looking, SHIFT } from '../../core/gaze';
import { headingOf, smoothstep, wrapAngle } from '../../core/math';
import type { Walk } from '../../core/walk';
import { during, type Request } from '../../body/requests';
import { reaching } from '../arms';
import { INDEX } from '../bones';
import type { Person } from '../person';
import { pathAhead } from '../look';
import { bringShoulder } from '../reach-posture';
import { gripAt, reachFor, type Taking } from './reach';
import { flat, standing, walking } from './stand';

/** Horizontal view cone (rad, ~80°): neck and head turn ~75°, with the eyes taking the rest. Further aside, wait for the approach to turn
 * the body before looking. */
const IN_VIEW = 1.4;
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
export function* grabbing(h: Person, request: Request, takes: readonly Taking[], motion?: { speed: number; accel?: number }) {
  const middle = (f: Frame) => takes.reduce((sum, take) => sum.add(gripAt(h, take, f, _grip)), _middle.set(0, 0, 0)).divideScalar(takes.length);
  const plan = standing(h, { grips: takes.map((take) => ({ side: take.side, at: gripAt(h, take, h.frame) })), mass: Math.max(...takes.map((take) => take.thing.mass)) });
  if (plan === 'nowhere') {
    request.fail();
    return false;
  }
  let stood = plan === 'there';
  const walk: Walk | null = plan === 'there' ? null : plan.walk;
  // (what it moves arrives once the walk does: it is moving nothing else yet)
  const arriving = (seconds: number) => () => walk ? walk.eta <= seconds : h.locomotion.settled;
  const preparing = arriving(LOWERING), near = arriving(LOOKING), raising = arriving(1);
  // (the body bows and bends for the grips under their load: walking up, from the last landing on; from where it stands, as far as each
  // hand has come toward its grip, so that the hands lead it and it does not bow before they set off)
  const from = takes.map((take) => h.pose.position(h.hands[take.side]).distanceTo(gripAt(h, take, h.frame)));
  const share = (f: Frame, k: number) => walk ? 1 : smoothstep(0, 1, 1 - f.prev.position(h.hands[takes[k].side]).distanceTo(gripAt(h, takes[k], f, _grip)) / Math.max(from[k], 1e-6));
  const hands = () => parallel<Frame>('race', function* () { yield* reachFor(h, request, takes, motion); }, function* () {
    yield* action<Frame>({ until: () => stood || preparing() });
    yield* during(request, 'trunk', 'borrowed', (f) => {
      takes.forEach((take, k) => bringShoulder(h, f, take.side, gripAt(h, take, f, _grip), share(f, k), take.thing.mass));
    });
  });
  const com = new Vector3(), ahead = new Vector3();
  let noticed = NaN, returning = false;
  const close = (f: Frame) => flat(f.prev.com(com), middle(f)) < CLOSE * h.scale;
  const seen = (f: Frame) => {
    const at = middle(f);
    f.prev.com(com);
    return Math.abs(wrapAngle(headingOf(at.x - com.x, at.z - com.z) - h.locomotion.facing)) < IN_VIEW;
  };
  const gaze = (f: Frame) => {
    if (Number.isNaN(noticed)) noticed = f.time;
    returning ||= close(f) || near();
    return stood || returning || f.time - noticed < LOOKING ? middle(f) : pathAhead(h, f.prev, ahead);
  };
  const waitingHands = function* () {
    yield* action<Frame>({ until: (f) => stood || (seen(f) && raising()) });
    // (the hands rising halfway toward what they take, before the body has come up to it)
    yield* parallel<Frame>('race', action<Frame>({ until: () => stood || near() }), () => parallel<Frame>('all', ...takes.map((take) => during(request, `hand.${take.side}`, 'asked',
      reaching(h, take.side, (f) => ({ position: f.prev.position(INDEX[`${take.side}UpperArm`]).clone().lerp(gripAt(h, take, f, _grip), 0.5) }), { lead: false })))));
    yield* hands();
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
    // (the eyes never borrowed toward what they cannot see; they leave it as the hands close on it)
    yield* action<Frame>({ until: (f) => stood || seen(f) });
    yield* parallel<Frame>('race', waitingHands, during(request, 'look', 'borrowed', looking(h, gaze, SHIFT)));
    held = true;
  });
  return request.outcome !== 'failed';
}

const _grip = new Vector3(), _middle = new Vector3();
