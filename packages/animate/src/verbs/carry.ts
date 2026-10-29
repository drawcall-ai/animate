import { Object3D } from 'three';
import { selfOf, type Body } from '../body/body';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import type { Frame } from '../kernel/frame';
import type { Goal } from '../kernel/goal';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a carry goes. */
export interface CarryOptions {
  /** the thing's mean speed along its way (m/s; default a calm 0.5, a transfer walked somewhere its own pace) */
  speed?: number;
  /** the hands' acceleration (m/s²) */
  accel?: number;
  /** whether the body may walk up to stand in reach (default true); false keeps its feet where they stand, turning, bowing, crouching and
   * rising on its toes for the target as far as its arms and trunk allow, and ends `false` if that is not far enough */
  step?: boolean;
  /** ends on this instead of arriving */
  until?: Until;
}

/**
 * Carries `thing`, which the body holds, to `target` — or through each of a list of targets, one smooth way: off whatever it is in first
 * (its hip, a pouch, a well; a heavy one after a knee dip), out the way its empty's approach comes in (from the point of it nearest the
 * thing), and in to the last target the way that target's approach comes (`userData.approach`: the names of empties beside it, under its
 * parent, outermost first; slowing to its `userData.speed`); an
 * `Object3D` target turns it as the target is turned, reached by the start of the last straight. When it must walk there (and `step`
 * allows) it lifts it to its body, walks (borrowed legs) and raises it onto its place as it arrives; its eyes go where it goes (borrowed).
 * Like `grab`, it picks where to stand once, as it starts. A mover, it ends once the thing has come to rest there, and keeps it there. It
 * returns `false` if no stand reaches the target (with `step: false`: if it is out of reach from where the body stands), and, carried
 * straight there, if the thing does not come to rest in place: its arms short of it two seconds on (`late carry`), or its own trunk and
 * head holding it off a target too near them (a target on its own head, a cup put to the mouth, is held in front of it by design); the
 * dev log's entry says which, and by how much. It holds the thing where it got to either way.
 */
export function carry(body: Body, thing: Object3D, target: Target | readonly Target[], options: CarryOptions = {}): Verb {
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length) throw new Error('carry: give a target');
  return verb(body, 'carry', (request) => function* () {
    const self = selfOf(body), carried = Thing.of(thing);
    if (!handsOn(self, carried).length) throw new Error(`carry: no hand of the body holds "${thing.name}" (grab it first)`);
    const points = targets.map((each, k) => {
      const find = finder(self, each), last = k === targets.length - 1;
      // (only the last turns it)
      return (f: Frame): Goal => last ? find(f) : { position: find(f).position };
    });
    const last = targets[targets.length - 1];
    yield* self.handling.bring(request, carried, points, last instanceof Object3D ? last : null, options);
  }, options.until);
}
