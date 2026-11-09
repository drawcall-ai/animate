import { action } from '@pmndrs/timeline';
import { Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { forwardOf, headingOf, headingOfTurn, leftOf } from '../kernel/math';
import { during, type Request } from '../kernel/requests';
import { comingToRest } from '../kernel/rest';
import { stallOf, Walk } from '../step/walk';
import { finder, type Target } from '../things/target';
import { INDEX } from './anatomy/bones';
import { Seat, seating } from './legs/seat';
import type { Person } from './person';

/** Tuned: the most (s) a sit or a stand waits on the trunk once the hips are there: its bow gives back in about this, and another verb may keep it moving */
const SITTING_UP = 1;

/** `person` walking up to `seat`, turning its back to it and sitting (`sit`) */
export function* sitting(person: Person, request: Request, seat: Target, face: number | undefined, speed: number | undefined) {
  if (person.drive) throw new Error('the body goes where its app drives it');
  const found = finder(person, seat)(person.frame), at = found.position.clone(), com = person.pose.com(new Vector3());
  const yaw = face ?? (found.quaternion ? headingOfTurn(found.quaternion) : headingOf(com.x - at.x, com.z - at.z));
  const place = seating(person, at, yaw);
  if ('why' in place) return request.fail(place);
  const via = roundSeat(com, at, place.stand, yaw, CLEARING * person.scale);
  const walk = new Walk(person, { to: () => place.stand, face: () => yaw, via: via.map((point) => () => point), speed, backs: true });
  yield* during(request, 'legs', 'asked', (f) => {
    const go = walk.step(f);
    request.eta = walk.ends + place.seconds;
    return go;
  }, (f: Frame, _, time) => time > 0 && (walk.arrived(f) || walk.stall !== null));
  if (walk.stall) return request.fail(stallOf(person, request, walk.stall));
  const taken = (person.seat = new Seat(person, place));
  request.there = () => taken.seated;
  yield* action<Frame>({
    init: () => () => { taken.rising ||= !taken.seated; },
    update: () => { request.eta = taken.left; },
    until: () => taken.seated || taken.rising,
  });
  if (taken.rising) return request.fail({ where: 'seat', off: Infinity, limit: 0, why: 'its legs were asked elsewhere as it sat' });
  // (the trunk comes up off its bow at its own pace, a little after the hips are down)
  yield* comingToRest([INDEX.chest], () => SITTING_UP);
  request.met();
}

/** `person`, seated, standing (`stand`) */
export function* rising(person: Person, request: Request) {
  if (!person.seat) return request.met();
  person.seat.rising = true;
  yield* action<Frame>({ until: () => !person.seat });
  yield* comingToRest([INDEX.chest], () => SITTING_UP);
  request.met();
}

/** Tuned: how far (m, default body) a body's middle keeps from a seat's as it passes: half a chair and half the body. Nothing measures the chair: `sit`'s doc */
const CLEARING = 0.55;

/** the points to pass from `from` to `stand`, before the seat at `at` facing `yaw`: a body behind or across it goes round on its near side */
function roundSeat(from: Vector3, at: Vector3, stand: Vector3, yaw: number, clear: number): Vector3[] {
  const left = leftOf(yaw), ahead = forwardOf(yaw), off = from.clone().sub(at).setY(0);
  if (off.dot(ahead) >= stand.clone().sub(at).setY(0).dot(ahead)) return [];
  const side = Math.sign(off.dot(left)) || 1, beside = left.multiplyScalar(side * clear);
  const front = stand.clone().add(beside);
  return off.dot(ahead) < 0 ? [at.clone().add(beside).setY(0), front] : [front];
}
