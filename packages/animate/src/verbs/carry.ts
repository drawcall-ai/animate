import { Object3D } from 'three';
import { selfOf, type Body } from '../body/body';
import { handsOn } from '../body/hold';
import { Thing } from '../body/things';
import type { Frame } from '../core/frame';
import type { Placement } from '../core/goal';
import { bringing } from '../core/hands';
import { Person } from '../humanoid/person';
import { carrying, wayOf } from '../humanoid/hands/carry';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a carry goes. */
export interface CarryOptions {
  /** the thing's mean speed along its way (m/s; default a calm 0.5, a transfer walked somewhere its own pace) */
  speed?: number;
  /** the hands' acceleration (m/s²) */
  accel?: number;
  /** ends on this instead of arriving */
  until?: Until;
}

/**
 * Carries `thing`, which the body holds, to `target` — or through each of a list of targets, one smooth way: off whatever it is in first
 * (its hip, a pouch, a well; a heavy one after a knee dip), out the way its empty's approach comes in (from the point of it nearest the
 * thing), and in to the last target the way that target's approach comes (`userData.approach`, slowing to its `userData.speed`); an
 * `Object3D` target turns it as the target is turned, reached by the start of the last straight. When it must walk there it lifts it to
 * its body, walks (borrowed legs) and raises it onto its place as it arrives; its eyes go where it goes (borrowed). A mover, it ends once
 * the thing has come to rest there, and keeps it there. It returns `false` if no stand reaches the target.
 */
export function carry(body: Body, thing: Object3D, target: Target | readonly Target[], options: CarryOptions = {}): Verb {
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length) throw new Error('carry: give a target');
  return verb(body, 'carry', (request) => function* () {
    const self = selfOf(body), carried = Thing.of(thing);
    const hands = handsOn(self, carried);
    if (!hands.length) throw new Error(`carry: no hand of the body holds "${thing.name}" (grab it first)`);
    const points = targets.map((each, k) => {
      const find = finder(self, each), last = k === targets.length - 1;
      return (f: Frame): Placement => {
        const found = find(f);
        return { position: found.position, quaternion: last ? found.quaternion ?? undefined : undefined };
      };
    });
    const last = targets[targets.length - 1];
    if (!(self instanceof Person)) {
      yield* bringing(self, request, hands[0], carried, points[points.length - 1]);
      return;
    }
    const way = wayOf(self, carried, points, last instanceof Object3D ? last : null);
    yield* carrying(self, request, carried, way, options);
  }, options.until);
}
