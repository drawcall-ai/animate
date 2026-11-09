import { Object3D } from 'three';
import { selfOf, type Body } from '../body';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import type { Frame } from '../kernel/frame';
import type { Goal } from '../kernel/goal';
import { finder, type Target } from '../things/target';
import { verb, type Verb } from './story';
import type { HandOptions } from '../body/hand-staging';

/**
 * Carries `thing`, which the body holds, to `target` — or through each of a list of targets, one smooth way, as far as the arms take it (a
 * list routes the thing, not the feet: where it must walk, the feet go straight to stand for the last, and it passes the others only as it
 * is raised at the walk's end; to route the walk, `walkTo` beside a raced carry to an empty on the body): off whatever it is in first
 * (its hip, a pouch, a well; a heavy one after a knee dip), out the way its empty's approach comes in (from the point of it nearest the
 * thing), and in to the last target the way that target's approach comes (`userData.approach`: the names of empties beside it, under its
 * parent, outermost first; slowing to its `userData.speed`); an
 * `Object3D` target (or a function returning one) turns it as the target is turned, reached by the start of the last straight; a point keeps
 * it turned as it is, in the world where the body stands, and where it must walk there brought upright and turned with the body (it keeps the
 * turn from the body's facing it set out with, in one hand as in two). A target whose turn has a thing in both hands end with
 * the arms crossed says so in the dev log. In one
 * hand by a grip that sets no turn it goes as the hand holds it, the arm turning it: if the arm cannot hold it so at the end — in the
 * trunk, past a joint's range, or strained — the hand regrips it in its fingers as it comes there, onto a grasp the arm holds there
 * comfortably (people choose a grasp for the posture it ends in), the thing still ending turned as asked. When it must walk there (and `step`
 * allows) it lifts it to its body, walks (borrowed legs) and raises it onto its place as it arrives; its eyes go where it goes (borrowed).
 * A place on its way that it came no nearer than 10 cm is said once on the console, naming it, and it goes on. Like `grab`, it picks where to stand once, as it starts. A mover, it ends once the thing has come to rest there, turned as its target
 * is (within 3°). Its hold ends with the verb: after it the thing rides the hand, drifting a few centimetres as the arm eases, so
 * `until: Infinity` (raced) holds it on; a target on the body (an empty under it or a bone) the hand goes on keeping to, moving with it, until its next verb, so leave it there till then. A thing in one hand carried to an `Object3D` is seated on it in the fingers once the arm has
 * brought it within 3 cm, if it can be. Whatever ends `true` there a `release` onto that object, as it ends, sets exactly on it. A grip that declares its contact (`userData.point`, a
 * digit on an empty) keeps it, neither regripped nor seated: the arm alone puts the thing there. It
 * throws `Missed` if no stand reaches the target (with `step: false`: if it is out of reach from where the body stands), and, carried
 * straight there, if the thing does not come to rest in place: stopped getting nearer more than 1.5 cm short of it, held off by the arms
 * (within that, it ends `true` there), or its own trunk and head holding it off a target too near them (a target on its own head, a cup put
 * to the mouth, is held in front of it by design). The hands hold the thing where it got to either way. Given `until`, it returns `true`
 * if the thing has come to rest there and is still within 1.5 cm of it as that ends, else `false`. It places the thing's origin at the
 * target: to bring one point of it there, offset the target by that point.
 */
export function carry(body: Body, thing: Object3D, target: Target | readonly Target[], options: HandOptions = {}): Verb {
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length) throw new Error('carry: give a target');
  if (options.speed !== undefined && !(options.speed > 0 && options.speed < Infinity)) throw new Error(`carry: a speed of ${options.speed}`);
  return verb(body, 'carry', (request) => function* () {
    const self = selfOf(body), carried = Thing.of(thing);
    if (!handsOn(self, carried).length) throw new Error(`carry: no hand of the body holds "${thing.name}" (grab it first)`);
    const points = targets.map((each, k) => {
      const find = finder(self, each), last = k === targets.length - 1;
      // (only the last turns it)
      return (f: Frame): Goal => last ? find(f) : { position: find(f).position };
    });
    // (the last target's object, given as one or by a function as it starts: its approach, and whether it rides on the body)
    const last = targets[targets.length - 1], end = typeof last === 'function' ? last(self.time) : last;
    yield* self.handStaging.bring(request, carried, points, end instanceof Object3D ? end : null, options);
  }, { until: options.until });
}
