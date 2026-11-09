import { action } from '@pmndrs/timeline';
import { Vector3 } from 'three';
import { during } from '../kernel/requests';
import type { Frame } from '../kernel/frame';
import { forwardOf, headingOf, headingOfTurn, leftOf } from '../kernel/math';
import { Body, selfOf } from '../body';
import { personOf } from '../person/person';
import { Walk } from '../step/walk';
import { Seat, seating } from '../person/legs/seat';
import { finder, type Target } from './targets';
import { comingToRest } from './pose';
import { stallOf } from './walk';
import { INDEX } from '../person/anatomy/bones';
import { verb, type Until, type Verb } from './story';

/** Tuned: the most (s) a sit or a stand waits on the trunk once the hips are there: its bow gives back in about this, and another verb may keep it moving */
const SITTING_UP = 1;

/** How a sit goes. */
export interface SitOptions {
  /** the facing to sit with (rad about +Y; 0 faces +Z); default the seat's own (an `Object3D`'s +Z), else away from the seat as the body comes */
  face?: number;
  /** its top speed walking there (m/s) */
  speed?: number;
  /** ends on this instead of sitting: `true` if it is seated as it ends; cut short before, it stands */
  until?: Until;
}

/**
 * A person walks up to `seat` — the point on the surface under its hips: a point, or an empty on the thing, read as it starts — round it if
 * it comes from behind, turns its back to it and sits, its feet flat on the floor before it. A mover, it ends once seated; it stays so,
 * breathing, looking and free in its hands (`lookAt`, `reach`, `grab`, `pose`'s trunk and arms: its `lower` waits) until `stand` or anything
 * that asks its legs (`walkTo`, a reach beyond its arm) stands it, ~1.5 s. It throws `Missed` before setting off if the seat is too high or
 * too low for its legs (about 0.25–0.75 of its leg's length), or no level floor lies before it for its feet; and if its walk there stalls,
 * or its legs are asked elsewhere as it sits. The library has no collision, so what stands round a seat is not seen: it walks through the
 * chair's back and arms coming round, and a wall behind a seat, so bring a walled seat from the front.
 */
export function sit(body: Body, seat: Target, options: SitOptions = {}): Verb {
  const { face, speed, until } = options;
  if (seat instanceof Body) throw new Error('sit: a body is no seat');
  if (speed !== undefined && !(speed > 0)) throw new Error(`sit: a speed of ${speed}`);
  if (face !== undefined && !Number.isFinite(face)) throw new Error(`sit: a facing of ${face}: give radians about +Y`);
  if (!body.species.person) throw new Error(`sit: a ${body.species.name ?? 'custom species'} does not sit; a person does`);
  return verb(body, 'sit', (request) => function* () {
    const person = personOf(selfOf(body));
    if (person.drive) throw new Error('the body goes where its app drives it');
    const found = finder(person, seat)(person.frame), at = found.position.clone(), com = person.pose.com(new Vector3());
    const yaw = face ?? (found.quaternion ? headingOfTurn(found.quaternion) : headingOf(com.x - at.x, com.z - at.z));
    const place = seating(person, at, yaw);
    if ('why' in place) return request.fail(place);
    const via = roundSeat(com, at, place.stand, yaw, CLEARING * person.scale);
    const walk = new Walk(person, { to: () => place.stand, face: () => yaw, via: via.map((point) => () => point), speed, backs: true });
    yield* during(request, 'go', 'asked', (f) => {
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
  }, { until });
}

/** A seated person stands, its feet where they are: it ends once it has stood. Standing, it ends at once. */
export function stand(body: Body): Verb {
  if (!body.species.person) throw new Error(`stand: a ${body.species.name ?? 'custom species'} does not sit to stand from`);
  return verb(body, 'stand', (request) => function* () {
    const person = personOf(selfOf(body));
    if (!person.seat) return request.met();
    person.seat.rising = true;
    yield* action<Frame>({ until: () => !person.seat });
    yield* comingToRest([INDEX.chest], () => SITTING_UP);
    request.met();
  });
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
