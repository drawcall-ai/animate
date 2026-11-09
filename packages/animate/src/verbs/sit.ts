import { Body, selfOf } from '../body';
import type { Target } from '../things/target';
import { verb, type Until, type Verb } from './story';

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
  return verb(body, 'sit', (request) => () => selfOf(body).person.sitting(request, seat, face, speed), { until });
}

/** A seated person stands, its feet where they are: it ends once it has stood. Standing, it ends at once. */
export function stand(body: Body): Verb {
  if (!body.species.person) throw new Error(`stand: a ${body.species.name ?? 'custom species'} does not sit to stand from`);
  return verb(body, 'stand', (request) => () => selfOf(body).person.rising(request));
}
